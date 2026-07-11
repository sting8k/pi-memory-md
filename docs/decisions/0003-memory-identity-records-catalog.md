# 0003 Memory Identity Records and Catalog

Date: 2026-07-11

## Status

Accepted

## Context

Memory v2 simplified the data taxonomy to `state/` and `events/`, but several runtime paths still scan and parse the project corpus:

- `@id` lookup;
- duplicate ID checks during writes;
- latest-10 context construction;
- cold search-map construction.

US-002 benchmarked v2 scan-based behavior against a prototype rebuildable catalog at 50, 1,000, and 10,000 records. At 10,000 records, v2 `@id` read and existing-record write update were about 98 ms and 97 ms, and latest-10 context construction was about 149 ms. The prototype catalog kept `@id` lookup near zero, write update about 0.27 ms, and latest-10 about 3 ms after catalog build.

ADR-0002 removes automated migration from scope: a future storage redesign may be new-writes-only.

## Decision

Use identity-addressed records with a rebuildable project catalog for new Memory writes.

Canonical new-write layout:

```text
projects/<slug>/records/<stable-id>.md
projects/<slug>/.catalog.json
```

Rules:

- New writes create or update `records/<stable-id>.md`.
- The stable ID is the filename stem, so `@id` maps directly to a path.
- The record frontmatter may omit redundant `id`; tools infer it from the filename.
- The record frontmatter may omit redundant `kind`; tools infer it from the stable ID prefix (`state.` or `event.`).
- `.catalog.json` is a rebuildable local cache owned by the extension.
- Tools may continue reading old `state/` and `events/` files during compatibility, but no automated migration is required.
- Keep Markdown as the canonical payload. Do not split records into body chunks, SQLite rows, or multi-file bundles in the first implementation.

## Consequences

Positive:

- `@id` reads avoid corpus scans for new records.
- Writes avoid corpus-wide duplicate ID scans for new records.
- Latest-memory context can use catalog metadata.
- Search can reuse catalog text instead of rebuilding a full file map every call.
- The data model stays human-readable and Git-friendly.

Tradeoffs:

- The extension must maintain cache invalidation/rebuild logic.
- During compatibility, code needs to read both v2 and v3 layouts.
- Catalog rebuild cost still scales with corpus size, but it is amortized across operations.
- A corrupt or stale catalog must be treated as disposable and rebuilt from records.

## Evidence

See `docs/stories/US-002-memory-storage-benchmark.md`.
