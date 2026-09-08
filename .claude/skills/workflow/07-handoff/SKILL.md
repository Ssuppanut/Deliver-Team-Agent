---
name: 07-handoff
layer: workflow
description: >
  Assembles the developer handoff bundle — README, API, examples, decisions,
  a11y notes, changelog, ADRs, and Storybook MDX. Final pipeline step. Use once
  verification passes.
---

# 07-handoff

Package the verified component for consumers.

## Output: `.claude/artifacts/<feature>/handoff/`

An 8-artifact bundle:

1. `README.md` — what it is, how to import per platform.
2. `COMPONENT_API.md` — props, types, defaults (the parity contract).
3. `USAGE_EXAMPLES.md` — per-adapter snippets.
4. `DESIGN_DECISIONS.md` — why it looks/behaves this way.
5. `ACCESSIBILITY.md` — roles, keyboard model, tested AT.
6. `CHANGELOG.md` — versioned changes.
7. `adrs/` — architecture decision records.
8. `stories/*.mdx` — Storybook docs (see `design-system/storybook-authoring`).

Plus `manifest.yaml` indexing the bundle.

## Rule

Handoff only assembles what `06-verify` passed. A failing gate blocks handoff.
