#!/usr/bin/env node
/**
 * schema-constructs — derive the output-affecting construct ids of the design
 * spec language, and enumerate the Lowering-Ledger trait ids the adapters use.
 *
 * D1 scaffolding (trait registry). Shared by verify-patches today; D2 promotes
 * it into a CI gate, D3 builds corpus coverage on top of it. Nothing here
 * changes generated output.
 *
 * ── CONSTRUCT ID FORMAT (stable contract — D2/D3 depend on it) ───────────────
 *   <group>:<name>
 *
 *   el-kind:<kind>                 each `el` enum value           el-kind:link
 *   <object>.field:<key>           each property key of <object>  element.field:href
 *   <object>.value:<key>=<value>   each enum value of a property  a11y.value:live=polite
 *   style-slot:<slot>              each style slot name           style-slot:gap
 *
 *   <object> is one of (the closed, explicit walk set — a rename in the schema
 *   fails loudly instead of silently dropping constructs):
 *     element, valueRef, numberFormat, dateTimeFormat,
 *     a11y (= element.a11y), variant (= element.variant),
 *     input (= element.input), input.state (= element.input.state)
 *
 *   Excluded (never an output effect on their own): schema meta ($schema, $id,
 *   title, type, required, enum, properties, items, additionalProperties,
 *   pattern, minimum, maximum — the walk only reads `properties`, so these can
 *   never surface as keys), plus the property names description, id, tokens,
 *   category. `labelledBy` is NOT excluded. Enum values of `el` are emitted as
 *   `el-kind:*` (the key itself stays `element.field:el`).
 *
 * ── ORDER (deterministic) ────────────────────────────────────────────────────
 *   Groups in the fixed order of OBJECTS below (el-kind first, style-slot last);
 *   within an object, `field:` entries then `value:` entries, each in the
 *   schema's declaration order; style slots alphabetically. The same input
 *   always yields byte-identical output.
 *
 * ── STYLE SLOTS ──────────────────────────────────────────────────────────────
 *   Style slots are not schema properties (`style` is a free map). They are the
 *   sorted union of (a) the slot names any adapter's lowering table recognizes
 *   (STYLE_PROP of react/vue/svelte/react-native, MODIFIER of swiftui; compose's
 *   inline checks are a subset), and (b) every slot name a corpus spec uses in
 *   a `style` map or a variant-case map.
 *
 * ── TRAIT IDS ────────────────────────────────────────────────────────────────
 *   Declared traits are enumerated by a static scan of RendererBase.declaredTraits
 *   (`t.push(...)` calls); handled traits by a static scan of every adapter's
 *   `express(` / `diverge(` first argument. Both are NORMALIZED so a value-encoded
 *   id compares as one trait: everything after the first `=` becomes `*`, and a
 *   template interpolation `${...}` becomes `*` (role=${node.role} -> role=*,
 *   a11y.live=${a} -> a11y.live=*, state=boolean -> state=*).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { STYLE_PROP as REACT_STYLE } from '../../adapters/react/token-map.mjs';
import { STYLE_PROP as VUE_STYLE } from '../../adapters/vue/token-map.mjs';
import { STYLE_PROP as SVELTE_STYLE } from '../../adapters/svelte/token-map.mjs';
import { STYLE_PROP as RN_STYLE } from '../../adapters/react-native/token-map.mjs';
import { MODIFIER as SWIFTUI_MODIFIER } from '../../adapters/swiftui/token-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '../..');
export const SCHEMA_PATH = resolve(ROOT, '_shared/schemas/design-spec.schema.yaml');
export const REGISTRY_PATH = resolve(ROOT, '_shared/policy/trait-registry.yaml');
export const ADAPTERS = ['react', 'vue', 'svelte', 'react-native', 'swiftui', 'compose'];

const EXCLUDED_KEYS = new Set(['description', 'id', 'tokens', 'category']);

/** Walk set, in emission order. `path` locates the object inside the schema. */
const OBJECTS = [
  { name: 'element', path: ['definitions', 'element'] },
  { name: 'valueRef', path: ['definitions', 'valueRef'] },
  { name: 'numberFormat', path: ['definitions', 'numberFormat'] },
  { name: 'dateTimeFormat', path: ['definitions', 'dateTimeFormat'] },
  { name: 'a11y', path: ['definitions', 'element', 'properties', 'a11y'] },
  { name: 'variant', path: ['definitions', 'element', 'properties', 'variant'] },
  { name: 'input', path: ['definitions', 'element', 'properties', 'input'] },
  { name: 'input.state', path: ['definitions', 'element', 'properties', 'input', 'properties', 'state'] },
];

const at = (root, path) => path.reduce((n, k) => {
  if (n == null || !(k in n)) throw new Error(`schema-constructs: schema path ${path.join('.')} not found (missing "${k}") — the walk set in schema-constructs.mjs must be updated with the schema`);
  return n[k];
}, root);

/**
 * @returns {string[]} construct ids derived from the schema only (no style slots).
 */
export function deriveSchemaConstructs(schemaPath = SCHEMA_PATH) {
  const schema = parse(readFileSync(schemaPath, 'utf8'));
  const out = [];
  for (const { name, path } of OBJECTS) {
    const obj = at(schema, path);
    const props = obj.properties ?? {};
    const fields = [];
    const values = [];
    for (const [key, prop] of Object.entries(props)) {
      if (EXCLUDED_KEYS.has(key)) continue;
      fields.push(`${name}.field:${key}`);
      if (Array.isArray(prop?.enum)) {
        for (const v of prop.enum) {
          values.push(name === 'element' && key === 'el' ? `el-kind:${v}` : `${name}.value:${key}=${v}`);
        }
      }
    }
    // el-kinds lead the element group (they are the most-referenced constructs).
    if (name === 'element') out.push(...values.filter((id) => id.startsWith('el-kind:')));
    out.push(...fields);
    out.push(...values.filter((id) => !id.startsWith('el-kind:')));
  }
  return out;
}

/** Corpus specs: schema examples + every artifact design-spec (same discovery as ci.mjs). */
export function corpusSpecPaths() {
  const paths = [];
  const exDir = resolve(ROOT, '_shared/schemas/examples');
  for (const f of readdirSync(exDir).sort()) if (f.endsWith('.spec.yaml')) paths.push(resolve(exDir, f));
  const artDir = resolve(ROOT, '.claude/artifacts');
  if (existsSync(artDir)) {
    for (const d of readdirSync(artDir).sort()) {
      const p = resolve(artDir, d, 'design-spec.yaml');
      if (existsSync(p)) paths.push(p);
    }
  }
  return paths;
}

function collectSlots(node, into) {
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node.style ?? {})) into.add(k);
  for (const c of Object.values(node.variant?.cases ?? {})) for (const k of Object.keys(c ?? {})) into.add(k);
  for (const c of node.children ?? []) collectSlots(c, into);
  collectSlots(node.then, into);
  collectSlots(node.else, into);
}

/** Style slots used by the corpus (style maps + variant-case maps). */
export function corpusStyleSlots() {
  const slots = new Set();
  for (const p of corpusSpecPaths()) collectSlots(parse(readFileSync(p, 'utf8')).root, slots);
  return [...slots].sort();
}

/** Style slots the adapters' lowering tables recognize (union over all adapters). */
export function adapterStyleSlots() {
  const slots = new Set();
  for (const t of [REACT_STYLE, VUE_STYLE, SVELTE_STYLE, RN_STYLE, SWIFTUI_MODIFIER]) for (const k of Object.keys(t)) slots.add(k);
  return [...slots].sort();
}

/** @returns {string[]} the full derived construct id list, in contract order. */
export function deriveConstructs() {
  const slots = [...new Set([...adapterStyleSlots(), ...corpusStyleSlots()])].sort();
  return [...deriveSchemaConstructs(), ...slots.map((s) => `style-slot:${s}`)];
}

// ── trait enumeration ────────────────────────────────────────────────────────

/** Normalize a trait id: `${...}` -> `*`, and everything after the first `=` -> `*`. */
export function normalizeTraitId(raw) {
  let id = String(raw).replace(/\$\{[^}]*\}/g, '*');
  const eq = id.indexOf('=');
  if (eq !== -1) id = `${id.slice(0, eq)}=*`;
  return id;
}

/** Extract the leading string/template literal argument of each `call(` in src. */
function firstLiteralArgs(src, callRe) {
  const found = [];
  const re = new RegExp(`${callRe}\\(\\s*(['"\`])((?:\\\\.|(?!\\1).)*?)\\1`, 'g');
  for (const m of src.matchAll(re)) found.push(m[2]);
  return found;
}

/** Declared ledger traits: static scan of RendererBase.declaredTraits `t.push(...)`. */
export function declaredTraitIds() {
  const src = readFileSync(resolve(ROOT, 'adapters/_shared/renderer-base.mjs'), 'utf8');
  const start = src.indexOf('declaredTraits(node)');
  const end = src.indexOf('\n  hasOptionIcons(node) {', start); // the method DEFINITION, not the call inside declaredTraits
  if (start === -1 || end === -1) throw new Error('schema-constructs: declaredTraits() not found in renderer-base.mjs');
  const body = src.slice(start, end);
  return [...new Set(firstLiteralArgs(body, 't\\.push').map(normalizeTraitId))].sort();
}

/**
 * Handled traits: first argument of every `express(` / `diverge(` call in the
 * adapters, per adapter. A trait that is declared but absent from this set is a
 * silent drop on every adapter (ledger-unaccounted for any spec using it).
 * @returns {Record<string, string[]>} adapter -> sorted normalized trait ids
 */
export function handledTraitIdsByAdapter() {
  const by = {};
  for (const a of ADAPTERS) {
    const src = readFileSync(resolve(ROOT, `adapters/${a}/generate.mjs`), 'utf8');
    const ids = [...firstLiteralArgs(src, '(?:this\\.)?express'), ...firstLiteralArgs(src, '(?:this\\.)?diverge')];
    by[a] = [...new Set(ids.map(normalizeTraitId))].sort();
  }
  return by;
}

export function handledTraitIds() {
  return [...new Set(Object.values(handledTraitIdsByAdapter()).flat())].sort();
}

// ── registry ─────────────────────────────────────────────────────────────────

/**
 * Load trait-registry.yaml. Each entry is either { trait } or
 * { untracked: { reason, approver, expires } } — the same reason/approver/expires
 * shape as _shared/policy/a11y-waivers.json. Structure is validated here; EXPIRY
 * is not enforced in D1 (the D2 gate enforces it, like loadWaivers does).
 */
export function loadTraitRegistry(path = REGISTRY_PATH) {
  const problems = [];
  let raw;
  try { raw = parse(readFileSync(path, 'utf8')); }
  catch { return { entries: new Map(), problems: [`trait registry not found or unparseable at ${path}`] }; }
  const entries = new Map();
  for (const [id, e] of Object.entries(raw?.constructs ?? {})) {
    const hasTrait = e && typeof e.trait === 'string' && e.trait;
    const u = e?.untracked;
    if (hasTrait && u) { problems.push(`"${id}" sets both trait and untracked`); continue; }
    if (hasTrait) { entries.set(id, { trait: e.trait }); continue; }
    if (!u) { problems.push(`"${id}" has neither trait nor untracked`); continue; }
    if (!u.reason || !u.approver || !u.expires) { problems.push(`"${id}" untracked is missing reason, approver and/or expires (policy: no open-ended exemptions)`); continue; }
    if (Number.isNaN(new Date(String(u.expires)).getTime())) { problems.push(`"${id}" has an unparseable expiry "${u.expires}"`); continue; }
    entries.set(id, { untracked: { reason: String(u.reason), approver: String(u.approver), expires: String(u.expires) } });
  }
  return { entries, problems };
}

/**
 * Check a registry against the derived constructs and the live trait sets.
 * Pure (inputs injected) so verify-patches can fire it on corrupted inputs.
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function checkTraitRegistry({ constructs, registry, declared, handled }) {
  const issues = [...registry.problems];
  const have = registry.entries;
  const derived = new Set(constructs);
  const dup = constructs.filter((c, i) => constructs.indexOf(c) !== i);
  for (const c of dup) issues.push(`construct "${c}" is derived twice`);
  for (const c of constructs) if (!have.has(c)) issues.push(`derived construct "${c}" has no registry entry`);
  for (const id of have.keys()) if (!derived.has(id)) issues.push(`registry entry "${id}" is orphaned (the walker does not derive it)`);
  const declaredSet = new Set(declared);
  const handledSet = new Set(handled);
  for (const [id, e] of have) {
    if (!e.trait) continue;
    if (!declaredSet.has(e.trait)) issues.push(`"${id}" maps to trait "${e.trait}", which RendererBase.declaredTraits never declares`);
    else if (!handledSet.has(e.trait)) issues.push(`"${id}" maps to trait "${e.trait}", which is declared but never expressed or diverged by any adapter — it is not covered`);
  }
  return { ok: issues.length === 0, issues };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const constructs = deriveConstructs();
  console.log(`derived constructs: ${constructs.length}`);
  for (const c of constructs) console.log(`  ${c}`);
  console.log(`declared traits (${declaredTraitIds().length}): ${declaredTraitIds().join(', ')}`);
  console.log(`handled traits  (${handledTraitIds().length}): ${handledTraitIds().join(', ')}`);
}
