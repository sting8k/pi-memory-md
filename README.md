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
        ├── records/
        │   ├── state.identity.md
        │   └── event.runtime-investigation.md
        └── .catalog.json
```

- `state.*` IDs: canonical facts that are still current, such as preferences, environment, architecture, and active workflow.
- `event.*` IDs: atomic reports, research, investigations, benchmarks, and historical findings.
- New writes are identity-addressed records. For ergonomic calls, `memory_write(path="events/foo.md", kind="event", ...)` writes `records/event.foo.md`.
- `.catalog.json` is a rebuildable slim metadata catalog used for fast `@id` lookup, listing, latest-memory context, and metadata search. It does not store full Markdown content.
- `.concepts.json` is a small project dictionary for canonical concept labels and aliases; writes update it transparently.
- The extension injects metadata for only the 10 most recently updated non-sensitive catalog entries.
- Full Markdown content is loaded on demand with `memory_read(view="full")`; compact semantic projections use `view="summary"` or `view="knowledge"`.

## Tools

| Tool | Purpose |
|---|---|
| `memory_read` | Read by relative path or stable `@id`, with `full`, `summary`, or `knowledge` projections |
| `memory_write` | Create or fully replace one memory file, preferably from structured semantic fields |
| `memory_list` | List project memory metadata |
| `memory_search` | Search content or metadata, optionally by kind |
| `memory_delete` | Explicitly delete one memory record and reconcile derived metadata |
| `memory_init` | Initialize identity-addressed `records/` |
| `memory_migrate` | Rename a project or migrate a legacy project layout |


## Frontmatter

Every new memory record is addressed by its stable project-local filename. The ID and kind are inferred from `records/<id>.md`, so frontmatter does not need to repeat them:

```markdown
---
description: "Investigation of local extension loading"
tags:
  - "runtime"
created: "2026-07-11T14:37:00.000Z"
updated: "2026-07-11T14:37:00.000Z"
---
# Runtime investigation


<!-- memory:facts:v1 -->
runtime.local_path_requires_install = false
relation.evidence -> @event.runtime-investigation
<!-- /memory:facts -->
```

IDs can be used as `@event.runtime-investigation`. Legacy `state/` and `events/` files may still be read during compatibility, but new writes use `records/`. When `memory_write` replaces an existing logical record, the response says it was overwritten and includes a compact line diff; new creates keep the plain written response.

## Structured-first records

Prefer structured semantic fields over long prose. `memory_write` can generate compact Markdown from:

- `summary`: one-sentence gist;
- `concepts`: retrieval concepts;
  Concepts are normalized to canonical lowercase kebab-case labels through `.concepts.json`; known aliases resolve automatically and unknown concepts are auto-registered. Ambiguous near-duplicates are reported as hints, not blocked.
- `claims`: decisions or conclusions;
- `facts`: JSON scalar/array values rendered into the facts block; nested plain objects are flattened to dotted keys and keys are normalized to lowercase identifiers;
- `relations`: stable `@id` links rendered as relation facts;
- `notes`: optional evidence/prose loaded only in full view.

Generated structured Markdown keeps `summary`, `concepts`, and `claims` in frontmatter/read projections instead of repeating them in the body. A memory may still include one machine-checkable fact block. Markdown outside it stays unrestricted for compatibility.

`memory_write` accepts `sensitive: true` for records that must not be injected automatically. The tool may also mark sensitive-looking writes, such as SSH keys, tokens, credential paths, or passwords, as non-injectable and return a warning instead of rejecting the write.

```markdown
<!-- memory:facts:v1 -->
runtime.local_path_requires_install = false
runtime.supported_modes = ["git", "npm", "local"]
relation.follow_up -> @event.next-investigation
<!-- /memory:facts -->
```

Fact values must be JSON scalars or arrays. For structured writes, nested plain objects are flattened to dotted fact keys, and fact/relation keys are normalized to lowercase identifiers before validation. Relations must point to a valid stable `@id`. Use `memory_read({ path: "@event.foo", view: "knowledge" })` to retrieve summary, concepts, claims, facts, and relations without optional notes/prose.

## Concept normalization

Project memory keeps concept vocabulary simple and transparent:

```json
{
  "version": 1,
  "concepts": ["identity-addressed-record", "semantic-projection"],
  "aliases": {
    "id-based-record": "identity-addressed-record",
    "knowledge-view": "semantic-projection"
  }
}
```

`memory_write` normalizes concept spelling, resolves aliases, deduplicates concepts, and registers new concepts automatically. `memory_search({ searchIn: "concepts" })` is alias-aware and exact: unknown concept queries normalize to canonical labels and return no results when absent instead of falling back to broad token matching. The tool does not silently merge ambiguous semantic near-duplicates; it only returns advisory duplicate hints in tool details.

Memory writes store ISO `created`/`updated` timestamps so same-day records can still sort by write time. Explicit `memory_delete` removes one record, updates `.catalog.json`, and reconciles `.concepts.json` by preserving aliases and active alias targets while only considering the deleted record's concepts for cleanup.

## Legacy migration

Preview before applying:

```text
memory_migrate({ from: "Old Project", to: "Old Project", dryRun: true })
```

Then run the same call without `dryRun`. This is a compatibility path for old data: it may create readable legacy `state/` and `events/` files. New writes after initialization use `records/`.

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
