---
name: memory-init
description: Initialize or migrate the project-scoped pi-memory-md layout.
---

# Memory Initialization

Use this skill when a project has no Memory v2 directory or still uses the legacy layout.

## Initialize

Run:

```text
memory_init({})
```

The extension creates the current Git project's isolated directory:

```text
~/.pi/memory-md/projects/<project-slug>/
├── state/
│   ├── identity.md
│   └── preferences.md
└── events/
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

The default files should appear under `state/` with stable IDs.

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

Legacy migration places identity/preferences in `state/`, places other Markdown files in `events/`, and adds v2 metadata. It refuses symlinks, non-Markdown files, and destination conflicts. Source files are removed only after all destination files are written successfully.

`memory_migrate` also supports project rename migration inside the v2 `projects/` directory. Use `mode: "merge"` only when the destination already exists and the dry-run reports no conflicts.

## Next steps

1. Update `state/identity.md` and `state/preferences.md` only if they contain durable current information.
2. Store reports and research under `events/`.
3. Use `memory_read` or `memory_search` to load full content on demand.
