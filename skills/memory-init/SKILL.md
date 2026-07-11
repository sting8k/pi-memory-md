---
name: memory-init
description: Initialize or migrate the project-scoped pi-memory-md layout.
---

# Memory Initialization

Use this skill when a project has no identity-addressed Memory directory or still uses an older layout.

## Initialize

Run:

```text
memory_init({})
```

The extension creates the current Git project's isolated directory:

```text
~/.pi/memory-md/projects/<project-slug>/
├── records/
│   ├── state.identity.md
│   └── state.preferences.md
└── .catalog.json
```

The project slug comes from the nearest Git root directory name. Running Pi from a nested package still resolves to the same project memory.

Use `force: true` only when explicitly reinitializing:

```text
memory_init({ force: true })
```

## Verify

After initialization:

```text
memory_check({})
memory_list({})
```

The default files should appear under `records/` and be readable as `@state.identity` and `@state.preferences`.

## Migrate a legacy project

Always preview first:

```text
memory_migrate({
  from: "Old Project",
  to: "Old Project",
  dryRun: true
})
```

If the preview succeeds with no conflicts, apply it:

```text
memory_migrate({
  from: "Old Project",
  to: "Old Project"
})
```

Legacy migration is compatibility-only for old data and may create readable legacy `state/` and `events/` files. New writes after initialization use `records/`.

## Next steps

1. Update `@state.identity` and `@state.preferences` only if they contain durable current information.
2. Store reports and research through logical `events/*.md` paths; they will be written under `records/event.*.md`.
3. Use `memory_read` or `memory_search` to load full content on demand.
