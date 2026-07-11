# Harness Guardrails

These are durable directives for the harness itself.

## How to Use This File

Write short, concrete rules here when they should shape future agent behavior. Mark each guardrail `active` or `superseded`.

Use the CLI when recording durable guardrails during work:

```bash
scripts/bin/harness-cli guardrail add --guardrail "<rule>" --why "<reason>"
scripts/bin/harness-cli guardrail list --active
scripts/bin/harness-cli query guardrails
```

`scripts/bin/harness-cli import brownfield` and `guardrail import` read the table below.

## Active Guardrails

| Status | Guardrail | Why it exists |
| --- | --- | --- |
| active | Opinionated, not bureaucratic | The framework should constrain agent behavior without adding ceremony for its own sake. |
| active | Contract-aware | Preserve relevant contracts and make proof explicit; add durable records only when they are useful. |
| active | Minimal core | Prefer a small set of primitives over a new artifact type for each use case. |
| active | Flat-first structure | Root + one nested group is the normal band; deeper trees are exceptional. |
| active | CLI-aware | Markdown contracts and durable CLI state must agree. |
| active | Harness-first edits | Changes in this repo adjust the framework itself, not a consumer workflow. |
| active | Escalate only when needed | Large, risky, or read-heavy work can expand into checklist, findings, tasks, and evidence inside the same packet. |
| active | Fresh durable evidence | When intake or trace records are useful, they describe the current task rather than stale state. |
| active | Proof before behavioral claims | Agents should only claim behavior works when validation evidence supports it; otherwise report the behavior as unverified, skipped, partial, or failing. |
| active | Useful friction signal | When a trace supports failure attribution, name concrete recurring friction rather than adding generic detail. |
| active | High-risk evidence without ceremony | High-risk work needs explicit design and validation evidence, but full high-risk folders are for broad work, not ceremony for its own sake. |

## Record Format

```md
- Date:
- Source:
- Guardrail:
- Status:
- Notes:
```