# agents — professional roles

An **agent is a professional role** that **composes reusable skills**. Skills are
never duplicated per agent; each agent's manifest references capability ids from
[`../skills/INDEX.yaml`](../skills/INDEX.yaml). The machine-readable registry is
[`agents.yaml`](agents.yaml) (validated by `_shared/scripts/validate-architecture.mjs`).

## The UX/UI Agent Team (current scope)
| Agent | Answers | Owns |
|---|---|---|
| `orchestrator` | who does what, when | project-state |
| `product-ux-strategist` | what & why | product-spec |
| `ux-researcher` | what's true about users | research-report |
| `ux-designer` | how it's structured & behaves | ux-spec |
| `ui-designer` | what it looks like | design-spec |
| `design-system` | the shared infrastructure | design-tokens, component-contracts |
| `ux-ui-engineer` | working UI (design-facing only) | prototype |
| `design-qa` | is it correct vs spec | design-qa-report |

## Rules
- Agent = WHO · Skill = WHAT · Workflow = WHEN · Artifact = output · Guard = quality.
- One skill may be used by several agents (e.g. `design-tokens`, `competitor-analysis`).
- `ux-ui-engineer` is design-facing only — it is **not** the future Software
  Development Team.
- Implementation status is honest: `design-system`, `ux-ui-engineer`, `design-qa`
  are backed by working code today; the upstream strategy/research/UX roles are
  defined extension points.
