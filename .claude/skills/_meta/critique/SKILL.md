---
name: critique
layer: _meta
description: >
  Adversarial self-review pass over a design-spec or generated output before it
  reaches guards. Mentally traces the pipeline to surface bugs early. Use after
  design and before implement, or when output looks suspicious.
---

# critique

A structured second look. Empirically (see project learnings) a mental trace of
the pipeline finds ~30% of bugs before anything runs.

## Checklist

**Spec tier**
- Every element that renders text has a resolvable `text`/`label`.
- Every `ref`/`expr` names a prop that exists in `props`.
- Every token in `style` exists in the registry.
- Iteration `each.items` is an `array` prop; `each.key` is a field of `itemShape`.

**Cross-adapter tier**
- Does an `expr` rely on JS-only semantics? Native adapters can only reference
  identifiers — flag it as a documented limitation, not a silent divergence.
- Reserved-word collisions (SwiftUI `default`, `case`; Kotlin soft keywords).
- Does an item shape carry `id`? If not, native identity must be synthesized.

**A11y tier**
- Icon-only actions carry a label.
- Media carries alt. Inputs carry a label. Live regions where state changes.

## Contract

- **Input:** `design-spec.yaml` (+ optionally generated `out/`).
- **Output:** a ranked issue list (critical / serious / moderate / minor).
- Findings that recur should become checks in `verify-patches.mjs`.
