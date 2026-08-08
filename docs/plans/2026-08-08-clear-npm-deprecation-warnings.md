---
title: Clear npm Deprecation Warnings - Plan
type: chore
date: 2026-08-08
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Clear npm Deprecation Warnings - Plan

## Goal Capsule

**Objective.** Remove the deprecation warnings that a fresh `npm install @zilliz/claude-context-mcp` emits, for every warning that is under this project's control, without changing runtime behavior.

**Authority.** User-directed scope: issue #377 is the sole work item. The prior analysis turn selected #377 and its proposed fix (dep hygiene) as the accepted approach.

**Stop conditions.** Warnings clearable from this repo are gone (`glob`, `prebuild-install`). Transitive warnings from upstream majors (`q`, `node-domexception`, `uuid`) are documented as non-goals. No direct dependency version is bumped to a breaking major.

**Execution profile.** Lightweight, single unit, code plan.

## Product Contract

### Summary

`@zilliz/claude-context-core` declares `glob@^10.0.0` and `faiss-node@^0.5.1` as direct dependencies. Neither is imported anywhere in the repository. `glob@10` is itself deprecated, and `faiss-node` pulls deprecated `prebuild-install`. Removing the two unused dependencies clears 2 of the 6 warnings from issue #377 with zero runtime risk.

### Problem Frame

Downstream consumers (e.g. Docker images running `npm install @zilliz/claude-context-mcp`) see 6 `npm warn deprecated` lines on every fresh install. Five distinct packages are implicated: `q`, `prebuild-install`, `node-domexception`, `glob`, `uuid`. Only `glob` is a direct dependency of this project, per the issue. Research shows `prebuild-install` is also clearable because `faiss-node` is unused.

### Requirements

R1. Remove the unused direct dependency `glob` from `packages/core/package.json`.

R2. Remove the unused direct dependency `faiss-node` from `packages/core/package.json` and its entry in `pnpm-workspace.yaml` `ignoredBuiltDependencies`.

R3. The lockfile must reflect the removals, and the core package must still build, typecheck, and pass its test suite.

### Scope Boundaries

- In scope: dependency manifest hygiene only (`packages/core/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`).
- Not in scope: bumping `glob` to `^11` (dependency is unused; removal supersedes a bump).
- Not in scope: `q` (via `@zilliz/milvus2-sdk-node@2.x` → `@shanghaikid/parquetjs@1.8.8` → `thrift@0.23.0` → `q@^1.5.0`; only milvus2-sdk-node 3.x would clear it, a breaking major).
- Not in scope: `uuid` (all `langchain@0.3.x` pins `uuid@^10`; only langchain 1.x would clear it, a breaking major).
- Not in scope: `node-domexception` (via `@google/genai@1.x` chain; only genai 2.x would clear it, a breaking major).
- Not in scope: pnpm `overrides` — they affect the repo's own install only, not the published tarball that downstream `npm install` consumers see.

### Dependencies

- pnpm >= 10 for lockfile operations.

### Sources

- Issue #377 with reproduced warning chains.
- `npm view` research: `@shanghaikid/parquetjs@1.8.8` → `thrift@0.23.0` → `q@^1.5.0`; `@langchain/core` 0.3.x pins `uuid@^10`; `faiss-node@0.5.1` is the latest published version.

## Planning Contract

### Key Technical Decisions

KTD1. Remove unused dependencies instead of bumping them. (session-settled: user-approved — chosen over bumping `glob` to `^11`: removal has zero API-compatibility risk because neither package is imported anywhere in the repo; verified by repository-wide import search.)

KTD2. Do not use pnpm `overrides` to silence the remaining warnings. (chosen over adding override entries: overrides only change the repo's own install and are ignored by downstream `npm install` of the published package, so they would not fix the reported symptom.)

### Assumptions

- Neither `glob` nor `faiss-node` is referenced in build scripts, configs, or tests. Verified by repository-wide search; implementer must re-verify before removing.
- Removing a dependency cannot change runtime behavior since it is unused.

## Implementation Units

### U1. Remove unused dependencies `glob` and `faiss-node`

- **Goal.** Make `packages/core/package.json` and `pnpm-workspace.yaml` stop declaring the unused `glob` and `faiss-node` dependencies, and regenerate the lockfile.
- **Requirements.** R1, R2, R3.
- **Files.**
  - `packages/core/package.json`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
- **Approach.**
  1. Re-verify no import of `glob` or `faiss-node` exists anywhere in the repo (`grep -rn` across `packages/*/src`, `scripts/`, `examples/`, excluding `node_modules` and `dist`).
  2. Delete the two `dependencies` entries in `packages/core/package.json`.
  3. Delete the `faiss-node` entry from `ignoredBuiltDependencies` in `pnpm-workspace.yaml`.
  4. Run `pnpm install` to regenerate `pnpm-lock.yaml`.
  5. Run `pnpm --filter @zilliz/claude-context-core build`, `typecheck`, and `test`.
- **Test Scenarios.**
  - T1. `grep -rn "glob\|faiss" packages/core/src` returns no import statements.
  - T2. `pnpm why glob` and `pnpm why faiss-node` report no projects depend on them.
  - T3. Core package build, typecheck, and test suite pass with the removals.
  - T4. `pnpm install` output no longer mentions `glob` or `prebuild-install` deprecations.
- **Verification.** U1's Test Scenarios T1-T4; runs the repo commands from the Verification Contract.

## Verification Contract

Repo commands, run at `packages/core` unless noted:

- `pnpm install` (repo root) — must succeed; lockfile updated; no `glob`/`prebuild-install` deprecation warnings in output.
- `pnpm --filter @zilliz/claude-context-core build`
- `pnpm --filter @zilliz/claude-context-core typecheck`
- `pnpm --filter @zilliz/claude-context-core test`
- `pnpm why glob` and `pnpm why faiss-node` — must report no dependents.
- Optional downstream smoke check: `npm pack --dry-run` in `packages/core` and `npm install` of the tarball in a temp dir to confirm the two warnings are gone from a consumer install.

Quality gate: all commands exit 0, and the build output is unchanged in behavior (no source files modified).

## Definition of Done

Global done criteria:

- `packages/core/package.json` no longer declares `glob` or `faiss-node`.
- `pnpm-workspace.yaml` no longer lists `faiss-node` in `ignoredBuiltDependencies`.
- `pnpm-lock.yaml` updated and consistent (`pnpm install` makes no further changes).
- Core build, typecheck, and tests pass.
- No source (`.ts`) files changed; this is manifest-only work.
- No dead code or abandoned-attempt artifacts left in the diff (cleanup criterion).
