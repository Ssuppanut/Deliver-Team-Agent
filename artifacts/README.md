# artifacts — structured deliverables

Agents communicate through **structured artifacts**, not chat history.
[`registry.yaml`](registry.yaml) lists each artifact's owner (agent), schema,
upstream inputs (for traceability), and honest status. Existing schemas are
reused rather than duplicated.

```
brief → product-spec → research-report → ux-spec → design-spec
      → design-tokens → component-contracts → prototype → design-qa-report → handoff
```

- `brief`, `design-spec`, `design-tokens`, `component-contracts`, `prototype`,
  `design-qa-report`, `handoff` are backed by real schemas/outputs today.
- `product-spec`, `research-report`, `ux-spec`, `project-state` are defined
  extension points (schemas planned under `artifacts/schemas/`).
- Traceability chain: stakeholder requirement → product requirement → research
  insight → UX decision → UI decision → design component → design-spec → handoff.
