---
name: storybook-authoring
layer: design-system
description: >
  Generates Storybook stories (CSF + MDX docs) for web adapters, wired for the
  visual-regression and dynamic-a11y tiers in 06-verify. Use when a component
  needs stories or docs.
  Do NOT use it to run the verification tiers — that is the 06-verify skill.
---

# storybook-authoring

Stories are both documentation and the substrate `06-verify` renders against.

## Emits

- `<Component>.stories.tsx` (CSF3) per web adapter (react/vue/svelte).
- `stories/<Component>.mdx` — the docs page for the handoff bundle.
- One story per variant + state (default / loading / error / empty) so visual
  regression and axe-core cover the matrix.

## Wiring to verification

`06-verify` points Playwright at the running Storybook (`STORYBOOK_URL`) to:
- run axe-core per story (dynamic a11y),
- screenshot per story for pixelmatch visual regression.

## Setup (optional deps)

```bash
npm install --save-dev @storybook/react @storybook/vue3 @storybook/svelte
```
