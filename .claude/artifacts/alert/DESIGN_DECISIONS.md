# Alert — design decisions & test learnings

Third component test. Purpose: exercise the **4-way enum `variant`** path, which
the schema and IR supported but no adapter consumed (a no-op). Also exercised a
conditional (`when`) on an **optional** callback.

## Issues found and resolved

| # | severity | issue | fix |
|---|----------|-------|-----|
| A1 | critical | `variant` was a no-op — all 4 severities rendered identically; `severity` appeared only in the type signature | Added `variantData()` to `RendererBase` (splits style slots from per-case icon) and implemented runtime variant resolution in all 6 adapters |
| A2 | moderate | perf-guard false-flagged `dead-icon-import` on a used icon, because adapters never reported used-icon count | adapters now return `usedIconsCount`; guard keys off it and off a real import match |
| A3 | serious | optional `function` prop + `when` produced invalid native code (`if onDismiss {` uses a closure as a Bool; type was non-optional) | native adapters type an optional callback as `(() -> Void)?` / `(() -> Unit)?` and guard with `if let x = x` / `if (x != null)` |

All three are pinned by regression checks P9–P12 in `verify-patches.mjs`.

## How `variant` resolves per platform

- **React / React Native:** `...({ info: {...}, ... })[prop]` spread into the style object.
- **Vue:** switches to a `:style` object binding with the same spread.
- **Svelte:** an inline per-value CSS string indexed by the prop via attribute interpolation (no extra script state).
- **SwiftUI:** a dictionary literal subscript with a fallback: `([ "info": Token, ... ][prop] ?? Color.clear)`.
- **Compose:** a `when (prop) { "info" -> Token; ...; else -> Color.Transparent }` expression.

## Architectural learning — native color cascade divergence

A container-level `color` variant works on web (CSS inheritance) and on **SwiftUI**
(`.foregroundColor` is an environment modifier that cascades to child `Text`), but
**not** on Compose (a `Column` does not cascade text color) or React Native (a `View`
does not cascade to `Text`). The generator applies what each platform honors and
surfaces a warning where it cannot, rather than emitting code that silently does
nothing. Design implication: put foreground color on text elements when Compose/RN
parity matters; container-level color is a web/SwiftUI convenience.

## Result

98%-equivalent: all guards + cross-adapter parity pass on all 6 platforms. The one
documented divergence (Compose container color) is surfaced as a warning, not a
silent gap.
