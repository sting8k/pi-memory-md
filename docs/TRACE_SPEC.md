# Trace Specification

A trace is an optional durable execution record. Use one when later review needs evidence, failure attribution, benchmark or release context, or a handoff that cannot be reconstructed cheaply from the repository.

Do not record a trace solely because a file changed. Do not copy the git diff, raw test log, or user request into fields unless that context is needed to interpret the outcome.

The current schema lives in `scripts/schema/001-init.sql` under the `trace` table.

## When to Record

A trace is useful when:

- work spans sessions or actors;
- an error, blocker, skipped proof, or harness friction should persist;
- high-risk work needs reviewable execution evidence;
- benchmark or release analysis needs comparable metadata;
- a linked work packet needs a durable outcome.

For routine narrow work, focused verification and a concise final report are enough.

## Evidence First

A useful trace answers:

- What outcome was attempted?
- What evidence supports the reported result?
- What failed, was skipped, or remains uncertain?
- What context would a future reviewer otherwise lose?

Trace completeness is not proof of code quality. The CLI score measures metadata completeness; behavioral claims still depend on executable evidence and review.

## Field Reference

| Field | Required by schema/CLI | Use |
| --- | --- | --- |
| `id`, `created_at` | Automatic | Durable identity and timestamp. |
| `task_summary` | Yes | One sentence naming the attempted outcome. |
| `outcome` | Yes | `completed`, `blocked`, `partial`, or `failed`. |
| `intake_id` | No | Link when a durable intake exists. |
| `story_id` | No | Link when one work packet owns the work. |
| `agent` | No | Identify the agent/tool when useful for analysis. |
| `actions_taken` | No | Include only actions needed to explain the outcome. |
| `files_read` | No | Include sources whose role would not be obvious later. |
| `files_changed` | No | Include when durable review needs the set; otherwise the repository already records it. |
| `decisions_made` | No | Summarize consequential choices; this does not replace a durable decision record. |
| `errors` | No | Name blockers, failed checks, or important recovery steps. |
| `duration_seconds`, `token_estimate` | No | Add only for measurement that will actually be used. |
| `harness_friction` | No | Record concrete recurring or attributable harness pain. |
| `notes` | No | Add review context that does not fit elsewhere. |

The CLI accepts comma-separated values for list-like fields and stores JSON text. Use `none` only where the current CLI or a chosen completeness tier requires an explicit empty value; do not manufacture detail.

## Completeness Tiers

Tiers describe metadata depth, not task quality or mandatory workflow.

### Minimal

```text
task_summary + outcome
```

Use when a durable marker is useful but extra metadata would add little.

### Standard

Add the links, actions, evidence pointers, errors, or friction needed for review or handoff. Omit fields that merely repeat repository state.

### Detailed

Use for high-risk review, benchmark/release analysis, or complex failure attribution when duration, decisions, errors, and explicit gaps will be examined later. Detailed does not mean every field must contain invented content.

## Recording Examples

Minimal durable outcome:

```bash
scripts/bin/harness-cli trace \
  --summary "Updated the bounded validation contract" \
  --outcome completed
```

Evidence-focused trace:

```bash
scripts/bin/harness-cli trace \
  --summary "Preserved role scope during the authorization migration" \
  --story US-014 \
  --agent codex \
  --outcome partial \
  --actions "updated role mapping,ran focused authorization tests" \
  --read "docs/product/permissions.md,docs/decisions/0008-auth-boundary.md" \
  --changed "src/auth/roles.ts,tests/auth-roles.test.ts" \
  --errors "cross-tenant integration environment unavailable" \
  --friction "none" \
  --notes "Focused tests passed; cross-tenant integration remains unverified."
```

## Proof and Claims

Match the outcome to the evidence:

- `completed`: the requested outcome is supported by the stated proof;
- `partial`: useful work landed but part of the outcome remains unverified or unfinished;
- `blocked`: an external dependency or decision prevents progress;
- `failed`: the attempted change or proof did not succeed.

If proof was skipped, unavailable, too expensive, or failing, record that directly. A high CLI trace score must never be used as evidence that behavior works.

## Friction

Record friction when the task exposes a recurring missing rule, stale source of truth, unclear validation path, or repeated manual step. Name the concrete pain and shared seam. Add a backlog item only when follow-up is worthwhile and out of scope. One-off inconvenience does not need permanent workflow.
