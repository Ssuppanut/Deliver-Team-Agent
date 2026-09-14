---
name: design-principles
layer: knowledge
description: >
  Reference for visual and structural design fundamentals — hierarchy,
  proximity, contrast, rhythm, and token discipline. Consult during architecture
  and design steps.
  Do NOT use it for accessibility specifics — that is the universal-design skill.
---

# design-principles

Grounding for `03-architect` and `04-design` decisions.

## Core

- **Hierarchy:** size, weight, and color establish reading order. Headings carry
  a `level`; visual weight follows semantic weight.
- **Proximity (Gestalt):** related elements share a container; spacing encodes
  grouping. Outer containers get proportionally more space than inner ones.
- **Contrast:** foreground/background pairs must meet WCAG AA; use semantic
  `fg`/`bg` token pairs designed to satisfy it.
- **Rhythm:** spacing comes from the token scale (`space.*`), never ad hoc px.
- **Token discipline:** components consume semantic tokens only. Raw values are a
  token-guard failure.

## Applied to the pipeline

Every visual decision resolves to a semantic token, so the same intent renders
consistently across all 6 platforms.
