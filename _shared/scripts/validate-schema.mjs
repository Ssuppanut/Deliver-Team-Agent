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

export function validate(doc, schemaPath = DEFAULT_SCHEMA) {
  const schema = parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const fn = ajv.compile(schema);
  const ok = fn(doc);
  return { ok, errors: fn.errors ?? [] };
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
