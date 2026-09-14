---
name: pattern-library
layer: knowledge
description: >
  Catalog of known component patterns and the explicit refusal boundaries. Holds
  the rationale and redirects for out-of-scope categories (overlays, data tables,
  etc). Consulted by the orchestrator's refusal check.
  Do NOT use it for accessibility semantics — that is the universal-design skill.
---

# pattern-library

What the generator supports, and — just as important — what it refuses and why.

## In-scope patterns

Display cards, feedback (alerts/badges), form fields (controlled), single-level
lists (Strategy D). Each maps cleanly to the 8 IR element kinds.

## Refusal boundaries

The orchestrator (Step 2.5) refuses these and redirects to primitives:

- **Overlays** (modal, popover, tooltip, dropdown) -> see
  [`references/overlays.md`](references/overlays.md).
- **Complex data tables** (sort, virtualization, dynamic columns) -> see
  [`references/data-tables.md`](references/data-tables.md).
- Charts, rich-text editors, drag-and-drop -> named libraries per platform.

## Why refuse

A bounded generator that does composition, variants, controlled state, and
iteration excellently beats one that half-implements overlays across 6 diverging
platforms. Explicit scope is the feature.
