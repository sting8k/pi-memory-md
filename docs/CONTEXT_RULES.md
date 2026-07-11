# Context Retrieval

Load the smallest context that supports the current decision. Start with the request, the affected source, and its nearby contract. Retrieve policy, history, and templates only when a trigger makes them relevant.

Context is progressive:

```text
Locate the affected surface
  -> read its contract and adjacent pattern
  -> follow risk or uncertainty triggers
  -> stop when the design, constraints, and proof path are clear
```

Do not read the full Harness documentation, historical traces, or every decision by default.

## Core Retrieval

For routine work, usually read:

- the file or behavior being changed;
- adjacent code or docs that establish the pattern;
- the closest acceptance criteria, test, or public contract;
- the command needed for focused verification.

For structural or high-risk work, additionally retrieve the relevant architecture, decisions, guardrails, and validation expectations. Relevance matters more than document count.

## Triggers

| Trigger | Retrieve or do |
| --- | --- |
| Database schema, durable records, or migrations | Relevant schema and CLI code, plus `docs/decisions/0004-sqlite-durable-layer.md`. |
| Harness CLI behavior or installer distribution | Relevant CLI/installer code, tests, `scripts/README.md`, and `docs/decisions/0005-prebuilt-rust-harness-cli.md`. |
| Auth, authorization, audit/security, data loss, or external effects | Escalate to high-risk; read the owned contract, architecture, prior decisions, and security/validation tests. |
| Public behavior or established contract changes | Read the accepted product/API contract, affected callers, and regression tests. |
| Structural boundary changes | Read `docs/ARCHITECTURE.md` and relevant decisions before choosing the seam. |
| Creating or reshaping artifacts | Read `docs/ARTIFACTS.md` and only the template being used. |
| Unclear proof | Read `docs/TEST_MATRIX.md` or run `scripts/bin/harness-cli query matrix`; inspect existing tests before inventing new procedure. |
| Work spans sessions or actors, including delegation | Create or update one packet under `docs/stories/`; before handoff record current acceptance, state, evidence, open gaps, and the next owner or action. |
| Consequential choice must persist | Read relevant prior decisions and record a new decision if they do not already settle it. |
| Recurring harness friction | Read `docs/HARNESS_BACKLOG.md`; fix the shared seam or record a backlog item when out of scope. |
| Trace is useful for review, release, benchmark, or failure attribution | Read `docs/TRACE_SPEC.md` before recording it. |

## Phase Guidance

### Understand

Read enough to identify the outcome, owning design seam, constraints, and meaningful risk. Ask rather than loading more context when the missing information is a user decision.

### Implement

Keep active context centered on changed files, relevant contracts, and adjacent valid variants. Do not carry unrelated policy or history forward.

### Verify

Use acceptance criteria and executable proof. Re-read only evidence needed to judge the claim. If proof is unavailable or failing, report the gap instead of expanding context indefinitely.

### Report or hand off

Summarize the outcome, proof, and unresolved gaps. When handing work off, update the existing packet and treat delegated completion as provisional until the integrating actor verifies the parent acceptance criteria. Create durable records only when another session or actor will benefit; do not duplicate the diff or raw test log.

## Stop Rule

Stop retrieving when all four are clear:

- requested outcome;
- owning design seam;
- relevant constraints and invariants;
- verification path.

Escalate again only when implementation or verification reveals new uncertainty.
