#!/usr/bin/env node
/**
 * validate-schema
 * ---------------
 * Validate a YAML document against a JSON Schema (also authored in YAML).
 * Usage:
 *   node _shared/scripts/validate-schema.mjs <doc.yaml> [schema.yaml]
 * If schema is omitted, defaults to the design-spec schema.
 * Exported `validate()` is reused by the pipeline.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = resolve(__dirname, '../schemas/design-spec.schema.yaml');

/** True if `id` is an IANA timezone the runtime accepts. Construction-based
 *  (not Intl.supportedValuesOf, which is ICU-version-dependent — e.g. it lists
 *  Asia/Calcutta but not Asia/Kolkata on some builds). Accepts canonical ids and
 *  aliases alike, matching the shared IANA database used by web/Swift/Java. */
function isValidTimeZone(id) {
  if (typeof id !== 'string' || !id) return false;
  try { new Intl.DateTimeFormat(undefined, { timeZone: id }); return true; } catch { return false; }
}

/** F-27: reject an invalid LITERAL IANA timezone before generation. A prop-ref
 *  timeZone (runtime) is not checked here — it falls back to the device timezone
 *  at runtime on every adapter. Returns ajv-shaped error objects. */
function checkTimeZones(node, path = '/root') {
  if (!node || typeof node !== 'object') return [];
  const errors = [];
  for (const field of ['text', 'label']) {
    const v = node[field];
    const tz = v && v.kind === 'datetime' ? v.dateFormat?.timeZone : undefined;
    // Only a bare-string literal is checked; a { kind: ref } object is runtime.
    if (typeof tz === 'string' && !isValidTimeZone(tz)) {
      errors.push({ instancePath: `${path}/${field}/dateFormat/timeZone`, message: `invalid IANA timezone id "${tz}" (use a valid id such as Asia/Bangkok; a display name like GMT+7 is not supported)` });
    }
  }
  for (const [i, c] of (node.children ?? []).entries()) errors.push(...checkTimeZones(c, `${path}/children/${i}`));
  for (const b of ['then', 'else']) if (node[b]) errors.push(...checkTimeZones(node[b], `${path}/${b}`));
  return errors;
}

export function validate(doc, schemaPath = DEFAULT_SCHEMA) {
  const schema = parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const fn = ajv.compile(schema);
  const ok = fn(doc);
  const errors = fn.errors ?? [];
  // Semantic pass (only when the document is structurally valid): F-27 literal
  // timezone validity, which JSON Schema cannot express (version-dependent set).
  if (ok && doc?.root) {
    const tzErrors = checkTimeZones(doc.root);
    if (tzErrors.length) return { ok: false, errors: tzErrors };
  }
  return { ok, errors };
}

export function loadSpec(path) {
  return parse(readFileSync(path, 'utf8'));
}

function formatErrors(errors) {
  return errors
    .map((e) => `  ${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`)
    .join('\n');
}

function main() {
  const [docPath, schemaPath] = process.argv.slice(2);
  if (!docPath) {
    console.error('usage: validate-schema.mjs <doc.yaml> [schema.yaml]');
    process.exit(2);
  }
  const doc = loadSpec(docPath);
  const { ok, errors } = validate(doc, schemaPath || DEFAULT_SCHEMA);
  if (ok) {
    console.log(`valid: ${docPath}`);
  } else {
    console.error(`INVALID: ${docPath}\n${formatErrors(errors)}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
