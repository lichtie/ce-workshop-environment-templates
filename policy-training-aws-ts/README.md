# Policy-as-Code Training Workshop (AWS / TypeScript)

This workshop gives participants hands-on experience writing and enforcing Pulumi policies against real AWS infrastructure. It is designed for teams learning how to integrate policy-as-code into their cloud delivery workflow.

---

## Learning objectives

By the end of this workshop, participants will be able to:

- Audit AWS infrastructure for security misconfigurations using Pulumi Insights and policy groups
- Remediate issues in Pulumi TypeScript programs and validate the fix with `pulumi preview`
- Configure managed policy packs and attach them to stacks in both audit and preventative modes
- Write and publish a custom policy pack that enforces organization-specific rules

---

## How the workshop is structured

The workshop uses **two Pulumi programs** that are run in sequence:

```
policy-training-aws-ts/
├── policy-training-workshop-setup/   ← admin runs this once per cohort
└── policy-training-user-setup/       ← admin runs this once per participant
```

### `policy-training-workshop-setup`

Run once by the workshop administrator before participants arrive. Provisions all shared infrastructure:

- A **GitLab repository** containing four Pulumi projects with intentional AWS security issues
- An **AWS OIDC provider and IAM role** so Pulumi Deployments can assume credentials without static keys
- Two **ESC environments** (`policies-workshop` project) — one for AWS credential integration, one for required-IP policy config
- A **Pulumi team** for participant access
- A **self-destruct TTL** so the environment cleans itself up automatically

See [`policy-training-workshop-setup/README.md`](./policy-training-workshop-setup/README.md) for setup instructions.

### `policy-training-user-setup`

Run once per participant (can be scripted for large cohorts). Provisions per-participant resources:

- **4 Pulumi stacks** (one per project), pre-tagged and scoped to the participant
- **Deployment settings** pointing each stack at the participant's folder in the shared GitLab repo
- **Preventative and audit policy groups** pre-wired to all four stacks
- **GitLab repo access** so the participant can push code
- **Per-stack and self-destruct TTLs** that auto-clean after the workshop ends

See [`policy-training-user-setup/README.md`](./policy-training-user-setup/README.md) for admin onboarding guidance.

---

## The four workshop projects

Each project deploys a common AWS workload pattern with intentional misconfigurations for participants to find and fix:

| Project        | Workload       | Key issues                                                                  |
| -------------- | -------------- | --------------------------------------------------------------------------- |
| `s3-website`   | S3 static site | Public-read ACL, no encryption, no versioning, missing tags                 |
| `rds-database` | RDS PostgreSQL | Port 5432 open to internet, no encryption, no backups, missing tags         |
| `ec2-instance` | EC2 web server | SSH open to internet, IMDSv2 optional, unencrypted EBS, missing tags        |
| `waf-config`   | WAF WebACL     | Rules in `COUNT` mode, no rate-based rule, no request logging, missing tags |

---

## Quick start (admin)

```bash
# 1. Set up shared infrastructure
cd policy-training-workshop-setup
npm install
pulumi stack init <cohort-name>
pulumi config set organization <your-pulumi-org>
pulumi config set aws:region <region>
pulumi up

# 2. Note the stack reference for user setup
#    e.g. acme/policy-training-workshop-setup/spring-2025

# 3. Onboard each participant
cd ../policy-training-user-setup
npm install
pulumi stack init <participant-username>
pulumi config set organization <your-pulumi-org>
pulumi config set username <participant-username>
pulumi config set workshopStackRef <org>/policy-training-workshop-setup/<cohort-name>
pulumi up
```

For large cohorts, wrap the user-setup block in a script that iterates over a list of usernames.

---

## Resource naming

All workshop AWS resources use the prefix `policies-wksp-<username>-` (e.g., `policies-wksp-alice-site`). This is intentional — the deploy IAM role's resource policies are scoped to `policies-wksp-*`, preventing participants from touching anything outside the workshop.
