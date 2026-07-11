# Harness Components

This taxonomy maps the current `just-harness` repository to two
component frameworks used by Phase 2 and updated by Phase 3 active
observability work:

- Runtime Substrate responsibilities: the 11 responsibility areas the harness
  should cover.
- NexAU decomposition: the seven implementation surfaces that influence agent
  behavior.

Status values:

- **Covered**: the repository has an explicit file, command, or record for this
  responsibility.
- **Partial**: the repository has some support, but the support is incomplete,
  manual, or not yet measured.
- **Missing**: no meaningful support exists yet.

## Responsibility Map

| # | Responsibility | Status | Harness Files | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 | Task specification | Covered | `AGENTS.md`, `docs/FEATURE_INTAKE.md`, `docs/ARTIFACTS.md`, `docs/templates/story.md`, `docs/templates/spec-intake.md`, `docs/templates/high-risk-story/*`, `docs/stories/*`, `intake` table, `story` table | Agents identify outcome, semantic risk, and proof directly; optional intake and packet surfaces preserve that contract when tracking or coordination is useful. | Keep durable packets synchronized with future product docs and proof records when they are used. |
| 2 | Context selection | Covered | `AGENTS.md`, `docs/CONTEXT_RULES.md`, `docs/GUARDRAILS.md`, `docs/ARTIFACTS.md`, `docs/ARCHITECTURE.md`, `docs/decisions/*`, `docs/product/README.md` | Context rules, guardrails, and artifact taxonomy tell agents what to read, what to skip, and when to escalate. | Future automation could enforce context selection or measure over-reading. |
| 3 | Tool access | Partial | `scripts/bin/harness-cli`, `scripts/README.md`, `crates/harness-cli/*`, `scripts/install-harness.sh`, `scripts/build-harness-cli-release.sh` | The Harness CLI exposes operational commands for intake, stories, decisions, backlog, traces, trace scoring, and queries. | No machine-readable tool registry, permission profile, or capability manifest exists yet. |
| 4 | Project memory | Covered | `docs/HARNESS.md`, `docs/GUARDRAILS.md`, `docs/decisions/*`, `docs/GLOSSARY.md`, `docs/HARNESS_BACKLOG.md`, `docs/stories/*`, `harness.db`, `decision`, `backlog`, and `trace` tables | Guardrails, decisions, backlog, stories, and traces preserve durable knowledge across tasks. | Future work should add staleness checks and summarize old traces. |
| 5 | Task state | Covered | `scripts/bin/harness-cli query matrix`, `docs/TEST_MATRIX.md`, `intake` table, `story` table, `trace` table | Optional durable records track intake, story status, proof columns, and traces when work needs continuity. | External backlog scheduling and lifecycle orchestration remain outside this repository harness. |
| 6 | Observability | Partial | `docs/TRACE_SPEC.md`, `trace` table, `scripts/bin/harness-cli trace`, `scripts/bin/harness-cli score-trace`, `scripts/bin/harness-cli query traces`, `scripts/bin/harness-cli query friction`, `docs/HARNESS_MATURITY.md` | Traces are auto-scored when recorded, can be rescored by command, and can be reviewed with friction context. | No dashboard or benchmark ingestion exists in this repo. |
| 7 | Failure attribution | Partial | `docs/HARNESS_COMPONENTS.md`, `docs/TRACE_SPEC.md`, `trace.errors`, `trace.harness_friction`, `docs/HARNESS_BACKLOG.md`, `backlog` table, `scripts/bin/harness-cli query friction` | Failures can be tied to files, components, friction, backlog proposals, and linked intake lane/type context. | No automated attribution from benchmark failures to harness components exists yet. |
| 8 | Verification | Covered | `docs/TEST_MATRIX.md`, `scripts/bin/harness-cli query matrix`, `scripts/bin/harness-cli story verify`, `scripts/bin/harness-cli trace`, `scripts/bin/harness-cli score-trace`, `story.verify_command`, `story.last_verified_result`, `.github/workflows/harness-cli-release.yml`, `docs/templates/validation-report.md` | Stories can store and run mechanical proof commands, linked traces warn when story verification has not passed, trace metadata completeness can be checked mechanically, and release workflow verifies Rust CLI releases. | Benchmark ingestion remains future work. |
| 9 | Permissions | Partial | `AGENTS.md`, `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`, `docs/GUARDRAILS.md`, `docs/ARTIFACTS.md`, `docs/ARCHITECTURE.md`, installer conflict handling in `scripts/install-harness.sh` | Policy describes when agents may update docs, how to respect standing guardrails, and when to ask before architecture or workflow changes. | Permissions are instruction-level only; no enforced policy layer or command allowlist exists. |
| 10 | Entropy auditing | Partial | `docs/HARNESS_BACKLOG.md`, `backlog` table, `trace.harness_friction`, `docs/HARNESS_MATURITY.md` | Growth rule captures friction, backlog items can compare predicted impact to actual outcome, and Phase 2 defines maturity movement. | No drift detector, stale-doc audit, or entropy score exists. |
| 11 | Intervention recording | Partial | `trace` table, `docs/decisions/*`, `docs/stories/*`, `docs/HARNESS.md` | Traces and decisions can record actions, decisions, and outcomes. | Human interventions are not separated from normal agent actions, and there is no review-event schema. |

## NexAU Cross-Reference

| Component | Harness Equivalent | Status | Notes |
| --- | --- | --- | --- |
| System prompts | `AGENTS.md` plus Harness policy docs | Covered | `AGENTS.md` is the stable shim; `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`, and `docs/CONTEXT_RULES.md` carry evolving operating instructions. |
| Tool descriptions | `scripts/README.md`, `docs/HARNESS.md`, `docs/TRACE_SPEC.md`, CLI help from `crates/harness-cli/src/interface.rs` | Partial | Commands, story verification, and trace scoring are documented, but there is no standalone tool schema or generated command reference. |
| Tool implementations | `scripts/bin/harness-cli`, `crates/harness-cli/*`, `scripts/schema/001-init.sql`, `scripts/schema/002-story-verify.sql`, `scripts/schema/003-guardrails.sql` | Covered | The Rust CLI is the primary durable-layer implementation and stable repo-local entrypoint. |
| Middleware | installer safety logic, intake/warmup workflow | Partial | The installer and intake process mediate work, but there is no runtime middleware enforcing policies. |
| Skills | `docs/templates/*`, `docs/FEATURE_INTAKE.md`, `docs/CONTEXT_RULES.md`, `docs/TRACE_SPEC.md` | Partial | Reusable procedures exist as markdown, not executable or installable agent skills. |
| Sub-agents | None in this repository | Missing | No delegated specialist agents or sub-agent protocols exist. |
| Long-term memory | `harness.db`, `docs/GUARDRAILS.md`, `docs/decisions/*`, `docs/stories/*`, `docs/HARNESS_BACKLOG.md`, `docs/GLOSSARY.md` | Covered | Durable records, guardrails, and markdown decisions preserve task history and project vocabulary. |

## File Inventory

Every tracked project file plus the Phase 2 input file is mapped to at least
one Runtime Substrate responsibility.

| File | Primary Responsibility | Secondary Responsibilities |
| --- | --- | --- |
| `.gitignore` | Tool access | Task state |
| `AGENTS.md` | Context selection | Task specification, permissions |
| `README.md` | Task specification | Project memory |
| `CONTRIBUTING.md` | Intervention recording | Project memory |
| `Cargo.toml` | Tool access | Verification |
| `Cargo.lock` | Tool access | Verification |
| `PHASE2.md` | Task specification | Observability, context selection |
| `PHASE3.md` | Task specification | Observability, verification, entropy auditing |
| `PHASE4.md` | Task specification | Verification, observability, task state |
| `crates/harness-cli/Cargo.toml` | Tool access | Verification |
| `crates/harness-cli/src/main.rs` | Tool access | Tool implementation |
| `crates/harness-cli/src/domain.rs` | Tool access | Task state, verification |
| `crates/harness-cli/src/application.rs` | Tool access | Task state |
| `crates/harness-cli/src/infrastructure.rs` | Tool access | Project memory, task state, observability |
| `crates/harness-cli/src/interface.rs` | Tool access | Context selection, verification |
| `docs/ARCHITECTURE.md` | Permissions | Context selection, task specification |
| `docs/ARTIFACTS.md` | Task specification | Context selection |
| `docs/FEATURE_INTAKE.md` | Task specification | Permissions, context selection |
| `docs/GLOSSARY.md` | Project memory | Context selection |
| `docs/GUARDRAILS.md` | Project memory | Permissions, context selection |
| `docs/HARNESS.md` | Task specification | Project memory, task state, permissions |
| `docs/HARNESS_BACKLOG.md` | Entropy auditing | Project memory, failure attribution |
| `docs/HARNESS_COMPONENTS.md` | Failure attribution | Observability, entropy auditing |
| `docs/HARNESS_MATURITY.md` | Entropy auditing | Observability, verification |
| `docs/CONTEXT_RULES.md` | Context selection | Permissions, task specification |
| `docs/TRACE_SPEC.md` | Observability | Failure attribution, intervention recording |
| `docs/README.md` | Project memory | Context selection |
| `docs/TEST_MATRIX.md` | Verification | Task state |
| `docs/decisions/0001-harness-first-development.md` | Project memory | Permissions |
| `docs/decisions/0002-post-spec-product-lifecycle.md` | Project memory | Task specification |
| `docs/decisions/0003-generic-spec-intake-harness.md` | Project memory | Task specification |
| `docs/decisions/0004-sqlite-durable-layer.md` | Project memory | Observability, task state |
| `docs/decisions/0005-prebuilt-rust-harness-cli.md` | Project memory | Tool access |
| `docs/decisions/README.md` | Project memory | Context selection |
| `docs/demo/README.md` | Task specification | Project memory |
| `docs/product/README.md` | Task specification | Project memory |
| `docs/review-fixes-1d30bf62-to-main.md` | Intervention recording | Failure attribution, verification |
| `docs/stories/README.md` | Task specification | Project memory |
| `docs/stories/US-001-install-harness.md` | Task specification | Verification, intervention recording |
| `docs/stories/US-008-trace-quality-scoring.md` | Task specification | Observability, verification |
| `docs/stories/US-009-enriched-friction-query.md` | Task specification | Failure attribution, observability |
| `docs/stories/US-011-backlog-outcome-workflow.md` | Task specification | Entropy auditing, project memory |
| `docs/stories/backlog.md` | Task specification | Project memory |
| `docs/stories/epics/README.md` | Task specification | Project memory |
| `docs/stories/epics/E01-durable-layer/US-002-rust-harness-cli/overview.md` | Task specification | Project memory |
| `docs/stories/epics/E01-durable-layer/US-002-rust-harness-cli/design.md` | Task specification | Tool access, permissions |
| `docs/stories/epics/E01-durable-layer/US-002-rust-harness-cli/execplan.md` | Task specification | Verification, task state |
| `docs/stories/epics/E01-durable-layer/US-002-rust-harness-cli/validation.md` | Verification | Intervention recording |
| `docs/stories/epics/E02-phase-2-observability-taxonomy/phase-2-progress.md` | Task state | Intervention recording |
| `docs/templates/decision.md` | Project memory | Task specification |
| `docs/templates/spec-intake.md` | Task specification | Context selection |
| `docs/templates/story.md` | Task specification | Verification |
| `docs/templates/validation-report.md` | Verification | Intervention recording |
| `docs/templates/high-risk-story/overview.md` | Task specification | Context selection |
| `docs/templates/high-risk-story/design.md` | Task specification | Permissions |
| `docs/templates/high-risk-story/execplan.md` | Task state | Verification |
| `docs/templates/high-risk-story/validation.md` | Verification | Failure attribution |
| `scripts/README.md` | Tool access | Context selection |
| `scripts/bin/harness-cli` | Tool access | Task state, observability |
| `scripts/bin/harness-cli` | Tool access | Task state, observability |
| `scripts/install-harness.sh` | Tool access | Permissions |
| `scripts/build-harness-cli-release.sh` | Verification | Tool access |
| `scripts/schema/001-init.sql` | Task state | Observability, project memory |
| `scripts/schema/002-story-verify.sql` | Verification | Task state, project memory |
| `scripts/schema/003-guardrails.sql` | Project memory | Task state, observability |
| `.github/ISSUE_TEMPLATE/agent-failure-case.md` | Failure attribution | Entropy auditing |
| `.github/ISSUE_TEMPLATE/pattern-request.md` | Entropy auditing | Intervention recording |
| `.github/ISSUE_TEMPLATE/real-world-example.md` | Project memory | Intervention recording |
| `.github/workflows/harness-cli-release.yml` | Verification | Tool access |

## Coverage Summary

- Covered: 5/11 responsibilities.
- Partial: 6/11 responsibilities.
- Missing: 0/11 responsibilities.

Covered responsibilities:

- Task specification.
- Context selection.
- Project memory.
- Task state.
- Verification.
Partial responsibilities:

- Tool access.
- Observability.
- Failure attribution.
- Permissions.
- Entropy auditing.
- Intervention recording.

Phase 3 begins converting the partial observability areas into measurable
checks: trace quality can be scored, friction output includes task context, and
backlog improvements can compare predicted impact with actual outcome. Later
phases should focus on benchmark ingestion, component-level attribution, and
verification orchestration.
