# Expression-driven variant — refused, with redirect

A variant case must be selected by a **plain enum prop**. Selecting it with an
**embedded expression** — a ternary, comparison, or call used as the variant
discriminant (e.g. `variant.prop: "delta >= 0 ? 'positive' : 'negative'"`) — is
**out of scope**. The orchestrator refuses it before generating anything.

## Why

- **It is business/presentation logic in the wrong layer.** Which state a value
  maps to (positive vs. negative, ok vs. error) is a decision the **data layer**
  should make and hand down as a resolved enum. The component renders state; it
  does not compute it.
- **It does not survive cross-platform.** The discriminant is emitted verbatim as
  the case index. Web/RN can evaluate a JS expression, but SwiftUI and Compose
  cannot — they emit uncompilable native code (a JS ternary inside a Swift
  subscript / Kotlin `when`). A poor imitation on four of six platforms is worse
  than a redirect.

## Redirect

Pass a plain enum variant prop and compute the value upstream:

```yaml
# instead of
variant: { prop: "delta >= 0 ? 'positive' : 'negative'", cases: { ... } }

# do
props:
  - { name: direction, type: enum, values: [positive, negative] }
variant: { prop: direction, cases: { positive: { ... }, negative: { ... } } }
```

```ts
// data layer resolves the enum
const direction = delta >= 0 ? 'positive' : 'negative';
<StatCard direction={direction} ... />
```

A plain identifier (or a dotted member path like `item.status`) is accepted; a
computed expression is refused. Defense in depth: even if a discriminant slips
past, the `native-code` gate fails any un-evaluated JS expression that reaches
SwiftUI/Compose output.
