# Stories

Stories are work packets. They turn selected work into bounded execution and proof.

The default story is flat and small enough to read at a glance.

## Default Path

```text
docs/stories/US-001-short-story-title.md
```

## Grouped Work

Use `docs/stories/epics/` only when a larger initiative needs a shared namespace for multiple packets. Keep the group shallow.

## High-Risk Work

Use `docs/templates/high-risk-story/` when the packet is large or the risk is high enough to need `execplan.md`, `overview.md`, `design.md`, and `validation.md`.

## What Stories Can Hold

A packet can describe product changes, audits, inventories, spikes, migrations, or other bounded repository work. For read-heavy packets, use the same file shape and add checklist, findings, tasks, and evidence sections instead of inventing a new artifact type.

## Status Flow

```text
planned -> in_progress -> implemented
                   |
                   v
                changed
                   |
                   v
                retired
```