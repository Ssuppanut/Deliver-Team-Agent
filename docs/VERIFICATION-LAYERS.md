# Verification layers: what is claimed, what exists, what runs

Last verified: 2026-10-10 on `main` at `78a5f78d6176f773ff717924ec05c1ff8927736d` (merge of PR #34).

## How to read this

The README, skills and indexes describe several verification layers. This page records, for each one, whether
code for it exists in this repository and where it runs. It states facts only. Nothing here is a commitment or a
schedule.

Statuses (exactly one per row):

- **IMPLEMENTED**: code exists and runs in the pipeline (`node _shared/scripts/ci.mjs`) on Linux CI.
- **PARTIAL**: part of the described layer exists and runs; the rest does not exist.
- **PLANNED**: described in documentation, but no implementation exists in this repository.
- **MACOS-ONLY**: code exists and runs only on macOS; Linux CI prints `SKIPPED (not macOS)` and passes.

CI is `.github/workflows/ci.yml`: `npm ci`, then `node _shared/scripts/ci.mjs`, on `ubuntu-latest` with Node 20
and 22. The only declared dependencies are `ajv`, `ajv-formats` and `yaml` (`package.json`, `devDependencies`).

## The table

| Layer | What the docs claim | Status | Where it runs | Evidence | What exists instead, or next |
|---|---|---|---|---|---|
| Lowering Ledger | Every IR trait is expressed by each adapter or diverged under an approved, dated waiver | IMPLEMENTED | CI Linux | `_shared/scripts/ledger-gate.mjs`, called from `_shared/scripts/e2e-multi.mjs` | Checks that a lowering exists, not that the emitted value is right |
| Trait registry gate (D2) | Every schema construct has a ledger trait or a dated, approved untracked reason | IMPLEMENTED | CI Linux | `_shared/scripts/check-trait-registry.mjs`, `ci.mjs` step 1e | none |
| Corpus coverage gate (D3) | Every schema construct is exercised by a corpus spec or has a dated allowlist entry | IMPLEMENTED | CI Linux | `_shared/scripts/check-corpus-coverage.mjs`, `ci.mjs` step 1f | none |
| Live-lowering gate (F-28) | The emitted live-region fragment matches the per-adapter expectation table | IMPLEMENTED | CI Linux | `_shared/scripts/check-live-lowering.mjs`, `ci.mjs` step 1g | Compares emitted text with a table; the output is not parsed or compiled |
| Mutation harness with known survivors (D4b) | Mutants of generated output are caught by a gate, or listed as approved survivors | IMPLEMENTED | CI Linux | `_shared/scripts/mutate-gates.mjs`, `_shared/policy/mutation-known-survivors.yaml`, last step of `ci.mjs` | Mutates generated output text only, never adapter source |
| Token-output gate (F-32) | Built token outputs hold real values, agree with each other and equal a fresh build | IMPLEMENTED | CI Linux | `_shared/scripts/check-token-outputs.mjs`, `ci.mjs` step 0 | See `docs/BREADTH-MATRIX.md`, section F-32 |
| SwiftUI typecheck gate (F-31) | Generated SwiftUI and `DesignTokens.swift` type-check with the real compiler | MACOS-ONLY | CI skipped on Linux; local on a Mac | `_shared/scripts/check-swift-typecheck.mjs`; on Linux `ci.mjs` prints `SKIPPED (not macOS): swiftui typecheck`; pins P145 and P146 are skipped on Linux | See `docs/BREADTH-MATRIX.md`, section F-31. Green Linux CI does not show that SwiftUI compiles |
| TypeScript typecheck gate (TS-1) | Generated TypeScript output type-checks with the real compiler | PARTIAL | CI Linux, for React only; react-native, vue and svelte are listed as NOT ENABLED with a dated expiry | `_shared/scripts/check-ts-typecheck.mjs`, `_shared/policy/ts-typecheck-adapters.yaml`, `ci.mjs` step 2c | Enabled for React only; see `docs/SUPPORTED-VERSIONS.md` and `docs/BREADTH-MATRIX.md`, section TS-1 |
| a11y-guard, IR and source tiers | Accessibility contracts on the spec and on the generated source | IMPLEMENTED | CI Linux | `.claude/skills/_guards/a11y-guard/scripts/check.mjs`, called from `e2e-multi.mjs` | String and regex checks on text; no rendering |
| a11y-guard, dynamic tier | axe-core through Playwright against a rendered Storybook story | PLANNED | nowhere | no axe-core or Playwright in `package.json` or `node_modules`; no script runs it | Static tiers above |
| token-guard | Token names exist in the registry; no raw colour or px literals in generated code | IMPLEMENTED | CI Linux | `.claude/skills/_guards/token-guard/scripts/check.mjs`, called from `e2e-multi.mjs` | Checks names; the F-32 gate checks values |
| perf-guard, static tier | Dead icon imports and an output line-count budget | IMPLEMENTED | CI Linux (advisory, never blocks) | `.claude/skills/_guards/perf-guard/scripts/check.mjs`, called from `e2e-multi.mjs` | A heuristic on text, not a measurement |
| Bundle size (esbuild) | esbuild the web output against a per-component budget | PLANNED | nowhere | no esbuild dependency; no code bundles generated output | perf-guard static tier |
| Web Vitals (Playwright) | LCP, CLS and INP thresholds on a rendered story | PLANNED | nowhere | no Playwright dependency; nothing renders output | none |
| Visual regression | pixelmatch of a render against baselines, diffs written to `diffs/` | PLANNED | nowhere | no `baselines` or `diffs` directory; no pixelmatch dependency | none |
| slop-guard, parity lints, native-code, declared-io, readiness | Design-quality, cross-adapter parity, native expression leaks, dropped declared props, unresolved TBD | IMPLEMENTED | CI Linux | `.claude/skills/_guards/slop-guard/scripts/check.mjs`, `checkParity` in `e2e-multi.mjs`, `_shared/scripts/output-guards.mjs`, `.claude/skills/_meta/critique/scripts/check-tbd.mjs` | Text and IR checks |
| 06-verify entry point and `verify-report.yaml` | `verify.mjs` runs the dynamic tiers and writes `verify-report.yaml` | PLANNED | nowhere | neither `workflow/06-verify/scripts/verify.mjs` nor `.claude/skills/workflow/06-verify/scripts/verify.mjs` exists; `.claude/skills/workflow/06-verify` holds only `SKILL.md`; `_shared/schemas/verify-report.schema.yaml` exists and no code reads it | `e2e-multi.mjs` writes `out/_reports/<feature>.json` |
| Storybook authoring | CSF stories and MDX docs per web adapter | PLANNED | nowhere | no `.storybook`, no `*.stories.*`, no `*.mdx` file in the repository | none |
| Handoff bundle | An 8-artifact bundle per feature under `.claude/artifacts/<feature>/handoff/` | PLANNED | nowhere | no `handoff` file or directory exists | none |

## What is not checked

Generated Vue, Svelte and React Native output is currently not parsed, type-checked, compiled or rendered by any
gate. Generated React output is type-checked by the TS-1 gate (TypeScript compiler API, corpus outputs only) and
is not rendered. Nothing in the repository executes generated output. Other gates read it as text.

A one-off type-check probe on `main` at `1f49d3d` ran the real tools (TypeScript, vue-tsc, svelte-check, the Vue
and Svelte compilers) on the 54 corpus outputs of each of those four adapters. 74 of the 216 files failed (React 17,
React Native 28, Vue 15, Svelte 14). The 17 React failures are fixed by TS-1; the other 57 remain. The probe lived in a temp directory and left nothing in the repository, so
these numbers can be reproduced only by repeating it.

For SwiftUI and tokens, the findings and fixes are recorded in `docs/BREADTH-MATRIX.md`: F-31 (generated SwiftUI
did not compile) and F-32 (token outputs held `[object Object]`).

Compose has no compile or type-check gate either.

## Updating this page

When a layer is added, change its row, its status and the evidence in the same change, and update the
"Last verified" line with the date and the commit it was checked on.
