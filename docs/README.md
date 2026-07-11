# Documentation Map

This directory holds the harness framework and any work contracts derived from user input.

## Main Files

- `HARNESS.md`: operating model for humans and agents.
- `FEATURE_INTAKE.md`: how intake warms up an agent and picks a work packet shape.
- `CONTEXT_RULES.md`: what to read, when to read it, and when to stop.
- `GUARDRAILS.md`: durable project directives and mindset.
- `ARTIFACTS.md`: naming and folder taxonomy.
- `TEST_MATRIX.md`: behavior-to-proof map.
- `TRACE_SPEC.md`: trace depth and field contract.
- `HARNESS_BACKLOG.md`: framework improvement queue.
- `GLOSSARY.md`: shared terms.

## Folders

- `product/`: current product/work truth, empty until input needs it.
- `stories/`: work packets and history. Default is flat-first, with optional grouped packets in `epics/` when a larger initiative needs a namespace.
- `decisions/`: durable rationale records.
- `demo/`: example walkthroughs.
- `templates/`: reusable intake, packet, decision, and validation shapes.

## Current State

Harness v0 exists before product implementation. These docs define how the framework itself is adjusted, not just how a consumer project should use it. Keep the surface shallow, readable, and CLI-aware.