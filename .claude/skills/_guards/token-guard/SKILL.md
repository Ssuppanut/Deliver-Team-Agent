---
name: token-guard
layer: _guards
description: >
  Enforces the token contract: every referenced token exists in the built
  registry, and no generated web output contains hardcoded colors or dimensions.
  Use on every generated output.
---

# token-guard

Keeps the design-token contract intact end to end.

## Checks (`scripts/check.mjs` — `checkTokens(ir, results)`)

1. **Registry membership:** every `ir.tokens` entry exists in
   `_shared/tokens/registry.json`. Missing -> serious.
2. **No hardcoded color:** web outputs (react/vue/svelte) must not contain raw
   hex. Raw hex -> serious.
3. **No hardcoded dimension:** raw `: NNpx` in web output -> moderate.
4. **Unmapped tokens:** adapter `unmapped token` warnings -> moderate.

Native adapters resolve tokens through generated `DesignTokens.swift` /
`DesignTokens.kt` / `tokens-rn.ts`, so the hex/px scan is web-only by design.

## Prerequisite

Run the token build first, or the registry check fails:

```bash
node design-system/tokens-dtcg/scripts/build.mjs
```
