---
name: adapter-swiftui
layer: adapters
platform: native
description: >
  SwiftUI adapter. Renders the IR to a View struct using DesignTokens.swift and
  SF Symbols. Use to generate SwiftUI components. Note native limits on JS expr
  values.
  Do NOT use it for any platform other than SwiftUI — each platform has its own adapter (react, vue, svelte, react-native, compose).
---

# adapter-swiftui

Extends `adapters/_shared/renderer-base.mjs`.

## Emits

`out/swiftui/<feature>/<Component>.swift` — a `View` struct; tokens from
`DesignTokens.swift`; icons as SF Symbols.

## Mapping

- container->VStack, text/heading->Text, media->AsyncImage, action->Button,
  link->Link, input->TextField.
- style slots -> view modifiers (`.background`, `.padding`, `.cornerRadius`,
  `.foregroundColor`).
- iteration: `ForEach(items, id: \.key)`. conditional: `if when { ... }`.

## Documented limitations

- `expr` values (JS) can't be evaluated natively — simplified to the first
  identifier and reported as a warning.
- Reserved words (`default`, `case`, ...) are backtick-escaped.
- Item shapes without `id` get a synthesized `UUID` id.

## Run

```bash
node adapters/swiftui/generate.mjs <spec.yaml> <feature>
```
