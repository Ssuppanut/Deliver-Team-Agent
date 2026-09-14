---
name: 03-architect
layer: workflow
description: >
  Decides component structure, public API (props), variant strategy, and token
  budget before any spec is written. Produces architecture.yaml. Use after
  discovery, before design.
  Do NOT use it to author spec elements or bind tokens — that is the 04-design skill.
---

# 03-architect

Shape decisions live here, recorded as `architecture.yaml`.

## Output: `.claude/artifacts/<feature>/architecture.yaml`

- **Public API:** prop names, types, required-ness (this becomes the parity
  contract every adapter must honor).
- **Composition:** element tree at a high level (container/media/heading/...).
- **Variant strategy:** which prop drives variants, and the case table.
- **Iteration:** whether Strategy D (`each`) applies, and the item shape.
- **Token budget:** the semantic tokens this component may consume.
- **ADRs:** any non-obvious decision, recorded under `adrs/` via
  `_shared/templates/adr.template.md`.

## Invariant

The prop set defined here IS the cross-adapter API contract. `06-verify`'s
parity check fails the build if any adapter drops a prop.

## Next

`04-design`.
