#!/usr/bin/env node
/**
 * check-token-outputs — F-32 token build output gate (BLOCKING).
 *
 * The token guard only checks that the token NAMES an adapter uses exist in registry.json. Nothing
 * read the token VALUES, so a build that wrote `--color-bg-default: [object Object];` (alias
 * resolution returning a token record instead of its value) passed every gate. This gate reads the
 * built outputs in _shared/tokens/ and checks the values themselves.
 *
 * Outputs covered (OUTPUT_FILES from build.mjs): registry.json, tokens.css, tailwind-theme.js,
 * tokens.d.ts, DesignTokens.swift, DesignTokens.kt, tokens-rn.ts.
 *
 * Rules (each issue carries a stable id and names the file and the token):
 *   T0-load             an expected output is missing, unreadable, empty or cannot be parsed, or the
 *                       expected output list is empty
 *   T1-broken-value     a value position holds `[object Object]` (any case), undefined, NaN, null, an
 *                       empty value, or an object/array where a scalar is expected
 *   T2-color-validity   a colour is not #RRGGBB / #RRGGBBAA (registry.json, tokens.css, tokens-rn.ts)
 *                       or its literal in DesignTokens.swift / DesignTokens.kt is not 6/8 hex digits /
 *                       0xAARRGGBB
 *   T3-agreement        the outputs disagree: a token missing from, or extra in, an output, or a value
 *                       that is not the registry.json value after the format conversion (below)
 *   T4-freshness        the committed output differs from a fresh build of the token sources
 *
 * T1 reads VALUE POSITIONS only, never the whole file, so legitimate occurrences are not hit:
 *   - comments are stripped first (quote aware), so a comment that mentions `[object Object]` is fine;
 *   - only the right-hand side of a declaration/initialiser, the value of a JSON/TS key, or the value
 *     of a `'name': 'value'` record entry is scanned, never a token name: `--color-null-state`,
 *     `ColorNullState`, `space.nullable` are names;
 *   - `undefined`, `NaN`, `null` count as a broken value only as a standalone word (start/end of the
 *     value, whitespace, `(`, `,`, quotes around it), so `nullable`, `Nullish`, `x-null-y` are values
 *     of other things and do not fire; the `--name` inside `var(--name)` is blanked before the scan.
 *
 * T3 conversions (registry.json is the reference value):
 *   colour    registry `#RRGGBB`  -> tokens.css `#RRGGBB` (a `var(--x)` is followed to its end value,
 *             cycle-checked) -> DesignTokens.swift `Color(hex: "RRGGBB")` (no `#`) ->
 *             DesignTokens.kt `Color(0xFFRRGGBB)`; `#RRGGBBAA` -> kt `0xAARRGGBB` -> tokens-rn.ts `"#RRGGBB"`;
 *             hex digits compare case-insensitively
 *   dimension registry `8px` -> tokens.css `8px` -> swift `CGFloat = 8` -> kt `8.dp` -> tokens-rn.ts `8`
 *   other scalar types (fontFamily, fontWeight, ...) present in more than one output
 *             registry value -> tokens.css `String(value)` -> tokens-rn.ts the same value
 *   icon      registry extensions.sfSymbol -> swift `<Name>Symbol = "..."`, extensions.material ->
 *             kt `<Name>Icon = "..."` (falling back to the value, as the build does)
 *   tailwind-theme.js and tokens.d.ts hold `var(--x)` references: every reference must name a
 *             custom property declared in tokens.css, and tokens.d.ts must list exactly the
 *             non-icon registry tokens, each with `var(--<name with dots as dashes>)`.
 * The name conversions (`a.b.c` -> `--a-b-c`, PascalCase ids) are re-implemented here on purpose, so
 * the gate does not share code with the emitters it checks.
 *
 * T4: no freshness check existed (ci.mjs rebuilt the outputs in place and nothing compared them to
 * what was committed). This gate compares the on-disk outputs with buildOutputs() from build.mjs,
 * which is the exact function build.mjs writes its files from (no temp dir is needed: it is pure).
 * ci.mjs runs the gate BEFORE the build step, so a stale committed output fails here instead of being
 * silently rewritten.
 *
 * There is no bypass flag and no global switch. Output is deterministic (issues sort by rule order,
 * file order, token, message). The functions take the file contents as parameters.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUTPUT_FILES, OUTPUT_DIR, buildOutputs } from '../../design-system/tokens-dtcg/scripts/build.mjs';

export const RULES = ['T0-load', 'T1-broken-value', 'T2-color-validity', 'T3-agreement', 'T4-freshness'];
export { OUTPUT_FILES };

/** DTCG composite types: their value is legitimately an object/array in registry.json. */
export const COMPOSITE_TYPES = ['shadow', 'typography', 'border', 'transition', 'gradient', 'strokeStyle', 'cubicBezier'];

const HEX_ANY = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HEX_DIGITS = /^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PX = /^(-?(?:\d+\.?\d*|\.\d+))px$/;
const NUM = /^-?(?:\d+\.?\d*|\.\d+)$/;

// ---- naming conversions (independent of the emitters) ---------------------------------------
const cssName = (token) => `--${token.replace(/\./g, '-')}`;
const pascalId = (token) => token.replace(/(^|[.\-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase());

// ---- T1: broken value detection --------------------------------------------------------------
const OBJ_RE = /\[object [^\]]*\]/i;
const WORD_RE = /(?:^|[\s(,"'=:])(undefined|NaN|null)(?=$|[\s),"';])/;

/** Why a TEXT value is broken, or null. `text` is already a value (right-hand side), not a line. */
export function brokenText(text) {
  const s = String(text).replace(/var\(\s*--[\w-]+/g, 'var(').trim();
  if (s === '') return 'empty value';
  if (OBJ_RE.test(s)) return '`[object Object]` in a value';
  const m = s.match(WORD_RE);
  if (m) return `\`${m[1]}\` as a value`;
  return null;
}

/** Why a parsed (JSON/TS) value is broken where a scalar is expected, or null. */
export function brokenScalar(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? null : (Number.isNaN(v) ? 'NaN' : 'a non-finite number');
  if (typeof v === 'string') return brokenText(v);
  if (typeof v === 'boolean') return null;
  return Array.isArray(v) ? 'an array where a scalar is expected' : 'an object where a scalar is expected';
}

// ---- text helpers ----------------------------------------------------------------------------
/** Remove // and /* *\/ comments (and optionally only /* *\/), leaving string literals intact. */
export function stripComments(text, { line = true } = {}) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i], n = text[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && n === '*') {
      const j = text.indexOf('*/', i + 2);
      const end = j < 0 ? text.length : j + 2;
      out += text.slice(i, end).replace(/[^\n]/g, ' '); i = end; // keep line numbers
    } else if (line && c === '/' && n === '/') {
      let j = i; while (j < text.length && text[j] !== '\n') j++;
      out += ' '.repeat(j - i); i = j;
    } else { out += c; i++; }
  }
  return out;
}

const UNDEF = Symbol('undefined-literal');
/** Parse one JS literal (object/array/string/number/identifier) starting at `pos`. Throws on junk. */
export function parseLiteral(text, pos = 0) {
  let i = pos;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const str = () => {
    const q = text[i];
    let j = i + 1;
    while (j < text.length && text[j] !== q && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    if (text[j] !== q) throw new Error('unterminated string');
    const raw = text.slice(i + 1, j);
    i = j + 1;
    return JSON.parse(`"${q === '"' ? raw : raw.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; const o = {};
      for (;;) {
        ws();
        if (text[i] === '}') { i++; return o; }
        let key;
        if (text[i] === '"' || text[i] === "'") key = str();
        else { const m = text.slice(i).match(/^[A-Za-z_$][\w$]*|^\d+/); if (!m) throw new Error(`bad object key at ${i}`); key = m[0]; i += key.length; }
        ws(); if (text[i] !== ':') throw new Error(`expected ":" at ${i}`); i++;
        o[key] = value(); ws();
        if (text[i] === ',') i++; else if (text[i] !== '}') throw new Error(`expected "," or "}" at ${i}`);
      }
    }
    if (c === '[') {
      i++; const a = [];
      for (;;) {
        ws();
        if (text[i] === ']') { i++; return a; }
        a.push(value()); ws();
        if (text[i] === ',') i++; else if (text[i] !== ']') throw new Error(`expected "," or "]" at ${i}`);
      }
    }
    if (c === '"' || c === "'") return str();
    const m = text.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_$][\w$]*/);
    if (!m) throw new Error(`unexpected "${String(c)}" at ${i}`);
    i += m[0].length;
    const w = m[0];
    if (NUM.test(w) || /^-?\d/.test(w)) return Number(w);
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    if (w === 'undefined') return UNDEF;
    if (w === 'NaN') return NaN;
    if (w === 'Infinity') return Infinity;
    throw new Error(`unexpected identifier ${w}`);
  };
  const v = value();
  return { value: v, end: i };
}
const unUndef = (v) => (v === UNDEF ? undefined : v);

/** Walk a nested parsed literal; call f(path[], value) for every leaf (non-plain-object). */
function walkLeaves(node, f, path = []) {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) walkLeaves(v, f, [...path, k]);
  } else f(path, node);
}

// ---- per-format parsers (each returns { entries, problem? }) ---------------------------------
/** CSS: { var name (no leading --) -> raw value } plus declaration order. */
function parseCss(text) {
  const clean = stripComments(text, { line: false });
  const decls = [];
  for (const m of clean.matchAll(/(?:^|[;{}\s])--([A-Za-z0-9_-]+)\s*:\s*([^;{}]*);/g)) decls.push({ name: m[1], value: m[2].trim() });
  if (!decls.length) return { decls, problem: 'no custom-property declarations found' };
  return { decls };
}

/** Swift / Kotlin members: { id, type, rhs } from `let|val Name[: T] = <rhs>` lines. */
function parseMembers(text, lang) {
  const clean = stripComments(text);
  const re = lang === 'swift'
    ? /^\s*public\s+static\s+let\s+(\w+)\s*(?::\s*(\w+))?\s*=\s*(.*?)\s*$/
    : /^\s*(?:const\s+)?val\s+(\w+)\s*(?::\s*(\w+))?\s*=\s*(.*?)\s*$/;
  const members = [];
  clean.split('\n').forEach((ln, idx) => {
    const m = ln.match(re);
    if (m) members.push({ id: m[1], type: m[2] ?? null, rhs: m[3], line: idx + 1 });
  });
  if (!members.length) return { members, problem: `no \`${lang === 'swift' ? 'public static let' : 'val'}\` members found` };
  return { members };
}

function parseRn(text) {
  const clean = stripComments(text);
  const at = clean.indexOf('export const tokens');
  if (at < 0) return { problem: 'no `export const tokens` found' };
  const eq = clean.indexOf('=', at);
  try { return { tree: parseLiteral(clean, eq + 1).value }; } catch (e) { return { problem: `object literal is not parseable: ${e.message}` }; }
}

function parseTailwind(text) {
  const clean = stripComments(text);
  const at = clean.indexOf('export default');
  if (at < 0) return { problem: 'no `export default` found' };
  try { return { tree: parseLiteral(clean, at + 'export default'.length).value }; } catch (e) { return { problem: `object literal is not parseable: ${e.message}` }; }
}

function parseDts(text) {
  const clean = stripComments(text);
  const u = clean.match(/export type TokenName =([\s\S]*?);/);
  const r = clean.match(/export const tokens: Record<TokenName, string> = \{([\s\S]*?)\n\};/);
  if (!u || !r) return { problem: 'no `TokenName` union or `tokens` record found' };
  const names = [...u[1].matchAll(/\|\s*'([^']*)'/g)].map((m) => m[1]);
  const record = [...r[1].matchAll(/^\s*'([^']*)'\s*:\s*(.*?),?\s*$/gm)].map((m) => ({ name: m[1], rhs: m[2] }));
  return { names, record };
}

const unq = (s) => { const m = String(s).trim().match(/^(["'])(.*)\1$/s); return m ? m[2] : null; };

// ---- the gate --------------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {Record<string, string|null>} o.outputs  file name -> content (null/undefined = unreadable)
 * @param {string[]} [o.expected]  expected output names (default OUTPUT_FILES)
 * @param {Record<string,string>|null} [o.fresh]  the fresh build to compare against (default: buildOutputs().files;
 *   pass `null` to skip T4, e.g. for a fixture that is not about freshness)
 */
export function checkTokenOutputs({ outputs, expected = OUTPUT_FILES, fresh } = {}) {
  const issues = [];
  const add = (rule, file, token, msg) => issues.push({ rule, file, token, msg });
  const bad = new Set(); // `${file}|${token}` pairs already reported by T1/T2: skip value comparison
  const mark = (file, token) => bad.add(`${file}|${token}`);
  const isBad = (file, token) => bad.has(`${file}|${token}`);

  if (!Array.isArray(expected) || expected.length === 0) {
    add('T0-load', '(gate)', '-', 'the expected output list is empty: nothing would be checked');
    return finish(issues, 0);
  }

  // T0: presence + parse
  const text = {};
  for (const f of expected) {
    const t = outputs?.[f];
    if (typeof t !== 'string') { add('T0-load', f, '-', `${f} is missing or unreadable`); continue; }
    if (t.trim() === '') { add('T0-load', f, '-', `${f} is empty`); continue; }
    text[f] = t;
  }
  const has = (f) => typeof text[f] === 'string';

  // registry
  let reg = null;
  if (has('registry.json')) {
    try {
      const j = JSON.parse(text['registry.json']);
      if (j === null || typeof j !== 'object' || Array.isArray(j) || Object.keys(j).length === 0) throw new Error('not a non-empty object of tokens');
      reg = j;
    } catch (e) { add('T0-load', 'registry.json', '-', `registry.json is not parseable: ${e.message}`); }
  }
  const parsed = {};
  const tryParse = (f, fn) => {
    if (!has(f)) return;
    const r = fn(text[f]);
    if (r.problem) add('T0-load', f, '-', `${f}: ${r.problem}`); else parsed[f] = r;
  };
  tryParse('tokens.css', parseCss);
  tryParse('DesignTokens.swift', (t) => parseMembers(t, 'swift'));
  tryParse('DesignTokens.kt', (t) => parseMembers(t, 'kotlin'));
  tryParse('tokens-rn.ts', parseRn);
  tryParse('tailwind-theme.js', parseTailwind);
  tryParse('tokens.d.ts', parseDts);

  // ---- T1 ----
  if (reg) {
    for (const [name, e] of Object.entries(reg)) {
      const composite = COMPOSITE_TYPES.includes(e?.type);
      if (e === null || typeof e !== 'object' || !('value' in e)) { add('T1-broken-value', 'registry.json', name, `registry.json ${name} has no value`); mark('registry.json', name); continue; }
      const why = composite && e.value !== null && typeof e.value === 'object' ? null : brokenScalar(e.value);
      if (why) { add('T1-broken-value', 'registry.json', name, `registry.json ${name} (type ${e.type ?? '?'}) value is ${why}`); mark('registry.json', name); }
    }
  }
  if (parsed['tokens.css']) {
    for (const d of parsed['tokens.css'].decls) {
      const why = brokenText(d.value);
      if (why) { add('T1-broken-value', 'tokens.css', d.name, `tokens.css --${d.name}: ${why} (\`${d.value}\`)`); mark('tokens.css', d.name); }
    }
  }
  for (const f of ['DesignTokens.swift', 'DesignTokens.kt']) {
    if (!parsed[f]) continue;
    for (const m of parsed[f].members) {
      const why = brokenText(m.rhs);
      if (why) { add('T1-broken-value', f, m.id, `${f} ${m.id}: ${why} (\`${m.rhs}\`)`); mark(f, m.id); }
    }
  }
  const rnLeaf = (path) => path.join('.');
  const regNames = new Set(reg ? Object.keys(reg) : []);
  const insideToken = (path) => path.some((_, i) => i < path.length - 1 && regNames.has(path.slice(0, i + 1).join('.')));
  if (parsed['tokens-rn.ts']) {
    walkLeaves(parsed['tokens-rn.ts'].tree, (path, v) => {
      if (insideToken(path)) return; // the members of an object-valued token: the token itself is reported below
      const why = brokenScalar(unUndef(v));
      if (why) { add('T1-broken-value', 'tokens-rn.ts', rnLeaf(path), `tokens-rn.ts ${rnLeaf(path)} is ${why}`); mark('tokens-rn.ts', rnLeaf(path)); }
    });
    if (reg) {
      for (const [name, e] of Object.entries(reg)) {
        if (e?.type === 'icon' || COMPOSITE_TYPES.includes(e?.type)) continue;
        let cur = parsed['tokens-rn.ts'].tree;
        for (const p of name.split('.')) cur = cur !== null && typeof cur === 'object' ? cur[p] : undefined;
        if (cur !== null && typeof cur === 'object' && !Array.isArray(cur)) { add('T1-broken-value', 'tokens-rn.ts', name, `tokens-rn.ts ${name} is an object where a scalar is expected`); mark('tokens-rn.ts', name); }
      }
    }
  }
  if (parsed['tailwind-theme.js']) {
    walkLeaves(parsed['tailwind-theme.js'].tree, (path, v) => {
      const why = brokenScalar(unUndef(v));
      if (why) add('T1-broken-value', 'tailwind-theme.js', path.join('.'), `tailwind-theme.js ${path.join('.')} is ${why}`);
    });
  }
  if (parsed['tokens.d.ts']) {
    for (const r of parsed['tokens.d.ts'].record) {
      const v = unq(r.rhs);
      const why = v === null ? `an unquoted value \`${r.rhs}\`` : brokenText(v);
      if (why) add('T1-broken-value', 'tokens.d.ts', r.name, `tokens.d.ts ${r.name}: ${why}`);
    }
  }

  // ---- T2 / T3 need the registry ----
  const tokens = reg ? Object.entries(reg).map(([name, e]) => ({ name, type: e?.type, value: e?.value, ext: e?.extensions })) : [];
  const cssMap = new Map();
  if (parsed['tokens.css']) {
    for (const d of parsed['tokens.css'].decls) {
      if (cssMap.has(d.name) && cssMap.get(d.name) !== d.value) add('T3-agreement', 'tokens.css', d.name, `tokens.css --${d.name} is declared twice with different values (\`${cssMap.get(d.name)}\` and \`${d.value}\`)`);
      else if (cssMap.has(d.name)) add('T3-agreement', 'tokens.css', d.name, `tokens.css --${d.name} is declared twice`);
      if (!cssMap.has(d.name)) cssMap.set(d.name, d.value);
    }
  }
  /** Follow var(--x[, fallback]) chains to the end value; { value } or { error }. */
  const cssResolve = (name) => {
    const seen = [];
    let cur = name;
    for (;;) {
      if (!cssMap.has(cur)) return { error: `var(--${cur}) is not declared in tokens.css` };
      if (seen.includes(cur)) return { error: `var() cycle ${[...seen, cur].map((n) => `--${n}`).join(' -> ')}` };
      seen.push(cur);
      const v = cssMap.get(cur);
      const m = v.match(/^var\(\s*--([A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/);
      if (!m) return { value: v };
      cur = m[1];
    }
  };

  if (reg) {
    const hexOf = (v) => (typeof v === 'string' && HEX_ANY.test(v) ? v.slice(1).toLowerCase() : null);
    const swiftMap = new Map((parsed['DesignTokens.swift']?.members ?? []).map((m) => [m.id, m]));
    const ktMap = new Map((parsed['DesignTokens.kt']?.members ?? []).map((m) => [m.id, m]));

    for (const t of tokens) {
      const id = pascalId(t.name);
      const css = cssResolve(t.name.replace(/\./g, '-'));
      const cssRaw = cssMap.get(t.name.replace(/\./g, '-'));
      let rnVal; // value in tokens-rn.ts
      if (parsed['tokens-rn.ts']) {
        let cur = parsed['tokens-rn.ts'].tree;
        for (const p of t.name.split('.')) cur = cur !== null && typeof cur === 'object' ? cur[p] : undefined;
        rnVal = unUndef(cur);
      }
      const rnPresent = parsed['tokens-rn.ts'] && rnVal !== undefined;

      if (t.type === 'color') {
        const want = hexOf(t.value);
        if (!isBad('registry.json', t.name) && want === null) { add('T2-color-validity', 'registry.json', t.name, `registry.json ${t.name} colour ${JSON.stringify(t.value)} is not #RRGGBB or #RRGGBBAA`); mark('registry.json', t.name); }
        // tokens.css
        if (parsed['tokens.css']) {
          if (cssRaw === undefined) add('T3-agreement', 'tokens.css', t.name, `tokens.css has no --${t.name.replace(/\./g, '-')} for colour ${t.name}`);
          else if (!isBad('tokens.css', t.name.replace(/\./g, '-'))) {
            if (css.error) add('T3-agreement', 'tokens.css', t.name, `tokens.css ${t.name}: ${css.error}`);
            else if (!HEX_ANY.test(css.value)) { add('T2-color-validity', 'tokens.css', t.name, `tokens.css ${t.name} colour \`${css.value}\` is not #RRGGBB or #RRGGBBAA`); }
            else if (want !== null && css.value.slice(1).toLowerCase() !== want) add('T3-agreement', 'tokens.css', t.name, `tokens.css ${t.name} is ${css.value}, registry.json has ${t.value}`);
          }
        }
        // swift
        if (parsed['DesignTokens.swift']) {
          const m = swiftMap.get(id);
          if (!m) add('T3-agreement', 'DesignTokens.swift', t.name, `DesignTokens.swift has no ${id} for colour ${t.name}`);
          else if (!isBad('DesignTokens.swift', id)) {
            const mm = m.rhs.match(/^Color\(hex:\s*"([^"]*)"\)$/);
            if (!mm) add('T3-agreement', 'DesignTokens.swift', t.name, `DesignTokens.swift ${id} is \`${m.rhs}\`, expected Color(hex: "RRGGBB")`);
            else if (!HEX_DIGITS.test(mm[1])) add('T2-color-validity', 'DesignTokens.swift', t.name, `DesignTokens.swift ${id} hex "${mm[1]}" is not 6 or 8 hex digits`);
            else if (want !== null && mm[1].toLowerCase() !== want) add('T3-agreement', 'DesignTokens.swift', t.name, `DesignTokens.swift ${id} is "${mm[1]}", registry.json has ${t.value}`);
          }
        }
        // kotlin
        if (parsed['DesignTokens.kt']) {
          const m = ktMap.get(id);
          if (!m) add('T3-agreement', 'DesignTokens.kt', t.name, `DesignTokens.kt has no ${id} for colour ${t.name}`);
          else if (!isBad('DesignTokens.kt', id)) {
            const mm = m.rhs.match(/^Color\(0x([^)]*)\)$/);
            if (!mm) add('T3-agreement', 'DesignTokens.kt', t.name, `DesignTokens.kt ${id} is \`${m.rhs}\`, expected Color(0xAARRGGBB)`);
            else if (!/^[0-9a-fA-F]{8}$/.test(mm[1])) add('T2-color-validity', 'DesignTokens.kt', t.name, `DesignTokens.kt ${id} literal 0x${mm[1]} is not 0xAARRGGBB (8 hex digits)`);
            else if (want !== null) {
              const argb = (want.length === 8 ? want.slice(6) + want.slice(0, 6) : `ff${want}`);
              if (mm[1].toLowerCase() !== argb) add('T3-agreement', 'DesignTokens.kt', t.name, `DesignTokens.kt ${id} is 0x${mm[1]}, registry.json ${t.value} is 0x${argb.toUpperCase()}`);
            }
          }
        }
        // rn
        if (parsed['tokens-rn.ts']) {
          if (!rnPresent) add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts has no ${t.name}`);
          else if (!isBad('tokens-rn.ts', t.name)) {
            if (typeof rnVal !== 'string' || !HEX_ANY.test(rnVal)) add('T2-color-validity', 'tokens-rn.ts', t.name, `tokens-rn.ts ${t.name} colour ${JSON.stringify(rnVal)} is not #RRGGBB or #RRGGBBAA`);
            else if (want !== null && rnVal.slice(1).toLowerCase() !== want) add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts ${t.name} is ${rnVal}, registry.json has ${t.value}`);
          }
        }
      } else if (t.type === 'dimension') {
        const pm = typeof t.value === 'string' ? t.value.match(PX) : null;
        const px = pm ? parseFloat(pm[1]) : null;
        if (px === null && !isBad('registry.json', t.name)) { add('T3-agreement', 'registry.json', t.name, `registry.json ${t.name} dimension ${JSON.stringify(t.value)} is not a px length, the outputs cannot be compared`); mark('registry.json', t.name); }
        if (parsed['tokens.css']) {
          if (cssRaw === undefined) add('T3-agreement', 'tokens.css', t.name, `tokens.css has no --${t.name.replace(/\./g, '-')} for dimension ${t.name}`);
          else if (!isBad('tokens.css', t.name.replace(/\./g, '-'))) {
            if (css.error) add('T3-agreement', 'tokens.css', t.name, `tokens.css ${t.name}: ${css.error}`);
            else if (px !== null && css.value !== t.value) add('T3-agreement', 'tokens.css', t.name, `tokens.css ${t.name} is ${css.value}, registry.json has ${t.value}`);
          }
        }
        if (parsed['DesignTokens.swift']) {
          const m = swiftMap.get(id);
          if (!m) add('T3-agreement', 'DesignTokens.swift', t.name, `DesignTokens.swift has no ${id} for dimension ${t.name}`);
          else if (!isBad('DesignTokens.swift', id)) {
            if (!NUM.test(m.rhs)) add('T3-agreement', 'DesignTokens.swift', t.name, `DesignTokens.swift ${id} is \`${m.rhs}\`, expected a number`);
            else if (px !== null && Number(m.rhs) !== px) add('T3-agreement', 'DesignTokens.swift', t.name, `DesignTokens.swift ${id} is ${m.rhs}, registry.json has ${t.value}`);
          }
        }
        if (parsed['DesignTokens.kt']) {
          const m = ktMap.get(id);
          if (!m) add('T3-agreement', 'DesignTokens.kt', t.name, `DesignTokens.kt has no ${id} for dimension ${t.name}`);
          else if (!isBad('DesignTokens.kt', id)) {
            const mm = m.rhs.match(/^(-?(?:\d+\.?\d*|\.\d+))\.dp$/);
            if (!mm) add('T3-agreement', 'DesignTokens.kt', t.name, `DesignTokens.kt ${id} is \`${m.rhs}\`, expected <number>.dp`);
            else if (px !== null && Number(mm[1]) !== px) add('T3-agreement', 'DesignTokens.kt', t.name, `DesignTokens.kt ${id} is ${m.rhs}, registry.json has ${t.value}`);
          }
        }
        if (parsed['tokens-rn.ts']) {
          if (!rnPresent) add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts has no ${t.name}`);
          else if (!isBad('tokens-rn.ts', t.name)) {
            if (typeof rnVal !== 'number') add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts ${t.name} is ${JSON.stringify(rnVal)}, expected the number ${px}`);
            else if (px !== null && rnVal !== px) add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts ${t.name} is ${rnVal}, registry.json has ${t.value}`);
          }
        }
      } else if (t.type === 'icon') {
        const name = (key) => { const v = t.ext?.[key] ?? t.value; return typeof v === 'string' ? v : null; };
        for (const [f, map, suffix, key] of [['DesignTokens.swift', swiftMap, 'Symbol', 'sfSymbol'], ['DesignTokens.kt', ktMap, 'Icon', 'material']]) {
          if (!parsed[f]) continue;
          const m = map.get(id + suffix);
          if (!m) { add('T3-agreement', f, t.name, `${f} has no ${id}${suffix} for icon ${t.name}`); continue; }
          if (isBad(f, id + suffix)) continue;
          const v = unq(m.rhs);
          if (v === null) add('T3-agreement', f, t.name, `${f} ${id}${suffix} is \`${m.rhs}\`, expected a string`);
          else if (name(key) !== null && v !== name(key)) add('T3-agreement', f, t.name, `${f} ${id}${suffix} is "${v}", registry.json ${key} is "${name(key)}"`);
        }
      } else if (!COMPOSITE_TYPES.includes(t.type)) {
        // other scalar types present in more than one output (fontFamily, fontWeight, ...): tokens.css and tokens-rn.ts
        if (parsed['tokens.css']) {
          if (cssRaw === undefined) add('T3-agreement', 'tokens.css', t.name, `tokens.css has no --${t.name.replace(/\./g, '-')} for ${t.type} ${t.name}`);
          else if (!isBad('tokens.css', t.name.replace(/\./g, '-'))) {
            if (css.error) add('T3-agreement', 'tokens.css', t.name, `tokens.css ${t.name}: ${css.error}`);
            else if (!isBad('registry.json', t.name) && css.value !== String(t.value)) add('T3-agreement', 'tokens.css', t.name, `tokens.css ${t.name} is ${css.value}, registry.json has ${t.value}`);
          }
        }
        if (parsed['tokens-rn.ts']) {
          if (!rnPresent) add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts has no ${t.name}`);
          else if (!isBad('tokens-rn.ts', t.name) && !isBad('registry.json', t.name) && rnVal !== t.value) add('T3-agreement', 'tokens-rn.ts', t.name, `tokens-rn.ts ${t.name} is ${JSON.stringify(rnVal)}, registry.json has ${JSON.stringify(t.value)}`);
        }
      }
    }

    // extras: members/vars/leaves that no registry token accounts for
    const nonIcon = tokens.filter((t) => t.type !== 'icon');
    if (parsed['tokens.css']) {
      const want = new Set(nonIcon.map((t) => t.name.replace(/\./g, '-')));
      for (const n of cssMap.keys()) if (!want.has(n)) add('T3-agreement', 'tokens.css', n, `tokens.css declares --${n}, which is no registry.json token`);
    }
    for (const [f, map, kinds] of [['DesignTokens.swift', swiftMap, ['color', 'dimension']], ['DesignTokens.kt', ktMap, ['color', 'dimension']]]) {
      if (!parsed[f]) continue;
      const want = new Set();
      for (const t of tokens) {
        if (kinds.includes(t.type)) want.add(pascalId(t.name));
        else if (t.type === 'icon') want.add(pascalId(t.name) + (f.endsWith('swift') ? 'Symbol' : 'Icon'));
      }
      for (const id of map.keys()) if (!want.has(id)) add('T3-agreement', f, id, `${f} declares ${id}, which matches no registry.json token`);
    }
    if (parsed['tokens-rn.ts']) {
      const names = new Set(nonIcon.map((t) => t.name));
      const prefixes = new Set(nonIcon.flatMap((t) => t.name.split('.').map((_, i, a) => a.slice(0, i + 1).join('.'))));
      const underToken = (p) => p.some((_, i) => names.has(p.slice(0, i + 1).join('.')) && i < p.length - 1);
      walkLeaves(parsed['tokens-rn.ts'].tree, (path) => {
        const n = path.join('.');
        if (underToken(path)) return; // inside an object-valued token: reported by T1
        if (!names.has(n) && !prefixes.has(n)) add('T3-agreement', 'tokens-rn.ts', n, `tokens-rn.ts has ${n}, which is no registry.json token`);
      });
    }
    // tailwind / d.ts: var() references
    const refOk = (f, where, v) => {
      if (typeof v !== 'string') return;
      const m = v.match(/^var\(\s*--([A-Za-z0-9_-]+)\s*\)$/);
      if (!m) { add('T3-agreement', f, where, `${f} ${where} is ${JSON.stringify(v)}, expected var(--<token>)`); return; }
      if (parsed['tokens.css'] && !cssMap.has(m[1])) add('T3-agreement', f, where, `${f} ${where} references var(--${m[1]}), which tokens.css does not declare`);
    };
    if (parsed['tailwind-theme.js']) walkLeaves(parsed['tailwind-theme.js'].tree, (path, v) => refOk('tailwind-theme.js', path.join('.'), unUndef(v)));
    if (parsed['tokens.d.ts']) {
      const d = parsed['tokens.d.ts'];
      const want = nonIcon.map((t) => t.name);
      const union = new Set(d.names), rec = new Map(d.record.map((r) => [r.name, r.rhs]));
      for (const n of want) {
        if (!union.has(n)) add('T3-agreement', 'tokens.d.ts', n, `tokens.d.ts TokenName has no '${n}'`);
        if (!rec.has(n)) add('T3-agreement', 'tokens.d.ts', n, `tokens.d.ts tokens record has no '${n}'`);
        else { const v = unq(rec.get(n)); if (v !== null && v !== `var(${cssName(n)})`) add('T3-agreement', 'tokens.d.ts', n, `tokens.d.ts '${n}' is ${JSON.stringify(v)}, expected "var(${cssName(n)})"`); else refOk('tokens.d.ts', `'${n}'`, v); }
      }
      for (const n of union) if (!want.includes(n)) add('T3-agreement', 'tokens.d.ts', n, `tokens.d.ts TokenName lists '${n}', which is no registry.json token`);
      for (const n of rec.keys()) if (!want.includes(n)) add('T3-agreement', 'tokens.d.ts', n, `tokens.d.ts tokens record has '${n}', which is no registry.json token`);
    }
  }

  // ---- T4 freshness ----
  let freshFiles = fresh;
  if (fresh === undefined) {
    try { freshFiles = buildOutputs().files; }
    catch (e) { add('T4-freshness', '(build)', '-', `a fresh build of the token sources failed: ${String(e.message).split('\n')[0]}`); freshFiles = null; }
  }
  if (freshFiles) {
    for (const f of expected) {
      if (!has(f)) continue;
      const want = freshFiles[f];
      if (typeof want !== 'string') { add('T4-freshness', f, '-', `${f} is not produced by a fresh build`); continue; }
      if (want === text[f]) continue;
      const a = text[f].split('\n'), b = want.split('\n');
      let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
      const cut = (s) => (s === undefined ? '(end of file)' : JSON.stringify(s.length > 70 ? `${s.slice(0, 70)}...` : s));
      add('T4-freshness', f, '-', `${f} differs from a fresh build at line ${k + 1}: committed ${cut(a[k])}, fresh ${cut(b[k])}; run \`node design-system/tokens-dtcg/scripts/build.mjs\` and commit the result`);
    }
  }

  return finish(issues, tokens.length);
}

function finish(issues, tokenCount) {
  const order = (r) => RULES.indexOf(r);
  const fileOrder = (f) => { const i = OUTPUT_FILES.indexOf(f); return i < 0 ? 99 : i; };
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  issues.sort((a, b) => order(a.rule) - order(b.rule) || fileOrder(a.file) - fileOrder(b.file) || cmp(a.file, b.file) || cmp(a.token, b.token) || cmp(a.msg, b.msg));
  return { ok: issues.length === 0, issues, counts: { tokens: tokenCount, files: OUTPUT_FILES.length } };
}

/** Read the outputs from disk; an unreadable file is null (T0 reports it). */
export function loadTokenOutputs(dir = OUTPUT_DIR, files = OUTPUT_FILES) {
  const out = {};
  for (const f of files) { try { out[f] = readFileSync(resolve(dir, f), 'utf8'); } catch { out[f] = null; } }
  return out;
}

/** Deterministic text report. */
export function formatTokenReport(r) {
  const out = [];
  out.push(`token outputs gate: ${r.counts.tokens} registry tokens, ${r.counts.files} output files`);
  for (const i of r.issues) out.push(`  FAIL ${i.rule}  ${i.file}  ${i.token}: ${i.msg}`);
  out.push(r.ok ? 'token outputs gate: PASS' : `token outputs gate: FAIL (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = checkTokenOutputs({ outputs: loadTokenOutputs() });
  console.log(formatTokenReport(r));
  process.exit(r.ok ? 0 : 1);
}
