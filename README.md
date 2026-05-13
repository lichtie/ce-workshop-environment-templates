# ce-workshop-environment-templates

This repository contains the infrastructure templates that power Pulumi CE workshop environments. Each subdirectory is a self-contained workshop, typically consisting of one or more Pulumi programs that an admin runs to stand up a training environment.

---

## Repository structure

```
ce-workshop-environment-templates/
└── policy-training-aws-ts/          # Policy-as-code workshop (AWS / TypeScript)
    ├── policy-training-workshop-setup/
    └── policy-training-user-setup/
```

Each workshop directory follows the same pattern:

| Directory          | Purpose                            | Run by            | Frequency            |
| ------------------ | ---------------------------------- | ----------------- | -------------------- |
| `*-workshop-setup` | Shared infrastructure for a cohort | Admin             | Once per cohort      |
| `*-user-setup`     | Per-participant resources          | Admin (or script) | Once per participant |

---

## Workshops

### [`policy-training-aws-ts`](./policy-training-aws-ts/README.md)

Policy-as-code training using AWS and TypeScript. Participants audit and remediate intentional misconfigurations across five AWS workloads, then write and publish custom Pulumi policy packs.

---

## Adding a new workshop

1. Create a new directory at the top level: `<topic>-<cloud>-<language>/`
2. Inside it, add at minimum a `*-workshop-setup/` program and a `*-user-setup/` program
3. Follow the conventions below
4. Add an entry to the table in this README

### Conventions

**Naming**

- Workshop-specific AWS resources should use a consistent prefix (e.g., `wksp-`) so IAM resource policies can be scoped without wildcarding the entire account
- Pulumi stack names equal the participant username in user-setup programs — this flows through to AWS resource names via `pulumi.getStack()`

**TTLs**

- Use `pulumiservice.DeploymentSchedule` with `pulumiOperation: "destroy"` to auto-clean both setup stacks and participant stacks
- Workshop setup stacks: default 21 days
- User stacks: 18 days, but be sure to destroy any stacks within them first

**Outputs**

- Workshop-setup programs export everything user-setup needs to read via `StackReference`
- Output names ending in `Out` (e.g., `awsEscEnvironmentNameOut`) indicate values consumed by user-setup
