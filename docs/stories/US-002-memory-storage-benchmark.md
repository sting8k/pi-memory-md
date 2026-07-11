# US-002 Memory Storage Benchmark

## Objective

Benchmark Memory v2 before deciding whether to redesign storage for read/write scaling.

Scope follows ADR-0002: a future optimized layout is new-writes-only and does not require migration of existing data.

## Corpus

Synthetic Markdown corpus with representative payload size of roughly 2 KiB per record.

Sizes:

- 50 records
- 1,000 records
- 10,000 records

Operations measured as median of repeated runs:

- direct path read;
- `@id` lookup + read;
- update existing record with duplicate-ID check;
- latest-10 context construction;
- search map build;
- search using a cached map;
- prototype catalog rebuild;
- prototype catalog `@id` lookup;
- prototype catalog write update;
- prototype catalog latest-10;
- prototype catalog search.

Benchmark script was temporary under `/tmp` and generated corpora under `/tmp`; no generated corpora are committed.

## Results

| N | Operation | Median ms |
|---:|---|---:|
| 50 | v2 read path | 0.021 |
| 50 | v2 `@id` lookup + read | 0.967 |
| 50 | v2 write update existing | 0.983 |
| 50 | v2 latest-10 context | 0.855 |
| 50 | v2 build search map | 1.331 |
| 50 | v2 search cached map | 0.127 |
| 50 | catalog rebuild | 1.673 |
| 50 | catalog `@id` lookup | 0.000 |
| 50 | catalog write update | 0.268 |
| 50 | catalog latest-10 | 0.019 |
| 50 | catalog search | 0.132 |
| 1,000 | v2 read path | 0.008 |
| 1,000 | v2 `@id` lookup + read | 8.988 |
| 1,000 | v2 write update existing | 9.210 |
| 1,000 | v2 latest-10 context | 13.238 |
| 1,000 | v2 build search map | 18.258 |
| 1,000 | v2 search cached map | 1.711 |
| 1,000 | catalog rebuild | 23.012 |
| 1,000 | catalog `@id` lookup | 0.000 |
| 1,000 | catalog write update | 0.206 |
| 1,000 | catalog latest-10 | 0.272 |
| 1,000 | catalog search | 2.698 |
| 10,000 | v2 read path | 0.012 |
| 10,000 | v2 `@id` lookup + read | 98.517 |
| 10,000 | v2 write update existing | 97.102 |
| 10,000 | v2 latest-10 context | 149.367 |
| 10,000 | v2 build search map | 142.515 |
| 10,000 | v2 search cached map | 17.482 |
| 10,000 | catalog rebuild | 189.233 |
| 10,000 | catalog `@id` lookup | 0.000 |
| 10,000 | catalog write update | 0.269 |
| 10,000 | catalog latest-10 | 3.084 |
| 10,000 | catalog search | 27.012 |

## Interpretation

Direct path reads are already cheap in v2 because they open one file. The expensive paths are operations that first scan and parse the corpus:

- `@id` lookup;
- write duplicate-ID check;
- latest-10 context construction;
- cold search-map build.

The prototype catalog pays a rebuild cost comparable to or higher than a full scan, but amortizes common operations:

- `@id` lookup becomes effectively constant-time;
- existing-record write update avoids corpus-wide duplicate scanning;
- latest-10 becomes metadata sort over catalog entries;
- search no longer requires building a file map before searching.

At 10,000 records the difference is material: v2 `@id` read and write update are roughly 100 ms, latest-10 is roughly 150 ms, while catalog lookup/update stay sub-millisecond and latest-10 is roughly 3 ms.

## Recommendation

Proceed with a new-writes-only optimized layout:

```text
projects/<slug>/records/<stable-id>.md
projects/<slug>/.catalog.json
```

Rules:

- new writes create identity-addressed records;
- `@id` maps directly to `records/<id>.md`;
- `.catalog.json` is rebuildable and local to the project directory;
- tools may read both `records/` and the v2 `state/`/`events/` layout during the compatibility period;
- no automated migration is required.

The first implementation should stay small:

- no chunked body files;
- no SQLite;
- no background daemon;
- rebuild catalog synchronously when missing/stale;
- keep Markdown as the canonical record body.
