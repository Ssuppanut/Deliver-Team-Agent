---
name: adapter-vue
layer: adapters
platform: web
description: >
  Vue 3 adapter. Renders the IR to a <script setup lang="ts"> SFC, tokens as CSS
  custom properties, icons from lucide-vue-next. Use to generate Vue components.
  Do NOT use it for any platform other than Vue — each platform has its own adapter (react, svelte, react-native, swiftui, compose).
---

# adapter-vue

Extends `adapters/_shared/renderer-base.mjs`.

## Emits

`out/vue/<feature>/<Component>.vue` — `<script setup lang="ts">` with
`defineProps<{...}>()`, a `<template>` using CSS-var styles.

## Mapping

- tokens: `token-map.mjs` -> CSS custom properties.
- icons: `icon-map.mjs` -> lucide-vue-next.
- iteration: `<template v-for=... :key=...>`.
- conditional: `<template v-if=...>`.
- events: `@click`, `@input`.

## Run

```bash
node adapters/vue/generate.mjs <spec.yaml> <feature>
```
