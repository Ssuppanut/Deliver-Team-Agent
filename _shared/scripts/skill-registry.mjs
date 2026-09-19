/**
 * skill-registry — drift detection between the two skill registries (P1.1),
 * keyed on the runtime skill NAME (the on-disk SKILL.md folder), the shared
 * identity both registries must agree with.
 *
 *   SKILLS_INDEX.yaml  = the Claude-runtime surface (skills by `name`)
 *   skills/INDEX.yaml   = the capability catalogue (capabilities bridge in via
 *                         `impl` paths that reference a .claude/skills runtime skill)
 *   on-disk SKILL.md    = ground truth
 *
 * Allowlist: none — SKILLS_INDEX must list exactly the on-disk skills. If a
 * legitimate exception ever arises, add it to `allow` with a comment, never a
 * silent skip.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

/** Set of skill names = folders directly containing a SKILL.md under the roots. */
export function collectDiskSkills(root, rels = ['.claude/skills', 'adapters']) {
  const out = new Set();
  const walk = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(abs, e.name));
      else if (e.name === 'SKILL.md') out.add(basename(abs));
    }
  };
  for (const rel of rels) { const abs = resolve(root, rel); if (existsSync(abs)) walk(abs); }
  return out;
}

/** Runtime skill names declared in SKILLS_INDEX.yaml (layers.*.skills[].name). */
export function collectSurfaceSkills(skillsIndexDoc) {
  const out = new Set();
  for (const layer of Object.values(skillsIndexDoc.layers ?? {}))
    for (const s of layer.skills ?? []) if (s.name) out.add(s.name);
  return out;
}

/** [capId, runtimeSkillName] for capabilities whose impl references a .claude/skills skill. */
export function capabilityRuntimeRefs(capabilities) {
  const refs = [];
  for (const c of capabilities) {
    const m = c.status === 'implemented' && c.impl && c.impl.match(/\.claude\/skills\/[^/]+\/([^/]+)\//);
    if (m) refs.push([c.id, m[1]]);
  }
  return refs;
}

/**
 * Pure drift check. Reports BOTH directions plus dangling capability refs.
 * @returns {string[]} problems
 */
export function skillRegistryDrift(surface, diskSkills, capRefs = [], allow = new Set()) {
  const problems = [];
  for (const n of surface)
    if (!diskSkills.has(n) && !allow.has(n)) problems.push(`skill drift: SKILLS_INDEX.yaml lists "${n}" but no SKILL.md exists on disk`);
  for (const n of diskSkills)
    if (!surface.has(n) && !allow.has(n)) problems.push(`skill drift: "${n}" has a SKILL.md on disk but is missing from SKILLS_INDEX.yaml`);
  for (const [cap, name] of capRefs)
    if (!diskSkills.has(name)) problems.push(`skill drift: capability ${cap} impl references runtime skill "${name}" not present on disk`);
  return problems;
}
