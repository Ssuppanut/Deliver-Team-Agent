#!/usr/bin/env node
/**
 * tokens-dtcg build
 * -----------------
 * Reads DTCG token sources (core -> semantic -> icons), resolves {alias}
 * references into a flat registry, then emits platform outputs:
 *   - registry.json        canonical resolved registry (source of truth for guards)
 *   - tokens.css           CSS custom properties
 *   - tailwind-theme.js    Tailwind theme.extend fragment
 *   - tokens.d.ts          TypeScript token-name union + typed accessor
 *   - DesignTokens.swift   Swift enum/extension
 *   - DesignTokens.kt      Kotlin object of vals
 *   - tokens-rn.ts         React Native JS token object
 *
 * No external dependencies: pure Node.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SRC = resolve(ROOT, '_shared/tokens/source');
const OUT = resolve(ROOT, '_shared/tokens');

const SOURCES = ['core.tokens.json', 'semantic.tokens.json', 'icons.tokens.json'];

/** Walk a DTCG tree, collecting leaf tokens keyed by dot-path. */
function flatten(node, path, type, acc) {
  const nodeType = node.$type ?? type;
  if (node && typeof node === 'object' && '$value' in node) {
    acc[path] = {
      value: node.$value,
      type: node.$type ?? type,
      ext: node.$extensions ?? null,
    };
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (child && typeof child === 'object') {
      flatten(child, path ? `${path}.${key}` : key, nodeType, acc);
    }
  }
}

const ALIAS = /^\{([^}]+)\}$/;
const ALIAS_FRAGMENT = /\{[^{}]*\}/;

/**
 * Resolve {a.b.c} alias chains to concrete values.
 *
 * resolveOne(name) ALWAYS returns the resolved VALUE of the token (a string/number, or the
 * composite value for a composite type), never the token record. A chain of any depth
 * (semantic -> semantic -> core) therefore collapses to the end value, and aliases nested inside a
 * composite value (`{ color: "{color.x}" }`, arrays) are resolved in place. A cycle, a self
 * reference, an unknown target, an alias to a token of a different DTCG type and a half-resolved
 * alias fragment each throw an error that names the tokens involved.
 */
export function resolveAliases(raw) {
  const resolved = {};
  // `top` is true for a token's whole value: only there must the alias target have the token's own
  // type (an alias nested inside a composite value, e.g. a shadow colour, targets another type).
  const resolveValue = (value, owner, stack, top = false) => {
    if (typeof value === 'string') {
      const m = value.match(ALIAS);
      if (m) return resolveRef(m[1], owner, stack, top);
      if (ALIAS_FRAGMENT.test(value)) {
        throw new Error(`Unresolvable alias fragment in token ${owner}: ${JSON.stringify(value)} (an alias must be the whole value, e.g. "{core.token}")`);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => resolveValue(v, owner, stack));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, owner, stack)]));
    }
    return value;
  };
  const resolveRef = (target, owner, stack, top) => {
    const value = resolveOne(target, stack);
    const from = raw[owner], to = raw[target];
    if (top && from.type && to.type && from.type !== to.type) {
      throw new Error(`Alias type mismatch: ${owner} (${from.type}) -> {${target}} (${to.type})`);
    }
    return value;
  };
  const resolveOne = (name, stack = []) => {
    if (name in resolved) return resolved[name].value;
    if (stack.includes(name)) {
      throw new Error(`Circular token reference: ${[...stack, name].join(' -> ')}`);
    }
    const token = raw[name];
    if (!token) {
      throw new Error(`Unknown token referenced: {${name}}${stack.length ? ` (from ${stack[stack.length - 1]})` : ''}`);
    }
    const value = resolveValue(token.value, name, [...stack, name], true);
    resolved[name] = { ...token, value };
    return value;
  };
  for (const name of Object.keys(raw)) resolveOne(name);
  return resolved;
}

/** Read the DTCG sources from disk: { 'core.tokens.json': text, ... } in SOURCES order. */
export function readSources(srcDir = SRC) {
  return Object.fromEntries(SOURCES.map((file) => [file, readFileSync(resolve(srcDir, file), 'utf8')]));
}

function loadAll(sources) {
  const raw = {};
  for (const file of SOURCES) {
    flatten(JSON.parse(sources[file]), '', undefined, raw);
  }
  return resolveAliases(raw);
}

// Every platform output below is a scalar format (a CSS declaration, a Kotlin/Swift initialiser, a
// JS number/string). A value that is not a finite number or a non-empty string cannot be written
// there: it would print as `[object Object]` / `undefined` / `NaN`, or be silently coerced to 0.
// Fail the build instead, naming the token.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PX_DIMENSION = /^(-?(?:\d+\.?\d*|\.\d+))px$/;

function assertScalar(name, t) {
  const v = t.value;
  const ok = (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v));
  if (!ok) {
    const shown = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    throw new Error(`Token ${name} (type ${t.type}) resolved to a non-scalar or empty value ${shown}; the platform outputs are scalar formats (composite token types have no emitter)`);
  }
}

/** #RRGGBB or #RRGGBBAA, lower or upper case; returns the hex digits without '#'. */
function hexDigits(name, t) {
  assertScalar(name, t);
  if (typeof t.value !== 'string' || !HEX_COLOR.test(t.value)) {
    throw new Error(`Token ${name} (color) has value ${JSON.stringify(t.value)}, expected #RRGGBB or #RRGGBBAA`);
  }
  return t.value.slice(1);
}

/** "16px" -> 16. Anything else (rem, %, a bare word, an unparseable string) is an error, never 0. */
function dimensionPx(name, t) {
  assertScalar(name, t);
  const m = typeof t.value === 'string' ? t.value.match(PX_DIMENSION) : null;
  if (!m) throw new Error(`Token ${name} (dimension) has value ${JSON.stringify(t.value)}, expected a px length such as "16px"`);
  return parseFloat(m[1]);
}

/** Platform icon name: the per-platform extension, else the token value; always a non-empty string. */
function iconName(name, t, key) {
  const v = t.ext?.[key] ?? t.value;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`Token ${name} (icon) has no usable ${key} name (got ${JSON.stringify(v ?? null)})`);
  }
  return v;
}

function validateRegistry(reg) {
  for (const [name, t] of Object.entries(reg)) {
    if (t.type === 'color') hexDigits(name, t);
    else if (t.type === 'dimension') dimensionPx(name, t);
    else if (t.type === 'icon') { iconName(name, t, 'sfSymbol'); iconName(name, t, 'material'); }
    else assertScalar(name, t);
  }
}

const cssVar = (name) => `--${name.replace(/\./g, '-')}`;
const isColor = (t) => t.type === 'color';
const isDimension = (t) => t.type === 'dimension';

function emitCss(reg) {
  const lines = [':root {'];
  for (const [name, t] of Object.entries(reg)) {
    if (t.type === 'icon') continue;
    lines.push(`  ${cssVar(name)}: ${t.value};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function emitTailwind(reg) {
  const colors = {}, spacing = {}, radius = {}, fontSize = {};
  const setPath = (obj, path, val) => {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ??= {});
    cur[parts[parts.length - 1]] = val;
  };
  for (const [name, t] of Object.entries(reg)) {
    if (name.startsWith('color.')) setPath(colors, name.slice(6), `var(${cssVar(name)})`);
    else if (name.startsWith('space.')) spacing[name.slice(6).replace(/\./g, '-')] = `var(${cssVar(name)})`;
    else if (name.startsWith('radius.')) radius[name.slice(7).replace(/\./g, '-')] = `var(${cssVar(name)})`;
    else if (name.startsWith('font.size.')) fontSize[name.slice(10)] = `var(${cssVar(name)})`;
  }
  const theme = { colors, spacing, borderRadius: radius, fontSize };
  return `/** Generated by tokens-dtcg. Do not edit. */\nexport default ${JSON.stringify(theme, null, 2)};\n`;
}

function emitDts(reg) {
  const names = Object.keys(reg).filter((n) => reg[n].type !== 'icon');
  const union = names.map((n) => `  | '${n}'`).join('\n');
  return `/** Generated by tokens-dtcg. Do not edit. */\nexport type TokenName =\n${union};\n\n`
    + `export const tokens: Record<TokenName, string> = {\n`
    + names.map((n) => `  '${n}': 'var(${cssVar(n)})',`).join('\n')
    + `\n};\n\nexport const token = (name: TokenName): string => tokens[name];\n`;
}

const pascal = (s) => s.replace(/(^|[.\-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase());

function emitSwift(reg) {
  const lines = [
    '// Generated by tokens-dtcg. Do not edit.',
    'import SwiftUI',
    '',
    'public enum DesignTokens {',
  ];
  for (const [name, t] of Object.entries(reg)) {
    if (t.type === 'icon') {
      lines.push(`    public static let ${pascal(name.replace('icon.', 'icon.'))}Symbol = "${iconName(name, t, 'sfSymbol')}"`);
    } else if (isColor(t)) {
      lines.push(`    public static let ${pascal(name)} = Color(hex: "${hexDigits(name, t)}")`);
    } else if (isDimension(t)) {
      lines.push(`    public static let ${pascal(name)}: CGFloat = ${dimensionPx(name, t)}`);
    }
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function emitKotlin(reg) {
  const lines = [
    '// Generated by tokens-dtcg. Do not edit.',
    'package designtokens',
    '',
    'import androidx.compose.ui.graphics.Color',
    'import androidx.compose.ui.unit.dp',
    '',
    'object DesignTokens {',
  ];
  for (const [name, t] of Object.entries(reg)) {
    const id = pascal(name);
    if (t.type === 'icon') {
      lines.push(`    const val ${id}Icon = "${iconName(name, t, 'material')}"`);
    } else if (isColor(t)) {
      // #RRGGBB -> 0xFFRRGGBB (opaque); #RRGGBBAA -> 0xAARRGGBB (Compose Color takes ARGB).
      const hex = hexDigits(name, t).toUpperCase();
      const argb = hex.length === 8 ? hex.slice(6) + hex.slice(0, 6) : `FF${hex}`;
      lines.push(`    val ${id} = Color(0x${argb})`);
    } else if (isDimension(t)) {
      lines.push(`    val ${id} = ${dimensionPx(name, t)}.dp`);
    }
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function emitRn(reg) {
  const obj = {};
  const setPath = (path, val) => {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ??= {});
    cur[parts[parts.length - 1]] = val;
  };
  for (const [name, t] of Object.entries(reg)) {
    if (t.type === 'icon') continue;
    const val = isDimension(t) ? dimensionPx(name, t) : t.value;
    setPath(name, val);
  }
  return `/** Generated by tokens-dtcg. Do not edit. */\nexport const tokens = ${JSON.stringify(obj, null, 2)} as const;\n`;
}

/**
 * Build every platform output in memory: { 'registry.json': text, ... }. Pure: no filesystem writes.
 * @param {{ sources?: Record<string,string> }} [o] DTCG source texts keyed by SOURCES file name
 *   (default: read from _shared/tokens/source)
 */
export function buildOutputs({ sources = readSources() } = {}) {
  const reg = loadAll(sources);
  validateRegistry(reg);

  const registryOut = {};
  for (const [name, t] of Object.entries(reg)) {
    registryOut[name] = { value: t.value, type: t.type, ...(t.ext ? { extensions: t.ext } : {}) };
  }

  return {
    count: Object.keys(reg).length,
    files: {
      'registry.json': JSON.stringify(registryOut, null, 2) + '\n',
      'tokens.css': emitCss(reg),
      'tailwind-theme.js': emitTailwind(reg),
      'tokens.d.ts': emitDts(reg),
      'DesignTokens.swift': emitSwift(reg),
      'DesignTokens.kt': emitKotlin(reg),
      'tokens-rn.ts': emitRn(reg),
    },
  };
}

/** Names of the files buildOutputs() produces, in write order. */
export const OUTPUT_FILES = ['registry.json', 'tokens.css', 'tailwind-theme.js', 'tokens.d.ts', 'DesignTokens.swift', 'DesignTokens.kt', 'tokens-rn.ts'];
export const OUTPUT_DIR = OUT;

function main() {
  const { count, files } = buildOutputs();
  mkdirSync(OUT, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(resolve(OUT, file), content);
  }
  console.log(`tokens-dtcg: resolved ${count} tokens -> ${Object.keys(files).length} platform outputs`);
  for (const file of Object.keys(files)) console.log(`  _shared/tokens/${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
