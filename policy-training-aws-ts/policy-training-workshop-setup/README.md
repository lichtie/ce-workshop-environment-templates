# policy-training-workshop-setup

Provisions the **shared infrastructure** for a policy-as-code training workshop. Run once per cohort before participants arrive, then run `policy-training-user-setup` once per participant.

---

## Prerequisites

| Requirement     | Notes                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| Pulumi CLI      | Authenticated to your Pulumi Cloud org                                       |
| AWS credentials | Must have IAM and OIDC management permissions in the target account          |
| GitLab token    | Set via `pulumi config set --secret gitlab:token <token>`; needs `api` scope |

---

## Configuration

### Required

| Key                 | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `aws:region`        | AWS region to deploy into                                     |
| `gitlab:token`      | GitLab personal access token with `api` scope (set as secret) |
| `gitlabGroupPath`   | Full path of the GitLab group to create the workshop repo in  |
| `pulumiAccessToken` | Pulumi Cloud access token (used by the ESC tag hook)          |

### Optional

| Key               | Description                                                          | Default |
| ----------------- | -------------------------------------------------------------------- | ------- |
| `allowedIps`      | JSON array of CIDRs added to the `policies-wksp-allowed-ips` ESC env | `[]`    |
| `workshopTtlDays` | Days until this stack self-destructs                                 | `21`    |

### Override inputs

Set these to skip creating the corresponding resource and use an existing one instead.

| Key                             | Skips                                      |
| ------------------------------- | ------------------------------------------ |
| `existingGitlabProjectId`       | GitLab repo + all file resources           |
| `existingGitlabRepoUrl`         | Used alongside `existingGitlabProjectId`   |
| `existingOidcProviderArn`       | OIDC provider (IAM role still created)     |
| `existingAwsRoleArn`            | IAM role, inline policy, and OIDC provider |
| `existingAwsEscEnvironmentName` | AWS ESC environment                        |

---

## What gets deployed

### GitLab

- **GitLab repository** — `policy-training-workshop` (private) under the specified group
- **4 project folders** — `projects/s3-website`, `projects/rds-database`, `projects/ec2-instance`, `projects/waf-config`; each is a complete Pulumi TypeScript program with intentional AWS security issues
- **CI pipeline** — `.gitlab-ci.yml` runs `pulumi preview` on merge requests, but only for folders that changed

### AWS

- **OIDC provider** — registers `https://api.pulumi.com/oidc` in IAM (thumbprint fetched automatically)
- **IAM role** — `policies-wksp-deploy`; trusted by Pulumi Deployments via OIDC; scoped to `policies-wksp-*` resources

### Pulumi Cloud

- **Team** — `policies-wksp-participants` (members added per-user by `user-setup`)
- **ESC environment** — `policies-workshop/policies-wksp-aws-integration`; vends short-lived AWS credentials via OIDC
- **ESC environment** — `policies-workshop/policies-wksp-allowed-ips`; holds `allowedCidrBlocks` config consumed by custom policies
- **TTL self-destruct** — scheduled destroy `workshopTtlDays` days after deploy

---

## Deploying

```bash
cd policy-training-workshop-setup
npm install
pulumi stack init <cohort-name>
pulumi config set aws:region <region>
pulumi config set gitlabGroupPath <gitlab-group-path>
pulumi config set --secret gitlab:token <gitlab-token>
pulumi config set --secret pulumiAccessToken <pulumi-token>
pulumi up
```

Note the stack outputs — you'll need them for `user-setup`:

```
gitlabProjectId        = "12345678"
gitlabRepoUrl          = "https://gitlab.com/lichtie-group/policy-training-workshop.git"
awsEscEnvironmentName  = "policies-wksp-aws-integration"
participantTeamNameOut = "policies-wksp-participants"
```

---

## Per-participant onboarding

After this stack is up, run `user-setup` once per participant:

```bash
cd ../policy-training-user-setup
npm install
pulumi stack init <username>
pulumi config set username <participant-pulumi-username>
pulumi config set workshopStackRef <org>/policy-training-workshop-setup/<cohort-name>
pulumi config set gitlabUserId <participant-gitlab-numeric-id>
pulumi up
```

For large cohorts, wrap this in a script that iterates over a participant list.

---

## Cleanup

This stack schedules its own destruction automatically. To destroy early:

```bash
pulumi destroy
```
