## Summary

Add Vitest as the test framework for `packages/chrome-extension/`, wire up a `chrome.storage.sync` in-memory mock, harden the Manifest V3 CSP, and ship a sample test that verifies the entire setup end-to-end. This is the foundation PR (PR 8 in the Robust Chrome Extension series) that all future browser-side unit tests build on.

## Motivation

The Chrome Extension package had no test runner at all. Every subsequent PR in this series (retry utility, Qdrant config validation, IndexedDB vector store) needs a working test environment before tests can be written. Rather than bolt tests onto each of those PRs ad-hoc, this PR establishes:

- A single, agreed-upon test runner (Vitest — no Babel, fast cold start, native ESM)
- A `chrome.*` API mock that lets extension code run under Node/happy-dom
- A green baseline (9/9 passing) to merge before sibling PRs add coverage

## Changes

**`packages/chrome-extension/package.json`**
- Added scripts: `test`, `test:watch`, `test:coverage`
- Added devDependencies: `vitest ^2.0.0`, `@vitest/coverage-v8 ^2.0.0`, `happy-dom ^14.0.0`

**`packages/chrome-extension/vitest.config.ts`** *(new)*
- Environment: `happy-dom` (DOM APIs without a real browser)
- Globals: `true` (no import boilerplate in test files)
- Setup file: `src/__tests__/setup.ts`

**`packages/chrome-extension/src/__tests__/setup.ts`** *(new)*
- Attaches a fully in-memory `chrome.storage.sync` mock to `globalThis.chrome`
- Implements `get` (string / array / object-with-defaults / null), `set`, `remove`, `clear`
- Fires `chrome.storage.onChanged` listeners on every mutation
- Exports `syncStore` and mock references for direct test assertions

**`packages/chrome-extension/src/__tests__/sample.test.ts`** *(new)*
- 9 tests across two suites:
  - `Test framework bootstrap`: confirms happy-dom `window`/`document` and `chrome` global are present
  - `chrome.storage.sync mock`: round-trip get/set, defaults, remove, clear, onChanged listener, spy assertions

**`packages/chrome-extension/src/manifest.json`**
- Added `object-src 'self'` to the existing `content_security_policy.extension_pages` value to fully satisfy MV3 requirements

## Test plan

- [x] `pnpm install` — vitest + happy-dom resolved cleanly
- [x] `pnpm --filter chrome-extension typecheck` — `tsc --noEmit` exits 0
- [x] `pnpm --filter chrome-extension test` — 9/9 tests pass, 294 ms

```
 ✓ src/__tests__/sample.test.ts (9 tests) 3ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  294ms
```

## Notes for reviewers

- **Why Vitest over Jest?** No Babel transform needed, native TypeScript via esbuild, faster startup. The existing webpack build is unaffected — vitest is devDep only.
- **Real tests deferred intentionally.** `retryWithBackoff`, `validateQdrantConfig`, and `IndexedDbVectorStore` each live in a sibling PR that hasn't landed yet. Adding their tests here would require duplicating the source files, which bloats the diff and creates merge conflicts. Tests for those modules will be added in their respective PRs (or a follow-up) once the source files are on master.
- **`fake-indexeddb` not added.** Skipped since there are no IndexedDB tests in this PR. Will be added in the IndexedDB PR (PR 7).
- **CSP note — `host_permissions` wildcards.** `manifest.json` includes `"http://*/*"` and `"https://*/*"` in `host_permissions`. These are likely required for user-configured Qdrant/Milvus endpoints (arbitrary hostnames), but they are broad. Recommend a follow-up issue to scope these down once the set of required origins is known.
- **`'wasm-unsafe-eval'` retained.** The existing CSP already included this for WASM (used by the ONNX embedding model). It is preserved unchanged.
- **CJS Vite deprecation warning.** Vitest 2.x prints a harmless CJS Node API deprecation notice from Vite's internals. This does not affect test results and will be resolved when Vitest drops its own CJS build in a future release.
