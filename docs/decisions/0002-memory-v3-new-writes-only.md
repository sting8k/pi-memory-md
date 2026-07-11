# 0002 Memory v3 New-Writes-Only Storage

Date: 2026-07-11

## Status

Accepted

## Context

Memory v2 made the taxonomy simpler, but direct read/write paths still scan and parse the project corpus for several operations:

- `@id` resolution;
- duplicate ID checks during writes;
- latest-memory context construction;
- search map construction.

A future storage redesign may use identity-addressed records plus a local rebuildable catalog to optimize these paths. The main open scope question was whether that redesign must migrate existing legacy/v2 data.

## Decision

A future Memory storage redesign does **not** need to provide migration for existing data.

If implemented, the new layout may apply only to new writes from that point forward. Existing data can remain in its current layout unless separately requested.

## Consequences

Positive:

- The next design can focus on the future read/write shape and agent ergonomics.
- Implementation can avoid migration edge cases, rollback paths, conflict handling, and legacy compatibility logic.
- Benchmarking can compare future-write behavior directly without requiring full corpus migration mechanics.

Tradeoffs:

- Old data and new data may coexist unless old support is explicitly removed or manually cleaned up.
- Any tool implementation must define whether it reads both layouts or only the new layout.
- If old data remains readable, lookup/catalog code still needs a compatibility boundary, but not an automated migration path.

## Evidence

The project owner clarified: “thực tế ko cần lo vụ migration đâu, coi như từ bây giờ sẽ lưu theo kiểu mới luôn nếu đã triển khai”.
