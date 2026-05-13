import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as aws from "@pulumi/aws";
import * as gitlab from "@pulumi/gitlab";

// =============================================================================
// Configuration
// =============================================================================

const config = new pulumi.Config();

// Required
const org = config.require("organization");

// 🔵 Override inputs — skip resource creation if these are set
const existingParticipantTeamName = config.get("existingParticipantTeamName");
const existingWorkshopRoleName = config.get("existingWorkshopRoleName");
const existingGitlabProjectId = config.get("existingGitlabProjectId");
const existingGitlabRepoUrl = config.get("existingGitlabRepoUrl");
const existingAwsRoleArn = config.get("existingAwsRoleArn");
const existingOidcProviderArn = config.get("existingOidcProviderArn");
const existingAwsEscEnvironment = config.get("existingAwsEscEnvironment");
const workshopTtlDays = config.getNumber("workshopTtlDays") ?? 21;

// 🟠 Always-create inputs — configurable but not overridable
const allowedIps = config.getObject<string[]>("allowedIps") ?? [];

// Other optional
const gitlabNamespaceId = config.getNumber("gitlabNamespaceId");

const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region");

// =============================================================================
// Helpers
// =============================================================================

const b64 = (s: string): string => Buffer.from(s).toString("base64");

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
      dependencies: { "@pulumi/pulumi": "^3", "@pulumi/aws": "^6" },
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

// CONTAINS INTENTIONAL SECURITY ISSUES FOR WORKSHOP TRAINING
// Issues to find:
//   1. Bucket ACL set to public-read
//   2. All public access block controls disabled
//   3. No server-side encryption at rest
//   4. No versioning enabled
//   5. Incomplete tagging — missing Environment, Owner, Project, CostCenter

const websiteBucket = new aws.s3.BucketV2("website", {
    tags: {
        Name: "workshop-website",
        // ISSUE: required tags missing (Environment, Owner, Project, CostCenter)
    },
});

// ISSUE: ACL grants public read to all objects in the bucket
new aws.s3.BucketAclV2("website-acl", {
    bucket: websiteBucket.id,
    acl: "public-read",
});

// ISSUE: all four public-access-block controls are disabled
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

// ISSUE: aws.s3.BucketServerSideEncryptionConfigurationV2 is absent (no encryption at rest)
// ISSUE: aws.s3.BucketVersioningV2 is absent (versioning not enabled)
// ISSUE: no access logging configured

export const bucketName = websiteBucket.bucket;
export const websiteEndpoint = websiteBucket.websiteEndpoint;
`,
  },
  {
    slug: "lambda-api",
    description: "Lambda + API Gateway — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// CONTAINS INTENTIONAL SECURITY ISSUES FOR WORKSHOP TRAINING
// Issues to find:
//   1. Lambda execution role grants s3:* on all resources (should be one specific bucket/prefix)
//   2. CloudWatch Logs permission uses wildcard ARN (should scope to this function's log group)
//   3. No dead letter queue — failed invocations are silently dropped
//   4. Missing required tags on function and role

const lambdaRole = new aws.iam.Role("lambda-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
    }),
    // ISSUE: missing required tags
});

// ISSUE: s3:* on Resource:"*" is far broader than needed — scope to the app's specific bucket
new aws.iam.RolePolicy("lambda-s3-policy", {
    role: lambdaRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: "s3:*", Resource: "*" }],
    }),
});

// ISSUE: logs wildcard grants access to every log group in the account
new aws.iam.RolePolicy("lambda-logs-policy", {
    role: lambdaRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: "arn:aws:logs:*:*:*",
        }],
    }),
});

const lambdaFn = new aws.lambda.Function("api", {
    runtime: "nodejs18.x",
    code: new pulumi.asset.AssetArchive({
        "index.js": new pulumi.asset.StringAsset(
            \`exports.handler = async (event) => ({
  statusCode: 200,
  body: JSON.stringify({ message: "Hello from the workshop API!" }),
});\`
        ),
    }),
    handler: "index.handler",
    role: lambdaRole.arn,
    // ISSUE: no deadLetterConfig — failed async invocations are silently dropped
    // ISSUE: missing required tags (Environment, Owner, Project)
});

const api = new aws.apigateway.RestApi("api", {
    description: "Workshop Lambda API",
    // ISSUE: missing required tags
});

export const functionArn = lambdaFn.arn;
export const apiId = api.id;
`,
  },
  {
    slug: "rds-database",
    description: "RDS PostgreSQL database — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// CONTAINS INTENTIONAL SECURITY ISSUES FOR WORKSHOP TRAINING
// Issues to find:
//   1. Security group allows inbound Postgres (5432) from 0.0.0.0/0
//   2. Storage encryption disabled
//   3. Automated backups disabled (backupRetentionPeriod: 0)
//   4. Deletion protection disabled
//   5. Missing required tags on security group and DB instance

const config = new pulumi.Config();
const dbPassword = config.requireSecret("dbPassword");

// ISSUE: port 5432 open to the entire internet — should restrict to app-server CIDR only
const dbSg = new aws.ec2.SecurityGroup("db-sg", {
    description: "Database security group",
    ingress: [{
        protocol: "tcp",
        fromPort: 5432,
        toPort: 5432,
        cidrBlocks: ["0.0.0.0/0"],   // ISSUE: overly permissive firewall rule
        description: "PostgreSQL",
    }],
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
    // ISSUE: missing required tags
});

const db = new aws.rds.Instance("app-db", {
    engine: "postgres",
    engineVersion: "14",
    instanceClass: "db.t3.micro",
    allocatedStorage: 20,
    dbName: "appdb",
    username: "dbadmin",
    password: dbPassword,
    vpcSecurityGroupIds: [dbSg.id],
    storageEncrypted: false,       // ISSUE: encryption at rest disabled
    backupRetentionPeriod: 0,      // ISSUE: no automated backups
    deletionProtection: false,     // ISSUE: database can be deleted without protection
    skipFinalSnapshot: true,
    // ISSUE: missing required tags (Environment, Owner, Project)
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

// CONTAINS INTENTIONAL SECURITY ISSUES FOR WORKSHOP TRAINING
// Issues to find:
//   1. Security group allows SSH (port 22) from 0.0.0.0/0
//   2. IMDSv2 not enforced (httpTokens: "optional")
//   3. Root EBS volume not encrypted
//   4. Incomplete tagging — missing Environment, Owner, Project

// ISSUE: SSH open to the public internet — restrict to a bastion CIDR or remove
const webSg = new aws.ec2.SecurityGroup("web-sg", {
    description: "Web server security group",
    ingress: [
        { protocol: "tcp", fromPort: 80,  toPort: 80,  cidrBlocks: ["0.0.0.0/0"], description: "HTTP" },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], description: "HTTPS" },
        { protocol: "tcp", fromPort: 22,  toPort: 22,  cidrBlocks: ["0.0.0.0/0"], description: "SSH" },  // ISSUE
    ],
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
    // ISSUE: missing required tags
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
        httpTokens: "optional",  // ISSUE: IMDSv2 not enforced — should be "required"
    },
    rootBlockDevice: {
        volumeSize: 20,
        encrypted: false,        // ISSUE: root volume encryption disabled
    },
    tags: {
        Name: "workshop-web-server",
        // ISSUE: missing required tags (Environment, Owner, Project)
    },
});

export const instanceId = instance.id;
export const publicIp = instance.publicIp;
export const publicDns = instance.publicDns;
`,
  },
  {
    slug: "iam-policies",
    description: "EC2 application role — workshop training stack",
    indexTs: `import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// CONTAINS INTENTIONAL SECURITY ISSUES FOR WORKSHOP TRAINING
// Issues to find:
//   1. Instance role grants s3:* on all resources (should be specific bucket + prefix)
//   2. Unnecessary ec2:Describe* permission granted to a web application
//   3. No permissions boundary on the role
//   4. Missing required tags on role and instance profile

// EC2 instance role for the workshop web application
const appRole = new aws.iam.Role("app-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Service: "ec2.amazonaws.com" },
            Action: "sts:AssumeRole",
        }],
    }),
    description: "Instance role for the workshop web application",
    // ISSUE: no permissionsBoundary — role could be abused to escalate privileges
    // ISSUE: missing required tags
});

// ISSUE: s3:* on Resource:"*" — app only needs GetObject/PutObject on one bucket prefix
new aws.iam.RolePolicy("app-s3-policy", {
    role: appRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: "s3:*",
            Resource: "*",   // ISSUE: should be arn:aws:s3:::my-app-bucket/uploads/*
        }],
    }),
});

// ISSUE: web application has no reason to describe EC2 resources
new aws.iam.RolePolicy("app-ec2-policy", {
    role: appRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: "ec2:Describe*",
            Resource: "*",
        }],
    }),
});

const instanceProfile = new aws.iam.InstanceProfile("app-profile", {
    role: appRole.name,
    // ISSUE: missing required tags
});

export const appRoleArn = appRole.arn;
export const instanceProfileArn = instanceProfile.arn;
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
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

${projects
  .map(
    (p) => `${p.slug}-preview:
  <<: *pulumi_preview
  variables:
    PROJECT_DIR: projects/${p.slug}
    PULUMI_PROJECT: ${p.slug}`,
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
  const repoArgs: gitlab.ProjectArgs = {
    name: "policy-training-workshop",
    description:
      "Workshop source code with intentional AWS security issues for policy-as-code training",
    defaultBranch: "main",
    initializeWithReadme: true,
    visibilityLevel: "private",
  };
  if (gitlabNamespaceId !== undefined) {
    repoArgs.namespaceId = gitlabNamespaceId;
  }

  const repo = new gitlab.Project("workshop-repo", repoArgs);
  gitlabProjectId = repo.id;
  gitlabRepoUrl = repo.httpUrlToRepo;

  new gitlab.RepositoryFile("ci-file", {
    project: gitlabProjectId,
    filePath: ".gitlab-ci.yml",
    branch: "main",
    content: b64(ciYml),
    commitMessage: "feat: add GitLab CI/CD pipeline for Pulumi previews",
    encoding: "base64",
    authorName: "Pulumi Workshop",
    authorEmail: "workshop@pulumi.com",
  }, { dependsOn: repo });

  for (const proj of projects) {
    const prefix = `projects/${proj.slug}`;
    const opts = { dependsOn: repo };

    new gitlab.RepositoryFile(`${proj.slug}-pulumiyaml`, {
      project: gitlabProjectId,
      filePath: `${prefix}/Pulumi.yaml`,
      branch: "main",
      content: b64(makePulumiYaml(proj.slug, proj.description)),
      commitMessage: `feat: add ${proj.slug} project`,
      encoding: "base64",
      authorName: "Pulumi Workshop",
      authorEmail: "workshop@pulumi.com",
    }, opts);

    new gitlab.RepositoryFile(`${proj.slug}-packagejson`, {
      project: gitlabProjectId,
      filePath: `${prefix}/package.json`,
      branch: "main",
      content: b64(makePackageJson(proj.slug)),
      commitMessage: `feat: add ${proj.slug} package.json`,
      encoding: "base64",
      authorName: "Pulumi Workshop",
      authorEmail: "workshop@pulumi.com",
    }, opts);

    new gitlab.RepositoryFile(`${proj.slug}-tsconfig`, {
      project: gitlabProjectId,
      filePath: `${prefix}/tsconfig.json`,
      branch: "main",
      content: b64(sharedTsconfig),
      commitMessage: `feat: add ${proj.slug} tsconfig.json`,
      encoding: "base64",
      authorName: "Pulumi Workshop",
      authorEmail: "workshop@pulumi.com",
    }, opts);

    new gitlab.RepositoryFile(`${proj.slug}-indexts`, {
      project: gitlabProjectId,
      filePath: `${prefix}/index.ts`,
      branch: "main",
      content: b64(proj.indexTs),
      commitMessage: `feat: add ${proj.slug} Pulumi program`,
      encoding: "base64",
      authorName: "Pulumi Workshop",
      authorEmail: "workshop@pulumi.com",
    }, opts);
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
        Statement: [{
          Effect: "Allow",
          Principal: {
            Federated: `arn:aws:iam::${accountId}:oidc-provider/api.pulumi.com/oidc`,
          },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: { "api.pulumi.com/oidc:aud": organization },
            StringLike: {
              "api.pulumi.com/oidc:sub":
                `pulumi:deploy:org:${organization}:project:*:stack:*:operation:*:scope:write`,
            },
          },
        }],
      }),
    );

  const iamRole = new aws.iam.Role(
    "workshop-deploy-role",
    {
      name: "pulumi-workshop-deploy",
      description: "Least-privilege role for Pulumi Deployments to run workshop stacks",
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
            "s3:CreateBucket", "s3:DeleteBucket", "s3:ListBucket", "s3:ListAllMyBuckets",
            "s3:GetBucketLocation", "s3:GetBucketAcl", "s3:PutBucketAcl",
            "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock",
            "s3:GetBucketWebsite", "s3:PutBucketWebsite", "s3:DeleteBucketWebsite",
            "s3:GetBucketTagging", "s3:PutBucketTagging", "s3:DeleteBucketTagging",
            "s3:GetBucketVersioning", "s3:GetBucketLogging", "s3:GetBucketCORS",
            "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
            "s3:GetBucketOwnershipControls", "s3:PutBucketOwnershipControls",
            "s3:GetBucketObjectLockConfiguration", "s3:GetEncryptionConfiguration",
            "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration",
            "s3:GetAccelerateConfiguration", "s3:GetBucketRequestPayment",
          ],
          // S3 bucket ARNs don't include account ID
          Resource: "arn:aws:s3:::*",
        },
        {
          Sid: "LambdaFunctions",
          Effect: "Allow",
          Action: [
            "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
            "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
            "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy",
            "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags",
            "lambda:PublishVersion", "lambda:GetFunctionCodeSigningConfig",
          ],
          Resource: `arn:aws:lambda:${awsRegion}:${accountId}:function:*`,
        },
        {
          Sid: "ApiGateway",
          Effect: "Allow",
          Action: [
            "apigateway:GET", "apigateway:POST", "apigateway:PUT",
            "apigateway:DELETE", "apigateway:PATCH",
          ],
          // API Gateway ARNs don't include account ID; no resource-level restriction available
          Resource: `arn:aws:apigateway:${awsRegion}::/restapis*`,
        },
        {
          Sid: "RdsInstances",
          Effect: "Allow",
          Action: [
            "rds:CreateDBInstance", "rds:DeleteDBInstance", "rds:DescribeDBInstances",
            "rds:ModifyDBInstance", "rds:AddTagsToResource", "rds:RemoveTagsFromResource",
            "rds:ListTagsForResource", "rds:DescribeDBParameterGroups",
            "rds:DescribeDBSubnetGroups", "rds:DescribeDBEngineVersions",
            "rds:DescribeOrderableDBInstanceOptions", "rds:DescribeDBInstanceAutomatedBackups",
          ],
          Resource: `arn:aws:rds:${awsRegion}:${accountId}:*`,
        },
        {
          Sid: "Ec2DescribeOps",
          Effect: "Allow",
          // Describe actions don't support resource-level restrictions — Resource:"*" required by AWS
          Action: [
            "ec2:DescribeInstances", "ec2:DescribeInstanceAttribute", "ec2:DescribeInstanceStatus",
            "ec2:DescribeInstanceTypes", "ec2:DescribeImages", "ec2:DescribeKeyPairs",
            "ec2:DescribeVpcs", "ec2:DescribeSubnets", "ec2:DescribeAvailabilityZones",
            "ec2:DescribeSecurityGroups", "ec2:DescribeTags",
            "ec2:DescribeNetworkInterfaces", "ec2:DescribeVolumes",
          ],
          Resource: "*",
        },
        {
          Sid: "Ec2InstanceOps",
          Effect: "Allow",
          Action: [
            // RunInstances requires perms on multiple resource types simultaneously
            "ec2:RunInstances",
            "ec2:TerminateInstances", "ec2:StartInstances", "ec2:StopInstances",
            "ec2:ModifyInstanceAttribute", "ec2:ModifyInstanceMetadataOptions",
            "ec2:CreateTags",
          ],
          Resource: [
            `arn:aws:ec2:${awsRegion}:${accountId}:instance/*`,
            `arn:aws:ec2:${awsRegion}::image/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:network-interface/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:security-group/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:subnet/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:volume/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:key-pair/*`,
          ],
        },
        {
          Sid: "Ec2SecurityGroupOps",
          Effect: "Allow",
          Action: [
            "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup",
            "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
            "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
            "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
            "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          ],
          Resource: [
            `arn:aws:ec2:${awsRegion}:${accountId}:security-group/*`,
            `arn:aws:ec2:${awsRegion}:${accountId}:vpc/*`,
          ],
        },
        {
          Sid: "IamRolesAndProfiles",
          Effect: "Allow",
          Action: [
            "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole",
            "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
            "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags",
            "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies",
            "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
            "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:GetInstanceProfile",
            "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
            "iam:TagInstanceProfile", "iam:ListInstanceProfilesForRole",
          ],
          Resource: [
            `arn:aws:iam::${accountId}:role/*`,
            `arn:aws:iam::${accountId}:instance-profile/*`,
          ],
        },
        {
          Sid: "CloudWatchLogsForLambda",
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups",
            "logs:CreateLogStream", "logs:DeleteLogStream", "logs:DescribeLogStreams",
            "logs:PutLogEvents", "logs:GetLogEvents",
            "logs:TagLogGroup", "logs:UntagLogGroup", "logs:ListTagsLogGroup",
            "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource",
          ],
          Resource: [
            `arn:aws:logs:${awsRegion}:${accountId}:log-group:*`,
            `arn:aws:logs:${awsRegion}:${accountId}:log-group:*:log-stream:*`,
          ],
        },
      ],
    })
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
// 🔵 Pulumi Team — Allow Override with Config
// =============================================================================

let participantTeamName: pulumi.Output<string>;

if (existingParticipantTeamName === undefined) {
  const team = new pulumiservice.Team("participants", {
    organizationName: org,
    teamType: "pulumi",
    name: "workshop-participants",
    displayName: "Workshop Participants",
    description: "Policy training workshop participants. Members are added per-user by user-setup.",
    members: [],
  });
  participantTeamName = team.name.apply((n) => n!);
} else {
  participantTeamName = pulumi.output(existingParticipantTeamName);
}

// =============================================================================
// 🔵 Pulumi Organization Role — Allow Override with Config
// Grants workshop participants read access to stacks and ability to open the
// shared AWS ESC environment. Per-stack edit access is enforced via
// TeamStackPermission in policy-training-user-setup, not here.
// =============================================================================

let workshopRoleName: pulumi.Output<string>;

if (existingWorkshopRoleName === undefined) {
  const workshopPermissions = pulumiservice.buildAllowPermissionsOutput({
    permissions: ["stack:read", "environment:open"],
  });
  const orgRole = new pulumiservice.OrganizationRole("workshop-role", {
    organizationName: org,
    name: "workshop-participant",
    description: "Role for policy training workshop participants to access shared resources",
    resourceType: "global",
    permissions: workshopPermissions.permissions,
  });
  workshopRoleName = orgRole.name.apply((n) => n!);
} else {
  workshopRoleName = pulumi.output(existingWorkshopRoleName);
}

// =============================================================================
// 🔵 ESC Environment: AWS Integration — Allow Override with Config
// pulumi.interpolate embeds awsRoleArn (an Output<string>) into the YAML string.
// StringAsset is a data wrapper, not a Pulumi resource.
// =============================================================================

let awsEscEnvironmentName: pulumi.Output<string>;

if (existingAwsEscEnvironment === undefined) {
  const awsEnvYaml = pulumi.interpolate`values:
  aws:
    login:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: ${awsRoleArn}
          sessionName: pulumi-workshop
  environmentVariables:
    AWS_ACCESS_KEY_ID: \${aws.login.accessKeyId}
    AWS_SECRET_ACCESS_KEY: \${aws.login.secretAccessKey}
    AWS_SESSION_TOKEN: \${aws.login.sessionToken}
    AWS_REGION: ${awsRegion}
`.apply((s: string) => new pulumi.asset.StringAsset(s));

  const awsEnv = new pulumiservice.Environment("aws-integration", {
    organization: org,
    name: "workshop-aws-integration",
    yaml: awsEnvYaml,
  });
  awsEscEnvironmentName = awsEnv.name.apply((n) => n!);
} else {
  awsEscEnvironmentName = pulumi.output(existingAwsEscEnvironment);
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

const allowedIpsEnv = new pulumiservice.Environment("allowed-ips", {
  organization: org,
  name: "workshop-allowed-ips",
  yaml: new pulumi.asset.StringAsset(allowedIpsYaml),
});

// =============================================================================
// 🔵 TTL: Destroy this stack after workshopTtlDays (default 21)
// =============================================================================

const workshopDestroyAt = new Date(Date.now() + workshopTtlDays * 86400_000).toISOString();

new pulumiservice.DeploymentSchedule("workshop-ttl", {
  organization: org,
  project: pulumi.getProject(),
  stack: pulumi.getStack(),
  pulumiOperation: "destroy",
  timestamp: workshopDestroyAt,
});

// =============================================================================
// Outputs
// =============================================================================

export const participantTeamNameOut = participantTeamName;
export const workshopRoleNameOut = workshopRoleName;
export { gitlabProjectId, gitlabRepoUrl };
export const awsRoleArnOut = awsRoleArn;
export const awsEscEnvironmentNameOut = awsEscEnvironmentName;
export const allowedIpsEnvironmentName = allowedIpsEnv.name;
export const workshopTtlScheduledDestroyAt = workshopDestroyAt;
