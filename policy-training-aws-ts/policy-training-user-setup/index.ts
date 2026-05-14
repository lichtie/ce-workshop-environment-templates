import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as gitlab from "@pulumi/gitlab";

// =============================================================================
// Configuration
// =============================================================================

const config = new pulumi.Config();

// Required
const org = pulumi.getOrganization();
const userKey = config.require("userKey");
const username = config.require("existingUsername");
const gitSourceRepo = config.get("overrideGithubRepoFork");

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
const requiredIpsEnvironmentNameOut = workshopStack
  .getOutput("requiredIpsEnvironmentNameOut")
  .apply((v) => String(v));
const gitlabProjectId = workshopStack
  .getOutput("gitlabProjectId")
  .apply((v) => String(v));

// 🔵 Override inputs — skip or customize resource creation if provided
const existingTeam = config.get("existingTeam");
const stackTtlDays = config.getNumber("stackTtlDays") ?? 14;
const parentStackTtlDays = config.getNumber("parentStackTtlDays") ?? 18;

// GitLab user IDs are integers, not usernames. Provide the participant's numeric GitLab user ID.
// If not provided, GitLab repo membership is skipped.
const gitlabUserId = config.getNumber("gitlabUserId");

// =============================================================================
// Workshop project slugs — must match sub-directories in the GitLab repo
// and project names in Pulumi Cloud.
// =============================================================================

const projectSlugs = [
  "s3-website",
  "rds-database",
  "ec2-instance",
  "waf-config",
];

// =============================================================================
// Per-user Team
// Used for TeamStackPermission and TeamEnvironmentPermission.
// =============================================================================
let userTeam: pulumiservice.Team | undefined;
if (!existingTeam) {
  userTeam = new pulumiservice.Team(`team-${userKey}`, {
    organizationName: org,
    teamType: "pulumi",
    name: `${userKey}-team`,
    displayName: `${userKey} Workshop Team`,
    description: `Scoped team for workshop participant ${userKey}`,
    members: [username],
  });

  // =============================================================================
  // Team Environment Permissions — open access to the shared AWS ESC environment
  // =============================================================================

  new pulumiservice.TeamEnvironmentPermission(
    `env-perm-aws-${userKey}`,
    {
      organization: org,
      team: userTeam.name.apply((n) => n!),
      project: "policies-workshop",
      environment: awsEscEnvironmentName,
      permission: "open",
    },
    { dependsOn: userTeam },
  );

  new pulumiservice.TeamEnvironmentPermission(
    `env-perm-required-ips-${userKey}`,
    {
      organization: org,
      team: userTeam.name.apply((n) => n!),
      project: "policies-workshop",
      environment: requiredIpsEnvironmentNameOut,
      permission: "open",
    },
    { dependsOn: userTeam },
  );
}

// =============================================================================
// 🟠 Per-Stack Resources
// For each project: stack → tags → team permission → deployment settings → TTL
// =============================================================================

const allStackTags = {
  user: userKey,
  wksp: "policies-training",
};

const stackDestroyAt = new Date(
  Date.now() + stackTtlDays * 86400_000,
).toISOString();

const stacks = projectSlugs.map((slug) => {
  const stack = new pulumiservice.Stack(`stack-${userKey}-${slug}`, {
    organizationName: org,
    projectName: slug,
    stackName: userKey,
  });

  new pulumiservice.StackTags(
    `tags-${userKey}-${slug}`,
    { organization: org, project: slug, stack: userKey, tags: allStackTags },
    { dependsOn: stack },
  );

  if (userTeam) {
    new pulumiservice.TeamStackPermission(
      `stack-perm-${userKey}-${slug}`,
      {
        organization: org,
        team: userTeam.name.apply((n) => n!),
        project: slug,
        stack: userKey,
        permission: 103, // 101=read, 102=edit, 103=admin
      },
      { dependsOn: [userTeam, stack] },
    );
  }

  const settings = new pulumiservice.DeploymentSettings(
    `deploy-${userKey}-${slug}`,
    {
      organization: org,
      project: slug,
      stack: userKey,
      sourceContext: {
        git: {
          branch: "main",
          repoDir: `projects/${slug}`,
        },
      },
      operationContext: {
        environmentVariables: {
          PULUMI_ORG: org,
          STACK_NAME: userKey,
        },
      },
      vcs: {
        provider: "gitlab",
        repository: "lichtie-group/policy-training-workshop",
        deployCommits: true,
        installationId: "4defa6f1-756b-4194-93ce-42e2272b1286",
        previewPullRequests: true,
      },
    },
    { dependsOn: stack },
  );

  new pulumiservice.DeploymentSchedule(
    `stack-ttl-${userKey}-${slug}`,
    {
      organization: org,
      project: slug,
      stack: userKey,
      pulumiOperation: "destroy",
      timestamp: stackDestroyAt,
    },
    { dependsOn: [stack, settings] },
  );

  return stack;
});

// =============================================================================
// 🟠 Preventative Policy Group — Always Create
// Pre-created empty; participant configures policy packs during the workshop.
// =============================================================================

const preventativeGroup = new pulumiservice.PolicyGroup(
  `preventative-${userKey}`,
  {
    organizationName: org,
    name: `${userKey}-preventative`,
    entityType: "stacks",
    mode: "preventative",
    stacks: projectSlugs.map((slug) => ({
      name: userKey,
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
  `audit-${userKey}`,
  {
    organizationName: org,
    name: `${userKey}-audit`,
    entityType: "stacks",
    mode: "audit",
    stacks: projectSlugs.map((slug) => ({
      name: userKey,
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
  new gitlab.ProjectMembership(`gitlab-member-${userKey}`, {
    project: gitlabProjectId,
    userId: gitlabUserId,
    accessLevel: "developer",
  });
}

// =============================================================================
// 🔵 Self-Destruct TTL — Allow Override via parentStackTtlDays (default 18)
// Schedules a destroy of this user-setup stack itself.
// =============================================================================

const setupDeploymentSettings = new pulumiservice.DeploymentSettings(
  "setup-deployment-settings",
  {
    organization: org,
    project: pulumi.getProject(),
    stack: pulumi.getStack(),
    sourceContext: {
      git: {
        repoUrl:
          gitSourceRepo ??
          "https://github.com/lichtie/ce-workshop-environment-templates",
        branch: "main",
        repoDir: "policy-training-aws-ts/policy-training-user-setup",
      },
    },
    operationContext: {
      environmentVariables: {
        PULUMI_ORG: org,
      },
    },
  },
);

const parentDestroyAt = new Date(
  Date.now() + parentStackTtlDays * 86400_000,
).toISOString();

new pulumiservice.DeploymentSchedule(
  `self-ttl-${userKey}`,
  {
    organization: org,
    project: pulumi.getProject(),
    stack: pulumi.getStack(),
    pulumiOperation: "destroy",
    timestamp: parentDestroyAt,
  },
  { dependsOn: setupDeploymentSettings },
);

// =============================================================================
// Outputs
// =============================================================================

export const preventativePolicyGroupName = preventativeGroup.name;
export const auditPolicyGroupName = auditGroup.name;
export const stackNames = projectSlugs.map((slug) => `${slug}/${userKey}`);
export const stackTtlScheduledDestroyAt = stackDestroyAt;
export const selfTtlScheduledDestroyAt = parentDestroyAt;
