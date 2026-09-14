---
name: adapter-compose
layer: adapters
platform: native
description: >
  Jetpack Compose adapter. Renders the IR to a @Composable function using
  DesignTokens.kt and Material Icons. Use to generate Compose components. Note
  native limits on JS expr values.
  Do NOT use it for any platform other than Compose — each platform has its own adapter (react, vue, svelte, react-native, swiftui).
---

# adapter-compose

Extends `adapters/_shared/renderer-base.mjs`.

## Emits

`out/compose/<feature>/<Component>.kt` — a `@Composable` function; tokens from
`DesignTokens.kt`; icons from Material Icons.

## Mapping

- container->Column, text/heading->Text, media->AsyncImage (Coil),
  action->Button, input->TextField.
- style slots -> `Modifier` chain (`.background`, `.padding`,
  `.clip(RoundedCornerShape(...))`); text color is a `color =` param.
- iteration: `items.forEach { item -> ... }` (safe under a Column;
  swap to `LazyColumn { items(...) }` at the list root). conditional: `if (when) {}`.

## Documented limitations

- `expr` values simplified to the first identifier + warning (native can't eval JS).

## Run

```bash
node adapters/compose/generate.mjs <spec.yaml> <feature>
```
