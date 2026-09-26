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
| F-4 | Logged | No orientation / dimension axis (e.g. Divider vertical). |
| F-5 | Logged | No boolean-attribute binding (e.g. Button `disabled`). |
| F-6 | Logged (minor) | Variant icon bound to the state, not a free per-instance toggle (Badge). |
| F-7 | Logged | No size slot (e.g. Spinner sizes). |
| F-8 | Logged (by design) | No animation primitive (shimmer / spin). |
| F-9 | **Resolved — REFUSE (Phase B)** | Expression-driven variant discriminant is now refused by the orchestrator with an enum redirect (`expression-variant`). `native-code` gate stays as defense in depth. |
| F-10 | **Fixed (Phase B)** | Added the first-class `el: icon` element; a standalone icon renders on all 6 via the icon-map, decorative by default / labeled when `a11y.label` set. |
| F-11 | **Fixed (Phase B, precision-only)** | `X.toFixed(Y)` maps to SwiftUI `NumberFormatter` / Compose `NumberFormat` with `min=max fractionDigits = precision`, grouping off. Web/RN unchanged. |
| F-12 | **Logged (Phase B) — deferred** | Locale (decimal separator / thousands grouping), currency symbol handling/positioning, and rounding-mode configuration for number formatting. A separate future number-format pass; explicitly out of scope for the precision-only F-11 fix. |
| F-13 | **Logged (new, F-3) — deferred** | Conditional shapes beyond the three built: nested conditional (if inside if), else-if chains, per-item conditional (a conditional INSIDE each iterated item), and conditionals nested more than one level in iteration. Each needs its own design pass. |

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
| **F-22** | State conveyed by **color alone** | `slop-guard`'s `status-color-only` rule fires but at **`minor`** severity, which is advisory and does not block the gate. Turning a good icon+color status variant into a color-only one is reported but never RED (4/4 mutants survived; `slop.ok` stays true while the issue is listed). This is an **intentional severity choice** (color-only is a smell, not always a defect — some contexts add text instead of an icon), so it is a *known* advisory gap, not necessarily a bug. **Options for triage:** leave advisory (status quo), or escalate to `serious` when a variant is color-only AND carries no adjacent text/icon anywhere. No change applied. |

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
