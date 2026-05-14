# policy-training-user-setup

Provisions **per-participant resources** for a policy-as-code training workshop. Run once per participant after `policy-training-workshop-setup` is deployed.

---

## Prerequisites

- `policy-training-workshop-setup` is deployed and you have its stack reference
- The participant has a Pulumi Cloud account in your org
- The participant has a GitLab account (numeric user ID needed for repo access)

---

## Configuration

### Required

| Key                | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| `username`         | Participant's Pulumi Cloud username                                                     |
| `workshopStackRef` | Stack reference to the setup stack: `<org>/policy-training-workshop-setup/<stack-name>` |

### Optional

| Key                       | Description                                                          | Default |
| ------------------------- | -------------------------------------------------------------------- | ------- |
| `gitlabUserId`            | Participant's numeric GitLab user ID; skips repo membership if unset | —       |
| `stackTtlDays`            | Days until each participant stack self-destructs                     | `14`    |
| `parentStackTtlDays`      | Days until this user-setup stack self-destructs                      | `18`    |
| `extraStackTags`          | JSON object of additional tags to apply to all participant stacks    | `{}`    |
| `existingCustomRoleName`  | Skip role creation and use this existing role name instead           | —       |
| `existingGitlabProjectId` | Override the GitLab project ID from the workshop stack reference     | —       |

---

## What gets deployed

### Pulumi Cloud

- **Team** — `<username>-team`; scoped team used for all permission assignments
- **4 stacks** — one per workshop project (`s3-website`, `rds-database`, `ec2-instance`, `waf-config`), named after the participant
- **Stack tags** — `user: <username>`, `wksp: policies-training` on all stacks
- **Stack permissions** — `edit` access on all four stacks via `TeamStackPermission`
- **Environment permission** — `open` access on the shared `policies-wksp-aws-integration` ESC environment
- **Deployment settings** — each stack wired to the correct project folder in the GitLab repo, pulling credentials from the AWS ESC environment
- **Policy groups** — preventative and audit policy groups pre-attached to all four stacks
- **TTL schedules** — stacks auto-destroy after `stackTtlDays`; this setup stack auto-destroys after `parentStackTtlDays`

### GitLab

- **Repo membership** — participant added as Developer to the workshop repo (requires `gitlabUserId`)

---

## Deploying

```bash
cd policy-training-user-setup
npm install
pulumi stack init <username>
pulumi config set username <participant-pulumi-username>
pulumi config set workshopStackRef <org>/policy-training-workshop-setup/<cohort-name>
pulumi config set gitlabUserId <participant-gitlab-numeric-id>
pulumi up
```

### Finding a participant's GitLab user ID

```bash
curl --header "PRIVATE-TOKEN: <your-gitlab-token>" \
  "https://gitlab.com/api/v4/users?username=<gitlab-username>" | jq '.[0].id'
```

---

## Scripting for large cohorts

```bash
for username in alice bob carol; do
  pulumi stack init $username
  pulumi config set username $username
  pulumi config set workshopStackRef <org>/policy-training-workshop-setup/<cohort-name>
  pulumi up --yes
done
```

---

## Cleanup

Each stack TTL fires automatically. To destroy a participant's resources early:

```bash
pulumi stack select <username>
pulumi destroy
```
