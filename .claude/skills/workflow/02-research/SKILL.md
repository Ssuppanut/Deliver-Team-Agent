---
name: 02-research
layer: workflow
description: >
  Optional step. Researches established patterns, a11y semantics, and platform
  conventions for an unfamiliar component before architecting. Use when the
  pattern is novel or the correct ARIA/interaction model is unclear.
---

# 02-research

Consulted only when the component pattern is unfamiliar. Grounds the design in
established practice rather than invention.

## Sources (in-repo first)

- `knowledge/pattern-library` — known component patterns + refusal rationale.
- `knowledge/universal-design` — WCAG-aligned a11y semantics.
- `knowledge/interaction-laws` — Fitts, Hick, and interaction timing.

## Output

A short findings note appended to `brief.yaml` under `research:` — the chosen
ARIA role, keyboard model, and any platform-specific caveats.

## Next

`03-architect`.
