#!/usr/bin/env node
/**
 * check-live-lowering — F-28 live-region value fidelity gate (BLOCKING).
 *
 * The Lowering Ledger counts a live region as expressed whatever its value, and
 * a11y-guard only checks that SOME live trait exists, so a wrong value (for
 * example `live: off` lowered as polite) passed every gate. This gate compares
 * the live fragment each adapter actually emits with an expectation written from
 * platform facts (_shared/policy/live-lowering-expectations.yaml, one row per
 * adapter x value).
 *
 * For every corpus spec that declares `a11y.live`, for every adapter, the emitted
 * live fragments (see FRAGMENT_RES) must equal the fragments the expectation rows
 * require for the values the spec declares: one fragment per live node, or none
 * when the row says NONE. Anything else, including a fragment where NONE is
 * expected (for example SwiftUI `.updatesFrequently`), is a mismatch.
 *
 * Rules (each issue carries a stable id and names the adapter, the value and the spec):
 *   L0-load         the expectation table is missing or unparseable, or a corpus spec
 *                   cannot be read
 *   L1-mismatch     the emitted live fragment(s) differ from the expectation
 *   L2-uncovered    an adapter x live value (from the schema enum) has no expectation
 *                   row, or a spec declares a live value that has none
 *   L3-row-quality  a row has an empty expected form or doc reference, an evidence label
 *                   outside SOURCE, DEVICE, DOC, an unknown adapter or value, or is a duplicate
 *
 * There is no bypass flag and no global switch. Specs are generated through the real
 * adapters into the same out/<adapter>/<feature>/ the pipeline writes (byte-identical
 * output). Output is deterministic: issues sort by rule order, adapter, value, spec.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { ROOT, ADAPTERS, corpusSpecPaths, deriveConstructs } from './schema-constructs.mjs';
import { REFUSED_CATEGORIES } from './check-corpus-coverage.mjs';
import { generateReact } from '../../adapters/react/generate.mjs';
import { generateVue } from '../../adapters/vue/generate.mjs';
import { generateSvelte } from '../../adapters/svelte/generate.mjs';
import { generateReactNative } from '../../adapters/react-native/generate.mjs';
import { generateSwiftUI } from '../../adapters/swiftui/generate.mjs';
import { generateCompose } from '../../adapters/compose/generate.mjs';

export const EXPECTATIONS_PATH = resolve(ROOT, '_shared/policy/live-lowering-expectations.yaml');
export const RULES = ['L0-load', 'L1-mismatch', 'L2-uncovered', 'L3-row-quality'];
export const EVIDENCE = ['SOURCE', 'DEVICE', 'DOC'];
export const NONE = 'NONE';

const GENERATORS = {
  react: generateReact, vue: generateVue, svelte: generateSvelte,
  'react-native': generateReactNative, swiftui: generateSwiftUI, compose: generateCompose,
};

/**
 * What counts as "a live fragment" in generated source, per adapter. Deliberately wider
 * than the lowering the adapters use today, so a wrong or foreign live form is seen.
 */
export const FRAGMENT_RES = {
  react: [/aria-live\s*=\s*"[^"]*"/g, /aria-live\s*=\s*\{[^}]*\}/g],
  vue: [/aria-live\s*=\s*"[^"]*"/g, /:aria-live\s*=\s*"[^"]*"/g],
  svelte: [/aria-live\s*=\s*"[^"]*"/g, /aria-live\s*=\s*\{[^}]*\}/g],
  'react-native': [/accessibilityLiveRegion\s*=\s*"[^"]*"/g, /accessibilityLiveRegion\s*=\s*\{[^}]*\}/g, /aria-live\s*=\s*"[^"]*"/g],
  swiftui: [/\.updatesFrequently\b/g, /AccessibilityNotification\.[A-Za-z.]+/g, /\.accessibilityLiveRegion\b/g],
  compose: [/liveRegion\s*=\s*[^;}\n]+/g],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** The live fragments in `code`, in source order, whitespace collapsed. */
export function liveFragments(adapter, code) {
  const found = [];
  for (const re of FRAGMENT_RES[adapter] ?? []) {
    for (const m of String(code).matchAll(new RegExp(re.source, re.flags))) found.push({ at: m.index, text: squash(m[0]) });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.text);
}

/** Every `a11y.live` value declared anywhere in a parsed spec, in document order. */
export function specLiveValues(doc) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isObj(n)) return;
    if (isObj(n.a11y) && typeof n.a11y.live === 'string') out.push(n.a11y.live);
    Object.values(n).forEach(walk);
  };
  walk(doc?.root);
  return out;
}

/** The live enum values, derived from the schema (a11y.value:live=<v> constructs). */
export function schemaLiveValues(constructs = deriveConstructs()) {
  return constructs.map((c) => /^a11y\.value:live=(.+)$/.exec(c)?.[1]).filter(Boolean);
}

function readRows({ expectationsPath, expectationsText }) {
  let text = expectationsText;
  if (text === undefined) {
    try { text = readFileSync(expectationsPath, 'utf8'); }
    catch { return { rows: [], problem: `live lowering expectations not found at ${expectationsPath}` }; }
  }
  let doc;
  try { doc = parse(text); } catch (e) { return { rows: [], problem: `live lowering expectations are not valid YAML: ${String(e.message).split('\n')[0]}` }; }
  if (!isObj(doc) || !Array.isArray(doc.rows)) return { rows: [], problem: 'live lowering expectations have no `rows` list' };
  return { rows: doc.rows };
}

const featureOf = (p) => (basename(p) === 'design-spec.yaml' ? basename(dirname(p)) : basename(p).replace(/\.spec\.ya?ml$/, ''));

/** Default generator: the real adapter, writing the same out/<adapter>/<feature>/ as the pipeline. */
export function defaultGenerate(adapter, specPath) {
  return GENERATORS[adapter](specPath, featureOf(specPath)).code;
}

/**
 * @param {object} [o]
 * @param {string} [o.expectationsPath]  table file (default: the real one)
 * @param {string} [o.expectationsText]  table YAML text (overrides the file; for fixtures)
 * @param {string[]} [o.specPaths]       corpus spec files (default: the real corpus)
 * @param {string[]} [o.values]          live enum values (default: derived from the schema)
 * @param {string[]} [o.adapters]        adapters (default: the 6)
 * @param {(adapter: string, specPath: string) => string} [o.generate]  returns the generated source
 */
export function checkLiveLowering({
  expectationsPath = EXPECTATIONS_PATH,
  expectationsText,
  specPaths = corpusSpecPaths(),
  values = schemaLiveValues(),
  adapters = ADAPTERS,
  generate = defaultGenerate,
} = {}) {
  const issues = [];
  const add = (rule, adapter, value, spec, msg) => issues.push({ rule, adapter, value, spec, msg });
  const { rows, problem } = readRows({ expectationsPath, expectationsText });
  if (problem) add('L0-load', '-', '-', '-', problem);

  // L3 — row quality; the first row for an (adapter, value) pair is the one compared.
  const byKey = new Map();
  rows.forEach((r, i) => {
    if (!isObj(r)) { add('L3-row-quality', '-', '-', '-', `row ${i + 1} must be a mapping with adapter, value, expected, doc and evidence`); return; }
    const a = String(r.adapter), v = String(r.value);
    const label = `row ${a}/${v}`;
    if (!adapters.includes(a)) add('L3-row-quality', a, v, '-', `${label} names an unknown adapter`);
    if (!values.includes(v)) add('L3-row-quality', a, v, '-', `${label} names a value that is not in the live enum (${values.join(', ')})`);
    if (!nonEmptyStr(r.expected)) add('L3-row-quality', a, v, '-', `${label} has an empty expected form (use ${NONE} for no live fragment)`);
    if (!nonEmptyStr(r.doc)) add('L3-row-quality', a, v, '-', `${label} has an empty doc reference`);
    if (!EVIDENCE.includes(r.evidence)) add('L3-row-quality', a, v, '-', `${label} evidence ${JSON.stringify(r.evidence ?? null)} is not one of ${EVIDENCE.join(', ')}`);
    const k = `${a}|${v}`;
    if (byKey.has(k)) add('L3-row-quality', a, v, '-', `${label} is a duplicate`);
    else byKey.set(k, r);
  });

  // L2 — every adapter x live value needs a row.
  for (const a of adapters) for (const v of values) {
    if (!byKey.has(`${a}|${v}`)) add('L2-uncovered', a, v, '-', `no expectation row for adapter ${a}, live value ${v}`);
  }

  // L1 — compare the emitted fragments with the expectation, per spec x adapter.
  let comparisons = 0;
  let liveSpecs = 0;
  for (const p of specPaths) {
    const name = relative(ROOT, p);
    let doc;
    try { doc = parse(readFileSync(p, 'utf8')); }
    catch { add('L0-load', '-', '-', name, `corpus spec ${name} is missing or unparseable`); continue; }
    if (!isObj(doc) || !isObj(doc.root)) { add('L0-load', '-', '-', name, `corpus spec ${name} has no \`root\` element`); continue; }
    if (REFUSED_CATEGORIES.has(doc.category ?? 'display')) continue;
    const used = specLiveValues(doc);
    if (!used.length) continue;
    liveSpecs++;
    const distinct = [...new Set(used)].sort();
    for (const a of adapters) {
      const unknown = distinct.filter((v) => !byKey.has(`${a}|${v}`));
      if (unknown.length) { // a value in the enum without a row was already reported by the sweep above
        for (const v of unknown) if (!values.includes(v)) add('L2-uncovered', a, v, name, `spec ${name} declares live value ${v}, which is not in the live enum and has no expectation row`);
        continue;
      }
      const expected = used
        .map((v) => String(byKey.get(`${a}|${v}`).expected))
        .filter((e) => e !== NONE && nonEmptyStr(e))
        .map(squash)
        .sort();
      let code;
      try { code = generate(a, p); }
      catch (e) { add('L0-load', a, distinct.join('+'), name, `adapter ${a} failed to generate ${name}: ${String(e.message).split('\n')[0]}`); continue; }
      comparisons++;
      const emitted = liveFragments(a, code).sort();
      if (JSON.stringify(emitted) !== JSON.stringify(expected)) {
        const show = (xs) => (xs.length ? xs.map((x) => `[${x}]`).join(' ') : 'no live fragment');
        add('L1-mismatch', a, distinct.join('+'), name, `${a} lowers live=${distinct.join('+')} in ${name} as ${show(emitted)}, expected ${show(expected)}`);
      }
    }
  }

  const order = (r) => RULES.indexOf(r);
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  issues.sort((a, b) => order(a.rule) - order(b.rule) || cmp(a.adapter, b.adapter) || cmp(a.value, b.value) || cmp(a.spec, b.spec) || cmp(a.msg, b.msg));
  return { ok: issues.length === 0, issues, counts: { rows: rows.length, values: values.length, adapters: adapters.length, liveSpecs, comparisons } };
}

/** Deterministic text report. */
export function formatLiveReport(r) {
  const out = [];
  out.push(`live lowering gate: ${r.counts.rows} expectation rows (${r.counts.adapters} adapters x ${r.counts.values} values), ${r.counts.liveSpecs} corpus specs use a11y.live, ${r.counts.comparisons} adapter comparisons`);
  for (const i of r.issues) out.push(`  FAIL ${i.rule}  adapter=${i.adapter} value=${i.value} spec=${i.spec}: ${i.msg}`);
  out.push(r.ok ? 'live lowering gate: PASS' : `live lowering gate: FAIL (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = checkLiveLowering();
  console.log(formatLiveReport(r));
  process.exit(r.ok ? 0 : 1);
}
