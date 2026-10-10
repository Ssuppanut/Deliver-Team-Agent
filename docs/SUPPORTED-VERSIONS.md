# Supported versions

The versions the generated code is tested against. This page states facts only. Before TS-1 no version of any
framework or tool was declared anywhere in the repository.

## Policy

| Adapter | Framework version | Type or compile tooling the gate uses | Locked in this repository | Enforced by a gate today |
|---|---|---|---|---|
| React | React 19 (`react` 19.3.0, `@types/react` 19.3.0), `lucide-react` 1.54.0 | TypeScript ^6 (6.0.3), compiler API | yes: `package.json` and `package-lock.json` | yes: `_shared/scripts/check-ts-typecheck.mjs` (TS-1) |
| React Native | React Native 0.87 (0.87.1 types) | TypeScript ^6 | no | declared, gate pending |
| Vue | Vue 3.5 (3.5.43), `vue-tsc` 3.3.12 | `vue-tsc` on TypeScript ^6, and the Vue compiler | no | declared, gate pending |
| Svelte | Svelte 5 (5.57.2), the legacy `export let` syntax stays; `svelte-check` 4.7.6 | `svelte-check` on TypeScript ^6, and the Svelte compiler | no | declared, gate pending |

- **TypeScript ^6.** TypeScript 7 is not supported yet: with 7.0.2, `vue-tsc` fails to start
  (`ERR_PACKAGE_PATH_NOT_EXPORTED ./lib/tsc`) and `svelte-check` rejects it (its peer range is `^5 || ^6`).
- **Older majors.** React 18 and Svelte 4 are not tested and not claimed.
- **Node.** Node 20 and Node 22 (the CI matrix in `.github/workflows/ci.yml`).
- **Deprecated icon packages.** `lucide-vue-next` and `lucide-svelte` are deprecated upstream in favour of
  `@lucide/vue` and `@lucide/svelte`. This repository does not change them here.

## What "enforced by a gate" means

Only React is enforced in TS-1. The gate reads `_shared/policy/ts-typecheck-adapters.yaml`: an adapter with
`enabled: false` prints a `NOT ENABLED` line with its reason and expiry on every run, and the entry fails CI once
its expiry has passed. The other three adapters are listed there with the number of corpus files that fail the real
type-check or compiler (React Native 28 of 54, Vue 15 of 54, Svelte 14 of 54); their fixes are planned in their
own PRs. Their versions in the table above are the ones the type-check probe used; they are not yet locked in
`package.json`.

## Scope rule

The gate checks the corpus feature outputs under `out/react` (the 54 feature directories `ci.mjs` generates). It
does not check the pin artefact directories `out/react/verify-*` and `out/react/_verify`: those are written by
`verify-patches` (its pins generate into them to read the text), they are copies or variants of corpus output,
and checking them would count one defect once per copy. The SwiftUI gate (F-31) uses the same rule.

## Related

- `docs/BREADTH-MATRIX.md`, section TS-1: the finding, the causes, the fixes and the gate rules.
- `docs/VERIFICATION-LAYERS.md`: what runs where.
