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
| **Avatar** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 5/5 pass | **PASS** | `role=img` now maps to real native traits (`accessibilityRole="image"` / `.isImage` / `role = Role.Image`). Passes the hardened gates. Logged schema gap (**F-3**, unfixed): true "image *else* initials" fallback still needs `if/else`/`not`; today the caller supplies exactly one of `src`/`initials`. |
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
| **EmptyState** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **declared-io FAIL** | **FAIL** *(after B3)* | Optional action (`when: onAction`) works on all 6 — **optional-child conditional is supported**. But the declared hero `icon: icon.star` sits on the root container, which no renderer places, so it is silently dropped on all 6. Under the Batch-3 **declared-io** gate this is now a hard FAIL (was a silent PARTIAL in B2). Finding **F-10**. |
| **StatCard** | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | 7/7 pass | **PASS** | Ships the **enum-workaround** form (`direction` is a plain prop): delta direction by per-direction icon + explicit sign, not color alone; slop-guard clean; valid on all 6, so it correctly stays GREEN under the new `native-code` gate too. The intent it works around — *auto-deriving* direction from the sign (**F-9**) — now FAILs `native-code` when expressed directly (proven in Batch 3). Minor: no up/down arrow icon token (used success/error as proxies). |
| **TokenAmount** | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | **declared-io FAIL** | **FAIL** *(after B3)* | Web + RN format correctly via a JS `expr` (`amount.toFixed(precision)`). SwiftUI/Compose cannot eval JS → render the **raw, unformatted** amount and leave **`precision` a declared-but-unused prop**. In B2 parity false-passed on the prop *declaration*; the Batch-3 **declared-io** gate now catches the drop on both native adapters → FAIL. Finding **F-11**. |

**Batch 2 tally (as recorded then): 2 PASS · 2 PARTIAL · 0 FAIL. Restated under the
Batch-3 hardened gates: 2 PASS (Banner, StatCard) · 0 PARTIAL · 2 FAIL
(EmptyState, TokenAmount).** The two ✗ rows were silently green in B2; the
stricter gates now tell the truth. See the Batch 3 section below.
`node _shared/scripts/ci.mjs` was exit 0 **at B2 time**; under Batch 3 it is
**exit 1** by design (the two honest FAILs). All 4 still generate across all
6 adapters and pass every hardened gate — but two carry an intent that is
silently unmet on some adapters (EmptyState icon on all 6; TokenAmount precision
on the 2 native JS-less adapters), which the current gates do not catch.

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
| F-3 | Logged | No conditional/fallback (`if/else`, `not`) — true either/or child render. |
| F-4 | Logged | No orientation / dimension axis (e.g. Divider vertical). |
| F-5 | Logged | No boolean-attribute binding (e.g. Button `disabled`). |
| F-6 | Logged (minor) | Variant icon bound to the state, not a free per-instance toggle (Badge). |
| F-7 | Logged | No size slot (e.g. Spinner sizes). |
| F-8 | Logged (by design) | No animation primitive (shimmer / spin). |
| F-9 | **Caught by gate (B3)** · underlying gap logged | Expression-driven variant → native emits invalid code. Now FAILs the `native-code` gate (H1); the engine-direction fix is deferred. |
| F-10 | **Caught by gate (B3)** · underlying gap logged | No standalone decorative-icon element. A misplaced `icon` now FAILs the `declared-io` gate (H2b); adding an icon element is deferred. |
| F-11 | **Caught by gate (B3)** · underlying gap logged | Native number formatting drops `precision`. Now FAILs the `declared-io` gate (H2a); the format fix is deferred. |

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
