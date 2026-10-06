#!/usr/bin/env node
/**
 * check-corpus-coverage — D3 corpus coverage gate (BLOCKING).
 *
 * A new schema capability cannot ship untested: every derived construct
 * (schema-constructs.deriveConstructs(), the same ids as the trait registry)
 * must be EXERCISED by at least one corpus spec, or carry a dated, approved
 * entry in _shared/policy/corpus-coverage-allowlist.yaml.
 *
 * What a spec exercises is found by walking it against the same schema walk set
 * that derives the constructs (schema-constructs.exercisedConstructs) — there is
 * no hand-kept list. The corpus is the same set ci.mjs runs: the schema examples
 * plus every .claude/artifacts/<name>/design-spec.yaml. Specs in a REFUSED
 * category (overlay, data-table — the refusal fixtures) never reach an adapter,
 * so they prove no lowering and do NOT count as coverage.
 *
 * Rules (each issue carries a stable id and names the construct):
 *   C0-load                 the allowlist or a corpus spec is missing/unparseable
 *   C1-uncovered            a derived construct is exercised by no corpus spec
 *                           and has no allowlist entry
 *   C2-stale-allowlist      an entry names no derived construct, OR names a
 *                           construct that IS now exercised (delete the entry)
 *   C3-allowlist-quality    reason missing/empty; approver missing or not exactly
 *                           APPROVER; expiry missing, invalid or past
 *   C4-duplicate            the same construct is listed twice
 *
 * Approver/expiry semantics are the D2 gate's, imported from
 * check-trait-registry.mjs (APPROVER, expiryState), which mirror loadWaivers() in
 * ledger-gate.mjs: expired when `new Date(expires) < now`, so an entry is already
 * past on its own expiry date. There is no whitelist beyond the allowlist file and
 * no bypass flag; the clock is an injectable function parameter, not a CLI option.
 * Output is deterministic (issues sort by rule order, then construct id).
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, parseDocument, isMap, isScalar } from 'yaml';
import { ROOT, corpusSpecPaths, deriveConstructs, exercisedConstructs } from './schema-constructs.mjs';
import { APPROVER, expiryState } from './check-trait-registry.mjs';
import { resolve } from 'node:path';

export const ALLOWLIST_PATH = resolve(ROOT, '_shared/policy/corpus-coverage-allowlist.yaml');
export const RULES = ['C0-load', 'C1-uncovered', 'C2-stale-allowlist', 'C3-allowlist-quality', 'C4-duplicate'];
/** Same refused categories ci.mjs expects to refuse: these specs never lower. */
export const REFUSED_CATEGORIES = new Set(['overlay', 'data-table']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const day = (d) => d.toISOString().slice(0, 10);

/** Parse the allowlist keeping duplicate keys. @returns {{ pairs: [string, any][], problem?: string }} */
function readAllowlist({ allowlistPath, allowlistText }) {
  let text = allowlistText;
  if (text === undefined) {
    try { text = readFileSync(allowlistPath, 'utf8'); }
    catch { return { pairs: [], problem: `corpus coverage allowlist not found at ${allowlistPath}` }; }
  }
  const doc = parseDocument(text, { uniqueKeys: false });
  if (doc.errors.length) return { pairs: [], problem: `corpus coverage allowlist is not valid YAML: ${doc.errors[0].message.split('\n')[0]}` };
  const root = doc.contents;
  if (!isMap(root) || !root.has('allowlist')) return { pairs: [], problem: 'corpus coverage allowlist has no `allowlist` key' };
  const map = root.get('allowlist', true);
  // A present-but-empty allowlist (`allowlist:` or `allowlist: {}`) is valid: it is the goal state.
  if (map === null || (isScalar(map) && map.value === null)) return { pairs: [] };
  if (!isMap(map)) return { pairs: [], problem: 'corpus coverage allowlist `allowlist` must be a mapping of construct id to entry' };
  return { pairs: map.items.map((p) => [isScalar(p.key) ? String(p.key.value) : String(p.key), p.value?.toJSON?.() ?? p.value]) };
}

/**
 * Which constructs the corpus exercises (refused-category specs excluded).
 * @returns {{ coverage: Map<string, string[]>, problems: string[] }} construct -> sorted spec names
 */
export function corpusCoverage(specPaths = corpusSpecPaths()) {
  const coverage = new Map();
  const problems = [];
  for (const p of specPaths) {
    const name = relative(ROOT, p);
    let doc;
    try { doc = parse(readFileSync(p, 'utf8')); }
    catch { problems.push(`corpus spec ${name} is missing or unparseable`); continue; }
    if (!isObj(doc) || !isObj(doc.root)) { problems.push(`corpus spec ${name} has no \`root\` element`); continue; }
    if (REFUSED_CATEGORIES.has(doc.category ?? 'display')) continue;
    for (const id of exercisedConstructs(doc)) {
      if (!coverage.has(id)) coverage.set(id, []);
      coverage.get(id).push(name);
    }
  }
  for (const v of coverage.values()) v.sort();
  return { coverage, problems };
}

/**
 * @param {object} [o]
 * @param {string} [o.allowlistPath]   allowlist file (default: the real one)
 * @param {string} [o.allowlistText]   allowlist YAML text (overrides the file; for fixtures)
 * @param {string[]} [o.constructs]    derived construct ids (default: live walker)
 * @param {string[]} [o.specPaths]     corpus spec files (default: the real corpus)
 * @param {Date} [o.now]               clock (default: now)
 */
export function checkCorpusCoverage({
  allowlistPath = ALLOWLIST_PATH,
  allowlistText,
  constructs = deriveConstructs(),
  specPaths = corpusSpecPaths(),
  now = new Date(),
} = {}) {
  const issues = [];
  const add = (rule, construct, msg) => issues.push({ rule, construct, msg });
  const derived = new Set(constructs);
  const { pairs, problem } = readAllowlist({ allowlistPath, allowlistText });
  const { coverage, problems } = corpusCoverage(specPaths);
  if (problem) add('C0-load', '(allowlist)', problem);
  for (const p of problems) add('C0-load', '(corpus)', p);
  if (specPaths.length === 0) add('C0-load', '(corpus)', 'no corpus specs found');

  const seen = new Map();
  for (const [id] of pairs) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) add('C4-duplicate', id, `construct "${id}" appears ${n} times in the allowlist`);

  // C1 — every derived construct is exercised or allowlisted.
  for (const c of constructs) if (!coverage.has(c) && !seen.has(c)) add('C1-uncovered', c, `derived construct "${c}" is exercised by no corpus spec and has no allowlist entry`);

  for (const [id, e] of pairs) {
    // C2 — stale entry: not a construct, or now exercised.
    if (!derived.has(id)) add('C2-stale-allowlist', id, `allowlist entry "${id}" names no derived construct`);
    else if (coverage.has(id)) add('C2-stale-allowlist', id, `allowlist entry "${id}" is stale: the construct is now exercised by ${coverage.get(id)[0]}${coverage.get(id).length > 1 ? ` (+${coverage.get(id).length - 1} more)` : ''}; delete the entry`);

    // C3 — entry quality.
    if (!isObj(e)) { add('C3-allowlist-quality', id, `allowlist entry "${id}" must be a mapping with reason, approver and expires`); continue; }
    if (!nonEmptyStr(e.reason)) add('C3-allowlist-quality', id, `allowlist entry "${id}" has a missing or empty reason`);
    if (e.approver === undefined || e.approver === null || e.approver === '') add('C3-allowlist-quality', id, `allowlist entry "${id}" is missing an approver`);
    else if (e.approver !== APPROVER) add('C3-allowlist-quality', id, `allowlist entry "${id}" approver ${JSON.stringify(e.approver)} is not exactly ${JSON.stringify(APPROVER)}`);
    const st = expiryState(e.expires, now);
    if (st === 'missing') add('C3-allowlist-quality', id, `allowlist entry "${id}" is missing an expiry (policy: no open-ended exemptions)`);
    else if (st === 'invalid') add('C3-allowlist-quality', id, `allowlist entry "${id}" has an unparseable expiry ${JSON.stringify(String(e.expires))}`);
    else if (st === 'past') add('C3-allowlist-quality', id, `allowlist entry "${id}" expired on ${String(e.expires instanceof Date ? day(e.expires) : e.expires)} (approver: ${e.approver ?? 'none'})`);
  }

  const order = (r) => RULES.indexOf(r);
  issues.sort((a, b) => order(a.rule) - order(b.rule) || (a.construct < b.construct ? -1 : a.construct > b.construct ? 1 : a.msg < b.msg ? -1 : a.msg > b.msg ? 1 : 0));
  const covered = constructs.filter((c) => coverage.has(c)).length;
  const allowlisted = constructs.filter((c) => !coverage.has(c) && seen.has(c)).length;
  return { ok: issues.length === 0, issues, counts: { constructs: constructs.length, covered, allowlisted, entries: pairs.length, specs: specPaths.length }, now: day(now), coverage };
}

/** Deterministic text report. */
export function formatCoverageReport(r) {
  const out = [];
  out.push(`corpus coverage gate (clock ${r.now}): ${r.counts.constructs} derived constructs, ${r.counts.covered} exercised by the corpus (${r.counts.specs} specs), ${r.counts.allowlisted} allowlisted, ${r.counts.entries} allowlist entries`);
  for (const i of r.issues) out.push(`  FAIL ${i.rule}  ${i.construct}: ${i.msg}`);
  out.push(r.ok ? 'corpus coverage gate: PASS' : `corpus coverage gate: FAIL (${r.issues.length} issue${r.issues.length === 1 ? '' : 's'})`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = checkCorpusCoverage();
  console.log(formatCoverageReport(r));
  process.exit(r.ok ? 0 : 1);
}
