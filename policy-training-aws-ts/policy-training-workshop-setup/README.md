# policy-training-workshop-setup

This Pulumi program provisions the **shared infrastructure** for a policy-as-code training workshop. Run it once before participants arrive. It creates the GitLab repository, AWS IAM role, ESC environments, and Pulumi Cloud team that every participant will use.

---

## When to use this

Run `policy-training-workshop-setup` once per workshop cohort. After it completes, run [`policy-training-user-setup`](../policy-training-user-setup/README.md) once for each participant.

---

## Prerequisites

| Requirement         | Notes                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Pulumi CLI          | Authenticated to your Pulumi Cloud org                                     |
| AWS credentials     | Must have IAM and OIDC management permissions in the target account        |
| GitLab token        | Set via `GITLAB_TOKEN` env var or `gitlab:token` config; needs `api` scope |
| `aws:region` config | Set via `pulumi config set aws:region <region>`                            |

---

## Configuration

### Required

| Key            | Description                    |
| -------------- | ------------------------------ |
| `organization` | Pulumi Cloud organization name |
| `aws:region`   | AWS region to deploy into      |

### Optional overrides

If any of these are set, the corresponding resource is **skipped** and the provided value is used instead. Useful for re-running against an existing environment.

| Key                           | Skips                                      | Default behavior                              |
| ----------------------------- | ------------------------------------------ | --------------------------------------------- |
| `existingGitlabProjectId`     | GitLab repo + all file resources           | Create a new `policy-training-workshop` repo  |
| `existingGitlabRepoUrl`       | (used alongside `existingGitlabProjectId`) | Read from new repo                            |
| `existingAwsRoleArn`          | IAM role + inline policy + OIDC provider   | Create a new OIDC-trust role                  |
| `existingOidcProviderArn`     | OIDC provider only (role still created)    | Create `https://api.pulumi.com/oidc` provider |
| `existingAwsEscEnvironment`   | AWS ESC environment                        | Create `workshop-aws-integration`             |
| `existingParticipantTeamName` | Pulumi team                                | Create `workshop-participants`                |
| `existingWorkshopRoleName`    | Pulumi org role                            | Create `workshop-participant` role            |
| `workshopTtlDays`             | —                                          | `21` — days until this stack self-destructs   |

### Other optional

| Key                 | Description                                                 | Default                 |
| ------------------- | ----------------------------------------------------------- | ----------------------- |
| `allowedIps`        | JSON array of CIDRs added to `workshop-allowed-ips` ESC env | `[]`                    |
| `gitlabNamespaceId` | Numeric GitLab group/namespace ID for the new repo          | Token owner's namespace |

---

## What gets deployed

### GitLab

- **Repository** — `policy-training-workshop` (private), initialized with a README
- **4 project folders** — `projects/s3-website`, `projects/rds-database`, `projects/ec2-instance`, `projects/waf-config`; each contains a self-contained Pulumi program (`Pulumi.yaml`, `package.json`, `tsconfig.json`, `index.ts`) with intentional AWS security issues
- **CI pipeline** — `.gitlab-ci.yml` that runs `pulumi preview` on every merge request

### AWS

- **OIDC provider** — registers `https://api.pulumi.com/oidc` in IAM (find-or-create)
- **IAM role** — `pulumi-workshop-deploy`; trusted by Pulumi Deployments via OIDC; scoped to `wksp-*` resources in the target account

### Pulumi Cloud

- **Team** — `workshop-participants` (members added per-user by `user-setup`)
- **Org role** — `workshop-participant`; grants `stack:read` and `environment:open`
- **ESC environment** — `workshop-aws-integration`; opens the IAM role via OIDC for Pulumi Deployments
- **ESC environment** — `workshop-allowed-ips`; holds the `allowedCidrBlocks` config used by custom policies
- **TTL schedule** — destroys this stack `workshopTtlDays` days from now

### Workshop projects (deployed by participants)

Each sub-project contains intentional AWS misconfigurations for participants to find and remediate using Pulumi policies:

| Project        | Key issues                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `s3-website`   | Public-read ACL, all public-access-block controls disabled, no encryption, no versioning, incomplete tagging               |
| `rds-database` | Port 5432 open to `0.0.0.0/0`, storage encryption disabled, no automated backups, no deletion protection, missing tags     |
| `ec2-instance` | SSH open to `0.0.0.0/0`, IMDSv2 not enforced, root EBS unencrypted, missing tags                                           |
| `waf-config` | WAF rules in `COUNT` mode (no blocking), no rate-based rule, no WAF request logging, no permissions boundary, missing tags |

---

## Deploying

```bash
cd policy-training-workshop-setup
npm install
pulumi stack init <your-stack-name>
pulumi config set organization <your-pulumi-org>
pulumi config set aws:region <region>
pulumi up
```

Note the outputs — you'll need `workshopStackRef` when running `user-setup`:

```
workshopStackRef = "<org>/policy-training-workshop-setup/<stack-name>"
```

---

## Per-participant setup

After this stack is up, run `user-setup` once per participant:

```bash
cd ../policy-training-user-setup
pulumi stack init <username>
pulumi config set organization <your-pulumi-org>
pulumi config set username <participant-pulumi-username>
pulumi config set workshopStackRef <org>/policy-training-workshop-setup/<stack-name>
pulumi up
```

See the [user-setup README](../policy-training-user-setup/README.md) for the full list of per-user config options.

---

## Cleanup

This stack schedules its own destruction `workshopTtlDays` days after deploy. Per-user stacks are similarly auto-destroyed 18 days after creation (configurable in `user-setup`).

To destroy manually before the TTL fires:

```bash
pulumi destroy
```
