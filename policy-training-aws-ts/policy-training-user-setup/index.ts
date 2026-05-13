import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as gitlab from "@pulumi/gitlab";

// =============================================================================
// Configuration
// =============================================================================

const config = new pulumi.Config();

// Required
const org = pulumi.getOrganization();
const username = config.require("username");

// Workshop stack reference — reads shared outputs from policy-training-workshop-setup
// Format: "<org>/policy-training-workshop-setup/<stack-name>"
const workshopStackRef = config.require("workshopStackRef");
const workshopStack = new pulumi.StackReference("workshop-stack", {
  name: workshopStackRef,
});

const gitlabRepoUrl = workshopStack
  .getOutput("gitlabRepoUrl")
  .apply((v) => String(v));
const awsEscEnvironmentName = workshopStack
  .getOutput("awsEscEnvironmentNameOut")
  .apply((v) => String(v));
const participantTeamName = workshopStack
  .getOutput("participantTeamNameOut")
  .apply((v) => String(v));

// Override the GitLab project ID if it differs from the workshop stack output
const gitlabProjectIdOverride = config.get("existingGitlabProjectId");
const gitlabProjectId =
  gitlabProjectIdOverride !== undefined
    ? pulumi.output(gitlabProjectIdOverride)
    : workshopStack.getOutput("gitlabProjectId").apply((v) => String(v));

// 🔵 Override inputs — skip or customize resource creation if provided
const existingCustomRoleName = config.get("existingCustomRoleName");
const stackTtlDays = config.getNumber("stackTtlDays") ?? 14;
const parentStackTtlDays = config.getNumber("parentStackTtlDays") ?? 18;
const deployBranch = config.get("deployBranch") ?? "main";
const extraStackTags =
  config.getObject<Record<string, string>>("extraStackTags") ?? {};
// GitLab user IDs are integers, not usernames. Provide the participant's numeric GitLab user ID.
// If not provided, GitLab repo membership is skipped.
const gitlabUserId = config.getNumber("gitlabUserId");

// =============================================================================
// Workshop project slugs — must match sub-directories in the GitLab repo
// and project names in Pulumi Cloud.
// =============================================================================

const projectSlugs = ["s3-website", "rds-database", "ec2-instance", "waf-config"];

// =============================================================================
// Org Member
// Ensures the participant exists as a member of the Pulumi organization.
// =============================================================================

const orgMember = new pulumiservice.OrganizationMember(`member-${username}`, {
  organizationName: org,
  username: username,
  role: "member",
});

// =============================================================================
// Per-user Team
// Used for TeamStackPermission and TeamEnvironmentPermission.
// =============================================================================

const userTeam = new pulumiservice.Team(
  `team-${username}`,
  {
    organizationName: org,
    teamType: "pulumi",
    name: `${username}-team`,
    displayName: `${username} Workshop Team`,
    description: `Scoped team for workshop participant ${username}`,
    members: [username],
  },
  { dependsOn: orgMember },
);

// =============================================================================
// 🔵 Custom Role — Allow Override with Config
// Intended to scope permissions to stacks tagged user: <username>.
// Tag-based RBAC is not natively supported in Pulumi roles; actual per-stack
// scoping is enforced via TeamStackPermission below.
// TODO: Fill in the permissions object using your org's RBAC wire grammar.
// =============================================================================

let customRoleName: pulumi.Output<string>;
let customRoleId: pulumi.Output<string>;
let customRoleDep: pulumiservice.OrganizationRole | undefined;

if (existingCustomRoleName === undefined) {
  // stack:read lets the participant see their stacks in the Pulumi console.
  // The actual edit/admin scoping per stack is enforced by TeamStackPermission below.
  const userPermissions = pulumiservice.buildAllowPermissionsOutput({
    permissions: ["stack:read", "environment:open"],
  });
  const customRole = new pulumiservice.OrganizationRole(`role-${username}`, {
    organizationName: org,
    name: `${username}-role`,
    description: `Custom role for ${username}. Scoped to stacks tagged user:${username} via TeamStackPermission.`,
    resourceType: "global",
    permissions: userPermissions.permissions,
  });
  customRoleName = customRole.name.apply((n) => n!);
  customRoleId = customRole.roleId;
  customRoleDep = customRole;
} else {
  customRoleName = pulumi.output(existingCustomRoleName);
  customRoleId = pulumi.output(existingCustomRoleName);
}

// Assign the custom role to the user's team
new pulumiservice.TeamRoleAssignment(
  `role-assignment-${username}`,
  {
    organizationName: org,
    teamName: userTeam.name.apply((n) => n!),
    roleId: customRoleId,
  },
  { dependsOn: customRoleDep ? [userTeam, customRoleDep] : [userTeam] },
);

// =============================================================================
// 🟠 Stacks — Always Create
// One stack per workshop project, named after the participant.
// =============================================================================

const stacks = projectSlugs.map(
  (slug) =>
    new pulumiservice.Stack(`stack-${username}-${slug}`, {
      organizationName: org,
      projectName: slug,
      stackName: username,
    }),
);

// =============================================================================
// 🔵 Stack Tags — Allow Override (extraStackTags merged with base tags)
// =============================================================================

const allStackTags = { user: username, wksp: "policies-training", ...extraStackTags };

projectSlugs.forEach((slug, i) => {
  new pulumiservice.StackTags(
    `tags-${username}-${slug}`,
    {
      organization: org,
      project: slug,
      stack: username,
      tags: allStackTags,
    },
    { dependsOn: stacks[i] },
  );
});

// =============================================================================
// Team Stack Permissions — edit access to each of the user's stacks
// This enforces the "tagged user: <username>" scoping described above.
// =============================================================================

projectSlugs.forEach((slug, i) => {
  new pulumiservice.TeamStackPermission(
    `stack-perm-${username}-${slug}`,
    {
      organization: org,
      team: userTeam.name.apply((n) => n!),
      project: slug,
      stack: username,
      permission: 102, // 101=read, 102=edit, 103=admin
    },
    { dependsOn: [userTeam, stacks[i]] },
  );
});

// =============================================================================
// Team Environment Permission — open access to the shared AWS ESC environment
// =============================================================================

new pulumiservice.TeamEnvironmentPermission(
  `env-perm-${username}`,
  {
    organization: org,
    team: userTeam.name.apply((n) => n!),
    project: "default",
    environment: awsEscEnvironmentName,
    permission: "open",
  },
  { dependsOn: userTeam },
);

// =============================================================================
// 🔵 Deployment Settings — Allow Override (branch, VCS kind)
// Each stack points to its sub-directory in the GitLab repo.
// The workshop AWS role is assumed via OIDC on each deployment.
//
// NOTE: vcs.kind = "gitlab" is an attempt — if it causes errors on `pulumi up`,
// remove the `vcs` block. Deployments can still be triggered manually or via
// the Pulumi Cloud API / GitLab webhook.
// =============================================================================

projectSlugs.forEach((slug, i) => {
  new pulumiservice.DeploymentSettings(
    `deploy-${username}-${slug}`,
    {
      organization: org,
      project: slug,
      stack: username,
      sourceContext: {
        git: {
          repoUrl: gitlabRepoUrl,
          branch: deployBranch,
          repoDir: `projects/${slug}`,
        },
      },
      operationContext: {
        environmentVariables: {
          PULUMI_ORG: org,
          STACK_NAME: username,
        },
      },
      vcs: {
        kind: "gitlab",
      } as any,
    },
    { dependsOn: stacks[i] },
  );
});

// =============================================================================
// 🔵 Per-Stack TTL — Allow Override via stackTtlDays (default 14)
// =============================================================================

const stackDestroyAt = new Date(
  Date.now() + stackTtlDays * 86400_000,
).toISOString();

projectSlugs.forEach((slug, i) => {
  new pulumiservice.DeploymentSchedule(
    `stack-ttl-${username}-${slug}`,
    {
      organization: org,
      project: slug,
      stack: username,
      pulumiOperation: "destroy",
      timestamp: stackDestroyAt,
    },
    { dependsOn: stacks[i] },
  );
});

// =============================================================================
// 🟠 Preventative Policy Group — Always Create
// Pre-created empty; participant configures policy packs during the workshop.
// =============================================================================

const preventativeGroup = new pulumiservice.PolicyGroup(
  `preventative-${username}`,
  {
    organizationName: org,
    name: `${username}-preventative`,
    entityType: "stacks",
    mode: "preventative",
    stacks: projectSlugs.map((slug) => ({
      name: username,
      routingProject: slug,
    })),
    policyPacks: [],
  },
  { dependsOn: stacks },
);

// =============================================================================
// 🟠 Audit Policy Group — Always Create
// =============================================================================

const auditGroup = new pulumiservice.PolicyGroup(
  `audit-${username}`,
  {
    organizationName: org,
    name: `${username}-audit`,
    entityType: "stacks",
    mode: "audit",
    stacks: projectSlugs.map((slug) => ({
      name: username,
      routingProject: slug,
    })),
    policyPacks: [],
  },
  { dependsOn: stacks },
);

// =============================================================================
// 🔵 GitLab Repo Access — Allow Override
// Adds the participant as a Developer on the workshop repository.
// Requires gitlabUserId (numeric GitLab user ID, not username).
// Skip by omitting gitlabUserId from config.
// =============================================================================

if (gitlabUserId !== undefined) {
  new gitlab.ProjectMembership(`gitlab-member-${username}`, {
    project: gitlabProjectId,
    userId: gitlabUserId,
    accessLevel: "developer",
  });
}

// =============================================================================
// 🔵 Self-Destruct TTL — Allow Override via parentStackTtlDays (default 18)
// Schedules a destroy of this user-setup stack itself.
// =============================================================================

const parentDestroyAt = new Date(
  Date.now() + parentStackTtlDays * 86400_000,
).toISOString();

new pulumiservice.DeploymentSchedule(`self-ttl-${username}`, {
  organization: org,
  project: pulumi.getProject(),
  stack: pulumi.getStack(),
  pulumiOperation: "destroy",
  timestamp: parentDestroyAt,
});

// =============================================================================
// Outputs
// =============================================================================

export const customRoleNameOut = customRoleName;
export const preventativePolicyGroupName = preventativeGroup.name;
export const auditPolicyGroupName = auditGroup.name;
export const stackNames = projectSlugs.map((slug) => `${slug}/${username}`);
export const stackTtlScheduledDestroyAt = stackDestroyAt;
export const selfTtlScheduledDestroyAt = parentDestroyAt;
