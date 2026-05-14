# 06 — Remediation

## Step 11 — Select Your Findings

You can remediate policy violations manually by updating your code, or let Neo do it for you. This walkthrough uses Neo.

Navigate to **Policies → Findings → Issues** and filter by your stack name as before. Select all the findings for your stack — click the first row, then hold **Shift** and click the last row to select everything at once.

![All findings selected](images/26-select-all-findings.png)

Click the **Remediate** button in the top right to kick off a Neo task. Neo will analyze the findings and generate code changes to fix the violations.

Neo will open a pull request on a branch named **`<yourname>-<somestring>`** — for example, `alice-fix-sg-rules`. The CI pipeline is configured to derive your stack name from the branch prefix, so as long as your branch starts with your username followed by a `-`, the preview will run against the correct stack automatically.

---

**Previous:** [05 — Exporting Findings](05-exporting-findings.md)
