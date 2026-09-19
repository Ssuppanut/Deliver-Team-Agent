#!/usr/bin/env node
/**
 * ci — the full pipeline as one command, for GitHub Actions and local checks.
 *   1. build tokens
 *   2. run e2e for every discovered feature (example specs + artifact specs)
 *      - in-scope features must pass every gate
 *      - refused categories (overlay / data-table) must refuse, not generate
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
  console.log('## 1. build tokens');
  run('node design-system/tokens-dtcg/scripts/build.mjs');

  console.log('\n## 1b. validate architecture (agents / skills / artifacts / workflow / AI)');
  let failures = 0;
  try { run('node _shared/scripts/validate-architecture.mjs'); }
  catch { console.error('FAIL: validate-architecture'); failures++; }

  console.log('\n## 1c. conditional workflow scenarios (A–H)');
  try { run('node _shared/scripts/workflow-eval.mjs'); }
  catch { console.error('FAIL: workflow-eval'); failures++; }

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

  console.log('\n## 3. regression harness');
  try { run('node _shared/scripts/verify-patches.mjs'); }
  catch { console.error('FAIL: verify-patches'); failures++; }

  console.log(`\n${failures === 0 ? 'CI PASS' : `CI FAIL (${failures})`}`);
  process.exit(failures ? 1 : 0);
}

main();
