#!/usr/bin/env node
/**
 * e2e-multi — full pipeline for one feature across all 6 adapters.
 *   validate -> IR -> generate x6 -> guards (a11y/token/perf) -> parity -> report
 *
 * Usage:
 *   node _shared/scripts/e2e-multi.mjs --feature product-card
 *   node _shared/scripts/e2e-multi.mjs --spec _shared/schemas/examples/product-card.spec.yaml
 *
 * Spec resolution order:
 *   1. --spec <path>
 *   2. .claude/artifacts/<feature>/design-spec.yaml
 *   3. _shared/schemas/examples/<feature>.spec.yaml
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specToIrFromFile } from './spec-to-ir.mjs';
import { generateReact } from '../../adapters/react/generate.mjs';
import { generateVue } from '../../adapters/vue/generate.mjs';
import { generateSvelte } from '../../adapters/svelte/generate.mjs';
import { generateReactNative } from '../../adapters/react-native/generate.mjs';
import { generateSwiftUI } from '../../adapters/swiftui/generate.mjs';
import { generateCompose } from '../../adapters/compose/generate.mjs';
import { checkA11y } from '../../.claude/skills/_guards/a11y-guard/scripts/check.mjs';
import { checkTokens } from '../../.claude/skills/_guards/token-guard/scripts/check.mjs';
import { checkPerf } from '../../.claude/skills/_guards/perf-guard/scripts/check.mjs';
import { checkSlop } from '../../.claude/skills/_guards/slop-guard/scripts/check.mjs';
import { checkTbd } from '../../.claude/skills/_meta/critique/scripts/check-tbd.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const ADAPTERS = {
  react: generateReact,
  vue: generateVue,
  svelte: generateSvelte,
  'react-native': generateReactNative,
  swiftui: generateSwiftUI,
  compose: generateCompose,
};

function parseArgs(argv) {
  const args = { feature: null, spec: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--feature') args.feature = argv[++i];
    else if (argv[i] === '--spec') args.spec = argv[++i];
  }
  return args;
}

function resolveSpec({ feature, spec }) {
  if (spec) return resolve(ROOT, spec);
  const candidates = [
    resolve(ROOT, '.claude/artifacts', feature ?? '', 'design-spec.yaml'),
    resolve(ROOT, '_shared/schemas/examples', `${feature}.spec.yaml`),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`no spec found for feature "${feature}". Looked in:\n  ${candidates.join('\n  ')}`);
}

function checkParity(results, ir) {
  const issues = [];
  const names = new Set(Object.values(results).map((r) => r.component));
  if (names.size !== 1) issues.push(`component name drift across adapters: ${[...names].join(', ')}`);
  const expectedProps = ir.props.map((p) => p.name).sort().join(',');
  for (const [adapter, res] of Object.entries(results)) {
    if (!res.file) issues.push(`${adapter}: no output file`);
    // Public API parity: every prop name must appear in the generated source.
    const missing = ir.props.filter((p) => !new RegExp(`\\b${p.name}\\b`).test(res.code));
    if (missing.length) issues.push(`${adapter}: props missing from output: ${missing.map((p) => p.name).join(', ')}`);
  }
  return { ok: issues.length === 0, issues, expectedProps };
}

const fmt = (ok) => (ok ? 'PASS' : 'FAIL');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = resolveSpec(args);
  const feature = args.feature ?? specPath.split('/').pop().replace(/\.(spec\.)?ya?ml$/, '');

  console.log(`\n=== e2e-multi: ${feature} ===`);
  console.log(`spec: ${specPath.replace(ROOT + '/', '')}`);

  const ir = specToIrFromFile(specPath);
  console.log(`IR: ${ir.component} (${ir.props.length} props, ${ir.tokens.length} tokens)`);

  const results = {};
  for (const [adapter, gen] of Object.entries(ADAPTERS)) {
    results[adapter] = gen(specPath, feature);
  }
  console.log(`generated ${Object.keys(results).length} adapters -> out/<adapter>/${feature}/`);

  const tbd = checkTbd(ir);
  const a11y = checkA11y(ir);
  const tokens = checkTokens(ir, results);
  const perf = checkPerf(ir, results);
  const slop = checkSlop(ir, results);
  const parity = checkParity(results, ir);

  console.log('\nguards:');
  console.log(`  readiness    ${fmt(tbd.ok)}  (${tbd.issues.length} unresolved TBD)`);
  console.log(`  a11y-guard   ${fmt(a11y.ok)}  (${a11y.issues.length} issues)`);
  console.log(`  token-guard  ${fmt(tokens.ok)}  (${tokens.issues.length} issues)`);
  console.log(`  perf-guard   ${fmt(perf.ok)}  (${perf.issues.length} issues)`);
  console.log(`  slop-guard   ${fmt(slop.ok)}  (${slop.issues.length} issues)`);
  console.log(`  parity       ${fmt(parity.ok)}  (${parity.issues.length} issues)`);

  const allIssues = [
    ...tbd.issues.map((i) => ({ guard: 'readiness', ...i })),
    ...a11y.issues.map((i) => ({ guard: 'a11y', ...i })),
    ...tokens.issues.map((i) => ({ guard: 'token', ...i })),
    ...perf.issues.map((i) => ({ guard: 'perf', ...i })),
    ...slop.issues.map((i) => ({ guard: 'slop', ...i })),
    ...parity.issues.map((msg) => ({ guard: 'parity', severity: 'serious', msg })),
  ];
  const warnings = Object.entries(results).flatMap(([a, r]) => (r.warnings ?? []).map((w) => `${a}: ${w}`));

  if (allIssues.length) {
    console.log('\nissues:');
    for (const i of allIssues) console.log(`  [${i.severity}] ${i.guard}/${i.rule ?? 'parity'}: ${i.msg}`);
  }
  if (warnings.length) {
    console.log('\nwarnings (documented native limitations):');
    for (const w of warnings) console.log(`  ${w}`);
  }

  const gatesPass = tbd.ok && a11y.ok && tokens.ok && perf.ok && slop.ok && parity.ok;
  const report = {
    feature,
    component: ir.component,
    generatedAt: new Date().toISOString(),
    adapters: Object.fromEntries(Object.entries(results).map(([a, r]) => [a, r.file.replace(ROOT + '/', '')])),
    tokens: ir.tokens,
    guards: {
      readiness: { ok: tbd.ok, issues: tbd.issues },
      a11y: { ok: a11y.ok, issues: a11y.issues },
      token: { ok: tokens.ok, issues: tokens.issues },
      perf: { ok: perf.ok, issues: perf.issues },
      slop: { ok: slop.ok, issues: slop.issues },
      parity: { ok: parity.ok, issues: parity.issues },
    },
    warnings,
    gatesPass,
  };
  const reportDir = resolve(ROOT, 'out/_reports');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, `${feature}.json`), JSON.stringify(report, null, 2) + '\n');

  console.log(`\ngates: ${gatesPass ? 'PASS' : 'FAIL'}  -> out/_reports/${feature}.json\n`);
  if (!gatesPass) process.exit(1);
}

main();
