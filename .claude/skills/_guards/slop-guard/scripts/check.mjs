/**
 * slop-guard (static tier) — design-quality gate.
 * Catches the "generic AI look" that the other guards do not: emoji standing in
 * for real iconography, and state conveyed by color alone. It complements
 * a11y-guard (correctness), token-guard (contract) and perf-guard (weight) with
 * an aesthetic-quality dimension. Knowledge/rationale lives in
 * knowledge/anti-slop.
 */

// Emoji / pictographs that should never appear in a design-system UI — real
// icons come from the unified icon token system, not literal emoji.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{FE00}-\u{FE0F}]/u;

/** slots that only carry color information */
const COLOR_ONLY = new Set(['background', 'color', 'border']);

function walk(node, visit) {
  visit(node);
  (node.children ?? []).forEach((c) => walk(c, visit));
}

export function checkSlop(ir, results) {
  const issues = [];

  // 1. Emoji in generated output (serious — blocks the gate).
  for (const [adapter, res] of Object.entries(results)) {
    if (res?.code && EMOJI.test(res.code)) {
      issues.push({ severity: 'serious', rule: 'no-emoji', msg: `${adapter}: emoji in output; use an icon token instead` });
    }
  }

  // 2. State conveyed by color alone (minor — advisory).
  // A variant that only swaps color-family slots, on a node carrying no icon and
  // no per-case icon, distinguishes state by color only — a common a11y/slop
  // smell. Pair it with an icon or text so the state survives grayscale/CVD.
  walk(ir.root, (node) => {
    if (!node.variant) return;
    const cases = Object.values(node.variant.cases ?? {});
    const everyCaseColorOnly = cases.length > 0 && cases.every((slots) =>
      Object.keys(slots).every((slot) => COLOR_ONLY.has(slot)));
    const anyCaseIcon = cases.some((slots) => 'icon' in slots);
    if (everyCaseColorOnly && !anyCaseIcon && !node.icon) {
      issues.push({
        severity: 'minor',
        rule: 'status-color-only',
        msg: `variant "${node.variant.prop}" distinguishes state by color alone; add a per-state icon or text`,
      });
    }
  });

  const blocking = issues.filter((i) => i.severity === 'serious' || i.severity === 'critical');
  return { ok: blocking.length === 0, issues };
}
