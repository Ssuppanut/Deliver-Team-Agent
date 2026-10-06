# Breadth Matrix — Batch 1 (leaf primitives) + Batch 1.1 (gate hardening)

Six leaf-primitive components run end-to-end through the full pipeline
(`spec → IR → 6 adapters → 5 gates → cross-adapter parity`).

**Batch 1** surfaced 2 PASS / 4 PARTIAL / 0 FAIL — and, more importantly, two
defects that passed **every gate** while the output was wrong (semantic
false-green). **Batch 1.1** fixed both defects *and* hardened the two gates that
let them through, then proved the hardened gates actually fire.

**Definition of PASS** (strict): all 6 adapters generate, all 5 gates pass, and
cross-adapter parity holds — under the **hardened** gates (a11y output tier +
the F-1 parity lint), not just the IR-level ones. A row is PASS only if it
passes those; schema-expressiveness gaps that remain (F-3/F-4/F-5/F-7) are
tracked separately below and do **not** vanish because a row is PASS.

Runner: `node _shared/scripts/e2e-multi.mjs --feature <name>` · specs under
`.claude/artifacts/<name>/`. Cell legend: `✓` correct · `⚠` correct with a
**documented divergence warning** (a platform that cannot express a trait says
so — never a silent drop).

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates (hardened) | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Button** | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | 5/5 pass | **PASS** | **F-1 fixed**: SwiftUI now binds the ref label as a variable (`Label(label, …)`), verified by the new parity lint. Compose keeps its documented color-cascade warning. Logged gap: no `disabled` binding (**F-5**). |
| **Badge** | ✓ | ✓ | ✓ | ⚠ | ⚠ | ⚠ | 5/5 pass | **PASS** | 4-way status variant + per-state icon; state never by color alone. Native adapters now emit a documented divergence warning for `role=status` (was a silent drop). Logged gap: per-instance icon toggle (**F-6**). |
| **Avatar** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PASS** | `role=img` maps to real native traits (`accessibilityRole="image"` / `.isImage` / `role = Role.Image`). **F-3 now resolved:** Avatar uses a real `el: conditional` (`if hasImage → image, else → initials`) as a native if/else on all 6 — the true fallback, no longer two independently-gated children. |
| **Divider** | ✓ | ✓ | ✓ | ⚠ | ⚠ | ⚠ | 5/5 pass | **PASS** | Renders a border-colored rule on all six; `role=separator` now surfaced as a documented divergence warning on native (was silent). Logged schema gap (**F-4**, unfixed): orientation (vertical) is not expressible — no `aria-orientation`, no dimension slot. |
| **Spinner** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PASS** | **F-2 fixed**: all three native adapters now emit the live-region trait (`accessibilityLiveRegion="polite"` + `accessibilityState={{busy}}` / `.updatesFrequently` / `liveRegion = LiveRegionMode.Polite`); `role=status` is a documented divergence where no native role exists. Logged schema gaps (**F-7**, unfixed): size variants and the spin animation. |
| **Skeleton** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PASS** | Padded, rounded, muted placeholder block on all six. `role=presentation` is a correct no-op on native. Logged gap: shimmer/pulse animation (**F-8**, out of engine scope by design). |

**Tally after Batch 1.1: 6 PASS · 0 PARTIAL · 0 FAIL.**
`rm -rf out/ && node _shared/scripts/ci.mjs` → exit 0. All 6 components generate
across all 6 adapters, every (hardened) gate green; every native adapter that
cannot express a role now says so with a divergence warning instead of dropping
it. The four rows moved from PARTIAL to PASS **only** because they now pass the
hardened gates — the remaining schema-expressiveness gaps (F-3/F-4/F-5/F-7) are
still open and listed under "Still logged, unfixed."

---

## Batch 1.1 — what changed

### The two defects (both were gate-invisible in Batch 1)

**F-1 · Serious · SwiftUI ref-label stringified as a literal — FIXED.**
`adapters/swiftui/generate.mjs` `visitAction` stringified `node.label.value`
unconditionally, so a **ref** label + leading icon rendered the prop *name*
(`Label("label", …)`) instead of the bound variable. One-line fix: route the
title through the existing `plain()` helper, which respects `label.kind` →
`Label(label, …)` for a ref, `Label("Dismiss", …)` for a literal. The other five
adapters were already correct.

**F-2 · Serious/Moderate · Native adapters dropped `role` + `aria-live` — FIXED.**
RN / SwiftUI / Compose mapped only `a11y.label`. They now map `role` and
`a11y.live` to the platform-correct trait:

- **RN:** `accessibilityRole` (img→`image`, alert→`alert`), `accessibilityLiveRegion`, and `accessibilityState={{busy:true}}` for a live status region (Spinner).
- **SwiftUI:** `.accessibilityAddTraits(.isImage / .isButton / .isHeader)`, and `.updatesFrequently` for a live region.
- **Compose:** `Modifier.semantics { role = Role.Image; liveRegion = LiveRegionMode.Polite }` (imports added only when used).

Where a platform genuinely has no trait for a role (e.g. `status`/`separator`),
the adapter now emits a **documented divergence warning** — never a silent drop.
This also closed the same latent drop on the form-field error text (`role=alert`
+ `aria-live`) on all three native adapters.

### The two gate blind spots (closed)

**a11y-guard — output tier (additive).** `checkA11y(ir, results)` now, when the
IR declares `role`/`aria-live`, requires each adapter's **generated source** to
carry the platform-correct trait **or** a divergence warning naming that role.
IR-declared-but-output-missing now FAILS. The IR-only call (`checkA11y(ir)`) is
unchanged and still used by P5 — the new tier is purely additive.

**parity — narrow F-1 lint.** `checkParity` now flags a prop consumed as a ref
that is emitted as a string literal equal to its own name (the F-1 signature).
It is language-aware (JSX/native `"name"` is a literal; Vue `:x="name"` is a
binding, so Vue is checked only for a mustache-stringified ref). This is a
**targeted signature check**, deliberately *not* a full semantic cross-language
comparison.

### Fired-gate proofs (revert → RED → restore → GREEN)

A gate we have never seen go red is a gate we cannot trust.

**F-1 — parity fires on SwiftUI Button:**
```
### F-1 REVERTED — Button pipeline ###
  parity       FAIL  (1 issues)
  [serious] parity/parity: swiftui: ref prop "label" is emitted as the string literal "label" ...
  gates: FAIL
  swiftui output: Label("label", systemImage: "checkmark")

### F-1 RESTORED — Button pipeline ###
  parity       PASS  (0 issues)
  gates: PASS
  swiftui output: Label(label, systemImage: "checkmark")
```

**F-2 — a11y-guard fires on Spinner (all three native adapters):**
```
### F-2 REVERTED (native role/live dropped) — Spinner pipeline ###
  a11y-guard   FAIL  (6 issues)
  [serious] a11y/a11y-output-live: react-native: IR declares aria-live="polite" but the output has no live-region trait and no divergence warning
  [serious] a11y/a11y-output-role: react-native: IR declares role="status" ... neither the platform trait nor a divergence warning
  [serious] a11y/a11y-output-live: swiftui:  ... no live-region trait ...
  [serious] a11y/a11y-output-role: swiftui:  ... neither the platform trait nor a divergence warning
  [serious] a11y/a11y-output-live: compose:  ... no live-region trait ...
  [serious] a11y/a11y-output-role: compose:  ... neither the platform trait nor a divergence warning
  gates: FAIL     (native live traits present: 0 / 0 / 0)

### F-2 RESTORED — Spinner pipeline ###
  a11y-guard   PASS  (0 issues)
  gates: PASS     (native live traits present: 1 / 1 / 2)
```

### Regression pins

- **P29** — SwiftUI + parity: a ref label binds the variable, never a self-named
  literal (pins F-1 at the adapter level *and* asserts parity flags the signature).
- **P30** — a11y-guard output tier: native adapters must express IR `role`/`live`,
  not drop them (asserts the guard passes on the real output, FAILS on a
  simulated silent drop, and that the IR-only call is unchanged).

`verify-patches` is now **30 checks, all passing** (was 28).

---

## Still logged, unfixed (schema-expressiveness gaps — need their own design pass)

These are **not** adapter bugs and are out of scope for this batch. They are
carried forward so they are not lost:

- **F-3 · Moderate · No conditional fallback (`if/else` / `not`).** Avatar's
  "image *else* initials" is approximated by two independently-`when`-gated
  children; the caller must supply exactly one. Needs a schema design pass.
- **F-4 · Moderate · No orientation / dimension axis.** Divider cannot express
  vertical; no `aria-orientation`, no width/height style slot.
- **F-5 · Moderate · No `disabled` (boolean attribute) binding.** An `action`
  cannot bind a boolean prop to `disabled`/`aria-disabled`.
- **F-7 · Minor · Spinner size + animation.** No size style slot; the engine
  emits static structure (no keyframes). (`aria-busy` itself is now delivered on
  web via `role=status`+`aria-live` and on native via the live-region/busy
  traits from the F-2 fix.)
- **F-8 · Minor · No animation primitive (by design).** Skeleton shimmer /
  Spinner spin require animation the engine intentionally does not emit.

Scope for Batch 1.1 was strictly the two false-greens and the two gate blind
spots. No new components, no schema/fallback work, no new or removed gates, and
no changes to agents / skills / workflow / AI router.

---

# Batch 2 (variant / display components)

Four variant/display components run through the same pipeline against the
**hardened** gates (a11y output tier + the narrow ref-not-self-literal parity
lint). Batch 2 is also a live test of whether the Batch-1 hardening generalizes.

Cell legend: `✓` correct · `⚠` correct with a documented divergence warning ·
`○` generates but the stated intent is **silently unmet on that adapter** (no
gate catches it).

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Banner** | ✓ | ✓ | ✓ | ⚠ | ⚠ | ⚠ | 5/5 pass | **PASS** | Reuses the Alert pattern: 4-way severity variant + per-severity icon, `role=status`. Native `role=status` and Compose color-cascade are documented divergence warnings. Clean. |
| **EmptyState** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7/7 pass | **PASS** *(after B4/Phase B)* | Optional action (`when: onAction`) works on all 6. The hero icon now uses the **first-class `el: icon`** element (F-10 fixed), so `icon.star` renders on all 6 (`<Star/>` web/RN, `Image(systemName:"star")` SwiftUI, `Icon(Icons.Default.Star…)` Compose) and `declared-io` is clean. |
| **StatCard** | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | 7/7 pass | **PASS** | Ships the enum form (`direction` a plain prop): direction by per-direction icon + explicit sign, not color alone; slop-guard clean; valid on all 6. The **expression-driven** form of its intent (F-9) is now **REFUSED** by the orchestrator (see below), not silently mis-generated. Minor: no up/down arrow icon token (success/error used as proxies). |
| **TokenAmount** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 7/7 pass | **PASS** *(after B4/Phase B)* | `precision` now maps to a real native formatter (F-11 fixed, precision-only): SwiftUI `NumberFormatter` and Compose `NumberFormat` with `min=max fractionDigits = precision`, grouping off. Web/RN keep `toFixed(precision)`. `precision` is used on all 6 → `declared-io` clean. Locale/currency/rounding are **out of scope** → deferred as **F-12**. |

**Batch 2, final resolved state (Phase B): 4 PASS · 0 PARTIAL · 0 FAIL.**
Journey: B2 recorded 2 PASS / 2 PARTIAL (silent green); Batch-3 gates flipped the
two silent gaps to honest FAIL; **Phase B fixes the root causes** — F-9 → REFUSE,
F-10 → `el: icon`, F-11 → native precision formatter — so all four are now true
PASS and `ci.mjs` is green again (exit 0). The Batch-3 `native-code` /
`declared-io` gates stay in force as defense in depth. The expression-driven
discriminant form (F-9) is recorded as **REFUSE-correct**.

## Did the hardened gates catch anything on their own?

**No new defect this batch — and that is itself the finding.** The Batch-1
hardening was specific to the F-1 (ref-as-literal) and F-2 (dropped role/live)
signatures; it correctly stayed green here (a11y output tier passed with
divergence warnings; the ref-literal lint had nothing to fire on). But the two
gaps Batch 2 surfaced — **F-10** (declared icon silently dropped) and **F-11**
(precision declared-but-unused on native) — are *new* silent-drop classes that
**no current gate catches**, exactly as F-1/F-2 were invisible before Batch 1.1.
The hardening did not generalize to them; each would need its own output-tier
assertion (deliberately **not** built here — logged only, per path A). The
expression-driven-variant case (**F-9**) is the same story: SwiftUI/Compose emit
invalid code with no warning and every gate passes.

## Capability-gap findings (Batch 2)

Severity: Moderate unless noted. None fixed — logged for the single conditional-
schema design pass later.

### F-9 · New · Variant selection cannot be driven by an expression / derived value
- **Component:** StatCard (and any sign/threshold-driven variant).
- **Exact intent that could not be expressed:** choose the variant case from a
  computed discriminant (e.g. `direction = delta >= 0 ? 'positive' : 'negative'`)
  instead of a caller-supplied enum prop. `variant.prop` is emitted verbatim as
  the case index: React/Vue/Svelte/RN accept a JS expression, but **SwiftUI and
  Compose emit invalid code** (`[dict][delta >= 0 ? 'positive' : 'negative']`,
  `when (delta >= 0 ? 'positive' : 'negative')`) with **no warning and all gates
  green**. Workaround shipped: caller precomputes `direction`.
- **Maps to:** the F-3 family (no conditional/derived logic) but a **distinct
  mechanism** (variant discriminant, not child render) → new number.

### F-10 · New · No standalone decorative-icon element
- **Component:** EmptyState (hero icon above the heading).
- **Exact intent that could not be expressed:** render an icon-token glyph as its
  own element. `icon` is honored only on `action` nodes and as a `variant` lead
  on a container; `icon` set on a plain container is **silently ignored by all 6
  adapters**. There is no `el: icon` kind. Also a **gate blind spot**: no guard
  flags a declared-but-unrendered icon.
- **Maps to:** genuinely new.

### F-11 · New · Per-platform number formatting not expressible on native
- **Component:** TokenAmount (fintech/crypto amount + precision).
- **Exact intent that could not be expressed:** format a number to a prop-driven
  precision (and, by extension, locale/thousands separators). Achieved on
  **web + React Native** via a JS `expr` (`amount.toFixed(precision)`), but
  **SwiftUI/Compose cannot eval JS** and fall back to the raw first identifier
  (`amount`, unformatted), leaving **`precision` a declared-but-unused prop**.
  Surfaced by the `expr simplified` warning, but **parity false-passes** because
  the prop declaration satisfies the substring check.
- **Maps to:** genuinely new (extends the P3/P5 native-expr limitation into an
  explicit capability gap). **Do not** build a number-format framework here.

### F-3 recurrence check
- **No component required a true either/or (`if/else` / `not`) child fallback
  this batch.** EmptyState used a one-way `when: onAction` (supported). The
  closest relative that *did* surface is **F-9** (expression-driven variant),
  logged above.

## Running list — all logged-unfixed findings after Batch 2

| # | Status | Summary |
|---|---|---|
| F-1 | **Fixed (B1.1)** | SwiftUI ref label stringified as its own name. |
| F-2 | **Fixed (B1.1)** | Native adapters dropped `role`/`aria-live` from output. |
| F-3 | **Fixed (F-3 pass)** | Conditional rendering shapes 1–3 (`el: conditional`: if / if-else / conditional-wrapping-iteration) on all 6 adapters; condition is a boolean flag, expression conditions refused. |
| F-4 | **Resolved (Phase H)** | `orientation` (horizontal/vertical) slot — web `aria-orientation` (semantic) + native layout axis (HStack/Row vs VStack/Column, RN `flexDirection`). Divider vertical renders on all 6; trait ledger-accounted. |
| F-5 | **Resolved (Phase H)** | `disabled` boolean-attribute binding (a plain caller flag ref; expressions refused as `expression-boolean-attr`) — web/RN `disabled`, SwiftUI `.disabled()`, Compose `enabled = !flag`. Button disabled renders on all 6. |
| F-6 | Logged (minor) | Variant icon bound to the state, not a free per-instance toggle (Badge). |
| F-7 | **Resolved (Phase H)** | `size` slot referencing a **dimension token** (width/height; SwiftUI `.frame`, Compose `.size`). Hardcoded native sizes FAIL token-guard. Spinner sized from `space.6` on all 6. **Residual:** no dedicated `size.*` scale — existing `font.size.*`/`space.*` tokens are reused. |
| F-8 | Logged (by design) | No animation primitive (shimmer / spin). |
| F-9 | **Resolved — REFUSE (Phase B)** | Expression-driven variant discriminant is now refused by the orchestrator with an enum redirect (`expression-variant`). `native-code` gate stays as defense in depth. |
| F-10 | **Fixed (Phase B)** | Added the first-class `el: icon` element; a standalone icon renders on all 6 via the icon-map, decorative by default / labeled when `a11y.label` set. |
| F-11 | **Fixed (Phase B, precision-only)** | `X.toFixed(Y)` maps to SwiftUI `NumberFormatter` / Compose `NumberFormat` with `min=max fractionDigits = precision`, grouping off. Web/RN unchanged. |
| F-12 | **RESOLVED (locale + currency + grouping + rounding)** | Number formatting is complete: on top of F-11 precision, a `kind: format` value composes locale, currency, grouping, and rounding-mode into ONE native formatter per adapter (Intl.NumberFormat / NumberFormatter / java.text.NumberFormat). Each option is a static literal or a plain prop ref (runtime switching); an expression as any option is refused (F-9). All three round/floor/ceil modes exist on all platforms — **no divergence**. **Residual (logged, out of scope):** custom pattern strings (`#,##0.00`) — native formatter options only; and date/time formatting (**F-26**, new). See the F-12 section below. |
| F-13 | **RESOLVED (nested / else-if / per-item, depth-capped)** | All three deferred conditional shapes now ship: nested conditional, else-if chain, and per-item conditional (boolean field-access on the loop item). Total conditional nesting is capped at 3 levels (nested + else-if + per-item counted together); deeper nesting is refused with an extract-subcomponent redirect. Per-item conditions are field-access only — a per-item comparison/logic is refused (F-9-consistent). **Residual (by design, not a gap):** nesting beyond depth 3 is refused, not generated. See the F-13 section below. |

Scope for Batch 2 was strictly authoring 4 component specs and recording results.
No renderer-base/schema capabilities built, no conditional/number-format
infrastructure, no gate changes, and no changes to agents / skills / workflow /
AI router.

---

# Batch 3 (gate-hardening — generalize the output-tier discipline)

Batch 2 surfaced three silent-failure classes the gates did not catch. Batch 3
adds two output-tier hardenings so those classes go RED on their own, and pins
them. This is a **gate** change only — **no** component/renderer/schema fix. The
engine-direction question (should native REFUSE / FAIL / pre-compute an
expression it can't eval) is **deferred**; the gate default chosen here is
**FAIL** because it is the most reversible outcome.

## The two hardenings (approach + limits)

**H1 · `native-code` — no uncompilable native output (F-9 class).**
`checkNativeExprLeak(ir, results)` in `_shared/scripts/output-guards.mjs`.
Approach (targeted, IR-anchored + output-confirmed): collect every
`variant.prop` that is **not** a plain identifier / dotted member path (i.e. it
carries a JS ternary, comparison, call, or quotes), then FAIL if that exact
string appears **verbatim** in a SwiftUI or Compose output. *Limit:* it targets
the one place the engine currently emits an un-evaluated expression verbatim (the
variant discriminant). Text/label `expr`s are **not** covered here because the
native adapters already simplify them to a single identifier and emit a
documented `expr simplified` warning — the *consequence* of that simplification
(a dropped secondary prop) is caught by H2a, not H1. A full native compile check
was judged too heavy for this pass.

**H2 · `declared-io` — a silently-dropped declaration is a FAIL (F-10/F-11).**
`checkDeclaredDropped(ir, results)`. When the IR declares something and an
adapter's output neither expresses it nor emits a **documented divergence
warning**, that adapter FAILs. Two detectors:
- **H2a declared-but-unused prop** — a prop that never appears in a native
  adapter's rendered **body** (props/type signature stripped) is a silent drop,
  *unless* a prose divergence warning names it. The `expr simplified` warning
  does **not** count: its quoted expression is stripped before the match, so a
  prop that survives only inside that quote (e.g. `precision` in
  `"amount.toFixed(precision)"`) is still a FAIL. *Limit:* enforced on the two
  native adapters via body extraction — expr-simplification, the only current
  prop-drop mechanism, is native-only (web/RN keep the `expr` and use the prop).
- **H2b unrenderable declared icon** — an `icon` on a node that is neither an
  `action` nor a container with a `variant` icon case. The renderers only place
  icons in those two positions, so any other `icon` is dropped on **every**
  adapter. *Limit:* structural (IR-anchored), matching the renderers' two
  icon-bearing positions.

The escape hatch is uniform with the Batch-1.1 a11y tier: **warned = acceptable
divergence (PASS); silently absent = FAIL.**

## Fired-gate proofs

**H1 → the F-9 pattern (expression-driven variant) goes RED; the shipped enum
StatCard stays GREEN (no over-flag):**
```
### H1 — F-9 pattern (variant.prop = "deltaValue >= 0 ? 'positive' : 'negative'") ###
  native-code  FAIL  (2 issues)
  [serious] native-code/native-expr-leak: swiftui: emits the un-evaluated JS expression `deltaValue >= 0 ? 'positive' : 'negative'` verbatim in native syntax (uncompilable output)
  [serious] native-code/native-expr-leak: compose: emits the un-evaluated JS expression `deltaValue >= 0 ? 'positive' : 'negative'` verbatim in native syntax (uncompilable output)
  gates: FAIL

### CONTROL — shipped StatCard (variant.prop = "direction", a plain enum) ###
  native-code  PASS  (0 issues)
  gates: PASS
```

**H2 → EmptyState (F-10) and TokenAmount (F-11) go RED; every original gate was
green (the pre-hardening false-green):**
```
### empty-state ###
  readiness PASS · a11y PASS · token PASS · perf PASS · slop PASS · parity PASS · native-code PASS
  declared-io  FAIL  (6 issues)   ← icon.star dropped on all 6 adapters
  gates: FAIL

### token-amount ###
  readiness PASS · a11y PASS · token PASS · perf PASS · slop PASS · parity PASS · native-code PASS
  declared-io  FAIL  (2 issues)   ← precision dropped on swiftui + compose
  gates: FAIL
```

**No over-flagging.** Banner and all six Batch-1 primitives (Button, Badge,
Avatar, Divider, Spinner, Skeleton) plus product-card, user-card-list, alert and
form-field stay GREEN on both new gates. (product-card's price `expr` keeps its
prop as the surviving first identifier, so H2a does not fire on it.)

## Regression pins

- **P31** — `native-code`: a JS-expression variant discriminant is flagged on
  both native adapters (RED), a plain-identifier discriminant passes (GREEN).
- **P32** — `declared-io`: a dropped prop and an unrenderable icon FAIL; a
  body-used prop, a prose-documented divergence, and an action-borne icon pass.

`verify-patches` is now **32 checks, all passing** (was 30).

## Honest note on StatCard

The **shipped** StatCard uses the enum workaround (`direction` is a caller-supplied
prop), so its output is valid on all six and it correctly **stays PASS** under the
new gates — H1 must not over-flag a correct component. StatCard therefore did
**not** itself move to FAIL. The F-9 gap it works around is real and now
gate-caught: expressing the intent directly (deriving the case from the numeric
sign) FAILs `native-code`, as proven above. Rewriting the shipped spec to the
direct (failing) form would be a deliberate change; I did not make it unilaterally.

## ci.mjs status under Batch 3

`node _shared/scripts/ci.mjs` now exits **1** — **by design and correct**. The two
honest FAILs are **empty-state** (`declared-io`: `icon.star` dropped on all 6) and
**token-amount** (`declared-io`: `precision` dropped on SwiftUI + Compose). Every
other feature passes every gate; `verify-patches` is 32/32. CI is red because the
matrix now tells the truth, not because anything regressed.

Scope for Batch 3: two output-tier gate checks + their pins + this record. No
component/renderer/schema fix, no refusal routing or expression pre-compute
(deferred to Phase B), no new components, and no changes to agents / skills /
workflow / AI router.

---

# Phase B (resolve the three deferred findings at the root)

Batch 3 made F-9/F-10/F-11 go RED honestly. Phase B fixes each at its **root
cause**, handled differently per the decision:

- **F-9 → REFUSE.** An expression used as a variant discriminant (a ternary /
  comparison / call, e.g. `delta >= 0 ? 'positive' : 'negative'`) is now refused
  by the orchestrator (`refusal.mjs`) with a new `expression-variant` category,
  redirecting the author to a plain enum computed in the data layer. Reference:
  `knowledge/pattern-library/references/expression-variant.md`. A plain
  identifier or dotted member path is accepted. The Batch-3 `native-code` gate
  stays as defense in depth for any expression that slips past the refusal.
- **F-10 → structural fix.** New first-class `el: icon` element (schema + IR +
  `renderer-base` dispatch + a `visitIcon` in all 6 adapters). It renders through
  the existing icon-map (lucide on web/RN, SF Symbols on SwiftUI, Material Icons
  on Compose) and carries the a11y contract: **decorative** (`aria-hidden` /
  `accessible={false}` / `.accessibilityHidden(true)` / `contentDescription = null`)
  by default, **labeled** when `a11y.label` is present. `declared-io` H2b now
  treats an `el: icon` as a valid icon position.
- **F-11 → BUILD, precision-only.** SwiftUI/Compose map `X.toFixed(Y)` to a real
  native decimal formatter with `min = max fractionDigits = precision` and
  grouping off. **Precision-only:** no locale, no currency, no rounding mode, no
  grouping options — those are logged as **F-12** and deferred.

## Gate transitions (before/after)

**F-9 — expression discriminant now REFUSED; the enum form still generates:**
```
### expression discriminant (variant.prop = "deltaValue >= 0 ? 'positive' : 'negative'") ###
REFUSED: category "expression-variant" is out of scope
  why:     a variant case must be selected by a plain enum prop, not an embedded expression
           (found: `deltaValue >= 0 ? 'positive' : 'negative'`) — computed selection is presentation
           logic that belongs in the data layer
  instead: pass a plain enum variant prop (e.g. direction: 'negative') and compute the value in the data layer
  No code generated (correct outcome).

### shipped StatCard (variant.prop = "direction", plain enum) ###  gates: PASS
```

**F-10 — `icon.star` now renders on all 6; declared-io RED on revert → GREEN on restore:**
```
star present:  react 2 · vue 2 · svelte 2 · react-native 2 · swiftui 1 · compose 1
  swiftui: Image(systemName: "star")      compose: Icon(Icons.Default.Star, contentDescription = null)
### REVERT (icon back on the container) ###   declared-io FAIL (6)   → gates: FAIL
### RESTORE (el: icon) ###                     declared-io PASS (0)   → gates: PASS
```

**F-11 — native precision formatter present + correct; declared-io RED on revert → GREEN on restore:**
```
swiftui: Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.usesGroupingSeparator = false;
                f.minimumFractionDigits = Int(precision); f.maximumFractionDigits = Int(precision);
                return f.string(from: NSNumber(value: amount)) ?? String(amount) }())
compose: java.text.NumberFormat.getNumberInstance().apply { isGroupingUsed = false;
                minimumFractionDigits = precision.toInt(); maximumFractionDigits = precision.toInt() }.format(amount)
### REVERT (formatter disabled) ###   declared-io FAIL (2: precision dropped on swiftui+compose)  → gates: FAIL
### RESTORE ###                        declared-io PASS (0)  → gates: PASS
```
Correctness: both formatters set `min = max fractionDigits = precision` with
grouping off — the exact semantics of `toFixed(precision)` (e.g. precision 2 →
`1234.50`, `1234.567 → 1234.57`; precision 0 → `42`; precision 4 → `0.1000`).
*Note:* this container has no Swift/Kotlin toolchain, so native output is verified
by construction (canonical formatter APIs) + the JS `toFixed` reference, not by
compiling — consistent with the rest of the project (no native compile step).

## F-11 scope confirmation

**Precision-only.** The only thing mapped is the number of fraction digits
(`minimum/maximumFractionDigits = precision`). Explicitly **not** built, and
logged as **F-12 (deferred)**: locale (decimal separator / thousands grouping),
currency symbol handling/positioning, rounding-mode configuration, grouping
options. `isGroupingUsed=false` / `usesGroupingSeparator=false` keeps output to
"same number, controlled decimal places" with no grouping.

## Regression pins

- **P33** — F-9: an expression discriminant is refused with an enum redirect; a
  plain enum and a dotted member path pass; overlay/data-table refusals unchanged.
- **P34** — F-10: the standalone `el: icon` renders on all 6; `declared-io`
  accepts an `el: icon` and still FAILs an icon on a plain container.
- **P35** — F-11: SwiftUI/Compose emit the native precision formatter; real
  output passes `declared-io`; a dropped precision still FAILs it.

`verify-patches` is now **35 checks, all passing** (was 32).

## ci.mjs status after Phase B

`node _shared/scripts/ci.mjs` is **GREEN again (exit 0)** — the real defects are
fixed, not hidden. All in-scope features pass every gate (including the two new
Batch-3 gates); modal/data-table still refuse; the expression-discriminant form
refuses; `verify-patches` 35/35.

Scope for Phase B: F-9 refusal, F-10 `el: icon` element, F-11 precision-only
native formatter, plus P33–P35 and this record. No gate weakened or removed, no
new components, no changes to agents / skills / workflow / AI router, and the
overlay/table refusal behavior is unchanged.

---

# F-3 — conditional rendering (roadmap step ข)

A renderer-base-level capability (like `variant`): a spec expresses "show X, or Y,
based on a condition", generated as each platform's native conditional construct.

## IR node design

A new element kind **`el: conditional`** with a boolean condition and one/two branches:

```yaml
el: conditional
when: hasImage        # boolean FLAG prop (never an expression — see refusal)
then: { el: media, ... }     # required — rendered when the flag is true
else: { el: text, ... }      # optional — rendered when false
```

`spec-to-ir` lowers `then`/`else` into `children[0]`/`children[1]` (so every guard
that walks `children` also traverses both branches — no guard changes needed).
`renderer-base.visitConditional` renders each branch via the shared `renderNode`
and defers only the platform syntax to each adapter's `condBlock(flag, then, else)`.
Because a branch is a normal node, it may carry its own `each` — that is shape 3
(the conditional sits *outside* the iteration and chooses list-vs-fallback). The
node consumes its own `when`; `renderNode` skips the element-level one-way `when`
wrap for a `conditional` kind so it is never double-wrapped.

| adapter | one-way (shape 1) | if/else (shape 2) |
|---|---|---|
| React / RN | `{flag && ( … )}` | `{flag ? ( … ) : ( … )}` |
| Vue | `<template v-if="flag">…</template>` | `+ <template v-else>…</template>` |
| Svelte | `{#if flag} … {/if}` | `… {:else} … {/if}` |
| SwiftUI | `if flag { … }` | `if flag { … } else { … }` |
| Compose | `if (flag) { … }` | `if (flag) { … } else { … }` |

## Proofs (correct native construct, not a stringified condition)

**Shape 1 (if / show-hide)** — `cond-show`, `showNote`:
React `{showNote && (…)}` · Vue `<template v-if="showNote">` · Svelte `{#if showNote}` ·
RN `{showNote && (…)}` · SwiftUI `if showNote {` · Compose `if (showNote) {` — no else branch on any.

**Shape 2 (if/else)** — `Avatar`, `hasImage` → image, else initials:
React `{hasImage ? (<img …/>) : (<span>{initials}</span>)}` · Vue `v-if`/`v-else` ·
Svelte `{#if hasImage}…{:else}…{/if}` · RN `{hasImage ? (<Image/>) : (<Text>{initials})}` ·
SwiftUI `if hasImage { AsyncImage… } else { Text(…initials) }` ·
Compose `if (hasImage) { AsyncImage… } else { Text(…) }`.

**Shape 3 (conditional + one-level iteration)** — `cond-list`, `isEmpty` → fallback, else → list:
React `{isEmpty ? (<div role="status">…</div>) : (items.map((item) => …))}` ·
Vue `v-if`/`v-else` with `v-for="item in items"` in the else ·
Svelte `{#if isEmpty}…{:else}{#each items as item (item.id)}…{/each}{/if}` ·
SwiftUI `if isEmpty { … } else { ForEach(items, id: \.id) { item in … } }` ·
Compose `if (isEmpty) { … } else { items.forEach { item -> … } }`.
The existing iteration construct renders correctly inside the else branch on all 6.

**Refusal (expression condition = F-9 anti-pattern through the back door):**
```
when: "items.length > 0"  →
REFUSED: category "expression-condition" is out of scope
  why:     a condition must be a plain boolean flag prop, not an embedded expression
           (found: `items.length > 0`) — compute the boolean in the data layer
  instead: pass a boolean flag prop (e.g. when: isEmpty) computed in the data layer, not a JS expression
  No code generated.
```
The boolean-flag form (`when: isEmpty`) generates and passes. The orchestrator
refusal now scans both `variant.prop` (F-9) and every `when` (F-3), recursing
`then`/`else`. This is the F-9-consistent refusal added to the existing refusal
gate — not an architecture change.

## Gate interaction

The `native-code` gate does **not** over-flag a legitimate native `if/else`: it
only matches un-evaluatable JS expressions collected from `variant.prop`, so a
conditional-only spec has nothing to flag — confirmed `native-code PASS` on
Avatar, cond-list, and cond-show. All existing gates (a11y, token, perf, slop,
readiness, `native-code`, `declared-io`, parity) pass on the conditional output.

## Regression pins

- **P36** — shape 1 (if) renders the native show/hide construct on all 6, no else.
- **P37** — shape 2 (if/else) emits both branches as native conditionals on all 6.
- **P38** — shape 3 conditional-wrapping-iteration; the iteration still renders inside the else.
- **P39** — an expression condition is refused with a flag redirect; a plain flag passes; the F-9 variant refusal still fires.

`verify-patches` is now **39 checks, all passing** (was 35).

## Out of scope — logged, not built

Nested conditional, else-if chains, per-item conditional (inside each iterated
item), and conditionals nested more than one level in iteration are **F-13
(deferred)**. An expression as a condition is **refused** (F-9 rule), never
evaluated.

Scope for F-3: the `el: conditional` node (schema + IR + renderer-base + a
`condBlock` in all 6 adapters), the `when`-expression refusal, Avatar upgraded to
a true if/else, two conditional fixtures (`cond-show`, `cond-list`), P36–P39, and
this record. No gate weakened or removed; overlay/table refusal unchanged; no new
roadmap components; no agent/skill/workflow/AI-router changes beyond the
F-9-consistent refusal category.

---

# Layer 1 — The Lowering Ledger (totality check)

## Why this layer exists

Three times in a row a real defect passed **every** gate green because the
system tolerated an adapter *silently dropping* a semantic trait it could not
express. Most recently: the form-control roles `role=switch / checkbox / slider`
were dropped on all three native adapters — the checkbox rendered as a bare
`TextField` — while every gate stayed green (findings **F-14 / F-15 / F-16**).

The root cause was **not** any one adapter. It was the *shape* of our gate
hardening: every fix was **per-class / whitelist-based** (a11y-guard enforces a
fixed `ENFORCED_ROLES` set; declared-io enumerates prop/icon drops). Each new
component category introduced a trait outside every whitelist, so the same
silent-drop class re-appeared one component later, invisibly.

Layer 1 makes a silent drop **structurally impossible** rather than
detectable-once-we-add-a-rule. It does **not** replace the existing gates — it
sits underneath them as a totality check.

## Mechanism

For every node, the base renderer (`adapters/_shared/renderer-base.mjs`) derives
a `pending` set of the traits the **IR** declares on that node
(`declaredTraits`): `role=<value>`, `a11y.label`, `a11y.live=<value>`,
`a11y.invalid`, `a11y.labelledBy`, `a11y.describedBy`. The set is derived from
the IR — **there is no list of known roles** — so a brand-new role value or a11y
field enrols automatically.

Each adapter, as it renders the node, must account for every pending trait:

- `express(traitId, { mechanism })` — emitted via a real platform mechanism.
- `diverge(traitId, { reason, fallback, waiver })` — the platform genuinely
  cannot express it; cites a waiver.

Anything still pending after the node renders is recorded **`unaccounted`**. The
`ledger` gate (`_shared/scripts/ledger-gate.mjs`, wired into `e2e-multi.mjs`)
reads that ledger — **never the generated source** — and enforces:

| status | outcome |
|---|---|
| `expressed` | PASS |
| `diverged` | requires a matching, **non-expired, approved** waiver (else FAIL) |
| `unaccounted` | **FAIL** — names component / adapter / traitId |

Waivers reuse the existing a11y-guard policy verbatim ("Only with an explicit
expiry date and an approver. No open-ended waivers.") — encoded as a registry at
`_shared/policy/a11y-waivers.json`. A divergence whose waiver is missing,
expired, or unapproved fails the gate.

**Additive, not a replacement:** a11y-guard, token-guard, perf-guard, slop-guard,
parity, native-code (H1) and declared-io (H2) are all unchanged and still run.
The ledger is a new gate beneath them.

## The four proofs

**1 · The ledger catches a silent drop with no gate edit.** Temporarily made the
React adapter emit `role="alert"` in output but *not* call `express` (a one-line
change to the adapter, **zero** changes to any gate file):

```
BEFORE  alert  ledger PASS (16 expressed, 2 diverged, 0 unaccounted)   gates: PASS
AFTER   alert  ledger FAIL (15 expressed, 2 diverged, 1 unaccounted)   gates: FAIL
  [critical] ledger/ledger-unaccounted: react: component "Alert" (container)
             drops trait `role=alert` — neither expressed nor diverged (silent drop)
```

Reverted; `alert` returns to PASS. The gate read the *ledger*, not the source —
the role was still present in the emitted JSX.

**2 · No whitelist — a never-seen trait is enforced with zero gate code.** Added a
spec with `role: zorptastic-9000` (a value that appears in no adapter map, no
gate, no waiver). With **no edit** to `ledger-gate.mjs`:

```
_tmp-novel  ledger FAIL (3 expressed, 3 diverged, 0 unaccounted)   gates: FAIL
  web adapters express role="zorptastic-9000"; the 3 natives cannot map it, so
  they diverge citing waiver "a11y-role-zorptastic-9000" — which does not exist → FAIL
```

The brand-new trait was auto-enforced: to pass it must be **expressed** or
covered by an **approved waiver**. It cannot pass silently.

**3 · No over-flag.** `rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**.
All 19 in-scope features PASS, both refused categories still refuse, `0`
unaccounted anywhere. Every previously-passing component still passes.

**4 · The 3 natives now express the form-control roles** (real mechanism in the
ledger and in the output):

| role | React Native | SwiftUI | Compose |
|---|---|---|---|
| `checkbox` | `<Switch> + accessibilityRole="checkbox" + accessibilityState={{checked}}` | `Toggle(label, isOn:)` | `Checkbox(checked/onCheckedChange) + semantics { role = Role.Checkbox }` |
| `switch` | `<Switch> + accessibilityRole="switch" + accessibilityState={{checked}}` | `Toggle(label, isOn:)` | `Switch(...) + semantics { role = Role.Switch }` |
| `slider` | `<Slider> + accessibilityRole="adjustable" + accessibilityValue` | `Slider(value:) + .accessibilityLabel` | `Slider(value/onValueChange)` (built-in range semantics) |

Fixtures: `.claude/artifacts/{checkbox,switch-toggle,slider}/`. Each shows
`ledger PASS (12 expressed, 0 diverged, 0 unaccounted)` — role **and** accessible
name expressed on all 6 adapters. A native checkbox is now a real toggle, never a
bare text field.

## Breadth matrix — form controls (true state)

Cell legend as above (`✓` correct · `⚠` documented divergence).

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Checkbox** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `role=checkbox` + checked state expressed as a real toggle on every native (RN `Switch`+`accessibilityState`, SwiftUI `Toggle`, Compose `Checkbox`+`semantics{role}`). Was a silent drop (F-14/F-15). |
| **Switch** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `role=switch` + on/off state expressed as a real toggle on every native. Was a silent drop (F-14/F-15). |
| **Slider** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `role=slider` expressed as a real adjustable control (RN `Slider`+`accessibilityValue`, SwiftUI `Slider`, Compose `Slider`). Was a silent drop (F-14/F-16). |

("Gates 9/9" = the seven prior gates + native-code + the new ledger.)

## Findings ledger — update

| ID | Status | Note |
|---|---|---|
| **F-14** | **Resolved** | Form-control roles (`checkbox`/`switch`/`slider`) silently dropped on all 3 natives while gates stayed green. Now (a) **structurally impossible** to drop silently — the Lowering Ledger fails any unaccounted trait; and (b) the three roles are **expressed** as real native controls. |
| **F-15** | **RESOLVED — see "Control-state primitive" below.** | The control-state primitive now provides a schema-level bound state contract (`input.state.kind: boolean \| selected-value`) generated as each platform's native two-way binding across all 6 adapters, and the ledger accounts for it (`state=<kind>`). The a11y-trait portion was done in Layer 1; the binding is now done here. |
| **F-16** | **RESOLVED — see "Control-state primitive" below.** | `numeric-range` state (`min`/`max`/`step`) is now a first-class binding contract, wired natively (`Slider(in: min...max, step:)` / `valueRange`/`steps` / `minimumValue`/`maximumValue`/`step`). **Residual (unchanged):** display *formatting* ("$1,234.50") remains **F-11/F-12** — a distinct concern, deliberately not pulled in. `textarea` (multiline) remains **F-19**. |
| **F-17** | Logged (unchanged) | Radio + single-select group semantics (one-of-N) — deferred, not in this layer's scope. |
| **F-18** | Logged (unchanged) | Native `select` + option list — deferred. |
| **F-19** | Logged (unchanged) | `min`/`max`/`step` numeric constraints and `textarea` (multiline) — deferred (overlaps F-16 residual). |
| **F-20** | **Resolved (surfaced by the ledger)** | *New finding, caught immediately by Layer 1 on first run:* the React Native and Compose `action` (button) visitors dropped an explicit `a11y.label` — the Alert dismiss button's "Dismiss alert" accessible name was silently lost on both, green on every prior gate. Fixed: RN `visitAction` now emits `a11yProps`; Compose `visitAction` now emits an a11y semantics block. This is the exact class F-14 belongs to, found without adding any rule. |

## Regression pins

- **P40** — ledger: a trait neither expressed nor diverged is `unaccounted` and
  FAILS, naming adapter / component / traitId; expressing it PASSes (gate reads
  the ledger, not source).
- **P41** — no whitelist: a never-before-seen role value auto-enrols from the IR
  and is enforced with zero edits to the gate or any role list.
- **P42** — the `checkbox` / `switch` / `slider` roles are **expressed** with a
  real native mechanism on RN, SwiftUI and Compose (ledger status + output
  control confirmed); no trait unaccounted.
- **P43** — a divergence needs a matching, non-expired, **approved** waiver;
  expired / unknown waivers FAIL; the shipped registry is well-formed.

`verify-patches` is now **43 checks, all passing** (was 39).

## ci.mjs status under Layer 1

`rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**. 19 features PASS, 2
refused (data-grid, modal), `0` unaccounted across `~180` ledger entries,
43/43 regressions pass.

## Scope — logged, not built

Per the Layer-1 scope lock, this change is **only** the totality check plus the
form-control-role fix. It does **not**: migrate the IR off ARIA/neutral semantic
kinds; build a runtime platform-a11y oracle; build a gate mutation-testing
framework; build the full control-state primitive (F-15 residual) or range
semantics (F-16/F-19 residual); weaken or remove any existing gate; add new
breadth components (the three form-control specs are test vehicles for the
express() fix, not a new batch); or touch agents / skills / workflow / AI-router.
No existing gate was weakened: a11y-guard, token-guard, perf-guard, slop-guard,
parity, native-code and declared-io are all unchanged and still run.

---

# Layer 3 — Gate mutation testing (proving the gates)

## Why this layer exists

Throughout this project we proved each gate works **by hand**: revert a fix,
confirm the gate goes RED, restore. That is trustworthy but manual, one gate at a
time, and easy to forget for a gate we have not touched lately. **A gate you have
never seen go RED is a gate you cannot trust.** Layer 3 automates that revert-proof
across every gate and every defect class, so a **blind spot in the gates
themselves** is found before shipping, not after.

## Mechanism — mutation testing for gates

`_shared/scripts/mutate-gates.mjs` (`npm run mutate:gates`):

1. For a corpus of already-passing features (all 19 in-scope specs — the Batch
   1/2 components, the conditional specs, the form-control inputs, product-card /
   alert / form-field), generate the full bundle `{ ir, results(6 adapters),
   ledger }`.
2. Confirm the **un-mutated baseline is all-GREEN** on every gate, so any RED
   below is caused by the mutation, never a pre-existing failure.
3. For each **mutation operator**, inject exactly **one** defect into a clone of
   the bundle → a **mutant**.
4. Run **all** gates against the mutant.
5. **Kill criterion:** a mutant is KILLED if ≥1 blocking gate goes RED. A mutant
   that leaves every gate GREEN is a **SURVIVING MUTANT** — a proven blind spot.

**Faithfulness.** A mutant models a state a real buggy generator could actually
produce, so survivors are real and not harness artifacts. A dropped trait is
removed from the adapter's `code` **and** its ledger entry flips to `unaccounted`
(a real adapter that drops a trait also never called `express()`). IR-anchored
defects (native-expr-leak, unresolved-TBD) mutate the IR; the perf gate is
advisory (`ok:true` always) and is never counted as a killer — identical to
`e2e-multi`'s own wiring. The run is deterministic (sorted corpus, deterministic
site selection).

## Mutation operators

| Operator | Defect class | Expected killer |
|---|---|---|
| `drop-trait` | ledger / declared-io | ledger (`unaccounted`) |
| `remove-a11y` | a11y (enforced role/live) | a11y output tier |
| `native-expr-leak` | native-code | native-code |
| `ref-as-literal` | parity (the F-1 signature) | parity |
| `hardcode-token-web` | token-guard | token-guard (web) |
| `hardcode-token-native` | token (native) | — (probe) |
| `unresolved-tbd` | readiness | readiness |
| `state-by-color-only` | slop | slop (advisory only) |

## Result

Baseline: **clean** — all 19 features GREEN on every gate.

```
total mutants: 251
killed (>=1 gate RED): 228
survived (all GREEN):  23
```

| Operator | mutants | killed | survived |
|---|---|---|---|
| drop-trait | 101 | 101 | 0 |
| remove-a11y | 36 | 36 | 0 |
| native-expr-leak | 38 | 38 | 0 |
| ref-as-literal | 15 | 15 | 0 |
| hardcode-token-web | 19 | 19 | 0 |
| hardcode-token-native | 19 | 0 | **19** |
| unresolved-tbd | 19 | 19 | 0 |
| state-by-color-only | 4 | 0 | **4** |

Sample killed mutant per operator (the injected defect → the gate that went RED):

- `drop-trait` — `alert:react:a11y.label` → **ledger**: `react: component "Alert" (action) drops trait a11y.label — neither expressed nor diverged`.
- `remove-a11y` — `alert:react:role=alert` → **a11y** (+ ledger): `react: IR declares role="alert" but the output has neither the platform trait nor a divergence warning`.
- `native-expr-leak` — `alert:swiftui` → **native-code**: `swiftui: emits the un-evaluated JS expression "deltaValue >= 0 ? 'positive' : 'negative'" verbatim in native syntax`.
- `ref-as-literal` — `alert:react:message` → **parity**: `react: ref prop "message" is emitted as the string literal "message"`.
- `hardcode-token-web` — `alert:react` → **token**: `react: raw hex color in output`.
- `unresolved-tbd` — `alert` → **readiness**: `/container[2]/action label: "TBD — unknown copy" — resolve before generating`.

The `drop-trait` result is the Layer-1 payoff in aggregate: **all 101 trait-drop
mutants** — across every adapter and every declared trait, including the ones no
per-class gate enumerates — are killed by the ledger.

## Surviving mutants (blind spots) — findings

Two defect classes survive every gate. Both are logged, **not fixed inline**
(per the Layer-3 brief: reveal first, triage together).

| ID | Defect class | Finding |
|---|---|---|
| **F-21** | Hardcoded token on a **native** adapter | **RESOLVED — see "F-21 — native token enforcement" below.** *(As found by Layer 3:)* `token-guard` inspected **web** adapters only (`react`/`vue`/`svelte`) for raw hex / raw px, so a raw `#ef4444` or `12px` emitted by SwiftUI / Compose / React Native passed **every** gate. 19/19 native-hardcode mutants survived; independently confirmed 0 RED gates. Now closed: token-guard's source scan covers the native adapters, and the 19 mutants are killed. |
| **F-22** | State conveyed by **color alone** | **RESOLVED — see "F-22 — state-by-color-only now blocking" below.** Was a `slop-guard` `status-color-only` advisory at `minor` (never RED; 4/4 mutants survived). Now a **blocking a11y-guard contract** keyed off a new `variant.intent` (`status` \| `emphasis`, default `status`): a `status` variant must distinguish every pair of states by a non-color cue, and an `emphasis` label on a status-vocabulary enum fails as a mislabel. The 4 survivors are killed; 0 survivors remain. |

Everything else — every a11y trait, every token on web, every ref binding, every
native expression, every TBD — is killed by at least one gate.

## Wiring — runs in ci.mjs on every run

The harness is **fast (~2.3 s)**, so it runs on **every CI run** as step 4 of
`ci.mjs`, and standalone via `npm run mutate:gates`. Its exit policy makes it a
useful guard rather than noise: it exits **0** when the baseline is clean and
every survivor is a **known** blind spot (F-21 / F-22), and **non-zero** on a
dirty baseline, a **new** survivor class (a fresh blind spot), or a
previously-killed mutant that now survives (a **gate regression**). So known
blind spots are tracked as findings without reddening CI, while a real
regression in any gate — or a brand-new blind spot — fails fast.

`P44` pins the invariant in the regression harness: baseline clean, each
known-defect operator kills all its mutants, the six killer operators are killed
by their expected gate, and only F-21 / F-22 survive.

## ci.mjs status under Layer 3

`rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**. 19 features PASS, 2
refused, `verify-patches` **44/44**, mutation testing **251 mutants / 228 killed
/ 23 survived** (all survivors are the two logged blind spots F-21 / F-22).

## Scope — logged, not built

Layer 3 is **only** the mutation-testing harness plus the two findings it
surfaced. It does **not**: build Layer 2 (a runtime platform-a11y oracle) or add
any native toolchain to CI; migrate the IR off ARIA; build the control-state
primitive or add new components; **fix** the discovered blind spots inline (F-21 /
F-22 are logged for triage); weaken or remove any gate; or touch agents / skills /
workflow / AI-router. F-17 / F-18 / F-19 remain deferred as before.

---

# F-21 — native token enforcement (resolved)

Layer 3 mutation testing surfaced **F-21**: `token-guard` scanned only the web
adapters, so a hardcoded color/size on a native adapter (SwiftUI / Compose /
React Native) passed every gate — the same web-covered / native-leaks class as
the a11y gap Layer 1 closed. Since the token contract is core and the upcoming
form-input work emits many native token references, the hole is closed before
building on top of it.

## The fix — native source-tier scan in token-guard

`token-guard` now scans the 3 native adapters too, with **platform-specific**
detectors (not a copy of the web hex/px scan — native literal shapes differ):

| Adapter | Color literal (serious) | Dimension literal (moderate) |
|---|---|---|
| **SwiftUI** | `Color(hex:…)`, `Color(red:…)`, `Color(.sRGB/.displayP3…)`, `UIColor(red:…)`, any `#rrggbb[aa]` | numeric `.padding(N)` / `.cornerRadius(N)` / `.frame(N)` / `.system(size: N)` |
| **Compose** | `Color(0xFF…)`, `Color(red = …)`, any `#rrggbb[aa]` | `N.dp` / `N.sp` numeric literal |
| **React Native** | `"#rrggbb[aa]"`, `"rgb(…)"`/`"rgba(…)"` string | bare number on a dimension style prop (`padding`, `margin`, `borderRadius`, `gap`, `width`, `height`, `fontSize`, `lineHeight`, insets, …) |

**Principle (same as web):** a value that has a token equivalent must reference
the token, never be inlined. Colors are `serious` (a color must always be a
token — mirrors web raw-hex); dimensions are `moderate`/advisory (mirrors web
raw-px). The detectors key on the **numeric/hex payload** (`hex:`, `red:`, `0x`,
`#…`, a bare number), which a token reference never carries — so
`Color(DesignTokens.X)`, `DesignTokens.SpaceInsetMd`, and `tokens.color.*` are
**not** flagged.

**Exception carried over (stated):** the web scan adds no numeric allowlist and
relies on pattern narrowness; the native dimension scan mirrors that and, in
addition, treats bare `0` and `1` as legitimate non-tokens (zero and the 1-unit
hairline — the `0`/`1` case the brief names). These have no token equivalent and
are universal native idioms (e.g. `borderWidth: 1`). Colors carry **no**
exception. The SwiftUI `VStack(spacing: 8)` layout constant is not a `.padding()`
-style token position, so it is not matched — it is not flagged.

**Web behavior unchanged:** the `WEB_ADAPTERS` branch is byte-for-byte the same
rules/severities (`hardcoded-color` serious, `hardcoded-dimension` moderate);
native coverage is purely additive (new rules `hardcoded-color-native`,
`hardcoded-dimension-native`).

## Proof — mutation harness before / after

`npm run mutate:gates`:

| | total | killed | survived |
|---|---|---|---|
| **before** (main, F-21 open) | 251 | 228 | 23 |
| **after** (this change) | 251 | **247** | **4** |

The 19 `hardcode-token-native` mutants flip from **survived → killed** (by
`token-guard`). The only remaining survivors are the 4 `state-by-color-only`
mutants (**F-22**, unchanged — an intentional advisory severity). No new
survivors, and no previously-killed mutant now survives (no gate regression) —
the harness exit policy enforces this and the run exits 0.

## Proof — manual fired-gate (before / after), per native adapter

```
[swiftui] BEFORE .foregroundColor(Color(hex: "#ef4444"))   -> RED  hardcoded-color-native: swiftui: hardcoded color literal `Color(hex: "#ef4444")`
[swiftui] AFTER  .foregroundColor(DesignTokens.ColorDangerFg) -> GREEN
[compose] BEFORE .background(Color(0xFFEF4444))            -> RED  hardcoded-color-native: compose: hardcoded color literal `Color(0xFFEF4444)`
[compose] AFTER  .background(DesignTokens.ColorDangerBg)     -> GREEN
[react-native] BEFORE backgroundColor: "#ef4444", padding: 16 -> RED color (serious) + dimension (moderate), naming the adapter
[react-native] AFTER  backgroundColor: tokens.color.danger.bg, padding: tokens.space.inset.md -> GREEN
```

## No over-flag

All 19 in-scope features stay **GREEN** under the stricter native scan — 0
native-token issues across every component's SwiftUI / Compose / RN output
(legitimate `DesignTokens.*` / `tokens.*` references, the `Color(DesignTokens.X)`
wrapper, `VStack(spacing: 8)`, and `borderWidth: 1` are all correctly not
flagged). No component's token status in the breadth matrix changes.

## Regression pin

`P45` — a hardcoded native color literal FAILs token-guard (serious) per adapter
(SwiftUI / Compose / RN), naming the adapter + value; a hardcoded native
dimension literal is flagged (moderate); a legitimate token reference and the
`0`/`1` hairline pass; and the web hex/px rules are unchanged. `P44` now asserts
the `hardcode-token-native` mutants are **killed** by `token-guard` and that only
**F-22** survives. `verify-patches` → **45/45**.

## Scope

Only native token coverage was added. F-22 is untouched (intentional advisory
severity). No Layer 2, no IR migration, no control-state primitive, no new
components; no gate weakened or removed; the web token scan is unchanged; no
agent / skill / workflow / AI-router changes.

---

# Control-state primitive (F-15 / F-16 resolved)

Batch ก (form inputs) revealed the missing root: Checkbox/Switch/Slider had
their a11y traits expressed (Layer 1) but **no real two-way state binding**. The
control-state primitive is a renderer-base-level capability (like the F-3
conditional): a spec declares a single-value, controlled, two-way binding on an
input, generated as each platform's native state-binding mechanism across all 6
adapters. **Primitive only this phase — no components** (proven with test specs,
exactly like F-3). Checkbox/Switch/Radio/Select/Slider components come next.

## IR design

An `input` node carries a `state` binding:

```yaml
input:
  valueProp: <ref>     # bound value — the caller's source of truth (controlled)
  changeProp: <ref>    # change handler — the caller updates state through it
  state:
    kind: boolean | selected-value | numeric-range
    min: <number | ref>   # numeric-range only (input constraint, NOT formatting)
    max: <number | ref>   # numeric-range only
    step: <number | ref>  # numeric-range only (optional)
```

The base normalizes it via `controlState(node)` → `{ kind, value, change, min,
max, step }`; each adapter's `renderControlState` emits the platform binding. The
base also adds a `state=<kind>` **declared trait**, so the ledger requires every
adapter to account for the binding (a dropped binding → `unaccounted` → FAIL).

## Per-adapter mapping (controlled-only)

| kind | React | Vue | Svelte | React Native | SwiftUI | Compose |
|---|---|---|---|---|---|---|
| boolean | `checked={v} onChange` | `:checked + @change` | `checked={v} on:change` | `<Switch value onValueChange>` | `Toggle(isOn: Binding(get/set))` | `Checkbox(checked, onCheckedChange)` |
| selected-value | `<select value onChange>` | `<select :value @change>` | `<select value on:change>` | `<Picker selectedValue onValueChange>` | `Picker(selection: Binding(get/set))` | hoisted `selectedValue` + `onSelectedChange` |
| numeric-range | `type="range" value onChange min/max/step` | `:value @input :min/:max/:step` | `value on:input min/max/step` | `<Slider value onValueChange minimumValue/maximumValue/step>` | `Slider(value: Binding, in: min...max, step:)` | `Slider(value, onValueChange, valueRange, steps)` |

**Controlled-only note.** Scope guard #2 forbids uncontrolled/internal state.
Pure `v-model="x"` / `bind:checked={x}` mutate a read-only prop / a local — that
is the *uncontrolled* idiom. The controlled equivalent binds the value **and**
routes change through the caller's handler, which is what `v-model` / `bind:`
desugar to; that is what every adapter emits, so the caller always holds the
source of truth. SwiftUI's `Binding(get:{v}, set:{onChange($0)})` is a `@Binding`
constructed from the caller's value + handler; Compose uses state hoisting
(value + onValueChange at the caller). Every adapter references **both** the
value and the handler prop, so parity holds.

## Proofs

- **boolean / selected-value / numeric-range** each render the native two-way
  binding on all 6 adapters — see `.claude/artifacts/{state-boolean,state-select,state-range}/`.
  Example (numeric-range): SwiftUI `Slider(value: Binding(get: { volume }, set: { onVolumeChange($0) }), in: 0...100, step: 5)`; Compose `Slider(value = volume, onValueChange = onVolumeChange, valueRange = 0f..100f, steps = 19)`.
- **Refusal** — an expression used as the bound value, change handler, or a
  numeric-range ref is **refused** (`expression-binding`) with the ref redirect,
  consistent with the F-9 variant / F-3 condition refusals; a plain ref (and a
  numeric literal, and a plain-identifier range ref) generates and passes.
- **Ledger** — `state=<kind>` is expressed on all 6 for every test spec
  (`6 expressed, 0 diverged, 0 unaccounted`).
- **native-code does NOT over-flag** the native binding constructs — SwiftUI
  `Binding(get:/set:)` and Compose hoisting are native code, not JS-expression
  leaks; `native-code` stays green.
- **Mutation harness** — corpus grew 19 → 22 (the 3 test specs). Before (main,
  post-F-21): `251 mutants / 247 killed / 4 survived`; after:
  **`284 mutants / 280 killed / 4 survived`**. The only survivors remain the 4
  `state-by-color-only` (F-22, unchanged). No new survivor, and every killer
  operator still kills all its mutants — including `drop-trait` on the new
  `state=<kind>` traits (all killed by the ledger). **No gate regression.**

## Scope guards honored

1. **Single-value only** — one value per control; no multi-value/object/
   whole-form/nested binding.
2. **Controlled-only** — the caller holds state on every platform; no
   uncontrolled/internal-state mode.
3. **numeric-range is a value constraint, not formatting** — `min`/`max`/`step`
   are input constraints; display formatting stays F-11/F-12 (P48 asserts no
   `toFixed`/`NumberFormat`/`NumberFormatter` appears).

No component shipped (primitive + 3 test specs only); no Layer 2, no IR/ARIA
migration; no gate or the ledger weakened; no agent / skill / workflow / AI-router
changes.

## Regression pins

`P46` (boolean binding across 6 + state trait accounted), `P47` (selected-value
across 6 + Picker import), `P48` (numeric-range value+min/max/step across 6, no
formatting), `P49` (expression-as-binding refused; plain refs pass; F-9 variant
refusal unchanged). `verify-patches` → **49/49**.

---

# Form-input batch — shipping components on the roots (the payoff test)

With the roots in place (conditional F-3, control-state primitive F-15/F-16, and
the full defense stack: ledger, native token enforcement, mutation harness), this
batch **ships** form components by **composing existing capabilities** — no new
renderer-base capability. It is the payoff test: the components that were
silent-drops in batch ก should now PASS across native.

Cell legend: `✓` correct · `⚠` documented divergence. "Gates 9/9" = readiness,
a11y, token, perf, slop, parity, native-code, declared-io, ledger.

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Composes |
|---|---|---|---|---|---|---|---|---|---|
| **Checkbox** (`checkbox-control`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 | **PASS** | control-state(boolean) + role=checkbox + tokens |
| **Switch** (`switch-control`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 | **PASS** | control-state(boolean) + role=switch + tokens |
| **Slider** (`slider-control`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 | **PASS** | control-state(numeric-range) + role=slider + tokens |
| **NumberInput** (`number-input`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 | **PASS** | control-state(numeric-range, inputType=number) + tokens |
| **Native Select** | — | — | — | — | — | — | n/a | **BLOCKED — capability F-23** | selected-value binding works, but option children do not render inside the bound control |
| **Radio + RadioGroup** | — | — | — | — | — | — | n/a | **BLOCKED — capability F-23 (+ per-item selection)** | needs option children + per-radio selection-from-value |
| **Custom-overlay Select** | | | | | | | n/a | **REFUSE-correct** | overlay boundary still refuses (`category: overlay` → refused) |

## The payoff — Checkbox / Switch / Slider now PASS (were silent-drops in ก)

All three now generate **real native controls with expressed roles and a working
two-way binding, 0 unaccounted in the ledger**:

- **Checkbox** — React `<input type="checkbox" checked={checked} onChange role="checkbox">`; RN `<Switch value onValueChange accessibilityRole="checkbox" accessibilityState={{checked}}>`; SwiftUI `Toggle(label, isOn: Binding(get:/set:))`; Compose `Checkbox(checked, onCheckedChange, Modifier.semantics { role = Role.Checkbox })`.
- **Switch** — same binding, `role=switch`: web `role="switch"`, RN `accessibilityRole="switch"`, Compose `Switch(... Role.Switch)`. **Distinct from Checkbox on native** — the exact thing that was a silent drop before.
- **Slider** — web `<input type="range" min/max/step role="slider">`; RN `<Slider accessibilityRole="adjustable" accessibilityValue minimumValue/maximumValue/step>`; SwiftUI `Slider(value: Binding, in: 0...100, step: 1)`; Compose `Slider(value, onValueChange, valueRange = 0f..100f, steps = 99)`.

Each: `ledger PASS (12 expressed, 0 diverged, 0 unaccounted)`; `native-code` green
(the `@Binding(get:/set:)` / Compose hoisting are recognized as native, not
JS-expression leaks); `token-guard` green (specs use tokens, native enforcement
does not fire).

## Composition wiring (adapter-level, not renderer-base)

To ship distinct components the native `renderControlState` was made
**role-aware** — it carries the node's `role` through the existing Layer-1 role
mechanisms (Checkbox vs Switch control choice + role trait; Slider vs numeric
text field by `inputType`; the visible `label` rendered natively). This is
composition glue reusing existing a11y/role handling; **no new IR kind, traversal
mode, or binding kind was added.**

## F-17 / F-18 / F-19 status

- **F-19 (numeric input)** — **numeric portion RESOLVED.** NumberInput ships with
  `min`/`max`/`step` constraints on all 6 (web `type="number"`, RN numeric
  `TextInput`, SwiftUI `Stepper(in:step:)`, Compose `OutlinedTextField` with
  `toString`/`toFloatOrNull`). **No formatting** — display formatting stays
  **F-11/F-12** (P48 asserts no `toFixed`/`NumberFormat`). `textarea` (multiline)
  remains residual under F-19.
- **F-17 (radio) / F-18 (native select)** — **RESIDUAL, blocked on a capability
  (F-23 below).** The selected-value *binding* is in place, but a bound control
  cannot render iterated option children, so Select renders an empty `<select>`
  and Radio cannot render per-option radios. Not resolved this batch; logged, not
  built (scope: don't add renderer-base capability inline).

## New findings

| ID | Status | Note |
|---|---|---|
| **F-23** | **Logged (new) — capability gap, report first** | A control-state–bound control cannot render **iterated option children**. Probe: an `el: input` (state=selected-value) with `each`-iterated option children emits an **empty** `<select></select>` — the options are silently dropped (`visitInput`/`renderControlState` is a leaf; it never renders children). Confirmed no gate catches the dropped children (parity passed because the `options` prop appears in the type signature; the children are neither a prop, icon, nor trait). **Needed by Native Select (F-18) and Radio/RadioGroup (F-17).** Radio additionally needs per-option "selected = (value === option)", which is a comparison expression (currently refused as F-9). This is a genuine new capability ("a bound control that renders bound option children") — deserves its own phase, like the control-state primitive did. Do not build inline. |
| **F-24** | **Logged (new) — small composition residual** | `renderControlState` (the control-state render path) accounts for `state`, `role`, and the visible `label`, but **not** `a11y.describedBy` / `a11y.invalid`. A control-state control with an inline error/description leaves those traits `unaccounted` → ledger FAIL. (The non-state `visitInput` path already handles them; the state path needs the same wiring.) Checkbox was scoped to omit describedBy this batch to stay clean; the wiring is a small follow-up. |
| **F-22** | Unchanged | `slop` `status-color-only` remains advisory (intentional). |

## Mutation harness (payoff: defense holds as breadth grows)

Corpus grew 22 → **26** (the 4 new components). Before: `284 / 280 / 4`; after:
**`350 mutants / 346 killed / 4 survived`**. The only survivors remain the 4
`state-by-color-only` (F-22). No new survivor, no previously-killed mutant now
surviving — **no gate regression** as the component surface grew. In particular
`drop-trait` on the new `state=<kind>` and `role=` traits of the 4 components is
killed by the ledger.

## ci.mjs status

`rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**. 26 features PASS, 2
refused (data-grid, modal), `verify-patches` **49/49**, mutation testing
`350 / 346 / 4`.

## Scope

No renderer-base capability added (composition glue only); no number formatting
(NumberInput is plain numeric + constraints); custom-overlay select still refused;
no gate or the ledger weakened; no agent / skill / workflow / AI-router changes.
F-23 / F-24 logged for triage, not built.

---

# F-23 — option-children capability (Radio + Select now ship)

The form-input batch left Radio + Select BLOCKED: a control-state–bound control
was a leaf (`renderControlState` rendered no children), so a Select emitted an
empty `<select></select>`. F-23 adds **option-children**: a selected-value control
renders an iterated option list, so **native Select (F-18)** and **Radio +
RadioGroup (F-17)** ship.

## Design — spec authors no selection expression

The spec supplies the **single bound value** (existing control-state
selected-value binding) + an **option list** (`state.options` = a plain prop ref
to an array of `{ value, label }`). The presentation is chosen by role:
`role=radiogroup` → radio group, else → native single-select. **No per-option
comparison or JS expression is authored in the spec** — the option ref and bound
value are plain refs (an expression there is refused as `expression-binding`,
F-9-consistent). Each adapter emits its platform's native selection construct and
owns the matching:

| | Select (role: listbox/none) | RadioGroup (role=radiogroup) |
|---|---|---|
| React | `<select value>` + `<option>` map | name-grouped `<input type="radio" checked={value===opt.value}>` |
| Vue | `<select :value>` + `<option v-for>` | radios `:checked="value===opt.value"` |
| Svelte | `<select value>` + `{#each}` `<option>` | radios `checked={value===opt.value}` |
| React Native | `<Picker selectedValue>` + `<Picker.Item>` | `<View role=radiogroup>` + `<Pressable role=radio accessibilityState={{selected}}>` |
| SwiftUI | `Picker(selection:)` + `ForEach { Text.tag(value) }` | same `Picker` (single-select group) |
| Compose | `Column(selectableGroup)` + `RadioButton(selected = value == opt.value)` | same RadioButton group |

## Selection-match audit (no spec expression; native idiom only)

The **spec** contains zero selection expressions (proven — options carry only
`value`/`label`; refusal blocks an expression options-ref or bound value). In
**generated** code, the value-matched controls are comparison-free
(`<select value>`, `Picker(selection:)`, RN `Picker`); the platforms whose radio
primitive takes a per-option boolean emit the **native value-match** the task's
own examples specify (web radio `checked`, RN `accessibilityState.selected`,
Compose `RadioButton(selected = …)`):

| adapter | Select | RadioGroup |
|---|---|---|
| React / Vue / Svelte | comparison-free (`<select value>`) | native `checked={value===opt.value}` |
| React Native | comparison-free (`<Picker>`) | native `accessibilityState.selected` |
| SwiftUI | comparison-free (`Picker`+`.tag`) | comparison-free (`Picker`) |
| Compose | `RadioButton(selected==)`¹ | `RadioButton(selected==)` |

¹ Compose has no simple dropdown primitive, so Select also renders a
`RadioButton` group. None of these are F-9 spec expressions or un-evaluatable JS
leaks — `native-code` stays green on all output.

## Matrix — the two blocked components now PASS

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome |
|---|---|---|---|---|---|---|---|---|
| **Native Select** (`native-select`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 | **PASS** (was BLOCKED) |
| **Radio + RadioGroup** (`radio-group`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 | **PASS** (was BLOCKED) |
| Custom-overlay Select | | | | | | | n/a | **REFUSE-correct** (overlay boundary holds) |

Both: `ledger 0-unaccounted` (Select `6 expressed`, RadioGroup `12 expressed`
incl. `role=radiogroup`); `native-code` green; `token-guard` green.

## Findings

- **F-17 (radio) — RESOLVED.** RadioGroup ships with radiogroup/radio roles +
  option children + single-select via native binding on all 6.
- **F-18 (native select) — RESOLVED.** Native Select ships with option children
  rendered inside the bound control on all 6.
- **F-23 — RESOLVED.** Option-children capability added under control-state
  (Select + RadioGroup only; not generalized to arbitrary iterated children).
- **New residual — F-25:** rich/nested option children (icon+text, per-option
  `disabled`) are **not** supported — options are `{value,label}` only. Logged,
  not built (per scope).

## Mutation harness

Corpus 26 → **28** (native-select, radio-group). `350/346/4 → **380 / 376 / 4**`.
Only survivors remain the 4 `state-by-color-only` (F-22). No new survivor, no
regression.

## Regression pins

`P50` (Select renders option children in the value-matched control on all 6),
`P51` (RadioGroup renders role=radiogroup + per-option selection on all 6, role +
state accounted), `P52` (expression-as-options / bound value refused; overlay
select refused). `verify-patches` → **52/52**.

---

# F-24 — describedBy / invalid in control-state

The control-state render path (`renderControlState`) accounted for `state`,
`role`, and `label`, but **not** `a11y.describedBy` / `a11y.invalid` — a
control-state control with an inline error/description left those traits
`unaccounted` → ledger FAIL. F-24 wires both into all 6 adapters, using each
platform's real mechanism, mirroring the non-state `visitInput` path.

## Wiring per adapter

| trait | React / Vue / Svelte | React Native | SwiftUI | Compose |
|---|---|---|---|---|
| `a11y.invalid` | `aria-invalid` (express) | `aria-invalid` (express) | diverge `a11y-invalid-swiftui` | diverge `a11y-invalid-compose` |
| `a11y.describedBy` | `aria-describedby` (express) | diverge `a11y-describedby-native` | diverge `a11y-describedby-native` | diverge `a11y-describedby-native` |

A platform that genuinely cannot express a trait **diverges** (waiver-backed),
never silently drops it. Added `a11y-invalid-compose` to the waiver registry (a
Compose Checkbox/Switch/Slider/RadioButton has no `isError`, unlike a text
field). All waivers carry an approver + expiry.

## Proof — inline-error control accounted on all 6, revert → FAIL → restore

Test spec `checkbox-error` (controlled checkbox + `a11y.invalid` + `a11y.describedBy`
+ a conditional F-3 error text):

```
describedBy + invalid accounting per adapter:
  react/vue/svelte  describedBy=expressed(aria-describedby)  invalid=expressed(aria-invalid)
  react-native      describedBy=diverged(a11y-describedby-native)  invalid=expressed(aria-invalid)
  swiftui           describedBy=diverged(a11y-describedby-native)  invalid=diverged(a11y-invalid-swiftui)
  compose           describedBy=diverged(a11y-describedby-native)  invalid=diverged(a11y-invalid-compose)

ledger PASS (29 expressed, 7 diverged, 0 unaccounted)   gates: PASS
```

Revert proof (drop the F-24 wiring from React):
```
BEFORE  ledger PASS (0 unaccounted)   gates: PASS
AFTER   ledger FAIL — react drops `a11y.invalid` + `a11y.describedBy` (unaccounted)
RESTORE ledger PASS (0 unaccounted)   gates: PASS
```

## Findings

- **F-24 — RESOLVED.** `renderControlState` now accounts for describedBy +
  invalid on all 6 (express or waiver-backed diverge); a control with an inline
  error is fully accounted, 0 unaccounted.

## Mutation harness

Corpus 28 → **29** (checkbox-error). `380/376/4 → **417 / 413 / 4**` — only F-22
survives; no new survivor, no regression.

## Regression pin

`P53` (a control with an inline error accounts describedBy + invalid on all 6,
0 unaccounted; web emits real ARIA attrs; ledger gate passes). `verify-patches`
→ **53/53**.

---

# Phase H — Schema-expressiveness long-tail (F-4 / F-5 / F-7 / F-19 / F-25)

With the control-state primitive and form inputs complete, this phase closes the
remaining schema-expressiveness gaps so the ledger stays clean. Each item is a
**leaf prop/slot addition** (schema + `declaredTraits` + per-adapter express),
not a new renderer-base capability. Every addition is ledger-accounted (0
unaccounted) and proven on all 6 adapters via the full hardened stack.

## What shipped

| Finding | Slot | Web | React Native | SwiftUI | Compose |
|---|---|---|---|---|---|
| **F-4** orientation | `orientation: horizontal\|vertical` | `aria-orientation` (semantic) | `flexDirection` axis | `HStack`/`VStack` axis | `Row`/`Column` axis |
| **F-5** disabled | `disabled: <flag ref>` | `disabled` / `:disabled` | `disabled` + `accessibilityState` | `.disabled(flag)` | `enabled = !flag` |
| **F-7** size | `size: <dimension token>` | `width`/`height` (var) | `width`/`height` (`tokens.*`) | `.frame(width:height:)` | `.size(DesignTokens.*)` |
| **F-19** textarea | `input.multiline: true` | `<textarea>` | `<TextInput multiline>` | `TextField(axis: .vertical)` | `TextField(singleLine = false)` |

Design principle held throughout: **no expressions** (F-9-consistent). `disabled`
is a plain boolean flag ref — an expression as `disabled` is refused
(`expression-boolean-attr`), exactly like the variant discriminant, the `when`
condition, and the control-state bindings. `size` must be a **token** — a
hardcoded native dimension FAILs token-guard (the F-21 enforcement).

## Breadth matrix — Phase H proofs

Cell legend as above (`✓` correct · `⚠` documented divergence).

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Divider** (F-4) | ✓ | ✓ | ✓ | ✓ | ⚠ | ⚠ | 9/9 pass | **PASS** | `orientation: vertical` → web `role="separator" aria-orientation="vertical"`; RN `flexDirection: "column"`; SwiftUI `VStack` / Compose `Column` layout axis. `role=separator` remains a documented native divergence (unchanged). `orientation=vertical` expressed on all 6. |
| **Button** (F-5) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `disabled: disabled` (flag ref) → `disabled={disabled}` / `:disabled` / RN `disabled + accessibilityState` / SwiftUI `.disabled(disabled)` / Compose `enabled = !disabled`. `disabled` trait expressed on all 6; an expression as `disabled` is refused. |
| **Spinner** (F-7) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `size: space.6` → token-referenced width/height on all 6 (`.frame(width: DesignTokens.Space6…)`, `.size(DesignTokens.Space6)`, `tokens.space.6`). token-guard green (a hardcoded native size would FAIL). `size` expressed on all 6. |
| **Textarea** (F-19) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `input.multiline: true` → web `<textarea>`, RN `<TextInput multiline>`, SwiftUI `TextField(axis: .vertical)`, Compose `TextField(singleLine = false)`. `input.multiline` expressed on all 6. Closes the F-19 textarea residual. |

("Gates 9/9" = the seven prior gates + native-code + the ledger.)

## Fired-gate proofs

Orientation / disabled / size / multiline are all declared traits, so dropping
any adapter's expression turns the ledger RED (unaccounted) — verified via the
mutation harness (the trait-drop operator kills them). Additional targeted
proofs:

```
# F-5 — an expression as `disabled` is REFUSED (F-9-consistent)
disabled: "isBusy || n > 3"   → REFUSED  category=expression-boolean-attr
disabled: "shouldDisable()"   → REFUSED  category=expression-boolean-attr
disabled: "disabled"          → PASS     (plain flag ref)

# F-7 — a hardcoded native size FAILs token-guard; a token reference passes
size: space.6 (token)         → token-guard PASS  (.frame(width: DesignTokens.Space6…))
(hardcoded .frame(width: 24)  → token-guard FAIL  hardcoded-dimension-native)
```

## Findings ledger — update

| ID | Status | Note |
|---|---|---|
| **F-4** | **RESOLVED** | Orientation slot shipped (semantic `aria-orientation` on web + native layout axis). Divider vertical on all 6, ledger-accounted. |
| **F-5** | **RESOLVED** | Boolean-attribute binding (`disabled`) shipped as a plain flag ref; expression-as-disabled refused. Button disabled on all 6, ledger-accounted. |
| **F-7** | **RESOLVED (with residual)** | Size slot shipped as a **token-referenced** dimension. **Residual:** there is no dedicated `size.*` token scale yet, so existing `font.size.*` / `space.*` tokens are reused; a runtime size *scale* (enum→token map) is a natural extension but out of scope (the existing `variant` mechanism already covers per-value style tables). |
| **F-19** | **RESOLVED (fully)** | `textarea` (multiline) shipped on all 6. The F-19 numeric-constraint portion was already resolved by the control-state primitive (F-16); this closes the textarea residual, so F-19 is now fully resolved. |
| **F-25** | **Logged — not built (scope-locked outcome)** | Rich option children (icon / per-option `disabled`). Building it exceeds *leaf enrichment*: (1) a per-option **icon** is a **runtime** value (`opt.icon`), but the engine's icon idiom resolves icon tokens at **compile time** (the `usedIcons` import set) — a runtime icon breaks that idiom and needs a new capability; (2) HTML `<option>` and RN `Picker.Item` are **text-only** and cannot host an icon at all, so the Select presentation could never show it — only the radio presentation could, giving a non-uniform half-feature; (3) it forces changes to the F-23 option-children iteration. Per the phase's explicit scope-lock ("if it needs more than leaf enrichment … STOP and LOG — 'log it' is an acceptable outcome"), it is logged, not built. **Per-option `disabled`** is likewise logged: trivial and uniform for the radio presentation, but not expressible on RN `Picker.Item` (no per-item disabled) and unreliable on SwiftUI `Picker` tags — the same non-uniform-across-Select problem — so shipping it would be an inconsistent half-feature. Both are clean future design passes, not leaf additions. |

## Regression pins

- **P54** — orientation (F-4): Divider vertical renders `aria-orientation` on web
  + layout axis on native across all 6; `orientation=vertical` expressed, 0
  unaccounted.
- **P55** — boolean-attr (F-5): Button `disabled` flag-ref renders the platform
  disabled mechanism on all 6; an expression-as-disabled is refused, a plain flag
  passes; `disabled` expressed.
- **P56** — size (F-7): Spinner `size` renders as a token-referenced width/height
  on all 6; token-guard stays green (a hardcoded native size would FAIL); `size`
  expressed.
- **P57** — textarea (F-19): a multiline text input renders the textarea variant
  on all 6; `input.multiline` expressed, 0 unaccounted.

`verify-patches` → **57/57** (was 53/53).

## Mutation harness

Corpus auto-discovers the new specs (divider / spinner / button / textarea).
Baseline clean, **no new survivor, no regression** — only the known
`state-by-color-only` (F-22) blind spot survives, exactly as before.

## ci.mjs status under Phase H

`rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**. All in-scope features
PASS, refused categories still refuse, `verify-patches` **57/57**, mutation
testing green (only F-22 survives), `0` unaccounted across the ledger.

## Scope — logged, not built

Per the Phase-H scope lock, this change is **only** the four leaf slots (F-4 /
F-5 / F-7 / F-19) plus the F-25 finding. It does **not**: accept expressions for
the boolean-attribute or the selection idiom (flag/value refs only); allow
arbitrary nested components in options or change the F-23 selection idiom;
hardcode native sizes; build Layer 2 / the IR-ARIA migration / number formatting
(F-12) / nested conditionals (F-13); weaken or remove any gate or the ledger; or
touch agents / skills / workflow / AI-router. F-25 is logged for a future design
pass.

---

# F-13 — Nested / else-if / per-item conditionals (depth-capped)

F-3 shipped the three base conditional shapes (one-way `if`, `if/else`, and a
conditional wrapping one-level iteration) and deferred three compositions to
**F-13**. This phase builds all three by **extending the existing conditional
node** — no new IR kind, no new renderer-base capability beyond the conditional
lowering it already had.

## Extended IR lowering

A conditional's `then`/`else` branches are already ordinary nodes, so the three
shapes fall out of two facts:

1. **A branch that is itself a conditional recurses.** `branchBody(node)` renders
   a non-conditional branch normally but renders a conditional branch *bare*
   (via `renderCond`, without the JSX `{…}` wrapper). This is **nested
   conditional** (`if A → (if B → X else Y) else Z`) — the then/else branch is a
   conditional.
2. **An `else` that is a conditional flattens into a chain.** `renderCond` walks
   the else-chain into successive `{when, body}` clauses and hands them to the
   adapter's `condChainRender`, which emits the platform's **native else-if**
   (`v-else-if` / `{:else if}` / `else if`) rather than deep nesting. This is the
   **else-if chain** (`if A → X, else if B → Y, else Z`).
3. **Per-item conditional** is a conditional inside an iterated container whose
   condition is a boolean **field-access on the loop item** (`item.active`). It
   renders as a conditional inside the iteration body per platform.

Only the **outermost** conditional gets the single JSX expression container
(`wrapTopConditional`), so a JSX adapter never emits `{…}` inside `{…}`.

### Per-adapter mapping

| Shape | React / RN | Vue | Svelte | SwiftUI | Compose |
|---|---|---|---|---|---|
| nested | nested ternary `A ? (B ? X : Y) : Z` (one `{}`) | nested `<template v-if>` | nested `{#if}` | nested `if/else` | nested `if/else` |
| else-if | ternary chain `A ? X : B ? Y : Z` | `v-else-if` | `{:else if}` | `else if` | `else if` |
| per-item | `.map(item => item.active && …)` | `v-for` + `v-if="item.active"` | `{#each}` + `{#if item.active}` | `ForEach { item in if item.active { … } }` | `items.forEach { item -> if (item.active) { … } }` |

Per-item item fields are typed natively (`let active: Bool` / `val active:
Boolean`), so `if item.active` is a real Bool read, not a stringly-typed hack.

## Depth cap — how depth is counted

**Depth = the maximum number of `el: conditional` nodes on any single
root-to-leaf path.** A conditional adds 1 to the running count for its entire
subtree; containers and iteration pass the count through unchanged. Therefore:

- a nested-in-then conditional is one level deeper than its parent;
- **each else-if clause counts** as a level (an else-if is a nested conditional);
- **a per-item conditional counts**, and does so *on top of* any outer
  conditionals it sits under — crossing an iteration does **not** reset the
  budget (e.g. `if loading → spinner, else list(each item → if active → …)` is
  depth 2).

The cap is **3**. A spec whose max conditional depth exceeds 3 is **refused**
(category `conditional-depth`) with a redirect to extract the innermost branch
into its own sub-component (a component boundary resets the budget). This bound
is what keeps the per-item × nested combination finite and testable.

## Condition source (F-9 boundary)

| Condition site | Allowed | Refused |
|---|---|---|
| top-level / nested / else-if | a plain boolean flag prop (`isPrimary`) | any expression (`items.length > 0`) |
| per-item | a boolean field-access on the loop item (`item.active`) | a comparison / logic / call (`item.count > 5`, `item.a && item.b`, `item.f()`), or a field-access whose base is not an in-scope loop variable |

An expression as any condition is refused (`expression-condition`) with the
flag/field redirect — the same F-9 boundary as the variant discriminant and the
control-state bindings. Field-access is native on every platform; a comparison
is not, so it stays refused.

## Breadth matrix — F-13 proofs

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **CondNested** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | `if outer → (if inner → a else b) else c` as native nested if/else; JSX wraps once (`{outer ? (inner ? … : …) : …}`), 0 unaccounted. |
| **CondElseIf** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | 3-way `if / else if / else` as the native else-if idiom on all 6 (`v-else-if`, `{:else if}`, `else if`, chained ternary). |
| **CondPerItem** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | each row shows a badge when `item.active` — field-access inside `.map`/`v-for`/`{#each}`/`ForEach`/`forEach`; item field typed Bool/Boolean; **no comparison/ternary in native output**. |

("Gates 9/9" = the seven prior gates + native-code + the ledger.)

## Gate / defense interaction

- **Ledger 0-unaccounted** for all three structures — the conditional node itself
  carries no traits; its branch elements are rendered through the normal visitor
  path, so every declared trait is still accounted.
- **native-code does NOT over-flag** native nested/else-if or per-item
  field-access. The gate targets a non-plain `variant.prop` leaked verbatim; a
  `when` field-access is a plain dotted path and never a variant discriminant, and
  the native output emits `if item.active` / `if (item.active)` — no `?:` ternary,
  no comparison. Verified by P60.
- **Mutation harness** corpus grew (three new specs); baseline clean, **no new
  survivor and no previously-killed mutant now surviving** — only the known
  `state-by-color-only` (F-22) advisory blind spot survives.

## Proofs (fired)

```
# nested (React) — one {} wrapper, bare inner ternary
{outer ? ( inner ? (<span>{a}</span>) : (<span>{b}</span>) ) : (<span>{c}</span>)}
# nested (SwiftUI)          if outer { if inner { … } else { … } } else { … }
# else-if (Svelte)         {#if isPrimary} … {:else if isSecondary} … {:else} … {/if}
# else-if (Compose)        if (isPrimary) { … } else if (isSecondary) { … } else { … }
# per-item (SwiftUI)       ForEach(items…) { item in if item.active { … } }   // let active: Bool
# per-item (Compose)       items.forEach { item -> if (item.active) { … } }   // val active: Boolean

# refusals
depth 3 (at cap)      → generates
depth 4 (over cap)    → REFUSED  conditional-depth  (extract a sub-component)
combined depth 4      → REFUSED  conditional-depth  (per-item counts toward the budget)
per-item field-access → generates            (when: item.active)
per-item comparison   → REFUSED  expression-condition  (when: item.count > 5)
field outside a loop  → REFUSED  expression-condition  (only loop-var fields allowed)
plain flag            → generates            (when: isEmpty)
```

## Findings

- **F-13 — RESOLVED.** Nested, else-if, and per-item conditionals ship on all 6,
  ledger-accounted, native-code clean.
- **Residual (by design, not a gap):** conditional nesting beyond depth 3 is
  **refused**, not generated — the depth cap is a deliberate readability/testability
  bound with an extract-subcomponent redirect, not a missing capability. Long
  else-if chains count toward the same budget (a 4-clause chain is depth 3, at the
  cap; a 5-clause chain is refused) — extract or flatten in the data layer.

## Regression pins

- **P58** — nested conditional lowers to native nested if/else on all 6; JSX wraps
  once (no `{}` inside `{}`); 0 unaccounted.
- **P59** — 3-way else-if chain lowers to the native else-if idiom on all 6.
- **P60** — per-item conditional reads a boolean item field inside the iteration on
  all 6; field-access only, no comparison/ternary leaks into native.
- **P61** — depth cap: >3 nesting refused (extract-subcomponent), depth 3 passes, a
  per-item conditional counts toward the budget.
- **P62** — per-item field-access passes; per-item comparison/logic refused;
  field-access outside a loop refused; a plain flag still passes.

`verify-patches` → **62/62** (was 57/57).

## ci.mjs status under F-13

`rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**. All in-scope features
PASS (including the three new conditional specs), refused categories still refuse,
`verify-patches` 62/62, mutation testing green (only F-22 survives), 0 unaccounted.

## Scope — what this did not touch

Per the F-13 scope lock: no expressions accepted as conditions anywhere (flags +
per-item boolean field-access only; comparisons/logic refused); no nesting beyond
the depth cap (refused); the three F-3 base shapes are unchanged (P36–P39 still
pass); no Layer 2, IR/ARIA migration, number formatting (F-12), or rich options
(F-25); no gate or the ledger weakened or removed; no changes to agents / skills /
workflow / AI-router.

---

# F-12 — Number formatting: locale / currency / grouping / rounding

F-11 shipped precision-only formatting (`X.toFixed(Y)` → a native decimal formatter)
and deferred the rest to **F-12**. This phase completes number formatting by
**extending that precision path** — not rewriting it — into a first-class
`kind: format` value that composes precision plus the four remaining dimensions
into **one native formatter call per adapter**.

## Authoring — `kind: format`

```yaml
text:
  kind: format
  value: amount              # number source: a numeric literal or a plain prop ref
  format:
    style: currency          # currency | decimal (static enum)
    currency: THB            # literal, OR { kind: ref, value: currencyProp }
    locale: th-TH            # literal, OR { kind: ref, value: userLocale }
    grouping: true           # boolean literal, OR a plain ref
    rounding: round          # round | floor | ceil literal, OR a plain ref
    precision: 2             # integer literal (min=max fraction digits), OR a plain ref
```

**Static vs prop-ref.** Every option is a **static literal** (`currency: THB`) or a
**plain prop ref** (`locale: { kind: ref, value: userLocale }`) for runtime
switching. An **expression** as any option — or as the number source — is
**refused** (`expression-number-format`, F-9-consistent), redirecting to a literal
or a plain ref computed in the data layer. F-11's `.toFixed(precision)` expr path
is untouched (a precision-only shortcut); `kind: format` is the full descriptor.

## Native mapping — one formatter call per adapter

| Dimension | Web + RN (`Intl.NumberFormat`) | SwiftUI (`NumberFormatter`) | Compose (`java.text.NumberFormat`) |
|---|---|---|---|
| style | `style: 'currency'\|'decimal'` | `numberStyle = .currency/.decimal` | `getCurrencyInstance()` / `getNumberInstance()` |
| currency | `currency: 'THB'` | `currencyCode = "THB"` | `currency = Currency.getInstance("THB")` |
| locale | 1st arg `'th-TH'` / `undefined` | `locale = Locale(identifier: "th-TH")` | `forLanguageTag("th-TH")` |
| grouping | `useGrouping: true/false` | `usesGroupingSeparator` | `isGroupingUsed` |
| rounding | `roundingMode: 'halfExpand'/'floor'/'ceil'` | `roundingMode = .halfUp/.floor/.ceiling` | `RoundingMode.HALF_UP/FLOOR/CEILING` |
| precision (F-11) | `min/maxFractionDigits` | `min/maxFractionDigits` | `min/maxFractionDigits` |

A rounding **prop-ref** carries the neutral `round`/`floor`/`ceil` token and each
adapter maps it inline (web object-index, Swift ternary, Compose `when`), so
rounding stays cross-platform without leaking a platform-specific mode string.

### Sample output (PriceThb — THB, th-TH, grouping on, round, 2 digits)

```
web/RN   new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", useGrouping: true,
                                          roundingMode: "halfExpand", minimumFractionDigits: 2,
                                          maximumFractionDigits: 2 }).format(amount)
SwiftUI  { let f = NumberFormatter(); f.numberStyle = .currency; f.locale = Locale(identifier: "th-TH");
           f.currencyCode = "THB"; f.usesGroupingSeparator = true; f.roundingMode = .halfUp;
           f.minimumFractionDigits = 2; f.maximumFractionDigits = 2;
           return f.string(from: NSNumber(value: amount)) ?? String(amount) }()
Compose  java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag("th-TH"))
           .apply { currency = java.util.Currency.getInstance("THB"); isGroupingUsed = true;
                    roundingMode = java.math.RoundingMode.HALF_UP;
                    minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(amount)
```

## Breadth matrix — F-12 proofs

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **PriceThb** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | currency (THB) + locale (th-TH) + grouping + round + 2-digit precision compose into one native formatter on all 6; `number-format` expressed, 0 unaccounted. |
| **PriceLocale** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | currency (USD) with a **runtime locale prop-ref** — the `userLocale` prop drives the formatter locale on all 6 (bound, not stringified). |
| **DecimalFloor** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | decimal style, **grouping OFF**, **floor** rounding, 0 fraction digits, de-DE locale — every dimension applied natively on all 6. |

("Gates 9/9" = the seven prior gates + native-code + the ledger.)

## Divergence

**None.** Locale, currency, grouping, and all three rounding modes
(round/floor/ceil) are expressible by every platform's native formatter, so every
option is `express`ed on all 6 — no `diverge`, no waiver required.

## Gate / defense interaction

- **Ledger 0-unaccounted** — `number-format` is a declared trait (a `kind: format`
  value on a text/label node); each adapter `express`es it via its native
  formatter, so a silent drop is structurally impossible.
- **native-code does NOT over-flag** — `NumberFormatter` / `java.text.NumberFormat`
  are native constructs, not un-evaluated JS; the gate targets a non-plain
  `variant.prop`, which a formatter never is. Verified: native output carries **no
  `Intl`**, web output carries **no native formatter** (P63).
- **token-guard does NOT misfire** — currency codes (`"THB"`) and locale tags
  (`"th-TH"`) are formatter config, not design tokens; fraction-digit counts sit on
  `minimumFractionDigits`, not a dimension style prop. token-guard stays green (P63).
- **Mutation harness** corpus grew (three specs); baseline clean, **no new
  survivor, no regression** — only the known `state-by-color-only` (F-22) advisory
  blind spot survives.

## Proofs (fired)

```
currency + precision + grouping + round  → composed on all 6 (PriceThb)
locale swap (static th-TH vs de-DE)      → drives separators via the formatter locale
locale as prop-ref (userLocale)          → binds the prop on all 6 (PriceLocale)
grouping OFF + floor + decimal           → applied natively on all 6 (DecimalFloor)
expression as locale (nav.language)      → REFUSED  expression-number-format
non-plain ref currency (code.toUpper())  → REFUSED  expression-number-format
expression number source (a + b)         → REFUSED  expression-number-format
static currency THB / plain-ref locale   → generate
F-11 .toFixed(precision)                 → still native formatters (unchanged)
```

## Findings

- **F-12 — RESOLVED.** Locale, currency, grouping, and rounding ship on all 6 via
  each platform's native formatter, composed with F-11 precision into one call;
  ledger-accounted, native-code / token-guard clean, no divergence.
- **F-26 — Logged (new, out of scope): date/time formatting.** This phase is
  number-only. Date/time (calendars, relative time, skeletons) is a separate native
  API surface (`Intl.DateTimeFormat` / `DateFormatter` / `SimpleDateFormat`) and a
  distinct future pass.
- **Residual (by design, not a gap):** custom format **pattern strings**
  (`#,##0.00`) are out of scope — native formatter *options* only, per the scope
  lock.

## Regression pins

- **P63** — currency composes style+currency+locale+grouping+rounding+precision into
  one native formatter on all 6; ledger accounted; no cross-platform leak;
  native-code + token-guard do not misfire.
- **P64** — a static locale and a caller-supplied prop-ref locale both drive the
  formatter locale on all 6 (bound, not stringified).
- **P65** — grouping OFF + floor rounding + decimal style apply natively on all 6.
- **P66** — an expression as locale / currency / number-source is refused
  (`expression-number-format`); static literal + plain prop-ref pass; the F-11
  `.toFixed` precision path is unchanged.

`verify-patches` → **66/66** (was 62/62).

## ci.mjs status under F-12

`rm -rf out/ && node _shared/scripts/ci.mjs` → **exit 0**. All in-scope features
PASS (including the three number-format specs), refused categories still refuse,
`verify-patches` 66/66, mutation testing green (only F-22 survives), 0 unaccounted.

## Scope — what this did not touch

Per the F-12 scope lock: no custom format pattern strings (native options only); no
date/time formatting (logged as F-26); no expressions as locale/currency/grouping/
rounding (literal or plain ref only, F-9); the F-11 precision path was extended, not
rewritten; no Layer 2 / IR-ARIA migration / F-25; no gate or the ledger weakened;
no changes to agents / skills / workflow / AI-router.

---

# F-25 — Rich options: icon in RadioGroup (Select refused)

Phase H logged F-25 (rich option children) as "not built" because a per-option
icon is runtime data and HTML `<option>` / RN `Picker.Item` are text-only. This
phase **builds it under decision option C**: RadioGroup carries icon options on
all 6; a native Select with an icon option is **refused**.

## Why it is now buildable (what changed)

The blocker was "a runtime `opt.icon` can't go through the compile-time icon
idiom." The icon-token set is **small and fixed** (9 tokens), so each adapter
emits a **runtime registry** over the known tokens and looks `opt.icon` up at
render time — real, uniform, and still inside the existing icon system (same
tokens, same per-platform symbols). No arbitrary images, no nested components.

## RadioGroup icon mapping (per adapter)

| Adapter | Registry | Per-option render (decorative) |
|---|---|---|
| React / RN | `const OPTION_ICONS = { 'icon.check': Check, … }` + `<OptionIcon>` helper | `<OptionIcon token={opt.icon} />` (`aria-hidden` / `accessibilityElementsHidden`) |
| Vue | `const OPTION_ICONS = { … }` | `<component v-if=… :is="OPTION_ICONS[opt.icon]" aria-hidden="true" />` |
| Svelte | `const OPTION_ICONS = { … }` | `<svelte:component this={OPTION_ICONS[opt.icon]} aria-hidden="true" />` |
| SwiftUI | `static let optionIconSymbols: [String:String]` (token → SF Symbol) | `Label(opt.label, systemImage: Self.optionIconSymbols[opt.icon] ?? "").tag(opt.value)` |
| Compose | `val OPTION_ICONS = mapOf("icon.check" to Icons.Default.Check, …)` | `OPTION_ICONS[opt.icon]?.let { Icon(it, contentDescription = null) }` |

The icon is **decorative** on every platform (the visible label is the accessible
text), honoring the existing icon-a11y rule. `option-icon` is a declared ledger
trait expressed on all 6 → a silent drop is impossible.

## Native Select — refused (option C)

A `selected-value` input WITHOUT `role=radiogroup` whose options itemShape carries
`icon` is refused (`rich-option-select`): *"native select options are text-only;
for icons use RadioGroup (few options) or a custom-overlay picker (Radix / native
picker) for a dropdown."* This mirrors the Modal→Radix / custom-overlay-select
boundary — icon-bearing dropdowns are overlay territory. No silent drop, no
half-feature.

## Breadth matrix — F-25 proofs

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **RadioGroupIcons** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | decorative per-option icon + label via runtime registry; `option-icon` expressed, 0 unaccounted; no per-option expression (F-23 idiom intact). |

## Proofs (fired)

```
RadioGroup icon options    → icon + label on all 6 (decorative), option-icon expressed
native Select + icon       → REFUSED  rich-option-select  (→ RadioGroup / overlay picker)
native Select text-only    → generates (unchanged, P50)
custom-overlay Select      → REFUSED  overlay  (unchanged)
native rich output         → 0 per-option ternary/expression (F-23 idiom intact)
```

## Findings

- **F-25 — RESOLVED (icon in RadioGroup; Select refused).** Supersedes the Phase-H
  "logged, not built" entry.
- **Per-option `disabled` — Logged (not built), by design.** Trivial/uniform for
  the radio *control* (web `disabled`, RN Pressable `disabled`, Compose
  `enabled =`), but **not uniform** across the selection surface: RN `Picker.Item`
  has no per-item disable and a SwiftUI `Picker` (which is how RadioGroup lowers on
  SwiftUI) cannot cleanly disable individual rows. Shipping it would be an
  inconsistent half-feature, so it is logged per the scope lock, not built.
- **Scope (unchanged):** icon = leaf icon-token only (no arbitrary image / nested
  component); the F-23 selection idiom (bound value + native match, no per-option
  expression) is untouched.

## Gate / defense interaction

- **Ledger 0-unaccounted** — `option-icon` expressed on all 6.
- **native-code** does not over-flag the registry/Label/Icon constructs (no
  `variant.prop` leak; native rich output has no ternary).
- **token-guard** does not misfire — icon tokens (`icon.star`) and SF-symbol
  strings are not colors/dimensions; the registry carries no hex/px.
- **Mutation harness** 497 → **521** mutants; baseline clean, `drop-trait` 264/264
  killed (includes `option-icon`), **no new survivor, no regression** (only F-22
  survives).

## Regression pins

- **P67** — RadioGroup renders a decorative per-option icon + label on all 6 via the
  runtime registry; `option-icon` expressed, 0 unaccounted; no per-option expression.
- **P68** — an icon on a native Select option is refused (`rich-option-select`) with
  the RadioGroup/overlay redirect; text-only Select + icon RadioGroup pass;
  custom-overlay stays refused.

`verify-patches` → **68/68**. `rm -rf out/ && node _shared/scripts/ci.mjs` → exit 0.

---

# F-26 — Date/time formatting (presets + locale)

F-12 logged F-26 (date/time formatting) as out of scope for the number pass. This
phase builds it, mirroring the F-12 shape with a distinct `kind: datetime` value
and each platform's **native date formatter** (a separate API from number
formatting).

## Authoring — `kind: datetime`

```yaml
text:
  kind: datetime
  value: when            # date source: a plain prop ref of a `date` prop
  dateFormat:
    dateStyle: medium    # short | medium | long  (native preset; omit for time-only)
    timeStyle: short     # short | medium | long  (native preset; omit for date-only)
    locale: en-GB        # literal, OR { kind: ref, value: userLocale }
```

A new `date` prop type carries the source natively (`Date` on web/RN/SwiftUI,
`java.util.Date` on Compose). `dateStyle`/`timeStyle` are **native presets** (no
custom pattern string); `locale` is a static literal or a plain prop ref. An
expression as locale or date-source is **refused** (`expression-date-format`, F-9).

## Native mapping — one date formatter per adapter

| Dimension | Web + RN (`Intl.DateTimeFormat`) | SwiftUI (`DateFormatter`) | Compose (`java.text.DateFormat`) |
|---|---|---|---|
| dateStyle | `dateStyle: 'short'/'medium'/'long'` | `dateStyle = .short/.medium/.long` | `DateFormat.SHORT/MEDIUM/LONG` |
| timeStyle | `timeStyle: '…'` | `timeStyle = .…` | `DateFormat.…` |
| locale | 1st arg `'en-GB'` / `undefined` | `locale = Locale(identifier:)` | `forLanguageTag(...)` |
| instance | `new Intl.DateTimeFormat(...).format(when)` | `f.string(from: when)` | `getDate/Time/DateTimeInstance(...).format(when)` |

Compose picks `getDateInstance` / `getTimeInstance` / `getDateTimeInstance` by
which of dateStyle/timeStyle are present.

### Sample output (EventDateTime — en-GB, medium date + short time)

```
web/RN   new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(when)
SwiftUI  { let f = DateFormatter(); f.locale = Locale(identifier: "en-GB"); f.dateStyle = .medium;
           f.timeStyle = .short; return f.string(from: when) }()
Compose  java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT,
           java.util.Locale.forLanguageTag("en-GB")).format(when)
```

## Breadth matrix — F-26 proofs

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **EventDateTime** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | medium date + short time + en-GB compose into one native date formatter on all 6; `date` prop typed natively; `date-format` expressed, 0 unaccounted. |
| **EventDateLocale** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | long date with a **runtime locale prop-ref** — `userLocale` drives the formatter locale on all 6 (bound, not stringified). |

## Divergence

**None.** short/medium/long date and time presets exist on every platform's native
date formatter, so every option is `express`ed on all 6 — no `diverge`, no waiver.

## Findings

- **F-26 — RESOLVED.** Date/time formatting ships on all 6 via native date
  formatters (Intl.DateTimeFormat / DateFormatter / java.text.DateFormat), presets
  + locale, static or prop-ref locale, ledger-accounted, no divergence. The F-11/
  F-12 number path is untouched (separate value kind, separate formatter).
- **F-27 — Logged (new, out of scope): timezone handling.** Not built this phase
  (per scope lock). A full timezone capability (zone data, DST, `timeZone` option
  across Intl / `TimeZone` / `java.util.TimeZone`) is a distinct future pass; a
  simple static `timeZone` option could be added later if a uniform need appears.
- **Residual (by design):** custom date pattern strings (`yyyy-MM-dd`) are out of
  scope — native presets only, the same boundary as F-12.

## Gate / defense interaction

- **Ledger 0-unaccounted** — `date-format` expressed on all 6.
- **native-code** does not over-flag native date formatters (no `variant.prop`
  leak); native has **no `Intl`**, web has **no native date formatter** (P69).
- **token-guard** does not misfire — locale tags / style presets are formatter
  config, not colors/dimensions.
- **Mutation harness** 521 → **543** mutants; baseline clean, **no new survivor, no
  regression** (only `state-by-color-only`/F-22 survives).

## Proofs (fired)

```
date+time styles + locale   → one native date formatter on all 6 (EventDateTime)
locale prop-ref (userLocale)→ binds the prop on all 6 (EventDateLocale)
expression as locale        → REFUSED  expression-date-format
expression date source      → REFUSED  expression-date-format
preset-only                 → short/medium/long (no custom pattern string)
number/precision path       → untouched (F-11/F-12 specs still PASS)
```

## Regression pins

- **P69** — date+time styles + locale compose into one native date formatter on all
  6; `date` prop typed natively; `date-format` expressed, 0 unaccounted; no
  cross-platform leak; native-code + token-guard do not misfire.
- **P70** — static locale and prop-ref locale both drive the date formatter on all
  6; expression as locale / date-source refused; presets only.

`verify-patches` → **70/70**. `rm -rf out/ && node _shared/scripts/ci.mjs` → exit 0.

## Scope — what this did not touch

Per the F-26 scope lock: native presets only (no custom pattern strings); no
timezone capability (logged as F-27); no expressions as locale/date-source/style
(F-9); the F-11/F-12 number path is a separate value kind and formatter, untouched;
the F-25 rich-option work is independent; no gate or the ledger weakened; no changes
to agents / skills / workflow / AI-router.

---

# F-27 — Timezone support for date/time formatting (extends F-26)

F-26 logged timezone as out of scope. This phase adds an IANA `timeZone` option to
the `kind: datetime` descriptor, routed through each platform's native date
formatter. It extends F-26 — the no-timezone path is byte-identical to before.

## Authoring

```yaml
text:
  kind: datetime
  value: when
  dateFormat:
    dateStyle: medium
    timeStyle: short
    timeZone: Asia/Bangkok              # literal, OR { kind: ref, value: userTz }
```

`timeZone` is an IANA id — a static literal or a plain prop ref. Omitted = device
timezone (output unchanged from F-26). An expression as the timezone (or any option)
is refused (`expression-date-format`, F-9). A display name (GMT+7, ICT) is not an
IANA id and is refused at validate-schema.

## Native mapping

| Case | Web + RN (`Intl.DateTimeFormat`) | SwiftUI (`DateFormatter`) | Compose (`java.text.DateFormat`) |
|---|---|---|---|
| literal | `timeZone: "Asia/Bangkok"` | `f.timeZone = TimeZone(identifier: "Asia/Bangkok") ?? .current` | `.apply { timeZone = TimeZone.getTimeZone(runCatching { ZoneId.of("Asia/Bangkok") }.getOrElse { ZoneId.systemDefault() }) }` |
| prop-ref | `timeZone: __dtfTimeZone(userTz)` | `TimeZone(identifier: userTz) ?? .current` | `runCatching { ZoneId.of(userTz) }.getOrElse { ZoneId.systemDefault() }` |
| invalid runtime | `__dtfTimeZone` try/catch → `undefined` (device) | `?? .current` (device) | `getOrElse { systemDefault() }` (device) |

`__dtfTimeZone` is a per-component web/RN helper: `try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return undefined; }` — a RangeError falls back to `undefined` (device), never throws. The device fallback is semantically identical on all 6 (the viewer's local zone).

## Validity model (MUST-INVESTIGATE #1 — alias / canonical / case / offset)

A literal that passes `validate-schema` must resolve to the **same zone on all 6
platforms**. ICU (web/RN) is lenient — case-insensitive and accepts UTC-offset ids
— but Swift `TimeZone(identifier:)` and Java `ZoneId.of()` are **case-sensitive**
and reject offset forms ICU accepts; an id ICU normalized but a native platform
rejected would silently degrade to the device zone (a parity break). So the literal
rule is the **cross-platform-safe subset**, enforced in three steps (not
`Intl.supportedValuesOf`, which is ICU-version-dependent — this build lists
`Asia/Calcutta` but not `Asia/Kolkata`, so a `supportedValuesOf` allowlist would
wrongly refuse `Asia/Kolkata`):

1. **structural form** — exact `UTC`, or a Region/City path with at least one `/`
   (regex `^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$`). Rejects UTC offsets
   (`+07:00`, `-0500`) and bare words (`Z`, `GMT`);
2. **constructs** under ICU (a real IANA id); and
3. **case-exact** — a pure case-variant (ICU-normalized: `resolved` equals the input
   only when lowercased) is rejected, while a genuine alias (`Asia/Kolkata →
   Asia/Calcutta`, differs beyond case) stays valid.

Literal parity table (accept/refuse at validate-schema, and documented native
behavior):

| literal | validate-schema | Swift `TimeZone(identifier:)` | Java `ZoneId.of()` | why |
|---|---|---|---|---|
| `Asia/Bangkok` | ACCEPT | resolves | resolves | exact Region/City |
| `Asia/Kolkata` | ACCEPT | resolves | resolves | alias (→Calcutta) — kept valid |
| `Asia/Calcutta` | ACCEPT | resolves | resolves | alias — kept valid |
| `Etc/GMT-7` | ACCEPT | resolves | resolves | exact Region/City |
| `UTC` | ACCEPT | resolves | resolves | explicit allow |
| `asia/bangkok` | refuse | **nil** (case-sensitive) | **throws** | case variant |
| `ASIA/BANGKOK` | refuse | **nil** | **throws** | case variant |
| `+07:00` | refuse | **nil** (needs `GMT+0700`) | resolves | offset form, platform-divergent |
| `-0500` | refuse | **nil** | **throws** (needs `-05:00`) | offset form, platform-divergent |
| `Z` | refuse | nil | resolves | bare word, platform-divergent |

The old (first-commit) rule was construction-only, which accepted the case-variants
and offsets in the lower half → tightened here so a passing literal resolves on all
6. Both `Asia/Kolkata` and `Asia/Calcutta` remain valid as required.

- **Prop-ref** ids are not knowable at build time, so they are **not**
  schema-checked; an invalid runtime value falls back to the device timezone
  identically on all 6 (never a crash, never a per-platform fallback).

## MUST-INVESTIGATE #2 — React Native (Hermes) Intl timeZone

F-26 **already** emits `Intl.DateTimeFormat(...).format(...)` for the RN adapter —
RN date formatting depends on the engine providing `Intl.DateTimeFormat`. F-27 adds
the `timeZone` option to that **same, pre-existing** call; it introduces **no new
engine dependency** beyond what F-26 established. On React Native this requires
Hermes built with full ICU (`react-native` 0.73+ ships Hermes with
`Intl.DateTimeFormat` incl. the `timeZone` option; older/no-ICU Hermes supports only
a limited `Intl`, and JSC/`react-native-web` have full Intl). Because the generator
emits platform-standard code (not executed here), the correct place to assert this
is the app's engine config, which is outside this spec→code engine. **Reported, not
papered over:** if a target pins pre-0.73 Hermes without ICU, the RN adapter's
`Intl` usage (F-26 and F-27 alike) would need a polyfill (`@formatjs/intl-*`) or an
RN-specific divergence; no such divergence is taken here because F-26 already
standardized on RN Intl and this repo adds no runtime. The runtime `__dtfTimeZone`
guard additionally means that on any engine that rejects a zone, the output falls
back to device rather than throwing.

## Breadth matrix — F-27 proofs

| Component | React | Vue | Svelte | RN | SwiftUI | Compose | Gates | Outcome | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **EventTzStatic** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | static `Asia/Bangkok` through each native formatter; `date-timezone` expressed, 0 unaccounted. |
| **EventTzRef** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9/9 pass | **PASS** | runtime `userTz` bound (not stringified) + device fallback on all 6. |

## Divergence

**None.** Every adapter expresses `date-timezone` through its native formatter; no
`diverge`, no waiver.

## Test matrix (6 adapters × each case)

```
                 react  vue  svelte  rn   swiftui  compose
static literal     ✓     ✓     ✓     ✓      ✓        ✓     (native timeZone emitted)
prop-ref           ✓     ✓     ✓     ✓      ✓        ✓     (bound var + device fallback)
omitted            ✓     ✓     ✓     ✓      ✓        ✓     (byte-identical to F-26; diff -rq = no diff)
invalid literal    — refused at validate-schema (before generation), all adapters —
invalid prop-ref   ✓     ✓     ✓     ✓      ✓        ✓     (device fallback baked into output)
expression tz      — refused (expression-date-format, F-9), all adapters —
```

## Gate / defense interaction

- **Ledger 0-unaccounted** — `date-timezone` is a declared trait; each adapter
  `express()`es it when a timezone is set. Dropping it in any adapter → ledger RED
  (fired-gate proof below).
- **validate-schema** rejects an invalid literal before generation (fired-gate
  proof below).
- **parity** now tracks the timezone/locale prop-ref, so a stringified-ref defect
  (`timeZone: "userTz"`) goes RED (new mutation operator, killed).
- **native-code** stays green — formatters/guards are native, not `variant.prop`
  leaks (no `Intl` in native, no native formatter in web). **token-guard** stays
  green — IANA ids / locales are formatter config, not colors/dimensions.

## Fired-gate proofs

```
# ledger (date-timezone trait) — drop React's express():
REVERTED  ledger FAIL (1 unaccounted): react drops trait `date-timezone` (silent drop)
RESTORED  ledger PASS (0 unaccounted)

# validate-schema (literal IANA check) — disable checkTimeZones:
REVERTED  invalid literal "Mars/Phobos" validates ok=true  (gate silent — the hole)
RESTORED  invalid literal "Mars/Phobos" validates ok=false (gate fires)
```

## Mutation harness

Corpus 543 → **578** mutants; baseline clean, **574 killed / 4 survived** (only the
known `state-by-color-only`/F-22 advisory). New/covered mutants:
- **drop-trait** generates **12** `date-timezone` drops (6 adapters × 2 specs) — all
  killed by the ledger.
- **tz-ref-as-literal** (new operator): a timezone prop-ref emitted as its own-name
  string literal — killed by parity.
No new survivor, no regression.

## Findings

- **F-27 — RESOLVED.** IANA timezone (literal + prop-ref) on all 6 via native date
  formatters; invalid literal refused at schema; invalid runtime value falls back to
  device uniformly; expressions refused; no-timezone output byte-identical to F-26.
- **Residual (by design):** timezone **display names/labels** (GMT+7, ICT) are not
  supported — refused at validate-schema as non-IANA ids, the same boundary as
  custom date patterns.
- **Residual (by design, not a bug) — React Native engine requirement.** The RN
  adapter formats dates through `Intl.DateTimeFormat` (true since F-26); the F-27
  `timeZone` option rides that same call. RN honors the `timeZone` option only on
  **Hermes built with full ICU (React Native 0.73+)** — or JSC. On an older /
  no-ICU Hermes, an unsupported zone **degrades to the device timezone** (the
  `__dtfTimeZone` guard falls back rather than throwing). This is a target-engine
  configuration concern outside this spec→code generator; no RN divergence/waiver
  is taken because the fallback is safe and uniform. **Handoff:** consumers
  targeting RN must ship RN 0.73+ (Hermes+ICU) or a `@formatjs/intl-datetimeformat`
  polyfill for zone-accurate output; otherwise date output is correct but in the
  device zone.
- **Residual (by design, not a bug) — tzdata skew.** A timezone id newer than a
  given platform's bundled tzdata (an older OS or runtime that predates the zone,
  e.g. a recently-created or renamed IANA zone) cannot be detected at
  validate-schema — the build-time ICU check accepts it, but at runtime that stale
  platform doesn't know it and **degrades to the device timezone** (the same safe,
  uniform fallback as an invalid prop-ref). validate-schema cannot see the end
  device's tzdata vintage, so this is not catchable there.

## Follow-up (literal parity + harness coverage)

- **Literal rule tightened** to the cross-platform-safe subset (exact-case
  Region/City or `UTC`; case variants, UTC offsets and display names refused) so a
  literal that passes validate-schema resolves identically on web/Swift/Java. See
  the Validity-model table above. `Asia/Kolkata` and `Asia/Calcutta` both remain
  valid.
- **Mutation coverage:** the validate-schema literal check is now a gate in the
  mutation battery (`timezone-schema`), and operator **`invalid-literal-timezone`**
  injects a case-variant literal into each datetime spec — **4 mutants, all killed**
  by `timezone-schema`. Reverting the tightened rule reopens the hole AND turns the
  harness RED (those 4 survive), proving the gate is load-bearing.

## Regression pins

- **P71** — static IANA id renders through each native formatter on all 6;
  `date-timezone` expressed, 0 unaccounted.
- **P72** — prop-ref binds the variable (not stringified) + device fallback on all 6;
  the web/RN `__dtfTimeZone` guard returns `undefined` (device) on an invalid id.
- **P73** — invalid literal refused at validate-schema (canonical + alias pass,
  display name refused); expression / non-plain-ref refused (F-9); a no-timezone
  datetime declares no `date-timezone` trait and emits no timezone code.
- **P74** — literal parity: exact-case Region/City or `UTC` accepted; case variants,
  UTC offsets (`+07:00`, `-0500`) and display names refused; `Asia/Kolkata` AND
  `Asia/Calcutta` both valid; a prop-ref still passes schema (runtime device fallback).

`verify-patches` → **74/74**. `rm -rf out/ && node _shared/scripts/ci.mjs` → exit 0.

## Scope — what this did not touch

IANA ids only (no display names, no custom patterns); no expression as any option;
no new dependency; the F-26 number/date path and all other features are byte-identical
when no timezone is set; no gate or the ledger weakened; no changes to agents / skills
/ workflow / AI-router.

---

# F-22 — state-by-color-only now blocking (resolved)

State conveyed by colour alone was a `slop-guard` `status-color-only` advisory at
`minor` severity — reported but never RED, so the 4 `state-by-color-only` mutants
survived as a logged blind spot. This phase makes it a **blocking a11y
correctness contract** and drives the harness to **0 survivors**.

## The `variant.intent` discriminant (schema metadata only)

A colour-only variant is only a defect when the variant conveys *state the user
must decode* — `alert` severity, `badge` status. A `button`'s
primary/secondary/ghost/destructive is *presentational emphasis*, and colour-only
there is intentional. A blanket colour-only rule would false-positive on `button`.

So a `variant` now carries an **`intent`**: `status` | `emphasis`, **default
`status` (fail-closed)**. It is **scoping metadata only** — `spec-to-ir.mjs`
copies it onto `ir.variant`, but `variantData()` reads only `{ prop, cases }`, so
**no adapter emits it and all generated output is byte-identical** (`diff -rq`
across all 6 adapters vs main = no difference). `button` declares
`intent: emphasis`; `alert`, `badge`, `banner`, `stat-card` declare
`intent: status`.

## The rule (a11y-guard static tier, `serious` = blocking)

For a `status` variant (declared or defaulted), compute each state's **non-colour
signature** — the resolved `slot=token` pairs for every slot NOT in
`{background, color, border}` (a per-state `icon`, or any non-colour slot),
sorted. **Every pair of states must have a distinct signature.** Two states that
share a signature — including the empty one (pure colour-only) — are
indistinguishable without colour and FAIL. Comparison is on *resolved values*,
not key presence, so "same icon on every state" fails too.

**Backstop:** an `intent: emphasis` variant whose enum values read as a status
vocabulary (`success`, `warning`, `error`, `info`, `positive`, `negative`,
`danger`, and close synonyms) is a mislabeled status variant and FAILS. The match
is exact and case-insensitive, **not fuzzy** — `destructive` is NOT swept in, so a
genuine `button` emphasis enum passes.

Caller-supplied content (child text bound to a prop) is **not** a variant-bound
cue and does not count.

## Location — why a11y-guard, not slop-guard

Decision gate: *does slop-guard support waivers with approver + expiry at
`serious`?* **No** — slop-guard only severity-filters `{ok, issues}`; the
approver/expiry waiver mechanism lives in `ledger-gate.mjs` / `loadWaivers`
(`_shared/policy/a11y-waivers.json`), which slop-guard does not consult. Per the
agreed decision, the check therefore moved to the **a11y-guard static layer**
(this is an a11y/CVD correctness concern), and the **slop-guard duplicate was
removed** (single source of truth). The mutation operator's `klass` moved
`slop → a11y` accordingly. Not routed through the Lowering Ledger (there is no
per-adapter lowering obligation here; it is a cross-case spec property).

## Mutation coverage

`KNOWN_SURVIVORS` is now empty. Four operators exercise the contract, all killed
by the a11y gate:

| operator | mutants | killed by | how |
|---|---|---|---|
| `state-by-color-only` | 4 | a11y | strip every per-state icon ⇒ all states collapse to the empty signature |
| `strip-icon-all-but-one` | 3 | a11y | keep one icon in a ≥3-case variant ⇒ the ≥2 bare states collide |
| `same-icon-every-case` | 4 | a11y | one icon on all states ⇒ identical signatures |
| `flip-intent-to-emphasis` | 4 | a11y | flip a status variant to emphasis ⇒ backstop fires on its status enum |

Totals: **593 mutants / 593 killed / 0 survived** (was 582 / 578 / 4). Fired-gate
proof: disabling the rule returns all 15 as survivors → `MUTATION-TESTING FAIL`;
restoring → 0 survivors → PASS. `verify-patches` **80/80** (P18 migrated to
a11y; P44 updated; P75–P80 add the pass / colour-only / only-one-icon / identical-
icon / emphasis-backstop / default-is-status cases).

## Residual (by design, not a bug) — caller-supplied sign

`stat-card`'s delta direction is reinforced in rendered output by the **sign the
caller supplies** in the delta string (`+2.5%` / `-1.2%`). That sign is genuine
non-colour information, but it is **caller content, not bound to the variant**, so
the rule does not credit it and does not enforce it — `stat-card` passes on its
per-direction *icon*, which is variant-bound. Enforcing a caller-provided sign is
out of scope (the engine cannot guarantee caller text); recorded here as a
by-design residual.

## Residual (by design, not a bug) — non-waivable

`status-color-only` is **non-waivable** by design, like every other `serious`
rule in the a11y-guard static layer (`img-alt`, `button-name`, `label`): the
guard does not consult `_shared/policy/a11y-waivers.json`, so there is no
approver/expiry escape hatch. The only ways to clear a finding are to **add a
per-state non-colour cue** (icon / text / shape / sign) or to **declare
`intent: emphasis`** (itself subject to the `STATUS_VOCAB` backstop). Waivers for
the a11y layer, if ever wanted, are a separate layer-wide decision — not wired
here, and `ledger-gate.mjs` / the waiver registry are untouched.

## Residual (by design, not a bug) — STATUS_VOCAB coverage

The emphasis backstop matches enum values against a fixed status-vocabulary list
(`STATUS_VOCAB`: `success`/`warning`/`error`/`info`/`positive`/`negative`/
`danger` and close synonyms), by exact case-insensitive token — deliberately
**not** fuzzy, so a genuine emphasis label like `destructive` is not swept in.
The cost of that precision: a status-like enum value **outside** the list (e.g. a
domain term such as `overdue` or `breached`) used on an `intent: emphasis`
variant is **not** caught by the backstop. Mitigation: `intent: emphasis` must be
declared **deliberately**, and the default is `status` (fail-closed), so the only
way to reach this gap is an explicit, reviewable mislabel — not an accident.

## Constraints honoured

`variant.intent` is metadata only — **no adapter output changed** (byte-identical
`diff -rq`); no dependency added; F-6 / F-8 and the F-27 timezone code untouched;
no gate, mutant, or the ledger weakened or whitelisted to reach green.

---

# PR A — link navigation (external URL)

`el: link` means **external URL navigation**: the component opens an absolute
URL (`href`, a literal or a plain prop-ref) in the platform browser. **Internal
screen-to-screen navigation is NOT yet supported** — there are no routes,
screens, or navigation state in the schema/IR/adapters; that is a separate,
later work item.

## Native mapping (all 6 open the URL for real)

| adapter | primitive |
|---|---|
| react / vue / svelte | `<a href=…>` (browser navigation) |
| react-native | `<Pressable accessibilityRole="link" onPress={() => Linking.openURL(href)}>` |
| swiftui | `Link(label, destination: URL(string: href)!)` |
| compose | `Text(…, Modifier.clickable { uriHandler.openUri(href) })`, where `uriHandler = LocalUriHandler.current` is hoisted to composable scope and `androidx.compose.ui.platform.LocalUriHandler` is imported |

Previously the Compose adapter emitted the href only as a comment inside an empty
`clickable { /* open … */ }` — an inert link. That is fixed: Compose now opens the
URL via `LocalUriHandler.openUri` (the official Compose URI-opening API).

## Gate coverage

- **Ledger:** a link node declares a `link-href` trait; every adapter `express()`s
  it with its real mechanism (0 unaccounted), so a *dropped* trait is caught by the
  ledger.
- **Parity (nav-primitive lint):** the ledger cannot see an *inert body*, so
  `checkParity` additionally asserts each adapter's output contains its navigation
  primitive whenever the IR has a link. An emptied navigation body is ledger-green
  but parity-RED.
- **Mutants:** `drop-trait` (ledger) drops `link-href` per adapter; `link-empty-body`
  (parity) empties the navigation body per adapter. All killed; 0 survivors.

Corpus: `.claude/artifacts/link-external` (literal href) and `link-external-ref`
(prop-ref href) exercise the link path on all 6 adapters.

## Residual (deferred to the navigation work) — link href runtime robustness

PR A makes the navigation call real on every adapter, but it does **not** harden
the *runtime* handling of a bad `href`. These are logged, not fixed here, and
belong with the later navigation work item. Verified per adapter for a prop-ref
`href` whose runtime value is not a valid/openable URL:

| adapter | generated call | behaviour for an invalid runtime href | when |
|---|---|---|---|
| react / vue / svelte | `<a href={url}>` / `<a :href="url">` | no crash — the browser resolves or ignores the value (an invalid or relative string just yields a dead/relative anchor) | n/a |
| react-native | `onPress={() => Linking.openURL(url)}` | `Linking.openURL` returns a **rejecting Promise** for an unopenable URL; the generated `onPress` does not `.catch`, so it surfaces as an **unhandled promise rejection** | on tap |
| swiftui | `Link(label, destination: URL(string: url)!)` | **force-unwrap**: `URL(string:)` returns nil for a string it cannot parse (e.g. empty or containing spaces), and the `!` then **traps — a fatal crash at view-body evaluation (render time)** | at render |
| compose | `Modifier.clickable { uriHandler.openUri(url) }` | `UriHandler.openUri` **throws `IllegalArgumentException("Can't open …")`** when the URI is invalid or no activity can handle it (it wraps `ActivityNotFoundException`); the generated call is not wrapped in try/catch, so it is uncaught | on tap |

- **SwiftUI force-unwrap is the sharpest risk** — it is the only adapter that can
  crash at *render* time (not just on interaction) for an invalid `href`. A later
  fix would avoid `URL(string:)!` (e.g. guard the optional and omit/disable the
  link when nil). Not changed in this PR.
- **Compose `openUri` throw** — confirmed against the official `AndroidUriHandler`
  reference: it catches `ActivityNotFoundException` and rethrows
  `IllegalArgumentException`. A later fix would wrap the call. Not changed here.
- **No scheme validation** — the engine does not validate `href` schemes (e.g. it
  will emit `javascript:`, `data:`, `file:` as-is on every adapter). There is no
  scheme-policy gate yet, so **callers must pass trusted URLs** until one exists.
  Introducing a scheme allowlist/policy is deferred to the navigation work.

No code or generated output changes for this item — documentation only.
