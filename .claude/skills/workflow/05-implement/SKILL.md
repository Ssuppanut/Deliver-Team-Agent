---
name: 05-implement
layer: workflow
description: >
  Runs spec-to-ir then the 6 adapters to emit production code, and applies the
  guards. This is the code-generation step. Use once a design-spec validates.
  Do NOT use it for deep verification like axe-core or visual regression — that is the 06-verify skill.
---

# 05-implement

Turn the spec into code across all targeted platforms.

## What runs

`spec-to-ir.mjs` normalizes the spec to IR, then each adapter's `generate.mjs`
(all extending `adapters/_shared/renderer-base.mjs`) emits into
`out/<adapter>/<feature>/`. Guards run on every output.

## One command

```bash
node _shared/scripts/e2e-multi.mjs --feature <name>
```

Runs: validate -> IR -> react | vue | svelte | react-native | swiftui | compose
-> a11y/token/perf guards -> cross-adapter parity -> report.

## Outputs

- Code: `out/<adapter>/<feature>/`
- Report: `out/_reports/<feature>.json`

## Next

`06-verify`.
