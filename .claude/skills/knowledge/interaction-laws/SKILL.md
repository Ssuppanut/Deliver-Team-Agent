---
name: interaction-laws
layer: knowledge
description: >
  Quantitative interaction principles — Fitts, Hick, Miller, Doherty, and
  feedback-timing thresholds — used to justify sizing, grouping, and feedback
  decisions. Consult during design.
---

# interaction-laws

The measurable side of interaction design.

## Laws

- **Fitts's Law:** time to a target grows with distance / shrinks with size.
  Keep primary actions large and close; respect ≥24px targets (WCAG 2.2).
- **Hick's Law:** decision time grows with the number of choices. Limit options;
  group and progressively disclose.
- **Miller's Law:** ~7±2 items in working memory. Chunk lists and forms.
- **Doherty Threshold:** keep system response < 400ms, or show progress.
- **Feedback timing:** < 100ms feels instant; 100ms–1s needs no spinner but
  benefits from a state change; > 1s needs explicit progress + `aria-live`.

## Applied

These inform variant/state design (loading/empty/error), target sizing in token
choices, and where a live region belongs — all expressible in the design-spec.
