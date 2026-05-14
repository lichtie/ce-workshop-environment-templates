# 03 — Writing a Custom Policy Pack

## Step 5 — Scaffold a New Policy Pack

Open an empty folder in VSCode and run:

```bash
pulumi policy new aws-typescript
```

This generates a baseline policy pack with example rules that you can modify. You can reference the completed solution at [`solutions/artifacts/policy-pack/index.ts`](../../artifacts/policy-pack/index.ts) as you work through the steps below.

Then upgrade the AWS types to the latest version:

```bash
npm install @pulumi/aws@latest
```

---

**Previous:** [02 — Preventative Policy Setup](02-preventative-policy-setup.md)
