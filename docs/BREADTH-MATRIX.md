# Breadth Matrix — Batch 1 (leaf primitives)

Six leaf-primitive components run end-to-end through the full pipeline
(`spec → IR → 6 adapters → 5 gates → cross-adapter parity`) as a breadth test
**and** a post-merge regression sanity check on `main`.

**Definition of PASS** (strict): all 6 adapters generate **and** the output is
semantically correct on each **and** all 5 gates pass **and** cross-adapter
parity holds. React compiling is *not* sufficient.

Runner: `node _shared/scripts/e2e-multi.mjs --feature <name>` · specs under
`.claude/artifacts/<name>/` (schema + tokens reused, nothing hardcoded).

Cell legend: `✓` correct · `⚠` correct but with a documented native limitation
(surfaced as a warning) · `✗` generates but the output is **wrong** on that
adapter.

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Button** | ✓ | ✓ | ✓ | ✓ | ✗ | ⚠ | 5/5 pass | **PARTIAL** | **F-1**: SwiftUI renders a *ref* label + leading icon as the literal string `"label"` (the prop name), not the bound variable. `variant` bg/fg + leading icon correct on the other five. Compose emits a documented "color variant not cascaded" warning. Capability gap: no `disabled` binding (**F-5**). |
| **Badge** | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | 5/5 pass | **PASS** | 4-way status variant + per-state icon; state never by color alone (slop-guard clean). Native adapters drop the `role=status` region (**F-2**) but the visible label + icon carry the status, so intent holds. Compose color-cascade warning. Capability gap: per-instance icon on/off toggle (**F-6**). |
| **Avatar** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PARTIAL** | Each adapter's conditional rendering is correct (`{src && …}` / `if let src` / `if (src != null)`). But **true** fallback ("initials *when* no image") is **not expressible** — the schema has no if/else and no `not`, so the two children are gated on separate props and the **caller** must supply exactly one (**F-3**). Native drops the `img` trait but the accessible name (`aria-label=name`) survives. |
| **Divider** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PARTIAL** | Renders a border-colored rule on all six. **Orientation (horizontal/vertical) is not expressible** — no `aria-orientation`, no width/height style slot (**F-4**). `role=separator` is dropped on the three native adapters (**F-2**). |
| **Spinner** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | 5/5 pass | **PARTIAL** | Web emits `role=status` + `aria-live=polite`. **All three native adapters drop both** (**F-2**) — the busy state is announced on no native platform, and "Loading" degrades to inert static text with no live-region fallback. Capability gaps: size variants, `aria-busy`, the spin animation itself (**F-7**). |
| **Skeleton** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PASS** | Padded, rounded, muted placeholder block on all six. `role=presentation` is a correct no-op on native (a plain container is already decorative). Capability gap: shimmer/pulse animation (**F-8**, out of engine scope by design). |

**Tally: 2 PASS · 4 PARTIAL · 0 REFUSE · 0 FAIL.**
Engine generates all 6 components across all 6 adapters with every gate green;
`rm -rf out/ && node _shared/scripts/ci.mjs` → exit 0 (see below). No FAIL —
but four components are PARTIAL, and **two defects are gate-invisible**, which is
the headline result of this batch.

---

## Why gates stayed green while output was wrong

The two most serious findings (F-1, F-2) pass **every** gate. This is the point
of a breadth test:

- **a11y-guard** inspects the **IR**, not per-adapter output — so an `aria-live`
  region that exists in the spec but is dropped by a native adapter is invisible
  to it.
- **cross-adapter parity** is **structural** — it checks that each prop *name*
  textually appears in the generated source. SwiftUI's `Label("label", …)`
  contains the substring `label`, so parity passes even though the value is
  wrong. Parity does not compare *semantics* across adapters.

Neither gate is broken; each has a scope, and these defects fall between them.

---

## Findings

Severity: **Critical** (ships broken / unsafe) · **Serious** (wrong output or
lost a11y contract on a platform) · **Moderate** (intent only approximated) ·
**Minor** (advisory / cosmetic). Not fixed inline — this batch measures.

### F-1 · Serious · SwiftUI renders a ref action-label as a literal — adapter bug
- **Where:** `adapters/swiftui/generate.mjs`, `visitAction`, the icon+label branch.
- **What:** `Label(${node.label ? JSON.stringify(String(node.label.value)) : '""'}, systemImage: …)` stringifies `node.label.value` unconditionally, ignoring `node.label.kind`. For a **literal** (e.g. Alert's `"Dismiss"`) it is correct; for a **ref** it emits the prop *name* as a string literal → a SwiftUI Button with a dynamic label + leading icon shows the word "label" instead of the bound value.
- **Blast radius:** any `action` with a **ref/expr** label **and** an `icon`. Alert never hit it (literal dismiss label), so it stayed latent until Button exercised a ref label + icon.
- **Why gates missed it:** parity is prop-*name* presence; `"label"` appears in the output. All 5 gates pass.
- **Proposed one-line fix (not applied):** reuse the existing `plain()` helper —
  `Label(${this.plain(node.label)}, systemImage: "${this.icon(node.icon)}")` —
  which yields `Label(label, …)` for a ref and `Label("Dismiss", …)` for a literal
  (`Label(_:systemImage:)` accepts a `StringProtocol` title). Add a regression
  check (ref-label + icon action) before applying.

### F-2 · Serious (Spinner) / Moderate (Divider, Badge) · Native adapters drop container `role` + `aria-live` — capability gap
- **Where:** `adapters/react-native`, `adapters/swiftui`, `adapters/compose` — `visitContainer` / a11y helpers map only `a11y.label` (→ `accessibilityLabel` / `.accessibilityLabel` / `contentDescription`). `node.role` and `a11y.live` are **not** mapped to any native trait.
- **What:** `role=status`, `role=separator`, `role=img`, and `aria-live=polite` are emitted on web (React/Vue/Svelte) but silently dropped on all three native adapters. Spinner is worst hit: its entire a11y contract is the live status region, so on RN/SwiftUI/Compose nothing announces the busy state.
- **Why gates missed it:** a11y-guard runs on the IR (which has the role/live); parity is structural. All 5 gates pass.
- **Direction (not applied):** map `node.role`/`a11y.live` to native affordances — SwiftUI `.accessibilityAddTraits`/`.accessibilityAddTraits(.updatesFrequently)`, Compose `Modifier.semantics { role = …; liveRegion = … }`, RN `accessibilityRole`/`accessibilityLiveRegion` — with an honest warning where a role has no native equivalent. This is an adapter enhancement, deliberately **not** built in this batch.

### F-3 · Moderate · No true conditional fallback (`if/else` / `not`) — schema gap
- **Where:** `_shared/schemas/design-spec.schema.yaml` — `when` gates a node on a prop's truthiness; there is no `else`, no negation.
- **What:** "Show image, **else** initials" cannot be expressed. Avatar approximates it with two independently-gated children (`when: src`, `when: initials`), pushing the branch to the caller (must pass exactly one). Passing both renders both; passing neither renders an empty avatar.
- **Not an adapter bug** — every adapter faithfully renders what the spec says; the spec cannot say what the component means.

### F-4 · Moderate · No orientation / dimension axis — schema gap
- Divider cannot express horizontal vs. vertical: no `aria-orientation` field and no width/height style slot (style slots map to color/space/radius tokens only). Only a horizontal rule is expressible.

### F-5 · Moderate · No `disabled` (boolean attribute) binding — schema gap
- An `action` has no way to bind a boolean prop to a `disabled`/`aria-disabled` attribute. Adding a `disabled` prop that never reaches output would also break the structural parity gate, so Button omits it. Button's disabled state is undeliverable today.

### F-6 · Minor · Variant icon is bound to the state, not a free toggle — schema gap
- Badge's per-state icon comes from the variant `cases`; there is no boolean prop to toggle the icon per instance independently of the state.

### F-7 · Minor · Spinner size / `aria-busy` / animation — schema gap
- No size style slot (sm/md/lg), no `aria-busy` in the a11y contract (only `live`), and the engine emits static structure — no keyframes/animation. All out of the current engine's expressive range.

### F-8 · Minor · No animation primitive — by design
- Skeleton shimmer / Spinner spin require animation the engine intentionally does not emit (static structure only). Recorded for completeness, not a defect.

---

## Regression sanity (clean-state CI)

`rm -rf out/ && node _shared/scripts/ci.mjs` — result pasted in the batch report.
Every existing feature plus the 6 new specs build, all gates green, exit 0. The
two gate-invisible defects (F-1, F-2) are **not** caught by CI for the reasons in
"Why gates stayed green" — closing that blind spot (a semantic-parity check, or
per-adapter a11y-output assertions) is a candidate follow-up, not part of this
measurement batch.
