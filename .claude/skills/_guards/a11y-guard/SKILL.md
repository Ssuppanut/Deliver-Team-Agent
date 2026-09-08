---
name: a11y-guard
layer: _guards
description: >
  Non-negotiable accessibility gate. Static tier walks the IR for baseline
  contracts (alt text, button names, labels, heading levels); dynamic tier runs
  axe-core via Playwright in 06-verify. Use on every generated output.
---

# a11y-guard

Enforces accessibility contracts. A serious/critical finding blocks the gate.

## Tiers

1. **Static (spec):** `scripts/check.mjs` — `checkA11y(ir)`. Runs in `e2e-multi`.
2. **Source:** ARIA attributes / roles present in generated code.
3. **Dynamic:** axe-core via Playwright against the rendered Storybook story
   (06-verify). Catches contrast, focus order, live-region issues.

## Rules (static)

| rule                | severity | trigger |
|---------------------|----------|---------|
| `img-alt`           | serious  | media without `alt` |
| `button-name`       | serious  | action without label or icon |
| `icon-button-name`  | moderate | icon-only action without aria-label |
| `label`             | serious  | input without accessible label |
| `heading-level`     | moderate | heading missing `level` |
| `link-href`         | moderate | link without `href` |

## Waivers

Only with an explicit expiry date and an approver. No open-ended waivers.

## Run

```bash
node _shared/scripts/e2e-multi.mjs --feature <name>   # includes static a11y
```
