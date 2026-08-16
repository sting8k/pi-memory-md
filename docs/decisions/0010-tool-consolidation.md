# 0010 Tool Consolidation: Four Tools, No Git Layer

Date: 2026-07-20

## Status

Accepted

## Context

Round 2 left ten registered memory tools (`read`, `write`, `list`, `search`, `alias`, `delete`, `init`, `migrate`, `check`, `compact`) plus a never-registered `memory_sync`. Ten entries cost tool-schema tokens in every session and force the agent to pick between overlapping tools (`write` vs `compact`, `list` vs `check`). The round-3 spec (`@state.tool-consolidation-spec`) cuts the surface to four: `memory_read`, `memory_write`, `memory_search`, `memory_delete`.

Two areas were underspecified or contradicted by evidence in the repository:

1. **`supersedes` semantics differed between `memory_write` and `memory_compact`.** `write` re-marked an already-superseded target (0009 decision 2); `compact` skipped and reported it. `compact` bypassed the pre-write dedup; `write` did not.
2. **The spec said to delete `syncRepository` as "only used by sync/init".** Grep showed three more call sites in `index.ts`: session-start auto-sync, the `/memory-init` command, and the `isRepoInitialized` plumbing passed into `registerAllMemoryTools`.

Open points that the implementation had to fix: whether an explicit write to a superseded record keeps its marker, whether `includeSuperseded` applies to search mode as well as list mode, and where the cluster-discovery threshold lives.

## Decision

1. **`memory_write` absorbs `memory_compact`.** A merge is `memory_write({..., supersedes: ["@a", "@b"]})`. The compact-side semantics win where the two differed:
   - an already-superseded target (its superseder still live) is **skipped and reported**, not re-marked, superseding 0009 decision 2;
   - a non-empty `supersedes` list **bypasses the pre-write dedup** (both ID-family routing and containment reject), because an explicit merge is itself the dedup decision;
   - the marking loop keeps the write-then-mark order and the best-effort restore (prior bytes when the target pre-existed, delete when it was fresh, clear already-written markers, rebuild catalog).
   Self-supersede stays a hard pre-write error (`write` semantics) rather than a silent skip: the caller named the record it is writing, which is always a mistake.
2. **An explicit write to a superseded record clears its marker** and reports `Cleared superseded marker (was superseded by @x)`. Keeping the marker would silently hide freshly written content from injection and listings; the alternative (silence) fails the "no silent behavior" rule.
3. **`memory_write` auto-initializes.** The first write creates the project directory, `records/`, and the two default records, and reports `Initialized project memory: <dir>`. This is the only init path; it is local-only.
4. **`memory_search` absorbs `memory_list` and `memory_check`'s discovery.** No `query` (or a blank one) means list mode with the previous `memory_list` output. `directory` is dropped in favour of `kind`. `searchIn` became optional (default `all`) because list mode has no field to search. `includeSuperseded` (default `false`) applies to **both** modes, so hidden records are hidden consistently; `memory_read` by `@id` still reads them.
5. **Cluster warnings keep the threshold of 4** and reuse `findCompactClusters` unchanged; only the presentation moved, and the sample call is now `memory_write(..., supersedes: [...])`. The threshold stays a code default rather than a tool parameter: it is a heuristic, not a user knob.
6. **The git layer is deleted, not preserved.** Evidence beat the original plan to keep it: `~/.pi/memory-md/.git` is an empty shell (no HEAD, no commits), so auto-sync has been failing silently for months and no user data depends on it. Removed: `syncRepository`, `gitExec`, `getRepoName`, the timeout constants, `GitResult`/`SyncResult` types, the `repoUrl`/`autoSync` settings, the `isRepoInitialized` plumbing, session-start auto-sync, and the `/memory-init` and `/memory-status` commands. `/memory-refresh` and `/memory-check` stay: they are local and unrelated to git.
7. **`migrateMemoryProject` is deleted with its tool.** Removing the only consumer made it dead code, and renaming a project folder is now a manual `mv`. Git history is the recovery path.
8. **`addConceptAlias` is kept, `memory_alias` is removed.** Alias resolution on read and write is untouched (`.concepts.json` aliases still resolve in `memory_write` and `memory_search({searchIn:"concepts"})`).
9. **The whole `skills/` directory is deleted**, together with the `pi.skills` registration, the `skills` entry in `files`, and the now-inaccurate `pi-skill` keyword. Verified in a live session that the skills were not being loaded; their content duplicated the tool descriptions and they were themselves the clearest case of doc drift in this round (every one of them taught removed tools). Durable guidance now lives in exactly two places: the four tool descriptions and `README.md`.

## Alternatives Considered

1. Keeping `memory_compact` as a thin alias of `memory_write` — rejected: the token cost of a duplicate schema is exactly what this round removes, and two names for one operation is what confused tool selection.
2. Keeping the git layer behind a setting — rejected on evidence: the repository it would sync has never existed as a working git repo, so the setting would only preserve a silent failure path.
3. Applying `includeSuperseded` only to list mode — rejected: one flag with two meanings is harder to explain than one flag with one meaning, and search leaking hidden records contradicts the round-2 hiding model.
4. Making the cluster threshold a `memory_search` parameter — rejected: it adds a knob to the tool schema for a heuristic no caller has a reason to tune.
5. Rewriting the skills for the four-tool API instead of deleting them — rejected: they were not loaded in practice, so the rewrite would have bought a third copy of the same guidance and a third place to drift.

## Consequences

Positive:

- Tool surface drops from 10 to 4; every remaining tool has one job (read, write, find, delete).
- One write path means one set of lifecycle rules: dated-ID guard, dedup, supersedes, write-then-mark, best-effort restore.
- No git means no silent background failure, no network timeouts on session start, and no partially-initialized repo states.
- Memory bootstraps itself: a fresh project needs no setup call.
- Guidance has one source per audience: tool descriptions for the agent, README for humans. No skill files to drift.

Tradeoffs:

- Concept aliases can no longer be created through a tool; `addConceptAlias` has no caller left, so new aliases require code or manual `.concepts.json` edits. Existing aliases keep resolving. **Flagged as a follow-up.**
- Project-folder renames and any remote backup are manual operations now.
- Auto-init creates two default records (`state.identity`, `state.preferences`) in every project on first write, which shows up in listing counts.
- Superseded records no longer appear in default search results, so an agent looking for absorbed detail must pass `includeSuperseded: true` or read by `@id`.

## Follow-Up

- **Alias creation gap**: decide whether `addConceptAlias` should be reachable again (for example, as a `memory_write` side-channel) or deleted; today it is a writer without a caller.
- **Default records in counts**: if the two auto-created defaults prove noisy in list mode for empty projects, consider creating them lazily on first read instead.
