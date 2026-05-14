import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as aws from "@pulumi/aws";
import * as gitlab from "@pulumi/gitlab";

// =============================================================================
// Configuration
// =============================================================================

const config = new pulumi.Config();

// Required
const org = pulumi.getOrganization();

// 🔵 Override inputs — skip resource creation if these are set
const existingGitlabProjectId = config.get("existingGitlabProjectId");
const existingGitlabRepoUrl = config.get("existingGitlabRepoUrl");
const existingAwsRoleArn = config.get("existingAwsRoleArn");
const existingOidcProviderArn = config.get("existingOidcProviderArn");
const existingAwsEscEnvironmentName = config.get(
  "existingAwsEscEnvironmentName",
);
const workshopTtlDays = config.getNumber("workshopTtlDays") ?? 21;

// 🟠 Always-create inputs — configurable but not overridable
const allowedIps = config.getObject<string[]>("allowedIps") ?? [];

// Other optional
const gitlabGroupPath = config.require("gitlabGroupPath");

const gitlabConfig = new pulumi.Config("gitlab");
gitlabConfig.requireSecret("token");

const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region");

// =============================================================================
// Helpers
// =============================================================================

const b64 = (s: string): string => Buffer.from(s).toString("base64");
const pulumiAccessToken = config.requireSecret("pulumiAccessToken");

const tokenPromise = new Promise<string>((resolve) => {
  pulumiAccessToken.apply((t) => {
    resolve(t);
    return t;
  });
});

const tagEnvWksp = new pulumi.ResourceHook("tag-env-wksp", async (args) => {
  const https = require("https");
  const org: string = args.newOutputs?.["organization"];
  const project: string = args.newOutputs?.["project"];
  const env: string = args.newOutputs?.["name"];
  const token = await tokenPromise;

  if (!org || !project || !env) return;

  const body = JSON.stringify({ name: "wksp", value: "policies-wksp" });
  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.pulumi.com",
        path: `/api/esc/environments/${org}/${project}/${env}/tags`,
        method: "POST",
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
});

// =============================================================================
// GitLab Sub-project File Content
// Each project has intentional AWS security issues for policy-as-code training.
// =============================================================================

const sharedTsconfig = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      outDir: "bin",
      target: "es2020",
      module: "commonjs",
      moduleResolution: "node",
      sourceMap: true,
      experimentalDecorators: true,
      pretty: true,
      noFallthroughCasesInSwitch: true,
      noImplicitReturns: true,
      forceConsistentCasingInFileNames: true,
    },
    files: ["index.ts"],
  },
  null,
  4,
);

const makePackageJson = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "0.1.0",
      devDependencies: { "@types/node": "^18", typescript: "^5" },
      dependencies: {
        "@pulumi/aws": "^7.29.0",
        "@pulumi/pulumi": "^3.237.0",
      },
    },
    null,
    4,
  );

const makePulumiYaml = (name: string, description: string) =>
  `name: ${name}\nruntime: nodejs\ndescription: ${description}\n`;

interface ProjectDef {
  slug: string;
  description: string;
  indexTs: string;
}

const projects: ProjectDef[] = [
  {
    slug: "s3-website",
    description: "S3 static website — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const websiteBucket = new aws.s3.BucketV2("website", {
    bucket: \`policies-wksp-\${pulumi.getStack()}-site\`,
    tags: {
        Name: "workshop-website",
    },
});

new aws.s3.BucketAclV2("website-acl", {
    bucket: websiteBucket.id,
    acl: "public-read",
});

new aws.s3.BucketPublicAccessBlock("website-pab", {
    bucket: websiteBucket.id,
    blockPublicAcls: false,
    blockPublicPolicy: false,
    ignorePublicAcls: false,
    restrictPublicBuckets: false,
});

new aws.s3.BucketWebsiteConfigurationV2("website-config", {
    bucket: websiteBucket.id,
    indexDocument: { suffix: "index.html" },
    errorDocument: { key: "error.html" },
});

export const bucketName = websiteBucket.bucket;
export const websiteEndpoint = websiteBucket.websiteEndpoint;
`,
  },
  {
    slug: "rds-database",
    description: "RDS PostgreSQL database — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const dbPassword = config.requireSecret("dbPassword");

const dbSg = new aws.ec2.SecurityGroup("db-sg", {
    name: \`policies-wksp-\${pulumi.getStack()}-db-sg\`,
    description: "Database security group",
    ingress: [{
        protocol: "tcp",
        fromPort: 5432,
        toPort: 5432,
        cidrBlocks: ["0.0.0.0/0"],
        description: "PostgreSQL",
    }],
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
});

const db = new aws.rds.Instance("app-db", {
    identifier: \`policies-wksp-\${pulumi.getStack()}-db\`,
    engine: "postgres",
    engineVersion: "14",
    instanceClass: "db.t3.micro",
    allocatedStorage: 20,
    dbName: "appdb",
    username: "dbadmin",
    password: dbPassword,
    vpcSecurityGroupIds: [dbSg.id],
    storageEncrypted: false,
    backupRetentionPeriod: 0,
    deletionProtection: false,
    skipFinalSnapshot: true,
});

export const dbEndpoint = db.endpoint;
export const dbPort = db.port;
`,
  },
  {
    slug: "ec2-instance",
    description: "EC2 web server — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const webSg = new aws.ec2.SecurityGroup("web-sg", {
    name: \`policies-wksp-\${pulumi.getStack()}-web-sg\`,
    description: "Web server security group",
    ingress: [
        { protocol: "tcp", fromPort: 80,  toPort: 80,  cidrBlocks: ["0.0.0.0/0"], description: "HTTP" },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], description: "HTTPS" },
        { protocol: "tcp", fromPort: 22,  toPort: 22,  cidrBlocks: ["0.0.0.0/0"], description: "SSH" },
    ],
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
});

const ami = aws.ec2.getAmiOutput({
    mostRecent: true,
    owners: ["amazon"],
    filters: [{ name: "name", values: ["amzn2-ami-hvm-*-x86_64-gp2"] }],
});

const instance = new aws.ec2.Instance("web-server", {
    ami: ami.id,
    instanceType: "t3.micro",
    vpcSecurityGroupIds: [webSg.id],
    metadataOptions: {
        httpEndpoint: "enabled",
        httpTokens: "optional",
    },
    rootBlockDevice: {
        volumeSize: 20,
        encrypted: false,
    },
    tags: {
        Name: "workshop-web-server",
    },
});

export const instanceId = instance.id;
export const publicIp = instance.publicIp;
export const publicDns = instance.publicDns;
`,
  },
  {
    slug: "waf-config",
    description: "WAF WebACL — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const webAcl = new aws.wafv2.WebAcl("app-waf", {
    name: \`policies-wksp-\${pulumi.getStack()}-waf\`,
    scope: "REGIONAL",
    defaultAction: { allow: {} },
    rules: [
        {
            name: "CommonRuleSet",
            priority: 1,
            overrideAction: { count: {} },
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesCommonRuleSet",
                },
            },
            visibilityConfig: {
                cloudwatchMetricsEnabled: true,
                metricName: "CommonRuleSet",
                sampledRequestsEnabled: false,
            },
        },
        {
            name: "SQLiRuleSet",
            priority: 2,
            overrideAction: { count: {} },
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesSQLiRuleSet",
                },
            },
            visibilityConfig: {
                cloudwatchMetricsEnabled: true,
                metricName: "SQLiRuleSet",
                sampledRequestsEnabled: false,
            },
        },
    ],
    visibilityConfig: {
        cloudwatchMetricsEnabled: true,
        metricName: \`policies-wksp-\${pulumi.getStack()}-waf\`,
        sampledRequestsEnabled: false,
    },
});

export const webAclArn = webAcl.arn;
`,
  },
];

const ciYml = `image: pulumi/pulumi-nodejs:latest

stages:
  - preview

variables:
  PULUMI_ACCESS_TOKEN: $PULUMI_ACCESS_TOKEN
  PULUMI_ORG: $PULUMI_ORG
  STACK_NAME: $STACK_NAME

.pulumi_preview: &pulumi_preview
  stage: preview
  before_script:
    - cd $PROJECT_DIR && npm install
  script:
    - pulumi stack select $PULUMI_ORG/$PULUMI_PROJECT/$STACK_NAME --create
    - pulumi preview --non-interactive --diff

${projects
  .map(
    (p) => `${p.slug}-preview:
  <<: *pulumi_preview
  variables:
    PROJECT_DIR: projects/${p.slug}
    PULUMI_PROJECT: ${p.slug}
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - projects/${p.slug}/**/*`,
  )
  .join("\n\n")}
`;

// =============================================================================
// 🔵 GitLab Repository (Allow Override with Config)
// Skip creation if existingGitlabProjectId is set.
// =============================================================================

let gitlabProjectId: pulumi.Output<string>;
let gitlabRepoUrl: pulumi.Output<string>;

if (existingGitlabProjectId === undefined) {
  const group = gitlab.getGroupOutput({ fullPath: gitlabGroupPath });

  const repo = new gitlab.Project("workshop-repo", {
    name: "policy-training-workshop",
    description:
      "Workshop source code with intentional AWS security issues for policy-as-code training",
    defaultBranch: "main",
    initializeWithReadme: false,
    visibilityLevel: "private",
    namespaceId: group.id.apply((id) => parseInt(id)),
  });
  gitlabProjectId = repo.id;
  gitlabRepoUrl = repo.httpUrlToRepo;

  new gitlab.RepositoryFile(
    "ci-file",
    {
      project: gitlabProjectId,
      filePath: ".gitlab-ci.yml",
      branch: "main",
      content: b64(ciYml),
      commitMessage: "feat: add GitLab CI/CD pipeline for Pulumi previews",
      encoding: "base64",
      authorName: "Pulumi Workshop",
      authorEmail: "workshop@pulumi.com",
    },
    { dependsOn: repo },
  );

  for (const proj of projects) {
    const prefix = `projects/${proj.slug}`;
    const opts = { dependsOn: repo };

    new gitlab.RepositoryFile(
      `${proj.slug}-pulumiyaml`,
      {
        project: gitlabProjectId,
        filePath: `${prefix}/Pulumi.yaml`,
        branch: "main",
        content: b64(makePulumiYaml(proj.slug, proj.description)),
        commitMessage: `feat: add ${proj.slug} project`,
        encoding: "base64",
        authorName: "Pulumi Workshop",
        authorEmail: "workshop@pulumi.com",
      },
      opts,
    );

    new gitlab.RepositoryFile(
      `${proj.slug}-packagejson`,
      {
        project: gitlabProjectId,
        filePath: `${prefix}/package.json`,
        branch: "main",
        content: b64(makePackageJson(proj.slug)),
        commitMessage: `feat: add ${proj.slug} package.json`,
        encoding: "base64",
        authorName: "Pulumi Workshop",
        authorEmail: "workshop@pulumi.com",
      },
      opts,
    );

    new gitlab.RepositoryFile(
      `${proj.slug}-tsconfig`,
      {
        project: gitlabProjectId,
        filePath: `${prefix}/tsconfig.json`,
        branch: "main",
        content: b64(sharedTsconfig),
        commitMessage: `feat: add ${proj.slug} tsconfig.json`,
        encoding: "base64",
        authorName: "Pulumi Workshop",
        authorEmail: "workshop@pulumi.com",
      },
      opts,
    );

    new gitlab.RepositoryFile(
      `${proj.slug}-indexts`,
      {
        project: gitlabProjectId,
        filePath: `${prefix}/index.ts`,
        branch: "main",
        content: b64(proj.indexTs),
        commitMessage: `feat: add ${proj.slug} Pulumi program`,
        encoding: "base64",
        authorName: "Pulumi Workshop",
        authorEmail: "workshop@pulumi.com",
      },
      opts,
    );
  }
} else {
  gitlabProjectId = pulumi.output(existingGitlabProjectId);
  gitlabRepoUrl = pulumi.output(existingGitlabRepoUrl ?? "");
}

// =============================================================================
// 🟢 AWS OIDC Provider — Find or Create
// If api.pulumi.com/oidc is already registered in this account, set
// existingOidcProviderArn to skip creation (or import with `pulumi import`).
// =============================================================================

let oidcProvider: aws.iam.OpenIdConnectProvider | undefined;
if (existingOidcProviderArn === undefined && existingAwsRoleArn === undefined) {
  oidcProvider = new aws.iam.OpenIdConnectProvider("pulumi-oidc-provider", {
    url: "https://api.pulumi.com/oidc",
    clientIdLists: [org],
  });
}

// =============================================================================
// 🔵 AWS IAM Role — Allow Override with Config
// Skip if existingAwsRoleArn is provided.
// =============================================================================

const identity = aws.getCallerIdentityOutput();
let awsRoleArn: pulumi.Output<string>;

if (existingAwsRoleArn === undefined) {
  const trustPolicy = pulumi
    .all([identity.accountId, org])
    .apply(([accountId, organization]: [string, string]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Federated: `arn:aws:iam::${accountId}:oidc-provider/api.pulumi.com/oidc`,
            },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: { "api.pulumi.com/oidc:aud": organization },
              StringLike: {
                "api.pulumi.com/oidc:sub": `pulumi:deploy:org:${organization}:project:*:stack:*:operation:*:scope:write`,
              },
            },
          },
        ],
      }),
    );

  const iamRole = new aws.iam.Role(
    "workshop-deploy-role",
    {
      name: "policies-wksp-deploy",
      description:
        "Least-privilege role for Pulumi Deployments to run workshop stacks",
      assumeRolePolicy: trustPolicy,
    },
    { dependsOn: oidcProvider ? [oidcProvider] : [] },
  );

  // Least-privilege policy for the 5 workshop sub-projects. Resources are scoped to
  // this account and region where AWS supports resource-level permissions.
  // EC2 Describe* and API Gateway do not support resource-level restrictions (must use "*").
  const deployPolicy = identity.accountId.apply((accountId) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "S3Website",
          Effect: "Allow",
          Action: [
            "s3:CreateBucket",
            "s3:DeleteBucket",
            "s3:ListBucket",
            "s3:ListAllMyBuckets",
            "s3:GetBucketLocation",
            "s3:GetBucketAcl",
            "s3:PutBucketAcl",
            "s3:GetBucketPublicAccessBlock",
            "s3:PutBucketPublicAccessBlock",
            "s3:GetBucketWebsite",
            "s3:PutBucketWebsite",
            "s3:DeleteBucketWebsite",
            "s3:GetBucketTagging",
            "s3:PutBucketTagging",
            "s3:DeleteBucketTagging",
            "s3:GetBucketVersioning",
            "s3:GetBucketLogging",
            "s3:GetBucketCORS",
            "s3:GetBucketPolicy",
            "s3:PutBucketPolicy",
            "s3:DeleteBucketPolicy",
            "s3:GetBucketOwnershipControls",
            "s3:PutBucketOwnershipControls",
            "s3:GetBucketObjectLockConfiguration",
            "s3:GetEncryptionConfiguration",
            "s3:GetLifecycleConfiguration",
            "s3:GetReplicationConfiguration",
            "s3:GetAccelerateConfiguration",
            "s3:GetBucketRequestPayment",
          ],
          // S3 bucket ARNs don't include account ID
          Resource: "arn:aws:s3:::policies-wksp-*",
        },
        {
          Sid: "RdsInstances",
          Effect: "Allow",
          Action: [
            "rds:CreateDBInstance",
            "rds:DeleteDBInstance",
            "rds:DescribeDBInstances",
            "rds:ModifyDBInstance",
            "rds:AddTagsToResource",
            "rds:RemoveTagsFromResource",
            "rds:ListTagsForResource",
            "rds:DescribeDBParameterGroups",
            "rds:DescribeDBSubnetGroups",
            "rds:DescribeDBEngineVersions",
            "rds:DescribeOrderableDBInstanceOptions",
            "rds:DescribeDBInstanceAutomatedBackups",
          ],
          Resource: [
            `arn:aws:rds:${awsRegion}:${accountId}:db:policies-wksp-*`,
            // Option group, parameter group, subnet group lookups require "*"
            `arn:aws:rds:${awsRegion}:${accountId}:og:*`,
            `arn:aws:rds:${awsRegion}:${accountId}:pg:*`,
            `arn:aws:rds:${awsRegion}:${accountId}:subgrp:*`,
          ],
        },
        {
          Sid: "Ec2DescribeOps",
          Effect: "Allow",
          // Describe actions don't support resource-level restrictions — Resource:"*" required by AWS.
          // Region condition limits blast radius to the target region only.
          Action: [
            "ec2:DescribeInstances",
            "ec2:DescribeInstanceAttribute",
            "ec2:DescribeInstanceStatus",
            "ec2:DescribeInstanceTypes",
            "ec2:DescribeImages",
            "ec2:DescribeKeyPairs",
            "ec2:DescribeVpcs",
            "ec2:DescribeSubnets",
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeTags",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DescribeVolumes",
          ],
          Resource: "*",
          Condition: { StringEquals: { "aws:RequestedRegion": awsRegion } },
        },
        {
          Sid: "Ec2RunInstances",
          Effect: "Allow",
          // RunInstances needs perms on multiple resource types simultaneously; tag condition
          // ensures any launched instance must carry the policies-wksp-* Name tag.
          Action: ["ec2:RunInstances", "ec2:CreateTags"],
          Resource: [
            `arn:aws:ec2:${awsRegion}:${accountId}:instance/*`,
            `arn:aws:ec2:${awsRegion}::image/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:network-interface/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:security-group/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:subnet/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:volume/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:key-pair/*`,
          ],
          Condition: {
            StringLike: { "aws:RequestTag/Name": "policies-wksp-*" },
          },
        },
        {
          Sid: "Ec2InstanceOps",
          Effect: "Allow",
          // Lifecycle operations restricted to instances already tagged policies-wksp-*
          Action: [
            "ec2:TerminateInstances",
            "ec2:StartInstances",
            "ec2:StopInstances",
            "ec2:ModifyInstanceAttribute",
            "ec2:ModifyInstanceMetadataOptions",
          ],
          Resource: `arn:aws:ec2:${awsRegion}:${accountId}:instance/*`,
          Condition: {
            StringLike: { "ec2:ResourceTag/Name": "policies-wksp-*" },
          },
        },
        {
          Sid: "Ec2SecurityGroupCreate",
          Effect: "Allow",
          // Require the Name tag on creation so new SGs are always prefixed correctly
          Action: ["ec2:CreateSecurityGroup"],
          Resource: [
            `arn:aws:ec2:${awsRegion}:${accountId}:security-group/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:vpc/*`,
          ],
          Condition: {
            StringLike: { "aws:RequestTag/Name": "policies-wksp-*" },
          },
        },
        {
          Sid: "Ec2SecurityGroupModify",
          Effect: "Allow",
          // Rule changes restricted to SGs already tagged policies-wksp-*
          Action: [
            "ec2:DeleteSecurityGroup",
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress",
            "ec2:AuthorizeSecurityGroupEgress",
            "ec2:RevokeSecurityGroupEgress",
            "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
            "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          ],
          Resource: [
            `arn:aws:ec2:${awsRegion}:${accountId}:security-group/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:vpc/*`,
          ],
          Condition: {
            StringLike: { "ec2:ResourceTag/Name": "policies-wksp-*" },
          },
        },
        {
          Sid: "Wafv2WebAcl",
          Effect: "Allow",
          Action: [
            "wafv2:CreateWebACL",
            "wafv2:DeleteWebACL",
            "wafv2:GetWebACL",
            "wafv2:UpdateWebACL",
            "wafv2:TagResource",
            "wafv2:UntagResource",
            "wafv2:ListTagsForResource",
            "wafv2:PutLoggingConfiguration",
            "wafv2:GetLoggingConfiguration",
            "wafv2:DeleteLoggingConfiguration",
            "wafv2:ListLoggingConfigurations",
          ],
          Resource: `arn:aws:wafv2:${awsRegion}:${accountId}:regional/webacl/policies-wksp-*`,
        },
        {
          Sid: "Wafv2ManagedRules",
          Effect: "Allow",
          // CheckCapacity and DescribeManagedRuleGroup operate on AWS-owned managed rule groups
          // (not user-owned WebACLs), so Resource:"*" is unavoidable. Region condition limits scope.
          Action: ["wafv2:CheckCapacity", "wafv2:DescribeManagedRuleGroup"],
          Resource: "*",
          Condition: { StringEquals: { "aws:RequestedRegion": awsRegion } },
        },
      ],
    }),
  );
  new aws.iam.RolePolicy("workshop-deploy-policy", {
    role: iamRole.id,
    policy: deployPolicy,
  });

  awsRoleArn = iamRole.arn;
} else {
  awsRoleArn = pulumi.output(existingAwsRoleArn);
}

// =============================================================================
// 🔵 ESC Environment: AWS Integration — Allow Override with Config
// pulumi.interpolate embeds awsRoleArn (an Output<string>) into the YAML string.
// StringAsset is a data wrapper, not a Pulumi resource.
// =============================================================================

let awsEnvName: pulumi.Output<string>;

if (existingAwsEscEnvironmentName === undefined) {
  const awsEnvYaml = pulumi.interpolate`values:
  aws:
    login:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: ${awsRoleArn}
          sessionName: policies-wksp
  environmentVariables:
    AWS_ACCESS_KEY_ID: \${aws.login.accessKeyId}
    AWS_SECRET_ACCESS_KEY: \${aws.login.secretAccessKey}
    AWS_SESSION_TOKEN: \${aws.login.sessionToken}
    AWS_REGION: ${awsRegion}
`.apply((s: string) => new pulumi.asset.StringAsset(s));

  const awsEnv = new pulumiservice.Environment(
    "aws-integration",
    {
      organization: org,
      name: "policies-wksp-aws-integration",
      yaml: awsEnvYaml,
    },
    { hooks: { afterCreate: [tagEnvWksp] } },
  );

  awsEnvName = awsEnv.name.apply((n) => n!);
} else {
  awsEnvName = pulumi.output(existingAwsEscEnvironmentName);
}

// =============================================================================
// 🟠 ESC Environment: Allowed IPs — Always Create
// Used by custom policies that restrict which CIDR blocks are permitted in
// security groups and other network resources.
// =============================================================================

const allowedIpsYaml =
  allowedIps.length > 0
    ? `values:\n  pulumiConfig:\n    allowedCidrBlocks:\n${allowedIps.map((ip: string) => `      - "${ip}"`).join("\n")}\n`
    : `values:\n  pulumiConfig:\n    allowedCidrBlocks: []\n`;

const allowedIpsEnv = new pulumiservice.Environment(
  "allowed-ips",
  {
    organization: org,
    name: "policies-wksp-allowed-ips",
    yaml: new pulumi.asset.StringAsset(allowedIpsYaml),
  },
  { hooks: { afterCreate: [tagEnvWksp] } },
);

// =============================================================================
// 🔵 TTL: Destroy this stack after workshopTtlDays (default 21)
// DeploymentSettings must exist on this stack before a DeploymentSchedule can
// be created — the API rejects schedules on stacks without a runner configured.
// =============================================================================

const workshopDestroyAt = new Date(
  Date.now() + workshopTtlDays * 86400_000,
).toISOString();

const setupDeploymentSettings = new pulumiservice.DeploymentSettings(
  "setup-deployment-settings",
  {
    organization: org,
    project: pulumi.getProject(),
    stack: pulumi.getStack(),
    sourceContext: {
      git: {
        repoUrl: "https://github.com/lichtie/ce-workshop-environment-templates",
        branch: "main",
        repoDir: "policy-training-aws-ts/policy-training-workshop-setup",
      },
    },
    operationContext: {
      environmentVariables: {
        PULUMI_ORG: org,
      },
    },
  },
);

new pulumiservice.DeploymentSchedule(
  "workshop-ttl",
  {
    organization: org,
    project: pulumi.getProject(),
    stack: pulumi.getStack(),
    pulumiOperation: "destroy",
    timestamp: workshopDestroyAt,
  },
  { dependsOn: setupDeploymentSettings },
);

// =============================================================================
// Outputs
// =============================================================================

export { gitlabProjectId, gitlabRepoUrl };
export const awsRoleArnOut = awsRoleArn;
export const allowedIpsEnvironmentName = allowedIpsEnv.name;
export const awsEscEnvironmentName = awsEnvName;
export const workshopTtlScheduledDestroyAt = workshopDestroyAt;
