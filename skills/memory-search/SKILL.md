---
name: memory-search
description: Retrieve project memory with the safe search -> read loop.
---

# Memory Search

Use this skill at the start of non-trivial work when prior project context may matter.

## Hot path

```text
memory_search({ query: "task keywords", searchIn: "all" })
```

If a result matches, read the compact semantic view before acting:

```text
memory_read({ path: "@event.or-state-id", view: "knowledge" })
```

Search results include a `Next: memory_read(...)` hint; follow it unless you need full prose.

## Rules

- Prefer `searchIn: "all"`; narrow to `concepts`, `claims`, or `id` only when you know the field.
- Use keywords, not a long sentence.
- Use `view: "knowledge"` first; use `view: "full"` only when notes/prose are needed.
- If search is empty, use `memory_list({})` to inspect available records.
- Do not call sync/check tools; they are not exposed to agents.

## End-of-task write

After a durable finding, write a structured event unless you are updating still-current canonical state:

```text
memory_write({
  path: "events/<short-topic>.md",
  kind: "event",
  description: "Concise purpose",
  summary: "One sentence",
  concepts: ["project-topic", "finding-topic"],
  claims: ["Important conclusion"],
  facts: { "evidence.checked": true }
})
```

Never dump the whole session into memory.
