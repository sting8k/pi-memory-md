# Harness Demo Walkthrough

This walkthrough shows the kind of transformation Harness v0 is designed to support. It is an example only. It is not an accepted product contract for this repository.

## Input

A human brings a small product idea:

```text
Build a simple team task tracker where people can create tasks, assign them to teammates, change status, and see what is overdue.
```

Without a harness, an agent might jump directly into framework selection, database schema, UI scaffolding, and tests all at once.

Harness v0 asks the agent to slow the work down just enough to make it inspectable.

## Intake

The input is classified as a new spec because it introduces a new product idea with no existing product contract.

The first output should not be app code. It should be a spec-intake note using `docs/templates/spec-intake.md`.

Example intake shape:

```text
Type: new spec
Lane: normal
Reason: creates a new product surface but does not yet touch auth, payments, data migration, or external provider behavior.
Candidate product docs:
- docs/product/overview.md
- docs/product/tasks.md
- docs/product/assignment.md
Candidate work packets:
- US-001 Create a task
- US-002 Assignment and ownership
- US-003 Overdue visibility
Validation shape:
- Unit proof for task status rules
- Integration proof for task persistence
- E2E proof for create, assign, and complete task flow
```

## Work Packet

After intake, the agent derives small product docs and one flat work packet instead of treating the original prompt as permanent truth.

Example work packet:

```text
docs/stories/US-001-create-a-task.md

Goal:
A teammate can create a task with title, optional assignee, optional due date, and default status todo.

Scope:
- Creating a task.
- Basic validation.
- Showing the new task in the team backlog.

Context map:
- docs/product/tasks.md
- docs/product/assignment.md

Acceptance / Proof:
- Creating a task with a title succeeds.
- Creating a task without a title fails with a clear validation error.
- A new task starts in todo status.
- A created task appears in the team backlog.
```

## Proof Matrix

The story then appears in the durable proof matrix so behavior and proof stay linked:

```bash
scripts/bin/harness-cli story add --id US-001 --title "Create a task" --lane normal --contract docs/product/tasks.md
scripts/bin/harness-cli query matrix
```

Example row:

```text
| US-001 Create a task | docs/product/tasks.md | yes | yes | yes | no | planned | none |
```

The row should not be marked implemented until proof exists.

## Decision Record

If the team chooses a stack, data model direction, or important product rule, the agent records that decision under `docs/decisions/`.

Example decision:

```text
Decision: Tasks use a small explicit status set instead of free-form labels.

Reason: status drives overdue behavior, filtering, and validation, so the first version needs a predictable state model.
```

## Implementation

Only after the packet, proof, and decision shape are clear should implementation begin.

For Harness v0, that distinction matters. This repository deliberately does not ship with application folders, package scripts, CI, or test commands. Those should arrive only when a real packet selects a real stack and needs them.

## Harness Delta

Recurring friction can reveal where the harness itself should improve.

If this demo revealed that many projects need the same intake example, the right follow-up might be:

```text
Add a reusable example-spec walkthrough or starter fixture.
```

Small improvements can be made directly. Larger process changes should be recorded with `scripts/bin/harness-cli backlog add`.