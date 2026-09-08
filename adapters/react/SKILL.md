---
name: adapter-react
layer: adapters
platform: web
description: >
  React adapter (reference implementation). Renders the IR to typed, accessible
  .tsx, tokens as CSS custom properties, icons from lucide-react. Use to
  generate React components.
---

# adapter-react

The reference adapter. Extends `adapters/_shared/renderer-base.mjs`.

## Emits

`out/react/<feature>/<Component>.tsx` — a typed function component with a
`Props` interface, tokens via `var(--...)`, icons from `lucide-react`.

## Mapping

- tokens: `token-map.mjs` -> CSS custom properties.
- icons: `icon-map.mjs` -> lucide-react component names.
- iteration: `.map()` wrapped in a keyed `React.Fragment`.
- conditional: `{when && (...)}`.

## Run

```bash
node adapters/react/generate.mjs <spec.yaml> <feature>
```
