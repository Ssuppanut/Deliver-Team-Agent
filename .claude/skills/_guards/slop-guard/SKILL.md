---
name: slop-guard
layer: _guards
description: >
  Design-quality gate that catches the generic "AI slop" look the other guards
  miss — emoji standing in for real icons, and state shown by color alone. Use
  on every generated output. Do NOT use for accessibility correctness or the
  token contract — those are the a11y-guard and token-guard skills.
---

# slop-guard

The fourth guard. a11y/token/perf cover correctness, contract, and weight;
this one covers *taste*. Its rationale and full checklist live in
`knowledge/anti-slop`.

## Checks (`scripts/check.mjs` — `checkSlop(ir, results)`)

| rule | severity | trigger |
|------|----------|---------|
| `no-emoji` | serious | emoji/pictograph in generated output — use an icon token |
| `status-color-only` | minor | a variant that swaps only color-family slots, with no per-state icon — state must survive grayscale/CVD |

`no-emoji` blocks the gate; `status-color-only` is advisory (it informs without
failing, because visible text can already carry the state).

## Why it exists

A design system that emits emoji or distinguishes severity by color alone reads
as machine-generated and fails colorblind users. These are cheap to detect at
the IR/output level and expensive to notice later.

## Run

```bash
node _shared/scripts/e2e-multi.mjs --feature <name>   # includes slop-guard
```
