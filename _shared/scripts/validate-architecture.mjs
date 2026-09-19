#!/usr/bin/env node
/**
 * validate-architecture — cross-consistency of the role/agent + AI layer.
 * Keeps the manifests honest and wired: every reference resolves, every
 * "implemented" claim points at a real path, and the AI Router plans a route.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { route, loadContext } from '../../.ai/router/route.mjs';
import { runScenarios, lintWorkflow } from './workflow-eval.mjs';
import { collectDiskSkills, collectSurfaceSkills, capabilityRuntimeRefs, skillRegistryDrift } from './skill-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const y = (p) => parse(readFileSync(resolve(ROOT, p), 'utf8'));

let fail = 0;
const problems = [];
const bad = (m) => { problems.push(m); fail++; };
const has = (p) => existsSync(resolve(ROOT, p));

const skills = y('skills/INDEX.yaml');
const agentsDoc = y('agents/agents.yaml');
const artifactsDoc = y('artifacts/registry.yaml');
const workflow = y('workflows/ux-ui.workflow.yaml');
const ctx = loadContext();

const capIds = new Set();
const capById = new Map();
for (const [, list] of Object.entries(skills.domains)) {
  for (const c of list) { capIds.add(c.id); capById.set(c.id, c); }
}
const agentIds = new Set(agentsDoc.agents.map((a) => a.id));
const artifactIds = new Set(artifactsDoc.artifacts.map((a) => a.id));
const vocab = new Set(ctx.vocabulary);

// 1. implemented capabilities point at a real path
for (const c of capById.values()) {
  if (c.status === 'implemented') {
    if (!c.impl) bad(`capability ${c.id}: implemented but no impl path`);
    else if (!has(c.impl)) bad(`capability ${c.id}: impl path missing (${c.impl})`);
  }
}

// 2. capability.used_by references real agents
for (const c of capById.values()) {
  for (const a of c.used_by ?? []) if (!agentIds.has(a)) bad(`capability ${c.id}: used_by unknown agent "${a}"`);
}

// 3. agents reference real skills, artifacts, and vocab capabilities
for (const a of agentsDoc.agents) {
  for (const s of a.skills ?? []) if (!capIds.has(s)) bad(`agent ${a.id}: unknown skill "${s}"`);
  for (const o of a.owns ?? []) if (!artifactIds.has(o)) bad(`agent ${a.id}: owns unknown artifact "${o}"`);
  for (const cap of a.ai_capabilities ?? []) if (!vocab.has(cap)) bad(`agent ${a.id}: ai_capability "${cap}" not in model vocabulary`);
}

// 4. artifacts: owner is a real agent, inputs resolve, implemented schema exists
for (const art of artifactsDoc.artifacts) {
  if (!agentIds.has(art.owner)) bad(`artifact ${art.id}: unknown owner "${art.owner}"`);
  for (const i of art.inputs ?? []) if (!artifactIds.has(i)) bad(`artifact ${art.id}: unknown input "${i}"`);
  // Only static schema files are existence-checked; `generated` output paths
  // (e.g. out/) do not exist until the pipeline runs, and `planned` are future.
  if (art.schema?.status === 'implemented' && !has(art.schema.path)) bad(`artifact ${art.id}: implemented schema missing (${art.schema.path})`);
}

// 5. workflow stages reference real agents.
for (const st of workflow.stages) {
  if (!agentIds.has(st.agent)) bad(`workflow stage ${st.id}: unknown agent "${st.agent}"`);
}

// 5b. conditional-dependency discipline (structured consumes, reuse rules,
// producer/produced_by consistency) — shared with the workflow evaluator.
for (const p of lintWorkflow(workflow, { artifactIds, artifacts: artifactsDoc.artifacts })) bad(p);

// 5c. Skill-registry drift (P1.1): SKILLS_INDEX (runtime surface) and
// skills/INDEX (capability impls) must both agree with the on-disk SKILL.md set.
// Keyed on the runtime skill name. Allowlist: none.
const diskSkills = collectDiskSkills(ROOT);
const surfaceSkills = collectSurfaceSkills(y('SKILLS_INDEX.yaml'));
const capRefs = capabilityRuntimeRefs([...capById.values()]);
for (const p of skillRegistryDrift(surfaceSkills, diskSkills, capRefs)) bad(p);

// 6. every agent appears in at least one workflow stage
const stagedAgents = new Set(workflow.stages.map((s) => s.agent));
for (const a of agentIds) if (!stagedAgents.has(a)) bad(`agent ${a}: not referenced by any workflow stage`);

// 7. AI Router plans a route and never fabricates a selection when unconfigured
const plan = route({ capabilities: ['code'] }, ctx);
if (!['selected', 'needs_configuration', 'unavailable'].includes(plan.status)) bad(`router: invalid status "${plan.status}"`);
if (plan.status === 'selected' && !plan.selection) bad('router: selected without a selection');
if (plan.status !== 'selected' && plan.selection) bad('router: fabricated a selection while not selected');
if (!Array.isArray(plan.guardrails) || plan.guardrails.length === 0) bad('router: policy guardrails not surfaced in the plan');

// 8. conditional workflow scenarios (A-H) evaluate to their expected outcomes.
const scenarios = runScenarios(workflow);
for (const r of scenarios) if (!r.ok) bad(`workflow scenario ${r.id}: ${r.problems.join('; ')}`);

if (fail) {
  console.error(`validate-architecture: ${fail} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`validate-architecture: OK (${agentIds.size} agents, ${capIds.size} capabilities, ${artifactIds.size} artifacts, ${workflow.stages.length} stages, ${scenarios.length} scenarios, ${diskSkills.size} skills; router ${plan.status})`);
