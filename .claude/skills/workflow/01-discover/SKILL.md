---
name: 01-discover
layer: workflow
description: >
  First pipeline step. Turns a vague request into a structured brief.yaml —
  intent, audience, platforms, states, a11y needs, and scope boundaries. Use at
  the start of any new component.
---

# 01-discover

Convert intent into a `brief.yaml`.

## Output: `.claude/artifacts/<feature>/brief.yaml`

Captures: component name, purpose, target platforms (subset of the 6), variants,
states (default/loading/error/empty), interaction model, a11y requirements, and
an explicit in/out-of-scope statement.

Start from `_shared/templates/brief.template.yaml`.

## Decision points (ask the user)

- Which platforms? (all 6, web-only, native-only)
- Static, variants, controlled state, or iteration?
- Any overlay/table/chart intent -> route back to `orchestrator` refusal.

## Next

`03-architect` (or `02-research` first if the pattern is unfamiliar).
