#!/usr/bin/env node
/**
 * verify-patches — self-verification / regression harness.
 * Each check pins a fix or a pipeline invariant so future edits can't silently
 * regress it. Run in CI and after any adapter change.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specToIrFromFile } from './spec-to-ir.mjs';
import { generateReact } from '../../adapters/react/generate.mjs';
import { generateSwiftUI } from '../../adapters/swiftui/generate.mjs';
import { generateCompose } from '../../adapters/compose/generate.mjs';
import { generateVue } from '../../adapters/vue/generate.mjs';
import { generateSvelte } from '../../adapters/svelte/generate.mjs';
import { generateReactNative } from '../../adapters/react-native/generate.mjs';
import { checkA11y } from '../../.claude/skills/_guards/a11y-guard/scripts/check.mjs';
import { checkTokens } from '../../.claude/skills/_guards/token-guard/scripts/check.mjs';
import { checkPerf } from '../../.claude/skills/_guards/perf-guard/scripts/check.mjs';
import { checkSlop } from '../../.claude/skills/_guards/slop-guard/scripts/check.mjs';
import { checkTbd } from '../../.claude/skills/_meta/critique/scripts/check-tbd.mjs';
import { checkRefusal } from '../../.claude/skills/_meta/orchestrator/scripts/refusal.mjs';
import { loadSpec } from './validate-schema.mjs';
import { route, loadContext } from '../../.ai/router/route.mjs';
import { loadWorkflow, evaluateWorkflow, runScenarios, lintWorkflow } from './workflow-eval.mjs';
import { skillRegistryDrift } from './skill-registry.mjs';
import { checkParity } from './e2e-multi.mjs';
import { checkNativeExprLeak, checkDeclaredDropped } from './output-guards.mjs';
import { checkLedger, loadWaivers } from './ledger-gate.mjs';
import { runMutationTesting } from './mutate-gates.mjs';
import { RendererBase } from '../../adapters/_shared/renderer-base.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const EX = (f) => resolve(ROOT, '_shared/schemas/examples', f);
const PRODUCT = EX('product-card.spec.yaml');
const LIST = EX('user-card-list.spec.yaml');
const ALERT = resolve(ROOT, '.claude/artifacts/alert/design-spec.yaml');
const FORM = resolve(ROOT, '.claude/artifacts/form-field/design-spec.yaml');
const BUTTON = resolve(ROOT, '.claude/artifacts/button/design-spec.yaml');
const SPINNER = resolve(ROOT, '.claude/artifacts/spinner/design-spec.yaml');
const EMPTY_STATE = resolve(ROOT, '.claude/artifacts/empty-state/design-spec.yaml');
const TOKEN_AMOUNT = resolve(ROOT, '.claude/artifacts/token-amount/design-spec.yaml');
const AVATAR = resolve(ROOT, '.claude/artifacts/avatar/design-spec.yaml');
const CONDSHOW = EX('cond-show.spec.yaml');
const CONDLIST = EX('cond-list.spec.yaml');

let pass = 0, fail = 0;
const results = [];
function check(id, desc, fn) {
  try {
    fn();
    results.push(`  PASS  ${id}  ${desc}`);
    pass++;
  } catch (e) {
    results.push(`  FAIL  ${id}  ${desc}\n          ${e.message}`);
    fail++;
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- P1: SwiftUI Identifiable must not synthesize a recursive `id` ----------
check('P1', 'swiftui: no stored/computed id collision when itemShape has id', () => {
  const { code } = generateSwiftUI(LIST, '_verify');
  assert(!/var id: String \{ id \}/.test(code), 'found recursive computed id');
  assert(/struct UserCardListItem: Identifiable/.test(code), 'missing Identifiable item struct');
  assert(/let id: String/.test(code), 'stored id from itemShape missing');
});

// --- P2: Compose must import semantics when it emits .semantics -------------
check('P2', 'compose: semantics import present when contentDescription used', () => {
  const { code } = generateCompose(LIST, '_verify');
  if (/\.semantics \{/.test(code)) {
    assert(/import androidx\.compose\.ui\.semantics\.semantics/.test(code), 'semantics used but not imported');
  }
});

// --- P3: native expr warnings pick a letter-leading identifier -------------
check('P3', 'native: expr firstIdent resolves to `price`, not `$$`', () => {
  const sw = generateSwiftUI(PRODUCT, '_verify');
  const cp = generateCompose(PRODUCT, '_verify');
  const all = [...sw.warnings, ...cp.warnings].join('\n');
  assert(/`price`/.test(all), 'expected price identifier in warning');
  assert(!/`\$\$`/.test(all), 'firstIdent regressed to $$');
});

// --- P4: token-guard catches a hardcoded hex color -------------------------
check('P4', 'token-guard: flags raw hex in web output', () => {
  const ir = specToIrFromFile(PRODUCT);
  const bad = { react: { code: 'const c = "#ff0000";', warnings: [], file: 'x', component: 'ProductCard' } };
  const { ok, issues } = checkTokens(ir, bad);
  assert(!ok, 'guard should fail on hardcoded color');
  assert(issues.some((i) => i.rule === 'hardcoded-color'), 'missing hardcoded-color issue');
});

// --- P5: a11y-guard flags media without alt --------------------------------
check('P5', 'a11y-guard: flags media without alt', () => {
  const ir = { root: { kind: 'container', children: [{ kind: 'media', src: { kind: 'ref', value: 'x' } }] } };
  const { ok, issues } = checkA11y(ir);
  assert(!ok, 'guard should fail');
  assert(issues.some((i) => i.rule === 'img-alt'), 'missing img-alt issue');
});

// --- P6: public API parity — every prop appears in every adapter output ----
check('P6', 'parity: all 6 adapters expose every prop name', () => {
  const ir = specToIrFromFile(PRODUCT);
  const gens = [generateReact, generateVue, generateSvelte, generateReactNative, generateSwiftUI, generateCompose];
  for (const gen of gens) {
    const { code, component } = gen(PRODUCT, '_verify');
    assert(component === 'ProductCard', 'component name drift');
    for (const p of ir.props) {
      assert(new RegExp(`\\b${p.name}\\b`).test(code), `prop ${p.name} missing from ${gen.name}`);
    }
  }
});

// --- P7: React emits tokens only as CSS vars, never raw hex ------------------
check('P7', 'react: styles reference CSS vars, no raw hex', () => {
  const { code } = generateReact(PRODUCT, '_verify');
  assert(/var\(--color-accent-default\)/.test(code), 'expected token var reference');
  assert(!/#[0-9a-fA-F]{6}/.test(code), 'raw hex leaked into react output');
});

// --- P8: iteration renders platform-idiomatic loops -------------------------
check('P8', 'iteration: each adapter uses its native loop construct', () => {
  const expect = [
    [generateReact, /\.map\(\(user\)/],
    [generateVue, /v-for="user in users"/],
    [generateSvelte, /\{#each users as user/],
    [generateReactNative, /\.map\(\(user\)/],
    [generateSwiftUI, /ForEach\(users, id: \\\.id\)/],
    [generateCompose, /users\.forEach \{ user ->/],
  ];
  for (const [gen, re] of expect) {
    const { code } = gen(LIST, '_verify');
    assert(re.test(code), `${gen.name} missing expected loop construct`);
  }
});

// --- P9: enum variant is applied (not a no-op) on all 6 adapters -----------
check('P9', 'variant: severity drives the info background token on every adapter', () => {
  const expect = [
    [generateReact, /info[^]*var\(--color-info-bg\)[^]*\[severity\]/],
    [generateVue, /:style=[^]*var\(--color-info-bg\)[^]*\[severity\]/],
    [generateSvelte, /background-color: var\(--color-info-bg\)[^]*\[severity\]/],
    [generateReactNative, /tokens\.color\.info\.bg[^]*\[severity\]/],
    [generateSwiftUI, /"info": DesignTokens\.ColorInfoBg[^]*\[severity\]/],
    [generateCompose, /when \(severity\) \{[^]*"info" -> DesignTokens\.ColorInfoBg/],
  ];
  for (const [gen, re] of expect) {
    const { code } = gen(ALERT, '_verify');
    assert(re.test(code), `${gen.name} did not apply the severity variant`);
  }
});

// --- P10: optional function prop + `when` is valid native code -------------
check('P10', 'native: optional callback typed optional + guarded, not used as Bool', () => {
  const sw = generateSwiftUI(ALERT, '_verify').code;
  assert(/let onDismiss: \(\(\) -> Void\)\?/.test(sw), 'swiftui optional closure type missing');
  assert(/if let onDismiss = onDismiss \{/.test(sw), 'swiftui should bind-unwrap the optional');
  assert(!/if onDismiss \{/.test(sw), 'swiftui regressed to using a closure as Bool');
  const cp = generateCompose(ALERT, '_verify').code;
  assert(/onDismiss: \(\(\) -> Unit\)\?/.test(cp), 'compose nullable lambda type missing');
  assert(/if \(onDismiss != null\) \{/.test(cp), 'compose should null-check the lambda');
  assert(!/if \(onDismiss\) \{/.test(cp), 'compose regressed to using a lambda as Boolean');
});

// --- P11: perf-guard does not false-flag a used icon import ----------------
check('P11', 'perf-guard: a used icon import is not reported as dead', () => {
  const results = {
    react: generateReact(ALERT, '_verify'),
    swiftui: generateSwiftUI(ALERT, '_verify'),
  };
  const ir = specToIrFromFile(ALERT);
  const { issues } = checkPerf(ir, results);
  assert(!issues.some((i) => i.rule === 'dead-icon-import'), 'used icon flagged as dead');
});

// --- P12: Compose reports the container color-cascade limitation -----------
check('P12', 'compose: warns that container color variant does not cascade', () => {
  const { warnings } = generateCompose(ALERT, '_verify');
  assert(warnings.some((w) => /color.*variant.*not applied on Compose/.test(w)), 'missing cascade warning');
});

// --- P13: web inputs get a programmatically associated visible label -------
check('P13', 'web: <label for/htmlFor> matches the input id', () => {
  const cases = [
    [generateReact, /<label htmlFor="field-input">/, /<input id="field-input"/],
    [generateVue, /<label for="field-input">/, /<input id="field-input"/],
    [generateSvelte, /<label for="field-input">/, /<input id="field-input"/],
  ];
  for (const [gen, labelRe, inputRe] of cases) {
    const { code } = gen(FORM, '_verify');
    assert(labelRe.test(code), `${gen.name} missing associated label`);
    assert(inputRe.test(code), `${gen.name} missing input id`);
  }
});

// --- P14: web aria wiring — invalid + describedby (gated) + error id -------
check('P14', 'web: aria-invalid + gated aria-describedby + error element id', () => {
  const { code } = generateReact(FORM, '_verify');
  assert(/aria-invalid=\{!!error\}/.test(code), 'missing aria-invalid');
  assert(/aria-describedby=\{error \? "field-error" : undefined\}/.test(code), 'describedby not gated on error');
  assert(/id="field-error"[^]*role="alert"/.test(code), 'error element missing id/role');
});

// --- P15: a value-change handler is typed to take a string -----------------
check('P15', 'change handler typed with a string arg on every adapter', () => {
  const expect = [
    [generateReact, /onChange: \(value: string\) => void/],
    [generateVue, /onChange: \(value: string\) => void/],
    [generateSvelte, /onChange[^]*: \(value: string\) => void/],
    [generateReactNative, /onChange: \(value: string\) => void/],
    [generateSwiftUI, /onChange: \(String\) -> Void/],
    [generateCompose, /onChange: \(String\) -> Unit/],
  ];
  for (const [gen, re] of expect) {
    const { code } = gen(FORM, '_verify');
    assert(re.test(code), `${gen.name} change handler not typed for a string`);
  }
});

// --- P16: optional string prop is optional-typed + safely guarded ----------
check('P16', 'native: optional String is String? and null/nil-checked, not a Bool', () => {
  const sw = generateSwiftUI(FORM, '_verify').code;
  assert(/let error: String\?/.test(sw), 'swiftui error not optional');
  assert(/if let error = error \{/.test(sw), 'swiftui error not bind-unwrapped');
  assert(!/if error \{/.test(sw), 'swiftui used optional String as Bool');
  const cp = generateCompose(FORM, '_verify').code;
  assert(/error: String\?/.test(cp), 'compose error not nullable');
  assert(/if \(error != null\) \{/.test(cp), 'compose error not null-checked');
  assert(!/if \(error\) \{/.test(cp), 'compose used nullable String as Boolean');
});

// --- P17: slop-guard blocks emoji, passes clean output ---------------------
check('P17', 'slop-guard: emoji in output is a blocking finding', () => {
  const ir = specToIrFromFile(PRODUCT);
  const dirty = { react: { code: 'const x = "Add to cart 🛒";' } };
  const bad = checkSlop(ir, dirty);
  assert(!bad.ok, 'emoji should block the gate');
  assert(bad.issues.some((i) => i.rule === 'no-emoji'), 'missing no-emoji issue');
  const clean = checkSlop(ir, { react: generateReact(PRODUCT, '_verify') });
  assert(clean.ok, 'clean output should pass slop-guard');
});

// --- P18: slop-guard color-only detection (advisory) + icon resolves it ----
check('P18', 'slop-guard: color-only variant is an advisory; a per-state icon clears it', () => {
  // Alert now carries a per-severity icon, so it must NOT be flagged.
  const alert = checkSlop(specToIrFromFile(ALERT), { react: generateReact(ALERT, '_verify') });
  assert(alert.ok, 'alert with icons must pass slop-guard');
  assert(!alert.issues.some((i) => i.rule === 'status-color-only'), 'icon should clear the color-only advisory');
  // A synthetic color-only variant (no icon) is flagged, but only as advisory.
  const colorOnly = {
    tokens: [],
    root: { kind: 'container', variant: { prop: 'sev', cases: { a: { background: 'color.info.bg' }, b: { background: 'color.danger.bg' } } } },
  };
  const syn = checkSlop(colorOnly, {});
  assert(syn.ok, 'a minor status-color-only finding must not block');
  assert(syn.issues.some((i) => i.rule === 'status-color-only'), 'expected the advisory for a color-only variant');
});

// --- P19: readiness — TBD sentinel blocks, clean spec passes ---------------
check('P19', 'readiness: an unresolved TBD blocks generation', () => {
  const ir = {
    tokens: [],
    root: { kind: 'container', children: [{ kind: 'text', text: { kind: 'literal', value: 'TBD — ต้องการ copy' } }] },
  };
  const bad = checkTbd(ir);
  assert(!bad.ok, 'TBD should block');
  assert(bad.issues.some((i) => i.rule === 'unresolved-tbd'), 'missing unresolved-tbd issue');
  assert(checkTbd(specToIrFromFile(PRODUCT)).ok, 'a resolved spec should pass readiness');
});

// --- P20: every SKILL.md carries a negative-routing line -------------------
check('P20', 'routing: every SKILL.md description says "Do NOT use"', () => {
  const files = execSync('find .claude/skills adapters -name SKILL.md', { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  assert(files.length === 29, `expected 29 SKILL.md, found ${files.length}`);
  const missing = files.filter((f) => !/Do NOT use/i.test(readFileSync(resolve(ROOT, f), 'utf8').split('---')[1] ?? ''));
  assert(missing.length === 0, `missing routing line: ${missing.join(', ')}`);
});

// --- P21: variant iconCases render a per-state icon on every adapter -------
check('P21', 'variant: a per-severity icon is emitted on every adapter', () => {
  const expect = [
    [generateReact, /"info": <Info aria-hidden="true" \/>/],
    [generateVue, /"info": Info/],
    [generateSvelte, /svelte:component this=\{\(\{ "info": Info/],
    [generateReactNative, /"info": <Info \/>/],
    [generateSwiftUI, /"info": "info\.circle"/],
    [generateCompose, /"info" -> Icons\.Default\.Info/],
  ];
  for (const [gen, re] of expect) {
    const { code } = gen(ALERT, '_verify');
    assert(re.test(code), `${gen.name} missing per-severity icon`);
  }
});

// --- P22: orchestrator refuses out-of-scope categories with a redirect -----
check('P22', 'refusal: overlay and data-table are refused with a redirect', () => {
  const overlay = checkRefusal({ category: 'overlay' });
  assert(overlay && /Radix|sheet|Dialog/.test(overlay.redirect), 'overlay not refused with redirect');
  const table = checkRefusal({ category: 'data-table' });
  assert(table && /TanStack|AG Grid/.test(table.redirect), 'data-table not refused with redirect');
  assert(checkRefusal({ category: 'display' }) === null, 'in-scope category must not be refused');
});

// --- P23: a refused spec generates no code ---------------------------------
check('P23', 'refusal: e2e produces a refusal report and no adapter output', () => {
  execSync('node _shared/scripts/e2e-multi.mjs --feature modal', { cwd: ROOT, stdio: 'ignore' });
  const report = JSON.parse(readFileSync(resolve(ROOT, 'out/_reports/modal.json'), 'utf8'));
  assert(report.refused === true, 'modal report should be marked refused');
  assert(!existsSync(resolve(ROOT, 'out/react/modal')), 'refused spec must not emit code');
});

// --- P24: AI Router is provider-agnostic and honest ------------------------
check('P24', 'ai-router: no fabricated selection when unconfigured; guardrails surfaced', () => {
  const ctx = loadContext();
  const plan = route({ capabilities: ['code'] }, ctx);
  assert(plan.status === 'needs_configuration', `expected needs_configuration, got ${plan.status}`);
  assert(plan.selection === null, 'must not fabricate a selection while unconfigured');
  assert(plan.guardrails.includes('violate-terms-of-service'), 'ToS guardrail must be surfaced');
  const nope = route({ capabilities: ['time-travel'] }, ctx);
  assert(nope.status === 'unavailable', 'out-of-vocabulary capability must be unavailable, not faked');
});

// --- P25: architecture manifests are internally consistent -----------------
check('P25', 'architecture: validate-architecture passes', () => {
  execSync('node _shared/scripts/validate-architecture.mjs', { cwd: ROOT, stdio: 'ignore' });
});

// --- P26: conditional workflow scenarios behave correctly ------------------
check('P26', 'workflow: conditional scenarios (design-only valid, required-missing blocked)', () => {
  const wf = loadWorkflow();
  const byId = Object.fromEntries(runScenarios(wf).map((r) => [r.id, r]));
  for (const r of Object.values(byId)) assert(r.ok, `scenario ${r.id} failed: ${r.problems.join('; ')}`);
  // design-only: engineering + design-qa skipped, handoff still runs (not blocked)
  const f = byId['F-design-only'];
  assert(f.res.runs.includes('handoff') && !f.res.runs.includes('engineering'), 'design-only handoff must run without engineering');
  assert(f.res.blocked.length === 0, 'design-only must not block');
  // invalid required dependency is blocked
  assert(byId['H-invalid-required'].res.blocked.length > 0, 'missing required artifact must block');
});

// --- P27: static workflow lint catches impossible deps, allows reuse -------
check('P27', 'workflow-lint: flags required non-reuse skippable producer; allows reuse; real workflow clean', () => {
  const ids = new Set(['x', 'y']);
  const r1 = lintWorkflow({ stages: [
    { id: 'p', run_if: 'flag', produces: ['x'] },
    { id: 'c', run_if: 'always', consumes: [{ artifact: 'x', required: true, reuse: false }] },
  ] }, { artifactIds: ids });
  assert(r1.length === 1, 'R1 (required non-reuse, skippable producer) must be flagged');
  const r4 = lintWorkflow({ stages: [{ id: 'c', consumes: [{ artifact: 'y', required: true }] }] }, { artifactIds: ids });
  assert(r4.length === 1, 'R4 (required, no producer, not reuse) must be flagged');
  const ok = lintWorkflow({ stages: [{ id: 'c', consumes: [{ artifact: 'y', required: true, reuse: true }] }] }, { artifactIds: ids });
  assert(ok.length === 0, 'reuse:true supplies the artifact externally — must be allowed');
  const real = evaluateWorkflow(loadWorkflow(), { flags: { ui_only: true, requirements_clear: true } });
  assert(real.blocked.length === 0, 'a valid UI-only run must not block');
});

// --- P28: skill-registry drift detection (SKILLS_INDEX <-> on-disk <-> INDEX) --
check('P28', 'skill-drift: flags both directions + dangling capability ref; clean matches', () => {
  const surface = new Set(['a11y-guard', 'anti-slop']);
  const disk = new Set(['a11y-guard', 'anti-slop']);
  assert(skillRegistryDrift(surface, disk).length === 0, 'matching registries must be clean');
  // surface lists a skill with no SKILL.md on disk
  assert(skillRegistryDrift(new Set(['a11y-guard', 'ghost']), disk).some((p) => /ghost/.test(p)),
    'must flag a SKILLS_INDEX skill missing from disk');
  // disk has a skill missing from the surface
  assert(skillRegistryDrift(new Set(['a11y-guard']), disk).some((p) => /anti-slop/.test(p)),
    'must flag an on-disk skill missing from SKILLS_INDEX');
  // a capability impl references a runtime skill that is not on disk
  assert(skillRegistryDrift(surface, disk, [['accessibility-qa', 'renamed-guard']]).some((p) => /renamed-guard/.test(p)),
    'must flag a capability impl referencing a runtime skill not on disk');
});

// --- P29: F-1 — a ref label must bind the variable, never stringify its name --
check('P29', 'swiftui + parity: a ref label binds the variable, never a self-named literal', () => {
  // Adapter level: the SwiftUI icon+label branch must respect the ref kind.
  const { code } = generateSwiftUI(BUTTON, '_verify');
  assert(/Label\(label,/.test(code), 'swiftui must bind the ref label as a variable');
  assert(!/Label\("label"/.test(code), 'swiftui regressed to stringifying the ref label as its own name');
  // Gate level: parity must flag the F-1 signature (ref emitted as its own-name literal).
  const ir = specToIrFromFile(BUTTON);
  const good = {
    react: generateReact(BUTTON, '_verify'), vue: generateVue(BUTTON, '_verify'),
    svelte: generateSvelte(BUTTON, '_verify'), 'react-native': generateReactNative(BUTTON, '_verify'),
    swiftui: generateSwiftUI(BUTTON, '_verify'), compose: generateCompose(BUTTON, '_verify'),
  };
  assert(checkParity(good, ir).ok, 'correctly bound refs must pass parity');
  const bad = { ...good, swiftui: { component: 'Button', file: 'x', code: 'Label("label", systemImage: "checkmark")' } };
  const r = checkParity(bad, ir);
  assert(!r.ok && r.issues.some((i) => /string literal "label"/.test(i)), 'parity must flag a ref emitted as its own-name literal');
});

// --- P30: F-2 — IR-declared role/live must appear in each adapter's OUTPUT -----
check('P30', 'a11y-guard (output tier): native adapters must express IR role/live, not drop them', () => {
  const ir = specToIrFromFile(SPINNER);
  const good = {
    react: generateReact(SPINNER, '_verify'), vue: generateVue(SPINNER, '_verify'),
    svelte: generateSvelte(SPINNER, '_verify'), 'react-native': generateReactNative(SPINNER, '_verify'),
    swiftui: generateSwiftUI(SPINNER, '_verify'), compose: generateCompose(SPINNER, '_verify'),
  };
  assert(checkA11y(ir, good).ok, 'spinner with mapped native role/live must pass the output tier');
  // Simulate the F-2 silent drop: a native adapter that maps only the label.
  const reverted = { ...good, 'react-native': { component: 'Spinner', file: 'x', code: '<View accessible><Text>Loading</Text></View>', warnings: [] } };
  const bad = checkA11y(ir, reverted);
  assert(!bad.ok, 'dropping the native live-region trait must FAIL the hardened a11y-guard');
  assert(bad.issues.some((i) => i.rule === 'a11y-output-live'), 'expected an a11y-output-live finding');
  // The IR-only call (no results) must still behave exactly as before (backward compatible).
  assert(checkA11y(ir).ok, 'IR-only a11y check must not regress');
});

// --- P31: H1 — native adapters must not emit an un-evaluated JS expression -----
check('P31', 'native-code: a JS-expression variant discriminant is flagged on native, plain props pass', () => {
  // RED: a variant driven by a JS expression leaks verbatim into SwiftUI/Compose.
  const exprIr = { props: [], root: { kind: 'container',
    variant: { prop: "d >= 0 ? 'positive' : 'negative'", cases: { positive: { color: 'color.success.fg' }, negative: { color: 'color.danger.fg' } } } } };
  const leaked = {
    swiftui: { code: `(["positive": A, "negative": B][d >= 0 ? 'positive' : 'negative'] ?? C)` },
    compose: { code: `when (d >= 0 ? 'positive' : 'negative') { "positive" -> A; else -> B }` },
    react:   { code: `({ positive: A })[d >= 0 ? 'positive' : 'negative']` }, // web can eval JS — not flagged
  };
  const r = checkNativeExprLeak(exprIr, leaked);
  assert(!r.ok, 'H1 must FAIL when a native adapter emits an un-evaluated JS expression');
  assert(r.issues.filter((i) => i.rule === 'native-expr-leak').length === 2, 'both SwiftUI and Compose must be flagged (web is not)');
  // GREEN: a plain-identifier discriminant is valid on every adapter.
  const plainIr = { props: [], root: { kind: 'container',
    variant: { prop: 'direction', cases: { positive: { color: 'color.success.fg' }, negative: { color: 'color.danger.fg' } } } } };
  const plain = { swiftui: { code: `(["positive": A][direction] ?? C)` }, compose: { code: `when (direction) { }` } };
  assert(checkNativeExprLeak(plainIr, plain).ok, 'a plain-identifier discriminant must pass H1');
});

// --- P32: H2 — a declared prop / icon an adapter silently drops must FAIL -------
check('P32', 'declared-io: dropped prop + unrenderable icon FAIL; used prop, warned drop, and rendered icon pass', () => {
  // H2a RED: a prop absent from the native body, with no divergence warning naming it.
  const propIr = { props: [{ name: 'precision', type: 'number' }], root: { kind: 'container', children: [] } };
  const dropped = { swiftui: { code: 'var body: some View {\n  VStack { Text(amount) }\n}', warnings: ['expr simplified to `amount` (native cannot eval "amount.toFixed(precision)")'] } };
  const rA = checkDeclaredDropped(propIr, dropped);
  assert(!rA.ok && rA.issues.some((i) => i.rule === 'declared-prop-dropped'), 'H2a must FAIL a prop that only survives in the quoted expr of a warning');
  // H2a GREEN — used in the body:
  assert(checkDeclaredDropped(propIr, { swiftui: { code: 'var body: some View {\n  Text(precision)\n}', warnings: [] } }).ok, 'a prop used in the body must pass');
  // H2a GREEN — a genuine (prose) divergence warning names it:
  assert(checkDeclaredDropped(propIr, { swiftui: { code: 'var body: some View {\n  VStack {}\n}', warnings: ['precision not applied on native (no number formatting)'] } }).ok, 'a documented divergence must pass');
  // H2b RED: an icon on a non-action / non-variant node is dropped on every adapter.
  const iconIr = { props: [], root: { kind: 'container', icon: 'icon.star', children: [] } };
  const rB = checkDeclaredDropped(iconIr, { react: { code: '<div></div>', warnings: [] }, swiftui: { code: 'var body: some View {}', warnings: [] } });
  assert(!rB.ok && rB.issues.some((i) => i.rule === 'declared-icon-dropped'), 'H2b must FAIL an icon on a non-rendering node');
  // H2b GREEN: an icon on an action node renders and must pass.
  const okIcon = { props: [], root: { kind: 'container', children: [{ kind: 'action', icon: 'icon.check', label: { kind: 'literal', value: 'Go' } }] } };
  assert(checkDeclaredDropped(okIcon, { react: { code: '<button><Check/></button>', warnings: [] } }).ok, 'an icon on an action must pass H2b');
});

// --- P33: F-9 — an expression variant discriminant is REFUSED; an enum passes --
check('P33', 'refusal: an expression variant discriminant is refused with an enum redirect; a plain enum is generated', () => {
  const exprSpec = { root: { el: 'container',
    variant: { prop: "d >= 0 ? 'positive' : 'negative'", cases: { positive: { color: 'color.success.fg' }, negative: { color: 'color.danger.fg' } } } } };
  const r = checkRefusal(exprSpec);
  assert(r && r.category === 'expression-variant', 'an expression discriminant must be refused');
  assert(/enum/.test(r.redirect) && /data layer/.test(r.reason), 'refusal must redirect to a plain enum in the data layer');
  // A plain enum discriminant (and a dotted member path) must NOT be refused.
  assert(checkRefusal({ root: { el: 'container', variant: { prop: 'direction', cases: { a: {} } } } }) === null, 'a plain enum discriminant must pass');
  assert(checkRefusal({ root: { el: 'container', variant: { prop: 'item.status', cases: { a: {} } } } }) === null, 'a dotted member path must pass');
  // Existing category refusals are unchanged.
  assert(checkRefusal({ category: 'overlay' })?.category === 'overlay', 'overlay refusal must be unchanged');
});

// --- P34: F-10 — a standalone `el: icon` renders on all 6; declared-io catches its loss --
check('P34', 'icon element: a standalone icon renders on every adapter; declared-io flags a misplaced icon', () => {
  const gens = { react: generateReact, vue: generateVue, svelte: generateSvelte, 'react-native': generateReactNative, swiftui: generateSwiftUI, compose: generateCompose };
  for (const [name, gen] of Object.entries(gens)) {
    const { code } = gen(EMPTY_STATE, '_verify');
    assert(/star/i.test(code), `${name}: the standalone icon (star) must render`);
  }
  // declared-io passes when the icon is an `el: icon`, fails when it sits on a plain container.
  const okIr = { props: [], root: { kind: 'container', children: [{ kind: 'icon', icon: 'icon.star' }] } };
  assert(checkDeclaredDropped(okIr, { react: { code: '<Star/>', warnings: [] } }).ok, 'an el:icon must satisfy declared-io');
  const badIr = { props: [], root: { kind: 'container', icon: 'icon.star', children: [] } };
  assert(!checkDeclaredDropped(badIr, { react: { code: '<div/>', warnings: [] } }).ok, 'an icon on a plain container must still FAIL declared-io');
});

// --- P35: F-11 — native precision formatting is emitted; declared-io catches its loss --
check('P35', 'number-format: SwiftUI/Compose format precision natively; declared-io flags a dropped precision', () => {
  const sw = generateSwiftUI(TOKEN_AMOUNT, '_verify').code;
  assert(/NumberFormatter\(\)/.test(sw) && /minimumFractionDigits = Int\(precision\)/.test(sw), 'swiftui must format via NumberFormatter with precision fraction digits');
  const cp = generateCompose(TOKEN_AMOUNT, '_verify').code;
  assert(/NumberFormat\.getNumberInstance/.test(cp) && /minimumFractionDigits = precision\.toInt\(\)/.test(cp), 'compose must format via NumberFormat with precision fraction digits');
  // Real generated native output must satisfy declared-io (precision now used).
  const ir = specToIrFromFile(TOKEN_AMOUNT);
  const real = { swiftui: generateSwiftUI(TOKEN_AMOUNT, '_verify'), compose: generateCompose(TOKEN_AMOUNT, '_verify') };
  assert(checkDeclaredDropped(ir, real).ok, 'formatted native output must pass declared-io');
  // If precision is dropped (raw amount, no formatter, no warning), declared-io FAILS.
  const dropped = { swiftui: { code: 'var body: some View {\n  Text(String(describing: amount))\n}', warnings: [] } };
  assert(!checkDeclaredDropped(ir, dropped).ok, 'a dropped precision must FAIL declared-io');
});

// --- P36: F-3 shape 1 — one-way conditional (show/hide) on every adapter ------
check('P36', 'conditional: shape 1 (if) renders the native show/hide construct on all 6, no else', () => {
  const expect = [
    [generateReact, /\{showNote && \(/, /\? \(/],
    [generateVue, /<template v-if="showNote">/, /v-else/],
    [generateSvelte, /\{#if showNote\}/, /\{:else\}/],
    [generateReactNative, /\{showNote && \(/, /\? \(/],
    [generateSwiftUI, /if showNote \{/, /\} else \{/],
    [generateCompose, /if \(showNote\) \{/, /\} else \{/],
  ];
  for (const [gen, present, elseRe] of expect) {
    const { code } = gen(CONDSHOW, '_verify');
    assert(present.test(code), `${gen.name} missing the one-way conditional construct`);
    assert(!elseRe.test(code), `${gen.name} must not emit an else branch for a one-way conditional`);
  }
});

// --- P37: F-3 shape 2 — if/else (either/or), Avatar image-vs-initials ----------
check('P37', 'conditional: shape 2 (if/else) emits both branches as native conditionals on all 6', () => {
  const expect = [
    [generateReact, /\{hasImage \? \(/, /<img /, /initials/],
    [generateVue, /<template v-if="hasImage">/, /<template v-else>/, /initials/],
    [generateSvelte, /\{#if hasImage\}/, /\{:else\}/, /initials/],
    [generateReactNative, /\{hasImage \? \(/, /<Image /, /initials/],
    [generateSwiftUI, /if hasImage \{/, /\} else \{/, /initials/],
    [generateCompose, /if \(hasImage\) \{/, /\} else \{/, /initials/],
  ];
  for (const [gen, thenRe, elseRe, initRe] of expect) {
    const { code } = gen(AVATAR, '_verify');
    assert(thenRe.test(code), `${gen.name} missing the if branch`);
    assert(elseRe.test(code), `${gen.name} missing the else branch`);
    assert(initRe.test(code), `${gen.name} missing the else (initials) content`);
  }
});

// --- P38: F-3 shape 3 — conditional wrapping one-level iteration ---------------
check('P38', 'conditional: shape 3 chooses fallback vs list; iteration still renders inside the else branch', () => {
  const expect = [
    [generateReact, /isEmpty \? \(/, /items\.map\(\(item\)/],
    [generateVue, /<template v-if="isEmpty">/, /v-for="item in items"/],
    [generateSvelte, /\{#if isEmpty\}/, /\{#each items as item/],
    [generateReactNative, /isEmpty \? \(/, /items\.map\(\(item\)/],
    [generateSwiftUI, /if isEmpty \{/, /ForEach\(items, id: \\\.id\)/],
    [generateCompose, /if \(isEmpty\) \{/, /items\.forEach \{ item ->/],
  ];
  for (const [gen, condRe, iterRe] of expect) {
    const { code } = gen(CONDLIST, '_verify');
    assert(condRe.test(code), `${gen.name} missing the conditional on isEmpty`);
    assert(iterRe.test(code), `${gen.name} missing the iteration inside the else branch`);
  }
});

// --- P39: F-3 — an expression condition is REFUSED; a boolean flag passes -------
check('P39', 'refusal: an expression condition is refused with a flag redirect; a plain flag passes', () => {
  const exprCond = { root: { el: 'container', children: [
    { el: 'conditional', when: 'items.length > 0', then: { el: 'text', text: { kind: 'ref', value: 'x' } } },
  ] } };
  const r = checkRefusal(exprCond);
  assert(r && r.category === 'expression-condition', 'an expression condition must be refused');
  assert(/boolean flag/.test(r.redirect) && /data layer/.test(r.reason), 'must redirect to a data-layer boolean flag');
  // A plain boolean flag condition is NOT refused.
  assert(checkRefusal({ root: { el: 'container', children: [
    { el: 'conditional', when: 'isEmpty', then: { el: 'text', text: { kind: 'ref', value: 'x' } } },
  ] } }) === null, 'a plain boolean flag condition must pass');
  // The F-9 variant-expression refusal still fires (regression guard).
  assert(checkRefusal({ root: { el: 'container', variant: { prop: "d >= 0 ? 'a' : 'b'", cases: { a: {} } } } })?.category === 'expression-variant', 'variant-expression refusal must be unchanged');
});

const CHECKBOX = resolve(ROOT, '.claude/artifacts/checkbox/design-spec.yaml');
const SWITCH = resolve(ROOT, '.claude/artifacts/switch-toggle/design-spec.yaml');
const SLIDER = resolve(ROOT, '.claude/artifacts/slider/design-spec.yaml');

// A minimal renderer that emits nothing and accounts for nothing, used to prove
// the Lowering Ledger derives `pending` from the IR (no whitelist) and records a
// silent drop as `unaccounted`.
class NoopRenderer extends RendererBase {
  visitText() { return ''; }
  visitContainer(_n, c) { return c; }
  renderComponent(r) { return r; }
}

// --- P40: Lowering Ledger — an unaccounted trait FAILS, naming adapter/component/trait
check('P40', 'ledger: a trait neither expressed nor diverged is `unaccounted` and FAILS, naming adapter/component/trait', () => {
  // A renderer that drops a declared role leaves it pending -> unaccounted.
  const ir = { component: 'Widget', props: [], root: { kind: 'text', role: 'status', text: { kind: 'literal', value: 'x' } } };
  const dropped = new NoopRenderer(ir, { adapter: 'react' });
  dropped.build();
  const un = dropped.ledger.filter((e) => e.status === 'unaccounted');
  assert(un.length === 1 && un[0].traitId === 'role=status', 'a dropped trait must be recorded unaccounted');
  const res = checkLedger(dropped.ledger);
  assert(!res.ok, 'unaccounted must FAIL the ledger gate');
  const msg = res.issues.map((i) => i.msg).join('\n');
  assert(/react/.test(msg) && /Widget/.test(msg) && /role=status/.test(msg), 'the failure must name adapter, component and traitId');
  // Expressing the same trait makes it PASS — the gate reads the ledger, not source.
  const expressed = new NoopRenderer(ir, { adapter: 'react' });
  expressed._pending = new Set(expressed.declaredTraits(ir.root));
  expressed._pendingNode = ir.root;
  expressed.express('role=status', { mechanism: 'role="status"' });
  assert(checkLedger([...expressed.ledger]).ok, 'an expressed trait must PASS');
});

// --- P41: no whitelist — a brand-NEW trait id is enforced with zero gate edits ---
check('P41', 'ledger: a never-before-seen role value auto-enrolls from the IR and is enforced (no whitelist)', () => {
  const NOVEL = 'quantum-frobnicator-3000';
  const base = new RendererBase({ component: 'X', props: [], root: {} });
  // declaredTraits derives the pending set purely from the IR node — a novel role
  // enrolls with no code that knows about it.
  const traits = base.declaredTraits({ role: NOVEL, a11y: { label: { kind: 'literal', value: 'l' } } });
  assert(traits.includes(`role=${NOVEL}`), 'a novel role value must auto-enrol as a pending trait');
  // End-to-end: a renderer that does not handle the novel role drops it -> unaccounted -> FAIL,
  // without any edit to ledger-gate.mjs or a role list.
  const ir = { component: 'Novel', props: [], root: { kind: 'text', role: NOVEL, text: { kind: 'literal', value: 'x' } } };
  const r = new NoopRenderer(ir, { adapter: 'svelte' });
  r.build();
  const res = checkLedger(r.ledger);
  assert(!res.ok && res.issues.some((i) => i.msg.includes(`role=${NOVEL}`)), 'the unseen trait must be enforced and named on FAIL');
});

// --- P42: form-control roles are EXPRESSED (real native control) on all 3 natives
check('P42', 'ledger: checkbox/switch/slider roles are expressed with a real native mechanism on RN, SwiftUI, Compose', () => {
  const cases = [
    { spec: CHECKBOX, role: 'checkbox', rn: /<Switch\b[^>]*accessibilityRole="checkbox"/, swift: /Toggle\(/, compose: /Checkbox\(checked/ },
    { spec: SWITCH, role: 'switch', rn: /<Switch\b[^>]*accessibilityRole="switch"/, swift: /Toggle\(/, compose: /Switch\(checked/ },
    { spec: SLIDER, role: 'slider', rn: /<Slider\b[^>]*accessibilityRole="adjustable"/, swift: /Slider\(value:/, compose: /Slider\(value =/ },
  ];
  for (const c of cases) {
    const gens = { 'react-native': generateReactNative, swiftui: generateSwiftUI, compose: generateCompose };
    const pats = { 'react-native': c.rn, swiftui: c.swift, compose: c.compose };
    const entries = [];
    for (const [ad, gen] of Object.entries(gens)) {
      const out = gen(c.spec, `verify-${c.role}`);
      entries.push(...out.ledger);
      // The role is expressed (not diverged, not dropped) with a real mechanism.
      const e = out.ledger.find((x) => x.traitId === `role=${c.role}`);
      assert(e && e.status === 'expressed' && e.mechanism, `${ad}: role=${c.role} must be expressed with a mechanism, got ${JSON.stringify(e)}`);
      // The real native control appears in the generated source.
      assert(pats[ad].test(out.code), `${ad}: expected a real ${c.role} control in output`);
    }
    // No unaccounted anywhere for these controls; ledger gate passes.
    assert(!entries.some((e) => e.status === 'unaccounted'), `${c.role}: no trait may be unaccounted`);
    assert(checkLedger(entries).ok, `${c.role}: ledger gate must pass`);
  }
});

// --- P43: waiver policy — an expired / unapproved waiver cannot authorize a divergence
check('P43', 'ledger: a divergence needs a matching, non-expired, approved waiver; expired/unknown ones FAIL', () => {
  const diverged = [{ component: 'C', adapter: 'swiftui', kind: 'container', traitId: 'role=group', status: 'diverged', waiver: 'a11y-role-group' }];
  // Valid, non-expired waiver in the registry -> PASS.
  assert(checkLedger(diverged, { now: new Date('2026-09-24') }).ok, 'a valid waiver must authorize the divergence');
  // Same waiver evaluated far in the future (past its expiry) -> FAIL.
  assert(!checkLedger(diverged, { now: new Date('2999-01-01') }).ok, 'an expired waiver must not authorize a divergence');
  // A divergence citing an unknown waiver id -> FAIL.
  const unknown = [{ component: 'C', adapter: 'swiftui', kind: 'container', traitId: 'role=zzz', status: 'diverged', waiver: 'no-such-waiver' }];
  assert(!checkLedger(unknown).ok, 'an unknown waiver id must FAIL');
  // Every waiver actually in the registry is well-formed (approver + future expiry).
  const { problems } = loadWaivers(new Date('2026-09-24'));
  assert(problems.length === 0, `registry must have no open-ended/expired waivers: ${problems.join('; ')}`);
});

// --- P44: Layer 3 — gate mutation testing runs, baseline clean, known-defect
//         mutants killed per operator, only the one remaining blind spot survives.
check('P44', 'mutation testing: baseline all-green; each killer operator kills its mutants; only F-22 survives', () => {
  const { baselineFailures, mutants, survived } = runMutationTesting();
  assert(baselineFailures.length === 0, `mutation baseline must be all-green, got RED: ${baselineFailures.map((f) => f.feature).join(', ')}`);
  assert(mutants.length > 0, 'the harness must generate mutants');

  // The killing operators must kill EVERY mutant they inject (each is a proven
  // gate). hardcode-token-native is now a killer (F-21 resolved: token-guard
  // covers native). If a gate regresses, one of these would survive.
  const KILLERS = ['drop-trait', 'remove-a11y', 'native-expr-leak', 'ref-as-literal', 'hardcode-token-web', 'hardcode-token-native', 'unresolved-tbd'];
  for (const op of KILLERS) {
    const ms = mutants.filter((m) => m.operator === op);
    assert(ms.length > 0, `operator ${op} produced no mutants`);
    const survivors = ms.filter((m) => !m.killed);
    assert(survivors.length === 0, `operator ${op} must kill all its mutants; survivors: ${survivors.map((s) => s.key).join(', ')}`);
  }

  // Representative operator -> the gate that must catch it (kill attribution).
  const killerGate = (op, gate) => {
    const m = mutants.find((x) => x.operator === op && x.killed);
    assert(m && m.red.includes(gate), `operator ${op} must be killed by the ${gate} gate (red: ${m ? m.red.join(',') : 'none'})`);
  };
  killerGate('drop-trait', 'ledger');
  killerGate('remove-a11y', 'a11y');
  killerGate('native-expr-leak', 'native-code');
  killerGate('ref-as-literal', 'parity');
  killerGate('hardcode-token-web', 'token');
  killerGate('hardcode-token-native', 'token'); // F-21: native hardcode now RED via token-guard
  killerGate('unresolved-tbd', 'readiness');

  // Every survivor must be a KNOWN blind spot (logged finding). A new survivor
  // class is a fresh blind spot and must fail here so it cannot ship silently.
  const KNOWN = new Set(['state-by-color-only']);
  const unexpected = survived.filter((m) => !KNOWN.has(m.operator));
  assert(unexpected.length === 0, `unexpected surviving mutant (new blind spot): ${unexpected.map((m) => m.key).join(', ')}`);
  // F-21 must no longer survive (token-guard now covers native).
  assert(!survived.some((m) => m.operator === 'hardcode-token-native'), 'F-21 must be resolved: native token hardcode must NOT survive');
  // F-22 remains a known advisory-only survivor (intentional severity choice).
  assert(survived.some((m) => m.operator === 'state-by-color-only'), 'F-22 blind spot (state-by-color-only advisory) expected to survive');
});

// --- P45: F-21 — token-guard now covers NATIVE adapters. A hardcoded color/size
//         literal that has a token equivalent is RED (per native adapter); a
//         legitimate token reference is GREEN (no over-flag).
check('P45', 'token-guard (native): hardcoded color/dimension literal FAILs per native adapter; a token reference passes', () => {
  const irStub = { tokens: [], root: { kind: 'container' } };
  const wrap = (adapter, code) => ({ [adapter]: { code } });

  // 1. Hardcoded COLOR literal -> serious -> gate RED, naming adapter + value.
  const colorCases = {
    swiftui: '.background(Color(hex: "#ef4444"))',
    compose: '.background(Color(0xFFEF4444))',
    'react-native': 'style={{ backgroundColor: "#ef4444" }}',
  };
  for (const [adapter, snippet] of Object.entries(colorCases)) {
    const r = checkTokens(irStub, wrap(adapter, snippet));
    assert(!r.ok, `${adapter}: a hardcoded color literal must FAIL token-guard`);
    assert(r.issues.some((i) => i.rule === 'hardcoded-color-native' && i.msg.includes(adapter)), `${adapter}: failure must name the adapter and be a native color rule`);
  }

  // 2. Hardcoded DIMENSION literal -> moderate rule present (advisory, mirrors web px).
  const dimCases = {
    swiftui: '.padding(12)',
    compose: 'Modifier.padding(12.dp)',
    'react-native': 'style={{ padding: 12 }}',
  };
  for (const [adapter, snippet] of Object.entries(dimCases)) {
    const r = checkTokens(irStub, wrap(adapter, snippet));
    assert(r.issues.some((i) => i.rule === 'hardcoded-dimension-native' && i.msg.includes(adapter)), `${adapter}: a hardcoded dimension literal must be flagged`);
  }

  // 3. Legitimate token references must NOT be flagged (no over-flag), including
  //    the SwiftUI Color(DesignTokens.X) wrapper and the VStack `spacing: 8`
  //    layout constant, and the 0/1 dimension exemption.
  const legit = {
    swiftui: 'VStack(alignment: .leading, spacing: 8) {}\n.background(Color(DesignTokens.ColorFgDefault))\n.padding(DesignTokens.SpaceInsetMd)\n.cornerRadius(DesignTokens.RadiusControl)',
    compose: 'Column(modifier = Modifier.padding(DesignTokens.SpaceInsetSm).background(DesignTokens.ColorSuccessBg)) {}',
    'react-native': 'style={{ backgroundColor: tokens.color.bg.default, padding: tokens.space.inset.md, borderWidth: 1, flexShrink: 0 }}',
  };
  for (const [adapter, snippet] of Object.entries(legit)) {
    const r = checkTokens(irStub, wrap(adapter, snippet));
    const native = r.issues.filter((i) => i.rule?.endsWith('-native'));
    assert(native.length === 0, `${adapter}: legitimate token references must not be flagged, got: ${native.map((i) => i.msg).join('; ')}`);
  }

  // 4. Web behavior is unchanged: web still flags raw hex (serious) and raw px (moderate).
  const web = checkTokens(irStub, { react: { code: "color: '#ef4444'; padding: 12px" } });
  assert(web.issues.some((i) => i.rule === 'hardcoded-color'), 'web raw hex rule unchanged');
  assert(web.issues.some((i) => i.rule === 'hardcoded-dimension'), 'web raw px rule unchanged');
});

// --- Control-state primitive (P46-P49) ---------------------------------------
const STATE_BOOL = resolve(ROOT, '.claude/artifacts/state-boolean/design-spec.yaml');
const STATE_SELECT = resolve(ROOT, '.claude/artifacts/state-select/design-spec.yaml');
const STATE_RANGE = resolve(ROOT, '.claude/artifacts/state-range/design-spec.yaml');
const genAll = (spec, feat) => ({
  react: generateReact(spec, feat),
  vue: generateVue(spec, feat),
  svelte: generateSvelte(spec, feat),
  'react-native': generateReactNative(spec, feat),
  swiftui: generateSwiftUI(spec, feat),
  compose: generateCompose(spec, feat),
});
// Every adapter must express the state trait (no unaccounted) for the feature.
const assertStateExpressed = (out, kind) => {
  for (const [ad, r] of Object.entries(out)) {
    const e = r.ledger.find((x) => x.traitId === `state=${kind}`);
    assert(e && e.status === 'expressed' && e.mechanism, `${ad}: state=${kind} must be expressed with a mechanism`);
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
};

// --- P46: boolean control-state binding across all 6 adapters ----------------
check('P46', 'control-state: a boolean binding renders as a native two-way binding on all 6, state trait accounted', () => {
  const out = genAll(STATE_BOOL, 'verify-state-boolean');
  const pat = {
    react: /type="checkbox" checked=\{enabled\} onChange=\{\(e\) => onEnabledChange\(e\.target\.checked\)\}/,
    vue: /type="checkbox" :checked="enabled" @change="onEnabledChange\(/,
    svelte: /type="checkbox" checked=\{enabled\} on:change=\{\(e\) => onEnabledChange\(e\.currentTarget\.checked\)\}/,
    'react-native': /<Switch value=\{enabled\} onValueChange=\{onEnabledChange\}/,
    swiftui: /Toggle\([^)]*isOn: Binding\(get: \{ enabled \}, set: \{ onEnabledChange\(\$0\) \}\)\)/,
    compose: /Checkbox\(checked = enabled, onCheckedChange = onEnabledChange\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: boolean two-way binding not found`);
  assertStateExpressed(out, 'boolean');
});

// --- P47: selected-value (one-of-N) binding across all 6 ---------------------
check('P47', 'control-state: a selected-value binding renders as a native one-of-N binding on all 6, state trait accounted', () => {
  const out = genAll(STATE_SELECT, 'verify-state-select');
  const pat = {
    react: /<select [^>]*value=\{choice\} onChange=\{\(e\) => onChoiceChange\(e\.target\.value\)\}/,
    vue: /<select [^>]*:value="choice" @change="onChoiceChange\(/,
    svelte: /<select [^>]*value=\{choice\} on:change=\{\(e\) => onChoiceChange\(e\.currentTarget\.value\)\}/,
    'react-native': /<Picker selectedValue=\{choice\} onValueChange=\{onChoiceChange\}/,
    swiftui: /Picker\([^)]*selection: Binding\(get: \{ choice \}, set: \{ onChoiceChange\(\$0\) \}\)\)/,
    compose: /val selectedValue = choice[\s\S]*val onSelectedChange = onChoiceChange/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: selected-value binding not found`);
  assertStateExpressed(out, 'selected-value');
  // RN pulls in the Picker import.
  assert(/@react-native-picker\/picker/.test(out['react-native'].code), 'react-native must import Picker');
});

// --- P48: numeric-range value + min/max/step across all 6 (no formatting) ----
check('P48', 'control-state: a numeric-range binding renders value + min/max/step on all 6, no formatting, state trait accounted', () => {
  const out = genAll(STATE_RANGE, 'verify-state-range');
  const pat = {
    react: /type="range" value=\{volume\} onChange=\{\(e\) => onVolumeChange\(Number\(e\.target\.value\)\)\} min=\{0\} max=\{100\} step=\{5\}/,
    vue: /type="range" :value="volume" @input="onVolumeChange\(Number\([^"]*\)\)" :min="0" :max="100" :step="5"/,
    svelte: /type="range" value=\{volume\} on:input=\{\(e\) => onVolumeChange\(Number\(e\.currentTarget\.value\)\)\} min=\{0\} max=\{100\} step=\{5\}/,
    'react-native': /<Slider value=\{volume\} onValueChange=\{onVolumeChange\}[^/]*minimumValue=\{0\} maximumValue=\{100\} step=\{5\}/,
    swiftui: /Slider\(value: Binding\(get: \{ volume \}, set: \{ onVolumeChange\(\$0\) \}\), in: 0\.\.\.100, step: 5\)/,
    compose: /Slider\(value = volume, onValueChange = onVolumeChange, valueRange = 0f\.\.100f, steps = 19\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: numeric-range binding not found`);
  assertStateExpressed(out, 'numeric-range');
  // Scope guard 3: range is a value constraint, NOT display formatting.
  for (const [ad, r] of Object.entries(out)) {
    assert(!/toFixed|NumberFormat|NumberFormatter/.test(r.code), `${ad}: numeric-range must not introduce number formatting`);
  }
});

// --- P49: an expression used as a control-state binding is REFUSED -----------
check('P49', 'refusal: an expression as bound value / handler / range-ref is refused with the ref redirect; plain refs pass', () => {
  const mk = (input) => ({ category: 'input', root: { el: 'container', children: [{ el: 'input', label: { kind: 'literal', value: 'x' }, input }] } });
  const exprVal = checkRefusal(mk({ valueProp: 'items.length > 0', changeProp: 'onX', state: { kind: 'boolean' } }));
  assert(exprVal?.category === 'expression-binding' && /ref/.test(exprVal.redirect), 'an expression bound value must be refused with a ref redirect');
  assert(checkRefusal(mk({ valueProp: 'x', changeProp: 'v => setX(v)', state: { kind: 'boolean' } }))?.category === 'expression-binding', 'an expression change handler must be refused');
  assert(checkRefusal(mk({ valueProp: 'x', changeProp: 'onX', state: { kind: 'numeric-range', min: 'a - 1', max: 100 } }))?.category === 'expression-binding', 'an expression range ref must be refused');
  // Plain refs / numeric literals / plain-identifier refs are NOT refused.
  assert(checkRefusal(mk({ valueProp: 'enabled', changeProp: 'onEnabledChange', state: { kind: 'boolean' } })) === null, 'a plain boolean binding must pass');
  assert(checkRefusal(mk({ valueProp: 'volume', changeProp: 'onVolumeChange', state: { kind: 'numeric-range', min: 0, max: 100, step: 5 } })) === null, 'plain numeric-range with literal constraints must pass');
  assert(checkRefusal(mk({ valueProp: 'v', changeProp: 'onV', state: { kind: 'numeric-range', min: 'lo', max: 'hi' } })) === null, 'plain-identifier range refs must pass');
  // The F-9 variant-expression refusal is unchanged (regression guard).
  assert(checkRefusal({ root: { el: 'container', variant: { prop: "d >= 0 ? 'a' : 'b'", cases: { a: {} } } } })?.category === 'expression-variant', 'variant-expression refusal must be unchanged');
});

console.log('\n=== verify-patches ===');
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
