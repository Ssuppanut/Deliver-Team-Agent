---
name: 06-verify
layer: workflow
description: >
  Deep verification tier — dynamic a11y (axe-core), visual regression
  (pixelmatch), bundle size (esbuild), Web Vitals (Playwright), and cross-adapter
  parity. Produces verify-report.yaml. Use before handoff.
  Do NOT use it to assemble the handoff bundle — that is the 07-handoff skill.
---

# 06-verify

The heavyweight gate that runs beyond the static guards in `05-implement`.

## Tiers

- **Dynamic a11y:** axe-core via Playwright on the rendered Storybook story.
- **Visual regression:** pixelmatch generated render vs. baseline
  (`.claude/artifacts/<feature>/baselines/<adapter>/*.png`; diffs to `diffs/`).
- **Bundle size:** esbuild the web output against a budget.
- **Web Vitals:** LCP / CLS / INP thresholds.
- **Parity:** public-API drift across the 6 adapters.

## Output: `.claude/artifacts/<feature>/verify-report.yaml`

Conforms to `_shared/schemas/verify-report.schema.yaml`.

## Run

```bash
# static tier (always available)
node _shared/scripts/e2e-multi.mjs --feature <name>
# dynamic tier (needs Storybook running)
STORYBOOK_URL=http://localhost:6006 node workflow/06-verify/scripts/verify.mjs --feature <name>
# first-time baselines
node workflow/06-verify/scripts/verify.mjs --feature <name> --init-baselines
```

## Next

`07-handoff`.
