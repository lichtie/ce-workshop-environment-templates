import * as aws from "@pulumi/aws";
import {
  PolicyPack,
  PolicyConfigSchema,
  validateResourceOfType,
} from "@pulumi/policy";

interface PolicyConfig {
  requiredCidrBlocks?: string[];
}

const requiredCidrsConfigSchema: PolicyConfigSchema = {
  properties: {
    requiredCidrBlocks: {
      type: "array" as const,
      items: { type: "string" as const },
      default: [],
      description:
        "List of CIDRs that must be present in security group and WAF rules.",
    },
  },
};

new PolicyPack("workshop-policies", {
  policies: [
    // =============================================================================
    // Resource Policy: Security Group ingress must include all required CIDRs
    // =============================================================================
    {
      name: "sg-required-cidrs",
      description:
        "Security group ingress rules must include all CIDRs from the required list.",
      enforcementLevel: "mandatory",
      configSchema: requiredCidrsConfigSchema,
      validateResource: validateResourceOfType(
        aws.ec2.SecurityGroup,
        (sg, args, reportViolation) => {
          const { requiredCidrBlocks = [] } = args.getConfig<PolicyConfig>();
          if (requiredCidrBlocks.length === 0) return;

          const allIngress: string[] = [];
          for (const rule of sg.ingress ?? []) {
            for (const cidr of rule.cidrBlocks ?? []) {
              allIngress.push(cidr);
            }
          }
          for (const requiredCidr of requiredCidrBlocks) {
            if (!allIngress.includes(requiredCidr)) {
              reportViolation(
                `Security group ingress rules are missing required CIDR "${requiredCidr}".`,
              );
            }
          }
        },
      ),
    },

    // =============================================================================
    // Stack Policy: S3 buckets with public ACLs must have a bucket policy enforcing TLS
    // =============================================================================
    {
      name: "s3-public-bucket-requires-tls-policy",
      description:
        "S3 buckets with a public-read ACL must have a bucket policy that denies non-TLS requests.",
      enforcementLevel: "mandatory",
      validateStack: (args, reportViolation) => {
        const publicAclBucketIds = args.resources
          .filter(
            (r) =>
              r.type === "aws:s3/bucketAclV2:BucketAclV2" &&
              r.props["acl"] === "public-read",
          )
          .map((r) => r.props["bucket"] as string);

        if (publicAclBucketIds.length === 0) return;

        const bucketPolicies = args.resources.filter(
          (r) => r.type === "aws:s3/bucketPolicy:BucketPolicy",
        );

        for (const bucketId of publicAclBucketIds) {
          const bucketPolicy = bucketPolicies.find(
            (p) => p.props["bucket"] === bucketId,
          );

          if (!bucketPolicy) {
            reportViolation(
              `S3 bucket "${bucketId}" has a public-read ACL but no bucket policy enforcing TLS.`,
            );
            continue;
          }

          let policyDoc = JSON.parse(bucketPolicy.props["policy"]);

          const hasTlsDeny = (policyDoc.Statement ?? []).some(
            (s: any) =>
              s.Effect === "Deny" &&
              s.Condition?.Bool?.["aws:SecureTransport"] === "false",
          );

          if (!hasTlsDeny) {
            reportViolation(
              `S3 bucket "${bucketId}" has a public-read ACL but its bucket policy does not deny non-TLS requests.`,
            );
          }
        }
      },
    },
  ],
});
