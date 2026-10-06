#!/usr/bin/env node
/**
 * validate-brief
 * --------------
 * Validate every component brief (.claude/artifacts/<feature>/brief.yaml) and
 * the brief template against _shared/schemas/brief.schema.yaml.
 *
 * A distinct entry point rather than an extension of validate-schema.mjs:
 * validate-schema is specialized to the design-spec (it defaults to the
 * design-spec schema and runs root-based semantic passes, e.g. the F-27 literal
 * timezone check keyed on `doc.root`). A brief is a different document type with
 * no `root`, so it reuses only validate-schema's AJV core via
 * `validate(doc, schemaPath)` and points it at the brief schema.
 */
import { readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, loadSpec } from './validate-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const BRIEF_SCHEMA = resolve(ROOT, '_shared/schemas/brief.schema.yaml');

/** All brief files to validate: every artifact brief + the template. */
export function briefTargets() {
  const targets = [];
  const artDir = resolve(ROOT, '.claude/artifacts');
  if (existsSync(artDir)) {
    for (const d of readdirSync(artDir).sort()) {
      const p = resolve(artDir, d, 'brief.yaml');
      if (existsSync(p)) targets.push(p);
    }
  }
  const tpl = resolve(ROOT, '_shared/templates/brief.template.yaml');
  if (existsSync(tpl)) targets.push(tpl);
  return targets;
}

/** Validate each target against the brief schema. Returns one row per file. */
export function validateBriefs() {
  return briefTargets().map((p) => {
    const { ok, errors } = validate(loadSpec(p), BRIEF_SCHEMA);
    return { path: p.replace(ROOT + '/', ''), ok, errors };
  });
}

function main() {
  const results = validateBriefs();
  let fail = 0;
  for (const r of results) {
    if (r.ok) { console.log(`  valid: ${r.path}`); continue; }
    fail++;
    console.error(`  INVALID: ${r.path}`);
    for (const e of r.errors) console.error(`    ${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`);
  }
  console.log(`\nvalidate-brief: ${results.length - fail}/${results.length} valid`);
  if (fail) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
