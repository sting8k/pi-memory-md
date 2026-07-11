# pi-memory-md

Project-scoped Markdown memory for the Pi coding agent.

Memory is an auxiliary channel for durable state, reports, and research. It is independent from task-management systems such as Harness.

## Install

```bash
pi install npm:pi-memory-md
# or
pi install git:github.com/VandeeFeng/pi-memory-md
```

For local development:

```bash
pi -e /absolute/path/to/pi-memory-md/index.ts
```

Local-path loading does not require this repository's `node_modules`; runtime frontmatter support is built in.

## Memory model

Each Git workspace gets an isolated project directory derived from its Git root name:

```text
~/.pi/memory-md/
└── projects/
    └── <project-slug>/
        ├── state/
        │   ├── identity.md
        │   └── preferences.md
        └── events/
```

- `state/`: a small set of canonical facts that are still current, such as preferences, environment, architecture, and active workflow.
- `events/`: atomic reports, research, investigations, benchmarks, and historical findings.
- The extension injects metadata for only the 10 most recently updated files across both directories.
- Full Markdown content is loaded on demand with `memory_read` or `memory_search`.

## Tools

| Tool | Purpose |
|---|---|
| `memory_read` | Read a file by relative path or stable `@id` |
| `memory_write` | Create or fully replace one memory file |
| `memory_list` | List project memory metadata |
| `memory_search` | Search content or metadata, optionally by kind |
| `memory_init` | Initialize `state/` and `events/` |
| `memory_sync` | Pull, push, or inspect the backing repository |
| `memory_migrate` | Rename a project or migrate a legacy project layout |
| `memory_check` | Check project memory structure |

There is no append operation and no separate tape tool API.

## Frontmatter

Every v2 memory has a stable project-local ID and kind:

```markdown
---
id: "event.runtime-investigation"
kind: "event"
description: "Investigation of local extension loading"
tags:
  - "runtime"
created: "2026-07-11"
updated: "2026-07-11"
---
# Runtime investigation

Full Markdown report here.
```

New IDs are generated from the path once and preserved when the file is updated. IDs can be used as `@event.runtime-investigation`.

## Optional fact block

A memory may include one machine-checkable fact block. Markdown outside it stays unrestricted.

```markdown
<!-- memory:facts:v1 -->
runtime.local_path_requires_install = false
runtime.supported_modes = ["git", "npm", "local"]
relation.follow_up -> @event.next-investigation
<!-- /memory:facts -->
```

Fact values must be JSON scalars or arrays. Relations must point to a valid stable `@id`.

## Legacy migration

Preview before applying:

```text
memory_migrate({ from: "Old Project", to: "Old Project", dryRun: true })
```

Then run the same call without `dryRun`. The migration:

- maps legacy identity/preferences to `state/`;
- maps other legacy Markdown reports to `events/`;
- adds v2 IDs and kinds while preserving content;
- refuses conflicts and non-Markdown files;
- removes the source only after all destination writes succeed.

## Configuration

Settings live in `~/.pi/agent/settings.json`:

```json
{
  "memory-md": {
    "enabled": true,
    "localPath": "~/.pi/memory-md",
    "repoUrl": "https://github.com/username/memory-repo.git",
    "autoSync": {
      "onSessionStart": true
    }
  }
}
```

## Development

```bash
npm test
npx tsc --noEmit
npx biome check <changed-files>
```

## License

MIT
