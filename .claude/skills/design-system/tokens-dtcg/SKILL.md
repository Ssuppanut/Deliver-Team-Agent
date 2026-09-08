---
name: tokens-dtcg
layer: design-system
description: >
  Builds DTCG token sources (core -> semantic -> icons) into a resolved registry
  and 6 platform outputs (CSS, Tailwind, TS, Swift, Kotlin, RN). Use to
  (re)generate design tokens for all platforms.
---

# tokens-dtcg

The token compiler. DTCG JSON in, platform tokens out.

## Sources (`_shared/tokens/source/`)

- `core.tokens.json` — primitives (raw values only).
- `semantic.tokens.json` — aliases core via `{reference}`; components use ONLY these.
- `icons.tokens.json` — platform-neutral icon names + per-platform `$extensions`.

## Build

```bash
node design-system/tokens-dtcg/scripts/build.mjs
```

Resolves alias chains (with circular-reference detection) and emits into
`_shared/tokens/`:

| output | consumer |
|--------|----------|
| `registry.json` | token-guard (source of truth) |
| `tokens.css` | react / vue / svelte (CSS custom properties) |
| `tailwind-theme.js` | Tailwind `theme.extend` |
| `tokens.d.ts` | TypeScript token-name union |
| `DesignTokens.swift` | SwiftUI |
| `DesignTokens.kt` | Compose |
| `tokens-rn.ts` | React Native |

## Rule

Run this before any generation — guards fail if `registry.json` is stale/missing.
