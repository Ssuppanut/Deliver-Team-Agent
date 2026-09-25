/**
 * token-guard (static + source tier)
 * 1. Every token the IR references must exist in the built registry.
 * 2. Generated WEB output (react/vue/svelte) must not contain raw hex colors
 *    or raw px values — those must come through token references.
 * 3. Generated NATIVE output (react-native/swiftui/compose) must likewise not
 *    inline a value that has a token equivalent (F-21). Native literal shapes
 *    differ from web hex/px, so the detectors below are the platform-specific
 *    analogue of rules 2 — not a copy of them:
 *      · a COLOR literal (raw channels / packed int / hex string) is `serious`,
 *        exactly as a web raw hex is — a color must always be a token.
 *      · a DIMENSION literal (`.dp`/`.sp`, a numeric `.padding()/.cornerRadius()`
 *        / `.system(size:)`, or a bare number on an RN dimension style prop) is
 *        `moderate`, exactly as a web raw px is.
 *   A `Color(DesignTokens.X)` wrapper or a `DesignTokens.*` / `tokens.*`
 *   reference is a token reference, never a literal — the detectors key on the
 *   numeric/hex payload (`hex:`, `red:`, `0x`, `#…`, a bare number), which a
 *   token reference never carries, so legitimate token usage is not flagged.
 *
 *   Exception carried over: the web scan adds no numeric allowlist and relies on
 *   pattern narrowness; the native dimension scan mirrors that and additionally
 *   treats the bare values `0` and `1` as legitimate non-tokens (zero and the
 *   1-unit hairline — the `0`/`1` case the design brief names), since those have
 *   no token equivalent and are universal native idioms. Colors carry NO
 *   exception: every color must be a token.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(__dirname, '../../../../../_shared/tokens/registry.json');

const WEB_ADAPTERS = new Set(['react', 'vue', 'svelte']);
const NATIVE_ADAPTERS = new Set(['react-native', 'swiftui', 'compose']);
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_PX = /:\s*\d+px/;

// --- native color literals (raw channels / packed int / hex / rgb string) ----
// Each entry is a set of patterns whose match is a HARDCODED color. A token
// reference (`Color(DesignTokens.X)`, `DesignTokens.ColorX`, `tokens.color.*`)
// carries none of these payloads and is never matched.
const NATIVE_COLOR = {
  swiftui: [/Color\(\s*(?:hex|red|\.sRGB|\.sRGBLinear|\.displayP3)\b[^)]*\)/, /UIColor\(\s*(?:red|white|hue)\b[^)]*\)/, HEX],
  compose: [/Color\(\s*0x[0-9A-Fa-f]{3,8}\b[^)]*\)/, /Color\(\s*red\s*=[^)]*\)/, HEX],
  'react-native': [/['"]#[0-9a-fA-F]{3,8}['"]/, /['"]rgba?\([^'"]*\)['"]/],
};

// --- native dimension literals (should be a spacing/size/radius/font token) ---
// Each regex captures the numeric literal in group 1; `0` and `1` are exempt
// (see the "Exception carried over" note above).
const NATIVE_DIM = {
  swiftui: [/\.(?:padding|cornerRadius|frame)\(\s*(\d+(?:\.\d+)?)/g, /\.system\(size:\s*(\d+(?:\.\d+)?)/g],
  compose: [/\b(\d+(?:\.\d+)?)\.(?:dp|sp)\b/g],
  'react-native': [/\b(?:padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|borderRadius|borderWidth|gap|rowGap|columnGap|width|height|minWidth|minHeight|maxWidth|maxHeight|fontSize|lineHeight|top|left|right|bottom)\s*:\s*(\d+(?:\.\d+)?)/g],
};

const DIM_EXEMPT = new Set(['0', '1']);

/** First hardcoded color literal in native code, or null (token refs excluded). */
function firstColorLiteral(adapter, code) {
  for (const re of NATIVE_COLOR[adapter] ?? []) {
    const m = code.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Every hardcoded dimension literal in native code (0 / 1 exempted). */
function dimLiterals(adapter, code) {
  const hits = [];
  for (const re of NATIVE_DIM[adapter] ?? []) {
    for (const m of code.matchAll(re)) {
      const value = m[1];
      if (value != null && !DIM_EXEMPT.has(value)) hits.push(m[0].trim());
    }
  }
  return hits;
}

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
    if (!res?.code) continue;
    const code = res.code;

    if (WEB_ADAPTERS.has(adapter)) {
      // --- web source tier (unchanged) ---
      if (HEX.test(code)) {
        issues.push({ severity: 'serious', rule: 'hardcoded-color', msg: `${adapter}: raw hex color in output` });
      }
      if (RAW_PX.test(code)) {
        issues.push({ severity: 'moderate', rule: 'hardcoded-dimension', msg: `${adapter}: raw px value in output` });
      }
    } else if (NATIVE_ADAPTERS.has(adapter)) {
      // --- native source tier (F-21): same principle, platform-specific shapes ---
      const color = firstColorLiteral(adapter, code);
      if (color) {
        issues.push({ severity: 'serious', rule: 'hardcoded-color-native',
          msg: `${adapter}: hardcoded color literal \`${color}\` — colors must reference a token (DesignTokens.* / tokens.color.*)` });
      }
      const dims = dimLiterals(adapter, code);
      if (dims.length) {
        issues.push({ severity: 'moderate', rule: 'hardcoded-dimension-native',
          msg: `${adapter}: hardcoded dimension literal(s) ${dims.map((d) => `\`${d}\``).join(', ')} — use a spacing/size/radius/font token` });
      }
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
