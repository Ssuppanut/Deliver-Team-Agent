---
name: component-contract
layer: design-system
description: >
  Defines and enforces the public API contract for a component — the prop set
  every adapter must expose identically. Use when defining or auditing a
  component's cross-platform API.
---

# component-contract

The prop set is a contract, not a suggestion. This skill owns it.

## The contract

Derived from `architecture.yaml` props and carried through the IR. Each prop:
`{ name, type, required, values?, itemShape? }` where type ∈
`string | number | boolean | enum | array | function | node`.

## Enforcement

`06-verify` parity check (also in `e2e-multi`) fails the build if any adapter's
generated source omits a prop name. Type mapping is per-adapter but the surface
is identical:

| spec type | TS | Swift | Kotlin |
|-----------|----|----|--------|
| string    | string | String | String |
| number    | number | Double | Double |
| boolean   | boolean | Bool | Boolean |
| function  | () => void | () -> Void | () -> Unit |
| array     | T[] | [Item] | List<Item> |

## Rule

Changing the contract is a versioned change — record it in the component's
`CHANGELOG.md` at handoff.
