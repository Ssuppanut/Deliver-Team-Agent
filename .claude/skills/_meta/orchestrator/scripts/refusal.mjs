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
// A conditional/one-way condition (`when`) must be a plain boolean flag prop — a
// bare identifier. An expression (comparison / ternary / call, e.g.
// `items.length > 0`) is the F-9 anti-pattern re-entering through the condition:
// it must be refused too, redirecting to a computed boolean flag from the data layer.
const PLAIN_FLAG = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const EXPRESSION_VARIANT = {
  redirect: "pass a plain enum variant prop (e.g. direction: 'negative') and compute the value in the data layer",
  reference: 'knowledge/pattern-library/references/expression-variant.md',
};

/**
 * A control-state binding reference (bound value, change handler, or a
 * numeric-range min/max/step given as a ref) must be a plain identifier — a
 * caller-supplied ref — never an embedded expression. An expression here is the
 * F-9 anti-pattern re-entering through the state binding: refuse it and redirect
 * to a plain ref computed in the data layer, consistent with the variant /
 * condition refusals.
 */
function findBadBinding(node) {
  const st = node.input?.state;
  if (!st) return null;
  const i = node.input ?? {};
  const bad = (v) => typeof v === 'string' && !PLAIN_FLAG.test(v.trim());
  for (const [slot, v] of [['bound value', i.valueProp], ['change handler', i.changeProp], ['min', st.min], ['max', st.max], ['step', st.step]]) {
    // Numbers are literal constraints (fine); only a non-plain STRING is an expression.
    if (bad(v)) return { slot, expr: String(v).trim() };
  }
  return null;
}

/** Walk the spec tree (children + conditional then/else) for a refusable condition. */
function findBadCondition(node) {
  if (!node || typeof node !== 'object') return null;
  const vp = node.variant?.prop;
  if (typeof vp === 'string' && !PLAIN_DISCRIMINANT.test(vp.trim())) return { kind: 'variant', expr: vp.trim() };
  if (typeof node.when === 'string' && !PLAIN_FLAG.test(node.when.trim())) return { kind: 'condition', expr: node.when.trim() };
  const badBinding = findBadBinding(node);
  if (badBinding) return { kind: 'binding', expr: badBinding.expr, slot: badBinding.slot };
  for (const c of node.children ?? []) { const hit = findBadCondition(c); if (hit) return hit; }
  for (const b of [node.then, node.else]) { if (b) { const hit = findBadCondition(b); if (hit) return hit; } }
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
  const bad = spec?.root ? findBadCondition(spec.root) : null;
  if (bad?.kind === 'variant') {
    return {
      category: 'expression-variant',
      reason: `a variant case must be selected by a plain enum prop, not an embedded expression (found: \`${bad.expr}\`) — computed selection is presentation logic that belongs in the data layer`,
      redirect: EXPRESSION_VARIANT.redirect,
      reference: EXPRESSION_VARIANT.reference,
    };
  }
  if (bad?.kind === 'condition') {
    return {
      category: 'expression-condition',
      reason: `a condition must be a plain boolean flag prop, not an embedded expression (found: \`${bad.expr}\`) — compute the boolean in the data layer`,
      redirect: "pass a boolean flag prop (e.g. when: isEmpty) computed in the data layer, not a JS expression",
      reference: 'knowledge/pattern-library/references/expression-variant.md',
    };
  }
  if (bad?.kind === 'binding') {
    return {
      category: 'expression-binding',
      reason: `a control-state ${bad.slot} must be a plain caller-supplied ref, not an embedded expression (found: \`${bad.expr}\`) — a computed binding is presentation logic that belongs in the data layer`,
      redirect: "pass a plain ref (a value prop + a change-handler prop, e.g. valueProp: checked, changeProp: onToggle) computed in the data layer, not a JS expression",
      reference: 'knowledge/pattern-library/references/expression-variant.md',
    };
  }
  return null;
}
