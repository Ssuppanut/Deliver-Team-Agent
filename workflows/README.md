# workflows — process (WHEN / in what sequence)

[`ux-ui.workflow.yaml`](ux-ui.workflow.yaml) declares the UX/UI delivery process
as **conditional** stages that map to agents (WHO) and artifacts (WHAT), with
**configurable approval gates** via project profiles.

```
intake → product-strategy → research → ux-design → ui-design
       → design-system → engineering → design-qa → handoff
```

- Stages carry a `condition` — research is skipped for a small UI-only task, the
  design-system stage is skipped when reusing an existing system, engineering is
  skipped for design-only output, and Design QA re-runs after every change.
- Gates are opt-in per `profile` (`full-product`, `ui-only`, `design-only`,
  `default`) — not every project requires every gate.
- The `implemented_slice` (`ui-design → engineering → design-qa → handoff`) is
  what the existing engine runs today; upstream stages are extension points.
