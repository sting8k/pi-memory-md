# Glossary

## Agent

An AI coding collaborator operating inside the repository.

## Harness

The repo-level operating system that tells humans and agents how to turn intent into safe work.

## Work Packet

An optional durable file or folder that captures goal, scope, proof, and evidence when bounded work needs tracking, coordination, or handoff.

## Story Packet

A work packet expressed through the optional `story` surface when bounded work needs durable tracking.

## Intake / Warmup

Lightweight classification of relevant context, semantic risk, and expected proof; record it durably only when useful.

## Classify

Choose the kind of work and the depth/risk lane.

## Map Context

Retrieve the smallest set of documents and files needed for the current decision or phase.

## Guardrail

A durable project directive that should shape future agent behavior.

## Harness Delta

A documentation, template, validation, backlog, or decision update that makes future agent work safer or easier.

## Backlog Outcome Loop

The feedback workflow for Harness improvements: record predicted impact when a backlog item is created, then record actual measured outcome when the item is closed so future agents can compare expectation with result.

## Durable Layer

The SQLite database and CLI (`scripts/bin/harness-cli`) that stores operational records (intakes, work packets/stories, decisions, guardrails, backlog items, traces) as structured, queryable data. Policy docs describe how to work; the durable layer stores what happened.

## Work Delta

A repository-facing change that moves the selected work forward: docs, code, tests, findings, checklists, tasks, or evidence.

## Product Delta

A work delta that changes product-facing behavior, such as code, tests, API shape, data model, or product docs.

## Trace

An optional structured execution record used when evidence, failure attribution, analysis, or handoff should persist.