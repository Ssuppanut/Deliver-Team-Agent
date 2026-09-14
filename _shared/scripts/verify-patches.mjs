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
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const EX = (f) => resolve(ROOT, '_shared/schemas/examples', f);
const PRODUCT = EX('product-card.spec.yaml');
const LIST = EX('user-card-list.spec.yaml');
const ALERT = resolve(ROOT, '.claude/artifacts/alert/design-spec.yaml');
const FORM = resolve(ROOT, '.claude/artifacts/form-field/design-spec.yaml');

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

console.log('\n=== verify-patches ===');
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
