/**
 * Orchestrator Step 2.5 — executable refusal check.
 * Certain component categories are deliberately out of scope: a poor
 * cross-platform imitation is worse than a redirect to a purpose-built
 * primitive. This turns the documented refusal rules into code the pipeline
 * runs before generating anything.
 *
 * Rationale + full redirects live in
 * knowledge/pattern-library/references/{overlays,data-tables}.md.
 */
export const REFUSED = {
  overlay: {
    reason: 'focus trap, portals, and dismiss semantics diverge fundamentally per platform',
    redirect: 'Radix UI / native <Modal> / SwiftUI .sheet / Compose Dialog',
    reference: 'knowledge/pattern-library/references/overlays.md',
  },
  'data-table': {
    reason: 'sorting, virtualization, and dynamic columns are a library domain, not a composition',
    redirect: 'TanStack Table v8 / AG Grid / native',
    reference: 'knowledge/pattern-library/references/data-tables.md',
  },
};

// A variant case must be selected by a plain enum prop (or a dotted member path),
// never by an embedded expression. A computed discriminant — a ternary, a
// comparison, a call — is presentation logic that belongs upstream: the data
// layer supplies the resolved enum. Embedding it in the spec also emits
// uncompilable native code (see the native-code gate), so the orchestrator
// refuses it outright, consistent with the overlay / data-table refusals.
const PLAIN_DISCRIMINANT = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const EXPRESSION_VARIANT = {
  redirect: "pass a plain enum variant prop (e.g. direction: 'negative') and compute the value in the data layer",
  reference: 'knowledge/pattern-library/references/expression-variant.md',
};

function findExpressionDiscriminant(node) {
  if (!node || typeof node !== 'object') return null;
  const p = node.variant?.prop;
  if (typeof p === 'string' && !PLAIN_DISCRIMINANT.test(p.trim())) return p.trim();
  for (const c of node.children ?? []) {
    const hit = findExpressionDiscriminant(c);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {{category?: string, root?: object}} spec
 * @returns {null | { category: string, reason: string, redirect: string, reference: string }}
 */
export function checkRefusal(spec) {
  const category = spec?.category;
  if (category && category in REFUSED) {
    return { category, ...REFUSED[category] };
  }
  const expr = spec?.root ? findExpressionDiscriminant(spec.root) : null;
  if (expr) {
    return {
      category: 'expression-variant',
      reason: `a variant case must be selected by a plain enum prop, not an embedded expression (found: \`${expr}\`) — computed selection is presentation logic that belongs in the data layer`,
      redirect: EXPRESSION_VARIANT.redirect,
      reference: EXPRESSION_VARIANT.reference,
    };
  }
  return null;
}
