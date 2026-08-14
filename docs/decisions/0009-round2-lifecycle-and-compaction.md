# 0009 Round-2 Lifecycle: Supersedes, Pre-Commit Dedup, and Compaction

Date: 2026-07-19

## Status

Accepted

## Context

The round-2 spec (`@state.lifecycle-round2-spec`) adds an anti-stale/anti-fragmentation lifecycle: dated `state` IDs are refused at write, `supersededBy` becomes a derived-hiding tombstone on the old record, `state` writes get pre-commit dedup (deterministic ID-family auto-route, concept-containment reject), and a new `memory_compact` tool distills records. Several mechanics were underspecified and the implementation fixed concrete semantics:

1. **ID-family route boundary** — the spec formula is `newId = oldId + suffix` with suffix examples `-v2`, `-v3`, `-final`, `-new`, plus dates. It does not define a "version-bump chain" (`state.deploy-v2` → `state.deploy-v3` when no base `state.deploy` exists), nor which member wins when several prefixes match.
2. **`memory_write` supersedes on an already-superseded target** — the spec demands a skip + report for `memory_compact` only; `memory_write` semantics were open.
3. **Does `memory_compact`'s own write run the pre-commit dedup?** — the distill record is a plain `state` write, so the dedup checks would normally apply.
4. **Discovery scope** — whether superseded records should appear as compact candidates.
5. **Containment with empty concept sets** — the empty set is trivially a subset of every set, so a concept-less record would match everything.

## Decision

1. **ID-family route is strict `oldId`-prefix-of-`newId` with a version-ish suffix whitelist** (`-v\d+`, `-final`, `-new`, `-latest`, `-done`, or a date form). The longest matching prefix wins so the most specific family member is overwritten. Because a routed write keeps the old record's base ID, repeated iterations (`base`, then `base-v2`, then `base-v3`) all collapse onto the base record. A version suffix with no existing base (e.g. only `state.only-v2` exists) is a fresh create, not a route — the spec's formula is one-directional.
2. **`memory_write` supersedes allows re-marking** (chains are the designed model: `@c`→`@b`→`@a`), refuses self-supersede, and validates every reference *before* any file is touched. `memory_compact` additionally skips and reports already-superseded targets, per spec.
3. **`memory_compact`'s distill write bypasses pre-commit dedup.** The agent supplied an explicit `supersede` list, which is itself the dedup decision; running containment auto-checks on top would reject legitimate compactions.
4. **Discovery excludes superseded records** — they are already being phased out; compacting them again is noise.
5. **Containment requires both concept sets non-empty**, so concept-less records never trigger the reject.
6. **`memory_check` is now registered.** It was implemented but never wired into `registerAllMemoryTools` (pre-existing gap); round-2 discovery needs the tool reachable, so registration was added.

## Alternatives Considered

1. Version-bump chain matching (`state.deploy-v2` → `state.deploy-v3`) — rejected: the spec formula is explicitly `newId = oldId + suffix`, and a looser match risks routing an unrelated write onto the wrong record. The base-collapse behavior already handles the common iteration pattern.
2. Fuzzy/description similarity for dedup — explicitly dropped by the spec; auto-routing a fuzzy match risks silent overwrite of the wrong record.
3. Letting `memory_compact` run the containment check — rejected: the explicit `supersede` list is the compaction contract; auto-rejects would make the tool unusable for its purpose.

## Consequences

Positive:

- Dated `state` IDs cannot masquerade as events; `forceCreate` is the documented escape hatch.
- Hidden-ness is derived from one frontmatter marker; deleting a superseder resurrects its targets naturally, and the catalog rebuilds `supersededBy` from frontmatter (version 5; legacy catalogs rebuild on read, zero migration).
- Pre-commit dedup is deterministic and conservative: only version-suffix families auto-route (with a visible diff), and only exact concept containment rejects — with a single actionable hint.
- `memory_compact` writes the distill before applying markers, so an interrupted run leaves the new state plus a few not-yet-hidden records (harmless duplication), never lost information. Mid-way failure triggers a best-effort restore that is honestly labeled as best-effort, not a guarantee.

Tradeoffs:

- A version suffix with no existing base creates a new record instead of routing (spec formula is one-directional).
- `memory_write` will re-mark a record that another record already supersedes; the old chain still resolves because hiding only checks that the named superseder exists.
- A same-kind record whose concept set exactly equals another's is rejected by containment, so creating genuinely distinct records requires at least one distinguishing concept.

## Follow-Up

- **Containment friction watch-item**: a one-element concept set (e.g. `["srcwalk"]`) is a subset of many existing state records' sets, so concept-containment can reject legitimate single-concept writes. `forceCreate` is the escape hatch, so this is not blocking. If real usage shows it fires too often, add a minimum size of 2 for the NEW set before the containment check runs.
