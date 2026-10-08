#!/usr/bin/env node
/**
 * verify-patches — self-verification / regression harness.
 * Each check pins a fix or a pipeline invariant so future edits can't silently
 * regress it. Run in CI and after any adapter change.
 */
import { resolve, dirname, join } from 'node:path';
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
import { loadSpec, validate } from './validate-schema.mjs';
import { validateBriefs } from './validate-brief.mjs';
import { checkTraitRegistryGate, formatReport } from './check-trait-registry.mjs';
import { checkCorpusCoverage, formatCoverageReport, ALLOWLIST_PATH } from './check-corpus-coverage.mjs';
import { checkLiveLowering, formatLiveReport, EXPECTATIONS_PATH as LIVE_EXPECTATIONS_PATH, RULES as RULES_L } from './check-live-lowering.mjs';
import { parse as parseYaml } from 'yaml';
import { ADAPTERS as D3_ADAPTERS, codeHandledTraitIdsByAdapter, exercisedConstructs, deriveConstructs, deriveSchemaConstructs, adapterStyleSlots, corpusStyleSlots, declaredTraitIds, handledTraitIds, loadTraitRegistry, checkTraitRegistry } from './schema-constructs.mjs';
import { route, loadContext } from '../../.ai/router/route.mjs';
import { loadWorkflow, evaluateWorkflow, runScenarios, lintWorkflow } from './workflow-eval.mjs';
import { skillRegistryDrift } from './skill-registry.mjs';
import { checkParity } from './e2e-multi.mjs';
import { checkNativeExprLeak, checkDeclaredDropped } from './output-guards.mjs';
import { checkLedger, loadWaivers } from './ledger-gate.mjs';
import { runMutationTesting } from './mutate-gates.mjs';
import { RendererBase } from '../../adapters/_shared/renderer-base.mjs';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// --- P18: F-22 — state-by-color-only is a BLOCKING a11y contract (moved from
//         slop advisory). A per-state icon clears it; color-only BLOCKS. -----
check('P18', 'a11y-guard: a status variant distinguished by colour alone BLOCKS; per-state icons clear it', () => {
  // Alert carries a per-severity icon (intent=status), so it must pass clean.
  const alert = checkA11y(specToIrFromFile(ALERT), { react: generateReact(ALERT, '_verify') });
  assert(alert.ok, 'alert with distinct per-state icons must pass a11y-guard');
  assert(!alert.issues.some((i) => i.rule === 'status-color-only'), 'distinct icons clear the status-color-only contract');
  // slop-guard must no longer own this rule (single source of truth in a11y).
  const slop = checkSlop(specToIrFromFile(ALERT), {});
  assert(!slop.issues.some((i) => i.rule === 'status-color-only'), 'slop-guard must no longer emit status-color-only');
  // A synthetic colour-only status variant (no icon) now BLOCKS at serious.
  const colorOnly = {
    props: [], tokens: [],
    root: { kind: 'container', variant: { prop: 'sev', cases: { a: { background: 'color.info.bg' }, b: { background: 'color.danger.bg' } } } },
  };
  const syn = checkA11y(colorOnly, {});
  assert(!syn.ok, 'a colour-only status variant must BLOCK (serious), not pass');
  assert(syn.issues.some((i) => i.rule === 'status-color-only' && i.severity === 'serious'), 'expected a serious status-color-only finding');
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
check('P44', 'mutation testing: baseline all-green; each killer operator kills its mutants; zero survivors', () => {
  const { baselineFailures, mutants, survived } = runMutationTesting();
  assert(baselineFailures.length === 0, `mutation baseline must be all-green, got RED: ${baselineFailures.map((f) => f.feature).join(', ')}`);
  assert(mutants.length > 0, 'the harness must generate mutants');

  // The killing operators must kill EVERY mutant they inject (each is a proven
  // gate). hardcode-token-native is now a killer (F-21 resolved: token-guard
  // covers native). If a gate regresses, one of these would survive.
  const KILLERS = ['drop-trait', 'remove-a11y', 'native-expr-leak', 'ref-as-literal', 'hardcode-token-web', 'hardcode-token-native', 'unresolved-tbd',
    // F-22: state-by-color-only became a blocking a11y contract; all four of its
    // operators must now kill every mutant they inject (0 survivors).
    'state-by-color-only', 'strip-icon-all-but-one', 'same-icon-every-case', 'flip-intent-to-emphasis',
    // PR A: an emptied link navigation body must be killed by the parity lint.
    'link-empty-body',
    // PR A2: a dropped or flipped layout axis must be killed by the parity lint.
    'layout-axis-drop-web', 'layout-axis-flip'];
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
  // F-22: each state-by-color-only operator is killed by the a11y gate.
  killerGate('state-by-color-only', 'a11y');
  killerGate('strip-icon-all-but-one', 'a11y');
  killerGate('same-icon-every-case', 'a11y');
  killerGate('flip-intent-to-emphasis', 'a11y');
  // PR A: the emptied-link-body mutant is killed by the parity nav-primitive lint.
  killerGate('link-empty-body', 'parity');
  // PR A2: dropped / flipped layout-axis mutants are killed by the parity axis lint.
  killerGate('layout-axis-drop-web', 'parity');
  killerGate('layout-axis-flip', 'parity');

  // Every survivor must be a KNOWN blind spot (logged finding). A new survivor
  // class is a fresh blind spot and must fail here so it cannot ship silently.
  // There are no known blind spots any more: every mutant must be killed.
  const KNOWN = new Set([]);
  const unexpected = survived.filter((m) => !KNOWN.has(m.operator));
  assert(unexpected.length === 0, `unexpected surviving mutant (new blind spot): ${unexpected.map((m) => m.key).join(', ')}`);
  // F-21 must no longer survive (token-guard now covers native).
  assert(!survived.some((m) => m.operator === 'hardcode-token-native'), 'F-21 must be resolved: native token hardcode must NOT survive');
  // F-22 must no longer survive (state-by-color-only is now a blocking a11y contract).
  assert(!survived.some((m) => m.operator === 'state-by-color-only'), 'F-22 must be resolved: state-by-color-only must NOT survive');
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

// --- Option-children capability (F-23): Select + RadioGroup (P50-P52) --------
const NATIVE_SELECT = resolve(ROOT, '.claude/artifacts/native-select/design-spec.yaml');
const RADIO_GROUP = resolve(ROOT, '.claude/artifacts/radio-group/design-spec.yaml');

// --- P50: native Select renders option children inside the bound control on all 6
check('P50', 'option-children: native Select renders <option>/items inside the value-matched control on all 6; state accounted', () => {
  const out = genAll(NATIVE_SELECT, 'verify-native-select');
  // Options are iterated inside the control on every adapter (not an empty control).
  const pat = {
    react: /<select [^>]*value=\{choice\}[\s\S]*options\.map\(\(opt\) =>[\s\S]*<option key=\{opt\.value\} value=\{opt\.value\}>\{opt\.label\}<\/option>[\s\S]*<\/select>/,
    vue: /<select [^>]*:value="choice"[\s\S]*<option v-for="opt in options" :key="opt\.value" :value="opt\.value">\{\{ opt\.label \}\}<\/option>[\s\S]*<\/select>/,
    svelte: /<select [^>]*value=\{choice\}[\s\S]*\{#each options as opt \(opt\.value\)\}[\s\S]*<option value=\{opt\.value\}>\{opt\.label\}<\/option>/,
    'react-native': /<Picker selectedValue=\{choice\}[\s\S]*options\.map\(\(opt\) =>[\s\S]*<Picker\.Item key=\{opt\.value\} label=\{opt\.label\} value=\{opt\.value\} \/>/,
    swiftui: /Picker\([^)]*selection: Binding[\s\S]*ForEach\(options, id: \\\.value\) \{ opt in[\s\S]*Text\(opt\.label\)\.tag\(opt\.value\)/,
    compose: /Column\(modifier = Modifier\.selectableGroup\(\)\) \{[\s\S]*options\.forEach \{ opt ->[\s\S]*RadioButton\(selected = choice == opt\.value, onClick = \{ onChoiceChange\(opt\.value\) \}\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: Select must render option children in the bound control`);
  assertStateExpressed(out, 'selected-value');
  // The SPEC authored no selection expression; native-code must stay green
  // (no un-evaluatable JS discriminant leaked into native output).
  for (const ad of ['swiftui', 'compose']) {
    assert(!/\?[^:]*:/.test(out[ad].code.replace(/https?:\/\//g, '')), `${ad}: no ternary/JS expression should leak into native output`);
  }
});

// --- P51: RadioGroup renders radiogroup/radio + options on all 6 --------------
check('P51', 'option-children: RadioGroup renders role=radiogroup + per-option radios/native match on all 6; role + state accounted', () => {
  const out = genAll(RADIO_GROUP, 'verify-radio-group');
  const pat = {
    react: /role="radiogroup"[\s\S]*options\.map\(\(opt\) =>[\s\S]*<input type="radio" name="[^"]*" value=\{opt\.value\} checked=\{choice === opt\.value\} onChange=\{\(\) => onChoiceChange\(opt\.value\)\}/,
    vue: /role="radiogroup"[\s\S]*<input type="radio" name="[^"]*" :value="opt\.value" :checked="choice === opt\.value" @change="onChoiceChange\(opt\.value\)"/,
    svelte: /role="radiogroup"[\s\S]*<input type="radio" name="[^"]*" value=\{opt\.value\} checked=\{choice === opt\.value\} on:change=\{\(\) => onChoiceChange\(opt\.value\)\}/,
    'react-native': /<View accessibilityRole="radiogroup"[\s\S]*<Pressable key=\{opt\.value\} accessibilityRole="radio" accessibilityState=\{\{ selected: choice === opt\.value \}\} onPress=\{\(\) => onChoiceChange\(opt\.value\)\}/,
    swiftui: /Picker\([^)]*selection: Binding[\s\S]*ForEach\(options, id: \\\.value\) \{ opt in/,
    compose: /RadioButton\(selected = choice == opt\.value, onClick = \{ onChoiceChange\(opt\.value\) \}\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: RadioGroup must render radiogroup + per-option selection`);
  // role=radiogroup expressed (web via role=, RN via accessibilityRole, SwiftUI via Picker, Compose via selectableGroup) and state accounted.
  for (const [ad, r] of Object.entries(out)) {
    assert(r.ledger.some((x) => x.traitId === 'role=radiogroup' && x.status === 'expressed'), `${ad}: role=radiogroup must be expressed`);
  }
  assertStateExpressed(out, 'selected-value');
});

// --- P52: selection refusals intact (F-9 boundary + overlay) ------------------
check('P52', 'refusal: expression as options / bound value is refused; custom-overlay select refused; plain option ref passes', () => {
  const sel = (input) => ({ category: 'input', root: { el: 'input', label: { kind: 'literal', value: 'x' }, input } });
  assert(checkRefusal({ category: 'overlay', root: { el: 'container' } })?.category === 'overlay', 'custom-overlay select must stay refused');
  assert(checkRefusal(sel({ valueProp: 'choice', changeProp: 'onChoice', state: { kind: 'selected-value', options: 'items.filter(x => x.ok)' } }))?.category === 'expression-binding', 'an expression options ref must be refused');
  assert(checkRefusal(sel({ valueProp: 'sel === "a" ? 1 : 2', changeProp: 'onChoice', state: { kind: 'selected-value', options: 'options' } }))?.category === 'expression-binding', 'an expression bound value must be refused');
  assert(checkRefusal(sel({ valueProp: 'choice', changeProp: 'onChoice', state: { kind: 'selected-value', options: 'options' } })) === null, 'a plain option ref + plain value must pass');
});

// --- P53: describedBy / invalid accounted in control-state on all 6 (F-24) ----
const CHECKBOX_ERROR = resolve(ROOT, '.claude/artifacts/checkbox-error/design-spec.yaml');
check('P53', 'control-state a11y: a control with an inline error accounts describedBy + invalid on all 6 (express or waiver-backed diverge), 0 unaccounted', () => {
  const out = genAll(CHECKBOX_ERROR, 'verify-checkbox-error');
  for (const [ad, r] of Object.entries(out)) {
    for (const trait of ['a11y.describedBy', 'a11y.invalid']) {
      const e = r.ledger.find((x) => x.traitId === trait);
      assert(e, `${ad}: ${trait} must be in the ledger`);
      assert(e.status === 'expressed' || (e.status === 'diverged' && e.waiver), `${ad}: ${trait} must be expressed or waiver-backed diverged, got ${e.status}`);
    }
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
  // Web expresses the real ARIA attributes in output; the whole feature's ledger passes.
  for (const ad of ['react', 'vue', 'svelte']) {
    assert(/aria-invalid/.test(out[ad].code) && /aria-describedby/.test(out[ad].code), `${ad}: must emit aria-invalid + aria-describedby`);
  }
  const ledger = Object.values(out).flatMap((r) => r.ledger);
  assert(checkLedger(ledger).ok, 'checkbox-error ledger gate must pass (describedBy/invalid accounted)');
});

// --- Schema-expressiveness long-tail (Phase H): P54-P57 ----------------------
const DIVIDER = resolve(ROOT, '.claude/artifacts/divider/design-spec.yaml');
const TEXTAREA = resolve(ROOT, '.claude/artifacts/textarea/design-spec.yaml');
const assertTraitExpressed = (out, traitId) => {
  for (const [ad, r] of Object.entries(out)) {
    const e = r.ledger.find((x) => x.traitId === traitId);
    assert(e && e.status === 'expressed' && e.mechanism, `${ad}: ${traitId} must be expressed with a mechanism`);
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
};

// --- P54: F-4 orientation renders on all 6 (web aria-orientation, native axis)
check('P54', 'orientation (F-4): Divider vertical renders aria-orientation on web + layout axis on native across all 6; trait expressed, 0 unaccounted', () => {
  const out = genAll(DIVIDER, 'verify-divider');
  const pat = {
    react: /role="separator" aria-orientation="vertical"/,
    vue: /role="separator" aria-orientation="vertical"/,
    svelte: /role="separator" aria-orientation="vertical"/,
    'react-native': /flexDirection: "column"/,
    swiftui: /VStack\(alignment: \.leading/,
    compose: /Column\(modifier = Modifier\.background\(DesignTokens\.ColorBorderDefault\)\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: orientation not rendered as expected`);
  assertTraitExpressed(out, 'orientation=vertical');
});

// --- P55: F-5 boolean-attribute binding (disabled) on all 6 + expression refused
check('P55', 'boolean-attr (F-5): Button disabled flag-ref renders the platform disabled mechanism on all 6; expression-as-disabled is refused, plain flag passes', () => {
  const out = genAll(BUTTON, 'verify-button-disabled');
  const pat = {
    react: /disabled=\{disabled\}/,
    vue: /:disabled="disabled"/,
    svelte: /disabled=\{disabled\}/,
    'react-native': /disabled=\{disabled\} accessibilityState=\{\{ disabled: disabled \}\}/,
    swiftui: /\.disabled\(disabled\)/,
    compose: /enabled = !disabled/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: disabled binding not found`);
  assertTraitExpressed(out, 'disabled');
  // Refusal: an expression as `disabled` is refused (F-9-consistent); a plain flag passes.
  const mk = (disabled) => ({ category: 'input', root: { el: 'action', label: { kind: 'literal', value: 'x' }, onEvent: 'onClick', disabled } });
  assert(checkRefusal(mk('isBusy || n > 3'))?.category === 'expression-boolean-attr', 'an expression as disabled must be refused');
  assert(checkRefusal(mk('shouldDisable()'))?.category === 'expression-boolean-attr', 'a call as disabled must be refused');
  assert(checkRefusal(mk('disabled')) === null, 'a plain boolean flag ref must pass');
});

// --- P56: F-7 size slot references a dimension TOKEN (no hardcoded native size)
check('P56', 'size (F-7): Spinner size renders as a token-referenced width/height on all 6; token-guard stays green (no hardcoded native size), trait expressed', () => {
  const out = genAll(SPINNER, 'verify-spinner-size');
  const pat = {
    react: /width: 'var\(--space-6\)', height: 'var\(--space-6\)'/,
    vue: /width: var\(--space-6\); height: var\(--space-6\)/,
    svelte: /width: var\(--space-6\); height: var\(--space-6\)/,
    'react-native': /width: tokens\.space\.6, height: tokens\.space\.6/,
    swiftui: /\.frame\(width: DesignTokens\.Space6, height: DesignTokens\.Space6\)/,
    compose: /\.size\(DesignTokens\.Space6\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: size not rendered as a token dimension`);
  assertTraitExpressed(out, 'size');
  // The whole point of F-7: a size must be token-driven — token-guard must pass
  // (a hardcoded native dimension would FAIL here).
  const ir = specToIrFromFile(SPINNER);
  assert(checkTokens(ir, out).ok, 'token-guard must pass for a token-referenced size (no hardcoded dimension)');
});

// --- P57: F-19 textarea (multiline) renders on all 6 -------------------------
check('P57', 'textarea (F-19): a multiline text input renders the textarea variant on all 6; input.multiline expressed, 0 unaccounted', () => {
  const out = genAll(TEXTAREA, 'verify-textarea');
  const pat = {
    react: /<textarea id="[^"]*" value=\{value\} onChange=/,
    vue: /<textarea id="[^"]*" :value="value" @input=[^>]*><\/textarea>/,
    svelte: /<textarea id="[^"]*" value=\{value\} on:input=\{[\s\S]*?\}><\/textarea>/,
    'react-native': /<TextInput multiline value=\{value\} onChangeText=\{onChange\}/,
    swiftui: /TextField\(label, text: Binding\(get: \{ value \}, set: \{ onChange\(\$0\) \}\), axis: \.vertical\)/,
    compose: /TextField\(value = value, onValueChange = onChange, label = \{ Text\(label\) \}, singleLine = false\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: textarea variant not rendered as expected`);
  assertTraitExpressed(out, 'input.multiline');
});

// --- F-13 nested / else-if / per-item conditionals (P58-P62) -----------------
const COND_NESTED = EX('cond-nested.spec.yaml');
const COND_ELSEIF = EX('cond-elseif.spec.yaml');
const COND_PERITEM = EX('cond-peritem.spec.yaml');
const condGenAll = (spec, feat) => ({
  react: generateReact(spec, feat), vue: generateVue(spec, feat), svelte: generateSvelte(spec, feat),
  'react-native': generateReactNative(spec, feat), swiftui: generateSwiftUI(spec, feat), compose: generateCompose(spec, feat),
});
const noUnaccounted = (out) => {
  for (const [ad, r] of Object.entries(out)) assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
};

// --- P58: nested conditional (if A → (if B → a else b) else c) on all 6 -------
check('P58', 'conditional (F-13): a nested conditional lowers to native nested if/else on all 6; JSX wraps once (no {} inside {}), 0 unaccounted', () => {
  const out = condGenAll(COND_NESTED, 'verify-cond-nested');
  const pat = {
    // React/RN: a single {} wrapper, inner ternary is bare (no nested {}).
    react: /\{outer \? \(\s*inner \? \(/,
    'react-native': /\{outer \? \(\s*inner \? \(/,
    vue: /<template v-if="outer">[\s\S]*<template v-if="inner">[\s\S]*<template v-else>[\s\S]*<template v-else>/,
    svelte: /\{#if outer\}[\s\S]*\{#if inner\}[\s\S]*\{:else\}[\s\S]*\{:else\}/,
    swiftui: /if outer \{[\s\S]*if inner \{[\s\S]*\} else \{[\s\S]*\} else \{/,
    compose: /if \(outer\) \{[\s\S]*if \(inner\) \{[\s\S]*\} else \{[\s\S]*\} else \{/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: nested conditional not rendered natively`);
  // JSX: exactly one expression container opens the whole conditional (no `{` re-opened inside).
  for (const ad of ['react', 'react-native']) {
    assert(!/\(\s*\{[a-z]/.test(out[ad].code), `${ad}: nested conditional must not emit {} inside {}`);
  }
  noUnaccounted(out);
});

// --- P59: else-if chain (if A → x, else if B → y, else z) on all 6 ------------
check('P59', 'conditional (F-13): a 3-way else-if chain lowers to the native else-if idiom on all 6, 0 unaccounted', () => {
  const out = condGenAll(COND_ELSEIF, 'verify-cond-elseif');
  const pat = {
    react: /\{isPrimary \? \([\s\S]*\) : \(\s*isSecondary \? \(/,
    'react-native': /\{isPrimary \? \([\s\S]*\) : \(\s*isSecondary \? \(/,
    vue: /<template v-if="isPrimary">[\s\S]*<template v-else-if="isSecondary">[\s\S]*<template v-else>/,
    svelte: /\{#if isPrimary\}[\s\S]*\{:else if isSecondary\}[\s\S]*\{:else\}/,
    swiftui: /if isPrimary \{[\s\S]*\} else if isSecondary \{[\s\S]*\} else \{/,
    compose: /if \(isPrimary\) \{[\s\S]*\} else if \(isSecondary\) \{[\s\S]*\} else \{/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: else-if chain not rendered natively`);
  noUnaccounted(out);
});

// --- P60: per-item conditional (boolean field-access inside iteration) on all 6
check('P60', 'conditional (F-13): a per-item conditional reads a boolean item field inside the iteration on all 6 — field-access only, NO comparison/expression emitted', () => {
  const out = condGenAll(COND_PERITEM, 'verify-cond-peritem');
  const pat = {
    react: /items\.map\(\(item\)[\s\S]*\{item\.active && \(/,
    'react-native': /items\.map\(\(item\)[\s\S]*\{item\.active && \(/,
    vue: /v-for="item in items"[\s\S]*<template v-if="item\.active">/,
    svelte: /\{#each items as item[\s\S]*\{#if item\.active\}/,
    swiftui: /ForEach\(items, id: \\\.id\) \{ item in[\s\S]*if item\.active \{/,
    compose: /items\.forEach \{ item ->[\s\S]*if \(item\.active\) \{/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: per-item field-access conditional not rendered`);
  // Native adapters: the item field is a real Bool/Boolean, and NO comparison /
  // ternary leaks (field-access is native; an expression would not be).
  assert(/let active: Bool\b/.test(out.swiftui.code), 'swiftui: item.active must be typed Bool');
  assert(/val active: Boolean\b/.test(out.compose.code), 'compose: item.active must be typed Boolean');
  for (const ad of ['swiftui', 'compose']) {
    const body = out[ad].code.replace(/https?:\/\//g, '');
    assert(!/\?[^:\n]*:/.test(body), `${ad}: no ternary/JS expression may leak into native per-item output`);
    assert(!/item\.\w+\s*(?:[<>]=?|===?|&&|\|\|)/.test(body), `${ad}: per-item condition must be field-access, not a comparison/logic`);
  }
  noUnaccounted(out);
});

// --- P61: depth cap — nesting beyond 3 is refused; at/under 3 generates -------
check('P61', 'conditional depth-cap (F-13): >3 nesting is REFUSED (extract-subcomponent); depth 3 passes; a per-item conditional counts toward the budget', () => {
  const T = (v) => ({ el: 'text', text: { kind: 'ref', value: v } });
  const cond = (when, then, els) => ({ el: 'conditional', when, then, ...(els ? { else: els } : {}) });
  const wrap = (child) => ({ root: { el: 'container', children: [child] } });
  const d3 = wrap(cond('a', cond('b', cond('c', T('x'), T('y')), T('z')), T('w')));       // depth 3
  const d4 = wrap(cond('a', cond('b', cond('c', cond('d', T('x'), T('y')), T('z')), T('w')), T('v'))); // depth 4
  // per-item counts: outer + list(each → per-item + two more) = depth 4
  const list = (children) => ({ el: 'container', each: { items: 'items', as: 'item', key: 'id' }, children });
  const combined4 = wrap(cond('show', list([cond('item.active', cond('a', cond('b', T('x'))))])));
  assert(checkRefusal(d3) === null, 'depth 3 (at cap) must generate, not refuse');
  const r4 = checkRefusal(d4);
  assert(r4 && r4.category === 'conditional-depth', 'depth 4 must be refused as conditional-depth');
  assert(/extract/i.test(r4.redirect) && /sub-component/i.test(r4.redirect), 'depth refusal must redirect to extracting a sub-component');
  const rc = checkRefusal(combined4);
  assert(rc && rc.category === 'conditional-depth', 'a per-item conditional must count toward the depth budget (combined depth 4 refused)');
});

// --- P62: per-item condition grammar — field-access passes, expression refused -
check('P62', 'conditional condition (F-13): a per-item boolean field-access passes; a per-item comparison/expression is REFUSED; field-access outside a loop is refused; a plain flag still passes', () => {
  const T = (v) => ({ el: 'text', text: { kind: 'ref', value: v } });
  const inLoop = (when) => ({ root: { el: 'container', children: [
    { el: 'container', each: { items: 'items', as: 'item', key: 'id' }, children: [{ el: 'conditional', when, then: T('a') }] },
  ] } });
  const bare = (when) => ({ root: { el: 'container', children: [{ el: 'conditional', when, then: T('a') }] } });
  assert(checkRefusal(inLoop('item.active')) === null, 'a per-item boolean field-access must pass');
  const cmp = checkRefusal(inLoop('item.count > 5'));
  assert(cmp && cmp.category === 'expression-condition', 'a per-item comparison must be refused');
  assert(/item\.active/.test(cmp.redirect), 'the per-item refusal must redirect to a boolean item field');
  assert(checkRefusal(inLoop('item.a && item.b'))?.category === 'expression-condition', 'per-item logic must be refused');
  assert(checkRefusal(bare('user.active'))?.category === 'expression-condition', 'field-access outside a loop must be refused (only loop-var fields allowed)');
  assert(checkRefusal(bare('isEmpty')) === null, 'a plain boolean flag condition must still pass');
});

// --- F-12 number formatting: locale / currency / grouping / rounding (P63-P66) -
const PRICE_THB = EX('price-thb.spec.yaml');
const PRICE_LOCALE = EX('price-locale.spec.yaml');
const DECIMAL_FLOOR = EX('decimal-floor.spec.yaml');
const fmtGenAll = (spec, feat) => ({
  react: generateReact(spec, feat), vue: generateVue(spec, feat), svelte: generateSvelte(spec, feat),
  'react-native': generateReactNative(spec, feat), swiftui: generateSwiftUI(spec, feat), compose: generateCompose(spec, feat),
});
const assertFmtExpressed = (out) => {
  for (const [ad, r] of Object.entries(out)) {
    const e = r.ledger.find((x) => x.traitId === 'number-format');
    assert(e && e.status === 'expressed' && e.mechanism, `${ad}: number-format must be expressed with a mechanism`);
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
};

// --- P63: currency format composes (symbol + locale + grouping + rounding + precision) on all 6
check('P63', 'number-format (F-12): a currency amount composes style+currency+locale+grouping+rounding+precision into ONE native formatter on all 6; ledger accounted; no cross-platform leak', () => {
  const out = fmtGenAll(PRICE_THB, 'verify-price-thb');
  const web = /new Intl\.NumberFormat\("th-TH", \{ style: "currency", currency: "THB", useGrouping: true, roundingMode: "halfExpand", minimumFractionDigits: 2, maximumFractionDigits: 2 \}\)\.format\(amount\)/;
  for (const ad of ['react', 'vue', 'svelte', 'react-native']) assert(web.test(out[ad].code), `${ad}: Intl currency formatter not composed`);
  const sw = out.swiftui.code;
  assert(/f\.numberStyle = \.currency/.test(sw) && /f\.currencyCode = "THB"/.test(sw) && /f\.locale = Locale\(identifier: "th-TH"\)/.test(sw)
    && /f\.usesGroupingSeparator = true/.test(sw) && /f\.roundingMode = \.halfUp/.test(sw) && /f\.minimumFractionDigits = 2/.test(sw),
    'swiftui: NumberFormatter must compose currency+locale+grouping+rounding+precision');
  const cp = out.compose.code;
  assert(/getCurrencyInstance\(java\.util\.Locale\.forLanguageTag\("th-TH"\)\)/.test(cp) && /currency = java\.util\.Currency\.getInstance\("THB"\)/.test(cp)
    && /isGroupingUsed = true/.test(cp) && /roundingMode = java\.math\.RoundingMode\.HALF_UP/.test(cp) && /minimumFractionDigits = 2/.test(cp),
    'compose: NumberFormat must compose currency+locale+grouping+rounding+precision');
  assertFmtExpressed(out);
  // Native uses native formatters (no Intl); web uses Intl (no native formatters) — no leak.
  for (const ad of ['swiftui', 'compose']) assert(!/Intl\.NumberFormat/.test(out[ad].code), `${ad}: must not emit Intl`);
  for (const ad of ['react', 'vue', 'svelte', 'react-native']) assert(!/NumberFormatter|java\.text\.NumberFormat/.test(out[ad].code), `${ad}: must not emit a native formatter`);
  // native-code + token-guard must not misfire on formatter config (currency/locale are not tokens).
  const ir = specToIrFromFile(PRICE_THB);
  assert(checkNativeExprLeak(ir, out).ok, 'native-code must not flag native formatter constructs');
  assert(checkTokens(ir, out).ok, 'token-guard must not misfire on currency/locale formatter config');
});

// --- P64: locale — a static locale AND a prop-ref locale both drive the formatter on all 6
check('P64', 'number-format (F-12): a static locale and a caller-supplied prop-ref locale both drive the formatter locale on all 6', () => {
  const stat = fmtGenAll(PRICE_THB, 'verify-loc-static');
  const ref = fmtGenAll(PRICE_LOCALE, 'verify-loc-ref');
  // static: locale literal appears; prop-ref: the prop name (unquoted) drives the locale.
  assert(/Intl\.NumberFormat\("th-TH"/.test(stat.react.code), 'react: static locale literal must appear');
  const refPat = {
    react: /Intl\.NumberFormat\(userLocale,/, vue: /Intl\.NumberFormat\(userLocale,/, svelte: /Intl\.NumberFormat\(userLocale,/,
    'react-native': /Intl\.NumberFormat\(userLocale,/,
    swiftui: /f\.locale = Locale\(identifier: userLocale\)/,
    compose: /forLanguageTag\(userLocale\)/,
  };
  for (const [ad, re] of Object.entries(refPat)) assert(re.test(ref[ad].code), `${ad}: prop-ref locale must drive the formatter`);
  // prop-ref must bind the variable, never emit it as a string literal.
  for (const ad of ['react', 'vue', 'svelte', 'react-native', 'swiftui', 'compose']) assert(!/"userLocale"/.test(ref[ad].code), `${ad}: locale ref must bind the prop, not a string literal`);
  assertFmtExpressed(ref);
});

// --- P65: grouping toggle + rounding mode (decimal, grouping off, floor, 0 digits) on all 6
check('P65', 'number-format (F-12): grouping OFF + floor rounding + decimal style apply natively on all 6', () => {
  const out = fmtGenAll(DECIMAL_FLOOR, 'verify-decimal-floor');
  const web = /style: "decimal", useGrouping: false, roundingMode: "floor", minimumFractionDigits: 0, maximumFractionDigits: 0/;
  for (const ad of ['react', 'vue', 'svelte', 'react-native']) assert(web.test(out[ad].code), `${ad}: decimal/grouping-off/floor not composed`);
  assert(/f\.numberStyle = \.decimal/.test(out.swiftui.code) && /f\.usesGroupingSeparator = false/.test(out.swiftui.code) && /f\.roundingMode = \.floor/.test(out.swiftui.code), 'swiftui: decimal/grouping-off/floor');
  assert(/getNumberInstance/.test(out.compose.code) && /isGroupingUsed = false/.test(out.compose.code) && /roundingMode = java\.math\.RoundingMode\.FLOOR/.test(out.compose.code), 'compose: decimal/grouping-off/floor');
  assertFmtExpressed(out);
});

// --- P66: F-9 boundary — expression as a format option refused; literal/plain-ref pass; F-11 intact
check('P66', 'number-format (F-12): an expression as locale/currency/number-source is REFUSED; static literal + plain prop-ref pass; F-11 .toFixed precision path unchanged', () => {
  const mk = (fmt, value = 'amount') => ({ root: { el: 'text', text: { kind: 'format', value, format: fmt } } });
  assert(checkRefusal(mk({ style: 'currency', currency: 'THB', precision: 2 })) === null, 'static currency literal must pass');
  assert(checkRefusal(mk({ style: 'currency', locale: { kind: 'ref', value: 'userLocale' } })) === null, 'a plain prop-ref option must pass');
  assert(checkRefusal(mk({ style: 'currency', locale: { kind: 'expr', value: 'nav.language' } }))?.category === 'expression-number-format', 'an expression as locale must be refused');
  assert(checkRefusal(mk({ style: 'currency', currency: { kind: 'ref', value: 'code.toUpperCase()' } }))?.category === 'expression-number-format', 'a non-plain ref currency must be refused');
  assert(checkRefusal(mk({ style: 'decimal' }, 'a + b'))?.category === 'expression-number-format', 'an expression number source must be refused');
  // F-11 regression: the `.toFixed(precision)` expr path still yields native formatters.
  assert(/NumberFormatter\(\)/.test(generateSwiftUI(TOKEN_AMOUNT, '_verify').code), 'F-11 .toFixed precision path must still format via NumberFormatter');
});

// --- F-25 rich options: icon in RadioGroup; icon on native Select refused (P67-P68)
const RADIO_ICONS = resolve(ROOT, '.claude/artifacts/radio-group-icons/design-spec.yaml');
const richGenAll = (spec, feat) => ({
  react: generateReact(spec, feat), vue: generateVue(spec, feat), svelte: generateSvelte(spec, feat),
  'react-native': generateReactNative(spec, feat), swiftui: generateSwiftUI(spec, feat), compose: generateCompose(spec, feat),
});

// --- P67: RadioGroup with icon options renders a decorative per-option icon on all 6
check('P67', 'rich options (F-25): RadioGroup renders a decorative per-option icon + label on all 6 via a runtime icon-token registry; option-icon expressed, 0 unaccounted', () => {
  const out = richGenAll(RADIO_ICONS, 'verify-radio-icons');
  const pat = {
    react: /const OPTION_ICONS[\s\S]*<OptionIcon token=\{opt\.icon\} \/>[\s\S]*\{opt\.label\}/,
    vue: /const OPTION_ICONS[\s\S]*<component v-if="OPTION_ICONS\[opt\.icon\]" :is="OPTION_ICONS\[opt\.icon\]" aria-hidden="true" \/>[\s\S]*\{\{ opt\.label \}\}/,
    svelte: /const OPTION_ICONS[\s\S]*<svelte:component this=\{OPTION_ICONS\[opt\.icon\]\} aria-hidden="true" \/>[\s\S]*\{opt\.label\}/,
    'react-native': /const OPTION_ICONS[\s\S]*<OptionIcon token=\{opt\.icon\} \/>[\s\S]*<Text>\{opt\.label\}<\/Text>/,
    swiftui: /static let optionIconSymbols[\s\S]*Label\(opt\.label, systemImage: Self\.optionIconSymbols\[opt\.icon\] \?\? ""\)\.tag\(opt\.value\)/,
    compose: /val OPTION_ICONS = mapOf\([\s\S]*OPTION_ICONS\[opt\.icon\]\?\.let \{ Icon\(it, contentDescription = null\) \}[\s\S]*Text\(text = opt\.label\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: rich-option icon not rendered as expected`);
  // Icon is decorative on every platform (label carries the accessible text).
  assert(/aria-hidden/.test(out.react.code) && /aria-hidden/.test(out.vue.code) && /aria-hidden/.test(out.svelte.code), 'web: option icon must be aria-hidden');
  assert(/accessibilityElementsHidden|importantForAccessibility="no"/.test(out['react-native'].code), 'rn: option icon must be hidden from a11y');
  assert(/contentDescription = null/.test(out.compose.code), 'compose: option icon must be decorative (contentDescription = null)');
  for (const [ad, r] of Object.entries(out)) {
    const e = r.ledger.find((x) => x.traitId === 'option-icon');
    assert(e && e.status === 'expressed' && e.mechanism, `${ad}: option-icon must be expressed`);
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
  // F-23 idiom intact: native rich output carries no per-option expression/ternary.
  for (const ad of ['swiftui', 'compose']) assert(!/\?[^:\n]*:/.test(out[ad].code.replace(/\?\? ""/g, '')), `${ad}: no per-option ternary/expression may leak`);
});

// --- P68: an icon on a native Select option is REFUSED; text-only Select passes
check('P68', 'rich options (F-25): an icon on a native Select option is refused (rich-option-select) with the RadioGroup/overlay redirect; text-only Select + icon RadioGroup pass; custom-overlay still refused', () => {
  const sel = (role, withIcon) => ({ category: 'input', props: [
    { name: 'choice', type: 'string' }, { name: 'onChoiceChange', type: 'function' },
    { name: 'options', type: 'array', itemShape: withIcon ? { value: 'string', label: 'string', icon: 'string' } : { value: 'string', label: 'string' } },
  ], root: { el: 'input', ...(role ? { role } : {}), label: { kind: 'literal', value: 'x' }, input: { valueProp: 'choice', changeProp: 'onChoiceChange', state: { kind: 'selected-value', options: 'options' } } } });
  const r = checkRefusal(sel(null, true));
  assert(r && r.category === 'rich-option-select', 'an icon on a native Select option must be refused');
  assert(/RadioGroup/.test(r.redirect) && /text-only/.test(r.redirect), 'the refusal must redirect to RadioGroup / custom-overlay picker');
  assert(checkRefusal(sel(null, false)) === null, 'a text-only native Select must still pass');
  assert(checkRefusal(sel('radiogroup', true)) === null, 'an icon RadioGroup must pass');
  assert(checkRefusal({ category: 'overlay', root: { el: 'container' } })?.category === 'overlay', 'a custom-overlay select must stay refused');
});

// --- F-26 date/time formatting: presets + locale (P69-P70) --------------------
const EVENT_DT = resolve(ROOT, '.claude/artifacts/event-datetime/design-spec.yaml');
const EVENT_DT_LOC = resolve(ROOT, '.claude/artifacts/event-datetime-locale/design-spec.yaml');
const dateGenAll = (spec, feat) => ({
  react: generateReact(spec, feat), vue: generateVue(spec, feat), svelte: generateSvelte(spec, feat),
  'react-native': generateReactNative(spec, feat), swiftui: generateSwiftUI(spec, feat), compose: generateCompose(spec, feat),
});

// --- P69: a date/time value formats via the native date formatter on all 6 ----
check('P69', 'date-format (F-26): date+time styles + locale compose into ONE native date formatter on all 6; date prop typed natively; date-format expressed, 0 unaccounted; no cross-platform leak', () => {
  const out = dateGenAll(EVENT_DT, 'verify-event-dt');
  const web = /new Intl\.DateTimeFormat\("en-GB", \{ dateStyle: "medium", timeStyle: "short" \}\)\.format\(when\)/;
  for (const ad of ['react', 'vue', 'svelte', 'react-native']) assert(web.test(out[ad].code), `${ad}: Intl.DateTimeFormat not composed`);
  assert(/DateFormatter\(\); f\.locale = Locale\(identifier: "en-GB"\); f\.dateStyle = \.medium; f\.timeStyle = \.short; return f\.string\(from: when\)/.test(out.swiftui.code), 'swiftui: DateFormatter must compose styles+locale');
  assert(/java\.text\.DateFormat\.getDateTimeInstance\(java\.text\.DateFormat\.MEDIUM, java\.text\.DateFormat\.SHORT, java\.util\.Locale\.forLanguageTag\("en-GB"\)\)\.format\(when\)/.test(out.compose.code), 'compose: getDateTimeInstance must compose styles+locale');
  // date prop typed natively.
  assert(/when: Date/.test(out.react.code) && /let when: Date/.test(out.swiftui.code) && /when: java\.util\.Date/.test(out.compose.code), 'date prop must be typed natively (Date / java.util.Date)');
  for (const [ad, r] of Object.entries(out)) {
    const e = r.ledger.find((x) => x.traitId === 'date-format');
    assert(e && e.status === 'expressed' && e.mechanism, `${ad}: date-format must be expressed`);
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
  for (const ad of ['swiftui', 'compose']) assert(!/Intl\.DateTimeFormat/.test(out[ad].code), `${ad}: must not emit Intl`);
  for (const ad of ['react', 'vue', 'svelte', 'react-native']) assert(!/DateFormatter|java\.text\.DateFormat/.test(out[ad].code), `${ad}: must not emit a native date formatter`);
  const ir = specToIrFromFile(EVENT_DT);
  assert(checkNativeExprLeak(ir, out).ok, 'native-code must not flag native date-formatter constructs');
  assert(checkTokens(ir, out).ok, 'token-guard must not misfire on locale/date config');
});

// --- P70: locale static + prop-ref both generate; expression refused; preset-only
check('P70', 'date-format (F-26): a static locale and a prop-ref locale both drive the date formatter on all 6; an expression as locale/date-source is refused; presets only', () => {
  const ref = dateGenAll(EVENT_DT_LOC, 'verify-event-dt-loc');
  const refPat = {
    react: /Intl\.DateTimeFormat\(userLocale,/, vue: /Intl\.DateTimeFormat\(userLocale,/, svelte: /Intl\.DateTimeFormat\(userLocale,/,
    'react-native': /Intl\.DateTimeFormat\(userLocale,/,
    swiftui: /f\.locale = Locale\(identifier: userLocale\)/,
    compose: /forLanguageTag\(userLocale\)/,
  };
  for (const [ad, re] of Object.entries(refPat)) assert(re.test(ref[ad].code), `${ad}: prop-ref locale must drive the date formatter`);
  for (const ad of Object.keys(refPat)) assert(!/"userLocale"/.test(ref[ad].code), `${ad}: locale ref must bind the prop, not a string literal`);
  // Refusals (F-9): expression as locale / date-source.
  const mk = (df, value = 'when') => ({ root: { el: 'text', text: { kind: 'datetime', value, dateFormat: df } } });
  assert(checkRefusal(mk({ dateStyle: 'long', locale: 'en-GB' })) === null, 'a static locale must pass');
  assert(checkRefusal(mk({ dateStyle: 'long', locale: { kind: 'ref', value: 'userLocale' } })) === null, 'a plain prop-ref locale must pass');
  assert(checkRefusal(mk({ dateStyle: 'long', locale: { kind: 'expr', value: 'nav.language' } }))?.category === 'expression-date-format', 'an expression as locale must be refused');
  assert(checkRefusal(mk({ dateStyle: 'long' }, 'new Date()'))?.category === 'expression-date-format', 'an expression date source must be refused');
});

// --- F-27 timezone: static / prop-ref / invalid / expression / regression (P71-P73)
const EVENT_TZ_STATIC = resolve(ROOT, '.claude/artifacts/event-tz-static/design-spec.yaml');
const EVENT_TZ_REF = resolve(ROOT, '.claude/artifacts/event-tz-ref/design-spec.yaml');
const tzGenAll = (spec, feat) => ({
  react: generateReact(spec, feat), vue: generateVue(spec, feat), svelte: generateSvelte(spec, feat),
  'react-native': generateReactNative(spec, feat), swiftui: generateSwiftUI(spec, feat), compose: generateCompose(spec, feat),
});

// --- P71: a static IANA timezone renders via each native formatter on all 6 ---
check('P71', 'timezone (F-27): a static IANA id renders through each adapter native date formatter on all 6; date-timezone expressed, 0 unaccounted', () => {
  const out = tzGenAll(EVENT_TZ_STATIC, 'verify-tz-static');
  const pat = {
    react: /timeZone: "Asia\/Bangkok"/, vue: /timeZone: "Asia\/Bangkok"/, svelte: /timeZone: "Asia\/Bangkok"/, 'react-native': /timeZone: "Asia\/Bangkok"/,
    swiftui: /f\.timeZone = TimeZone\(identifier: "Asia\/Bangkok"\) \?\? \.current/,
    compose: /timeZone = java\.util\.TimeZone\.getTimeZone\(runCatching \{ java\.time\.ZoneId\.of\("Asia\/Bangkok"\) \}\.getOrElse \{ java\.time\.ZoneId\.systemDefault\(\) \}\)/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: static timezone not rendered natively`);
  for (const [ad, r] of Object.entries(out)) {
    const e = r.ledger.find((x) => x.traitId === 'date-timezone');
    assert(e && e.status === 'expressed' && e.mechanism, `${ad}: date-timezone must be expressed`);
    assert(!r.ledger.some((x) => x.status === 'unaccounted'), `${ad}: no trait may be unaccounted`);
  }
});

// --- P72: a prop-ref timezone binds the variable + device fallback on all 6 ----
check('P72', 'timezone (F-27): a runtime prop-ref binds the variable (not stringified) and falls back to the device timezone identically on all 6', () => {
  const out = tzGenAll(EVENT_TZ_REF, 'verify-tz-ref');
  // Bound (not a "userTz" string literal) + a device fallback is present per adapter.
  const pat = {
    react: /timeZone: __dtfTimeZone\(userTz\)/, vue: /timeZone: __dtfTimeZone\(userTz\)/, svelte: /timeZone: __dtfTimeZone\(userTz\)/, 'react-native': /timeZone: __dtfTimeZone\(userTz\)/,
    swiftui: /TimeZone\(identifier: userTz\) \?\? \.current/,
    compose: /runCatching \{ java\.time\.ZoneId\.of\(userTz\) \}\.getOrElse \{ java\.time\.ZoneId\.systemDefault\(\) \}/,
  };
  for (const [ad, re] of Object.entries(pat)) assert(re.test(out[ad].code), `${ad}: prop-ref timezone not bound with device fallback`);
  // web/RN guard helper returns undefined (device) on an invalid id — never throws.
  for (const ad of ['react', 'vue', 'svelte', 'react-native']) {
    assert(/function __dtfTimeZone/.test(out[ad].code) && /return undefined/.test(out[ad].code) && /catch \{ return undefined; \}/.test(out[ad].code), `${ad}: __dtfTimeZone device-fallback guard missing`);
    assert(!/"userTz"/.test(out[ad].code), `${ad}: timezone ref must bind the prop, not a string literal`);
  }
});

// --- P73: literal validity at schema; expression refused; omitted = no change ---
check('P73', 'timezone (F-27): invalid literal refused at validate-schema (canonical + alias pass; display name refused); expression/non-plain-ref refused (F-9); omitted = no date-timezone trait', () => {
  const spec = (tz) => ({ component: 'T', root: { el: 'text', text: { kind: 'datetime', value: 'when', dateFormat: { dateStyle: 'medium', timeZone: tz } } }, props: [{ name: 'when', type: 'date', required: true }] });
  // validate-schema: valid canonical + alias pass; invalid id + display name refused.
  assert(validate(spec('Asia/Bangkok')).ok, 'valid IANA id must pass validate-schema');
  assert(validate(spec('Asia/Kolkata')).ok && validate(spec('Asia/Calcutta')).ok, 'canonical AND alias ids must pass');
  const bad = validate(spec('Mars/Phobos'));
  assert(!bad.ok && /invalid IANA timezone/.test(bad.errors[0]?.message ?? ''), 'an invalid literal id must be refused at validate-schema');
  assert(!validate(spec('GMT+7')).ok, 'a timezone display name must be refused (not a valid IANA id)');
  assert(validate(spec({ kind: 'ref', value: 'userTz' })).ok, 'a prop-ref timeZone is not schema-checked (runtime fallback)');
  // refusal (F-9): expression / non-plain ref as the timezone.
  assert(checkRefusal(spec({ kind: 'expr', value: 'tz()' }))?.category === 'expression-date-format', 'an expression timezone must be refused');
  assert(checkRefusal(spec({ kind: 'ref', value: 'tz.toUpperCase()' }))?.category === 'expression-date-format', 'a non-plain ref timezone must be refused');
  assert(checkRefusal(spec('Asia/Bangkok')) === null && checkRefusal(spec({ kind: 'ref', value: 'userTz' })) === null, 'a literal or plain-ref timezone must pass refusal');
  // Regression: a datetime WITHOUT a timezone declares no date-timezone trait and emits no timeZone.
  const out = tzGenAll(EVENT_DT, 'verify-tz-regress');
  for (const [ad, r] of Object.entries(out)) {
    assert(!r.ledger.some((x) => x.traitId === 'date-timezone'), `${ad}: no-timezone datetime must not declare date-timezone`);
    assert(!/timeZone|__dtfTimeZone|systemDefault/.test(out[ad].code), `${ad}: no-timezone datetime must not emit timezone code`);
  }
});

// --- P74: F-27 literal timezone parity — cross-platform-safe subset only ------
check('P74', 'timezone (F-27 follow-up): a literal passing validate-schema resolves on all 6 — exact-case Region/City or UTC accepted; case variants, UTC offsets and display names refused; aliases (Kolkata AND Calcutta) stay valid', () => {
  const spec = (tz) => ({ component: 'T', root: { el: 'text', text: { kind: 'datetime', value: 'when', dateFormat: { dateStyle: 'medium', timeZone: tz } } }, props: [{ name: 'when', type: 'date', required: true }] });
  const accept = (tz) => assert(validate(spec(tz)).ok, `${tz} must be ACCEPTED (resolves on all platforms)`);
  const refuse = (tz) => assert(!validate(spec(tz)).ok, `${tz} must be REFUSED (not cross-platform safe)`);
  accept('Asia/Bangkok'); accept('UTC'); accept('Etc/GMT-7');
  accept('Asia/Calcutta'); accept('Asia/Kolkata');     // alias + canonical both valid (required)
  refuse('asia/bangkok'); refuse('ASIA/BANGKOK');       // case variants (Swift/Java case-sensitive)
  refuse('Z');                                          // bare word
  refuse('+07:00'); refuse('-0500');                    // UTC offsets (platform-divergent)
  refuse('GMT+7');                                      // display name
  // A prop-ref is still runtime (not schema-bound) and still passes schema.
  assert(validate(spec({ kind: 'ref', value: 'userTz' })).ok, 'a prop-ref timeZone must still pass schema (runtime device fallback)');
});

// --- P75–P80: F-22 state-by-color-only as a blocking a11y contract ----------
// Synthetic IR with a single variant container; `intent` omitted = status.
const variantIr = (cases, intent) => ({
  props: [], tokens: [],
  root: { kind: 'container', variant: { prop: 'sev', ...(intent ? { intent } : {}), cases } },
});

check('P75', 'F-22: distinct per-state icons PASS (status variant survives grayscale/CVD)', () => {
  const ir = variantIr({
    ok:  { background: 'color.success.bg', icon: 'icon.success' },
    err: { background: 'color.danger.bg',  icon: 'icon.error' },
  }, 'status');
  const r = checkA11y(ir, {});
  assert(r.ok, 'distinct per-state icons must PASS');
  assert(!r.issues.some((i) => i.rule === 'status-color-only'), 'no status-color-only finding expected');
});

check('P76', 'F-22: a colour-only status variant FAILS at serious', () => {
  const ir = variantIr({
    ok:  { background: 'color.success.bg', color: 'color.success.fg' },
    err: { background: 'color.danger.bg',  color: 'color.danger.fg' },
  }, 'status');
  const r = checkA11y(ir, {});
  assert(!r.ok, 'colour-only must FAIL (block)');
  assert(r.issues.some((i) => i.rule === 'status-color-only' && i.severity === 'serious'), 'serious status-color-only expected');
});

check('P77', 'F-22: only one of three states carries an icon — the two bare states collide and FAIL (pairwise)', () => {
  const ir = variantIr({
    ok:   { background: 'color.success.bg', icon: 'icon.success' },
    warn: { background: 'color.warning.bg' },
    err:  { background: 'color.danger.bg' },
  }, 'status');
  const r = checkA11y(ir, {});
  assert(!r.ok, 'the two icon-less states must collide on the empty signature and FAIL');
  assert(r.issues.some((i) => i.rule === 'status-color-only' && i.msg.includes('warn') && i.msg.includes('err')), 'the two bare states must be named in the finding');
});

check('P78', 'F-22: an identical icon on every state FAILS (shared non-colour signature)', () => {
  const ir = variantIr({
    ok:  { background: 'color.success.bg', icon: 'icon.dot' },
    err: { background: 'color.danger.bg',  icon: 'icon.dot' },
  }, 'status');
  const r = checkA11y(ir, {});
  assert(!r.ok, 'the same icon on every state must FAIL');
  assert(r.issues.some((i) => i.rule === 'status-color-only' && /same non-colour cue/.test(i.msg)), 'expected a shared-signature finding');
});

check('P79', 'F-22 backstop: intent=emphasis on a status-vocabulary enum FAILS; a genuine emphasis enum PASSES', () => {
  const statusEnum = variantIr({
    success: { background: 'color.success.bg' },
    error:   { background: 'color.danger.bg' },
  }, 'emphasis');
  const r1 = checkA11y(statusEnum, {});
  assert(!r1.ok, 'emphasis on success/error (status vocab) must FAIL the backstop');
  assert(r1.issues.some((i) => i.rule === 'status-color-only' && /emphasis/.test(i.msg)), 'backstop finding expected');
  // A genuine presentational emphasis enum (no status vocabulary) is exempt —
  // destructive must NOT be fuzzy-matched to danger.
  const emphEnum = variantIr({
    primary:     { background: 'color.accent.default' },
    secondary:   { background: 'color.bg.muted' },
    ghost:       { background: 'color.bg.default' },
    destructive: { background: 'color.danger.fg' },
  }, 'emphasis');
  assert(checkA11y(emphEnum, {}).ok, 'a genuine emphasis enum (primary/secondary/ghost/destructive) must PASS — destructive is not status vocab');
});

check('P80', 'F-22: a variant with NO intent key defaults to status (fail-closed) and a colour-only one FAILS', () => {
  const ir = variantIr({
    ok:  { background: 'color.success.bg' },
    err: { background: 'color.danger.bg' },
  }); // intent omitted
  const r = checkA11y(ir, {});
  assert(!r.ok, 'omitted intent must be treated as status, so a colour-only variant FAILS');
  assert(r.issues.some((i) => i.rule === 'status-color-only'), 'status-color-only expected under the default (status) intent');
});

check('P81', 'link (PR A): el:link opens its href on all 6 (href / Linking.openURL / Link / uriHandler.openUri); Compose reads LocalUriHandler in composable scope; parity fires on an emptied body', () => {
  const LINK = resolve(ROOT, '.claude/artifacts/link-external/design-spec.yaml');
  const ir = specToIrFromFile(LINK);
  const results = {
    react: generateReact(LINK, '_verify'),
    vue: generateVue(LINK, '_verify'),
    svelte: generateSvelte(LINK, '_verify'),
    'react-native': generateReactNative(LINK, '_verify'),
    swiftui: generateSwiftUI(LINK, '_verify'),
    compose: generateCompose(LINK, '_verify'),
  };
  const NAV = { react: /href=/, vue: /href=/, svelte: /href=/, 'react-native': /Linking\.openURL\(/, swiftui: /Link\(/, compose: /uriHandler\.openUri\(/ };
  for (const [a, re] of Object.entries(NAV)) assert(re.test(results[a].code), `${a} link must contain its navigation primitive ${re.source}`);
  // Compose: LocalUriHandler must be hoisted to composable scope + imported (not read inside the lambda).
  assert(/val uriHandler = LocalUriHandler\.current/.test(results.compose.code), 'compose must hoist `val uriHandler = LocalUriHandler.current`');
  assert(/import androidx\.compose\.ui\.platform\.LocalUriHandler/.test(results.compose.code), 'compose must import LocalUriHandler');
  // No residual inert stub.
  assert(!/\/\* open/.test(results.compose.code), 'compose must not emit the old comment-only link stub');
  // Parity passes on real output; emptying the compose nav body makes parity RED (ledger alone cannot catch this).
  assert(checkParity(results, ir).ok, 'link parity must pass on real output');
  const broken = { ...results, compose: { ...results.compose, code: results.compose.code.replace(/uriHandler\.openUri\(/g, 'run(') } };
  assert(!checkParity(broken, ir).ok, 'parity must FAIL when the compose navigation body is emptied');
});

check('P82', 'layout axis (PR A2): an oriented container with children lowers to a real axis on all 6 (web display:flex+flex-direction / RN flexDirection / HStack|VStack / Row|Column); divider (leaf) unchanged; parity fires on a flipped axis', () => {
  const ROW = resolve(ROOT, '.claude/artifacts/layout-row/design-spec.yaml');
  const COL = resolve(ROOT, '.claude/artifacts/layout-column/design-spec.yaml');
  const gen = (p) => ({
    react: generateReact(p, '_verify'), vue: generateVue(p, '_verify'), svelte: generateSvelte(p, '_verify'),
    'react-native': generateReactNative(p, '_verify'), swiftui: generateSwiftUI(p, '_verify'), compose: generateCompose(p, '_verify'),
  });
  const row = gen(ROW), col = gen(COL);
  // Horizontal row → row axis on every adapter.
  assert(/display: 'flex', flexDirection: 'row'/.test(row.react.code), 'react row axis');
  assert(/display: flex; flex-direction: row/.test(row.vue.code), 'vue row axis');
  assert(/display: flex; flex-direction: row/.test(row.svelte.code), 'svelte row axis');
  assert(/flexDirection: "row"/.test(row['react-native'].code), 'rn row axis');
  assert(/HStack/.test(row.swiftui.code), 'swiftui HStack');
  assert(/\bRow\(/.test(row.compose.code), 'compose Row');
  // Vertical column → column axis on every adapter.
  assert(/flexDirection: 'column'/.test(col.react.code) && /flex-direction: column/.test(col.vue.code) && /flex-direction: column/.test(col.svelte.code), 'web column axis');
  assert(/flexDirection: "column"/.test(col['react-native'].code) && /VStack/.test(col.swiftui.code) && /\bColumn\(/.test(col.compose.code), 'native column axis');
  // aria-orientation preserved (decision 2).
  assert(/aria-orientation="horizontal"/.test(row.react.code), 'aria-orientation kept on web');
  // divider (oriented leaf, no children) must NOT get a web layout axis (unchanged).
  const DIV = resolve(ROOT, '.claude/artifacts/divider/design-spec.yaml');
  assert(!/display: 'flex'/.test(generateReact(DIV, '_verify').code), 'divider (leaf) must not gain display:flex');
  // Parity catches a flipped axis (ledger cannot).
  const ir = specToIrFromFile(ROW);
  assert(checkParity(row, ir).ok, 'row axis parity must pass');
  const flipped = { ...row, swiftui: { ...row.swiftui, code: row.swiftui.code.replace(/HStack/g, 'VStack') } };
  assert(!checkParity(flipped, ir).ok, 'parity must FAIL when the swiftui axis is flipped to VStack');
});

check('P83', 'brief schema (PR B): every brief + template validates; a corrupted brief is caught for undeclared key / bad state pattern / unknown interaction / static-combined / scalar interaction', () => {
  const BRIEF_SCHEMA = resolve(ROOT, '_shared/schemas/brief.schema.yaml');
  // All real briefs + the template pass.
  const rows = validateBriefs();
  const bad = rows.filter((r) => !r.ok);
  assert(bad.length === 0, `all briefs must validate; invalid: ${bad.map((b) => b.path).join(', ')}`);
  assert(rows.length >= 20, `expected >=20 brief targets (19 briefs + template), got ${rows.length}`);
  // A well-formed brief passes; each corruption fails.
  const base = { component: 'Widget', purpose: 'p', platforms: ['react'], states: ['default'], interaction: ['variants'] };
  const V = (doc) => validate(doc, BRIEF_SCHEMA).ok;
  assert(V(base), 'a well-formed brief must validate');
  assert(!V({ ...base, foo: 1 }), 'undeclared top-level key must be rejected (additionalProperties:false)');
  assert(!V({ ...base, states: ['With-Image'] }), 'a state violating lower-kebab pattern must be rejected');
  assert(!V({ ...base, interaction: ['expression'] }), 'an interaction value outside the enum must be rejected');
  assert(!V({ ...base, interaction: ['static', 'variants'] }), 'static combined with another interaction value must be rejected');
  assert(!V({ ...base, interaction: 'variants' }), 'a scalar interaction (not an array) must be rejected');
  // Sanity: static alone is allowed.
  assert(V({ ...base, interaction: ['static'] }), 'interaction [static] alone must validate');
});

check('P84', 'trait registry scaffold (D1): the schema walker derives the schema constructs plus the style slots (count derived, not hard-coded), every one has a registry entry, none is orphaned, trait mappings only point at declared+handled traits (a11y.labelledBy is never covered); corrupted registries are caught', () => {
  const constructs = deriveConstructs();
  // D3: the expected count is derived from the schema walk + the style-slot union, not a literal.
  const DERIVED_COUNT = deriveSchemaConstructs().length + new Set([...adapterStyleSlots(), ...corpusStyleSlots()]).size;
  const declared = declaredTraitIds();
  const handled = handledTraitIds();
  const registry = loadTraitRegistry();
  assert(constructs.length === DERIVED_COUNT && DERIVED_COUNT > 0, `walker must derive the schema constructs plus the style slots (${DERIVED_COUNT}), got ${constructs.length}`);
  assert(new Set(constructs).size === constructs.length, 'derived construct ids must be unique');
  assert(constructs.every((c) => /^[a-zA-Z0-9.-]+:[^:\s]+$/.test(c)), 'every construct id must match <group>:<name>');
  const base = { constructs, registry, declared, handled };
  const real = checkTraitRegistry(base);
  assert(real.ok, `the seeded registry must be consistent: ${real.issues.slice(0, 3).join('; ')}`);
  // The known declared-but-never-handled trait is detected (and must stay uncovered).
  const unhandled = declared.filter((t) => !handled.includes(t));
  assert(JSON.stringify(unhandled) === JSON.stringify(['a11y.labelledBy']), `declared-but-unhandled traits must be exactly [a11y.labelledBy], got [${unhandled}]`);
  assert(registry.entries.get('a11y.field:labelledBy')?.untracked, 'a11y.field:labelledBy must be untracked, not mapped to a trait');
  // Fired-gate: each corruption must be caught.
  const withEntries = (mut) => { const m = new Map(registry.entries); mut(m); return { ...base, registry: { ...registry, entries: m } }; };
  assert(!checkTraitRegistry(withEntries((m) => m.delete('style-slot:gap'))).ok, 'a derived construct with no entry must FAIL');
  assert(!checkTraitRegistry(withEntries((m) => m.set('element.field:ghost', { trait: 'size' }))).ok, 'an orphaned entry must FAIL');
  assert(!checkTraitRegistry(withEntries((m) => m.set('a11y.field:labelledBy', { trait: 'a11y.labelledBy' }))).ok, 'mapping a declared-but-unhandled trait must FAIL');
  assert(!checkTraitRegistry(withEntries((m) => m.set('style-slot:gap', { trait: 'no-such-trait' }))).ok, 'mapping an undeclared trait must FAIL');
  assert(!checkTraitRegistry({ ...base, registry: { ...registry, problems: ['"x" untracked is missing reason, approver and/or expires'] } }).ok, 'a malformed untracked entry must FAIL');
  assert(!checkTraitRegistry({ ...base, constructs: [...constructs, constructs[0]] }).ok, 'a duplicate derived id must FAIL');
});

// --- D2 trait completeness gate: one firing pin per rule (R1..R6) + wiring ------
// Every pin runs the gate on a TEMPORARY fixture copy of the registry (never the
// real file) with a pinned clock, so these pins cannot time-bomb on an expiry date.
const D2_NOW = new Date('2026-10-06T00:00:00Z');
const D2_REGISTRY = resolve(ROOT, '_shared/policy/trait-registry.yaml');
function d2Gate(mutate, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trait-registry-'));
  try {
    const p = join(dir, 'trait-registry.yaml');
    writeFileSync(p, mutate(readFileSync(D2_REGISTRY, 'utf8')));
    return checkTraitRegistryGate({ registryPath: p, now: D2_NOW, ...opts });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const d2Rules = (r) => [...new Set(r.issues.map((i) => i.rule))];
const d2Fired = (r, rule, construct) => r.issues.some((i) => i.rule === rule && i.construct === construct && i.msg.includes(construct));
const d2Line = (text, id, fn) => text.split('\n').map((l) => (l.startsWith(`  "${id}":`) ? fn(l) : l)).join('\n');
const d2Only = (r, rule, construct, why) => {
  assert(!r.ok, `${why}: the gate must FAIL`);
  assert(d2Fired(r, rule, construct), `${why}: expected ${rule} naming "${construct}", got ${JSON.stringify(r.issues.map((i) => [i.rule, i.construct]))}`);
  assert(JSON.stringify(d2Rules(r)) === JSON.stringify([rule]), `${why}: only ${rule} may fire, got ${d2Rules(r)}`);
};
const D2_U = (extra) => `{ untracked: { ${extra} } }`;

check('P85', 'trait-registry gate R1-missing: a derived construct with no registry entry FAILS naming it (a clean fixture copy passes)', () => {
  assert(d2Gate((t) => t).ok, 'an unmodified fixture copy of the registry must pass');
  d2Only(d2Gate((t) => t.split('\n').filter((l) => !l.startsWith('  "style-slot:gap":')).join('\n')), 'R1-missing', 'style-slot:gap', 'deleted entry');
  d2Only(d2Gate((t) => t, { constructs: [...deriveConstructs(), 'element.field:brandNew'] }), 'R1-missing', 'element.field:brandNew', 'new derived construct');
});

check('P86', 'trait-registry gate R2-stale: a registry entry matching no derived construct FAILS naming it', () => {
  d2Only(d2Gate((t) => `${t.trimEnd()}\n  "element.field:ghost": { trait: "size" }\n`), 'R2-stale', 'element.field:ghost', 'stale entry');
  d2Only(d2Gate((t) => t, { constructs: deriveConstructs().filter((c) => c !== 'style-slot:gap') }), 'R2-stale', 'style-slot:gap', 'construct no longer derived');
});

check('P87', 'trait-registry gate R3-shape: neither mapped nor untracked, both, a mistyped key, or a non-mapping entry FAILS', () => {
  d2Only(d2Gate((t) => d2Line(t, 'style-slot:gap', () => '  "style-slot:gap": { }')), 'R3-shape', 'style-slot:gap', 'neither');
  d2Only(d2Gate((t) => d2Line(t, 'style-slot:gap', () => `  "style-slot:gap": { trait: "size", untracked: { reason: "r", approver: "Ssuppanut (design-system a11y owner)", expires: "2026-12-31" } }`)), 'R3-shape', 'style-slot:gap', 'both');
  d2Only(d2Gate((t) => d2Line(t, 'style-slot:gap', () => '  "style-slot:gap": { traits: "size" }')), 'R3-shape', 'style-slot:gap', 'mistyped key');
  d2Only(d2Gate((t) => d2Line(t, 'style-slot:gap', () => '  "style-slot:gap": "size"')), 'R3-shape', 'style-slot:gap', 'scalar entry');
  d2Only(d2Gate((t) => d2Line(t, 'style-slot:gap', () => '  "style-slot:gap": { trait: "size", note: "extra key beside a valid trait" }')), 'R3-shape', 'style-slot:gap', 'unknown key beside a valid trait');
});

check('P88', 'trait-registry gate R4-dangling-trait: an undeclared trait, a bad item in a list, a non-normalized id, or an empty list FAILS; a valid list passes', () => {
  const map = (v) => (t) => d2Line(t, 'style-slot:gap', () => `  "style-slot:gap": { trait: ${v} }`);
  d2Only(d2Gate(map('"no-such-trait"')), 'R4-dangling-trait', 'style-slot:gap', 'undeclared trait');
  d2Only(d2Gate(map('["size", "no-such-trait"]')), 'R4-dangling-trait', 'style-slot:gap', 'one bad item in a list');
  d2Only(d2Gate(map('[]')), 'R4-dangling-trait', 'style-slot:gap', 'empty list');
  d2Only(d2Gate(map('"role=button"')), 'R4-dangling-trait', 'style-slot:gap', 'non-normalized trait id');
  assert(d2Gate(map('["size", "disabled"]')).ok, 'a list of declared traits must pass');
  assert(d2Gate(map('"size"')).ok, 'a single declared trait must pass');
});

check('P89', 'trait-registry gate R5-untracked-quality: empty reason, wrong/missing approver, missing/invalid/past expiry FAILS; the day before expiry passes', () => {
  const U = (a, b, c) => (t) => d2Line(t, 'style-slot:gap', () => `  "style-slot:gap": ${D2_U([a, b, c].filter(Boolean).join(', '))}`);
  const ok = 'approver: "Ssuppanut (design-system a11y owner)"';
  d2Only(d2Gate(U('reason: ""', ok, 'expires: "2026-12-31"')), 'R5-untracked-quality', 'style-slot:gap', 'empty reason');
  d2Only(d2Gate(U(null, ok, 'expires: "2026-12-31"')), 'R5-untracked-quality', 'style-slot:gap', 'missing reason');
  d2Only(d2Gate(U('reason: "r"', 'approver: "Someone Else"', 'expires: "2026-12-31"')), 'R5-untracked-quality', 'style-slot:gap', 'wrong approver');
  d2Only(d2Gate(U('reason: "r"', 'approver: "ssuppanut (design-system a11y owner)"', 'expires: "2026-12-31"')), 'R5-untracked-quality', 'style-slot:gap', 'approver differs only by case');
  d2Only(d2Gate(U('reason: "r"', null, 'expires: "2026-12-31"')), 'R5-untracked-quality', 'style-slot:gap', 'missing approver');
  d2Only(d2Gate(U('reason: "r"', ok, null)), 'R5-untracked-quality', 'style-slot:gap', 'missing expiry');
  d2Only(d2Gate(U('reason: "r"', ok, 'expires: "not-a-date"')), 'R5-untracked-quality', 'style-slot:gap', 'invalid expiry');
  d2Only(d2Gate(U('reason: "r"', ok, 'expires: "2026-10-05"')), 'R5-untracked-quality', 'style-slot:gap', 'past expiry');
  // Injected clock derived from the REAL registry's own expiry dates at run time (no
  // hard-coded real-registry dates, so extending expiry can never break this pin).
  const real = [...loadTraitRegistry().entries].filter(([, e]) => e.untracked).map(([id, e]) => [id, new Date(e.untracked.expires).getTime()]);
  assert(real.length > 0 && real.every(([, t]) => !Number.isNaN(t)), 'the real registry must have untracked entries with parseable expiries');
  const DAY = 86400000;
  const latest = Math.max(...real.map(([, t]) => t));
  const earliest = Math.min(...real.map(([, t]) => t));
  // After the LATEST expiry (that date + 1 day, 12:00 UTC) every real untracked entry is past -> R5 only.
  const late = d2Gate((t) => t, { now: new Date(latest + DAY + 12 * 3600000) });
  assert(!late.ok && JSON.stringify(d2Rules(late)) === '["R5-untracked-quality"]', 'after the latest real expiry the gate must fail with R5 only');
  assert(real.every(([id]) => d2Fired(late, 'R5-untracked-quality', id)), 'after the latest real expiry every real untracked entry must be named by R5');
  // The day before the EARLIEST expiry nothing is past, so the real registry passes.
  assert(d2Gate((t) => t, { now: new Date(earliest - DAY) }).ok, 'the day before the earliest real expiry the gate must pass');
});

check('P90', 'trait-registry gate R6-duplicate: the same construct twice FAILS naming it (even with two otherwise-valid entries)', () => {
  d2Only(d2Gate((t) => `${t.trimEnd()}\n${t.split('\n').find((l) => l.startsWith('  "style-slot:gap":'))}\n`), 'R6-duplicate', 'style-slot:gap', 'duplicate construct');
});

check('P91', 'trait-registry gate wiring: ci.mjs runs it as a blocking step, output is deterministic, advisories never fail, the real registry passes at the pinned clock', () => {
  const ci = readFileSync(resolve(ROOT, '_shared/scripts/ci.mjs'), 'utf8');
  assert(/run\('node _shared\/scripts\/check-trait-registry\.mjs'\);\s*\}\s*catch \{ console\.error\('FAIL: check-trait-registry'\); failures\+\+; \}/.test(ci), 'ci.mjs must run check-trait-registry.mjs and count a failure');
  const real = checkTraitRegistryGate({ now: D2_NOW });
  assert(real.ok, `the real registry must pass: ${real.issues.slice(0, 2).map((i) => i.msg).join('; ')}`);
  assert(formatReport(real) === formatReport(checkTraitRegistryGate({ now: D2_NOW })), 'two runs must produce byte-identical output');
  assert(real.advisory.unreferencedTraits.includes('a11y.labelledBy'), 'advisory must list the unreferenced a11y.labelledBy trait');
  // Advisory expiring-soon must never fail the gate. Proven on a temp fixture copy whose
  // style-slot:gap entry expires 40 days after the pinned clock (inside the 90-day window),
  // so this does not depend on any real-registry date.
  const soon = new Date(D2_NOW.getTime() + 40 * 86400000).toISOString().slice(0, 10);
  const near = d2Gate((t) => d2Line(t, 'style-slot:gap', () => `  "style-slot:gap": { untracked: { reason: "r", approver: "Ssuppanut (design-system a11y owner)", expires: "${soon}" } }`));
  assert(near.advisory.expiringSoon.includes('style-slot:gap') && near.advisory.expiringSoon.length > 0, 'an entry expiring inside the 90-day window must be listed as expiring-soon');
  assert(near.ok && near.issues.length === 0, 'expiring-soon is advisory only: the gate must still pass');
});

// --- D3: corpus coverage gate (C0..C4) + R7 (declared AND handled) + advisory + wiring ----
// Every pin runs on TEMPORARY fixtures (temp specs / allowlist text / registry copies) with a
// pinned clock, and derives anything it needs from the real files at run time, so none depends
// on a real allowlist or registry date (D2's P89/P91 are the model).
const D3_NOW = new Date('2026-10-06T00:00:00Z');
const D3_APPROVER = 'Ssuppanut (design-system a11y owner)';
const d3Day = (days) => new Date(D3_NOW.getTime() + days * 86400000).toISOString().slice(0, 10);
const d3Entry = (id, { reason = 'r', approver = D3_APPROVER, expires = d3Day(120) } = {}) => `  "${id}": { ${[reason === null ? null : `reason: ${JSON.stringify(reason)}`, approver === null ? null : `approver: ${JSON.stringify(approver)}`, expires === null ? null : `expires: ${JSON.stringify(expires)}`].filter(Boolean).join(', ')} }\n`;
const d3List = (...entries) => `allowlist:\n${entries.join('')}`;
const D3_TINY = 'component: Tiny\nroot:\n  el: container\n  children:\n    - el: text\n      text: { kind: literal, value: hi }\n';
function d3Cov({ allowlist, constructs, specs, ...opts }) {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-coverage-'));
  try {
    const specPaths = specs ? Object.entries(specs).map(([name, text]) => { const f = join(dir, name); writeFileSync(f, text); return f; }) : undefined;
    return checkCorpusCoverage({ allowlistText: allowlist, constructs, ...(specPaths ? { specPaths } : {}), now: D3_NOW, ...opts });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const d3Rules = (r) => [...new Set(r.issues.map((i) => i.rule))];
const d3Only = (r, rule, construct, why) => {
  assert(!r.ok, `${why}: the gate must FAIL`);
  assert(r.issues.some((i) => i.rule === rule && i.construct === construct && i.msg.includes(construct)), `${why}: expected ${rule} naming "${construct}", got ${JSON.stringify(r.issues.map((i) => [i.rule, i.construct]))}`);
  assert(JSON.stringify(d3Rules(r)) === JSON.stringify([rule]), `${why}: only ${rule} may fire, got ${d3Rules(r)}`);
};
const D3_LINK = ['el-kind:text', 'el-kind:link']; // the tiny corpus exercises text, never link

check('P92', 'corpus coverage C1-uncovered: a derived construct exercised by no corpus spec and not allowlisted FAILS naming it; an allowlist entry resolves it', () => {
  const real = readFileSync(ALLOWLIST_PATH, 'utf8');
  d3Only(d3Cov({ allowlist: real, constructs: [...deriveConstructs(), 'element.field:brandNew'] }), 'C1-uncovered', 'element.field:brandNew', 'new schema construct nobody tests');
  d3Only(d3Cov({ allowlist: d3List(), constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY } }), 'C1-uncovered', 'el-kind:link', 'tiny corpus never exercises link');
  // A spec in a refused category (overlay / data-table) never reaches an adapter, so it is NOT coverage.
  const refusedLink = 'component: Refused\ncategory: overlay\nroot:\n  el: container\n  children:\n    - el: link\n      href: { kind: literal, value: "https://example.com" }\n';
  d3Only(d3Cov({ allowlist: d3List(), constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY, 'refused.yaml': refusedLink } }), 'C1-uncovered', 'el-kind:link', 'a refusal-fixture spec must not count as coverage');
  assert(d3Cov({ allowlist: d3List(), constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY, 'lowered.yaml': refusedLink.replace('category: overlay', 'category: display') } }).ok, 'the same spec in a lowered category must count as coverage');
  const ok = d3Cov({ allowlist: d3List(d3Entry('el-kind:link')), constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY } });
  assert(ok.ok && ok.counts.covered === 1 && ok.counts.allowlisted === 1, `a valid allowlist entry must resolve C1 (covered 1, allowlisted 1): ${JSON.stringify(ok.issues)}`);
});

check('P93', 'corpus coverage C2-stale-allowlist: an entry naming a non-construct FAILS, and an entry for a construct that is now exercised FAILS (delete it)', () => {
  d3Only(d3Cov({ allowlist: d3List(d3Entry('element.field:ghost')), constructs: ['el-kind:text'], specs: { 'tiny.yaml': D3_TINY } }), 'C2-stale-allowlist', 'element.field:ghost', 'entry naming a non-construct');
  const now = d3Cov({ allowlist: d3List(d3Entry('el-kind:text')), constructs: ['el-kind:text'], specs: { 'tiny.yaml': D3_TINY } });
  d3Only(now, 'C2-stale-allowlist', 'el-kind:text', 'entry for a construct that is now exercised');
  assert(/delete/.test(now.issues[0].msg), 'the now-exercised message must tell the author to delete the entry');
});

check('P94', 'corpus coverage C3-allowlist-quality: empty/missing reason, wrong or case-differing approver, missing/invalid/past expiry, non-mapping FAILS; the expiry day is not inclusive', () => {
  const base = { constructs: ['el-kind:link'], specs: { 'tiny.yaml': D3_TINY } };
  const one = (opts, why, cfg = {}) => d3Only(d3Cov({ ...base, allowlist: d3List(d3Entry('el-kind:link', opts)), ...cfg }), 'C3-allowlist-quality', 'el-kind:link', why);
  one({ reason: '' }, 'empty reason');
  one({ reason: null }, 'missing reason');
  one({ approver: 'Someone Else' }, 'wrong approver');
  one({ approver: 'ssuppanut (design-system a11y owner)' }, 'approver differs only by case');
  one({ approver: null }, 'missing approver');
  one({ expires: null }, 'missing expiry');
  one({ expires: 'not-a-date' }, 'invalid expiry');
  one({ expires: d3Day(-1) }, 'past expiry');
  one({ expires: d3Day(0) }, 'expiry day is NOT inclusive (past later on its own date)', { now: new Date(D3_NOW.getTime() + 12 * 3600000) });
  const scalar = d3Cov({ ...base, allowlist: 'allowlist:\n  "el-kind:link": "just a string"\n' });
  d3Only(scalar, 'C3-allowlist-quality', 'el-kind:link', 'non-mapping entry');
  assert(scalar.issues.length === 1 && /must be a mapping/.test(scalar.issues[0].msg), `a non-mapping entry must be reported once as "must be a mapping", got ${JSON.stringify(scalar.issues.map((i) => i.msg))}`);
  assert(d3Cov({ ...base, allowlist: d3List(d3Entry('el-kind:link', { expires: d3Day(1) })) }).ok, 'an expiry the day after the clock must pass');
});

check('P95', 'corpus coverage C4-duplicate: the same construct listed twice FAILS naming it', () => {
  d3Only(d3Cov({ allowlist: d3List(d3Entry('el-kind:link'), d3Entry('el-kind:link')), constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY } }), 'C4-duplicate', 'el-kind:link', 'duplicate allowlist entry');
});

check('P96', 'corpus coverage C0-load: a missing/invalid allowlist, an allowlist with no map, an unparseable corpus spec, or an empty corpus FAILS', () => {
  const has = (r, why) => assert(!r.ok && d3Rules(r).includes('C0-load'), `${why}: C0-load must fire, got ${d3Rules(r)}`);
  has(checkCorpusCoverage({ allowlistPath: join(tmpdir(), 'no-such-allowlist.yaml'), constructs: D3_LINK, now: D3_NOW }), 'missing allowlist file');
  has(d3Cov({ allowlist: 'allowlist: [unclosed', constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY } }), 'invalid YAML');
  has(d3Cov({ allowlist: 'version: 1\n', constructs: D3_LINK, specs: { 'tiny.yaml': D3_TINY } }), 'no allowlist map');
  has(d3Cov({ allowlist: d3List(), constructs: ['el-kind:text'], specs: { 'broken.yaml': 'root: [unclosed' } }), 'unparseable corpus spec');
  has(d3Cov({ allowlist: d3List(), constructs: ['el-kind:text'], specs: {} }), 'empty corpus');
  // A present-but-empty allowlist is the goal state (everything exercised): valid, never C0.
  for (const empty of ['allowlist:\n', 'allowlist: {}\n']) assert(d3Cov({ allowlist: empty, constructs: ['el-kind:text'], specs: { 'tiny.yaml': D3_TINY } }).ok, `an empty allowlist (${JSON.stringify(empty)}) must be valid when every construct is exercised`);
  has(d3Cov({ allowlist: 'allowlist: []\n', constructs: ['el-kind:text'], specs: { 'tiny.yaml': D3_TINY } }), 'allowlist that is a list, not a mapping');
});

check('P97', 'trait registry R7-unhandled-trait: a mapped trait must be expressed/diverged by all 6 adapters in real code (comments and string-only mentions do not count); names the adapters; dangling traits stay R4 only', () => {
  const reg = loadTraitRegistry();
  const [mappedId, mappedTrait] = [...reg.entries].map(([id, e]) => [id, e.trait]).find(([, t]) => typeof t === 'string' && declaredTraitIds().includes(t));
  const handled = codeHandledTraitIdsByAdapter();
  assert(D3_ADAPTERS.every((a) => handled[a].includes(mappedTrait)), `precondition: every adapter handles the mapped trait "${mappedTrait}" today`);
  assert(d2Gate((t) => t, { handledByAdapter: handled }).ok, 'the real registry must pass R7 with the real adapters');
  const without = (adapters) => Object.fromEntries(D3_ADAPTERS.map((a) => [a, adapters.includes(a) ? handled[a].filter((t) => t !== mappedTrait) : handled[a]]));
  const one = d2Gate((t) => t, { handledByAdapter: without(['swiftui']) });
  d2Only(one, 'R7-unhandled-trait', mappedId, 'one adapter does not handle a mapped trait');
  assert(/swiftui/.test(one.issues[0].msg) && !/react|vue|svelte|compose/.test(one.issues[0].msg.split('adapter')[1] ?? ''), `R7 must name only the missing adapter (swiftui): ${one.issues[0].msg}`);
  const all = d2Gate((t) => t, { handledByAdapter: without(D3_ADAPTERS) });
  d2Only(all, 'R7-unhandled-trait', mappedId, 'no adapter handles the mapped trait');
  assert(/any of the 6 adapters/.test(all.issues[0].msg), 'R7 must say no adapter handles it');
  // Code-only scan: a commented-out call and a string-only mention do not handle the trait.
  const real = `this.express(${JSON.stringify(mappedTrait)}, {});`;
  const fake = `// ${real}\nconst s = "${real.replace(/"/g, "'")}"; const t = \`${real.replace(/"/g, "'")}\`;`;
  const scanned = codeHandledTraitIdsByAdapter((a) => (a === 'compose' ? fake : real));
  assert(!scanned.compose.includes(mappedTrait) && scanned.react.includes(mappedTrait), 'a commented-out call or string-only mention must not count as handling');
  d2Only(d2Gate((t) => t, { handledByAdapter: scanned }), 'R7-unhandled-trait', mappedId, 'only comments / strings mention the trait in compose');
  // A dangling (undeclared) trait is R4 only, never double-reported as R7.
  d2Only(d2Gate((t) => d2Line(t, mappedId, () => `  "${mappedId}": { trait: "no-such-trait" }`), { handledByAdapter: handled }), 'R4-dangling-trait', mappedId, 'undeclared trait');
});

check('P98', 'trait registry advisory: declared traits not handled by all 6 adapters are listed per adapter and NEVER fail the gate', () => {
  const handled = codeHandledTraitIdsByAdapter();
  const declared = [...declaredTraitIds(), 'zz-synthetic-trait'];
  const none = d2Gate((t) => t, { declaredTraits: declared, handledByAdapter: handled });
  assert(none.ok && none.advisory.unhandledTraits.some((u) => u.trait === 'zz-synthetic-trait' && u.missing.length === D3_ADAPTERS.length), 'a declared trait no adapter handles must be advisory (missing in all 6) and must not fail');
  const partial = Object.fromEntries(D3_ADAPTERS.map((a) => [a, a === 'vue' ? handled[a] : [...handled[a], 'zz-synthetic-trait']]));
  const some = d2Gate((t) => t, { declaredTraits: declared, handledByAdapter: partial });
  assert(some.ok && JSON.stringify(some.advisory.unhandledTraits.filter((u) => u.trait === 'zz-synthetic-trait')) === JSON.stringify([{ trait: 'zz-synthetic-trait', missing: ['vue'] }]), 'a trait missing in one adapter must list exactly that adapter');
  assert(/ADVISORY .*not handled by all 6 adapters.*zz-synthetic-trait \(missing in vue\)/.test(formatReport(some)), 'the report must print the per-adapter advisory');
});

check('P99', 'D3 wiring: ci.mjs runs check-corpus-coverage as a blocking step; both gates are deterministic; the real files pass at the pinned clock', () => {
  const ci = readFileSync(resolve(ROOT, '_shared/scripts/ci.mjs'), 'utf8');
  assert(/run\('node _shared\/scripts\/check-corpus-coverage\.mjs'\);\s*\}\s*catch \{ console\.error\('FAIL: check-corpus-coverage'\); failures\+\+; \}/.test(ci), 'ci.mjs must run check-corpus-coverage.mjs and count a failure');
  const cov = checkCorpusCoverage({ now: D3_NOW });
  assert(cov.ok, `the real corpus + allowlist must pass: ${cov.issues.slice(0, 2).map((i) => i.msg).join('; ')}`);
  assert(formatCoverageReport(cov) === formatCoverageReport(checkCorpusCoverage({ now: D3_NOW })), 'two corpus-coverage runs must be byte-identical');
  assert(formatReport(checkTraitRegistryGate({ now: D3_NOW })) === formatReport(checkTraitRegistryGate({ now: D3_NOW })), 'two trait-registry runs must be byte-identical');
  assert(cov.counts.covered + cov.counts.allowlisted === cov.counts.constructs, 'every derived construct is exercised or allowlisted');
});

check('P100', 'corpus coverage walker: exercisedConstructs() returns exactly the constructs a spec uses (schema-driven walk: nested conditional, variant style slots, a11y, number format, enum values) and nothing else', () => {
  const doc = parseYaml(`
component: Probe
root:
  el: container
  orientation: horizontal
  style: { gap: space.4 }
  a11y: { live: polite, label: { kind: literal, value: x } }
  children:
    - el: conditional
      when: flag
      then:
        el: text
        text: { kind: format, value: amount, format: { style: currency, precision: 2 } }
      else:
        el: action
        label: { kind: literal, value: Go }
        variant: { prop: tone, intent: emphasis, cases: { a: { color: color.fg.default, icon: icon.x } } }
`);
  const expected = [
    'el-kind:container', 'el-kind:conditional', 'el-kind:text', 'el-kind:action',
    'element.field:el', 'element.field:orientation', 'element.field:style', 'element.field:a11y', 'element.field:children',
    'element.field:when', 'element.field:then', 'element.field:else', 'element.field:text', 'element.field:label', 'element.field:variant',
    'element.value:orientation=horizontal',
    'a11y.field:live', 'a11y.field:label', 'a11y.value:live=polite',
    'valueRef.field:kind', 'valueRef.field:value', 'valueRef.field:format', 'valueRef.value:kind=literal', 'valueRef.value:kind=format',
    'numberFormat.field:style', 'numberFormat.field:precision', 'numberFormat.value:style=currency',
    'variant.field:prop', 'variant.field:intent', 'variant.field:cases', 'variant.value:intent=emphasis',
    'style-slot:gap', 'style-slot:color', 'style-slot:icon',
  ].sort();
  const got = [...exercisedConstructs(doc)].sort();
  assert(JSON.stringify(got) === JSON.stringify(expected), `walker must return exactly the used constructs.\n  missing: ${expected.filter((x) => !got.includes(x))}\n  extra:   ${got.filter((x) => !expected.includes(x))}`);
  const derived = new Set(deriveConstructs());
  assert(got.every((c) => derived.has(c)), 'every exercised construct must be a derived construct');
});

// --- F-28: live-region value fidelity (gate L0..L3, a11y-guard output tier, wiring, determinism) ----
// Every pin runs on TEMPORARY specs / table text and pins its own clock; generated code goes to the
// existing out/<adapter>/_verify folders. None depends on a real waiver or table date.
const F28_GEN = { react: generateReact, vue: generateVue, svelte: generateSvelte, 'react-native': generateReactNative, swiftui: generateSwiftUI, compose: generateCompose };
const F28_VALUES = ['off', 'polite', 'assertive'];
const F28_SPEC = (value) => `component: LiveProbe\ncategory: feedback\nroot:\n  el: container\n  a11y:\n    live: ${value}\n  children:\n    - el: text\n      text: { kind: literal, value: hi }\n`;
const F28_REAL_TABLE = () => readFileSync(LIVE_EXPECTATIONS_PATH, 'utf8');
function f28Gate({ spec, table = F28_REAL_TABLE(), tweak = (_a, _v, code) => code, ...opts }) {
  const dir = mkdtempSync(join(tmpdir(), 'live-lowering-'));
  try {
    const specPaths = Object.entries(spec).map(([name, text]) => { const f = join(dir, name); writeFileSync(f, text); return f; });
    const generate = (adapter, p) => tweak(adapter, readFileSync(p, 'utf8').match(/live: (\w+)/)?.[1], F28_GEN[adapter](p, '_verify').code);
    return checkLiveLowering({ expectationsText: table, specPaths, generate, ...opts });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const f28Rules = (r) => [...new Set(r.issues.map((i) => i.rule))];
// A deliberately wrong lowering per adapter x value (the OLD F-28 behaviour or another value's form).
const F28_BREAK = {
  react: { off: ['aria-live="off"', 'aria-live="polite"'], polite: ['aria-live="polite"', 'aria-live="assertive"'], assertive: ['aria-live="assertive"', 'aria-live="off"'] },
  vue: { off: ['aria-live="off"', 'aria-live="polite"'], polite: ['aria-live="polite"', 'aria-live="assertive"'], assertive: ['aria-live="assertive"', 'aria-live="off"'] },
  svelte: { off: ['aria-live="off"', 'aria-live="polite"'], polite: ['aria-live="polite"', 'aria-live="assertive"'], assertive: ['aria-live="assertive"', 'aria-live="off"'] },
  'react-native': { off: ['accessibilityLiveRegion="none"', 'accessibilityLiveRegion="polite"'], polite: ['accessibilityLiveRegion="polite"', 'accessibilityLiveRegion="none"'], assertive: ['accessibilityLiveRegion="assertive"', 'accessibilityLiveRegion="polite"'] },
};
function f28Broken(adapter, value, code) {
  if (F28_BREAK[adapter]) { const [from, to] = F28_BREAK[adapter][value]; assert(code.includes(from), `${adapter}/${value}: expected the real output to contain ${from}`); return code.replace(from, to); }
  if (adapter === 'swiftui') return `${code}\n  .accessibilityAddTraits(.updatesFrequently)\n`; // the OLD behaviour, for every value
  if (adapter === 'compose') return value === 'off' ? `${code}\n  Modifier.semantics { liveRegion = LiveRegionMode.Polite }\n` // the OLD behaviour for off
    : code.replace(value === 'polite' ? 'LiveRegionMode.Polite' : 'LiveRegionMode.Assertive', value === 'polite' ? 'LiveRegionMode.Assertive' : 'LiveRegionMode.Polite');
  throw new Error(`no break for ${adapter}`);
}
function f28AdapterPin(adapter) {
  for (const value of F28_VALUES) {
    const spec = { 'design-spec.yaml': F28_SPEC(value) };
    const clean = f28Gate({ spec });
    assert(clean.ok && clean.counts.comparisons === 6, `real ${adapter}-era adapters must pass the gate for live: ${value}: ${JSON.stringify(clean.issues.map((i) => i.msg))}`);
    const bad = f28Gate({ spec, tweak: (a, v, code) => (a === adapter ? f28Broken(a, v, code) : code) });
    assert(!bad.ok && JSON.stringify(f28Rules(bad)) === JSON.stringify(['L1-mismatch']), `${adapter}/${value}: breaking the lowering must fire only L1, got ${f28Rules(bad)}`);
    assert(bad.issues.length === 1 && bad.issues[0].adapter === adapter && bad.issues[0].value === value && bad.issues[0].msg.includes(adapter) && bad.issues[0].msg.includes(`live=${value}`) && bad.issues[0].spec.endsWith('design-spec.yaml'),
      `${adapter}/${value}: L1 must name exactly the adapter, the value and the spec: ${JSON.stringify(bad.issues)}`);
  }
}
check('P101', 'live lowering L1 (react): aria-live must equal the value; a wrong value FAILS naming adapter + value for off, polite, assertive', () => f28AdapterPin('react'));
check('P102', 'live lowering L1 (vue): aria-live must equal the value; a wrong value FAILS naming adapter + value for off, polite, assertive', () => f28AdapterPin('vue'));
check('P103', 'live lowering L1 (svelte): aria-live must equal the value; a wrong value FAILS naming adapter + value for off, polite, assertive', () => f28AdapterPin('svelte'));
check('P104', 'live lowering L1 (react-native): accessibilityLiveRegion must be none/polite/assertive; the OLD off -> polite FAILS naming adapter + value, as does every other wrong value', () => f28AdapterPin('react-native'));
check('P105', 'live lowering L1 (swiftui): NOTHING may be emitted for any value; the OLD updatesFrequently FAILS naming adapter + value', () => f28AdapterPin('swiftui'));
check('P106', 'live lowering L1 (compose): off omits liveRegion, polite/assertive map to LiveRegionMode; the OLD off -> Polite FAILS naming adapter + value, as does every other wrong value', () => f28AdapterPin('compose'));

check('P107', 'live lowering L0-load: a missing or invalid table, a table with no rows, an unparseable corpus spec, or an adapter that fails to generate FAILS', () => {
  const spec = { 'design-spec.yaml': F28_SPEC('off') };
  const missing = checkLiveLowering({ expectationsPath: join(tmpdir(), 'no-such-live-table.yaml'), specPaths: [] });
  assert(!missing.ok && missing.issues.some((i) => i.rule === 'L0-load' && /not found/.test(i.msg)), 'a missing table must be L0');
  for (const [why, table] of [['invalid YAML', 'rows: [unclosed'], ['no rows list', 'version: 1\n'], ['rows not a list', 'rows: nope\n']]) {
    const r = f28Gate({ spec, table });
    assert(!r.ok && r.issues.some((i) => i.rule === 'L0-load'), `${why} must be L0, got ${f28Rules(r)}`);
  }
  const bad = f28Gate({ spec: { 'design-spec.yaml': 'root: [unclosed' } });
  assert(!bad.ok && bad.issues.some((i) => i.rule === 'L0-load' && /unparseable/.test(i.msg)), 'an unparseable corpus spec must be L0');
  const boom = f28Gate({ spec, tweak: () => { throw new Error('adapter exploded'); } });
  assert(!boom.ok && boom.issues.some((i) => i.rule === 'L0-load' && /failed to generate/.test(i.msg)), 'a generator failure must be L0, never a silent pass');
});

check('P108', 'live lowering L2-uncovered: a missing adapter x value row, or a spec value with no row, FAILS naming adapter and value', () => {
  const spec = { 'design-spec.yaml': F28_SPEC('polite') };
  const lines = F28_REAL_TABLE().split('\n');
  const without = (adapter, value) => lines.filter((l) => !(l.includes(`adapter: ${adapter},`) && l.includes(`value: ${value},`))).join('\n');
  for (const [adapter, value] of [['swiftui', 'assertive'], ['react-native', 'off'], ['compose', 'polite']]) {
    const r = f28Gate({ spec, table: without(adapter, value) });
    assert(r.issues.some((i) => i.rule === 'L2-uncovered' && i.adapter === adapter && i.value === value && i.msg.includes(adapter) && i.msg.includes(value)), `dropping ${adapter}/${value} must be L2 naming both, got ${JSON.stringify(r.issues.map((i) => [i.rule, i.adapter, i.value]))}`);
    assert(JSON.stringify(f28Rules(r)) === JSON.stringify(['L2-uncovered']), `only L2 may fire for a dropped row, got ${f28Rules(r)}`);
  }
  // A new enum value with no rows is uncovered on all 6 adapters.
  const fresh = f28Gate({ spec, values: [...F28_VALUES, 'rude'] });
  assert(fresh.issues.filter((i) => i.rule === 'L2-uncovered' && i.value === 'rude').length === 6, 'a new live value must be uncovered on all 6 adapters');
  // A spec that declares a value outside the enum (and so without rows) names the spec.
  const stray = f28Gate({ spec: { 'design-spec.yaml': F28_SPEC('rude') } });
  assert(stray.issues.some((i) => i.rule === 'L2-uncovered' && i.value === 'rude' && i.spec.endsWith('design-spec.yaml')), 'a spec value with no row must be L2 naming the spec');
});

check('P109', 'live lowering L3-row-quality: empty expected/doc, evidence outside SOURCE/DEVICE/DOC, unknown adapter/value, a duplicate or a non-mapping row FAILS', () => {
  const spec = { 'design-spec.yaml': F28_SPEC('off') };
  const lines = F28_REAL_TABLE().split('\n');
  const target = (adapter, value) => lines.findIndex((l) => l.includes(`adapter: ${adapter},`) && l.includes(`value: ${value},`));
  const edit = (adapter, value, fn) => { const i = target(adapter, value); const c = [...lines]; c[i] = fn(c[i]); return c.join('\n'); };
  const cases = [
    ['empty doc reference', edit('react', 'off', (l) => l.replace(/doc: "[^"]*"/, 'doc: ""')), 'react', 'off'],
    ['evidence outside the set', edit('vue', 'polite', (l) => l.replace('evidence: DOC', 'evidence: GUESS')), 'vue', 'polite'],
    ['missing evidence', edit('swiftui', 'assertive', (l) => l.replace(', evidence: DEVICE', '')), 'swiftui', 'assertive'],
    ['empty expected form', edit('compose', 'off', (l) => l.replace('expected: NONE', 'expected: ""')), 'compose', 'off'],
    ['unknown adapter', edit('svelte', 'off', (l) => l.replace('adapter: svelte', 'adapter: flutter')), 'flutter', 'off'],
    ['unknown value', edit('svelte', 'assertive', (l) => l.replace('value: assertive', 'value: shouty')), 'svelte', 'shouty'],
  ];
  for (const [why, table, adapter, value] of cases) {
    const r = f28Gate({ spec, table });
    assert(r.issues.some((i) => i.rule === 'L3-row-quality' && i.adapter === adapter && i.value === value), `${why}: expected L3 naming ${adapter}/${value}, got ${JSON.stringify(r.issues.map((i) => [i.rule, i.adapter, i.value]))}`);
  }
  const dup = f28Gate({ spec, table: `${F28_REAL_TABLE()}${lines[target('react', 'off')]}\n` });
  assert(dup.issues.some((i) => i.rule === 'L3-row-quality' && i.adapter === 'react' && i.value === 'off' && /duplicate/.test(i.msg)), 'a duplicate row must be L3');
  const nonMap = f28Gate({ spec, table: `${F28_REAL_TABLE()}  - just a string\n` });
  assert(nonMap.issues.some((i) => i.rule === 'L3-row-quality' && /must be a mapping/.test(i.msg)), 'a non-mapping row must be L3');
  assert(f28Gate({ spec }).ok, 'the unmodified real table must pass on the probe spec');
});

check('P110', 'a11y-guard output tier (F-28): a missing live trait is accepted ONLY for off-by-omission (swiftui, compose) or a waiver-backed ledger divergence for that value; a warning alone is not enough', () => {
  const spec = (value) => { const f = join(tmpdir(), `f28-a11y-${process.pid}.yaml`); writeFileSync(f, F28_SPEC(value)); return f; };
  for (const value of F28_VALUES) {
    const f = spec(value);
    try {
      const ir = specToIrFromFile(f);
      const real = Object.fromEntries(Object.entries(F28_GEN).map(([a, g]) => [a, g(f, '_verify')]));
      const clean = checkA11y(ir, real);
      assert(clean.ok, `real output for live: ${value} must pass the guard: ${JSON.stringify(clean.issues)}`);
      // swiftui emits nothing: strip its ledger and the guard must refuse (value-blind acceptance closed)
      const noLedger = checkA11y(ir, { swiftui: { ...real.swiftui, ledger: [] } });
      assert(!noLedger.ok && noLedger.issues.some((i) => i.rule === 'a11y-output-live' && i.msg.startsWith('swiftui:')), `swiftui/${value}: an absent live trait with no ledger reason must FAIL`);
      // a free-text warning must NOT be accepted any more
      const warnOnly = checkA11y(ir, { swiftui: { ...real.swiftui, ledger: [], warnings: ['a11y: live is documented elsewhere'] } });
      assert(!warnOnly.ok, `swiftui/${value}: a warning alone must not justify a missing live trait`);
      if (value !== 'off') {
        const noWaiver = checkA11y(ir, { swiftui: { ...real.swiftui, ledger: real.swiftui.ledger.map((e) => (e.traitId === `a11y.live=${value}` ? { ...e, waiver: undefined } : e)) } });
        assert(!noWaiver.ok, `swiftui/${value}: a divergence with no waiver id must FAIL`);
        const wrongValue = checkA11y(ir, { swiftui: { ...real.swiftui, ledger: real.swiftui.ledger.map((e) => (e.traitId === `a11y.live=${value}` ? { ...e, traitId: 'a11y.live=off', status: 'expressed' } : e)) } });
        assert(!wrongValue.ok, `swiftui/${value}: an off-by-omission entry must not justify a different value`);
      } else {
        // off is only correct by omission where the platform has no off value: web must emit it
        const webNoTrait = checkA11y(ir, { react: { ...real.react, code: real.react.code.replace(/ aria-live="off"/, '') } });
        assert(!webNoTrait.ok && webNoTrait.issues.some((i) => i.rule === 'a11y-output-live'), 'react/off: a missing aria-live="off" must FAIL (omission is not correct on web)');
      }
    } finally { rmSync(f, { force: true }); }
  }
});

check('P111', 'F-28 wiring: ci.mjs runs check-live-lowering as a blocking step; the real table has all 18 adapter x value rows; the 4 waivers exist, cite the audit and are approved; the real corpus passes', () => {
  const ci = readFileSync(resolve(ROOT, '_shared/scripts/ci.mjs'), 'utf8');
  assert(/run\('node _shared\/scripts\/check-live-lowering\.mjs'\);\s*\}\s*catch \{ console\.error\('FAIL: check-live-lowering'\); failures\+\+; \}/.test(ci), 'ci.mjs must run check-live-lowering.mjs and count a failure');
  const table = parseYaml(F28_REAL_TABLE());
  const keys = table.rows.map((r) => `${r.adapter}/${r.value}`).sort();
  const want = D3_ADAPTERS.flatMap((a) => F28_VALUES.map((v) => `${a}/${v}`)).sort();
  assert(JSON.stringify(keys) === JSON.stringify(want), `the real table must have exactly the 18 adapter x value rows, got ${keys.length}`);
  const waivers = JSON.parse(readFileSync(resolve(ROOT, '_shared/policy/a11y-waivers.json'), 'utf8')).waivers;
  for (const id of ['a11y-live-polite-swiftui', 'a11y-live-assertive-swiftui', 'a11y-live-polite-react-native', 'a11y-live-assertive-react-native']) {
    const w = waivers[id];
    assert(w && w.approver === 'Ssuppanut (design-system a11y owner)' && typeof w.expires === 'string' && !Number.isNaN(new Date(w.expires).getTime()) && /F-28-value-lowering-audit\.md/.test(w.reason), `waiver ${id} must exist, be approved, have a parseable expiry and cite the audit`);
  }
  // The ledger accepts the real divergences under the pinned clock and refuses one with an unknown waiver id.
  const f = join(tmpdir(), `f28-wire-${process.pid}.yaml`); writeFileSync(f, F28_SPEC('polite'));
  try {
    const ledger = ['react-native', 'swiftui'].flatMap((a) => F28_GEN[a](f, '_verify').ledger);
    assert(ledger.filter((e) => e.status === 'diverged' && e.traitId === 'a11y.live=polite').length === 2, 'react-native and swiftui must each diverge on live=polite');
    assert(checkLedger(ledger, { now: D3_NOW }).ok, 'the real divergences must be accepted under the pinned clock');
    const orphan = ledger.map((e) => (e.traitId === 'a11y.live=polite' ? { ...e, waiver: 'a11y-live-nonexistent' } : e));
    assert(!checkLedger(orphan, { now: D3_NOW }).ok, 'a live divergence under an unknown waiver id must FAIL the ledger');
  } finally { rmSync(f, { force: true }); }
  const r = checkLiveLowering();
  assert(r.ok && r.counts.liveSpecs >= 6, `the real corpus must pass the live lowering gate: ${r.issues.slice(0, 2).map((i) => i.msg).join('; ')}`);
});

check('P112', 'live lowering gate is deterministic: two runs on the real corpus and on a failing fixture produce byte-identical reports; issues sort by rule, adapter, value, spec', () => {
  assert(formatLiveReport(checkLiveLowering()) === formatLiveReport(checkLiveLowering()), 'two real-corpus runs must be byte-identical');
  const specs = { 'b.yaml': F28_SPEC('polite'), 'a.yaml': F28_SPEC('off') };
  const run = () => f28Gate({ spec: specs, tweak: (a, v, code) => (a === 'compose' || a === 'react' ? f28Broken(a, v, code) : code) });
  const one = run(); const two = run();
  const norm = (r) => formatLiveReport(r).replace(/\S*live-lowering-[A-Za-z0-9]+\//g, '<tmp>/'); // each run gets its own temp dir
  assert(norm(one) === norm(two), 'two failing-fixture runs must be byte-identical');
  const order = one.issues.map((i) => [i.rule, i.adapter, i.value, i.spec]);
  assert(JSON.stringify(order) === JSON.stringify([...order].sort((x, y) => RULES_L.indexOf(x[0]) - RULES_L.indexOf(y[0]) || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0))), 'issues must be sorted by rule, adapter, value, spec');
  assert(one.issues.length === 4, `2 specs x 2 broken adapters must give 4 L1 issues, got ${one.issues.length}`);
});

console.log('\n=== verify-patches ===');
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
