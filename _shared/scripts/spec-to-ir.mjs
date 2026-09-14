#!/usr/bin/env node
/**
 * spec-to-ir
 * ----------
 * Normalize a validated design spec (YAML) into an Intermediate
 * Representation (JSON tree) that adapters consume via the visitor pattern.
 *
 * The IR:
 *   - classifies every element into one of 8 kinds
 *   - resolves each value into { kind: literal|ref|expr, value }
 *   - lifts iteration (`each`) and conditionals (`when`) onto the node
 *   - collects the flat set of tokens referenced across the tree
 *
 * Usage:
 *   node _shared/scripts/spec-to-ir.mjs <spec.yaml>       # prints IR JSON
 * Exported `specToIr()` is reused by the pipeline.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validate } from './validate-schema.mjs';

const ELEMENT_KINDS = new Set([
  'container', 'media', 'heading', 'text', 'action', 'link', 'input', 'slot',
]);

/** Normalize a value reference into canonical { kind, value }. */
function normValue(v) {
  if (v == null) return null;
  if (typeof v === 'object' && 'kind' in v) return { kind: v.kind, value: v.value };
  return { kind: 'literal', value: v };
}

function visit(node, tokens) {
  if (!ELEMENT_KINDS.has(node.el)) {
    throw new Error(`Unknown element kind: ${node.el}`);
  }
  const ir = { kind: node.el };

  if (node.role) ir.role = node.role;
  if (node.as) ir.as = node.as;
  if (node.id) ir.id = node.id;
  if (node.level) ir.level = node.level;
  if (node.icon) { ir.icon = node.icon; tokens.add(node.icon); }

  for (const field of ['text', 'src', 'alt', 'href', 'label']) {
    if (node[field] != null) ir[field] = normValue(node[field]);
  }

  if (node.a11y) {
    ir.a11y = { ...node.a11y };
    if (node.a11y.label) ir.a11y.label = normValue(node.a11y.label);
  }

  if (node.style) {
    ir.style = { ...node.style };
    for (const token of Object.values(node.style)) tokens.add(token);
  }

  if (node.variant) {
    ir.variant = node.variant;
    for (const table of Object.values(node.variant.cases)) {
      for (const token of Object.values(table)) {
        // Only collect entries that look like token paths (contain a dot).
        if (typeof token === 'string' && token.includes('.')) tokens.add(token);
      }
    }
  }

  if (node.input) ir.input = { inputType: 'text', ...node.input };
  if (node.onEvent) ir.onEvent = node.onEvent;
  if (node.when) ir.when = node.when;
  if (node.each) ir.each = { key: 'id', ...node.each };

  if (node.children) {
    ir.children = node.children.map((c) => visit(c, tokens));
  }
  return ir;
}

export function specToIr(spec) {
  const { ok, errors } = validate(spec);
  if (!ok) {
    const msg = errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new Error(`spec failed schema validation: ${msg}`);
  }
  const tokens = new Set(spec.tokens ?? []);
  const root = visit(spec.root, tokens);
  return {
    component: spec.component,
    description: spec.description ?? '',
    category: spec.category ?? 'display',
    props: spec.props ?? [],
    tokens: [...tokens].sort(),
    root,
  };
}

export function specToIrFromFile(path) {
  return specToIr(loadSpec(path));
}

function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    console.error('usage: spec-to-ir.mjs <spec.yaml>');
    process.exit(2);
  }
  const ir = specToIrFromFile(path);
  console.log(JSON.stringify(ir, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
