# UX/UI Agent Team — Architecture

**Current scope:** UX/UI Agent Team.
**Future:** one division of a larger *AI Software Company Agent* inside
Deliver-Team-Agent. This document describes the current architecture and the
extension points that make the future possible — without implementing it now.

---

## 1. Vision

Deliver-Team-Agent turns a design request into production UI across six
platforms, with design intent, accessibility, and the token contract kept in
sync automatically. It is organised as a **team of professional-role agents**
that compose **reusable skills**, communicate through **structured artifacts**,
and are validated by **reusable quality guards**. The AI it runs on is
**provider-agnostic**: Claude is one supported provider, not the root.

## 2. The core distinction

| Concept | Means | Where |
|---|---|---|
| **Agent** | WHO performs the work (a professional role) | `agents/` |
| **Skill** | WHAT capability an agent has (reusable) | `skills/INDEX.yaml` |
| **Workflow** | WHEN / in what sequence | `workflows/` |
| **Artifact** | the structured output produced | `artifacts/` |
| **Guard** | HOW quality is validated | `guards/` (impl under `.claude/skills/_guards`) |
| **AI Provider** | WHICH ecosystem | `.ai/providers` |
| **Runtime** | HOW the AI is executed | `.ai/runtimes` |
| **Model** | WHICH specific model | `.ai/registry` |
| **AI Router** | selects provider/runtime/model | `.ai/router` |
| **Orchestrator** | coordinates agents + workflow | `agents/orchestrator` |

A skill is **not** an agent. One skill (e.g. `design-tokens`, `competitor-analysis`)
is composed by several agents. Agents are never named after a provider.

## 3. The agents (UX/UI team)

`orchestrator` · `product-ux-strategist` · `ux-researcher` · `ux-designer` ·
`ui-designer` · `design-system` · `ux-ui-engineer` · `design-qa`.

Each is defined in `agents/<id>/AGENT.md` and registered in `agents/agents.yaml`
with its composed skills, owned artifacts, AI capability requirements, and
boundaries. See [`agents/README.md`](../agents/README.md) for the table.

**Engineering boundary:** `ux-ui-engineer` owns design/prototype/component
implementation and UI parity only. Application architecture, backend, business
logic, databases, and infrastructure belong to the future Engineering Team and
are not implemented here.

## 4. Skills as reusable capabilities

`skills/INDEX.yaml` is the capability catalogue — grouped by domain
(orchestration, product, research, ux, ui, design-system, engineering, qa). Each
capability declares purpose, `used_by` agents, and an honest `status`:
`implemented` (backed by real code/knowledge, with an `impl` path) or `planned`
(a defined extension point). This is the capability-oriented successor view of
`SKILLS_INDEX.yaml`, which still documents the Claude-runtime skill surface under
`.claude/skills`.

## 5. Workflow (conditional, gated)

`workflows/ux-ui.workflow.yaml` sequences agents through artifact hand-offs:

```
intake → product-strategy → research → ux-design → ui-design
       → design-system → engineering → design-qa → handoff
```

Stages carry `condition`s (research skipped for UI-only tasks; design-system
skipped when reusing an existing system; engineering skipped for design-only
output; Design QA repeats after every change). Approval gates are opt-in per
`profile`. The `implemented_slice` (`ui-design → engineering → design-qa →
handoff`) is what runs today.

## 6. Artifact-first communication

Agents pass **structured artifacts**, not conversation. `artifacts/registry.yaml`
gives each artifact an owner, schema, inputs, and status, reusing existing
schemas (`brief`, `design-spec`, `verify-report`, token registry) and marking new
ones (`product-spec`, `research-report`, `ux-spec`, `project-state`) as planned.

**Traceability** runs both ways along:
`brief → product-spec → research-report → ux-spec → design-spec →
component-contracts → prototype → design-qa-report → handoff`.

## 7. Project state

The orchestrator tracks structured state (extension point `project-state`):
`current_stage`, `completed_stages`, `pending_tasks`, `blocked_tasks`,
`artifacts`, `approvals`, `decisions`, `open_questions`, `risks`,
`quality_results` — not natural-language memory.

## 8. Quality guards (reusable)

`readiness` (no unresolved TBD), `accessibility`, `token-compliance`,
`performance`, `design-quality` (de-slop), cross-adapter `parity`, and the
`visual` verify tier. Consumed by Design QA; applied by the engineering pipeline
on every output. A serious finding fails the gate. See
[`guards/README.md`](../guards/README.md).

## 9. Multi-AI architecture

The system declares **AI capability requirements** on agents and resolves them
through the **AI Router** (`.ai/`):

```
Agent → Skill → required AI capabilities → AI Router → Provider → Runtime → Model
```

- **Providers**: Anthropic, OpenAI, Google, xAI, Qwen, local — all `unknown`
  until configured. Claude is one provider, never the conceptual root.
- **Runtimes**: API, official SDK/CLI, authorized subscription, local, desktop —
  covering both API-based and subscription-based access.
- **Models**: a registry with `supported | unsupported | unknown` capabilities;
  never invented, never scored.
- **Policy**: preferences (no hard-coded universal priority) plus non-negotiable
  `never` guardrails.
- **Router**: pure, testable `route(request, ctx)`. It only *plans* — it never
  authenticates or calls anything, so it cannot bypass auth, quotas,
  subscription limits, or Terms of Service. An unconfigured provider is
  `needs_configuration`; an out-of-vocabulary need is `unavailable`. Support is
  never faked.

A future **AI Council** (generator → critic → second opinion → synthesis) is a
clean extension point on the router, intentionally not built yet.

## 10. Preserved subsystems

The proven engine is kept intact and mapped into the new model, not rewritten:
DTCG tokens → 7 platform outputs, semantic-token contract, component contracts,
Figma sync, the IR + shared visitor renderer, the six adapters (React, Vue,
Svelte, React Native, SwiftUI, Compose), the guards, cross-adapter parity,
schemas, examples, and handoff.

## 11. Boundaries & exclusions

- **In scope:** UX/UI only.
- **Future teams (extension points, not implemented):** Engineering, QA
  Engineering, Security, DevOps/SRE, Data/AI, Operations.
- **Excluded by design:** Graphic Design (banner/advertising/infographic/
  Photoshop/Illustrator) is a separate future project, not part of this repo.

## 12. Validation

`_shared/scripts/validate-architecture.mjs` checks that every agent→skill,
agent→artifact, workflow→agent/artifact, and artifact→input reference resolves,
that every `implemented` claim points at a real path, and that the router plans a
route honestly. It runs in CI (`_shared/scripts/ci.mjs`) alongside the token
build, every feature, and the regression harness.
