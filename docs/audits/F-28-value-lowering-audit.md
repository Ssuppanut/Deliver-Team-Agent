# F-28 enum value lowering audit

- **Purpose:** record what each of the 6 adapters (react, vue, svelte, react-native, swiftui, compose) actually emits for every enum-valued and value-level construct of the design-spec language, judged against what each platform defines. F-28 (`a11y.live: off` lowered wrongly on React Native, Compose and SwiftUI while every gate passed) turned out to be one instance of a class. This document is the baseline for sizing that class and for burning it down.
- **Baseline:** `origin/main` at `5914fa195e8c4f26f1795888e76d9983229c6c72` (after PR #26).
- **Date:** 2026-10-06.
- **Method:** each construct x value was generated from a throwaway probe spec through the real generators and the real gates (probes lived in a scratch tree outside the repo). The "expected" column is hand-authored from official platform documentation, never derived from the adapter code. Apple documentation was read as primary text through its documentation JSON endpoint; MDN, React Native, Android and Oracle documentation were read as official-page excerpts through search, because direct fetches of those hosts were blocked by the session network policy. The `conf` column in the tables records this per row (P = primary text read, E = official-page excerpt, N = not individually confirmed).
- **Status of the verdicts:** they were made against official platform documentation. **58 rows are UNVERIFIED** pending device or runtime checks (VoiceOver, TalkBack, a Swift playground, a Hermes runtime, a Compose compile). Nothing in this document is a fix; no defect has been fixed.

## Legends

### Verdict classes

| Verdict | Meaning |
|---|---|
| CORRECT | emitted output matches the platform meaning |
| DEFECT | emitted output has a different meaning than the spec value (F-28 is this) |
| SILENT-DROP | the value is ignored and nothing is emitted |
| COLLAPSED | several spec values produce the same output on a platform that distinguishes them |
| DECLARED-DEGRADATION | the platform cannot express it and an existing waiver or divergence says so |
| UNDECLARED-DEGRADATION | the platform cannot express it but the ledger reports it as expressed (SwiftUI assertive is the known case) |
| UNVERIFIED | cannot confirm from docs |

### Severities (non-CORRECT rows)

| Severity | Meaning |
|---|---|
| A11Y | changes what assistive tech does or announces |
| FUNCTIONAL | changes behaviour |
| VISUAL | changes appearance |
| COSMETIC | cosmetic only |

## Counts

Recomputed from the rows of [F-28-full-table.md](F-28-full-table.md) (the numbers below are parsed from that file, not typed in). The aggregated list [F-28-non-correct-rows.md](F-28-non-correct-rows.md) contains 144 aggregated rows (its title states 144 aggregated rows from 178).

| | Recomputed | Reported by the audit | Match |
|---|---|---|---|
| Total rows | 612 | 612 | yes |
| CORRECT | 434 | 434 | yes |
| DEFECT | 35 | 35 | yes |
| SILENT-DROP | 50 | 50 | yes |
| COLLAPSED | 12 | 12 | yes |
| DECLARED-DEGRADATION | 21 | 21 | yes |
| UNDECLARED-DEGRADATION | 2 | 2 | yes |
| UNVERIFIED | 58 | 58 | yes |
| Non-CORRECT rows | 178 | 178 | yes |
| Aggregated non-CORRECT rows (react, vue, svelte counted as one "web") | 144 | 144 (rows in the aggregated file) | yes |

Rows per severity (non-CORRECT rows only): A11Y 73, COSMETIC 52, FUNCTIONAL 29, VISUAL 24.

| Severity | Rows by verdict |
|---|---|
| A11Y | COLLAPSED 12, DECLARED-DEGRADATION 19, DEFECT 15, SILENT-DROP 25, UNDECLARED-DEGRADATION 2 |
| COSMETIC | UNVERIFIED 52 |
| FUNCTIONAL | DECLARED-DEGRADATION 2, DEFECT 11, SILENT-DROP 10, UNVERIFIED 6 |
| VISUAL | DEFECT 9, SILENT-DROP 15 |

## Cluster index

The 178 non-CORRECT rows were mapped to the 10 defect clusters below. The mapping uses only what the table rows say (construct, value, adapter, verdict and note text), by these rules:

- CL-01: construct `a11y.value:live`.
- CL-02: construct `element.field:level`, and `el-kind` = heading.
- CL-03: construct `element.field:role` (all non-CORRECT role rows, including waived ones).
- CL-04: `element.value:orientation` rows on the web adapters with verdict DEFECT.
- CL-05: construct `input.value:inputType`.
- CL-06: `numberFormat.field:rounding (omitted ...)` and the `kind = expr` (toFixed) rows.
- CL-07: construct `style-slot`.
- CL-08: `el-kind` = media.
- CL-09: the `kind = expr` rows that are NOT toFixed.
- CL-10: Compose icon rows whose note names `material-icons-extended`.

A row that fits none of these is listed under "Unclustered" below and is not forced into a cluster.

| Id | Cluster | Rows | Rows by verdict | Rows by severity | Gate coverage today |
|---|---|---|---|---|---|
| CL-01 | Live value fidelity | 5 | DEFECT 3, UNDECLARED-DEGRADATION 2 | A11Y 5 | none caught it |
| CL-02 | Heading semantics and level | 20 | COLLAPSED 12, SILENT-DROP 8 | A11Y 20 | none caught it |
| CL-03 | Role table mistakes and stale waivers | 39 | DECLARED-DEGRADATION 17, DEFECT 6, SILENT-DROP 16 | A11Y 39 | 16 of 39 rows caught (ledger 16) |
| CL-04 | Web aria-orientation on a role-less div | 6 | DEFECT 6 | A11Y 6 | none caught it |
| CL-05 | inputType on native plus the web checkbox binding | 13 | DEFECT 3, SILENT-DROP 10 | FUNCTIONAL 13 | none caught it |
| CL-06 | Number rounding defaults | 4 | DEFECT 2, UNVERIFIED 2 | FUNCTIONAL 4 | none caught it |
| CL-07 | Style slots | 24 | DEFECT 9, SILENT-DROP 15 | VISUAL 24 | none caught it |
| CL-08 | SwiftUI media alt | 1 | SILENT-DROP 1 | A11Y 1 | none caught it |
| CL-09 | expr simplification (warning only) | 2 | DECLARED-DEGRADATION 2 | FUNCTIONAL 2 | none caught it |
| CL-10 | Compose icon and image dependencies | 2 | UNVERIFIED 2 | FUNCTIONAL 2 | none caught it |
| - | Unclustered | 62 | DECLARED-DEGRADATION 2, DEFECT 6, UNVERIFIED 54 | A11Y 2, COSMETIC 52, FUNCTIONAL 8 | 6 of 62 rows caught (token-guard 6) |
| | **Total** | **178** | | | |

Rows are raw rows (react, vue and svelte each count). CL-10 has no row for the Coil `AsyncImage` dependency: the table marks that row CORRECT and records the dependency only in its note.

### Unclustered rows

- element.value:orientation (with role=separator) = horizontal | DECLARED-DEGRADATION | A11Y: 1 row(s) on react-native. Note: role separator waived on RN; the axis is still flexDirection
- element.value:orientation (with role=separator) = vertical | DECLARED-DEGRADATION | A11Y: 1 row(s) on react-native. Note: role separator waived on RN; the axis is still flexDirection
- numberFormat.field:rounding = floor | UNVERIFIED | FUNCTIONAL: 1 row(s) on react-native. Note: ES2023 option; verify the RN runtime honours roundingMode (device check). Older engines ignore it silently
- numberFormat.field:rounding = ceil | UNVERIFIED | FUNCTIONAL: 1 row(s) on react-native. Note: ES2023 option; verify the RN runtime honours roundingMode (device check). Older engines ignore it silently
- element.field:icon = icon.check | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.close | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.info | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.warning | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.error | UNVERIFIED | COSMETIC: 5 row(s) on react, vue, svelte, react-native, swiftui. Note: check the name in the lucide release used
- element.field:icon = icon.success | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.star | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.heart | UNVERIFIED | COSMETIC: 6 row(s) on react, vue, svelte, react-native, swiftui, compose. Note: check the name in the lucide release used
- element.field:icon = icon.chevron | UNVERIFIED | COSMETIC: 5 row(s) on react, vue, svelte, react-native, swiftui. Note: check the name in the lucide release used
- element.field:icon = icon.nonexistent | DEFECT | FUNCTIONAL: 6 row(s) on react, vue, svelte, react-native, swiftui, compose (caught by token-guard). Note: unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it

## Key findings

1. **Value-level diverge works only when the ledger trait id carries the value.** It works for `a11y.live=*`, `role=*`, `orientation=*` and `state=*`. It does not work for `number-format`, `date-format`, `size`, `disabled`, `link-href` or `input.multiline`, nor for constructs with no trait at all (heading level, `inputType`, style slots, icons, element kinds, value kinds). Those need new declared traits first.
2. **The D2 registry and R7 normalize `a11y.live=*`**, so per-value handling is invisible to them.
3. **The only gate that inspects an emitted enum value is the layout-axis parity lint.** The ledger reads entries only; the a11y-guard live checks are value-blind (they test that a live-region trait exists). The F-28 probe (`live: off`) passed all nine gates.
4. **Of the 99 DEFECT, SILENT-DROP, COLLAPSED and UNDECLARED-DEGRADATION rows, a gate caught 22 and 77 passed every gate.** The 22 were caught by the ledger (16, on roles that have no waiver) and by token-guard (6, on the unmapped icon token). The 77 silent rows split A11Y 38, FUNCTIONAL 15, VISUAL 24.

## Decisions recorded so far (decisions, not audit results)

These are decisions made by the owner after the audit. They are not findings of the audit and are recorded here only so the baseline and its follow-up plan live together.

- F-28 order: audit first, then fix.
- SwiftUI assertive and polite are handled by a value-level diverge with a waiver and an expiry.
- The gate is a narrow parity lint on the emitted live value plus per-value pins. A general expected-value table is considered later: planned home `_shared/policy/value-lowering-expectations.yaml` plus `check-value-lowering.mjs`, with a documentation reference mandatory per row.
- The `live-region-off` spec returns together with the F-28 fix.
- Sequence after F-28: D4 first (retire the old regex handled-trait scan, register traits, add new mutation operators with the known survivors listed in `KNOWN_SURVIVORS` and burned down cluster by cluster), then the cluster fixes, A11Y first.
- All UNVERIFIED rows are to be confirmed on real devices or runtimes before the F-28 fix is designed.

## Reference key (R1 to R27)

Copied from the audit files. Some paths there are abbreviated with `...` and some hosts have no scheme; they are reproduced as written. The full links used in the audit report follow.

- **R1**: MDN aria-live - developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live
- **R2**: MDN status role / live regions - .../Roles/status_role ; .../ARIA/Guides/Live_regions (alert = implicit assertive, status = implicit polite)
- **R3**: React Native Accessibility - reactnative.dev/docs/accessibility (accessibilityRole, role, accessibilityLiveRegion [Android API>=19 only], aria-live)
- **R4**: Compose LiveRegionMode - developer.android.com/reference/kotlin/androidx/compose/ui/semantics/LiveRegionMode ; Compose Semantics - developer.android.com/develop/ui/compose/accessibility/semantics (heading(), Role)
- **R5**: SwiftUI AccessibilityTraits - developer.apple.com/documentation/swiftui/accessibilitytraits ; .../accessibilitytraits/updatesfrequently ("frequently updates its label or value")
- **R5b**: AccessibilityNotification.Announcement (iOS 17+) - developer.apple.com/documentation/accessibility/accessibilitynotification/announcement
- **R6**: MDN aria-orientation - .../Reference/Attributes/aria-orientation (scrollbar, select, separator, slider, tablist, toolbar)
- **R7**: MDN heading role / aria-level - .../Reference/Roles/heading_role ; .../Attributes/aria-level (aria-level required for role=heading)
- **R8**: SwiftUI accessibilityHeading(_:) / AccessibilityHeadingLevel (h1..h6, iOS 15+) - developer.apple.com/documentation/swiftui/view/accessibilityheading(_:)
- **R9**: MDN input type=checkbox - .../Elements/input/checkbox (current state is the checked property, value is the submitted value)
- **R10**: MDN input type=password - .../Elements/input/password
- **R11**: React Native TextInput - reactnative.dev/docs/textinput (secureTextEntry, keyboardType, inputMode)
- **R12**: SwiftUI SecureField - developer.apple.com/documentation/swiftui/securefield ; View.keyboardType(_:)
- **R13**: Compose KeyboardOptions / KeyboardType / PasswordVisualTransformation - developer.android.com/reference/kotlin/androidx/compose/foundation/text/KeyboardOptions
- **R14**: MDN Intl.NumberFormat constructor (roundingMode; default halfExpand) - .../Intl/NumberFormat/NumberFormat
- **R15**: Apple NumberFormatter.RoundingMode (halfUp = "away from zero if equidistant"; no default stated) - developer.apple.com/documentation/foundation/numberformatter/roundingmode-swift.enum
- **R16**: Oracle java.math.RoundingMode ; java.text.NumberFormat / DecimalFormat (factory default = HALF_EVEN) - docs.oracle.com/en/java/javase/17/docs/api/
- **R17**: MDN Intl.DateTimeFormat constructor (dateStyle/timeStyle: full|long|medium|short) - .../Intl/DateTimeFormat/DateTimeFormat
- **R18**: Apple DateFormatter.Style (format depends on locale) - developer.apple.com/documentation/foundation/dateformatter/style
- **R19**: Oracle java.text.DateFormat (SHORT/MEDIUM/LONG/FULL) - docs.oracle.com/javase/8/docs/api/java/text/DateFormat.html
- **R20**: MDN border-color / border-style (style defaults to none) ; gap (applies to multi-column, flex, grid only) - developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/gap
- **R21**: React Native View Style Props / Text Style Props - reactnative.dev/docs/view-style-props ; /text-style-props (borderWidth+borderColor, fontFamily, fontSize)
- **R22**: Compose Material icons core vs extended - developer.android.com/reference/kotlin/androidx/compose/material/icons/Icons.Filled
- **R23**: Compose Slider steps - developer.android.com/develop/ui/compose/components/slider (steps = discrete values BETWEEN the endpoints)
- **R24**: React Native Text - reactnative.dev/docs/text (style inheritance limited to Text subtrees; View style does not cascade)
- **R25**: MDN landmark roles - .../Reference/Roles/landmark_role ("header" is not an ARIA role; role="banner" is)
- **R26**: MDN img role - .../Reference/Roles/img_role (accessible name required)
- **R27**: Coil AsyncImage - coil-kt.github.io/coil/compose/ (separate coil-compose dependency)

### Full links used in the audit report

- R1: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live
- R2: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role and https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
- R3: https://reactnative.dev/docs/accessibility
- R4: https://developer.android.com/reference/kotlin/androidx/compose/ui/semantics/LiveRegionMode and https://developer.android.com/develop/ui/compose/accessibility/semantics
- R5: https://developer.apple.com/documentation/swiftui/accessibilitytraits and https://developer.apple.com/documentation/swiftui/accessibilitytraits/updatesfrequently
- R5b: https://developer.apple.com/documentation/accessibility/accessibilitynotification/announcement
- R6: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-orientation
- R7: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/heading_role and https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-level
- R8: https://developer.apple.com/documentation/swiftui/view/accessibilityheading(_:)
- R9: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/checkbox
- R10: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/password
- R11: https://reactnative.dev/docs/textinput
- R12: https://developer.apple.com/documentation/swiftui/securefield
- R13: https://developer.android.com/reference/kotlin/androidx/compose/foundation/text/KeyboardOptions
- R14: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat
- R15: https://developer.apple.com/documentation/foundation/numberformatter/roundingmode-swift.enum
- R16: https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/math/RoundingMode.html and https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/text/DecimalFormat.html
- R17: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
- R18: https://developer.apple.com/documentation/foundation/dateformatter/style
- R19: https://docs.oracle.com/javase/8/docs/api/java/text/DateFormat.html
- R20: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/gap, https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-color and https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-style
- R21: https://reactnative.dev/docs/view-style-props and https://reactnative.dev/docs/text-style-props
- R22: https://developer.android.com/reference/kotlin/androidx/compose/material/icons/Icons.Filled
- R23: https://developer.android.com/develop/ui/compose/components/slider
- R24: https://reactnative.dev/docs/text
- R25: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/landmark_role
- R26: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/img_role
- R27: https://coil-kt.github.io/coil/compose/

## Files in this directory

- [F-28-full-table.md](F-28-full-table.md): all 612 rows (construct x value x adapter) with emitted fragment, expected value, verdict, severity, confidence, references, the gate that caught it and a note.
- [F-28-non-correct-rows.md](F-28-non-correct-rows.md): the 178 non-CORRECT rows, aggregated (react, vue and svelte shown as "web"), A11Y first.
- [F-28-compile-script.mjs.txt](F-28-compile-script.mjs.txt): the script that compiled the table rows. By its own header comments, it takes the emitted fragments and gate results from a `results.json` produced by the probe run (real generators and real gates, in a scratch tree) and combines them with expected values hand-authored from platform documentation (its `REFS` map). It is kept for reference with a `.txt` extension so no gate treats it as code; it cannot be run from this repository because the `results.json` it reads and the probe harness that produced it were scratch files and are not included.
