---
name: 04-design
layer: workflow
description: >
  Authors the platform-neutral design-spec.yaml that drives all 6 adapters.
  Every element classified, every value given a kind, every style bound to a
  token. Use after architecture is settled.
  Do NOT use it to generate code — that is the 05-implement skill.
---

# 04-design

Write the single source of truth: `design-spec.yaml`, validated against
`_shared/schemas/design-spec.schema.yaml`.

## Rules

- Classify every element into one of 8 kinds: `container, media, heading, text,
  action, link, input, slot`.
- Every value is `{ kind: literal | ref | expr, value }`. Prefer `ref` over
  `expr`; `expr` degrades on native (documented limitation).
- Bind every visual style to a **semantic** token (never core, never raw).
- Iteration via `each: { items, as, key }`. Conditionals via `when`.
- **Never invent what you do not know.** If a value, token, or copy string is
  undecided, write the sentinel `TBD` (e.g. `{ kind: literal, value: "TBD — ต้องการ copy" }`)
  rather than guessing. The readiness check (`critique/scripts/check-tbd.mjs`,
  run in `e2e-multi`) fails the gate while any `TBD` remains, so a blank is
  visible and gets filled — a fabricated value is invisible and gets shipped.

## Validate + preview IR

```bash
node _shared/scripts/validate-schema.mjs .claude/artifacts/<feature>/design-spec.yaml
node _shared/scripts/spec-to-ir.mjs      .claude/artifacts/<feature>/design-spec.yaml
```

See `_shared/schemas/examples/` for worked specs (product-card, user-card-list).

## Next

`05-implement`.
