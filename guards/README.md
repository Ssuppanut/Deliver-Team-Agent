# guards — reusable quality capabilities

Guards are **reusable quality validations**, not the property of one agent. They
are consumed today by the **Design QA** agent and applied by the engineering
pipeline on every generated output.

The implementations remain where the engine already runs them (kept in place for
compatibility with the Claude-runtime skill surface and the existing scripts);
this folder is the neutral, provider-agnostic index of them.

| Guard | Capability id | Implementation | Blocks gate |
|---|---|---|---|
| readiness | `readiness-check` | `.claude/skills/_meta/critique/scripts/check-tbd.mjs` | yes (unresolved TBD) |
| accessibility | `accessibility-qa` | `.claude/skills/_guards/a11y-guard/scripts/check.mjs` | yes (serious) |
| token contract | `token-compliance` | `.claude/skills/_guards/token-guard/scripts/check.mjs` | yes (serious) |
| performance | `performance-qa` | `.claude/skills/_guards/perf-guard/scripts/check.mjs` | advisory |
| design quality | `design-quality-qa` | `.claude/skills/_guards/slop-guard/scripts/check.mjs` | yes (emoji) |
| cross-adapter parity | `design-code-parity` | `_shared/scripts/e2e-multi.mjs` | yes |
| visual / dynamic a11y | `visual-qa` | `.claude/skills/workflow/06-verify/SKILL.md` | at verify tier |

> Migration note: a future step may physically relocate the guard modules here
> and leave thin re-exports under `.claude/skills/_guards/*`. That is planned in
> `docs/UX-UI-ARCHITECTURE-MIGRATION.md`, not done destructively now.
