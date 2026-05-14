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
const username = config.get("existingUsername");
const gitSourceRepo =
  config.get("overrideGithubRepoFork") ??
  "https://github.com/lichtie/ce-workshop-environment-templates";
const pulumiAccessToken = config.requireSecret("pulumiAccessToken");

// Resolve secrets/outputs into Promises so they can be used inside ResourceHooks
const tokenPromise = new Promise<string>((resolve) => {
  pulumiAccessToken.apply((t) => {
    resolve(t);
    return t;
  });
});

// Workshop stack reference — reads shared outputs from policy-training-workshop-setup
// Format: "<org>/policy-training-workshop-setup/<stack-name>"
const workshopStackRef = config.require("workshopStackRef");
const workshopStack = new pulumi.StackReference("workshop-stack", {
  name: workshopStackRef,
});

const gitlabRepoUrl = workshopStack
  .getOutput("gitlabRepoUrl")
  .apply((v) => String(v));
const gitlabRepoPath = gitlabRepoUrl.apply((url) =>
  new URL(url).pathname.replace(/^\//, "").replace(/\.git$/, ""),
);
const awsEscEnvironmentName = workshopStack
  .getOutput("awsEscEnvironmentNameOut")
  .apply((v) => String(v));
const requiredIpsEnvironmentNameOut = workshopStack
  .getOutput("requiredIpsEnvironmentNameOut")
  .apply((v) => String(v));
const gitlabProjectId = workshopStack
  .getOutput("gitlabProjectId")
  .apply((v) => String(v));

const awsEnvNamePromise = new Promise<string>((resolve) => {
  awsEscEnvironmentName.apply((n) => {
    resolve(n);
    return n;
  });
});

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

const projectSlugs = ["web-app"];

// =============================================================================
// Per-user Team
// Used for TeamStackPermission and TeamEnvironmentPermission.
// =============================================================================
let userTeam: pulumiservice.Team | undefined;
if (!existingTeam && username) {
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
// Post-DeploymentSettings Hook
// Fires after DeploymentSettings is created:
//   1. Attaches the AWS ESC environment to the stack via the config API
//   2. Kicks off an initial deployment via the deployments API
// =============================================================================

const apiRequest = (
  token: string,
  method: string,
  path: string,
  body: string,
): Promise<void> => {
  const https = require("https");
  return new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.pulumi.com",
        path,
        method,
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.pulumi+8",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res: any) => {
        let data = "";
        res.on("data", (chunk: any) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`Pulumi API ${res.statusCode}: ${data}`));
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
};

const deploymentSettingsHook = new pulumi.ResourceHook(
  "deployment-settings-hook",
  async (args) => {
    const stackOrg: string = args.newOutputs?.["organization"];
    const project: string = args.newOutputs?.["project"];
    const stack: string = args.newOutputs?.["stack"];
    const token = await tokenPromise;
    const awsEnv = await awsEnvNamePromise;

    if (!stackOrg || !project || !stack) return;

    // 1. Attach the AWS ESC environment to the stack
    await apiRequest(
      token,
      "PUT",
      `/api/stacks/${stackOrg}/${project}/${stack}/config`,
      JSON.stringify({
        config: {},
        environment: `policies-workshop/${awsEnv}`,
      }),
    );

    // 2. Kick off an initial deployment
    await apiRequest(
      token,
      "POST",
      `/api/stacks/${stackOrg}/${project}/${stack}/deployments`,
      JSON.stringify({ operation: "update", inheritSettings: true }),
    );
  },
);

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
        repository: gitlabRepoPath,
        deployCommits: true,
        installationId: "4defa6f1-756b-4194-93ce-42e2272b1286",
        previewPullRequests: true,
      },
    },
    { dependsOn: stack, hooks: { afterCreate: [deploymentSettingsHook] } },
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
