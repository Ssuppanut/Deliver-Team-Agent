# FormField — design decisions & test learnings

Fourth component test. Purpose: exercise the `el: input` path — controlled
state (`value` + `onChange`) and the full accessible-field wiring (visible label
association, `aria-describedby`, `aria-invalid`, error announcement).

## Issues found and resolved

| # | severity | issue | fix |
|---|----------|-------|-----|
| F1 | serious | input ignored the visible `label`; no `<label for>` association (a11y-guard rightly failed) | input renders an associated `<label>` (web) / visible label + `accessibilityLabel` (RN) / label parameter (native); a11y-guard now accepts a visible associated label |
| F2 | serious | `aria-describedby` / `aria-invalid` never emitted | web inputs emit `aria-invalid` and an `aria-describedby` that is gated on the error prop so it never dangles |
| F3 | moderate | element `id` was dropped, so the error target had no id | `id` flows through the IR and is emitted on web elements |
| F4 | moderate | change handler typed `() => void` | value-change handlers are typed to take the new value: `(value: string) => void` (web/RN), `(String) -> Void` / `(String) -> Unit` (native) |
| F5 | serious | native change handler typed no-arg but wired to pass a string | native change-handler typing matched to F4 |
| F6 | serious | optional `string` prop typed non-optional and used in `when` as a Bool (invalid native code) | native types any optional prop as optional (`String?`) and guards with `if let` / `!= null` |

Pinned by regression checks P13–P16 in `verify-patches.mjs`.

## Controlled input, per platform

- **React / Svelte:** `value={value}` + `onChange`/`on:input` calling `onChange(e.target.value)`.
- **Vue:** `:value` + `@input` calling `onChange((e.target as HTMLInputElement).value)`.
- **React Native:** `value` + `onChangeText={onChange}`.
- **SwiftUI:** a custom `Binding(get: { value }, set: { onChange($0) })` bridges the value+callback contract to SwiftUI's two-way binding.
- **Compose:** `TextField(value = value, onValueChange = onChange, label = { Text(label) }, isError = error != null)`.

## Architectural learning — label association is a web-only wiring problem

On the web an input and its label are separate elements that must be linked
(`for`/`id`) and the error linked back (`aria-describedby`). On every native
platform the field component takes the label (and error state) as a parameter,
so the association is structural, not wired. The generator emits explicit
web wiring and uses the native parameter form elsewhere — same spec, honest
platform idioms.

Known minor gap: SwiftUI has no `border` modifier in the current token map, so a
container/input `border` style slot is dropped there (no compile error). Add an
`.overlay(RoundedRectangle(...).stroke(...))` mapping when border parity matters.

## Result

All guards + cross-adapter parity pass on all 6 platforms; the field is fully
labeled and its error state is programmatically exposed and announced.
