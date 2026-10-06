#!/usr/bin/env node
/**
 * check-trait-registry — D2 trait completeness gate (BLOCKING).
 *
 * Makes it structurally impossible for an output-affecting schema construct to
 * exist without either a ledger trait or an explicit, dated, approved reason for
 * being untracked. Reads _shared/policy/trait-registry.yaml RAW (so duplicate
 * keys and malformed shapes are visible) and checks it against the constructs
 * derived by schema-constructs.mjs and the declared ledger traits.
 *
 * Rules (each issue carries a stable rule id and names the construct):
 *   R1-missing           a derived construct has no registry entry
 *   R2-stale             a registry entry matches no derived construct
 *   R3-shape             an entry is neither mapped ({trait}) nor untracked
 *                        ({untracked}), or is both, or has unknown keys
 *   R4-dangling-trait    a mapped entry names a trait that is not a declared
 *                        ledger trait; `trait` is a string or a list, every
 *                        item is checked, an empty list fails
 *   R5-untracked-quality reason missing/empty; approver missing or not exactly
 *                        APPROVER; expiry missing, not a valid date, or past
 *   R6-duplicate         the same construct appears twice in the registry
 *   R0-load              the registry file is missing/unparseable/has no map
 *
 * Approver/expiry rules mirror loadWaivers() in ledger-gate.mjs exactly
 * (approver AND expires required; `new Date(expires)` must parse; expired when
 * `new Date(expires) < now`, so an entry is already past on its own expiry
 * date), plus the exact approver string required by D2. loadWaivers itself is
 * bound to the waiver file/ids and cannot validate arbitrary entries.
 *
 * Declared traits come from schema-constructs.declaredTraitIds() — the static
 * scan of RendererBase.declaredTraits (renderer-base exports no list). Trait ids
 * in the registry use the same normalization (everything after `=` is `*`).
 *
 * Advisory (printed, never fails): declared ledger traits referenced by no
 * registry entry, and untracked entries expiring within 90 days.
 *
 * There is no whitelist and no bypass flag. The clock is an injectable function
 * parameter (default: now) so expiry can be tested; it is deliberately NOT a
 * CLI flag. Output is deterministic: issues sort by rule order then construct id.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseDocument, isMap, isScalar } from 'yaml';
import { REGISTRY_PATH, deriveConstructs, declaredTraitIds } from './schema-constructs.mjs';

export const APPROVER = 'Ssuppanut (design-system a11y owner)';
export const EXPIRY_WARN_DAYS = 90;
export const RULES = ['R0-load', 'R1-missing', 'R2-stale', 'R3-shape', 'R4-dangling-trait', 'R5-untracked-quality', 'R6-duplicate'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const day = (d) => d.toISOString().slice(0, 10);

/** Parse the registry keeping duplicate keys. @returns {{ pairs: [string, any][], problem?: string }} */
function readRegistry({ registryPath, registryText }) {
  let text = registryText;
  if (text === undefined) {
    try { text = readFileSync(registryPath, 'utf8'); }
    catch { return { pairs: [], problem: `trait registry not found at ${registryPath}` }; }
  }
  const doc = parseDocument(text, { uniqueKeys: false });
  if (doc.errors.length) return { pairs: [], problem: `trait registry is not valid YAML: ${doc.errors[0].message.split('\n')[0]}` };
  const root = doc.contents;
  const constructs = isMap(root) ? root.get('constructs', true) : null;
  if (!isMap(constructs)) return { pairs: [], problem: 'trait registry has no `constructs` map' };
  const pairs = constructs.items.map((p) => [isScalar(p.key) ? String(p.key.value) : String(p.key), p.value?.toJSON?.() ?? p.value]);
  return { pairs };
}

/** Same expiry semantics as loadWaivers(): unparseable -> invalid; `exp < now` -> past. */
function expiryState(expires, now) {
  const raw = expires instanceof Date ? expires.toISOString() : expires;
  if (raw === undefined || raw === null || raw === '') return 'missing';
  const exp = new Date(raw);
  if (Number.isNaN(exp.getTime())) return 'invalid';
  if (exp.getTime() < now.getTime()) return 'past';
  return { exp };
}

/**
 * @param {object} [o]
 * @param {string} [o.registryPath]    registry file (default: the real one)
 * @param {string} [o.registryText]    registry YAML text (overrides the file; for fixtures)
 * @param {string[]} [o.constructs]    derived construct ids (default: live walker)
 * @param {string[]} [o.declaredTraits] declared ledger traits (default: live scan)
 * @param {Date} [o.now]               clock (default: now)
 * @returns {{ ok: boolean, issues: {rule:string, construct:string, msg:string}[], advisory: {unreferencedTraits:string[], expiringSoon:string[]}, counts: {constructs:number, entries:number, mapped:number, untracked:number}, now: string }}
 */
export function checkTraitRegistryGate({
  registryPath = REGISTRY_PATH,
  registryText,
  constructs = deriveConstructs(),
  declaredTraits = declaredTraitIds(),
  now = new Date(),
} = {}) {
  const issues = [];
  const add = (rule, construct, msg) => issues.push({ rule, construct, msg });
  const declared = new Set(declaredTraits);
  const derived = new Set(constructs);
  const { pairs, problem } = readRegistry({ registryPath, registryText });
  const counts = { constructs: constructs.length, entries: pairs.length, mapped: 0, untracked: 0 };
  const referenced = new Set();
  const expiringSoon = [];

  if (problem) add('R0-load', '(registry)', problem);

  // R6 — duplicate keys (every occurrence is still validated below).
  const seen = new Map();
  for (const [id] of pairs) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) add('R6-duplicate', id, `construct "${id}" appears ${n} times in the registry`);

  // R1 — every derived construct needs an entry.
  for (const c of constructs) if (!seen.has(c)) add('R1-missing', c, `derived construct "${c}" has no registry entry`);

  for (const [id, e] of pairs) {
    // R2 — an entry that matches no derived construct.
    if (!derived.has(id)) add('R2-stale', id, `registry entry "${id}" matches no derived construct`);

    // R3 — shape.
    if (!isObj(e)) { add('R3-shape', id, `entry "${id}" must be a mapping with either \`trait\` or \`untracked\``); continue; }
    const hasTrait = 'trait' in e;
    const hasUntracked = 'untracked' in e;
    const unknown = Object.keys(e).filter((k) => k !== 'trait' && k !== 'untracked');
    if (hasTrait && hasUntracked) { add('R3-shape', id, `entry "${id}" is both mapped (\`trait\`) and \`untracked\` — exactly one is allowed`); continue; }
    if (!hasTrait && !hasUntracked) { add('R3-shape', id, `entry "${id}" is neither mapped (\`trait\`) nor \`untracked\``); continue; }
    if (unknown.length) add('R3-shape', id, `entry "${id}" has unknown key(s): ${unknown.join(', ')}`);

    if (hasTrait) {
      counts.mapped++;
      // R4 — every trait must be a declared ledger trait; empty list fails.
      const items = Array.isArray(e.trait) ? e.trait : [e.trait];
      if (Array.isArray(e.trait) && e.trait.length === 0) add('R4-dangling-trait', id, `entry "${id}" maps to an empty trait list`);
      for (const t of items) {
        if (typeof t === 'string' && declared.has(t)) referenced.add(t);
        else add('R4-dangling-trait', id, `entry "${id}" maps to ${JSON.stringify(t)}, which is not a declared ledger trait`);
      }
      continue;
    }

    counts.untracked++;
    // R5 — untracked quality.
    const u = e.untracked;
    if (!isObj(u)) { add('R3-shape', id, `entry "${id}" \`untracked\` must be a mapping with reason, approver and expires`); continue; }
    if (!nonEmptyStr(u.reason)) add('R5-untracked-quality', id, `untracked "${id}" has a missing or empty reason`);
    if (u.approver === undefined || u.approver === null || u.approver === '') add('R5-untracked-quality', id, `untracked "${id}" is missing an approver`);
    else if (u.approver !== APPROVER) add('R5-untracked-quality', id, `untracked "${id}" approver ${JSON.stringify(u.approver)} is not exactly ${JSON.stringify(APPROVER)}`);
    const st = expiryState(u.expires, now);
    if (st === 'missing') add('R5-untracked-quality', id, `untracked "${id}" is missing an expiry (policy: no open-ended exemptions)`);
    else if (st === 'invalid') add('R5-untracked-quality', id, `untracked "${id}" has an unparseable expiry ${JSON.stringify(String(u.expires))}`);
    else if (st === 'past') add('R5-untracked-quality', id, `untracked "${id}" expired on ${String(u.expires instanceof Date ? day(u.expires) : u.expires)} (approver: ${u.approver ?? 'none'})`);
    else if ((st.exp.getTime() - now.getTime()) / 86400000 <= EXPIRY_WARN_DAYS) expiringSoon.push(id);
  }

  const order = (r) => RULES.indexOf(r);
  issues.sort((a, b) => order(a.rule) - order(b.rule) || (a.construct < b.construct ? -1 : a.construct > b.construct ? 1 : a.msg < b.msg ? -1 : a.msg > b.msg ? 1 : 0));
  const unreferencedTraits = [...declared].filter((t) => !referenced.has(t)).sort();
  return { ok: issues.length === 0, issues, advisory: { unreferencedTraits, expiringSoon: expiringSoon.sort() }, counts, now: day(now) };
}

/** Deterministic text report. */
export function formatReport(r) {
  const out = [];
  out.push(`trait-registry gate (clock ${r.now}): ${r.counts.constructs} derived constructs, ${r.counts.entries} entries (${r.counts.mapped} mapped, ${r.counts.untracked} untracked)`);
  for (const i of r.issues) out.push(`  FAIL ${i.rule}  ${i.construct}: ${i.msg}`);
  out.push(`  ADVISORY ${r.advisory.unreferencedTraits.length} declared ledger trait(s) referenced by no registry entry${r.advisory.unreferencedTraits.length ? `: ${r.advisory.unreferencedTraits.join(', ')}` : ''}`);
  out.push(`  ADVISORY ${r.advisory.expiringSoon.length} untracked entr${r.advisory.expiringSoon.length === 1 ? 'y' : 'ies'} expiring within ${EXPIRY_WARN_DAYS} days`);
  out.push(r.ok ? 'trait-registry gate: PASS' : `trait-registry gate: FAIL (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = checkTraitRegistryGate();
  console.log(formatReport(r));
  process.exit(r.ok ? 0 : 1);
}
