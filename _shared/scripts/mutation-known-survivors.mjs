#!/usr/bin/env node
/**
 * mutation-known-survivors — the structured replacement for the old KNOWN_SURVIVORS Set (D4b).
 *
 * A surviving mutant is a proven blind spot in the gates. Blind spots that are already logged
 * (an audit cluster will fix them) are recorded in _shared/policy/mutation-known-survivors.yaml,
 * one entry per (operator, feature, adapter) scope, each with a reason, an approver and an expiry.
 * The mutation harness (mutate-gates.mjs) and verify-patches P44 both call checkSurvivors() on the
 * same mutant list, so there is exactly one definition of "expected".
 *
 * Mutant identity: `<operator>|<feature>|<adapter>|<site>`; adapter is `*` for operators that are
 * not adapter specific. The id is built from the operator id, the corpus feature name and the
 * site key the operator returns (`<feature>:<adapter>:<detail>` by convention), so it is stable
 * across runs (sites are found deterministically) and unique (the harness throws on a duplicate).
 *
 * Rules (each issue carries a stable id and names the entry or the mutant):
 *   M0-load            the file is missing/unparseable, has no `survivors` list, or an entry has
 *                      an unknown or missing field
 *   M1-new-survivor    a surviving mutant matches no entry (a fresh blind spot)
 *   M2-stale-entry     an entry is the best match of no surviving mutant: it matches no mutant at
 *                      all, or every mutant it matches is now killed. Delete this entry.
 *   M3-entry-quality   empty reason; approver not exactly APPROVER; expiry missing, invalid or past;
 *                      cluster not in CLUSTERS; duplicate (operator, feature, adapter) scope
 *   M4-over-broad      the scope also matches KILLED mutants of the same operator, so it hides a
 *                      future regression in those; narrow the feature/adapter scope. (An entry with
 *                      feature "*" and adapter "*" is therefore only legal for an operator whose
 *                      mutants ALL survive.)
 *
 * Matching: an entry matches a mutant when the operators are equal and feature/adapter are equal or
 * "*". A surviving mutant is credited to the MOST SPECIFIC matching entry (exact feature +2, exact
 * adapter +1; ties go to the earlier entry), so a redundant wildcard entry shows up as stale.
 *
 * Approver and expiry semantics are the D2/D3 gates' (APPROVER, expiryState from
 * check-trait-registry.mjs): an entry is already past on its own expiry date. There is no bypass
 * flag; the clock is an injectable function parameter, never a CLI option. Output is deterministic
 * (issues sort by rule order, then entry or mutant id).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument, isMap, isScalar, isSeq } from 'yaml';
import { ROOT } from './schema-constructs.mjs';
import { APPROVER, expiryState } from './check-trait-registry.mjs';

export const KNOWN_SURVIVORS_PATH = resolve(ROOT, '_shared/policy/mutation-known-survivors.yaml');
export const RULES = ['M0-load', 'M1-new-survivor', 'M2-stale-entry', 'M3-entry-quality', 'M4-over-broad'];
export const CLUSTERS = ['CL-01', 'CL-02', 'CL-03', 'CL-04', 'CL-05', 'CL-06', 'CL-07', 'CL-08', 'CL-09', 'CL-10', 'none-gate-gap'];
export const FIELDS = ['operator', 'feature', 'adapter', 'cluster', 'reason', 'approver', 'expires'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const day = (d) => d.toISOString().slice(0, 10);
const label = (e, i) => `entry ${i + 1} (${e?.operator ?? '?'} feature=${e?.feature ?? '?'} adapter=${e?.adapter ?? '?'})`;

/** Parse the file. @returns {{ entries: object[], problem?: string }} */
export function loadKnownSurvivors({ path = KNOWN_SURVIVORS_PATH, text } = {}) {
  let src = text;
  if (src === undefined) {
    try { src = readFileSync(path, 'utf8'); }
    catch { return { entries: [], problem: `known-survivors file not found at ${path}` }; }
  }
  const doc = parseDocument(src, { uniqueKeys: false });
  if (doc.errors.length) return { entries: [], problem: `known-survivors file is not valid YAML: ${doc.errors[0].message.split('\n')[0]}` };
  const root = doc.contents;
  if (!isMap(root) || !root.has('survivors')) return { entries: [], problem: 'known-survivors file has no `survivors` key' };
  const seq = root.get('survivors', true);
  // A present-but-empty list (`survivors: []`) is valid: it is the goal state.
  if (seq === null || (isScalar(seq) && seq.value === null)) return { entries: [] };
  if (!isSeq(seq)) return { entries: [], problem: 'known-survivors `survivors` must be a list of entries' };
  return { entries: seq.items.map((it) => (it?.toJSON ? it.toJSON() : it)) };
}

const specificity = (e, m) => (e.feature === m.feature ? 2 : 0) + (e.adapter === m.adapter ? 1 : 0);
const matches = (e, m) => e.operator === m.operator && (e.feature === '*' || e.feature === m.feature) && (e.adapter === '*' || e.adapter === m.adapter);

/**
 * @param {object} o
 * @param {{ id: string, operator: string, feature: string, adapter: string, killed: boolean }[]} o.mutants
 * @param {string} [o.path] @param {string} [o.text]  the known-survivors file (text overrides the file; for fixtures)
 * @param {Date} [o.now]  clock (default: now)
 */
export function checkSurvivors({ mutants, path = KNOWN_SURVIVORS_PATH, text, now = new Date() }) {
  const issues = [];
  const add = (rule, subject, msg) => issues.push({ rule, subject, msg });
  const { entries, problem } = loadKnownSurvivors({ path, text });
  if (problem) add('M0-load', '(file)', problem);
  const survivors = mutants.filter((m) => !m.killed);

  // M0 shape + M3 quality, per entry.
  const seen = new Map();
  const wellFormed = [];
  entries.forEach((e, i) => {
    const who = label(e, i);
    if (!isObj(e)) { add('M0-load', `entry ${i + 1}`, `entry ${i + 1} must be a mapping with ${FIELDS.join(', ')}`); return; }
    const unknown = Object.keys(e).filter((k) => !FIELDS.includes(k));
    const missing = FIELDS.filter((k) => !(k in e));
    if (unknown.length) add('M0-load', who, `${who} has unknown field(s): ${unknown.join(', ')}`);
    if (missing.length) add('M0-load', who, `${who} is missing field(s): ${missing.join(', ')}`);
    if (unknown.length || missing.length) return;
    if (!nonEmptyStr(e.operator) || !nonEmptyStr(e.feature) || !nonEmptyStr(e.adapter)) { add('M0-load', who, `${who}: operator, feature and adapter must be non-empty strings`); return; }
    wellFormed.push([e, i]);
    if (!nonEmptyStr(e.reason)) add('M3-entry-quality', who, `${who} has an empty reason`);
    if (e.approver !== APPROVER) add('M3-entry-quality', who, `${who} approver ${JSON.stringify(e.approver ?? null)} is not exactly ${JSON.stringify(APPROVER)}`);
    if (!CLUSTERS.includes(e.cluster)) add('M3-entry-quality', who, `${who} cluster ${JSON.stringify(e.cluster ?? null)} is not one of ${CLUSTERS.join(', ')}`);
    const st = expiryState(e.expires, now);
    if (st === 'missing') add('M3-entry-quality', who, `${who} is missing an expiry (policy: no open-ended exemptions)`);
    else if (st === 'invalid') add('M3-entry-quality', who, `${who} has an unparseable expiry ${JSON.stringify(String(e.expires))}`);
    else if (st === 'past') add('M3-entry-quality', who, `${who} expired on ${String(e.expires instanceof Date ? day(e.expires) : e.expires)}`);
    const k = `${e.operator}|${e.feature}|${e.adapter}`;
    if (seen.has(k)) add('M3-entry-quality', who, `${who} duplicates entry ${seen.get(k) + 1}`);
    else seen.set(k, i);
  });

  // Credit each surviving mutant to its most specific matching entry (M1 when none matches).
  const credited = new Map(wellFormed.map(([, i]) => [i, 0]));
  for (const m of survivors) {
    let best = null;
    for (const [e, i] of wellFormed) {
      if (!matches(e, m)) continue;
      if (best === null || specificity(e, m) > best.score) best = { i, score: specificity(e, m) };
    }
    if (best === null) add('M1-new-survivor', m.id, `new surviving mutant ${m.id} matches no known-survivors entry (all gates stayed GREEN): fix the gate gap or add a scoped, approved entry`);
    else credited.set(best.i, credited.get(best.i) + 1);
  }

  // M2 stale, M4 over-broad.
  for (const [e, i] of wellFormed) {
    const who = label(e, i);
    const matched = mutants.filter((m) => matches(e, m));
    if (credited.get(i) === 0) {
      add('M2-stale-entry', who, matched.length === 0
        ? `${who} matches no mutant at all: delete this entry`
        : `${who} is stale: all ${matched.length} mutant(s) it matches are now killed or credited to a more specific entry: delete this entry`);
      continue;
    }
    const killed = matched.filter((m) => m.killed);
    if (killed.length) add('M4-over-broad', who, `${who} also matches ${killed.length} KILLED mutant(s) of ${e.operator} (e.g. ${killed[0].id}): narrow the feature/adapter scope so it cannot hide a regression there`);
  }

  const order = (r) => RULES.indexOf(r);
  issues.sort((a, b) => order(a.rule) - order(b.rule) || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.msg < b.msg ? -1 : a.msg > b.msg ? 1 : 0));
  const credit = wellFormed.map(([e, i]) => ({ ...e, matchedSurvivors: credited.get(i) }));
  return { ok: issues.length === 0, issues, counts: { entries: entries.length, mutants: mutants.length, survivors: survivors.length, killed: mutants.length - survivors.length }, credit, now: day(now) };
}

/** Deterministic text report. */
export function formatSurvivorReport(r) {
  const out = [];
  out.push(`known survivors (clock ${r.now}): ${r.counts.survivors} surviving mutant(s), ${r.counts.entries} entr${r.counts.entries === 1 ? 'y' : 'ies'}`);
  for (const c of r.credit) out.push(`  ${c.operator} feature=${c.feature} adapter=${c.adapter} ${c.cluster}: ${c.matchedSurvivors} mutant(s)`);
  for (const i of r.issues) out.push(`  FAIL ${i.rule}  ${i.subject}: ${i.msg}`);
  out.push(r.ok ? 'known survivors: PASS' : `known survivors: FAIL (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`);
  return out.join('\n');
}
