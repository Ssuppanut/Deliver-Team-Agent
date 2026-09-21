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
| **EmptyState** | ○ | ○ | ○ | ○ | ○ | ○ | 5/5 pass | **PARTIAL** | Optional action (`when: onAction`) works on all 6 — **optional-child conditional is supported**. But the declared hero `icon: icon.star` on the root container is **silently dropped by all 6 adapters** (no `Star`/`star` anywhere) and **no gate flags it**. New finding **F-10**. |
| **StatCard** | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | 5/5 pass | **PASS** | Delta direction conveyed by a per-direction icon (`success`/`error`) **and** an explicit sign in the text — not color alone; slop-guard clean. `direction` is a plain enum prop used on all 6. Compose color-cascade warning (delta text keeps default color there). Logged: cannot *auto-derive* direction from the numeric sign — **F-9**. Minor: icon set has no up/down arrow token (used success/error as directional proxies). |
| **TokenAmount** | ✓ | ✓ | ✓ | ✓ | ○ | ○ | 5/5 pass | **PARTIAL** | Web + RN format correctly via a JS `expr` (`amount.toFixed(precision)`). SwiftUI/Compose cannot eval JS → render the **raw, unformatted** amount and leave **`precision` a declared-but-unused prop**. A documented `expr simplified` warning is emitted, but **parity still passes** because the prop *declaration* satisfies the name-presence check — a residual structural false-green. New finding **F-11**. |

**Batch 2 tally: 2 PASS · 2 PARTIAL · 0 REFUSE · 0 FAIL.**
`rm -rf out/ && node _shared/scripts/ci.mjs` → exit 0. All 4 generate across all
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
| F-9 | **Logged (new, B2)** | Variant selection cannot be driven by an expression / derived value (native emits invalid code, silent). |
| F-10 | **Logged (new, B2)** | No standalone decorative-icon element; `icon` on a container is silently ignored. |
| F-11 | **Logged (new, B2)** | Per-platform number formatting (precision/separators) not expressible on SwiftUI/Compose; `precision` becomes a declared-but-unused prop. |

Scope for Batch 2 was strictly authoring 4 component specs and recording results.
No renderer-base/schema capabilities built, no conditional/number-format
infrastructure, no gate changes, and no changes to agents / skills / workflow /
AI router.
