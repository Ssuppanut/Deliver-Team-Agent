#!/usr/bin/env node
/**
 * check-ts-typecheck — TS-1 TypeScript compile gate for the generated web and React Native output (BLOCKING).
 *
 * Every other gate reads the generated TSX / Vue / Svelte as TEXT. None parsed or type-checked it, so 17 of
 * the 54 corpus React files failed the real TypeScript compiler while every gate was green. This gate
 * type-checks the generated code with the TypeScript compiler API from the repo's node_modules (no npx, no
 * network, no build, no run). It runs on Linux and on macOS and is never skipped.
 *
 * Which adapters are enabled is decided by _shared/policy/ts-typecheck-adapters.yaml, one entry per adapter.
 * An adapter that is not enabled is NOT silent: every run prints one `NOT ENABLED` line for it with the
 * reason and the expiry, and the entry fails (TT3) once its expiry has passed, so nothing stays disabled
 * forever. This change enables react only.
 *
 * Method (react): ONE TypeScript program whose root files are every corpus React output (out/react/<feature>/*.tsx)
 * plus one in-memory declaration file owned by this gate (`declare module '*.css'`). TypeScript 6 checks
 * side-effect imports, and the generated code imports '../../_shared/tokens/tokens.css', which is neither a
 * module nor present under out/. The ambient wildcard resolves that import without copying any token file
 * into out/ and without adding a file to the repo. Syntactic diagnostics are collected for every file; semantic
 * diagnostics only for a file without a syntax error (as tsc does, and because the semantic errors of a file
 * that did not parse are noise). Compiler options:
 *   target ES2022, module ESNext, moduleResolution Bundler, jsx ReactJSX, strict, noEmit, skipLibCheck,
 *   esModuleInterop, allowSyntheticDefaultImports, lib es2023 + dom.
 *
 * Scope: the React output of every corpus feature that generates (a refused category produces none). NOT in
 * scope: the pin artefact directories out/react/verify-* and out/react/_verify. They are written by
 * verify-patches (its pins generate into them to read the text), they are copies or variants of corpus output
 * and not part of the corpus; compiling them would count one defect once per copy. Same rule as the SwiftUI gate.
 *
 * Vue (TS-2) runs two layers over every corpus .vue file (verify-* and _verify excluded, same rule):
 *   (a) the real Vue compiler (@vue/compiler-sfc: parse, compileScript, compileTemplate): every error is a
 *       TV1 FAIL, warnings are printed and do not fail;
 *   (b) vue-tsc over ALL the files the compiler accepts in ONE project invocation (a file the compiler rejects is
 *       a TV1 failure and is left out, because a syntax error anywhere in a project hides every semantic error) (node node_modules/vue-tsc/bin/vue-tsc.js, no
 *       npx, no network) with a tsconfig and an ambient `declare module '*.css'` that the gate writes into an OS
 *       temp directory (never into the repo) and removes afterwards. Options: target ES2022, module ESNext,
 *       moduleResolution Bundler, strict, noEmit, skipLibCheck, esModuleInterop, lib ES2023 + DOM, jsx preserve,
 *       types [], vueCompilerOptions target 3.5. The ambient wildcard resolves '../../_shared/tokens/tokens.css',
 *       which does not exist under out/, so no token file is copied.
 *
 * Rules (each issue carries a stable id and names the file):
 *   TT0-env      typescript or @types/react is not installed (run `npm ci`), vue, @vue/compiler-sfc, the
 *                vue-tsc binary or lucide-vue-next is missing while vue is enabled, the policy file is missing
 *                or unparseable, an adapter has no policy entry, or an enabled adapter has no output directory
 *   TT1-type     a file has a syntax or type error (TypeScript for react, vue-tsc for vue); the issue carries
 *                the FIRST error raw with line and column and the number of errors in the file
 *   TV1-compiler a .vue file is rejected by the Vue compiler; the issue carries the first error raw with its
 *                position and the number of errors in the file
 *   TT2-inventory a corpus feature has no output for an enabled adapter, or the adapter output directory holds
 *                a directory that is neither a corpus feature nor a pin artefact directory
 *   TT3-policy   a policy entry is invalid: unknown adapter, duplicate adapter, `enabled` not a boolean, a
 *                disabled entry with an empty reason, an approver that is not exactly APPROVER, or a missing,
 *                invalid or past expiry (the expiry day is not inclusive, same semantics as the D2/D3/D4b files)
 *
 * Usage:
 *   node _shared/scripts/check-ts-typecheck.mjs [--timing] [--per-file]
 *     --timing     also print wall time (kept out of the default output so it stays deterministic)
 *     --per-file   one TypeScript program per file instead of one program (same diagnostics; timing comparison)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, isMap, isSeq } from 'yaml';
import { APPROVER, expiryState } from './check-trait-registry.mjs';
import { corpusFeatures } from './check-swift-typecheck.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

export const RULES = ['TT0-env', 'TT1-type', 'TV1-compiler', 'TT2-inventory', 'TT3-policy'];
export const ADAPTERS = ['react', 'react-native', 'vue', 'svelte'];
export const POLICY_PATH = resolve(ROOT, '_shared/policy/ts-typecheck-adapters.yaml');
export const OUT_ROOT = resolve(ROOT, 'out');
export const AMBIENT_FILE = resolve(ROOT, '__ts_typecheck_ambient__.d.ts');
export const AMBIENT_TEXT = "declare module '*.css';\n";
const PIN_ARTEFACT = /^(?:_verify|verify-.*)$/;
const FIELDS = ['adapter', 'enabled', 'reason', 'approver', 'expires'];
const SOURCE_EXT = { react: ['.tsx', '.ts'], vue: ['.vue'] };
export const VUE_TSC_BIN = resolve(ROOT, 'node_modules/vue-tsc/bin/vue-tsc.js');

const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

/** Parse the policy file. @returns {{ entries: object[], problem?: string }} */
export function loadPolicy({ path = POLICY_PATH, text } = {}) {
  let src = text;
  if (src === undefined) {
    try { src = readFileSync(path, 'utf8'); } catch { return { entries: [], problem: `policy file not found at ${path}` }; }
  }
  const doc = parseDocument(src, { uniqueKeys: false });
  if (doc.errors.length) return { entries: [], problem: `policy file is not valid YAML: ${doc.errors[0].message.split('\n')[0]}` };
  const root = doc.contents;
  if (!isMap(root) || !root.has('adapters')) return { entries: [], problem: 'policy file has no `adapters` key' };
  const seq = root.get('adapters', true);
  if (!isSeq(seq)) return { entries: [], problem: 'policy `adapters` must be a list of entries' };
  return { entries: seq.items.map((it) => (it?.toJSON ? it.toJSON() : it)) };
}

/** The real TypeScript module, or null when it is not installed. */
export async function defaultLoadTs() {
  try { const m = await import('typescript'); return m.default ?? m; } catch { return null; }
}

/** True when @types/react resolves from the repo (the React types the generated code is checked against). */
export function defaultHasReactTypes() {
  try { createRequire(import.meta.url).resolve('@types/react/package.json'); return true; } catch { return false; }
}

export function compilerOptions(ts) {
  return {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    allowSyntheticDefaultImports: true, lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  };
}

/**
 * Type-check `files` with the real compiler. @returns Map<file, { syntax: Diag[], semantic: Diag[] }> with
 * Diag = { code, line, col, msg }. `perFile` builds one program per file instead of one for all of them.
 */
export function compileFiles(ts, files, { perFile = false, ambientFile = AMBIENT_FILE, ambientText = AMBIENT_TEXT } = {}) {
  const options = compilerOptions(ts);
  const base = ts.createCompilerHost(options);
  const host = {
    ...base,
    fileExists: (f) => f === ambientFile || base.fileExists(f),
    readFile: (f) => (f === ambientFile ? ambientText : base.readFile(f)),
    getSourceFile: (f, lang, onErr, shouldCreate) => (f === ambientFile
      ? ts.createSourceFile(f, ambientText, lang)
      : base.getSourceFile(f, lang, onErr, shouldCreate)),
  };
  const toDiag = (d) => {
    const p = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    return { code: d.code, line: p ? p.line + 1 : null, col: p ? p.character + 1 : null, msg: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
  };
  const out = new Map();
  const run = (roots) => {
    const program = ts.createProgram({ rootNames: [...roots, ambientFile], options, host });
    for (const f of roots) {
      const sf = program.getSourceFile(f);
      if (!sf) { out.set(f, { syntax: [{ code: 0, line: null, col: null, msg: 'the file was not part of the program' }], semantic: [] }); continue; }
      const syntax = program.getSyntacticDiagnostics(sf).map(toDiag);
      const semantic = syntax.length ? [] : program.getSemanticDiagnostics(sf).map(toDiag);
      out.set(f, { syntax, semantic });
    }
  };
  if (perFile) for (const f of files) run([f]); else run(files);
  return out;
}

/** Names of the packages the Vue runner needs that are not installed (empty when all are). */
export function defaultVueMissing(bin = VUE_TSC_BIN) {
  const req = createRequire(import.meta.url);
  const missing = [];
  for (const pkg of ['vue', '@vue/compiler-sfc', 'lucide-vue-next']) {
    try { req.resolve(`${pkg}/package.json`); } catch { missing.push(pkg); }
  }
  if (!existsSync(bin)) missing.push('vue-tsc');
  return missing;
}

/** The tsconfig the gate writes into an OS temp directory for vue-tsc (pure: exported for the pins). */
export function vueTsconfig(files, ambientFile) {
  return JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, lib: ['ES2023', 'DOM'], jsx: 'preserve', types: [] },
    vueCompilerOptions: { target: 3.5 },
    include: [...files, ambientFile],
  }, null, 2) + '\n';
}

/** Parse vue-tsc output `path(line,col): error TSnnnn: message` (continuation lines are ignored). @returns Map<absFile, Diag[]> */
export function parseVueTscOutput(output, cwd = ROOT) {
  const out = new Map();
  for (const l of String(output).split('\n')) {
    const m = l.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/);
    if (!m) continue;
    const f = resolve(cwd, m[1]);
    if (!out.has(f)) out.set(f, []);
    out.get(f).push({ code: Number(m[4]), line: Number(m[2]), col: Number(m[3]), msg: m[5].trim() });
  }
  return out;
}

/**
 * ONE vue-tsc invocation over all `files`, with a tsconfig and an ambient *.css declaration written into an OS temp
 * directory (removed afterwards, never inside the repo). @returns { diags: Map<file, Diag[]>, status, crash?: string, ms }
 */
export function runVueTsc(files, { bin = VUE_TSC_BIN, cwd = ROOT, tmpBase = tmpdir(), spawn = spawnSync, onTsconfig } = {}) {
  const t0 = Date.now();
  const dir = mkdtempSync(join(tmpBase, 'ts-gate-vue-'));
  try {
    const ambient = join(dir, 'ambient.d.ts');
    const cfg = join(dir, 'tsconfig.json');
    writeFileSync(ambient, AMBIENT_TEXT);
    const text = vueTsconfig(files, ambient);
    writeFileSync(cfg, text);
    if (onTsconfig) onTsconfig({ dir, cfg, text });
    const r = spawn(process.execPath, [bin, '--noEmit', '-p', cfg, '--pretty', 'false'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    const diags = parseVueTscOutput(output, cwd);
    const crash = r.status !== 0 && diags.size === 0
      ? `vue-tsc exited ${r.status ?? r.error?.code ?? '?'} without a parseable error: ${(output.split('\n').find((l) => l.trim()) ?? 'no output').trim()}`
      : undefined;
    return { diags, status: r.status, crash, ms: Date.now() - t0 };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The Vue compiler over every file. @returns Map<file, { errors: {message,line,col}[], warnings: string[] }> */
export function compileVueFiles(sfc, files, read = (f) => readFileSync(f, 'utf8')) {
  const out = new Map();
  const first = (m) => String(m).split('\n')[0].trim();
  for (const f of files) {
    const src = read(f);
    const errors = [], warnings = [];
    const seen = new Set();
    const addErr = (message, line, col) => { const k = `${message}@${line}:${col}`; if (!seen.has(k)) { seen.add(k); errors.push({ message: first(message), line, col }); } };
    const { descriptor, errors: parseErrors } = sfc.parse(src, { filename: f });
    for (const e of parseErrors) addErr(e.message ?? e, e.loc?.start?.line ?? null, e.loc?.start?.column ?? null);
    let bindings;
    try { bindings = sfc.compileScript(descriptor, { id: 'gate' }).bindings; }
    catch (e) { addErr(e.message, e.loc?.start?.line ?? null, e.loc?.start?.column ?? null); }
    if (descriptor.template) {
      const t = descriptor.template;
      const tr = sfc.compileTemplate({ source: t.content, filename: f, id: 'gate', compilerOptions: { bindingMetadata: bindings } });
      // Template positions are relative to the template content: make them file positions.
      const at = (loc) => (loc ? { line: t.loc.start.line + loc.start.line - 1, col: loc.start.line === 1 ? t.loc.start.column - 1 + loc.start.column : loc.start.column } : { line: null, col: null });
      for (const e of tr.errors) { const p = at(e.loc); addErr(typeof e === 'string' ? e : e.message, p.line, p.col); }
      for (const w of tr.tips ?? []) warnings.push(first(w.message ?? w));
    }
    out.set(f, { errors, warnings });
  }
  return out;
}

/** The default Vue runner: the Vue compiler layer, then ONE vue-tsc project. */
export async function defaultVueRunner(files) {
  const sfc = (await import('@vue/compiler-sfc')).default ?? (await import('@vue/compiler-sfc'));
  const t0 = Date.now();
  const compiler = compileVueFiles(sfc, files);
  const compilerMs = Date.now() - t0;
  // vue-tsc, like tsc, reports no semantic error anywhere in a project that has a syntax error. A file the Vue
  // compiler rejects is already a TV1 failure, so it is left out of the vue-tsc project: its syntax error cannot
  // hide the type errors of the other files.
  const typed = files.filter((f) => !(compiler.get(f)?.errors.length));
  const tsc = typed.length ? runVueTsc(typed) : { diags: new Map(), crash: undefined, ms: 0 };
  return { compiler, tsc: tsc.diags, crash: tsc.crash, ms: { compiler: compilerMs, tsc: tsc.ms } };
}

/**
 * Pure rule logic. Everything environmental is injectable:
 *   policyPath / policyText   the policy file (text overrides the file)
 *   now                       clock (default: now); never a CLI option
 *   outRoot                   the out/ directory      features   corpus feature names
 *   exists / listDirs / listFiles   file system probes (default: the real fs)
 *   loadTs / hasReactTypes    the compiler loader and the @types/react probe
 *   typecheck                 async (ts, adapter, files) => Map<file, { syntax, semantic }>  (react; default: the real compiler)
 *   hasVuePackages / vueRunner  the vue package probe (names of missing packages) and the Vue runner
 *                             async (files) => { compiler: Map<file,{errors,warnings}>, tsc: Map<file,Diag[]>, crash?, ms }
 *   onTimings                 called with { vue: { compiler, tsc } } (milliseconds) after the Vue runner ran; timing is never part of the report
 * @returns {{ ok: boolean, issues: {rule,file,msg}[], lines: string[], adapters: Record<string, {state:string, files:number}> }}
 */
export async function checkTsTypecheck({
  policyPath = POLICY_PATH, policyText, now = new Date(), outRoot = OUT_ROOT, features = corpusFeatures(),
  exists = existsSync,
  listDirs = (d) => readdirSync(d).filter((n) => statSync(resolve(d, n)).isDirectory()),
  listFiles = (d, ext) => readdirSync(d).filter((n) => ext.some((e) => n.endsWith(e))),
  loadTs = defaultLoadTs, hasReactTypes = defaultHasReactTypes, typecheck,
  hasVuePackages = defaultVueMissing, vueRunner = defaultVueRunner, onTimings = () => {},
} = {}) {
  const issues = [];
  const add = (rule, file, msg) => issues.push({ rule, file, msg });
  const rel = (p) => relative(ROOT, p) || p;
  const lines = [];
  const adapters = {};

  // ---- policy: TT0 (shape) and TT3 (quality) ----
  const { entries, problem } = loadPolicy({ path: policyPath, text: policyText });
  if (problem) add('TT0-env', rel(policyPath), problem);
  const byAdapter = new Map();
  entries.forEach((e, i) => {
    const who = `policy entry ${i + 1} (${e?.adapter ?? '?'})`;
    if (e === null || typeof e !== 'object' || Array.isArray(e)) { add('TT3-policy', rel(policyPath), `${who} must be a mapping with ${FIELDS.join(', ')}`); return; }
    const unknown = Object.keys(e).filter((k) => !FIELDS.includes(k));
    if (unknown.length) add('TT3-policy', rel(policyPath), `${who} has unknown field(s): ${unknown.join(', ')}`);
    if (!ADAPTERS.includes(e.adapter)) { add('TT3-policy', rel(policyPath), `${who}: adapter ${JSON.stringify(e.adapter ?? null)} is not one of ${ADAPTERS.join(', ')}`); return; }
    if (byAdapter.has(e.adapter)) { add('TT3-policy', rel(policyPath), `${who} duplicates entry ${byAdapter.get(e.adapter).index + 1} for adapter ${e.adapter}`); return; }
    byAdapter.set(e.adapter, { index: i, entry: e });
    if (typeof e.enabled !== 'boolean') { add('TT3-policy', rel(policyPath), `${who}: enabled must be true or false (got ${JSON.stringify(e.enabled ?? null)})`); return; }
    if (e.enabled === false) {
      if (!nonEmptyStr(e.reason)) add('TT3-policy', rel(policyPath), `${who} is disabled with an empty reason`);
      if (e.approver !== APPROVER) add('TT3-policy', rel(policyPath), `${who} approver ${JSON.stringify(e.approver ?? null)} is not exactly ${JSON.stringify(APPROVER)}`);
      const st = expiryState(e.expires, now);
      if (st === 'missing') add('TT3-policy', rel(policyPath), `${who} is disabled without an expiry (policy: nothing stays disabled forever)`);
      else if (st === 'invalid') add('TT3-policy', rel(policyPath), `${who} has an unparseable expiry ${JSON.stringify(String(e.expires))}`);
      else if (st === 'past') add('TT3-policy', rel(policyPath), `${who}: ${e.adapter} was disabled until ${day(e.expires)} and that date has passed: enable it or renew the entry with a new approved expiry`);
    }
  });
  if (!problem) {
    for (const a of ADAPTERS) if (!byAdapter.has(a)) add('TT0-env', rel(policyPath), `adapter ${a} has no entry in ${rel(policyPath)}`);
  }

  // ---- environment ----
  const enabled = ADAPTERS.filter((a) => byAdapter.get(a)?.entry?.enabled === true);
  let ts = null;
  const envMissing = new Set(); // TT0 names that stop an adapter from being compiled
  if (enabled.length) {
    ts = await loadTs();
    if (!ts) { add('TT0-env', 'typescript', 'the typescript package is not installed: run `npm ci`'); envMissing.add('typescript'); }
  }
  if (enabled.includes('react') && !hasReactTypes()) { add('TT0-env', '@types/react', 'the @types/react package is not installed: run `npm ci`'); envMissing.add('@types/react'); }
  if (enabled.includes('vue')) {
    for (const pkg of hasVuePackages()) {
      add('TT0-env', pkg, pkg === 'vue-tsc' ? 'the vue-tsc binary (node_modules/vue-tsc/bin/vue-tsc.js) is missing: run `npm ci`' : `the ${pkg} package is not installed: run \`npm ci\``);
      envMissing.add(pkg);
    }
  }
  // A broken environment is reported once as TT0 per missing package; the adapter is not compiled, since every
  // file would only repeat the missing-package error.
  const needs = { react: ['typescript', '@types/react'], vue: ['typescript', 'vue', '@vue/compiler-sfc', 'lucide-vue-next', 'vue-tsc'] };
  const brokenFor = (a) => (needs[a] ?? []).some((n) => envMissing.has(n));

  // ---- per adapter ----
  const fileCount = (list, a, n) => { adapters[a] = { state: list, files: n }; };
  for (const a of ADAPTERS) {
    const hit = byAdapter.get(a);
    if (!hit || typeof hit.entry.enabled !== 'boolean') { fileCount('unknown', a, 0); continue; }
    if (hit.entry.enabled === false) {
      fileCount('not-enabled', a, 0);
      lines.push(`ts typecheck: ${a} NOT ENABLED (policy, expires ${day(hit.entry.expires)}): ${String(hit.entry.reason ?? '').trim()}`);
      continue;
    }
    // enabled
    const envBroken = brokenFor(a);
    const ext = SOURCE_EXT[a];
    if (!ext) { add('TT3-policy', rel(policyPath), `adapter ${a} is enabled in the policy but this gate has no checker for it yet`); fileCount('fail', a, 0); continue; }
    const aOut = resolve(outRoot, a);
    if (!exists(aOut)) { add('TT0-env', rel(aOut), `${rel(aOut)} does not exist: run the generation steps first`); fileCount('fail', a, 0); continue; }
    const dirs = listDirs(aOut).sort();
    if (!dirs.length) { add('TT0-env', rel(aOut), `${rel(aOut)} holds no feature directory`); fileCount('fail', a, 0); continue; }
    const before = issues.length;
    const featureSet = new Set(features);
    const files = [];
    for (const f of [...features].sort()) {
      const dir = resolve(aOut, f);
      const found = dirs.includes(f) ? listFiles(dir, ext).sort() : [];
      if (!found.length) add('TT2-inventory', rel(dir), `corpus feature ${f} has no ${a} output (${rel(dir)}/*${ext[0]})`);
      for (const n of found) files.push(resolve(dir, n));
    }
    for (const d of dirs) {
      if (!featureSet.has(d) && !PIN_ARTEFACT.test(d)) add('TT2-inventory', rel(resolve(aOut, d)), `${rel(resolve(aOut, d))} is neither a corpus feature nor a pin artefact directory (verify-*, _verify)`);
    }
    const warnLines = [];
    if (a === 'react' && ts && !envBroken && files.length) {
      const results = await (typecheck ? typecheck(ts, a, files) : compileFiles(ts, files));
      for (const f of files) {
        const r = results.get(f) ?? { syntax: [], semantic: [] };
        const all = [...r.syntax, ...r.semantic];
        if (!all.length) continue;
        const first = all[0];
        const where = first.line != null ? `:${first.line}:${first.col}` : '';
        add('TT1-type', rel(f), `${rel(f)}${where} TS${first.code} ${first.msg.split('\n')[0]} (${all.length} error${all.length === 1 ? '' : 's'} in file${r.syntax.length ? ', syntax error: semantic check skipped' : ''})`);
      }
    }
    if (a === 'vue' && !envBroken && files.length) {
      const res = await vueRunner(files);
      onTimings({ vue: res.ms });
      if (res.crash) add('TT0-env', 'vue-tsc', res.crash);
      for (const f of files) {
        // (a) the Vue compiler: every error fails, warnings are only printed
        const c = res.compiler.get(f) ?? { errors: [], warnings: [] };
        if (c.errors.length) {
          const e = c.errors[0];
          const where = e.line != null ? `:${e.line}${e.col != null ? `:${e.col}` : ''}` : '';
          add('TV1-compiler', rel(f), `${rel(f)}${where} ${e.message} (${c.errors.length} error${c.errors.length === 1 ? '' : 's'} in file, vue-tsc skipped for this file)`);
        }
        for (const w of c.warnings) warnLines.push(`  warning (not failing) vue compiler ${rel(f)}: ${w}`);
        // (b) vue-tsc
        const d = res.tsc.get(f) ?? [];
        if (d.length) add('TT1-type', rel(f), `${rel(f)}:${d[0].line}:${d[0].col} TS${d[0].code} ${d[0].msg.split('\n')[0]} (${d.length} error${d.length === 1 ? '' : 's'} in file)`);
      }
    }
    const failed = issues.length > before || envBroken;
    fileCount(failed ? 'fail' : 'pass', a, files.length);
    const layers = a === 'vue' ? ': compiler + vue-tsc' : '';
    lines.push(...warnLines.sort());
    lines.push(envBroken
      ? `ts typecheck: ${a} FAIL (environment not ready, see TT0)`
      : failed
        ? `ts typecheck: ${a} FAIL (${issues.length - before} issue${issues.length - before === 1 ? '' : 's'}, ${files.length} files${layers})`
        : `ts typecheck: ${a} PASS (${files.length} files${layers})`);
  }

  const order = (r) => RULES.indexOf(r);
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  issues.sort((x, y) => order(x.rule) - order(y.rule) || cmp(x.file, y.file) || cmp(x.msg, y.msg));
  return { ok: issues.length === 0, issues, lines, adapters };
}

/** Deterministic text report: issues first, then one line per adapter. */
export function formatReport(r) {
  const out = [];
  for (const i of r.issues) out.push(`  ${i.rule}  ${i.msg}`);
  out.push(...r.lines);
  if (!r.ok && !r.lines.length) out.push(`ts typecheck: FAIL (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`);
  return out.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const perFile = argv.includes('--per-file');
  const t0 = Date.now();
  let timings = null;
  const r = await checkTsTypecheck({ typecheck: perFile ? async (ts, _a, files) => compileFiles(ts, files, { perFile: true }) : undefined, onTimings: (t) => { timings = t; } });
  console.log(formatReport(r));
  if (argv.includes('--timing')) {
    console.log(`wall time: ${((Date.now() - t0) / 1000).toFixed(1)} s (${perFile ? 'one program per file' : 'one program'})`);
    if (timings?.vue) console.log(`vue runner: compiler ${(timings.vue.compiler / 1000).toFixed(1)} s, vue-tsc ${(timings.vue.tsc / 1000).toFixed(1)} s (one project)`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
