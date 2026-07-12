# Harness

Harness is a repository-level operating layer that helps humans and agents turn intent into safe, validated work. It supplies durable context and mechanical feedback where those improve the outcome; it does not prescribe reasoning the agent can perform directly.

## Default Flow

```text
Understand -> Implement -> Verify -> Report
```

1. Understand the requested outcome, relevant design, constraints, and likely proof.
2. Implement the smallest change that fits the design.
3. Run focused proof and adjacent regression checks appropriate to the risk.
4. Complete the applicable completion contract below, then report the outcome, evidence, and any unverified gap.

## Completion Contract

Treat completion as a contract. Before reporting a change as complete, reconcile each applicable clause:

- **Owning documentation**: if behavior, schema, architecture, or operator usage changed, update the document that owns that contract so it remains accurate.
- **Durable decision**: if the work settles a consequential choice about behavior, architecture, authorization, data ownership, public contracts, or validation that future work must inherit, update or create one decision record.
- **Durable evidence**: if release, benchmark, failure attribution, handoff, or durable acceptance requires retained evidence, record one evidence-focused trace.

A clause that does not apply creates no artifact. Do not create placeholder records or duplicate facts already clear from accepted contracts, the diff, or executable proof. Routine narrow changes can still remain direct work.

## Proportional Structure

### Direct work

Read-only questions, status checks, trivial commands, and routine narrow changes can proceed directly. Read the affected source and nearby contract, run focused checks, and report concisely. No intake, work packet, decision, or trace is required solely because a file changed.

### Work packets

Create or update one work packet when at least one of these applies:

- acceptance criteria need durable tracking;
- work spans sessions or actors;
- several independent steps need coordination;
- risk or uncertainty makes an explicit contract useful.

Keep one markdown file by default. Add sections such as `Checklist`, `Findings`, `Tasks`, and `Evidence` instead of inventing new artifact types. Split into a folder only when the packet genuinely needs sibling files.

### Coordination boundaries

When work crosses a session or actor boundary, use the packet as the handoff contract. Keep the objective, scope, acceptance criteria, current state, evidence, open gaps, and next owner or action current. Reconcile that state before delegation, after delegated work returns, at session end, and before closing the parent work.

A delegated result is provisional until the integrating actor verifies the parent acceptance criteria and integration. Do not duplicate the full packet for every bounded subtask. Mark work `implemented` only after that verification; record blockers and the next action instead of claiming completion, and mark absorbed or no-longer-needed work `retired`.

### Decisions

When work settles a consequential choice that future work must inherit, update the owning decision or create one if none exists. Routine implementation choices do not need decision records.

### Traces

Record a trace when release, benchmark, failure attribution, handoff, or durable acceptance requires retained evidence. Keep it evidence-focused, and do not restate information already clear from the diff or test output unless context is needed to interpret it. See `docs/TRACE_SPEC.md`.

## Risk and Proof

Use `docs/FEATURE_INTAKE.md` when risk is not obvious or when durable classification helps coordination. Lanes guide proof depth; they do not represent business priority.

- **Tiny**: focused check for a narrow, low-risk change.
- **Normal**: direct behavior plus relevant regression checks.
- **High-risk**: explicit contract and validation evidence; ask before implementation when direction is ambiguous.

Never claim behavior works without supporting evidence. If proof is unavailable, too expensive, skipped, or failing, say so.

## Context Retrieval

Read the smallest source that answers the current question. `docs/CONTEXT_RULES.md` contains retrieval triggers for architecture, security, durable records, validation, and other specialized work. Stable policy docs are references, not a mandatory reading sequence.

## Durable Layer

Policy docs describe how to work. Optional operational records live in the local, gitignored `harness.db`, managed by the Rust CLI at `scripts/bin/harness-cli` on macOS/Linux or `scripts/bin/harness-cli.exe` on Windows. The versioned schema is under `scripts/schema/`.

Initialize it when durable records or CLI-backed queries are needed:

```bash
scripts/bin/harness-cli init
```

Common commands:

```bash
scripts/bin/harness-cli intake  --type <type> --summary <text> --lane <lane> --context <paths> --packet <id>
scripts/bin/harness-cli story   add --id <id> --title <text> --lane <lane>
scripts/bin/harness-cli story   update --id <id> --status <status>
scripts/bin/harness-cli story   verify <id>
scripts/bin/harness-cli decision add --id <id> --title <text> --doc docs/decisions/<file>.md
scripts/bin/harness-cli guardrail add --guardrail "<rule>" --why "<reason>"
scripts/bin/harness-cli trace   --summary <text> --outcome <outcome>
scripts/bin/harness-cli backlog add --title "<short name>" --pain "<what was hard>"
scripts/bin/harness-cli query   matrix
scripts/bin/harness-cli query   guardrails
scripts/bin/harness-cli query   backlog
scripts/bin/harness-cli query   stats
```

Use the CLI only for a record required by the completion contract or a coordination boundary. Do not create records merely to satisfy a sequence.

## Source Hierarchy

```text
User input or supplied spec
  current requested outcome

docs/product/*
  accepted product and work contracts

docs/stories/*
  durable work packets and evidence when needed

docs/decisions/*
  consequential rationale future work must inherit

docs/GUARDRAILS.md
  standing project directives

docs/TEST_MATRIX.md or `harness-cli query matrix`
  behavior-to-proof expectations
```

After implementation, accepted contracts plus executable tests are the living contract. Do not grow a monolithic spec when smaller owned docs are clearer.

## Mechanical Verification

A work packet may carry a proof command:

```bash
scripts/bin/harness-cli story add --id US-012 --title "Story verification" --lane normal --verify "cargo test --workspace"
scripts/bin/harness-cli story update --id US-012 --verify "cargo test --workspace"
scripts/bin/harness-cli story verify US-012
```

`story verify` runs the configured command from the repository root, records the result, and exits nonzero on failure. Prefer this mechanical seam over adding prose reminders. Record proof booleans with numeric values (`1` or `0`); use `query matrix --numeric` when copying matrix values.

## Harness Growth

Improve the harness when a recurring failure or repeated manual step provides evidence that a small mechanism would help. If the fix is out of scope and worth preserving, add a backlog item. Do not turn one-off friction into permanent workflow by default.
