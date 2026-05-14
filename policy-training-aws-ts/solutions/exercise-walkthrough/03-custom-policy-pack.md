# 03 — Writing a Custom Policy Pack

## Step 5 — Scaffold a New Policy Pack

Open an empty folder in VSCode and run:

```bash
pulumi policy new aws-typescript
```

This generates a baseline policy pack with example rules that you can modify. You can reference the completed solution at [`solutions/artifacts/policy-pack/index.ts`](../../artifacts/policy-pack/index.ts) as you work through the steps below.

When you open `index.ts`, update the policy pack name to include your username to avoid conflicts when publishing:

```typescript
new PolicyPack("<yourname>-workshop-policies", {
```

Then upgrade the AWS types to the latest version:

```bash
npm install @pulumi/aws@latest
```

---

## Step 6 — Write the Policies

You'll write two policies: one **resource-level** (evaluated once per matching resource) and one **stack-level** (evaluated across all resources together).

### Policy 1 — Security Group Required CIDRs (resource-level)

Checks every `aws.ec2.SecurityGroup` and reports a violation if any CIDR from `requiredCidrBlocks` is **missing** from the ingress rules. The required list is passed as policy pack configuration, which you'll wire to the ESC environment in the next step.

```typescript
validateResource: validateResourceOfType(aws.ec2.SecurityGroup, (sg, args, reportViolation) => {
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
            reportViolation(`Security group ingress rules are missing required CIDR "${requiredCidr}".`);
        }
    }
}),
```

### Policy 2 — S3 Public Bucket Requires TLS Policy (stack-level)

A stack-level policy can see all resources at once, which lets you enforce relationships between them. This policy finds every S3 bucket with a `public-read` ACL and checks that a corresponding `BucketPolicy` exists with a `Deny` statement for non-TLS requests (`aws:SecureTransport: false`).

```typescript
validateStack: (args, reportViolation) => {
    const publicAclBucketIds = args.resources
        .filter(r => r.type === "aws:s3/bucketAclV2:BucketAclV2" && r.props["acl"] === "public-read")
        .map(r => r.props["bucket"] as string);

    if (publicAclBucketIds.length === 0) return;

    const bucketPolicies = args.resources
        .filter(r => r.type === "aws:s3/bucketPolicy:BucketPolicy");

    for (const bucketId of publicAclBucketIds) {
        const bucketPolicy = bucketPolicies.find(p => p.props["bucket"] === bucketId);

        if (!bucketPolicy) {
            reportViolation(`S3 bucket "${bucketId}" has a public-read ACL but no bucket policy enforcing TLS.`);
            continue;
        }

        const policyDoc = JSON.parse(bucketPolicy.props["policy"]);
        const hasTlsDeny = (policyDoc.Statement ?? []).some((s: any) =>
            s.Effect === "Deny" && s.Condition?.Bool?.["aws:SecureTransport"] === "false"
        );

        if (!hasTlsDeny) {
            reportViolation(`S3 bucket "${bucketId}" has a public-read ACL but its bucket policy does not deny non-TLS requests.`);
        }
    }
},
```

See the full implementation in [`solutions/artifacts/policy-pack/index.ts`](../../artifacts/policy-pack/index.ts).

---

## Step 7 — Publish the Policy Pack

From your policy pack directory, run:

```bash
pulumi policy publish <your-org>
```

This uploads your pack to Pulumi Cloud and makes it available to attach to policy groups. Each publish creates a new version — you'll see it listed under **Policies** in the console.

---

**Previous:** [02 — Preventative Policy Setup](02-preventative-policy-setup.md)
