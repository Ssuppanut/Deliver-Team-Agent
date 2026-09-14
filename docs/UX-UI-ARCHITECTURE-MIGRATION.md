# UX/UI Architecture — Migration

How the existing repository maps into the role/agent + provider-agnostic
architecture. The refactor is **additive and non-destructive**: the working
engine and its tests stay green; new layers compose the existing capabilities.

---

## 1. Current → target

**Current** (before): a single-layer skill system under `.claude/skills`
(`_meta`, `_guards`, `workflow`, `design-system`, `knowledge`) plus `adapters/`,
`design-system/`, `_shared/`. Effectively **1 skill ≈ 1 step/agent**.

**Target**: **Agent = role**, **Skill = reusable capability**, **Workflow =
process**, **Artifact = deliverable**, **Guard = quality**, and a
**provider-agnostic AI layer** (`.ai/`). Claude becomes one provider/runtime.

## 2. Mapping (KEEP / NEW / …)

| Existing component | Disposition | Notes |
|---|---|---|
| `adapters/` (6 + `_shared/renderer-base.mjs`) | **KEEP** | Preserved verbatim; the UX/UI Engineer's `component-implementation`. |
| `design-system/tokens-dtcg` + `_shared/tokens` | **KEEP** | Design System Agent's `design-tokens`/`dtcg`. |
| `.claude/skills/design-system/*` | **KEEP** | Composed by the Design System Agent. |
| `.claude/skills/_guards/*` | **KEEP** (indexed by `guards/`) | Reusable QA capabilities for Design QA. |
| `.claude/skills/workflow/*` (01–07) | **KEEP + MAP** | Mapped onto workflow stages / agents; steps still valid. |
| `.claude/skills/knowledge/*` | **KEEP + MAP** | Become UX/UI knowledge capabilities (`visual-design`, `usability`, `ux-patterns`, `interaction-design`, `anti-slop`). |
| `.claude/skills/_meta/*` | **KEEP + MAP** | Orchestrator capabilities (`routing`, `context-loading`, `readiness-check`). |
| `_shared/schemas/*` | **KEEP** | Reused by the artifact registry; new artifacts reference or extend them. |
| `_shared/scripts/*` (spec-to-ir, e2e, verify, ci) | **KEEP** | Engineering + QA implementations. |
| `SKILLS_INDEX.yaml` | **KEEP + SUPERSEDE** | Still the Claude-runtime surface; `skills/INDEX.yaml` is the capability-oriented view. |
| `agents/` | **NEW** | 8 role manifests + `agents.yaml`. |
| `skills/INDEX.yaml` | **NEW** | Capability catalogue (capability → domain → agents). |
| `workflows/ux-ui.workflow.yaml` | **NEW** | Conditional, gated process. |
| `artifacts/registry.yaml` | **NEW** | Artifact-first registry + traceability. |
| `guards/README.md` | **NEW** | Neutral index of reusable guards. |
| `.ai/*` | **NEW** | Provider/runtime/model/router/policy/registry. |
| `_shared/scripts/validate-architecture.mjs` | **NEW** | Cross-consistency validator, wired into CI. |
| `docs/*` | **NEW** | This migration + the architecture doc. |

**No files were removed or rewritten.** Nothing is `DEPRECATE`/`REMOVE` in this
step.

## 3. Claude-specific assumptions

The only structural coupling to Claude is that guard/critique/refusal modules and
per-feature artifacts live under `.claude/`. Decision: **keep `.claude/skills` as
the Claude-runtime skill surface** (so Claude Code still discovers skills) and add
a neutral, provider-agnostic layer on top. Claude is now represented as one
provider in `.ai/providers/providers.yaml`; the architecture no longer treats it
as the root. There are **no LLM provider API calls in the codebase** — the engine
is deterministic — so making it provider-agnostic is purely additive.

## 4. Deferred (future) migration — not done now

Planned, staged, and explicitly **not** executed in this change to protect the
green build:

1. Physically relocate guard modules to `guards/` and leave thin re-exports under
   `.claude/skills/_guards/*`.
2. Move per-feature artifacts from `.claude/artifacts/` to a neutral `artifacts/`
   workspace, updating `e2e-multi` resolution.
3. Formalise `product-spec`, `research-report`, `ux-spec`, `project-state`,
   `handoff` schemas under `artifacts/schemas/`.
4. Add real runtime adapters under `.ai/runtimes/` once a provider is configured.

Each is independent and can land without touching the engine.

## 5. Compatibility

- Existing commands unchanged: `tokens:build`, `e2e`, `verify:patches`, `ci`.
- Schemas, examples, generated-output contracts, adapters, token generation, and
  validation scripts all preserved.
- New behaviour is additive; CI now also validates the architecture manifests.

## 6. Migration order (followed here)

1. Add `.ai/` (schemas, data, router) — provider-agnostic core.
2. Add `skills/INDEX.yaml` — capability catalogue.
3. Add `agents/` — role manifests + registry.
4. Add `artifacts/` and `workflows/` — artifact-first + process.
5. Add `guards/` index.
6. Add `validate-architecture.mjs`; wire into CI + regression harness.
7. Write docs; update README.
8. Run full CI.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Moving `.claude/skills` breaks Claude discovery | Not moved; kept as the runtime surface. |
| Import paths break | No existing files moved; only additions. |
| Manifests drift from reality | `validate-architecture.mjs` fails CI on any dangling reference or false "implemented" claim. |
| Overstating provider support | Router + registry default to `unknown`/`needs_configuration`; validated by P24. |

## 8. Testing

`node _shared/scripts/ci.mjs` runs: token build → architecture validation →
every feature (in-scope pass gates, refused categories refuse) → regression
harness (25 checks, incl. P24 router honesty and P25 architecture consistency).
