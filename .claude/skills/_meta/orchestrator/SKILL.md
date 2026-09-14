---
name: orchestrator
layer: _meta
description: >
  Entry point for every request. Routes work through the workflow pipeline,
  loads only the skills a step needs, and enforces scope refusals before any
  generation happens. Use when a request asks to build, generate, or ship a
  component across platforms.
  Do NOT use it to do the pipeline work itself — that is the workflow skills (01-discover through 07-handoff).
---

# orchestrator

The single front door. Every "build me X across platforms" request starts here.

## Responsibilities

1. **Classify** the request into a component category.
2. **Refuse** out-of-scope categories with a redirect (Step 2.5 below).
3. **Route** through the pipeline, loading skills lazily:
   `01-discover -> 02-research? -> 03-architect -> 04-design -> 05-implement -> 06-verify -> 07-handoff`
4. **Enforce guards** on every generated output (a11y / token / perf).

## Step 2.5 — Refusal check (runs before design)

The generator is deliberately bounded. Refuse these categories and redirect to
purpose-built primitives instead of emitting a poor cross-platform imitation:

| category      | refuse because                              | redirect to |
|---------------|---------------------------------------------|-------------|
| `overlay`     | focus trap / portal / dismiss semantics diverge hard per platform | Radix UI, native `<Modal>`, SwiftUI `.sheet`, Compose `Dialog` |
| `data-table`  | sorting, virtualization, dynamic columns are their own domain | TanStack Table v8, AG Grid, native |
| charts        | rendering + scales + a11y are a library concern | Recharts, Victory, native |
| rich-text     | selection model + serialization             | Tiptap, Slate |
| drag-and-drop | pointer + a11y semantics                    | dnd-kit, native gestures |

See `knowledge/pattern-library/references/overlays.md` and `.../data-tables.md`
for the full rationale and the exact redirect snippets.

This check is executable: `scripts/refusal.mjs` (`checkRefusal(spec)`) runs inside
`e2e-multi` before generation — a refused spec prints its redirect and emits no
code, which is the correct outcome, not a failure.

## In scope

Static composition, variants + conditional children (`when`), controlled input
(`value` + `onChange`), unified icon + token systems, single-level iteration
(`each`, Strategy D), cross-adapter API parity, a11y contracts, automated gates.

## Contract

- **Input:** a natural-language request or a `brief.yaml`.
- **Output:** a routing decision, or a refusal with redirect.
- **Refusal is a feature.** Explicit boundaries beat a mediocre implementation
  of everything.
