#!/usr/bin/env node
/**
 * workflow-eval — deterministic evaluator for the conditional UX/UI workflow.
 *
 * Given a set of context flags and the artifacts a project already supplies, it
 * computes which stages run, which are skipped, which artifacts become
 * available, and whether any RUNNING stage is blocked by a missing REQUIRED
 * artifact. Skipping a stage is a valid outcome — only a running stage that
 * lacks a required, unavailable artifact is a block.
 *
 * Pure functions (`evaluateWorkflow`, `evalExpr`) are unit-testable; the CLI runs
 * the workflow's declared scenarios.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

export function loadWorkflow(path = 'workflows/ux-ui.workflow.yaml') {
  return parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

// --- tiny boolean-expression evaluator over flags (no eval) ----------------
// grammar: or > and > not > primary; primary = (expr) | ident | always/true/false
function tokenize(s) {
  return s.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
}
export function evalExpr(expr, flags) {
  if (!expr || expr === 'always' || expr === 'true') return true;
  if (expr === 'false') return false;
  const toks = tokenize(expr);
  let i = 0;
  const peek = () => toks[i];
  const eat = (t) => { if (toks[i] !== t) throw new Error(`expected "${t}" in "${expr}"`); i++; };
  function primary() {
    if (peek() === '(') { eat('('); const v = orE(); eat(')'); return v; }
    const t = toks[i++];
    if (t === 'always' || t === 'true') return true;
    if (t === 'false') return false;
    return Boolean(flags[t]);   // unknown flag defaults to false
  }
  function notE() { if (peek() === 'not') { i++; return !notE(); } return primary(); }
  function andE() { let v = notE(); while (peek() === 'and') { i++; v = notE() && v; } return v; }
  function orE() { let v = andE(); while (peek() === 'or') { i++; v = andE() || v; } return v; }
  const out = orE();
  if (i !== toks.length) throw new Error(`trailing tokens in "${expr}"`);
  return out;
}

export const normConsumes = (stage) =>
  (stage.consumes ?? []).map((c) => (typeof c === 'string' ? { artifact: c, required: true, reuse: false } : { required: true, reuse: false, ...c }));

/**
 * @param {object} workflow
 * @param {{ flags?: object, existing?: string[] }} ctx
 */
export function evaluateWorkflow(workflow, { flags = {}, existing = [] } = {}) {
  const available = new Set(existing);
  const runs = [], skipped = [], blocked = [];
  for (const stage of workflow.stages) {
    if (!evalExpr(stage.run_if ?? 'always', flags)) { skipped.push(stage.id); continue; }
    const missing = normConsumes(stage).filter((c) => c.required && !available.has(c.artifact));
    if (missing.length) {
      blocked.push({ stage: stage.id, missing: missing.map((m) => m.artifact) });
      continue; // a blocked stage does not produce its outputs
    }
    runs.push(stage.id);
    for (const p of stage.produces ?? []) available.add(p);
  }
  return { runs, skipped, blocked, available: [...available] };
}

/** Run one declared scenario and return { id, ok, detail }. */
export function checkScenario(workflow, sc) {
  const res = evaluateWorkflow(workflow, { flags: sc.flags ?? {}, existing: sc.existing ?? [] });
  const problems = [];
  const exp = sc.expect ?? {};
  for (const s of exp.runs ?? []) if (!res.runs.includes(s)) problems.push(`expected "${s}" to run`);
  for (const s of exp.skipped ?? []) if (!res.skipped.includes(s)) problems.push(`expected "${s}" to be skipped`);
  const isBlocked = res.blocked.length > 0;
  if (exp.blocked === true && !isBlocked) problems.push('expected a block, got none');
  if (exp.blocked === false && isBlocked) problems.push(`unexpected block: ${JSON.stringify(res.blocked)}`);
  if (exp.blocked_artifact && !res.blocked.some((b) => b.missing.includes(exp.blocked_artifact)))
    problems.push(`expected block on "${exp.blocked_artifact}"`);
  return { id: sc.id, ok: problems.length === 0, problems, res };
}

export function runScenarios(workflow) {
  return (workflow.scenarios ?? []).map((sc) => checkScenario(workflow, sc));
}

/**
 * Static lint of the conditional-dependency discipline (does NOT reject valid
 * conditional workflows — see the rules inline). Pure; returns problem strings.
 * @param {object} workflow
 * @param {{ artifactIds?: Set<string>, artifacts?: object[] }} reg
 */
export function lintWorkflow(workflow, { artifactIds = null, artifacts = [] } = {}) {
  const problems = [];
  const producers = new Map();
  for (const st of workflow.stages) for (const p of st.produces ?? []) {
    if (!producers.has(p)) producers.set(p, []);
    producers.get(p).push(st.id);
  }
  const stageById = new Map(workflow.stages.map((s) => [s.id, s]));
  const skippable = (id) => (stageById.get(id)?.run_if ?? 'always') !== 'always';
  const known = (id) => !artifactIds || artifactIds.has(id);

  for (const st of workflow.stages) {
    for (const p of st.produces ?? []) if (!known(p)) problems.push(`stage ${st.id}: unknown produced artifact "${p}"`);
    for (const c of normConsumes(st)) {
      if (!known(c.artifact)) { problems.push(`stage ${st.id}: unknown consumed artifact "${c.artifact}"`); continue; }
      if (!c.required) continue;                       // optional consume: always valid
      const prod = producers.get(c.artifact) ?? [];
      if (!prod.length) {                              // R4: no producer -> must be external (reuse)
        if (!c.reuse) problems.push(`stage ${st.id}: requires "${c.artifact}" but no stage produces it and it is not marked reuse/external`);
        continue;
      }
      if (!c.reuse && prod.every((pid) => skippable(pid)))  // R1: required non-reuse whose producers can all be skipped
        problems.push(`stage ${st.id}: requires "${c.artifact}" (non-reuse) but producer(s) [${prod.join(',')}] can be skipped — mark required:false or reuse:true`);
    }
  }
  // registry produced_by consistency (when declared)
  for (const art of artifacts) {
    const pb = art.produced_by;
    if (!pb || pb === 'external' || pb === 'orchestrator-state') continue;
    const prod = producers.get(art.id) ?? [];
    if (!prod.includes(pb)) problems.push(`artifact ${art.id}: produced_by "${pb}" does not match workflow producer(s) [${prod.join(',') || 'none'}]`);
  }
  return problems;
}

function main() {
  const wf = loadWorkflow();
  const results = runScenarios(wf);
  let fail = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  runs=[${r.res.runs.join(',')}]${r.res.blocked.length ? ` blocked=${JSON.stringify(r.res.blocked)}` : ''}`);
    if (!r.ok) { fail++; r.problems.forEach((p) => console.log(`         - ${p}`)); }
  }
  console.log(`\nworkflow scenarios: ${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
