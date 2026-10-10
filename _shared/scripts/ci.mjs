#!/usr/bin/env node
/**
 * ci — the full pipeline as one command, for GitHub Actions and local checks.
 *   0. token outputs gate (the committed token outputs hold real values and equal a fresh build)
 *   1. build tokens
 *   2. run e2e for every discovered feature (example specs + artifact specs)
 *      - in-scope features must pass every gate
 *      - refused categories (overlay / data-table) must refuse, not generate
 *   2b. swiftui typecheck (macOS only: the generated SwiftUI compiles; any other OS prints SKIPPED)
 *   3. run the verify-patches regression harness
 * Exits non-zero on the first real failure.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
const REFUSED = new Set(['overlay', 'data-table']);

function discoverFeatures() {
  const feats = new Map(); // name -> { specPath, category }
  const exDir = resolve(ROOT, '_shared/schemas/examples');
  for (const f of readdirSync(exDir)) {
    if (f.endsWith('.spec.yaml')) {
      const name = f.replace('.spec.yaml', '');
      feats.set(name, { specPath: resolve(exDir, f) });
    }
  }
  const artDir = resolve(ROOT, '.claude/artifacts');
  if (existsSync(artDir)) {
    for (const d of readdirSync(artDir)) {
      const spec = resolve(artDir, d, 'design-spec.yaml');
      if (existsSync(spec)) feats.set(d, { specPath: spec });
    }
  }
  for (const [, info] of feats) {
    info.category = parse(readFileSync(info.specPath, 'utf8')).category ?? 'display';
  }
  return feats;
}

function main() {
  let failures = 0;

  // Runs BEFORE the build: step 1 rewrites the outputs in place, so a stale or broken committed
  // output would otherwise be silently replaced by a good one and never reach a reviewer.
  console.log('## 0. token outputs gate (F-32 — committed token outputs hold real values, agree with each other and equal a fresh build)');
  try { run('node _shared/scripts/check-token-outputs.mjs'); }
  catch { console.error('FAIL: check-token-outputs'); failures++; }

  console.log('\n## 1. build tokens');
  run('node design-system/tokens-dtcg/scripts/build.mjs');

  console.log('\n## 1b. validate architecture (agents / skills / artifacts / workflow / AI)');
  try { run('node _shared/scripts/validate-architecture.mjs'); }
  catch { console.error('FAIL: validate-architecture'); failures++; }

  console.log('\n## 1c. conditional workflow scenarios (A–H)');
  try { run('node _shared/scripts/workflow-eval.mjs'); }
  catch { console.error('FAIL: workflow-eval'); failures++; }

  console.log('\n## 1d. validate briefs (brief.schema.yaml — every artifact brief + the template)');
  try { run('node _shared/scripts/validate-brief.mjs'); }
  catch { console.error('FAIL: validate-brief'); failures++; }

  console.log('\n## 1e. trait registry gate (D2 — every schema construct has a ledger trait or a dated, approved untracked reason)');
  try { run('node _shared/scripts/check-trait-registry.mjs'); }
  catch { console.error('FAIL: check-trait-registry'); failures++; }

  console.log('\n## 1f. corpus coverage gate (D3 — every schema construct is exercised by a corpus spec or has a dated, approved allowlist entry)');
  try { run('node _shared/scripts/check-corpus-coverage.mjs'); }
  catch { console.error('FAIL: check-corpus-coverage'); failures++; }

  console.log('\n## 1g. live lowering gate (F-28 — the emitted live-region fragment of every live corpus spec matches the per-adapter expectation table)');
  try { run('node _shared/scripts/check-live-lowering.mjs'); }
  catch { console.error('FAIL: check-live-lowering'); failures++; }

  console.log('\n## 2. run every feature');
  const feats = discoverFeatures();
  for (const [name, info] of feats) {
    const refusedExpected = REFUSED.has(info.category);
    try {
      run(`node _shared/scripts/e2e-multi.mjs --feature ${name}`);
      // e2e exits 0 for both a passing gate and a refusal; the report distinguishes them.
      const report = JSON.parse(readFileSync(resolve(ROOT, 'out/_reports', `${name}.json`), 'utf8'));
      const refused = report.refused === true;
      if (refusedExpected && !refused) { console.error(`FAIL ${name}: expected refusal for "${info.category}"`); failures++; }
      if (!refusedExpected && !report.gatesPass) { console.error(`FAIL ${name}: gates did not pass`); failures++; }
    } catch {
      console.error(`FAIL ${name}: e2e exited non-zero`);
      failures++;
    }
  }

  // F-31: the only gate that runs the Swift compiler on the generated SwiftUI. macOS only; any other OS
  // prints SKIPPED and passes (a Mac run is required before merging SwiftUI changes).
  console.log('\n## 2b. swiftui typecheck (F-31 — every corpus SwiftUI output and DesignTokens.swift type-check with the real compiler)');
  try { run('node _shared/scripts/check-swift-typecheck.mjs'); }
  catch { console.error('FAIL: check-swift-typecheck'); failures++; }

  // TS-1: type-checks the generated TypeScript output with the real compiler. Runs on every OS. The policy file
  // _shared/policy/ts-typecheck-adapters.yaml says which adapters are enabled; a disabled adapter prints a NOT
  // ENABLED line on every run and fails once its expiry has passed.
  console.log('\n## 2c. typescript typecheck (TS-1 — corpus output of every enabled adapter type-checks with the real TypeScript compiler)');
  try { run('node _shared/scripts/check-ts-typecheck.mjs'); }
  catch { console.error('FAIL: check-ts-typecheck'); failures++; }

  console.log('\n## 3. regression harness');
  try { run('node _shared/scripts/verify-patches.mjs'); }
  catch { console.error('FAIL: verify-patches'); failures++; }

  // Layer 3 — gate mutation testing. Fast (~2s), so it runs on every CI: it
  // proves each gate still goes RED on its defect class and flags any NEW blind
  // spot. Known blind spots (logged findings) keep it GREEN; a fresh survivor or
  // a gate regression turns it RED.
  console.log('\n## 4. gate mutation testing (Layer 3)');
  try { run('node _shared/scripts/mutate-gates.mjs'); }
  catch { console.error('FAIL: mutate-gates (baseline dirty or a NEW surviving mutant / gate regression)'); failures++; }

  console.log(`\n${failures === 0 ? 'CI PASS' : `CI FAIL (${failures})`}`);
  process.exit(failures ? 1 : 0);
}

main();
