#!/usr/bin/env node
/**
 * check-swift-typecheck — F-31 SwiftUI compile gate (BLOCKING on macOS, SKIPPED elsewhere).
 *
 * Every other gate reads the generated SwiftUI as TEXT. None of them ever ran the Swift compiler, so
 * 109 of 109 generated files failed to compile while every gate was green. This gate type-checks the
 * generated SwiftUI with the real compiler (no build, no run):
 *
 *   xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios17.0-simulator \
 *         _shared/tokens/DesignTokens.swift out/swiftui/<feature>/<Component>.swift
 *
 * One invocation per feature file (so one failure does not hide another), plus DesignTokens.swift alone.
 *
 * Scope: the SwiftUI output of every corpus feature that generates (a refused category produces none),
 * plus DesignTokens.swift. NOT in scope: the pin artefact directories out/swiftui/verify-* and
 * out/swiftui/_verify. They are written by verify-patches (P-series pins generate into them to read the
 * text), they are copies or variants of corpus output, and they are not part of the corpus; compiling
 * them would count one defect once per copy.
 *
 * Rules (each issue carries a stable id and names the file):
 *   S0-env         on macOS: xcrun / swiftc / the iphonesimulator SDK is not found, or out/swiftui is
 *                  missing or holds no feature directory
 *   S1-typecheck   a feature file does not type-check; the issue carries the FIRST compiler error raw,
 *                  with line and column
 *   S2-tokens      DesignTokens.swift alone does not type-check (then no feature file is compiled: every
 *                  one of them would only repeat the token error)
 *   S3-inventory   a corpus feature has no SwiftUI output, or out/swiftui holds a directory that is
 *                  neither a corpus feature nor a pin artefact directory
 *
 * On any OS other than macOS the gate prints exactly `SKIPPED (not macOS): swiftui typecheck` and exits 0.
 * Linux CI therefore does not run it; a Mac run is required before merging SwiftUI changes.
 *
 * Usage:
 *   node _shared/scripts/check-swift-typecheck.mjs [--ios 17] [--jobs N] [--timing]
 *     --ios <major>   deployment target of the simulator triple (default 17; 16 is the optional check)
 *     --jobs <n>      files compiled in parallel (default min(cpus, 8); 1 = serial)
 *     --timing        also print wall time (kept out of the default output so it stays deterministic)
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

export const RULES = ['S0-env', 'S1-typecheck', 'S2-tokens', 'S3-inventory'];
export const SKIP_MESSAGE = 'SKIPPED (not macOS): swiftui typecheck';
export const TOKENS_FILE = resolve(ROOT, '_shared/tokens/DesignTokens.swift');
export const SWIFTUI_OUT = resolve(ROOT, 'out/swiftui');
const REFUSED = new Set(['overlay', 'data-table']); // categories ci.mjs expects to be refused (no output)
const PIN_ARTEFACT = /^(?:_verify|verify-.*)$/;

/** Corpus feature names exactly as ci.mjs discovers them (examples + artifact specs), minus refused categories. */
export function corpusFeatures(root = ROOT) {
  const feats = new Map();
  const exDir = resolve(root, '_shared/schemas/examples');
  if (existsSync(exDir)) for (const f of readdirSync(exDir)) if (f.endsWith('.spec.yaml')) feats.set(f.replace('.spec.yaml', ''), resolve(exDir, f));
  const artDir = resolve(root, '.claude/artifacts');
  if (existsSync(artDir)) {
    for (const d of readdirSync(artDir)) {
      const spec = resolve(artDir, d, 'design-spec.yaml');
      if (existsSync(spec)) feats.set(d, spec);
    }
  }
  const out = [];
  for (const [name, spec] of feats) {
    const category = parse(readFileSync(spec, 'utf8')).category ?? 'display';
    if (!REFUSED.has(category)) out.push(name);
  }
  return out.sort();
}

/** The default compiler runner: spawn, collect output, never throw. */
export function spawnRunner(cmd, args) {
  return new Promise((res) => {
    let stdout = '', stderr = '';
    let child;
    try { child = spawn(cmd, args, { cwd: ROOT }); } catch (e) { res({ status: 127, stdout, stderr: String(e.message) }); return; }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => res({ status: 127, stdout, stderr: stderr + String(e.message) }));
    child.on('close', (status) => res({ status: status ?? 1, stdout, stderr }));
  });
}

/** First compiler error line `path:L:C: error: msg`, raw; falls back to the first output line. */
export function firstError(output) {
  const lines = String(output).split('\n');
  const hit = lines.find((l) => /^.*:\d+:\d+: error: /.test(l));
  return (hit ?? lines.find((l) => l.trim() !== '') ?? 'no compiler output').trim();
}

export const typecheckArgs = (ios, files) => ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-target', `arm64-apple-ios${ios}.0-simulator`, ...files];

/** Run `tasks` (async functions) with at most `limit` in flight; results keep the input order. */
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
}

/**
 * Pure rule logic. Everything environmental is injectable:
 *   platform   process.platform value
 *   run        async (cmd, args) => { status, stdout, stderr }   (the compiler runner)
 *   outDir     out/swiftui directory     tokensFile   DesignTokens.swift
 *   features   corpus feature names      listDir/exists/listSwift   file system probes (default: real fs)
 *   ios        deployment target major   jobs         parallel files
 * Returns { skipped, ok, issues:[{rule,file,msg}], checked } with issues sorted by rule order, then file.
 */
export async function checkSwiftTypecheck({
  platform = process.platform, run = spawnRunner, outDir = SWIFTUI_OUT, tokensFile = TOKENS_FILE,
  features = corpusFeatures(), ios = 17, jobs = Math.min(cpus().length, 8),
  exists = existsSync, listDir = (d) => readdirSync(d).filter((n) => statSync(resolve(d, n)).isDirectory()),
  listSwift = (d) => readdirSync(d).filter((n) => n.endsWith('.swift')),
} = {}) {
  if (platform !== 'darwin') return { skipped: true, ok: true, message: SKIP_MESSAGE, issues: [], checked: 0 };
  const issues = [];
  const add = (rule, file, msg) => issues.push({ rule, file, msg });
  const rel = (p) => relative(ROOT, p) || p;

  // S0: the toolchain and the output directory
  const sdk = await run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);
  if (sdk.status !== 0) add('S0-env', 'xcrun --sdk iphonesimulator', `the iphonesimulator SDK was not found (xcrun exit ${sdk.status}): ${firstError(sdk.stderr || sdk.stdout)}`);
  else {
    const swiftc = await run('xcrun', ['--sdk', 'iphonesimulator', '--find', 'swiftc']);
    if (swiftc.status !== 0) add('S0-env', 'swiftc', `swiftc was not found (xcrun exit ${swiftc.status}): ${firstError(swiftc.stderr || swiftc.stdout)}`);
  }
  if (!exists(outDir)) add('S0-env', rel(outDir), `${rel(outDir)} does not exist: run the generation steps first`);
  let dirs = [];
  if (exists(outDir)) {
    dirs = listDir(outDir).sort();
    if (!dirs.length) add('S0-env', rel(outDir), `${rel(outDir)} holds no feature directory`);
  }
  if (issues.length) return finish(issues, 0);

  // S3: inventory
  const featureSet = new Set(features);
  for (const f of [...features].sort()) {
    const dir = resolve(outDir, f);
    if (!dirs.includes(f) || !listSwift(dir).length) add('S3-inventory', rel(dir), `corpus feature ${f} has no SwiftUI output (${rel(dir)}/*.swift)`);
  }
  for (const d of dirs) {
    if (!featureSet.has(d) && !PIN_ARTEFACT.test(d)) add('S3-inventory', rel(resolve(outDir, d)), `${rel(resolve(outDir, d))} is neither a corpus feature nor a pin artefact directory (verify-*, _verify)`);
  }

  // S2: the tokens file alone
  const tok = await run('xcrun', typecheckArgs(ios, [tokensFile]));
  if (tok.status !== 0) {
    add('S2-tokens', rel(tokensFile), `${rel(tokensFile)} does not type-check on its own: ${firstError(tok.stderr || tok.stdout)}`);
    return finish(issues, 1);
  }

  // S1: one invocation per feature file
  const files = [];
  for (const f of [...features].sort()) {
    const dir = resolve(outDir, f);
    if (dirs.includes(f)) for (const n of listSwift(dir).sort()) files.push(resolve(dir, n));
  }
  const results = await pool(files.map((file) => async () => ({ file, r: await run('xcrun', typecheckArgs(ios, [tokensFile, file])) })), jobs);
  for (const { file, r } of results) {
    if (r.status !== 0) add('S1-typecheck', rel(file), `${rel(file)}: ${firstError(r.stderr || r.stdout)}`);
  }
  return finish(issues, files.length + 1);

  function finish(list, checked) {
    list.sort((a, b) => RULES.indexOf(a.rule) - RULES.indexOf(b.rule) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return { skipped: false, ok: list.length === 0, issues: list, checked, ios };
  }
}

export function formatReport(r) {
  if (r.skipped) return r.message;
  const lines = [];
  for (const i of r.issues) lines.push(`  ${i.rule}  ${i.msg}`);
  lines.push(r.ok
    ? `swiftui typecheck: PASS (DesignTokens.swift + ${r.checked - 1} feature files, iOS ${r.ios})`
    : `swiftui typecheck: FAIL (${r.issues.length} issue(s), iOS ${r.ios})`);
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const ios = opt('--ios', '17');
  const jobs = Number(opt('--jobs', Math.min(cpus().length, 8)));
  const t0 = Date.now();
  const r = await checkSwiftTypecheck({ ios, jobs });
  console.log(formatReport(r));
  if (argv.includes('--timing') && !r.skipped) console.log(`wall time: ${((Date.now() - t0) / 1000).toFixed(1)} s (jobs ${jobs})`);
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
