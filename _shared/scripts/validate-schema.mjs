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

/**
 * True if `id` is an IANA timezone a LITERAL may use — the cross-platform-safe
 * subset that resolves identically on web (ICU), Swift (Foundation) and Java
 * (java.time). ICU is lenient (case-insensitive, accepts offset ids); Swift
 * `TimeZone(identifier:)` and Java `ZoneId.of()` are case-SENSITIVE and reject
 * offset forms ICU accepts. A literal that ICU normalized but a native platform
 * rejected would silently degrade to the device zone — a parity break — so the
 * literal rule is tightened to what all three accept:
 *   1. exact `UTC`, or a Region/City path with at least one `/`
 *      (rejects offset ids like `+07:00`/`-0500` and bare words like `Z`/`GMT`);
 *   2. constructs under ICU (a real IANA id); and
 *   3. is case-EXACT — a pure case-variant (ICU-normalized) is rejected, while a
 *      genuine alias (Asia/Kolkata → Asia/Calcutta, differs beyond case) stays
 *      valid. Not `Intl.supportedValuesOf`, which is ICU-version-dependent (it
 *      lists Asia/Calcutta but not Asia/Kolkata on this build).
 * A runtime prop-ref is NOT bound by this — it falls back to the device zone.
 */
function isValidTimeZone(id) {
  if (typeof id !== 'string' || !id) return false;
  if (id !== 'UTC' && !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/.test(id)) return false;
  let resolved;
  try { resolved = new Intl.DateTimeFormat(undefined, { timeZone: id }).resolvedOptions().timeZone; }
  catch { return false; }
  if (resolved !== id && resolved.toLowerCase() === id.toLowerCase()) return false; // pure case-variant
  return true;
}

/** F-27: reject an invalid LITERAL IANA timezone before generation. A prop-ref
 *  timeZone (runtime) is not checked here — it falls back to the device timezone
 *  at runtime on every adapter. Returns ajv-shaped error objects. */
export function checkTimeZones(node, path = '/root') {
  if (!node || typeof node !== 'object') return [];
  const errors = [];
  for (const field of ['text', 'label']) {
    const v = node[field];
    const tz = v && v.kind === 'datetime' ? v.dateFormat?.timeZone : undefined;
    // Only a bare-string literal is checked; a { kind: ref } object is runtime.
    if (typeof tz === 'string' && !isValidTimeZone(tz)) {
      errors.push({ instancePath: `${path}/${field}/dateFormat/timeZone`, message: `invalid IANA timezone id "${tz}" — use the exact-case Region/City form (e.g. Asia/Bangkok) or UTC. Case variants (asia/bangkok), UTC offsets (+07:00, -0500) and display names (GMT+7) are rejected because Swift/Java would not resolve them identically.` });
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
