# Complex data tables — refused, with redirects

Complex data tables are **out of scope**. The orchestrator refuses
`category: data-table`.

## What's refused vs. allowed

- **Refused:** sorting, filtering, pagination, virtualization, dynamic/resizable
  columns, row selection, sticky headers, editable cells.
- **Allowed:** a static list or a single-level iteration of cards/rows via
  Strategy D (`each`). That covers "render these N items", not "a data grid".

## Why

A real data table is a state machine (sort/filter/selection) plus virtualization
plus a11y grid semantics (`role="grid"`, arrow-key navigation). That is a library
domain, not a composition the IR should synthesize across 6 platforms.

## Redirect

| platform | use |
|----------|-----|
| React | TanStack Table v8, AG Grid |
| Vue/Svelte | TanStack Table v8 (framework adapters) |
| React Native | FlashList / SectionList + TanStack |
| SwiftUI | `Table` (macOS/iPadOS), `List` |
| Compose | `LazyColumn` + Paging 3 |

Use in-scope skills to generate the **cell/row** presentation; let the library
own the grid behavior.
