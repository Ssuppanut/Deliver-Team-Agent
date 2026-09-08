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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const EX = (f) => resolve(ROOT, '_shared/schemas/examples', f);
const PRODUCT = EX('product-card.spec.yaml');
const LIST = EX('user-card-list.spec.yaml');

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

console.log('\n=== verify-patches ===');
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
