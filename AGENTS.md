# Agent Workflow

## Repository workflow

- Do not push directly to `main`.
- Put all code changes on a feature branch.
- Push the feature branch and open a GitHub PR.
- Wait for review/status check to complete before merging.
- If review requests changes, update the same branch/PR and re-run or request review again as needed.
- Merge to `main` only after review/status is acceptable.

## Before opening a PR

- Keep changes scoped to the request.
- Run `npx tsc --noEmit`.
- Run `npx biome check <changed files>` when TypeScript/Markdown files changed.
- Do not commit local scratch files, generated test output, or memory load-test data.
