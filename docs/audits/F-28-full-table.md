# F-28 enum-value lowering audit - full table (612 rows)

Generated from 101 probes on the real generators/gates in a scratch tree outside the repo. "Expected" is hand-authored from platform docs, never from adapter code. conf: P = primary doc text read, E = official-page excerpt via search, N = not individually confirmed.


### a11y.value:live = off

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div aria-live="off">` | aria-live="off" | CORRECT | - | E | R1 | - |  |
| vue | `<div aria-live="off">` | aria-live="off" | CORRECT | - | E | R1 | - |  |
| svelte | `<div aria-live="off">` | aria-live="off" | CORRECT | - | E | R1 | - |  |
| react-native | `<View accessible accessibilityLiveRegion="polite">` | accessibilityLiveRegion="none" (Android) / no live announcement | DEFECT | A11Y | E | R3 | - | F-28: off emitted as polite |
| swiftui | `.accessibilityAddTraits(.updatesFrequently)` | no live-region trait (SwiftUI has no declarative live region; updatesFrequently means "frequently updates", i.e. a different thing) | DEFECT | A11Y | P | R5 | - | F-28: off emits the same trait as every other value |
| compose | `Column(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {` | liveRegion omitted (LiveRegionMode has only Polite and Assertive; default = none) | DEFECT | A11Y | E | R4 | - | F-28: off emitted as Polite |

### a11y.value:live = polite

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div aria-live="polite">` | aria-live="polite" | CORRECT | - | E | R1 | - |  |
| vue | `<div aria-live="polite">` | aria-live="polite" | CORRECT | - | E | R1 | - |  |
| svelte | `<div aria-live="polite">` | aria-live="polite" | CORRECT | - | E | R1 | - |  |
| react-native | `<View accessible accessibilityLiveRegion="polite">` | accessibilityLiveRegion="polite" (Android only; iOS behaviour UNVERIFIED) | CORRECT | - | E | R3 | - | iOS: docs say accessibilityLiveRegion is Android-only |
| swiftui | `.accessibilityAddTraits(.updatesFrequently)` | no declarative polite live region exists; imperative AccessibilityNotification.Announcement(...).post() (iOS 17+) | UNDECLARED-DEGRADATION | A11Y | P | R5,R5b | - | ledger records a11y.live=polite as EXPRESSED; also COLLAPSED with off/assertive |
| compose | `Column(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {` | LiveRegionMode.Polite | CORRECT | - | E | R4 | - |  |

### a11y.value:live = assertive

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div aria-live="assertive">` | aria-live="assertive" | CORRECT | - | E | R1 | - |  |
| vue | `<div aria-live="assertive">` | aria-live="assertive" | CORRECT | - | E | R1 | - |  |
| svelte | `<div aria-live="assertive">` | aria-live="assertive" | CORRECT | - | E | R1 | - |  |
| react-native | `<View accessible accessibilityLiveRegion="assertive">` | accessibilityLiveRegion="assertive" (Android only; iOS UNVERIFIED) | CORRECT | - | E | R3 | - | iOS: docs say accessibilityLiveRegion is Android-only |
| swiftui | `.accessibilityAddTraits(.updatesFrequently)` | imperative AccessibilityNotification.Announcement with accessibilitySpeechAnnouncementPriority = .high (iOS 17+); no declarative equivalent | UNDECLARED-DEGRADATION | A11Y | P | R5,R5b | - | known case; ledger records it as EXPRESSED; COLLAPSED with polite/off |
| compose | `Column(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) {` | LiveRegionMode.Assertive | CORRECT | - | E | R4 | - |  |

### element.field:role = alert

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="alert">` | role="alert" (implicit aria-live assertive) | CORRECT | - | E | R2 | - |  |
| vue | `<div role="alert">` | role="alert" (implicit aria-live assertive) | CORRECT | - | E | R2 | - |  |
| svelte | `<div role="alert">` | role="alert" (implicit aria-live assertive) | CORRECT | - | E | R2 | - |  |
| react-native | `<View accessible accessibilityRole="alert">` | accessibilityRole="alert" | CORRECT | - | E | R3 | - |  |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "alert" (AccessibilityTraits list has none) | DECLARED-DEGRADATION | A11Y | P | R5 | - | waiver a11y-role-alert |
| compose | `(nothing emitted)` | no Compose Role for "alert" | DECLARED-DEGRADATION | A11Y | N | R4 | - | waiver a11y-role-alert |

### element.field:role = status

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="status">` | role="status" (implicit aria-live polite) | CORRECT | - | E | R2 | - |  |
| vue | `<div role="status">` | role="status" (implicit aria-live polite) | CORRECT | - | E | R2 | - |  |
| svelte | `<div role="status">` | role="status" (implicit aria-live polite) | CORRECT | - | E | R2 | - |  |
| react-native | `(nothing emitted)` | a role for "status" | DECLARED-DEGRADATION | A11Y | N | R3 | - | waiver a11y-role-status |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "status" (AccessibilityTraits list has none) | DECLARED-DEGRADATION | A11Y | P | R5 | - | waiver a11y-role-status |
| compose | `(nothing emitted)` | no Compose Role for "status" | DECLARED-DEGRADATION | A11Y | N | R4 | - | waiver a11y-role-status |

### element.field:role = group

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="group">` | role="group" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="group">` | role="group" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="group">` | role="group" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "group" | DECLARED-DEGRADATION | A11Y | N | R3 | - | waiver a11y-role-group |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "group" (AccessibilityTraits list has none) | DECLARED-DEGRADATION | A11Y | P | R5 | - | waiver a11y-role-group |
| compose | `(nothing emitted)` | no Compose Role for "group" | DECLARED-DEGRADATION | A11Y | N | R4 | - | waiver a11y-role-group |

### element.field:role = list

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="list">` | role="list" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="list">` | role="list" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="list">` | role="list" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "list" (avoidable: the `role` prop supports list) | DECLARED-DEGRADATION | A11Y | E | R3 | - | waiver a11y-role-list; avoidable: the `role` prop supports list so the waiver reason may be stale |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "list" (AccessibilityTraits list has none) | DECLARED-DEGRADATION | A11Y | P | R5 | - | waiver a11y-role-list |
| compose | `(nothing emitted)` | no Compose Role for "list" | DECLARED-DEGRADATION | A11Y | N | R4 | - | waiver a11y-role-list |

### element.field:role = listitem

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="listitem">` | role="listitem" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="listitem">` | role="listitem" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="listitem">` | role="listitem" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "listitem" (avoidable: the `role` prop supports listitem) | DECLARED-DEGRADATION | A11Y | E | R3 | - | waiver a11y-role-listitem; avoidable: the `role` prop supports listitem so the waiver reason may be stale |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "listitem" (AccessibilityTraits list has none) | DECLARED-DEGRADATION | A11Y | P | R5 | - | waiver a11y-role-listitem |
| compose | `(nothing emitted)` | no Compose Role for "listitem" | DECLARED-DEGRADATION | A11Y | N | R4 | - | waiver a11y-role-listitem |

### element.field:role = separator

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="separator">` | role="separator" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="separator">` | role="separator" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="separator">` | role="separator" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "separator" | DECLARED-DEGRADATION | A11Y | N | R3 | - | waiver a11y-role-separator |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "separator" (AccessibilityTraits list has none) | DECLARED-DEGRADATION | A11Y | P | R5 | - | waiver a11y-role-separator |
| compose | `(nothing emitted)` | no Compose Role for "separator" | DECLARED-DEGRADATION | A11Y | N | R4 | - | waiver a11y-role-separator |

### element.field:role = presentation

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="presentation">` | role="presentation" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="presentation">` | role="presentation" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="presentation">` | role="presentation" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<View accessible accessibilityRole="none">` | accessibilityRole="none" | CORRECT | - | E | R3 | - |  |
| swiftui | `(nothing emitted)` | no trait (decorative default) | CORRECT | - | N | R5 | - |  |
| compose | `(nothing emitted)` | no semantics role (decorative default) | CORRECT | - | N | R4 | - |  |

### element.field:role = none

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="none">` | role="none" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="none">` | role="none" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="none">` | role="none" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<View accessible accessibilityRole="none">` | accessibilityRole="none" | CORRECT | - | E | R3 | - |  |
| swiftui | `(nothing emitted)` | no trait (decorative default) | CORRECT | - | N | R5 | - |  |
| compose | `(nothing emitted)` | no semantics role (decorative default) | CORRECT | - | N | R4 | - |  |

### element.field:role = dialog

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="dialog">` | role="dialog" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="dialog">` | role="dialog" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="dialog">` | role="dialog" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "dialog" | SILENT-DROP | A11Y | N | R3 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "dialog" | SILENT-DROP | A11Y | P | R5 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| compose | `(nothing emitted)` | no Compose Role for "dialog" | SILENT-DROP | A11Y | N | R4 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |

### element.field:role = table

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="table">` | role="table" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="table">` | role="table" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="table">` | role="table" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "table" | SILENT-DROP | A11Y | N | R3 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "table" | SILENT-DROP | A11Y | P | R5 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| compose | `(nothing emitted)` | no Compose Role for "table" | SILENT-DROP | A11Y | N | R4 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |

### element.field:role = tab

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="tab">` | role="tab" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="tab">` | role="tab" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="tab">` | role="tab" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "tab" (avoidable: the `role` prop supports tab) | SILENT-DROP | A11Y | E | R3 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it); avoidable: the `role` prop supports tab |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "tab" | SILENT-DROP | A11Y | P | R5 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| compose | `Column(modifier = Modifier.semantics { role = Role.Tab }) {` | role = Role.Tab | CORRECT | - | N | R4 | - |  |

### element.field:role = navigation

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="navigation">` | role="navigation" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="navigation">` | role="navigation" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="navigation">` | role="navigation" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | a role for "navigation" | SILENT-DROP | A11Y | N | R3 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| swiftui | `(nothing emitted)` | no SwiftUI trait exists for "navigation" | SILENT-DROP | A11Y | P | R5 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |
| compose | `(nothing emitted)` | no Compose Role for "navigation" | SILENT-DROP | A11Y | N | R4 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |

### element.field:role = heading

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="heading">` | role="heading" REQUIRES aria-level (browser fallback 2); native <h1>-<h6> preferred | DEFECT | A11Y | E | R7 | - | no aria-level emitted |
| vue | `<div role="heading">` | role="heading" REQUIRES aria-level (browser fallback 2); native <h1>-<h6> preferred | DEFECT | A11Y | E | R7 | - | no aria-level emitted |
| svelte | `<div role="heading">` | role="heading" REQUIRES aria-level (browser fallback 2); native <h1>-<h6> preferred | DEFECT | A11Y | E | R7 | - | no aria-level emitted |
| react-native | `(nothing emitted)` | a role for "heading" (avoidable: accessibilityRole="header" exists) | SILENT-DROP | A11Y | E | R3 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it); avoidable: accessibilityRole="header" exists |
| swiftui | `(nothing emitted)` | .accessibilityAddTraits(.isHeader) (+ .accessibilityHeading level) | SILENT-DROP | A11Y | P | R5,R8 | ledger | avoidable: ARIA role "heading" is not in the adapter table (it keys the non-ARIA "header"); ledger-diverged FAILS (no waiver) |
| compose | `(nothing emitted)` | Modifier.semantics { heading() } | SILENT-DROP | A11Y | E | R4 | ledger | avoidable: heading() exists; ledger-diverged FAILS (no waiver) |

### element.field:role = header

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="header">` | "header" is not an ARIA role (use banner); the role is ignored | DEFECT | A11Y | E | R25 | - | invalid role value emitted verbatim |
| vue | `<div role="header">` | "header" is not an ARIA role (use banner); the role is ignored | DEFECT | A11Y | E | R25 | - | invalid role value emitted verbatim |
| svelte | `<div role="header">` | "header" is not an ARIA role (use banner); the role is ignored | DEFECT | A11Y | E | R25 | - | invalid role value emitted verbatim |
| react-native | `<View accessible accessibilityRole="header">` | accessibilityRole="header" (non-ARIA alias accepted) | CORRECT | - | E | R3 | - |  |
| swiftui | `.accessibilityAddTraits(.isHeader)` | .accessibilityAddTraits(.isHeader) | CORRECT | - | P | R5 | - | accepts the non-ARIA alias |
| compose | `(nothing emitted)` | Modifier.semantics { heading() } | SILENT-DROP | A11Y | E | R4 | ledger | avoidable: heading() exists; ledger-diverged FAILS (no waiver) |

### element.field:role = img

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="img">` | role="img" (needs an accessible name via aria-label/labelledby) | CORRECT | - | E | R26 | - | spec-level: probe has no a11y.label |
| vue | `<div role="img">` | role="img" (needs an accessible name via aria-label/labelledby) | CORRECT | - | E | R26 | - | spec-level: probe has no a11y.label |
| svelte | `<div role="img">` | role="img" (needs an accessible name via aria-label/labelledby) | CORRECT | - | E | R26 | - | spec-level: probe has no a11y.label |
| react-native | `<View accessible accessibilityRole="image">` | accessibilityRole="image" | CORRECT | - | N | R3 | - |  |
| swiftui | `.accessibilityAddTraits(.isImage)` | .accessibilityAddTraits(.isImage) | CORRECT | - | P | R5 | - |  |
| compose | `Column(modifier = Modifier.semantics { role = Role.Image }) {` | Modifier.semantics { role = Role.Image } | CORRECT | - | E | R4 | - |  |

### element.field:role = button

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="button">` | role="button" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="button">` | role="button" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="button">` | role="button" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<View accessible accessibilityRole="button">` | accessibilityRole="button" | CORRECT | - | N | R3 | - |  |
| swiftui | `.accessibilityAddTraits(.isButton)` | .accessibilityAddTraits(.isButton) | CORRECT | - | P | R5 | - |  |
| compose | `Column(modifier = Modifier.semantics { role = Role.Button }) {` | role = Role.Button | CORRECT | - | E | R4 | - |  |

### element.field:role = link

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="link">` | role="link" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div role="link">` | role="link" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div role="link">` | role="link" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<View accessible accessibilityRole="link">` | accessibilityRole="link" | CORRECT | - | N | R3 | - |  |
| swiftui | `.accessibilityAddTraits(.isLink)` | .accessibilityAddTraits(.isLink) | CORRECT | - | P | R5 | - |  |
| compose | `(nothing emitted)` | no Compose Role for "link" | SILENT-DROP | A11Y | N | R4 | ledger | no waiver exists: ledger-diverged FAILS (gate catches it) |

### element.field:role = checkbox

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="proberolec14-on" type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} role="checkbox" aria-label="x" />` | role="checkbox" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<input id="proberolec14-on" type="checkbox" :checked="on" @change="onChange(($event.target as HTMLInputElement).checked)" role="checkbox" aria-labe…` | role="checkbox" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<input id="proberolec14-on" type="checkbox" checked={on} on:change={(e) => onChange(e.currentTarget.checked)} role="checkbox" aria-label="x" />` | role="checkbox" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<Switch value={on} onValueChange={onChange} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={"x"} />` | accessibilityRole="checkbox" (+state) | CORRECT | - | E | R3 | - |  |
| swiftui | `(nothing emitted)` | Toggle (conveys on/off) | CORRECT | - | N | R5 | - |  |
| compose | `Checkbox(checked = on, onCheckedChange = onChange, modifier = Modifier.semantics { role = Role.Checkbox })` | Checkbox + Role.Checkbox | CORRECT | - | E | R4 | - |  |

### element.field:role = switch

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="proberolec16-on" type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} role="switch" aria-label="x" />` | role="switch" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<input id="proberolec16-on" type="checkbox" :checked="on" @change="onChange(($event.target as HTMLInputElement).checked)" role="switch" aria-label=…` | role="switch" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<input id="proberolec16-on" type="checkbox" checked={on} on:change={(e) => onChange(e.currentTarget.checked)} role="switch" aria-label="x" />` | role="switch" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<Switch value={on} onValueChange={onChange} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={"x"} />` | accessibilityRole="switch" (+state) | CORRECT | - | E | R3 | - |  |
| swiftui | `(nothing emitted)` | Toggle (conveys on/off) | CORRECT | - | N | R5 | - |  |
| compose | `Switch(checked = on, onCheckedChange = onChange, modifier = Modifier.semantics { role = Role.Switch })` | Switch + Role.Switch | CORRECT | - | E | R4 | - |  |

### element.field:role = slider

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="proberolec18-v" type="range" value={v} onChange={(e) => onChange(Number(e.target.value))} min={0} max={10} step={1} role="slider" aria-l…` | role="slider" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<input id="proberolec18-v" type="range" :value="v" @input="onChange(Number(($event.target as HTMLInputElement).value))" :min="0" :max="10" :step="1…` | role="slider" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<input id="proberolec18-v" type="range" value={v} on:input={(e) => onChange(Number(e.currentTarget.value))} min={0} max={10} step={1} role="slider"…` | role="slider" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `(nothing emitted)` | accessibilityRole="adjustable" (+value) | CORRECT | - | N | R3 | - |  |
| swiftui | `(nothing emitted)` | Slider (conveys adjustable) | CORRECT | - | N | R5 | - |  |
| compose | `(nothing emitted)` | Slider (progressBarRangeInfo) | CORRECT | - | N | R4 | - |  |

### element.field:role = radiogroup

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div id="proberolec1a-sel" role="radiogroup" aria-label="x"> ⏎ <label key={opt.value}> ⏎ <input type="radio" name="proberolec1a-sel" value={opt.val…` | role="radiogroup" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| vue | `<div id="proberolec1a-sel" role="radiogroup" aria-label="x"> ⏎ <label v-for="opt in opts" :key="opt.value"> ⏎ <input type="radio" name="proberolec1…` | role="radiogroup" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| svelte | `<div id="proberolec1a-sel" role="radiogroup" aria-label="x"> ⏎ <label> ⏎ <input type="radio" name="proberolec1a-sel" value={opt.value} checked={sel…` | role="radiogroup" (valid ARIA role) | CORRECT | - | N | MDN ARIA roles index | - |  |
| react-native | `<View accessibilityRole="radiogroup" accessibilityLabel={"x"}> ⏎ <Pressable key={opt.value} accessibilityRole="radio" accessibilityState={{ selecte…` | accessibilityRole="radiogroup" | CORRECT | - | N | R3 | - |  |
| swiftui | `(nothing emitted)` | Picker (single select) | CORRECT | - | N | R5 | - |  |
| compose | `(nothing emitted)` | RadioButton group (selectableGroup) | CORRECT | - | N | R4 | - |  |

### element.field:level = 1

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h1>Title</h1>` | <h1> (heading level 1) | CORRECT | - | E | R7 | - |  |
| vue | `<h1>Title</h1>` | <h1> (heading level 1) | CORRECT | - | E | R7 | - |  |
| svelte | `<h1>Title</h1>` | <h1> (heading level 1) | CORRECT | - | E | R7 | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | a heading with level 1 (RN accessibilityRole="header" carries no level; level support UNVERIFIED) | COLLAPSED | A11Y | N | R3 | - | all 6 levels emit the same role |
| swiftui | `.font(.largeTitle)` | .accessibilityAddTraits(.isHeader) + .accessibilityHeading(.h1) | SILENT-DROP | A11Y | P | R5,R8 | - | only a font size is emitted: no heading trait, no level |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Modifier.semantics { heading() } (no level concept) | COLLAPSED | A11Y | E | R4 | - | every level -> titleMedium (visual collapse) and NO heading() (semantic drop) |

### element.field:level = 2

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h2>Title</h2>` | <h2> (heading level 2) | CORRECT | - | E | R7 | - |  |
| vue | `<h2>Title</h2>` | <h2> (heading level 2) | CORRECT | - | E | R7 | - |  |
| svelte | `<h2>Title</h2>` | <h2> (heading level 2) | CORRECT | - | E | R7 | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | a heading with level 2 (RN accessibilityRole="header" carries no level; level support UNVERIFIED) | COLLAPSED | A11Y | N | R3 | - | all 6 levels emit the same role |
| swiftui | `.font(.title)` | .accessibilityAddTraits(.isHeader) + .accessibilityHeading(.h2) | SILENT-DROP | A11Y | P | R5,R8 | - | only a font size is emitted: no heading trait, no level |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Modifier.semantics { heading() } (no level concept) | COLLAPSED | A11Y | E | R4 | - | every level -> titleMedium (visual collapse) and NO heading() (semantic drop) |

### element.field:level = 3

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h3>Title</h3>` | <h3> (heading level 3) | CORRECT | - | E | R7 | - |  |
| vue | `<h3>Title</h3>` | <h3> (heading level 3) | CORRECT | - | E | R7 | - |  |
| svelte | `<h3>Title</h3>` | <h3> (heading level 3) | CORRECT | - | E | R7 | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | a heading with level 3 (RN accessibilityRole="header" carries no level; level support UNVERIFIED) | COLLAPSED | A11Y | N | R3 | - | all 6 levels emit the same role |
| swiftui | `.font(.title2)` | .accessibilityAddTraits(.isHeader) + .accessibilityHeading(.h3) | SILENT-DROP | A11Y | P | R5,R8 | - | only a font size is emitted: no heading trait, no level |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Modifier.semantics { heading() } (no level concept) | COLLAPSED | A11Y | E | R4 | - | every level -> titleMedium (visual collapse) and NO heading() (semantic drop) |

### element.field:level = 4

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h4>Title</h4>` | <h4> (heading level 4) | CORRECT | - | E | R7 | - |  |
| vue | `<h4>Title</h4>` | <h4> (heading level 4) | CORRECT | - | E | R7 | - |  |
| svelte | `<h4>Title</h4>` | <h4> (heading level 4) | CORRECT | - | E | R7 | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | a heading with level 4 (RN accessibilityRole="header" carries no level; level support UNVERIFIED) | COLLAPSED | A11Y | N | R3 | - | all 6 levels emit the same role |
| swiftui | `.font(.title3)` | .accessibilityAddTraits(.isHeader) + .accessibilityHeading(.h4) | SILENT-DROP | A11Y | P | R5,R8 | - | only a font size is emitted: no heading trait, no level |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Modifier.semantics { heading() } (no level concept) | COLLAPSED | A11Y | E | R4 | - | every level -> titleMedium (visual collapse) and NO heading() (semantic drop) |

### element.field:level = 5

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h5>Title</h5>` | <h5> (heading level 5) | CORRECT | - | E | R7 | - |  |
| vue | `<h5>Title</h5>` | <h5> (heading level 5) | CORRECT | - | E | R7 | - |  |
| svelte | `<h5>Title</h5>` | <h5> (heading level 5) | CORRECT | - | E | R7 | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | a heading with level 5 (RN accessibilityRole="header" carries no level; level support UNVERIFIED) | COLLAPSED | A11Y | N | R3 | - | all 6 levels emit the same role |
| swiftui | `.font(.headline)` | .accessibilityAddTraits(.isHeader) + .accessibilityHeading(.h5) | SILENT-DROP | A11Y | P | R5,R8 | - | only a font size is emitted: no heading trait, no level |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Modifier.semantics { heading() } (no level concept) | COLLAPSED | A11Y | E | R4 | - | every level -> titleMedium (visual collapse) and NO heading() (semantic drop) |

### element.field:level = 6

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h6>Title</h6>` | <h6> (heading level 6) | CORRECT | - | E | R7 | - |  |
| vue | `<h6>Title</h6>` | <h6> (heading level 6) | CORRECT | - | E | R7 | - |  |
| svelte | `<h6>Title</h6>` | <h6> (heading level 6) | CORRECT | - | E | R7 | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | a heading with level 6 (RN accessibilityRole="header" carries no level; level support UNVERIFIED) | COLLAPSED | A11Y | N | R3 | - | all 6 levels emit the same role |
| swiftui | `.font(.subheadline)` | .accessibilityAddTraits(.isHeader) + .accessibilityHeading(.h6) | SILENT-DROP | A11Y | P | R5,R8 | - | only a font size is emitted: no heading trait, no level |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Modifier.semantics { heading() } (no level concept) | COLLAPSED | A11Y | E | R4 | - | every level -> titleMedium (visual collapse) and NO heading() (semantic drop) |

### element.value:orientation = horizontal

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div aria-orientation="horizontal" style={{ display: 'flex', flexDirection: 'row' }}>` | no aria-orientation on a role-less element; the layout axis alone (flex-direction:row) carries it | DEFECT | A11Y | E | R6 | - | aria-orientation is only supported on scrollbar/select/separator/slider/tablist/toolbar; emitted on a generic div |
| vue | `<div aria-orientation="horizontal" style="display: flex; flex-direction: row">` | no aria-orientation on a role-less element; the layout axis alone (flex-direction:row) carries it | DEFECT | A11Y | E | R6 | - | aria-orientation is only supported on scrollbar/select/separator/slider/tablist/toolbar; emitted on a generic div |
| svelte | `<div aria-orientation="horizontal" style="display: flex; flex-direction: row">` | no aria-orientation on a role-less element; the layout axis alone (flex-direction:row) carries it | DEFECT | A11Y | E | R6 | - | aria-orientation is only supported on scrollbar/select/separator/slider/tablist/toolbar; emitted on a generic div |
| react-native | `<View accessible style={{ flexDirection: "row" }}>` | flexDirection:"row" | CORRECT | - | N | R21 | - |  |
| swiftui | `HStack(alignment: .center, spacing: 8) {` | HStack | CORRECT | - | N | Apple HStack/VStack | - |  |
| compose | `Row() {` | Row | CORRECT | - | N | Compose Row/Column | - |  |

### element.value:orientation (with role=separator) = horizontal

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="separator" aria-orientation="horizontal">` | aria-orientation="horizontal" on role=separator (valid) | CORRECT | - | E | R6 | - |  |
| vue | `<div role="separator" aria-orientation="horizontal">` | aria-orientation="horizontal" on role=separator (valid) | CORRECT | - | E | R6 | - |  |
| svelte | `<div role="separator" aria-orientation="horizontal">` | aria-orientation="horizontal" on role=separator (valid) | CORRECT | - | E | R6 | - |  |
| react-native | `<View accessible style={{ flexDirection: "row" }}>` | separator role | DECLARED-DEGRADATION | A11Y | N | R3 | - | role separator waived on RN; the axis is still flexDirection |
| swiftui | `HStack(alignment: .center, spacing: 8) {` | HStack | CORRECT | - | N | Apple HStack/VStack | - |  |
| compose | `Row() {` | Row | CORRECT | - | N | Compose Row/Column | - |  |

### element.value:orientation = vertical

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div aria-orientation="vertical" style={{ display: 'flex', flexDirection: 'column' }}>` | no aria-orientation on a role-less element; the layout axis alone (flex-direction:column) carries it | DEFECT | A11Y | E | R6 | - | aria-orientation is only supported on scrollbar/select/separator/slider/tablist/toolbar; emitted on a generic div |
| vue | `<div aria-orientation="vertical" style="display: flex; flex-direction: column">` | no aria-orientation on a role-less element; the layout axis alone (flex-direction:column) carries it | DEFECT | A11Y | E | R6 | - | aria-orientation is only supported on scrollbar/select/separator/slider/tablist/toolbar; emitted on a generic div |
| svelte | `<div aria-orientation="vertical" style="display: flex; flex-direction: column">` | no aria-orientation on a role-less element; the layout axis alone (flex-direction:column) carries it | DEFECT | A11Y | E | R6 | - | aria-orientation is only supported on scrollbar/select/separator/slider/tablist/toolbar; emitted on a generic div |
| react-native | `<View accessible style={{ flexDirection: "column" }}>` | flexDirection:"column" | CORRECT | - | N | R21 | - |  |
| swiftui | `(nothing emitted)` | VStack (default) | CORRECT | - | N | Apple HStack/VStack | - |  |
| compose | `(nothing emitted)` | Column (default) | CORRECT | - | N | Compose Row/Column | - |  |

### element.value:orientation (with role=separator) = vertical

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div role="separator" aria-orientation="vertical">` | aria-orientation="vertical" on role=separator (valid) | CORRECT | - | E | R6 | - |  |
| vue | `<div role="separator" aria-orientation="vertical">` | aria-orientation="vertical" on role=separator (valid) | CORRECT | - | E | R6 | - |  |
| svelte | `<div role="separator" aria-orientation="vertical">` | aria-orientation="vertical" on role=separator (valid) | CORRECT | - | E | R6 | - |  |
| react-native | `<View accessible style={{ flexDirection: "column" }}>` | separator role | DECLARED-DEGRADATION | A11Y | N | R3 | - | role separator waived on RN; the axis is still flexDirection |
| swiftui | `(nothing emitted)` | VStack (default) | CORRECT | - | N | Apple HStack/VStack | - |  |
| compose | `(nothing emitted)` | Column (default) | CORRECT | - | N | Compose Row/Column | - |  |

### el-kind = container

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>hello</span>` | <div> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<span>hello</span>` | <div> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<span>hello</span>` | <div> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `<Text>hello</Text>` | <View> | CORRECT | - | N | RN components | - |  |
| swiftui | `Text("hello")` | VStack | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `Text(text = "hello")` | Column | CORRECT | - | N | Compose components | - |  |

### el-kind = media

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<img src="https://example.com/a.png" alt="pic" />` | <img src alt> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<img src="https://example.com/a.png" alt="pic" />` | <img src alt> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<img src="https://example.com/a.png" alt="pic" />` | <img src alt> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `<Image source={{ uri: "https://example.com/a.png" }} accessibilityLabel={"pic"} />` | <Image source accessibilityLabel> | CORRECT | - | N | RN components | - |  |
| swiftui | `AsyncImage(url: URL(string: "https://example.com/a.png"))` | AsyncImage + accessibilityLabel | SILENT-DROP | A11Y | N | R5 | - | spec `alt` is dropped: no .accessibilityLabel emitted; a11y-guard img-alt only checks the IR has alt |
| compose | `AsyncImage(model = "https://example.com/a.png", contentDescription = "pic")` | AsyncImage(model, contentDescription) [needs coil-compose] | CORRECT | - | E | R27 | - | requires coil-compose; not documented in the repo |

### el-kind = heading

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<h2>Title</h2>` | <h2> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<h2>Title</h2>` | <h2> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<h2>Title</h2>` | <h2> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `<Text accessibilityRole="header">Title</Text>` | Text accessibilityRole=header | CORRECT | - | N | RN components | - |  |
| swiftui | `Text("Title") ⏎ .font(.title)` | Text + .isHeader | SILENT-DROP | A11Y | P | R5,R8 | - | see heading-level rows |
| compose | `Text(text = "Title", style = MaterialTheme.typography.titleMedium)` | Text + heading() | SILENT-DROP | A11Y | E | R4 | - | see heading-level rows |

### el-kind = text

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>hello</span>` | <span> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<span>hello</span>` | <span> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<span>hello</span>` | <span> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `<Text>hello</Text>` | <Text> | CORRECT | - | N | RN components | - |  |
| swiftui | `Text("hello")` | Text | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `Text(text = "hello")` | Text | CORRECT | - | N | Compose components | - |  |

### el-kind = action

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `onGo: () => void; ⏎ <button type="button" onClick={onGo}>Go</button>` | <button> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `onGo: () => void ⏎ <button type="button" @click="onGo">Go</button>` | <button> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `export let onGo: () => void; ⏎ <button type="button" on:click={onGo}>Go</button>` | <button> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `onGo: () => void; ⏎ <Pressable accessibilityRole="button" onPress={onGo}> ⏎ <Text>Go</Text> ⏎ </Pressable>` | Pressable role=button | CORRECT | - | N | RN components | - |  |
| swiftui | `let onGo: () -> Void ⏎ Button(action: onGo) { ⏎ Text("Go")` | Button | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `onGo: () -> Unit ⏎ Button(onClick = onGo) { ⏎ Text("Go")` | Button | CORRECT | - | N | Compose components | - |  |

### el-kind = link

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<a href="https://example.com">Docs</a>` | <a href> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<a href="https://example.com">Docs</a>` | <a href> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<a href="https://example.com">Docs</a>` | <a href> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `<Pressable accessibilityRole="link" onPress={() => Linking.openURL("https://example.com")}> ⏎ <Text>Docs</Text> ⏎ </Pressable>` | Pressable role=link + Linking.openURL | CORRECT | - | N | RN components | - |  |
| swiftui | `Link("Docs", destination: URL(string: "https://example.com")!)` | Link(destination:) | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `val uriHandler = LocalUriHandler.current ⏎ Text(text = "Docs", modifier = Modifier.clickable { uriHandler.openUri("https://example.com") })` | clickable + uriHandler.openUri | CORRECT | - | N | Compose components | - |  |

### el-kind = input

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `v: string; ⏎ onChange: (value: string) => void; ⏎ <input id="probeel28-v" type="text" value={v} onChange={(e) => onChange(e.target.value)} aria-lab…` | <input type=text> | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `v: string; ⏎ onChange: (value: string) => void ⏎ <input id="probeel28-v" type="text" :value="v" @input="onChange(($event.target as HTMLInputElement…` | <input type=text> | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `export let v: string; ⏎ export let onChange: (value: string) => void; ⏎ <input id="probeel28-v" type="text" value={v} on:input={(e) => onChange((e.…` | <input type=text> | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `v: string; ⏎ onChange: (value: string) => void; ⏎ <TextInput value={v} onChangeText={onChange} accessibilityLabel={"Name"} />` | <TextInput> | CORRECT | - | N | RN components | - |  |
| swiftui | `let v: String ⏎ let onChange: (String) -> Void ⏎ TextField("Name", text: Binding(get: { v }, set: { onChange($0) }))` | TextField | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `v: String, ⏎ onChange: (String) -> Unit ⏎ TextField(value = v, onValueChange = onChange, label = { Text("Name") })` | TextField | CORRECT | - | N | Compose components | - |  |

### el-kind = slot

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `{children}` | children slot | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<slot />` | children slot | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<slot />` | children slot | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `{children}` | {children} | CORRECT | - | N | RN components | - |  |
| swiftui | `content` | content | CORRECT | - | N | Apple SwiftUI views | - | named slot collapses to the unnamed content (known, PR C) |
| compose | `content()` | content() | CORRECT | - | N | Compose components | - | named slot collapses to the unnamed content (known, PR C) |

### el-kind = icon

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<Star aria-hidden="true" />` | decorative icon (aria-hidden) | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `<Star aria-hidden="true" />` | decorative icon (aria-hidden) | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `<svelte:component this={Star} aria-hidden="true" />` | decorative icon (aria-hidden) | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `<Star accessible={false} />` | icon, accessible=false | CORRECT | - | N | RN components | - |  |
| swiftui | `Image(systemName: "star") ⏎ .accessibilityHidden(true)` | Image(systemName:) hidden | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `Icon(Icons.Default.Star, contentDescription = null)` | Icon(contentDescription = null) | CORRECT | - | N | Compose components | - |  |

### el-kind = conditional

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `flag: boolean; ⏎ {flag ? ( ⏎ <span>yes</span> ⏎ ) : ( ⏎ <span>no</span> ⏎ )}` | if/else | CORRECT | - | N | MDN HTML elements | - |  |
| vue | `flag: boolean ⏎ <template v-if="flag"> ⏎ <span>yes</span> ⏎ <template v-else> ⏎ <span>no</span>` | if/else | CORRECT | - | N | MDN HTML elements | - |  |
| svelte | `export let flag: boolean; ⏎ {#if flag} ⏎ <span>yes</span> ⏎ {:else} ⏎ <span>no</span> ⏎ {/if}` | if/else | CORRECT | - | N | MDN HTML elements | - |  |
| react-native | `flag: boolean; ⏎ {flag ? ( ⏎ <Text>yes</Text> ⏎ ) : ( ⏎ <Text>no</Text> ⏎ )}` | ternary | CORRECT | - | N | RN components | - |  |
| swiftui | `let flag: Bool ⏎ if flag { ⏎ Text("yes") ⏎ } else { ⏎ Text("no")` | if/else | CORRECT | - | N | Apple SwiftUI views | - |  |
| compose | `flag: Boolean ⏎ if (flag) { ⏎ Text(text = "yes") ⏎ } else { ⏎ Text(text = "no")` | if/else | CORRECT | - | N | Compose components | - |  |

### valueRef.value:kind = literal

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>hello</span>` | literal lowered to its native construct | CORRECT | - | N | n/a | - |  |
| vue | `<span>hello</span>` | literal lowered to its native construct | CORRECT | - | N | n/a | - |  |
| svelte | `<span>hello</span>` | literal lowered to its native construct | CORRECT | - | N | n/a | - |  |
| react-native | `<Text>hello</Text>` | literal lowered to its native construct | CORRECT | - | N | n/a | - |  |
| swiftui | `Text("hello")` | literal lowered to its native construct | CORRECT | - | N | n/a | - |  |
| compose | `Text(text = "hello")` | literal lowered to its native construct | CORRECT | - | N | n/a | - |  |

### valueRef.value:kind = ref

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{label}</span>` | ref lowered to its native construct | CORRECT | - | N | n/a | - |  |
| vue | `<span>{{ label }}</span>` | ref lowered to its native construct | CORRECT | - | N | n/a | - |  |
| svelte | `<span>{label}</span>` | ref lowered to its native construct | CORRECT | - | N | n/a | - |  |
| react-native | `<Text>{label}</Text>` | ref lowered to its native construct | CORRECT | - | N | n/a | - |  |
| swiftui | `Text(String(describing: label))` | ref lowered to its native construct | CORRECT | - | N | n/a | - |  |
| compose | `Text(text = label)` | ref lowered to its native construct | CORRECT | - | N | n/a | - |  |

### valueRef.value:kind = expr

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{amount.toFixed(precision)}</span>` | amount.toFixed(precision): ties round half away from zero (measured) | CORRECT | - | E | MDN toFixed | - | tie rule MEASURED with node, not read from docs |
| vue | `<span>{{ amount.toFixed(precision) }}</span>` | amount.toFixed(precision): ties round half away from zero (measured) | CORRECT | - | E | MDN toFixed | - | tie rule MEASURED with node, not read from docs |
| svelte | `<span>{amount.toFixed(precision)}</span>` | amount.toFixed(precision): ties round half away from zero (measured) | CORRECT | - | E | MDN toFixed | - | tie rule MEASURED with node, not read from docs |
| react-native | `<Text>{amount.toFixed(precision)}</Text>` | same JS | CORRECT | - | N | JS | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.usesGroupingSeparator = false; f.minimumFractionDigits = Int(precision); f.maximumFra…` | ties round like toFixed (half away from zero) | UNVERIFIED | FUNCTIONAL | N | R15 | - | NumberFormatter built with NO rounding mode; Apple docs do not state the default (check device: format 2.5 at precision 0) |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { isGroupingUsed = false; minimumFractionDigits = precision.toInt(); maximumFractionDi…` | ties round like toFixed (half away from zero) | DEFECT | FUNCTIONAL | E | R16 | - | NumberFormat default is HALF_EVEN (docs): 0.5, 2.5, 1234.5 (p0) and 0.125 (p2) differ from web |

### valueRef.value:kind = format

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</span>` | format lowered to its native construct | CORRECT | - | N | n/a | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) }}</span>` | format lowered to its native construct | CORRECT | - | N | n/a | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</span>` | format lowered to its native construct | CORRECT | - | N | n/a | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</Text>` | format lowered to its native construct | CORRECT | - | N | n/a | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2; return f.string(from: NSNumbe…` | format lowered to its native construct | CORRECT | - | N | n/a | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(amount))` | format lowered to its native construct | CORRECT | - | N | n/a | - |  |

### valueRef.value:kind = datetime

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when)}</span>` | datetime lowered to its native construct | CORRECT | - | N | n/a | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when) }}</span>` | datetime lowered to its native construct | CORRECT | - | N | n/a | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when)}</span>` | datetime lowered to its native construct | CORRECT | - | N | n/a | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when)}</Text>` | datetime lowered to its native construct | CORRECT | - | N | n/a | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .none; return f.string(from: when) }())` | datetime lowered to its native construct | CORRECT | - | N | n/a | - |  |
| compose | `Text(text = java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(when))` | datetime lowered to its native construct | CORRECT | - | N | n/a | - |  |

### valueRef.value:kind (expr that is NOT toFixed) = expr

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{count + 1}</span>` | displays the expression result | CORRECT | - | N | JS | - |  |
| vue | `<span>{{ count + 1 }}</span>` | displays the expression result | CORRECT | - | N | JS | - |  |
| svelte | `<span>{count + 1}</span>` | displays the expression result | CORRECT | - | N | JS | - |  |
| react-native | `<Text>{count + 1}</Text>` | displays the expression result | CORRECT | - | N | JS | - |  |
| swiftui | `Text(String(describing: count))` | the value of `count + 1` | DECLARED-DEGRADATION | FUNCTIONAL | N | n/a | - | native cannot eval: simplified to the first identifier with a WARNING only (no ledger trait, no waiver); displays the wrong number |
| compose | `Text(text = count.toString())` | the value of `count + 1` | DECLARED-DEGRADATION | FUNCTIONAL | N | n/a | - | native cannot eval: simplified to the first identifier with a WARNING only (no ledger trait, no waiver) |

### numberFormat.value:style = decimal

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `(nothing emitted)` | style: "decimal" | CORRECT | - | E | R14 | - |  |
| vue | `(nothing emitted)` | style: "decimal" | CORRECT | - | E | R14 | - |  |
| svelte | `(nothing emitted)` | style: "decimal" | CORRECT | - | E | R14 | - |  |
| react-native | `(nothing emitted)` | style: "decimal" | CORRECT | - | E | R14 | - |  |
| swiftui | `(nothing emitted)` | .decimal | CORRECT | - | N | R15 | - |  |
| compose | `(nothing emitted)` | getNumberInstance | CORRECT | - | N | R16 | - |  |

### numberFormat.value:style = currency

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount)}</span>` | style: "currency" | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount) }}</span>` | style: "currency" | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount)}</span>` | style: "currency" | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount)}</Text>` | style: "currency" | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "THB"; return f.string(from: NSNumber(value: amount)) ?? String(amoun…` | .currency + currencyCode | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getCurrencyInstance().apply { currency = java.util.Currency.getInstance("THB") }.format(amount))` | getCurrencyInstance + currency | CORRECT | - | N | R16 | - |  |

### numberFormat.field:rounding = round

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "halfExpand", minimumFractionDigits: 0, maximumFractionDigits: 0 }).forma…` | roundingMode: halfExpand (away from zero on ties) | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "halfExpand", minimumFractionDigits: 0, maximumFractionDigits: 0 }).for…` | roundingMode: halfExpand (away from zero on ties) | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "halfExpand", minimumFractionDigits: 0, maximumFractionDigits: 0 }).forma…` | roundingMode: halfExpand (away from zero on ties) | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "halfExpand", minimumFractionDigits: 0, maximumFractionDigits: 0 }).forma…` | roundingMode: halfExpand (away from zero on ties) | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.roundingMode = .halfUp; f.minimumFractionDigits = 0; f.maximumFractionDigits = 0; ret…` | .halfUp ("away from zero if equidistant") | CORRECT | - | P | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { roundingMode = java.math.RoundingMode.HALF_UP; minimumFractionDigits = 0; maximumFra…` | HALF_UP ("round up" on ties; away from zero) | CORRECT | - | E | R16 | - |  |

### numberFormat.field:rounding = floor

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "floor", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amo…` | roundingMode: floor (toward -inf) | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "floor", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(a…` | roundingMode: floor (toward -inf) | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "floor", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amo…` | roundingMode: floor (toward -inf) | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "floor", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amo…` | roundingMode: floor honoured by RN's Intl (Hermes) | UNVERIFIED | FUNCTIONAL | N | R14 | - | ES2023 option; verify the RN runtime honours roundingMode (device check). Older engines ignore it silently |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.roundingMode = .floor; f.minimumFractionDigits = 0; f.maximumFractionDigits = 0; retu…` | .floor (toward -inf) | CORRECT | - | P | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { roundingMode = java.math.RoundingMode.FLOOR; minimumFractionDigits = 0; maximumFract…` | FLOOR (toward -inf) | CORRECT | - | E | R16 | - |  |

### numberFormat.field:rounding = ceil

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "ceil", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amou…` | roundingMode: ceil (toward +inf) | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "ceil", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(am…` | roundingMode: ceil (toward +inf) | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "ceil", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amou…` | roundingMode: ceil (toward +inf) | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", roundingMode: "ceil", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amou…` | roundingMode: ceil honoured by RN's Intl (Hermes) | UNVERIFIED | FUNCTIONAL | N | R14 | - | ES2023 option; verify the RN runtime honours roundingMode (device check). Older engines ignore it silently |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.roundingMode = .ceiling; f.minimumFractionDigits = 0; f.maximumFractionDigits = 0; re…` | .ceiling (toward +inf) | CORRECT | - | P | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { roundingMode = java.math.RoundingMode.CEILING; minimumFractionDigits = 0; maximumFra…` | CEILING (toward +inf) | CORRECT | - | E | R16 | - |  |

### numberFormat.field:grouping = true

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: true }).format(amount)}</span>` | useGrouping: true | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: true }).format(amount) }}</span>` | useGrouping: true | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: true }).format(amount)}</span>` | useGrouping: true | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: true }).format(amount)}</Text>` | useGrouping: true | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.usesGroupingSeparator = true; return f.string(from: NSNumber(value: amount)) ?? Strin…` | usesGroupingSeparator = true | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { isGroupingUsed = true }.format(amount))` | isGroupingUsed = true | CORRECT | - | N | R16 | - |  |

### numberFormat.field:grouping = false

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: false }).format(amount)}</span>` | useGrouping: false | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: false }).format(amount) }}</span>` | useGrouping: false | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: false }).format(amount)}</span>` | useGrouping: false | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", useGrouping: false }).format(amount)}</Text>` | useGrouping: false | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.usesGroupingSeparator = false; return f.string(from: NSNumber(value: amount)) ?? Stri…` | usesGroupingSeparator = false | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { isGroupingUsed = false }.format(amount))` | isGroupingUsed = false | CORRECT | - | N | R16 | - |  |

### numberFormat.field:precision = 0

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)}</span>` | min/maxFractionDigits: 0 | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount) }}</span>` | min/maxFractionDigits: 0 | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)}</span>` | min/maxFractionDigits: 0 | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)}</Text>` | min/maxFractionDigits: 0 | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.minimumFractionDigits = 0; f.maximumFractionDigits = 0; return f.string(from: NSNumbe…` | min/maximumFractionDigits = 0 | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { minimumFractionDigits = 0; maximumFractionDigits = 0 }.format(amount))` | min/maximumFractionDigits = 0 | CORRECT | - | N | R16 | - |  |

### numberFormat.field:precision = 2

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</span>` | min/maxFractionDigits: 2 | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) }}</span>` | min/maxFractionDigits: 2 | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</span>` | min/maxFractionDigits: 2 | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}</Text>` | min/maxFractionDigits: 2 | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2; return f.string(from: NSNumbe…` | min/maximumFractionDigits = 2 | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance().apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(amount))` | min/maximumFractionDigits = 2 | CORRECT | - | N | R16 | - |  |

### numberFormat.field:currency = THB

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount)}</span>` | currency: "THB" | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount) }}</span>` | currency: "THB" | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount)}</span>` | currency: "THB" | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat(undefined, { style: "currency", currency: "THB" }).format(amount)}</Text>` | currency: "THB" | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "THB"; return f.string(from: NSNumber(value: amount)) ?? String(amoun…` | currencyCode = "THB" | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getCurrencyInstance().apply { currency = java.util.Currency.getInstance("THB") }.format(amount))` | Currency.getInstance("THB") | CORRECT | - | N | R16 | - |  |

### numberFormat.field:locale = th-TH

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.NumberFormat("th-TH", { style: "decimal" }).format(amount)}</span>` | locale "th-TH" | CORRECT | - | E | R14 | - |  |
| vue | `<span>{{ new Intl.NumberFormat("th-TH", { style: "decimal" }).format(amount) }}</span>` | locale "th-TH" | CORRECT | - | E | R14 | - |  |
| svelte | `<span>{new Intl.NumberFormat("th-TH", { style: "decimal" }).format(amount)}</span>` | locale "th-TH" | CORRECT | - | E | R14 | - |  |
| react-native | `<Text>{new Intl.NumberFormat("th-TH", { style: "decimal" }).format(amount)}</Text>` | locale "th-TH" | CORRECT | - | E | R14 | - |  |
| swiftui | `Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "th-TH"); return f.string(from: NSNumber(value: amount)) …` | Locale(identifier: "th-TH") | CORRECT | - | N | R15 | - |  |
| compose | `Text(text = java.text.NumberFormat.getNumberInstance(java.util.Locale.forLanguageTag("th-TH")).format(amount))` | Locale.forLanguageTag("th-TH") | CORRECT | - | N | R16 | - |  |

### numberFormat.field:rounding (omitted: platform default) = (default)

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `(nothing emitted)` | default halfExpand (ties away from zero) | CORRECT | - | E | R14 | - |  |
| vue | `(nothing emitted)` | default halfExpand (ties away from zero) | CORRECT | - | E | R14 | - |  |
| svelte | `(nothing emitted)` | default halfExpand (ties away from zero) | CORRECT | - | E | R14 | - |  |
| react-native | `(nothing emitted)` | default halfExpand | CORRECT | - | E | R14 | - |  |
| swiftui | `(nothing emitted)` | same tie behaviour as web (half away from zero) | UNVERIFIED | FUNCTIONAL | N | R15 | - | no rounding mode emitted; Apple docs state no default (device check) |
| compose | `(nothing emitted)` | same tie behaviour as web (half away from zero) | DEFECT | FUNCTIONAL | E | R16 | - | no rounding mode emitted; NumberFormat default is HALF_EVEN (docs): ties differ from web |

### dateTimeFormat.value:dateStyle = short

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(when)}</span>` | dateStyle: "short" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(when) }}</span>` | dateStyle: "short" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(when)}</span>` | dateStyle: "short" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(when)}</Text>` | dateStyle: "short" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .short; f.timeStyle = .none; return f.string(from: when) }())` | dateStyle = .short | CORRECT | - | P | R18 | - | exact text is locale/OS dependent per Apple docs (cosmetic) |
| compose | `Text(text = java.text.DateFormat.getDateInstance(java.text.DateFormat.SHORT).format(when))` | DateFormat.SHORT | CORRECT | - | E | R19 | - | exact text is locale dependent (cosmetic) |

### dateTimeFormat.value:dateStyle = medium

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when)}</span>` | dateStyle: "medium" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when) }}</span>` | dateStyle: "medium" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when)}</span>` | dateStyle: "medium" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(when)}</Text>` | dateStyle: "medium" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .none; return f.string(from: when) }())` | dateStyle = .medium | CORRECT | - | P | R18 | - | exact text is locale/OS dependent per Apple docs (cosmetic) |
| compose | `Text(text = java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(when))` | DateFormat.MEDIUM | CORRECT | - | E | R19 | - | exact text is locale dependent (cosmetic) |

### dateTimeFormat.value:dateStyle = long

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(when)}</span>` | dateStyle: "long" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(when) }}</span>` | dateStyle: "long" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(when)}</span>` | dateStyle: "long" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(when)}</Text>` | dateStyle: "long" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .long; f.timeStyle = .none; return f.string(from: when) }())` | dateStyle = .long | CORRECT | - | P | R18 | - | exact text is locale/OS dependent per Apple docs (cosmetic) |
| compose | `Text(text = java.text.DateFormat.getDateInstance(java.text.DateFormat.LONG).format(when))` | DateFormat.LONG | CORRECT | - | E | R19 | - | exact text is locale dependent (cosmetic) |

### dateTimeFormat.value:timeStyle = short

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(when)}</span>` | timeStyle: "short" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(when) }}</span>` | timeStyle: "short" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(when)}</span>` | timeStyle: "short" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(when)}</Text>` | timeStyle: "short" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .short; return f.string(from: when) }())` | timeStyle = .short | CORRECT | - | P | R18 | - | exact text is locale/OS dependent per Apple docs (cosmetic) |
| compose | `Text(text = java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(when))` | DateFormat.SHORT | CORRECT | - | E | R19 | - | exact text is locale dependent (cosmetic) |

### dateTimeFormat.value:timeStyle = medium

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(when)}</span>` | timeStyle: "medium" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(when) }}</span>` | timeStyle: "medium" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(when)}</span>` | timeStyle: "medium" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(when)}</Text>` | timeStyle: "medium" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .medium; return f.string(from: when) }())` | timeStyle = .medium | CORRECT | - | P | R18 | - | exact text is locale/OS dependent per Apple docs (cosmetic) |
| compose | `Text(text = java.text.DateFormat.getTimeInstance(java.text.DateFormat.MEDIUM).format(when))` | DateFormat.MEDIUM | CORRECT | - | E | R19 | - | exact text is locale dependent (cosmetic) |

### dateTimeFormat.value:timeStyle = long

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { timeStyle: "long" }).format(when)}</span>` | timeStyle: "long" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { timeStyle: "long" }).format(when) }}</span>` | timeStyle: "long" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { timeStyle: "long" }).format(when)}</span>` | timeStyle: "long" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { timeStyle: "long" }).format(when)}</Text>` | timeStyle: "long" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .long; return f.string(from: when) }())` | timeStyle = .long | CORRECT | - | P | R18 | - | exact text is locale/OS dependent per Apple docs (cosmetic) |
| compose | `Text(text = java.text.DateFormat.getTimeInstance(java.text.DateFormat.LONG).format(when))` | DateFormat.LONG | CORRECT | - | E | R19 | - | exact text is locale dependent (cosmetic) |

### dateTimeFormat.field:locale = en-GB

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(when)}</span>` | locale "en-GB" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(when) }}</span>` | locale "en-GB" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(when)}</span>` | locale "en-GB" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(when)}</Text>` | locale "en-GB" | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.locale = Locale(identifier: "en-GB"); f.dateStyle = .medium; f.timeStyle = .none; return f.string(from: when) }())` | Locale(identifier:) | CORRECT | - | N | R18 | - |  |
| compose | `Text(text = java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM, java.util.Locale.forLanguageTag("en-GB")).format(when))` | Locale.forLanguageTag | CORRECT | - | N | R19 | - |  |

### dateTimeFormat.field:timeZone = Asia/Bangkok

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(when)}</span>` | timeZone: "Asia/Bangkok" | CORRECT | - | E | R17 | - |  |
| vue | `<span>{{ new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(when) }}</span>` | timeZone: "Asia/Bangkok" | CORRECT | - | E | R17 | - |  |
| svelte | `<span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(when)}</span>` | timeZone: "Asia/Bangkok" | CORRECT | - | E | R17 | - |  |
| react-native | `<Text>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(when)}</Text>` | timeZone option | CORRECT | - | E | R17 | - |  |
| swiftui | `Text({ let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short; f.timeZone = TimeZone(identifier: "Asia/Bangkok") ?? .current; return …` | TimeZone(identifier:) ?? .current | CORRECT | - | N | R18 | - |  |
| compose | `Text(text = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).apply { timeZone = java.util.TimeZone…` | ZoneId.of(...) fallback systemDefault | CORRECT | - | N | R19 | - |  |

### input.value:inputType = text

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="probei3u-v" type="text" value={v} onChange={(e) => onChange(e.target.value)} aria-label="Field" />` | type="text" | CORRECT | - | E | R10 | - |  |
| vue | `<input id="probei3u-v" type="text" :value="v" @input="onChange(($event.target as HTMLInputElement).value)" aria-label="Field" />` | type="text" | CORRECT | - | E | R10 | - |  |
| svelte | `<input id="probei3u-v" type="text" value={v} on:input={(e) => onChange((e.currentTarget as HTMLInputElement).value)} aria-label="Field" />` | type="text" | CORRECT | - | E | R10 | - |  |
| react-native | `(nothing emitted)` | default text field | CORRECT | - | N | R11,R12,R13 | - |  |
| swiftui | `(nothing emitted)` | default text field | CORRECT | - | N | R11,R12,R13 | - |  |
| compose | `(nothing emitted)` | default text field | CORRECT | - | N | R11,R12,R13 | - |  |

### input.value:inputType = email

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="probei3w-v" type="email" value={v} onChange={(e) => onChange(e.target.value)} aria-label="Field" />` | type="email" | CORRECT | - | N | MDN input types | - |  |
| vue | `<input id="probei3w-v" type="email" :value="v" @input="onChange(($event.target as HTMLInputElement).value)" aria-label="Field" />` | type="email" | CORRECT | - | N | MDN input types | - |  |
| svelte | `<input id="probei3w-v" type="email" value={v} on:input={(e) => onChange((e.currentTarget as HTMLInputElement).value)} aria-label="Field" />` | type="email" | CORRECT | - | N | MDN input types | - |  |
| react-native | `(nothing emitted)` | keyboardType="email-address" | SILENT-DROP | FUNCTIONAL | E | R11 | - |  |
| swiftui | `(nothing emitted)` | .keyboardType(.emailAddress) | SILENT-DROP | FUNCTIONAL | P | R12 | - |  |
| compose | `(nothing emitted)` | KeyboardOptions(keyboardType = KeyboardType.Email) | SILENT-DROP | FUNCTIONAL | E | R13 | - |  |

### input.value:inputType = password

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="probei3y-v" type="password" value={v} onChange={(e) => onChange(e.target.value)} aria-label="Field" />` | type="password" | CORRECT | - | E | R10 | - |  |
| vue | `<input id="probei3y-v" type="password" :value="v" @input="onChange(($event.target as HTMLInputElement).value)" aria-label="Field" />` | type="password" | CORRECT | - | E | R10 | - |  |
| svelte | `<input id="probei3y-v" type="password" value={v} on:input={(e) => onChange((e.currentTarget as HTMLInputElement).value)} aria-label="Field" />` | type="password" | CORRECT | - | E | R10 | - |  |
| react-native | `(nothing emitted)` | secureTextEntry | SILENT-DROP | FUNCTIONAL | E | R11 | - | password is shown as plain text (privacy) |
| swiftui | `(nothing emitted)` | SecureField | SILENT-DROP | FUNCTIONAL | P | R12 | - | password is shown as plain text (privacy) |
| compose | `(nothing emitted)` | PasswordVisualTransformation / KeyboardType.Password | SILENT-DROP | FUNCTIONAL | E | R13 | - | password is shown as plain text (privacy) |

### input.value:inputType = checkbox

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="probei40-v" type="checkbox" value={v} onChange={(e) => onChange(e.target.value)} aria-label="Field" />` | type="checkbox" bound with checked={v} / e.target.checked | DEFECT | FUNCTIONAL | E | R9 | - | emits value={v} and e.target.value: the checkbox never reflects its state |
| vue | `<input id="probei40-v" type="checkbox" :value="v" @input="onChange(($event.target as HTMLInputElement).value)" aria-label="Field" />` | type="checkbox" bound with checked={v} / e.target.checked | DEFECT | FUNCTIONAL | E | R9 | - | emits value={v} and e.target.value: the checkbox never reflects its state |
| svelte | `<input id="probei40-v" type="checkbox" value={v} on:input={(e) => onChange((e.currentTarget as HTMLInputElement).value)} aria-label="Field" />` | type="checkbox" bound with checked={v} / e.target.checked | DEFECT | FUNCTIONAL | E | R9 | - | emits value={v} and e.target.value: the checkbox never reflects its state |
| react-native | `(nothing emitted)` | a checkbox/Switch control | SILENT-DROP | FUNCTIONAL | E | R3 | - |  |
| swiftui | `(nothing emitted)` | Toggle | SILENT-DROP | FUNCTIONAL | N | R5 | - |  |
| compose | `(nothing emitted)` | Checkbox | SILENT-DROP | FUNCTIONAL | N | R4 | - |  |

### input.value:inputType = number (numeric-range state)

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<input id="probei42-v" type="number" value={v} onChange={(e) => onChange(Number(e.target.value))} min={0} max={10} step={1} aria-label="n" />` | type="number" | CORRECT | - | N | R10 | - |  |
| vue | `<input id="probei42-v" type="number" :value="v" @input="onChange(Number(($event.target as HTMLInputElement).value))" :min="0" :max="10" :step="1" a…` | type="number" | CORRECT | - | N | R10 | - |  |
| svelte | `<input id="probei42-v" type="number" value={v} on:input={(e) => onChange(Number(e.currentTarget.value))} min={0} max={10} step={1} aria-label="n" />` | type="number" | CORRECT | - | N | R10 | - |  |
| react-native | `<TextInput keyboardType="numeric" value={String(v)} onChangeText={(t) => onChange(Number(t))} accessibilityLabel={"n"} />` | keyboardType="numeric" | CORRECT | - | E | R11 | - |  |
| swiftui | `Stepper("n", value: Binding(get: { v }, set: { onChange($0) }), in: 0...10, step: 1)` | Stepper (numeric control) | CORRECT | - | N | R12 | - |  |
| compose | `OutlinedTextField(value = v.toString(), onValueChange = { onChange(it.toFloatOrNull() ?: v) })` | KeyboardOptions(keyboardType = KeyboardType.Number) | SILENT-DROP | FUNCTIONAL | E | R13 | - | numeric text field has no numeric keyboard |

### input.state.value:kind = boolean

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `v: boolean; ⏎ <input id="probes44-v" type="checkbox" checked={v} onChange={(e) => onChange(e.target.checked)} aria-label="c" />` | <input type=checkbox checked> | CORRECT | - | N | R9 | - |  |
| vue | `v: boolean; ⏎ <input id="probes44-v" type="checkbox" :checked="v" @change="onChange(($event.target as HTMLInputElement).checked)" aria-label="c" />` | <input type=checkbox checked> | CORRECT | - | N | R9 | - |  |
| svelte | `export let v: boolean; ⏎ <input id="probes44-v" type="checkbox" checked={v} on:change={(e) => onChange(e.currentTarget.checked)} aria-label="c" />` | <input type=checkbox checked> | CORRECT | - | N | R9 | - |  |
| react-native | `v: boolean; ⏎ <Switch value={v} onValueChange={onChange} accessibilityLabel={"c"} />` | Switch(value) | CORRECT | - | N | R3 | - |  |
| swiftui | `let v: Bool ⏎ Toggle("c", isOn: Binding(get: { v }, set: { onChange($0) }))` | Toggle(isOn:) | CORRECT | - | N | Apple SwiftUI controls | - |  |
| compose | `v: Boolean, ⏎ Checkbox(checked = v, onCheckedChange = onChange)` | Checkbox(checked) | CORRECT | - | N | Compose components | - |  |

### input.state.value:kind = selected-value

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `opts: { value: string; label: string }[]; ⏎ <select id="probes46-v" value={v} onChange={(e) => onChange(e.target.value)} aria-label="c"> ⏎ {opts.ma…` | <select>/<option> | CORRECT | - | N | R9 | - |  |
| vue | `onChange: (value: string) => void; ⏎ opts: { value: string; label: string }[] ⏎ <select id="probes46-v" :value="v" @change="onChange(($event.target…` | <select>/<option> | CORRECT | - | N | R9 | - |  |
| svelte | `export let opts: { value: string; label: string }[]; ⏎ <select id="probes46-v" value={v} on:change={(e) => onChange(e.currentTarget.value)} aria-la…` | <select>/<option> | CORRECT | - | N | R9 | - |  |
| react-native | `opts: { value: string; label: string }[]; ⏎ <Picker selectedValue={v} onValueChange={onChange} accessibilityLabel={"c"}> ⏎ {opts.map((opt) => ( ⏎ <…` | Picker (external @react-native-picker/picker) | CORRECT | - | N | R3 | - |  |
| swiftui | `let value: String ⏎ let label: String ⏎ let id = UUID().uuidString ⏎ Picker("c", selection: Binding(get: { v }, set: { onChange($0) })) { ⏎ ForEach…` | Picker(selection:) | CORRECT | - | N | Apple SwiftUI controls | - |  |
| compose | `val value: String, ⏎ val label: String ⏎ ) ⏎ onChange: (String) -> Unit, ⏎ Column(modifier = Modifier.selectableGroup()) { ⏎ opts.forEach { opt -> …` | RadioButton group | CORRECT | - | N | Compose components | - |  |

### input.state.value:kind = numeric-range

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `v: number; ⏎ <input id="probes48-v" type="range" value={v} onChange={(e) => onChange(Number(e.target.value))} min={0} max={10} step={1} aria-label=…` | <input type=range min max step> | CORRECT | - | N | R9 | - |  |
| vue | `v: number; ⏎ <input id="probes48-v" type="range" :value="v" @input="onChange(Number(($event.target as HTMLInputElement).value))" :min="0" :max="10"…` | <input type=range min max step> | CORRECT | - | N | R9 | - |  |
| svelte | `export let v: number; ⏎ <input id="probes48-v" type="range" value={v} on:input={(e) => onChange(Number(e.currentTarget.value))} min={0} max={10} st…` | <input type=range min max step> | CORRECT | - | N | R9 | - |  |
| react-native | `v: number; ⏎ <Slider value={v} onValueChange={onChange} accessibilityRole="adjustable" accessibilityValue={{ now: v }} minimumValue={0} maximumValu…` | Slider(min,max,step) | CORRECT | - | N | R3 | - |  |
| swiftui | `let v: Double ⏎ Slider(value: Binding(get: { v }, set: { onChange($0) }), in: 0...10, step: 1)` | Slider(in:step:) | CORRECT | - | N | Apple SwiftUI controls | - |  |
| compose | `v: Double, ⏎ Slider(value = v, onValueChange = onChange, valueRange = 0f..10f, steps = 9)` | Slider(valueRange, steps = 9 for 0..10 step 1) | CORRECT | - | E | R23 | - |  |

### variant.value:intent = status

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ ...({ "a": { color: 'var(--color-fg-default)' }, "b": { color: 'var(--color-fg-default)' } })[tone] }}> ⏎ {({ "a": <Info aria-hidden=…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| vue | `<div :style="{ ...({ "a": { 'color': 'var(--color-fg-default)' }, "b": { 'color': 'var(--color-fg-default)' } })[tone] }"> ⏎ <component :is="({ "a"…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| svelte | `<div style="{({ "a": "color: var(--color-fg-default)", "b": "color: var(--color-fg-default)" })[tone]}"> ⏎ <svelte:component this={({ "a": Info, "b…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| react-native | `<View accessible style={{ ...({ "a": { color: tokens.color.fg.default }, "b": { color: tokens.color.fg.default } })[tone] }}> ⏎ {({ "a": <Info />, …` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| swiftui | `Image(systemName: (["a": "info.circle", "b": "checkmark"][tone] ?? "")) ⏎ .accessibilityHidden(true) ⏎ .foregroundColor((["a": DesignTokens.ColorFg…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| compose | `Icon(when (tone) { "a" -> Icons.Default.Info; "b" -> Icons.Default.Check; else -> Icons.Default.Info }, contentDescription = null)` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |

### variant.value:intent = emphasis

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ ...({ "a": { color: 'var(--color-fg-default)' }, "b": { color: 'var(--color-fg-default)' } })[tone] }}> ⏎ {({ "a": <Info aria-hidden=…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| vue | `<div :style="{ ...({ "a": { 'color': 'var(--color-fg-default)' }, "b": { 'color': 'var(--color-fg-default)' } })[tone] }"> ⏎ <component :is="({ "a"…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| svelte | `<div style="{({ "a": "color: var(--color-fg-default)", "b": "color: var(--color-fg-default)" })[tone]}"> ⏎ <svelte:component this={({ "a": Info, "b…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| react-native | `<View accessible style={{ ...({ "a": { color: tokens.color.fg.default }, "b": { color: tokens.color.fg.default } })[tone] }}> ⏎ {({ "a": <Info />, …` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| swiftui | `Image(systemName: (["a": "info.circle", "b": "checkmark"][tone] ?? "")) ⏎ .accessibilityHidden(true) ⏎ .foregroundColor((["a": DesignTokens.ColorFg…` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |
| compose | `Icon(when (tone) { "a" -> Icons.Default.Info; "b" -> Icons.Default.Check; else -> Icons.Default.Info }, contentDescription = null)` | no output (scoping metadata; never emitted) | CORRECT | - | N | schema | - |  |

### style-slot = background

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ backgroundColor: 'var(--color-bg-surface)' }}>` | background-color | CORRECT | - | N | R20 | token-guard |  |
| vue | `<div style="background-color: var(--color-bg-surface)">` | background-color | CORRECT | - | N | R20 | token-guard |  |
| svelte | `<div style="background-color: var(--color-bg-surface)">` | background-color | CORRECT | - | N | R20 | token-guard |  |
| react-native | `<View accessible style={{ backgroundColor: tokens.color.bg.surface }}>` | backgroundColor | CORRECT | - | N | R21 | token-guard |  |
| swiftui | `.background(DesignTokens.ColorBgSurface)` | .background | CORRECT | - | N | Apple SwiftUI modifiers | token-guard |  |
| compose | `Column(modifier = Modifier.background(DesignTokens.ColorBgSurface)) {` | Modifier.background | CORRECT | - | N | Compose Modifier | token-guard |  |

### style-slot = color

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ color: 'var(--color-fg-default)' }}>` | color | CORRECT | - | N | R20 | - |  |
| vue | `<div style="color: var(--color-fg-default)">` | color | CORRECT | - | N | R20 | - |  |
| svelte | `<div style="color: var(--color-fg-default)">` | color | CORRECT | - | N | R20 | - |  |
| react-native | `<View accessible style={{ color: tokens.color.fg.default }}>` | color has effect only on Text; a View style color does not cascade to children | DEFECT | VISUAL | E | R24 | - | emitted on a View: ignored; children do not inherit |
| swiftui | `.foregroundColor(DesignTokens.ColorFgDefault)` | .foregroundColor | CORRECT | - | N | Apple SwiftUI modifiers | - | foregroundColor cascades to child Text |
| compose | `(nothing emitted)` | text color on the children (Column does not cascade) | SILENT-DROP | VISUAL | N | R4 | - | container `color` dropped with NO warning (the warning exists only for variant colors) |

### style-slot = padding

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ padding: 'var(--space-inset-md)' }}>` | padding | CORRECT | - | N | R20 | - |  |
| vue | `<div style="padding: var(--space-inset-md)">` | padding | CORRECT | - | N | R20 | - |  |
| svelte | `<div style="padding: var(--space-inset-md)">` | padding | CORRECT | - | N | R20 | - |  |
| react-native | `<View accessible style={{ padding: tokens.space.inset.md }}>` | padding | CORRECT | - | N | R21 | - |  |
| swiftui | `.padding(DesignTokens.SpaceInsetMd)` | .padding | CORRECT | - | N | Apple SwiftUI modifiers | - |  |
| compose | `Column(modifier = Modifier.padding(DesignTokens.SpaceInsetMd)) {` | Modifier.padding | CORRECT | - | N | Compose Modifier | - |  |

### style-slot = radius

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ borderRadius: 'var(--radius-surface)' }}>` | border-radius | CORRECT | - | N | R20 | - |  |
| vue | `<div style="border-radius: var(--radius-surface)">` | border-radius | CORRECT | - | N | R20 | - |  |
| svelte | `<div style="border-radius: var(--radius-surface)">` | border-radius | CORRECT | - | N | R20 | - |  |
| react-native | `<View accessible style={{ borderRadius: tokens.radius.surface }}>` | borderRadius | CORRECT | - | N | R21 | - |  |
| swiftui | `.cornerRadius(DesignTokens.RadiusSurface)` | .cornerRadius | CORRECT | - | N | Apple SwiftUI modifiers | - |  |
| compose | `Column(modifier = Modifier.clip(RoundedCornerShape(DesignTokens.RadiusSurface))) {` | Modifier.clip(RoundedCornerShape) | CORRECT | - | N | Compose Modifier | - |  |

### style-slot = gap

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ gap: 'var(--space-inset-sm)' }}>` | spacing between children | DEFECT | VISUAL | E | R20 | - | gap emitted on a non-flex container is inert (gap applies to flex/grid/multicol); fixed only for oriented containers |
| vue | `<div style="gap: var(--space-inset-sm)">` | spacing between children | DEFECT | VISUAL | E | R20 | - | gap emitted on a non-flex container is inert (gap applies to flex/grid/multicol); fixed only for oriented containers |
| svelte | `<div style="gap: var(--space-inset-sm)">` | spacing between children | DEFECT | VISUAL | E | R20 | - | gap emitted on a non-flex container is inert (gap applies to flex/grid/multicol); fixed only for oriented containers |
| react-native | `<View accessible style={{ gap: tokens.space.inset.sm }}>` | gap (RN >= 0.71) | CORRECT | - | E | R21 | - |  |
| swiftui | `(nothing emitted)` | VStack/HStack(spacing: token) | SILENT-DROP | VISUAL | N | Apple SwiftUI stacks | - | stack spacing is hard-coded 8 |
| compose | `(nothing emitted)` | Arrangement.spacedBy(token) | SILENT-DROP | VISUAL | N | Compose Arrangement | - | no warning |

### style-slot = border

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ borderColor: 'var(--color-border-default)' }}>` | a visible border: border-color AND border-style/width | DEFECT | VISUAL | E | R20 | - | border-color alone shows nothing (style defaults to none) |
| vue | `<div style="border-color: var(--color-border-default)">` | a visible border: border-color AND border-style/width | DEFECT | VISUAL | E | R20 | - | border-color alone shows nothing (style defaults to none) |
| svelte | `<div style="border-color: var(--color-border-default)">` | a visible border: border-color AND border-style/width | DEFECT | VISUAL | E | R20 | - | border-color alone shows nothing (style defaults to none) |
| react-native | `<View accessible style={{ borderColor: tokens.color.border.default }}>` | a visible border: borderColor AND borderWidth | DEFECT | VISUAL | E | R21 | - | borderColor alone shows nothing |
| swiftui | `(nothing emitted)` | .border / overlay stroke | SILENT-DROP | VISUAL | N | Apple SwiftUI | - |  |
| compose | `(nothing emitted)` | Modifier.border | SILENT-DROP | VISUAL | N | Compose Modifier | - |  |

### style-slot = font

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ fontFamily: 'var(--font-family-sans)' }}>` | font-family | CORRECT | - | N | R20 | - |  |
| vue | `<div style="font-family: var(--font-family-sans)">` | font-family | CORRECT | - | N | R20 | - |  |
| svelte | `<div style="font-family: var(--font-family-sans)">` | font-family | CORRECT | - | N | R20 | - |  |
| react-native | `<View accessible style={{ font: tokens.font.family.sans }}>` | fontFamily | DEFECT | VISUAL | E | R21 | - | emits the non-RN key `font:` |
| swiftui | `(nothing emitted)` | .font(.custom(...)) | SILENT-DROP | VISUAL | N | Apple SwiftUI | - |  |
| compose | `(nothing emitted)` | fontFamily = | SILENT-DROP | VISUAL | N | Compose Text | - |  |

### style-slot = fontSize

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ fontSize: 'var(--font-size-lg)' }}>` | font-size | CORRECT | - | N | R20 | - |  |
| vue | `<div style="font-size: var(--font-size-lg)">` | font-size | CORRECT | - | N | R20 | - |  |
| svelte | `<div style="font-size: var(--font-size-lg)">` | font-size | CORRECT | - | N | R20 | - |  |
| react-native | `<View accessible style={{ fontSize: tokens.font.size.lg }}>` | fontSize | CORRECT | - | E | R21 | - |  |
| swiftui | `(nothing emitted)` | .font(.system(size:)) | SILENT-DROP | VISUAL | N | Apple SwiftUI | - |  |
| compose | `(nothing emitted)` | fontSize = | SILENT-DROP | VISUAL | N | Compose Text | - |  |

### style-slot = margin

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ margin: 'var(--space-4)' }}>` | margin | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| vue | `<div style="margin: var(--space-4)">` | margin | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| svelte | `<div style="margin: var(--space-4)">` | margin | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| react-native | `<View accessible style={{ margin: tokens.space.4 }}>` | margin | CORRECT | - | N | R21 | - | passes through the fallthrough (incidental) |
| swiftui | `(nothing emitted)` | .padding outside the background / spacing | SILENT-DROP | VISUAL | N | Apple SwiftUI | - |  |
| compose | `(nothing emitted)` | outer Modifier.padding | SILENT-DROP | VISUAL | N | Compose Modifier | - |  |

### style-slot = width

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ width: 'var(--space-8)' }}>` | width | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| vue | `<div style="width: var(--space-8)">` | width | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| svelte | `<div style="width: var(--space-8)">` | width | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| react-native | `<View accessible style={{ width: tokens.space.8 }}>` | width | CORRECT | - | N | R21 | - | passes through the fallthrough (incidental) |
| swiftui | `(nothing emitted)` | .frame(width:) | SILENT-DROP | VISUAL | N | Apple SwiftUI | - |  |
| compose | `(nothing emitted)` | Modifier.width() | SILENT-DROP | VISUAL | N | Compose Modifier | - |  |

### style-slot = height

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ height: 'var(--space-8)' }}>` | height | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| vue | `<div style="height: var(--space-8)">` | height | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| svelte | `<div style="height: var(--space-8)">` | height | CORRECT | - | N | R20 | - | passes through STYLE_PROP fallthrough (incidental) |
| react-native | `<View accessible style={{ height: tokens.space.8 }}>` | height | CORRECT | - | N | R21 | - | passes through the fallthrough (incidental) |
| swiftui | `(nothing emitted)` | .frame(height:) | SILENT-DROP | VISUAL | N | Apple SwiftUI | - |  |
| compose | `(nothing emitted)` | Modifier.height() | SILENT-DROP | VISUAL | N | Compose Modifier | - |  |

### element.field:size = space.6

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<div style={{ width: 'var(--space-6)', height: 'var(--space-6)' }}>` | width/height | CORRECT | - | N | R20 | - |  |
| vue | `<div style="width: var(--space-6); height: var(--space-6)">` | width/height | CORRECT | - | N | R20 | - |  |
| svelte | `<div style="width: var(--space-6); height: var(--space-6)">` | width/height | CORRECT | - | N | R20 | - |  |
| react-native | `<View accessible style={{ width: tokens.space.6, height: tokens.space.6 }}>` | width/height | CORRECT | - | N | R21 | - |  |
| swiftui | `.frame(width: DesignTokens.Space6, height: DesignTokens.Space6)` | .frame(width:height:) | CORRECT | - | N | Apple SwiftUI | - |  |
| compose | `Column(modifier = Modifier.size(DesignTokens.Space6)) {` | Modifier.size | CORRECT | - | N | Compose Modifier | - |  |

### element.field:icon = icon.check

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<Check aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<Check aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={Check} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<Check accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "checkmark") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Check, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | name likely in core; confirm |

### element.field:icon = icon.close

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<X aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<X aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={X} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<X accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "xmark") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Close, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | name likely in core; confirm |

### element.field:icon = icon.info

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<Info aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<Info aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={Info} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<Info accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "info.circle") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Info, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | name likely in core; confirm |

### element.field:icon = icon.warning

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<TriangleAlert aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<TriangleAlert aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={TriangleAlert} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<TriangleAlert accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "exclamationmark.triangle") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Warning, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | CheckCircle/Warning/Favorite confirmed in core Icons.Filled |

### element.field:icon = icon.error

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<CircleAlert aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<CircleAlert aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={CircleAlert} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<CircleAlert accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "xmark.octagon") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Error, contentDescription = null)` | symbol available with the declared dependency | UNVERIFIED | FUNCTIONAL | E | R22 | - | docs excerpt places Error/ChevronRight in material-icons-extended (not core); output uses `Icons.Default.*` with no documented dependency: compile check needed |

### element.field:icon = icon.success

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<CircleCheck aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<CircleCheck aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={CircleCheck} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<CircleCheck accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "checkmark.circle") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.CheckCircle, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | CheckCircle/Warning/Favorite confirmed in core Icons.Filled |

### element.field:icon = icon.star

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<Star aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<Star aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={Star} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<Star accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "star") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Star, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | name likely in core; confirm |

### element.field:icon = icon.heart

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<Heart aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<Heart aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={Heart} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<Heart accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "heart") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.Favorite, contentDescription = null)` | symbol exists in Icons.Filled | UNVERIFIED | COSMETIC | E | R22 | - | CheckCircle/Warning/Favorite confirmed in core Icons.Filled |

### element.field:icon = icon.chevron

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<ChevronRight aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| vue | `<ChevronRight aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| svelte | `<svelte:component this={ChevronRight} aria-hidden="true" />` | lucide icon name exists in the installed lucide version | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| react-native | `<ChevronRight accessible={false} />` | lucide-react-native icon name exists | UNVERIFIED | COSMETIC | N | lucide.dev | - | check the name in the lucide release used |
| swiftui | `Image(systemName: "chevron.right") ⏎ .accessibilityHidden(true)` | SF Symbol name exists on the deployment target | UNVERIFIED | COSMETIC | N | SF Symbols app | - | check in the SF Symbols app (availability varies by OS version) |
| compose | `Icon(Icons.Default.ChevronRight, contentDescription = null)` | symbol available with the declared dependency | UNVERIFIED | FUNCTIONAL | E | R22 | - | docs excerpt places Error/ChevronRight in material-icons-extended (not core); output uses `Icons.Default.*` with no documented dependency: compile check needed |

### element.field:icon = icon.nonexistent

| adapter | emitted | expected (doc) | verdict | sev | conf | refs | caught by | note |
|---|---|---|---|---|---|---|---|---|
| react | `<icon.nonexistent aria-hidden="true" />` | a mapped symbol (an unmapped token must not reach the output) | DEFECT | FUNCTIONAL | P | n/a | token-guard | unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it |
| vue | `<icon.nonexistent aria-hidden="true" />` | a mapped symbol (an unmapped token must not reach the output) | DEFECT | FUNCTIONAL | P | n/a | token-guard | unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it |
| svelte | `<svelte:component this={icon.nonexistent} aria-hidden="true" />` | a mapped symbol (an unmapped token must not reach the output) | DEFECT | FUNCTIONAL | P | n/a | token-guard | unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it |
| react-native | `<icon.nonexistent accessible={false} />` | a mapped symbol (an unmapped token must not reach the output) | DEFECT | FUNCTIONAL | P | n/a | token-guard | unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it |
| swiftui | `Image(systemName: "icon.nonexistent") ⏎ .accessibilityHidden(true)` | a mapped symbol (an unmapped token must not reach the output) | DEFECT | FUNCTIONAL | P | n/a | token-guard | unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it |
| compose | `Icon(Icons.Default.icon.nonexistent, contentDescription = null)` | a mapped symbol (an unmapped token must not reach the output) | DEFECT | FUNCTIONAL | P | n/a | token-guard | unmapped token is emitted verbatim as an identifier (uncompilable); token-guard unknown-token CATCHES it |

## Reference key

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
