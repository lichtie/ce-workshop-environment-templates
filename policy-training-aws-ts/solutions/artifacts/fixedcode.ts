import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const prefix = `policies-wksp-${pulumi.getStack()}`;

// --- S3: static asset bucket ---
const assetBucket = new aws.s3.BucketV2("assets", {
  bucket: `${prefix}-assets`,
  tags: { Name: `${prefix}-assets` },
});

const assetsOwnership = new aws.s3.BucketOwnershipControls("assets-ownership", {
  bucket: assetBucket.id,
  rule: { objectOwnership: "ObjectWriter" },
});

const assetsPab = new aws.s3.BucketPublicAccessBlock(
  "assets-pab",
  {
    bucket: assetBucket.id,
    blockPublicAcls: false,
    blockPublicPolicy: false,
    ignorePublicAcls: false,
    restrictPublicBuckets: false,
  },
  { dependsOn: [assetsOwnership] },
);

new aws.s3.BucketAclV2(
  "assets-acl",
  {
    bucket: assetBucket.id,
    acl: "public-read",
  },
  { dependsOn: [assetsOwnership, assetsPab] },
);

// S3 server-side encryption configuration
new aws.s3.BucketServerSideEncryptionConfiguration("assets-encryption", {
  bucket: assetBucket.id,
  rules: [
    {
      applyServerSideEncryptionByDefault: {
        sseAlgorithm: "AES256",
      },
    },
  ],
});

// S3 bucket versioning
new aws.s3.BucketVersioning("assets-versioning", {
  bucket: assetBucket.id,
  versioningConfiguration: {
    status: "Enabled",
  },
});

// S3 bucket policy enforcing TLS for public-read bucket (excludes Macie service role)
new aws.s3.BucketPolicy("assets-tls-policy", {
  bucket: assetBucket.id,
  policy: assetBucket.arn.apply((arn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "DenyNonTLS",
          Effect: "Deny",
          Principal: "*",
          Action: "s3:*",
          Resource: [arn, `${arn}/*`],
          Condition: {
            Bool: { "aws:SecureTransport": "false" },
            StringNotEquals: {
              "aws:PrincipalServiceName": "macie.amazonaws.com",
            },
          },
        },
      ],
    }),
  ),
});

// --- Security Group ---
const appSg = new aws.ec2.SecurityGroup("app-sg", {
  name: `${prefix}-sg`,
  description: "Application security group",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["73.94.189.142/32"],
      description: "HTTPS",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["73.94.189.142/32"],
      description: "All outbound",
    },
  ],
  tags: {
    Name: `${prefix}-sg`,
    Environment: "dev",
    user: "elisabeth",
    wksp: "policy-training",
  },
});

// --- EC2: web server ---
const ami = aws.ec2.getAmiOutput({
  mostRecent: true,
  owners: ["amazon"],
  filters: [{ name: "name", values: ["al2023-ami-*-x86_64"] }],
});

const instance = new aws.ec2.Instance("web-server", {
  ami: ami.id,
  instanceType: "t3.micro",
  associatePublicIpAddress: false,
  vpcSecurityGroupIds: [appSg.id],
  metadataOptions: {
    httpEndpoint: "enabled",
    httpTokens: "optional",
  },
  rootBlockDevice: {
    volumeSize: 20,
    encrypted: true,
  },
  tags: {
    Name: `${prefix}-web`,
    Environment: "dev",
    user: "elisabeth",
    wksp: "policy-training",
  },
});

export const bucketName = assetBucket.bucket;
export const instanceId = instance.id;
export const publicIp = instance.publicIp;
