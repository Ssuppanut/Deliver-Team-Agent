# Deliver Team Agent

> **Current scope: the UX/UI Agent Team.**
> **Future: one division of a larger AI Software Company Agent.**
> The full software company does **not** exist yet — this repo builds a strong
> UX/UI foundation designed to become one division of it later.

A team of **professional-role agents** that compose **reusable skills**,
communicate through **structured artifacts**, are validated by **reusable quality
guards**, and run on a **provider-agnostic** AI layer (Claude is one provider,
not the root). At its core is a **spec-driven code generation engine**: author one
platform-neutral design specification and generate production components across
**6 platforms** — keeping design intent, accessibility, and the design-token
contract in sync automatically.

**Read next:** [`docs/UX-UI-AGENT-TEAM-ARCHITECTURE.md`](docs/UX-UI-AGENT-TEAM-ARCHITECTURE.md)
· [`docs/UX-UI-ARCHITECTURE-MIGRATION.md`](docs/UX-UI-ARCHITECTURE-MIGRATION.md)

## The team

| Layer | Means | Where |
|---|---|---|
| **Agent** — a professional role | WHO does the work | [`agents/`](agents/) |
| **Skill** — a reusable capability | WHAT it can do | [`skills/INDEX.yaml`](skills/INDEX.yaml) |
| **Workflow** — a conditional, gated process | WHEN | [`workflows/`](workflows/) |
| **Artifact** — a structured deliverable | the output | [`artifacts/`](artifacts/) |
| **Guard** — a reusable quality check | HOW quality is validated | [`guards/`](guards/) |
| **AI Router** — provider/runtime/model selection | which AI runs it | [`.ai/`](.ai/) |

Agents (UX/UI team): `orchestrator`, `product-ux-strategist`, `ux-researcher`,
`ux-designer`, `ui-designer`, `design-system`, `ux-ui-engineer`, `design-qa`.
`design-system`, `ux-ui-engineer`, and `design-qa` are backed by working code
today; the upstream strategy/research/UX roles are defined extension points.

## Multi-AI (provider-agnostic)

An agent declares **AI capability requirements**; the **AI Router** maps them to a
provider → runtime → model:

```
Agent → Skill → required AI capabilities → AI Router → Provider → Runtime → Model
```

Supported providers: Anthropic (Claude), OpenAI, Google, xAI, Qwen, local — all
`unknown` until configured through official/authorized access. Both **API** and
**authorized subscription** runtimes are modelled. The router only *plans* — it
never authenticates or calls anything, so it cannot bypass auth, quotas,
subscription limits, or Terms of Service; support is never faked. Try it:
`node .ai/router/route.mjs --caps code,structured-output`.

## Not included (by design)

Current scope is **UX/UI only**. Extension points exist but are **not**
implemented: full backend/engineering, software QA org, security, DevOps/SRE,
data/AI engineering, release operations. **Graphic design** (banner, advertising,
infographic, Photoshop/Illustrator) is intentionally a **separate** future
project, not part of this repo.

---

## The engine (UX/UI Engineering + Design QA)

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

# …or run the whole thing (tokens + every feature + regression) as CI does
node _shared/scripts/ci.mjs
```

Outputs land in `out/<adapter>/<feature>/` and a report in
`out/_reports/<feature>.json`. `.github/workflows/ci.yml` runs `ci.mjs` on
Node 20 and 22 for every push and PR.

## The engine pipeline (implemented slice of the conditional workflow)

The primary workflow is a **conditional DAG** — see
[`workflows/`](workflows/README.md); stages run only when their `run_if` holds,
existing artifacts are reused, and skipping a stage is a correct outcome, not an
error. The steps below are the linear engine slice that the code implements today
(`ui-design → engineering → design-qa → handoff`); `orchestrator` routes every
request (and refuses out-of-scope categories):

```
01-discover → 02-research? → 03-architect → 04-design → 05-implement → 06-verify → 07-handoff
```

- **04-design** produces the single source of truth: `design-spec.yaml`
  (validated against `_shared/schemas/design-spec.schema.yaml`).
- **05-implement** normalizes it to IR and runs all 6 adapters, then guards.
- **06-verify** adds dynamic a11y (axe-core), visual regression, bundle size,
  and Web Vitals.

## Primary architecture vs runtime surfaces

The repository's **primary architecture is the UX/UI Agent Team** — roles that
compose reusable skills, a conditional workflow, structured artifacts, reusable
guards, and a provider-agnostic AI layer. It is **not** a "29 skills / 5 layers"
system; that layering describes one runtime surface, not the architecture.

**Primary architecture**

| dir | what |
|-----|------|
| [`agents/`](agents/) | 8 professional-role agents (`agents.yaml`) |
| [`skills/`](skills/INDEX.yaml) | capability catalogue — the Skill **source of truth** |
| [`workflows/`](workflows/) | the conditional, gated process (a DAG, not a linear pipeline) |
| [`artifacts/`](artifacts/) | artifact registry + traceability |
| [`guards/`](guards/) | reusable quality validations |
| [`.ai/`](.ai/) | providers / runtimes / registry / policies / **AI Router** |

**Runtime / implementation surfaces** (kept, not the architectural root)

| dir | what |
|-----|------|
| `.claude/` | the **Claude-runtime skill surface** — 29 SKILL.md across `_meta`, `_guards`, `workflow`, `design-system`, `knowledge`, plus per-feature artifacts. Claude is **one provider/runtime**, not the root. |
| `adapters/` | the 6 platform adapters over the shared `renderer-base.mjs` |
| `design-system/` | the DTCG token build |
| `_shared/` | schemas, scripts (spec-to-ir, e2e, guards runner, validators), templates, tokens |

**Skill registries — one source of truth.** [`skills/INDEX.yaml`](skills/INDEX.yaml)
is the capability-oriented **source of truth** (Skill = a reusable capability,
composed by agents, with honest `implemented`/`planned` status pointing at real
code). [`SKILLS_INDEX.yaml`](SKILLS_INDEX.yaml) is the **Claude-runtime
compatibility surface** that lets Claude Code discover skills under `.claude/skills`;
each of its descriptions ends with a `Do NOT use it for X — that is the Y skill`
routing line. When they disagree, `skills/INDEX.yaml` wins;
`validate-architecture` fails if a capability's declared implementation path is
missing (obvious-drift detection).

## The visitor pattern

All 6 adapters extend `adapters/_shared/renderer-base.mjs`. The base owns tree
traversal, token/icon resolution, and control-flow ordering; each adapter
overrides the `visit*` methods to emit platform-idiomatic code. Cross-adapter
parity is therefore a property of shared traversal, not copy-paste.

**In scope:** static composition, variants + conditional children (`when`),
controlled input, unified icon + token systems, single-level iteration (`each`,
Strategy D), API parity, a11y contracts, automated gates.

**Out of scope (refused, with redirects):** overlays (→ Radix / native), complex
data tables (→ TanStack), charts, rich-text, drag-and-drop. The refusal is
executable — a spec whose `category` is `overlay` or `data-table` is refused with
a redirect and generates no code (see `orchestrator/scripts/refusal.mjs` and
[`knowledge/pattern-library`](.claude/skills/knowledge/pattern-library/SKILL.md)).

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
