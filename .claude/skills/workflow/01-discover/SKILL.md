---
name: 01-discover
layer: workflow
description: >
  First pipeline step. Turns a vague request into a structured brief.yaml —
  intent, audience, platforms, states, a11y needs, and scope boundaries. Use at
  the start of any new component.
  Do NOT use it to decide structure or the public API — that is the 03-architect skill.
---

# 01-discover

Convert intent into a `brief.yaml`.

## Output: `.claude/artifacts/<feature>/brief.yaml`

Captures: component name, purpose, target platforms (subset of the 6), variants,
states (free lower-kebab identifiers, e.g. default / busy / with-image),
interaction model (an array of modes), a11y requirements, and an explicit
in/out-of-scope statement.

Start from `_shared/templates/brief.template.yaml`.

## Decision points (ask the user)

- Which platforms? (all 6, web-only, native-only)
- Which interaction modes (an array, unique)? static | variants | controlled | iteration | conditional (static cannot combine with others).
- Any overlay/table/chart intent -> route back to `orchestrator` refusal.

## Next

`03-architect` (or `02-research` first if the pattern is unfamiliar).
