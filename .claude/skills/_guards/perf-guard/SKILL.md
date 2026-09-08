---
name: perf-guard
layer: _guards
description: >
  Guards against output bloat and dead imports. Static tier is a cheap
  structural heuristic; bundle-size (esbuild) and Web Vitals (Playwright) tiers
  run in 06-verify. Use on every generated output.
---

# perf-guard

Cheap structural checks now; expensive measurement in 06-verify.

## Static checks (`scripts/check.mjs` — `checkPerf(ir, results)`)

- **dead-icon-import** (minor): an icon library is imported but no icon used.
- **output-bloat** (minor): line count exceeds `12 + nodeCount * 8`, a rough
  budget scaled to the IR node count.

Static findings are advisory (minor); they never block the gate on their own.

## Deferred tiers (06-verify)

- **Bundle size:** esbuild the web output, compare against a per-component budget.
- **Web Vitals:** Playwright measures LCP/CLS/INP on the rendered story.

## Run

```bash
node _shared/scripts/e2e-multi.mjs --feature <name>   # includes static perf
```
