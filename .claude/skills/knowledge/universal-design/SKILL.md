---
name: universal-design
layer: knowledge
description: >
  WCAG-aligned accessibility reference — roles, names, keyboard models, and
  inclusive defaults. Consult during research, design, and when resolving
  a11y-guard findings.
  Do NOT use it for visual or aesthetic quality — those are the design-principles and anti-slop skills.
---

# universal-design

The a11y knowledge base behind `a11y-guard` and `02-research`.

## Non-negotiables

- **Name, role, value** for every interactive element.
- **Keyboard:** everything operable without a pointer; visible focus.
- **Alt text:** meaningful for content images, empty for decorative.
- **Live regions:** announce async state changes (`aria-live`).
- **Contrast:** AA minimum (4.5:1 text, 3:1 large text / UI).
- **Target size:** interactive targets ≥ 24x24 CSS px (WCAG 2.2), larger on touch.

## Role mapping (spec -> platform)

| intent | web role | SwiftUI | Compose |
|--------|----------|---------|---------|
| button | `button` | `Button` | `Button` |
| heading| `h1..h6` | `.font` + header trait | `titleMedium` + heading semantics |
| image  | `img`+alt | `.accessibilityLabel` | `contentDescription` |
| list   | `list`/`listitem` | `List`/`ForEach` | `LazyColumn`/`forEach` |

Findings that recur should be encoded as `a11y-guard` rules.
