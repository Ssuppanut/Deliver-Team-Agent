# workflows — the process (WHEN / in what sequence)

[`ux-ui.workflow.yaml`](ux-ui.workflow.yaml) is a **conditional DAG**, not a rigid
linear pipeline. Only the stages a project needs run; existing artifacts are
reused; unnecessary stages are skipped. **Skipping a stage is a correct outcome,
never an error.**

```
intake → product-strategy → research → ux-design → ui-design
       → design-system → engineering → design-qa → handoff
```

## Dependency semantics

Each stage declares a `run_if` (a boolean expression over context flags) and a
structured `consumes` list. An artifact is **available** when a stage that ran
produced it, or when it was supplied as an existing input.

| term | meaning |
|------|---------|
| `run_if: always` | stage runs unconditionally |
| `run_if: <expr>` | runs only when the expression over context flags is true |
| condition false | **stage skipped** — valid, not an error |
| `consumes[].required: true` | the stage cannot run unless the artifact is available; if it is not, the stage is **blocked** (error) |
| `consumes[].required: false` | **optional** — the artifact's absence is valid |
| `consumes[].reuse: true` | the artifact may be **supplied by an existing / previous** instance even when its producer stage is skipped (reuse / external) |
| `produces` | artifacts the stage emits **when it runs** |
| external artifact | one with no producer stage — must be consumed only as `required: false` or `reuse: true` |

So: **existing artifact → reused** · **condition false → skipped** · **optional
missing → valid** · **required missing → blocked** · **external → supplied by the
project** · **conditional producer → may or may not produce**.

## Design-only vs engineering

Handoff requires `design-spec` only; `prototype` and `design-qa-report` are
**optional**. So a **design-only** project (engineering + design QA skipped) still
produces a valid handoff — no missing-required-artifact error. An
**engineering** project runs `design-spec → engineering → design-qa → handoff`.

## Validation

`workflow-eval.mjs` evaluates the workflow deterministically:

```bash
node _shared/scripts/workflow-eval.mjs     # runs the declared scenarios A–H
```

`validate-architecture.mjs` (in CI) additionally lints the dependency discipline —
it flags a `required` non-`reuse` artifact whose producer can be skipped, a
required artifact with no producer that is not external, unknown artifact
references, and `produced_by` drift — **without rejecting legitimate conditional
workflows**. The declared `scenarios` (CASE A–H: full-product, existing product
strategy, no research, UI-only, existing design system, design-only, engineering,
and an invalid required dependency) must all evaluate to their expected outcomes.

## Gates & profiles

Approval gates are opt-in per stage via `gate:`; a project `profile`
(`full-product`, `ui-only`, `design-only`, `default`) turns gates on/off. Profiles
set **gates only** — which stages *run* is decided by `run_if`, not by the profile.
