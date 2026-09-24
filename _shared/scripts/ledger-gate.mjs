/**
 * ledger-gate — Layer 1 totality check (the Lowering Ledger).
 * ----------------------------------------------------------
 * Every adapter's generate pass emits a `ledger` of per-node trait entries
 * (see adapters/_shared/renderer-base.mjs). This gate reads that ledger — NOT
 * the generated source — and enforces totality:
 *
 *   status 'expressed'   -> PASS  (a real platform mechanism carried the trait)
 *   status 'diverged'    -> requires a matching, non-expired, approved waiver
 *   status 'unaccounted' -> FAIL  (the adapter neither expressed nor diverged it)
 *
 * WHY THIS IS NOT A WHITELIST: the `pending` set each node contributes is
 * derived from the IR (declaredTraits), so a brand-new role value or a11y field
 * enrols automatically. A trait nobody taught an adapter to handle surfaces as
 * `unaccounted` and fails here WITHOUT any edit to this gate. That is the whole
 * point of Layer 1: a silent drop is structurally impossible, not merely
 * detectable class-by-class.
 *
 * Waivers reuse the existing a11y-guard policy verbatim ("Only with an explicit
 * expiry date and an approver. No open-ended waivers.") — see
 * .claude/skills/_guards/a11y-guard/SKILL.md. The registry lives in
 * _shared/policy/a11y-waivers.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const WAIVER_FILE = resolve(ROOT, '_shared/policy/a11y-waivers.json');

/** Load the waiver registry once, tolerating an absent file (= no waivers). */
export function loadWaivers(now = new Date()) {
  let raw;
  try { raw = JSON.parse(readFileSync(WAIVER_FILE, 'utf8')); }
  catch { return { valid: new Map(), problems: ['waiver registry not found or unparseable at _shared/policy/a11y-waivers.json'] }; }
  const valid = new Map();
  const problems = [];
  for (const [id, w] of Object.entries(raw.waivers ?? {})) {
    // Policy: an explicit expiry date AND an approver, or the waiver is void.
    if (!w || !w.approver || !w.expires) {
      problems.push(`waiver "${id}" is missing an approver and/or expiry (policy: no open-ended waivers)`);
      continue;
    }
    const exp = new Date(w.expires);
    if (Number.isNaN(exp.getTime())) { problems.push(`waiver "${id}" has an unparseable expiry "${w.expires}"`); continue; }
    if (exp.getTime() < now.getTime()) { problems.push(`waiver "${id}" expired on ${w.expires} (approver: ${w.approver})`); continue; }
    valid.set(id, w);
  }
  return { valid, problems };
}

/**
 * @param {object[]} ledger  concatenation of every adapter's ledger entries
 * @returns {{ ok: boolean, issues: object[], summary: object }}
 */
export function checkLedger(ledger, { now = new Date() } = {}) {
  const issues = [];
  const { valid, problems } = loadWaivers(now);
  // A malformed / missing registry is only an error if some entry actually needs
  // a waiver; a fully-expressed run with no divergences must not be blocked by it.
  const needsWaiver = ledger.some((e) => e.status === 'diverged');
  if (needsWaiver) {
    for (const p of problems) issues.push({ severity: 'serious', rule: 'ledger-waiver', msg: p });
  }

  let expressed = 0, diverged = 0, unaccounted = 0;
  for (const e of ledger) {
    if (e.status === 'expressed') { expressed++; continue; }
    if (e.status === 'unaccounted') {
      unaccounted++;
      issues.push({ severity: 'critical', rule: 'ledger-unaccounted',
        msg: `${e.adapter}: component "${e.component}" (${e.kind}) drops trait \`${e.traitId}\` — neither expressed nor diverged (silent drop)` });
      continue;
    }
    if (e.status === 'diverged') {
      diverged++;
      const w = valid.get(e.waiver);
      if (!e.waiver) {
        issues.push({ severity: 'serious', rule: 'ledger-diverged',
          msg: `${e.adapter}: component "${e.component}" diverges on \`${e.traitId}\` with no waiver id (a divergence must cite a waiver)` });
      } else if (!w) {
        issues.push({ severity: 'serious', rule: 'ledger-diverged',
          msg: `${e.adapter}: component "${e.component}" diverges on \`${e.traitId}\` under waiver "${e.waiver}", which is missing, expired, or unapproved` });
      }
    }
  }
  const critical = issues.some((i) => i.severity === 'critical' || i.severity === 'serious');
  return { ok: !critical, issues, summary: { expressed, diverged, unaccounted, entries: ledger.length } };
}
