# Intake and Risk

Intake helps determine what context and proof a task needs. It is a reasoning aid, not a mandatory gateway to code.

For routine work, classification can remain lightweight: identify the affected surface, meaningful risk, and closing proof, then proceed. Record a durable intake when classification must survive a session, support a handoff, link a work packet, or make high-risk scope explicit.

The human does not need to name a lane. Infer the smallest safe lane from semantic risk and blast radius.

## Intake Questions

Answer only what helps the task:

- What outcome is requested?
- What contract or invariant may change?
- What context is relevant now?
- What proof would support completion?
- Is ambiguity consequential enough to ask before implementation?

## Lanes

Lanes control context and proof depth. They do not encode business priority.

### Tiny

Use for narrow, low-risk edits such as copy, names, localized docs, or small implementation changes with an obvious contract and proof path.

Expected behavior:

- patch directly;
- read the affected source and nearby contract;
- run available focused checks;
- report any unverified gap.

A file change alone does not require a durable intake, packet, or trace.

### Normal

Use for bounded behavior changes whose blast radius is understood.

Expected behavior:

- preserve explicit contracts and adjacent behavior;
- run direct proof plus relevant regression checks;
- create a work packet only when durable acceptance tracking, coordination, or multi-session continuity is useful;
- update validation expectations when the contract changes.

### High-risk

Use when failure could materially affect security, authorization, data, public contracts, external systems, or broad existing behavior.

Expected behavior:

- retrieve the relevant architecture, decision, contract, and validation sources;
- make acceptance and validation evidence explicit;
- ask for confirmation before implementation when consequential direction is ambiguous;
- record a durable decision only when future work must inherit the choice.

A large folder or detailed trace is not automatically required. Match the artifact to the information that must persist.

## High-Risk Triggers

Treat these as strong escalation signals:

- authentication, authorization, tenant or role boundaries;
- data loss, migrations, retention, or ownership;
- audit, privacy, secrets, or sensitive access;
- payments, email, queues, webhooks, provider SDKs, or other external effects;
- public API or client-visible contract changes;
- weakening or removing validation;
- broad changes to established or test-covered behavior.

Other factors such as weak proof, cross-platform behavior, or multiple domains can raise the lane when they materially increase uncertainty or blast radius. Do not count flags mechanically when the semantic risk is already clear.

## Durable Intake

When a durable intake is useful, record the smallest useful summary:

```bash
scripts/bin/harness-cli intake \
  --type <type> \
  --summary <outcome> \
  --lane <tiny|normal|high-risk> \
  --context <relevant-paths> \
  --packet <optional-packet-id>
```

The result should make the lane, relevant context, expected proof, and consequential open questions clear. It need not restate the full user request.
