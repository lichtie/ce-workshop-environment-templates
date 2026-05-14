# Policy-as-Code Workshop — Acceptance Criteria

## Goal

Give participants a working understanding of policy as code. By the end of this workshop you should be able to audit open policy findings in the Pulumi console, remediate issues using Neo or direct code changes, configure managed policy packs, write and publish a custom policy pack.

---

## What You Need to Deliver

### 1. CSV Export of Policy Findings

Export your policy findings from the Pulumi console showing that your policy groups are correctly configured.

**Your CSV must show:**

- Findings from correctly configured managed policy packs — the expected warnings appear for the intentionally misconfigured resources
- Findings from your custom policy pack — your custom rules produce warnings for the issues listed in the [Expected Policy Behavior](#expected-policy-behavior) section below

---

### 2. Clean PRs to the Workshop Repo

Open pull requests in the GitLab workshop repo to fix the security issues in your stacks.

**Your PRs must show:**

- A clean `pulumi preview` (no policy violations) for each fix

---

## Expected Policy Behavior

### Required Tags

All resources must have the following tags:

| Tag Key | Expected Value | Notes        |
| ------- | -------------- | ------------ |
| `user`  | Your username  | e.g. `alice` |
| `wksp`  | policies-wksp  |              |

### Required IP Ranges

Security groups and WAF rules must restrict ingress to the following CIDRs:

```
# Fill in required CIDRs here
# e.g. 10.0.0.0/8
```

Your custom policy pack must enforce this by reading `requiredCidrBlocks` from the ESC environment and validating every security group ingress rule and WAF IP set against the list.

### Managed Pack Configuration

> List the managed policy packs participants should attach, and what configuration values to set:

| Pack                      | Rule          | Expected Setting   |
| ------------------------- | ------------- | ------------------ |
| _(add managed pack name)_ | _(rule name)_ | _(expected value)_ |

### Custom Policy Requirements

> List what custom rules participants must write:

| Rule                | What it checks                              | Enforcement |
| ------------------- | ------------------------------------------- | ----------- |
| Required tags       | Every resource has `user` tag               | warning     |
| Allowed ingress IPs | Every SG and WAF allows only approved CIDRs | mandatory   |
| _(add more)_        |                                             |             |
