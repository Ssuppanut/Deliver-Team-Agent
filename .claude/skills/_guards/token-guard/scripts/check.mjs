/**
 * token-guard (static + source tier)
 * 1. Every token the IR references must exist in the built registry.
 * 2. Generated WEB output (react/vue/svelte) must not contain raw hex colors
 *    or raw px values — those must come through token references.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(__dirname, '../../../../../_shared/tokens/registry.json');

const WEB_ADAPTERS = new Set(['react', 'vue', 'svelte']);
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_PX = /:\s*\d+px/;

export function checkTokens(ir, results) {
  const issues = [];
  let registry = {};
  try {
    registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  } catch {
    issues.push({ severity: 'critical', rule: 'registry-missing', msg: 'token registry not built; run tokens:build' });
    return { ok: false, issues };
  }
  for (const name of ir.tokens) {
    if (!(name in registry)) {
      issues.push({ severity: 'serious', rule: 'unknown-token', msg: `token not in registry: ${name}` });
    }
  }
  for (const [adapter, res] of Object.entries(results)) {
    if (!WEB_ADAPTERS.has(adapter) || !res?.code) continue;
    if (HEX.test(res.code)) {
      issues.push({ severity: 'serious', rule: 'hardcoded-color', msg: `${adapter}: raw hex color in output` });
    }
    if (RAW_PX.test(res.code)) {
      issues.push({ severity: 'moderate', rule: 'hardcoded-dimension', msg: `${adapter}: raw px value in output` });
    }
    for (const w of res.warnings ?? []) {
      if (w.startsWith('unmapped token')) {
        issues.push({ severity: 'moderate', rule: 'unmapped-token', msg: `${adapter}: ${w}` });
      }
    }
  }
  const blocking = issues.filter((i) => i.severity === 'serious' || i.severity === 'critical');
  return { ok: blocking.length === 0, issues };
}
