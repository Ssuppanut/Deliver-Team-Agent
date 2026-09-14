# Deliver Team Agent

A **spec-driven code generation ecosystem** for Claude Code. Author one
platform-neutral design specification and generate production components across
**6 platforms** — while keeping design intent, accessibility, and the design-token
contract in sync automatically.

```
one design-spec.yaml
        │
        ▼   spec-to-ir (visitor pattern)
   Intermediate Representation
        │
        ├── React        (.tsx,  lucide-react,        CSS vars)
        ├── Vue          (.vue,  lucide-vue-next,     CSS vars)
        ├── Svelte       (.svelte, lucide-svelte,     CSS vars)
        ├── React Native (.tsx,  lucide-react-native, JS tokens)
        ├── SwiftUI      (.swift, SF Symbols,         DesignTokens.swift)
        └── Compose      (.kt,   Material Icons,       DesignTokens.kt)
                │
                ▼  guards: a11y + token + perf  →  cross-adapter parity
           verified output + report
```

## Quick start

```bash
npm install

# 1. Build tokens (required first — guards read the registry)
node design-system/tokens-dtcg/scripts/build.mjs

# 2. Generate a component across all 6 platforms
node _shared/scripts/e2e-multi.mjs --feature product-card

# 3. Run the regression harness
node _shared/scripts/verify-patches.mjs
```

Outputs land in `out/<adapter>/<feature>/` and a report in
`out/_reports/<feature>.json`.

## The pipeline

`orchestrator` routes every request (and refuses out-of-scope categories), then:

```
01-discover → 02-research? → 03-architect → 04-design → 05-implement → 06-verify → 07-handoff
```

- **04-design** produces the single source of truth: `design-spec.yaml`
  (validated against `_shared/schemas/design-spec.schema.yaml`).
- **05-implement** normalizes it to IR and runs all 6 adapters, then guards.
- **06-verify** adds dynamic a11y (axe-core), visual regression, bundle size,
  and Web Vitals.

## Architecture — 29 skills, 5 layers

See [`SKILLS_INDEX.yaml`](SKILLS_INDEX.yaml) for the full registry. Every skill
description ends with a `Do NOT use it for X — that is the Y skill` line, so a
request routes to the same skill every time.

| layer | count | what |
|-------|-------|------|
| `_meta` | 3 | orchestrator, context-loader, critique |
| `_guards` | 4 | a11y-guard, token-guard, perf-guard, slop-guard |
| `workflow` | 7 | 01-discover … 07-handoff |
| `design-system` | 4 | tokens-dtcg, tokens-sync, component-contract, storybook-authoring |
| `adapters` | 6 | react, vue, svelte, react-native, swiftui, compose |
| `knowledge` | 5 | design-principles, universal-design, pattern-library, interaction-laws, anti-slop |

## The visitor pattern

All 6 adapters extend `adapters/_shared/renderer-base.mjs`. The base owns tree
traversal, token/icon resolution, and control-flow ordering; each adapter
overrides the `visit*` methods to emit platform-idiomatic code. Cross-adapter
parity is therefore a property of shared traversal, not copy-paste.

**In scope:** static composition, variants + conditional children (`when`),
controlled input, unified icon + token systems, single-level iteration (`each`,
Strategy D), API parity, a11y contracts, automated gates.

**Out of scope (refused, with redirects):** overlays (→ Radix / native), complex
data tables (→ TanStack), charts, rich-text, drag-and-drop. See
[`.claude/skills/knowledge/pattern-library`](.claude/skills/knowledge/pattern-library/SKILL.md).

## Design tokens

DTCG sources (`_shared/tokens/source/`) compile to 7 outputs via `tokens-dtcg`.
Components consume **semantic** tokens only; `token-guard` rejects raw colors or
dimensions in web output. Figma stays in sync via `tokens-sync` (REST API +
Tokens Studio JSON), both directions.

## Guards are non-negotiable

Every generated output passes a readiness check (no unresolved `TBD` — never
invent what you do not know) plus a11y / token / perf / slop guards and a
cross-adapter parity check. A serious finding fails the gate. Waivers require an
explicit expiry and approver.

`slop-guard` is the design-quality gate (no emoji; state not by color alone);
its checklist lives in [`knowledge/anti-slop`](.claude/skills/knowledge/anti-slop/SKILL.md).

## Worked examples

- `_shared/schemas/examples/product-card.spec.yaml` — static composition.
- `_shared/schemas/examples/user-card-list.spec.yaml` — single-level iteration.

## Layout

```
.claude/skills/       23 skills (_meta, _guards, workflow, design-system, knowledge)
adapters/             6 adapters + _shared/renderer-base.mjs (code + co-located SKILL.md)
design-system/        tokens-dtcg build
_shared/
  schemas/            design-spec, brief, architecture, verify-report (+ examples)
  scripts/            spec-to-ir, validate-schema, e2e-multi, verify-patches
  templates/          brief, adr, component-spec
  tokens/             source/ (DTCG) + built platform outputs
out/                  generated code + reports (gitignored)
```
