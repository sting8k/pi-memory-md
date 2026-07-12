# 0007 Lightweight Completion Contract

Date: 2026-07-11

## Status

Accepted

## Context

The proportional workflow made project documentation, decisions, and traces conditional so routine work would not create ceremony. Live use showed that wording such as "when useful" was too discretionary: an agent could read the Harness policy, complete implementation and verification, yet skip applicable project documentation, a consequential decision, and retained evidence.

The workflow needs stronger completion semantics without restoring a mandatory contract chain or requiring records for every change.

## Decision

Treat completion as a lightweight contract. Before reporting a change as complete, reconcile three independently triggered clauses:

1. Update the owning document when behavior, schema, architecture, or operator usage changed.
2. Update or create one decision when future work must inherit a consequential choice.
3. Record one evidence-focused trace when release, benchmark, failure attribution, handoff, or durable acceptance requires retained evidence.

A clause that does not apply creates no artifact. Routine narrow changes remain direct work, and the Harness does not require placeholder records or duplicate facts already clear from accepted contracts, the diff, or executable proof.

## Alternatives Considered

1. Keep the existing discretionary wording. Rejected because reading the policy did not reliably activate applicable documentation and evidence work.
2. Restore a mandatory contract-first workflow and full record sequence. Rejected because prior benchmark evidence showed added ceremony, latency, and contract regressions on routine work.
3. Require all three outputs for every code change. Rejected because artifact creation must remain proportional to semantic impact and continuity needs.

## Consequences

Positive:

- Completion obligations are explicit enough to improve activation.
- Project documentation, durable rationale, and retained evidence have objective triggers.
- Direct work remains available when none of the clauses applies.

Tradeoffs:

- Semantic triggers such as consequential choice still require agent judgment.
- The contract must be tested against live tasks to ensure it improves compliance without causing artifact inflation.

## Follow-Up

- Compare live behavior before and after this refinement, including routine tasks where no artifact should be created.
- Prefer mechanical documentation or evidence checks when a stable lower-layer enforcement seam becomes available.
