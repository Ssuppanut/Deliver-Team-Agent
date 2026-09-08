---
name: context-loader
layer: _meta
description: >
  Loads the minimal set of artifacts and skills for the current pipeline step
  so context stays small. Use when a step needs the brief, architecture,
  design-spec, token registry, or a specific adapter without pulling the rest.
---

# context-loader

Keeps working context lean. Instead of loading all 27 skills, each pipeline
step declares what it needs and this skill resolves it.

## What it loads, per step

| step         | loads |
|--------------|-------|
| 01-discover  | `templates/brief.template.yaml` |
| 03-architect | `brief.yaml`, `schemas/architecture.schema.yaml` |
| 04-design    | `architecture.yaml`, `schemas/design-spec.schema.yaml`, token registry |
| 05-implement | `design-spec.yaml`, the target adapter(s), token maps, icon maps |
| 06-verify    | generated `out/`, guards, `schemas/verify-report.schema.yaml` |
| 07-handoff   | everything in `.claude/artifacts/<feature>/` |

## Artifact locations

- Per-feature artifacts: `.claude/artifacts/<feature>/`
- Built token registry: `_shared/tokens/registry.json`
- Example specs: `_shared/schemas/examples/`

## Contract

- **Input:** step name + feature name.
- **Output:** resolved file paths; never loads more than the step declares.
