---
name: tokens-sync
layer: design-system
description: >
  Bidirectional sync between Figma Variables and the DTCG source, via the Figma
  REST API and Tokens Studio JSON. Use to import tokens from Figma or export the
  source back to Figma.
---

# tokens-sync

Keeps Figma Variables and the DTCG source in agreement, both directions.

## Import (Figma -> DTCG)

```bash
FIGMA_TOKEN=figd_xxx node design-system/tokens-sync/scripts/import-figma.mjs \
  --file-id <figma_file_id> --apply
```

Pulls Variables, maps them onto `_shared/tokens/source/*.tokens.json`. Without
`--apply` it prints a drift report only (dry run).

## Export (DTCG -> Figma)

```bash
node design-system/tokens-sync/scripts/export-to-figma.mjs
```

Emits Tokens Studio-compatible JSON for the Figma plugin to consume.

## Discipline

- Sync is **drift-first**: always report the delta before applying.
- Apply requires explicit `--apply`. Never mutate silently.
- After import, rebuild: `node design-system/tokens-dtcg/scripts/build.mjs`.
