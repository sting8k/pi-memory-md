# Artifact Taxonomy

Harness keeps the number of artifact types small. Do not invent a new type for every use case.

## Core Rule

- Work directly when no durable artifact is useful.
- When a packet is needed, start with one file.
- Use a folder only when the packet is large, repeated, or needs sibling subfiles.

## Artifact Bands

| Band | Purpose | Examples |
| --- | --- | --- |
| Policy docs | Standing operating rules for the framework | `HARNESS.md`, `FEATURE_INTAKE.md`, `CONTEXT_RULES.md`, `GUARDRAILS.md` |
| Work packets | Durable acceptance, coordination, and handoff when needed | `US-001-short-title.md`, high-risk packet folders, initiative notes |
| Durable records | Rationale, proof, friction, state | decisions, traces, backlog, test matrix |
| Templates | Reusable shapes for new work | `docs/templates/*` |

## Naming

- Policy docs: `CAPS_SNAKE.md`
- Work packets: `US-001-short-title.md`
- Decision records: `0001-short-slug.md`
- Group folders: `E01-domain/`
- Folder names: lowercase noun phrases

## Optional Packet Sections

For read-heavy, audit-like, or multi-repo work, keep the same packet and add only the sections you need:

- Checklist
- Findings
- Tasks
- Evidence

## CLI Compatibility

- `story add/update/verify` works with work packet ids.
- `decision add/verify` works with decision ids and doc paths.
- `guardrail add/list/import` works with durable project directives from `docs/GUARDRAILS.md`.
- `backlog` is for harness friction only.
- `trace` records execution evidence.
- `query matrix` remains the proof view.

## Depth Rule

Depth 1 and depth 2 are the same band. Prefer flat-first. Use nested folders only when the packet would otherwise become too large or too hard to navigate.