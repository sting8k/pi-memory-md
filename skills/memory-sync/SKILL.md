---
name: memory-sync
description: Admin-only synchronization notes for pi-memory-md.
---

# Memory Sync

This skill is not loaded by default. Agents should not call `memory_sync` or `memory_check`; those tools are intentionally not exposed in normal runtime.

## Operator notes

- Memory sync is handled by extension settings and repo operations, not the daily agent loop.
- Use Memory tools for agent work: `memory_search`, `memory_read`, `memory_write`, and `memory_list`.
- If repository maintenance is needed, the operator should use the available slash commands or regular git commands outside the agent tool loop.

## Agent rule

Do not suggest or call the sync/check tool names in normal work.
