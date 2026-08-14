---
name: memory-management
description: Read and write project-scoped state, reports, and research with pi-memory-md.
---

# Memory Management

Use Memory as an auxiliary, project-scoped channel. It does not manage tasks and does not depend on Harness or another workflow system.

## Daily loop

> Search first, read compact knowledge, then write only durable findings.

```text
START: memory_search({ query: "task keywords", searchIn: "all" })
READ:  memory_read({ path: "@event.or-state-id", view: "knowledge" })
END:   memory_write({ path: "events/<topic>.md", kind: "event", summary, claims or facts })
```

Default to `event` for reports, progress, audits, releases, and investigations. Use `state` only to update knowledge that is still true tomorrow, such as preferences, active architecture, access shape, or runtime conventions. If unsure, write an `event`.

> Do not dump the whole session into Memory.

## Layout

```text
projects/<project-slug>/
├── records/
│   ├── state.preferences.md
│   └── event.local-extension-investigation.md
├── .catalog.json
└── .concepts.json
```

### `state.*` records

Store only canonical knowledge that remains current:

- user preferences;
- environment or runtime state;
- current architecture;
- active workflow or conventions.

Keep this set small. Update an existing file instead of creating snapshots.

### `event.*` records

Store atomic, time-bound material:

- research and investigation reports;
- benchmarks and validation results;
- incident or debugging findings;
- historical summaries.

Prefer one topic or result per file.

## Writing

Use `memory_write` for both create and full replacement. Prefer structured semantic fields over long prose: `summary`, `concepts`, `claims`, `facts`, `relations`, and optional `notes`. For ergonomics, pass logical paths under `state/` or `events/`; new writes are stored as identity-addressed `records/<stable-id>.md` files. Use `sensitive: true` for records that should never be injected automatically.

```text
memory_write({
  path: "events/local-extension-investigation.md",
  kind: "event",
  description: "Why local extension loading failed",
  summary: "Local extension loading failed because the runtime used a different package resolution path.",
  concepts: ["local extension loading", "runtime package resolution"],
  claims: ["Local-path loading should not require this repo's node_modules"],
  facts: { "runtime.local_path_requires_install": false },
  relations: { "evidence": "@event.local-extension-investigation" },
  notes: "Optional evidence/prose only when needed.",
  tags: ["runtime", "extension"]
})
```

The extension generates the stable ID from the logical path. For example, `events/local-extension-investigation.md` becomes `@event.local-extension-investigation` stored at `records/event.local-extension-investigation.md`. Do not create a new file merely to update canonical state.


## Reading

Read by path:

```text
memory_read({ path: "state/preferences.md" })
```

Or by stable ID with compact semantic projection:

```text
memory_read({ path: "@state.preferences", view: "knowledge" })
```

Views:

- `summary`: metadata, summary, concepts;
- `knowledge`: summary, concepts, claims, facts, relations;
- `full`: full Markdown including optional notes/prose.

Use `memory_list` for metadata and `memory_search` for on-demand retrieval. Session injection contains metadata for up to 10 non-sensitive memories: the 5 newest `state` records plus the 5 newest `event` records, with two-way backfill when either kind has fewer.

## Frontmatter

Managed fields are:

- `description`: concise retrieval summary;
- `summary`: one-sentence semantic gist;
- `concepts`: retrieval concepts;
- `claims`: decisions or conclusions;
- `tags`: optional labels;
- `created`: creation timestamp;
- `updated`: timestamp for the last meaningful update.

## Cleanup

Use `memory_delete({ path: "@event.foo" })` only for explicit destructive cleanup.

## Optional facts

Structured `facts` and `relations` are rendered into a fact block. Use them when precise machine-readable claims improve retrieval or verification:

```markdown
<!-- memory:facts:v1 -->
project.runtime.node = "22"
project.local_load_verified = true
relation.evidence -> @event.local-extension-investigation
<!-- /memory:facts -->
```

Rules:

- structured writes normalize fact/relation keys to dotted lowercase identifiers and flatten nested plain-object facts;
- values are JSON scalars or arrays after flattening;
- relations point to stable `@id` values;
- only one fact block is allowed per file;
- Markdown outside the block is unrestricted.

## Choosing a destination

- Still-current truth that should be updated in place → logical `state/` path / `state.*` ID.
- A report or finding tied to an investigation or point in time → logical `events/` path / `event.*` ID.
- Temporary scratch data with no durable value → do not write to Memory.

Memory and task-management records may overlap in facts, but neither system should assume the other exists.
