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
└── .catalog.json
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

Use `memory_write` for both create and full replacement. For ergonomics, pass logical paths under `state/` or `events/`; new writes are stored as identity-addressed `records/<stable-id>.md` files.

```text
memory_write({
  path: "events/local-extension-investigation.md",
  kind: "event",
  description: "Why local extension loading failed",
  tags: ["runtime", "extension"],
  content: "# Investigation\n\n..."
})
```

The extension generates the stable ID from the logical path. For example, `events/local-extension-investigation.md` becomes `@event.local-extension-investigation` stored at `records/event.local-extension-investigation.md`. Do not create a new file merely to update canonical state.

## Reading

Read by path:

```text
memory_read({ path: "state/preferences.md" })
```

Or by stable ID:

```text
memory_read({ path: "@state.preferences" })
```

Use `memory_list` for metadata and `memory_search` for on-demand retrieval. Session injection contains metadata for only the 10 most recently updated memories, not full content.

## Frontmatter

Managed fields are:

- `description`: concise retrieval summary;
- `tags`: optional labels;
- `created`: creation date;
- `updated`: last meaningful update date.

## Optional facts

Use a fact block only when precise machine-readable claims improve retrieval or verification:

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
