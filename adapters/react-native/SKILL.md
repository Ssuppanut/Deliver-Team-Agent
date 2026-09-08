---
name: adapter-react-native
layer: adapters
platform: native
description: >
  React Native adapter. Renders the IR to View/Text/Image/Pressable with JS
  design tokens (tokens-rn.ts) and lucide-react-native icons. Use to generate RN
  components.
---

# adapter-react-native

Extends `adapters/_shared/renderer-base.mjs`.

## Emits

`out/react-native/<feature>/<Component>.tsx` — RN primitives, tokens imported
from `_shared/tokens/tokens-rn.ts` (JS values, no CSS vars).

## Mapping

- tokens: `token-map.mjs` -> `tokens.<path>` references.
- icons: `icon-map.mjs` -> lucide-react-native.
- elements: container->View, text/heading->Text, media->Image, action->Pressable,
  input->TextInput.
- iteration: `.map()` with keyed Fragment. conditional: `{when && (...)}`.

## Run

```bash
node adapters/react-native/generate.mjs <spec.yaml> <feature>
```
