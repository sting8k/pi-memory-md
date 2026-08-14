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
- The extension injects metadata for up to 10 non-sensitive catalog entries: the 5 newest `state` records plus the 5 newest `event` records (by update time), with two-way backfill when either kind has fewer records.
- Full Markdown content is loaded on demand with `memory_read(view="full")`; compact semantic projections use `view="summary"` or `view="knowledge"`.

## Tools

| Tool | Purpose |
|---|---|
| `memory_read` | Read by relative path or stable `@id`, with `full`, `summary`, or `knowledge` projections |
| `memory_write` | Create or fully replace one memory file, preferably from structured semantic fields |
| `memory_list` | List project memory metadata |
| `memory_search` | Search content or metadata, optionally by kind |
| `memory_alias` | Add an alias for an existing canonical concept |
| `memory_delete` | Explicitly delete one memory record and reconcile derived metadata |
| `memory_check` | Inspect the folder structure and discover compact clusters |
| `memory_compact` | Write a distilled state record and supersede an explicit list of records |
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
  Concepts are normalized to canonical lowercase kebab-case labels through `.concepts.json`; known aliases resolve automatically and unknown concepts are auto-registered. Ambiguous near-duplicates are reported as hints, not blocked. Hash, number, and date-like concepts are blocked with a warning to move them into `facts`/`tags`; sentence-like concepts (six or more hyphen-separated words) warn to move them into `claims` but still register. Use `memory_alias({ alias, canonical })` to map duplicate spellings to an existing canonical concept.
- `claims`: decisions or conclusions;
- `facts`: JSON scalar/array values rendered into the facts block; nested plain objects are flattened to dotted keys and keys are normalized to lowercase identifiers;
- `relations`: stable `@id` links rendered as relation facts;
- `notes`: optional evidence/prose loaded only in full view.

Generated structured Markdown keeps `summary`, `concepts`, and `claims` in frontmatter/read projections instead of repeating them in the body. A memory may still include one machine-checkable fact block. Markdown outside it stays unrestricted for compatibility.

`memory_write` accepts `sensitive: true` for records that must not be injected automatically. The tool may also mark sensitive-looking writes, such as SSH keys, credential tokens, credential paths, or passwords, as non-injectable and return a warning instead of rejecting the write. An explicit `sensitive` flag always wins; without one, an overwrite recomputes the flag from the new content instead of inheriting the old record's flag.

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

`memory_write` normalizes concept spelling, resolves aliases, deduplicates concepts, and registers new concepts automatically. `memory_search({ searchIn: "concepts" })` is alias-aware and exact: unknown concept queries normalize to canonical labels and return no results when absent instead of falling back to broad token matching. The tool does not silently merge ambiguous semantic near-duplicates; it only returns advisory duplicate hints in tool details. `memory_alias({ alias, canonical })` makes duplicate hints actionable by registering an alias for an existing canonical concept; a standalone concept can be converted into an alias without rewriting existing records, and records stored under the old name stay findable through both the alias and the canonical (query-side alias-family expansion).

Memory writes store ISO `created`/`updated` timestamps so same-day records can still sort by write time. Explicit `memory_delete` removes one record, updates `.catalog.json`, and reconciles `.concepts.json` by preserving aliases and active alias targets while only considering the deleted record's concepts for cleanup.

## Lifecycle: supersedes, dedup, and compaction

### Dated state IDs are refused

`memory_write` refuses `state` records whose ID embeds a date (`20260725`, `2026-07-25`, or a `-20260725`-style suffix): dates belong to append-only events. The error suggests `kind:'event'`, or `forceCreate: true` to write the dated state ID anyway. Event IDs may carry dates normally.

### Supersedes: derived hiding, no persisted hidden flag

`memory_write` accepts `supersedes: ["@old-a", "@old-b"]`. After the new record is written, each old record's frontmatter gets `supersededBy: "<new-id>"` and its catalog entry is updated. Hiding is DERIVED at read time: a record is hidden only while its `supersededBy` target still exists. Nothing beyond the marker on the old record is persisted.

- Chains resolve naturally: if `@c` is superseded by `@b` and `@b` by `@a`, both `@b` and `@c` are hidden while `@a` exists. Deleting `@a` resurrects `@b` (its superseder is gone) while `@c` stays hidden (its superseder `@b` still lives).
- `memory_delete` also clears `supersededBy` markers that point at the deleted record, so resurrection is explicit on disk too.
- `memory_list` hides superseded records by default; pass `includeSuperseded: true` to see them (marked `(superseded by @id)`).
- `memory_read` reads a hidden record normally and appends a `Note: superseded by @id` line when the superseder still exists.
- `memory_write` validates every `supersedes` reference before writing anything, and refuses self-supersede.

### Pre-commit dedup for state only

Events are append-only and never deduped. For `state` creates (target ID not yet existing), `memory_write` runs two checks before any file write, both bypassed by `forceCreate: true`:

1. **Deterministic ID-family**: when the new ID equals an existing non-superseded state ID plus a version-ish suffix (`-v2`, `-v3`, `-final`, `-new`, `-latest`, `-done`, or a date suffix), the write is routed to an overwrite of the existing record, the diff is shown, and the response says `routed to overwrite @old (ID-family match)`. The longest matching prefix wins.
2. **Concept containment**: when the new concept set and an existing non-superseded state record's set satisfy one-contains-the-other (both non-empty), the write is REJECTED with a single hint naming the similar record, its path, and `forceCreate: true`. Fuzzy similarity, Jaccard, or description matching are deliberately not used: auto-routing a fuzzy match risks silently overwriting the wrong record.

### memory_compact: explicit distill + ordered markers

`memory_compact({ path, description, ..., supersede: ["@a", "@b", ...] })` is the manual compaction path: the agent supplies the distilled content and the EXPLICIT list of IDs to absorb; nothing is auto-matched by concept.

The tool writes in a safe order: the distilled `state` record is written FIRST, then each `supersede` target is marked `supersededBy` (and its catalog entry updated). If a later step fails, the state already exists and only some markers are missing — harmless duplication, never lost information. On a mid-way failure it performs a best-effort restore (delete the fresh distill, clear already-applied markers) and says so honestly; this is not an all-or-nothing guarantee.

Validation happens before any file is touched: every `supersede` ID must exist or the whole call fails. A target that is already superseded is skipped and reported in the response. The response lists the IDs actually superseded so the agent sees what was absorbed.

### Discovery in memory_check

`memory_check` scans the catalog and reports same-kind record clusters that share at least one canonical concept with 4+ members, as candidates for `memory_compact`, including a ready-to-copy sample call. It is read-only; superseded records are excluded because they are already being phased out.

### Catalog rebuilds from frontmatter

The catalog is derived and rebuildable: `rebuildMemoryCatalog` reconstructs every entry — including `supersededBy` — from the files' frontmatter. Legacy records without `supersededBy` behave exactly as before; no migration is required.

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
