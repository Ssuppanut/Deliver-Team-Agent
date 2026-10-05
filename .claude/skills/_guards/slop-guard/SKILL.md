---
name: slop-guard
layer: _guards
description: >
  Design-quality gate that catches the generic "AI slop" look the other guards
  miss — emoji standing in for real icons, on every generated output.
  Do NOT use for accessibility correctness or the token contract — those are the
  a11y-guard and token-guard skills. (State-by-colour-only is now an a11y-guard
  contract, not a slop advisory — see below.)
---

# slop-guard

The fourth guard. a11y/token/perf cover correctness, contract, and weight;
this one covers *taste*. Its rationale and full checklist live in
`knowledge/anti-slop`.

## Checks (`scripts/check.mjs` — `checkSlop(ir, results)`)

| rule | severity | trigger |
|------|----------|---------|
| `no-emoji` | serious | emoji/pictograph in generated output — use an icon token |

`no-emoji` blocks the gate.

### Moved (F-22): `status-color-only`

State conveyed by colour alone was previously an advisory `status-color-only`
rule here (minor, non-blocking). It is now a **blocking a11y correctness
contract** in **a11y-guard**, keyed off `variant.intent` (`status` vs
`emphasis`): a `status` variant must distinguish every pair of states by a
non-colour cue (icon / text / shape / sign), and an `emphasis` label on a
status-vocabulary enum fails as a mislabel. The rule name (`status-color-only`)
is unchanged; only its home and severity moved. The duplicate was deleted from
slop-guard so there is one source of truth.

## Why it exists

A design system that emits emoji or distinguishes severity by color alone reads
as machine-generated and fails colorblind users. These are cheap to detect at
the IR/output level and expensive to notice later.

## Run

```bash
node _shared/scripts/e2e-multi.mjs --feature <name>   # includes slop-guard
```
