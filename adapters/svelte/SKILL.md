---
name: adapter-svelte
layer: adapters
platform: web
description: >
  Svelte adapter. Renders the IR to a <script lang="ts"> component, tokens as
  CSS custom properties, icons from lucide-svelte. Use to generate Svelte
  components.
  Do NOT use it for any platform other than Svelte — each platform has its own adapter (react, vue, react-native, swiftui, compose).
---

# adapter-svelte

Extends `adapters/_shared/renderer-base.mjs`.

## Emits

`out/svelte/<feature>/<Component>.svelte` — `<script lang="ts">` with
`export let` props and CSS-var styles.

## Mapping

- tokens: `token-map.mjs` -> CSS custom properties.
- icons: `icon-map.mjs` -> lucide-svelte.
- iteration: `{#each items as item (item.id)}`.
- conditional: `{#if when}`.
- events: `on:click`, `on:input`.

## Run

```bash
node adapters/svelte/generate.mjs <spec.yaml> <feature>
```
