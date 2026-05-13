# Policy-as-Code Workshop

Welcome! This workshop gives you hands-on experience finding and fixing real AWS security misconfigurations using Pulumi policies.

You have five Pulumi stacks pre-created for you, each deploying a different piece of AWS infrastructure with intentional security issues baked in. Your job is to find the issues, remediate them in code, and enforce the fixes with policy packs so they can never come back.

---

## What you have access to

- **5 Pulumi stacks** in Pulumi Cloud, one per workshop project
- **GitLab repository** with the source code for all five projects
- **AWS ESC environment** that provides temporary AWS credentials via OIDC — no static keys needed
- **Two policy groups** (preventative and audit mode) pre-wired to all five of your stacks

---

## The four projects

| Project | What it deploys | Issues to find |
|---|---|---|
| `s3-website` | S3 static website | Public-read ACL, public access blocks disabled, no encryption at rest, no versioning, missing required tags |
| `rds-database` | RDS PostgreSQL instance | Port 5432 open to `0.0.0.0/0`, no storage encryption, no automated backups, no deletion protection, missing tags |
| `ec2-instance` | EC2 web server | SSH open to `0.0.0.0/0`, IMDSv2 not enforced, root EBS unencrypted, missing tags |
| `waf-config` | WAF WebACL | Rules in `COUNT` mode (no blocking), no rate-based rule, no WAF request logging, missing tags |

---

## Workshop flow

### 1. Deploy your stacks

Each project needs to be deployed before you can audit it. From the GitLab repo, navigate into any project directory:

```bash
cd projects/s3-website
npm install
pulumi stack select <org>/<project>/<your-username>
pulumi up
```

You can also trigger deployments from Pulumi Cloud via the **Deploy** button on each stack, which uses the pre-configured GitLab integration.

> **rds-database only:** Set the DB password before deploying:
> ```bash
> pulumi config set --secret rds-database:dbPassword <a-password>
> ```

### 2. Audit in Pulumi Cloud

After deploying, open Pulumi Cloud and navigate to your stacks. The **Insights** view will surface policy violations and misconfigurations across your resources. Review the findings for each stack.

### 3. Remediate in code

Open the stack's `index.ts` in the GitLab repo and fix the issues you found. For example, for `s3-website`:

- Set `blockPublicAcls: true` (and the other three PAB flags) on `BucketPublicAccessBlock`
- Remove the `public-read` ACL
- Add a `BucketServerSideEncryptionConfigurationV2` resource
- Add a `BucketVersioningV2` resource
- Add the required tags

Push your changes or open a merge request — the CI pipeline will run `pulumi preview` to show you what would change before you deploy.

### 4. Configure managed policy packs

In Pulumi Cloud, navigate to your **policy groups**. You have two:

- `<username>-preventative` — blocks deployments that violate policies
- `<username>-audit` — flags violations without blocking

Add managed policy packs (e.g., AWS Security, CIS AWS Foundations) to your policy groups and observe how they surface issues across your stacks.

### 5. Write a custom policy

Create a new policy pack that enforces a rule specific to your organization — for example, requiring specific tags on all resources, or blocking security groups that open SSH to `0.0.0.0/0`.

```bash
pulumi policy new aws-typescript
```

Edit the generated `index.ts` to write your rule, then publish and attach it to your policy group:

```bash
pulumi policy publish
```

---

## Useful commands

```bash
# Select your stack
pulumi stack select <org>/<project>/<your-username>

# Preview changes without deploying
pulumi preview --diff

# Deploy
pulumi up

# See current stack outputs
pulumi stack output

# Destroy a stack when done
pulumi destroy
```

---

## Notes

- Your stacks and this setup stack will be automatically destroyed after the workshop. No cleanup needed on your part.
- All AWS resources are prefixed with `wksp-<username>-` and scoped to the workshop IAM role — you won't accidentally affect anything outside the workshop.
- If a `pulumi up` fails, check the error message. Most issues are missing config values or a policy violation catching something intentional.
