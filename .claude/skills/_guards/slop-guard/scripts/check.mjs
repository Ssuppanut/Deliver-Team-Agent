/**
 * slop-guard (static tier) — design-quality gate.
 * Catches the "generic AI look" that the other guards do not: emoji standing in
 * for real iconography. It complements a11y-guard (correctness), token-guard
 * (contract) and perf-guard (weight) with an aesthetic-quality dimension.
 * Knowledge/rationale lives in knowledge/anti-slop.
 *
 * NOTE (F-22): "state conveyed by colour alone" used to live here as an advisory
 * `status-color-only` rule (minor, non-blocking). It is now a BLOCKING a11y
 * correctness contract in a11y-guard (keyed off `variant.intent`), so the
 * duplicate was removed from here to keep a single source of truth.
 */

// Emoji / pictographs that should never appear in a design-system UI — real
// icons come from the unified icon token system, not literal emoji.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{FE00}-\u{FE0F}]/u;

export function checkSlop(ir, results) {
  const issues = [];

  // Emoji in generated output (serious — blocks the gate).
  for (const [adapter, res] of Object.entries(results)) {
    if (res?.code && EMOJI.test(res.code)) {
      issues.push({ severity: 'serious', rule: 'no-emoji', msg: `${adapter}: emoji in output; use an icon token instead` });
    }
  }

  const blocking = issues.filter((i) => i.severity === 'serious' || i.severity === 'critical');
  return { ok: blocking.length === 0, issues };
}
