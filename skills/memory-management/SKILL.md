---
name: memory-management
description: Read and write project-scoped state, reports, and research with pi-memory-md.
---

# Memory Management

Use Memory as an auxiliary, project-scoped channel. It does not manage tasks and does not depend on Harness or another workflow system.

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

Use `memory_write` for both create and full replacement. Prefer structured semantic fields over long prose: `summary`, `concepts`, `claims`, `facts`, `relations`, and optional `notes`. For ergonomics, pass logical paths under `state/` or `events/`; new writes are stored as identity-addressed `records/<stable-id>.md` files. Generated Markdown does not repeat summary, concepts, or claims in the body; read projections render them from frontmatter.

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

Concepts are normalized transparently through `.concepts.json`: use natural labels, and the tool lowercases/kebab-cases them, resolves known aliases, deduplicates them, and auto-registers new concepts. Ambiguous near-duplicates are returned as advisory details; they do not block writes.

`memory_write` also sets ISO `created`/`updated` timestamps automatically, so same-day memories still sort by write time.

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

Use `memory_list` for metadata and `memory_search` for on-demand retrieval. `memory_search({ searchIn: "concepts" })` is alias-aware. Session injection contains metadata for only the 10 most recently updated memories, not full content. `.catalog.json` is a rebuildable slim metadata index, not a second copy of full Markdown.

## Frontmatter

Managed fields are:

- `description`: concise retrieval summary;
- `summary`: one-sentence semantic gist;
- `concepts`: retrieval concepts;
- `claims`: decisions or conclusions;
- `tags`: optional labels;
- `created`: ISO creation timestamp;
- `updated`: ISO timestamp for the last meaningful update.

## Cleanup

Use `memory_delete({ path: "@event.foo" })` only for explicit destructive cleanup. It deletes the record, updates the slim catalog, and reconciles `.concepts.json` while preserving aliases and alias targets.

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

- keys are dotted lowercase identifiers;
- values are JSON scalars or arrays;
- relations point to stable `@id` values;
- only one fact block is allowed per file;
- Markdown outside the block is unrestricted.

## Choosing a destination

- Still-current truth that should be updated in place → logical `state/` path / `state.*` ID.
- A report or finding tied to an investigation or point in time → logical `events/` path / `event.*` ID.
- Temporary scratch data with no durable value → do not write to Memory.

Memory and task-management records may overlap in facts, but neither system should assume the other exists.
