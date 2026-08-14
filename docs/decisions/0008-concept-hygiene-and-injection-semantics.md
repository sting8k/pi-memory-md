# 0008 Concept Hygiene and Kind-Aware Injection Semantics

Date: 2026-07-19

## Status

Accepted

## Context

The approved injection/concept-hygiene spec (`@state.injection-and-concept-hygiene-spec`) left three mechanics underspecified, and the implementation had to choose concrete semantics:

1. **Hash vs. date collision** — the spec's hex-hash pattern `^[0-9a-f]{7,40}$` also matches pure-digit strings such as `20240101` (YYYYMMDD), which the date rule says should be flagged as dates, not hashes.
2. **`memory_alias` conflict rule** — the spec forbids an alias that "is the canonical of another concept in use" but also allows converting a standalone concept into an alias. The two rules needed a precise boundary.
3. **Backfill ordering** — with 3 state + 12 event records, newest-first greedy selection would fill all 10 slots with events and never reach the older states, contradicting the intended "reserve 5 slots for newest state, backfill the shortfall" behavior.

## Decision

1. **Hash pattern requires at least one `a-f` letter**: `/^(?=.*[a-f])[0-9a-f]{7,40}$/`. Pure-digit strings fall through to the date (`\d{8}` / `\d{4}-\d{2}-\d{2}`) and number (`^[0-9][0-9.-]*$`) checks, so `20240101` is warned as a date. A real hash like `deadbeefcafe` still gets the hash warning.
2. **`memory_alias` conflict boundary**: an alias is rejected only when it is the *target* of another alias (`Object.values(aliases)`), because repointing would silently break that existing mapping. An alias that is a standalone dictionary concept is converted (removed from `concepts`, added to `aliases`) without rewriting records; resolution of old records happens lazily via `resolveConcept` on later writes/searches. An alias already mapped to a different canonical is also rejected.
3. **Backfill is kind-first, not greedy**: select the newest `min(5, n)` state records and newest `min(5, n)` event records, then fill each kind's shortfall with the newest records of the other kind, capped at 10 total. Render order stays mtime-descending as before.

## Alternatives Considered

1. Keep the literal `^[0-9a-f]{7,40}$` pattern — would mislabel YYYYMMDD dates as hashes and fail the spec's date intent.
2. Reject any alias that is also a dictionary concept — would forbid the spec's required "concept → alias" conversion case.
3. Single-pass newest-first selection — failed the 3-state/12-event backfill case (0 state injected).

## Consequences

Positive:

- Each blocked concept gets the most accurate warning (hash / date / number).
- `memory_alias` is safe: it never breaks an existing alias chain, and duplicate-hint concepts can be collapsed without a migration.
- Injection keeps a guaranteed state/event mix whenever both kinds exist, with no output-format change.

Tradeoffs:

- An all-digit 7-40 char string (e.g. `12345678`) is never flagged as a hash even if it is one; it is flagged as a date/number instead.
- Converting a concept to an alias keeps stored records findable immediately: concept search expands each canonical query term into its alias family (OR within a family, AND across families), so both the canonical and its aliases match records stored under either name. Stored records themselves are never rewritten.

## Follow-Up

- Add `memory_alias` to the shipped skill docs if a memory-management skill revision is ever requested.
