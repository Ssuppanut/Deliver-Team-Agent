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
// F-13 per-item condition: a boolean FIELD-ACCESS on the current loop item —
// exactly `<loopvar>.<field>` (one dot, both bare identifiers). This is a direct
// native property read on every platform (SwiftUI `if item.active`, Compose
// `if (item.active)`, web `item.active && …`). A comparison / logic / call
// (`item.count > 5`, `item.a && item.b`, `item.f()`) is NOT a field read — it is
// the F-9 expression anti-pattern and stays refused.
const FIELD_ACCESS = /^[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*$/;
// F-13 depth cap: total conditional nesting (nested + else-if + per-item, counted
// together) may not exceed this. Deeper branching is refused with a redirect to
// extract a sub-component (a component boundary resets the budget).
const MAX_COND_DEPTH = 3;

/** A condition is valid iff it is a plain boolean flag, or a per-item boolean
 *  field-access whose base is an in-scope loop variable. Everything else (any
 *  expression) is refused. */
function conditionOK(when, loopVars) {
  const w = String(when).trim();
  if (PLAIN_FLAG.test(w)) return true;
  if (FIELD_ACCESS.test(w)) return loopVars.has(w.split('.')[0]);
  return false;
}

/** Max conditional-nesting depth on any root-to-leaf path. A conditional adds 1
 *  to the running count for its whole subtree; iteration/containers pass the
 *  count through unchanged (so a per-item conditional inside outer conditionals
 *  counts as a deeper level, and an else-if chain counts each clause). */
function maxCondDepth(node, ancestors = 0) {
  if (!node || typeof node !== 'object') return ancestors;
  const here = node.el === 'conditional' ? ancestors + 1 : ancestors;
  let max = here;
  for (const c of node.children ?? []) max = Math.max(max, maxCondDepth(c, here));
  for (const b of [node.then, node.else]) if (b) max = Math.max(max, maxCondDepth(b, here));
  return max;
}

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
  for (const [slot, v] of [['bound value', i.valueProp], ['change handler', i.changeProp], ['min', st.min], ['max', st.max], ['step', st.step], ['options', st.options]]) {
    // Numbers are literal constraints (fine); only a non-plain STRING is an expression.
    if (bad(v)) return { slot, expr: String(v).trim() };
  }
  return null;
}

/** Walk the spec tree (children + conditional then/else) for a refusable
 *  condition. `loopVars` are the iteration variables in scope for this subtree,
 *  so a per-item condition may read `<loopvar>.field` but nothing else. */
function findBadCondition(node, loopVars = new Set()) {
  if (!node || typeof node !== 'object') return null;
  const vp = node.variant?.prop;
  if (typeof vp === 'string' && !PLAIN_DISCRIMINANT.test(vp.trim())) return { kind: 'variant', expr: vp.trim() };
  if (typeof node.when === 'string' && !conditionOK(node.when, loopVars)) return { kind: 'condition', expr: node.when.trim() };
  // F-5 boolean-attribute binding (`disabled`): must be a plain boolean flag
  // ref, never a JS expression — the F-9 anti-pattern re-entering through the
  // attribute. Refuse it, consistent with the variant / condition / state-binding
  // refusals, and redirect to a computed boolean flag from the data layer.
  if (typeof node.disabled === 'string' && !PLAIN_FLAG.test(node.disabled.trim())) return { kind: 'boolean-attr', expr: node.disabled.trim() };
  const badBinding = findBadBinding(node);
  if (badBinding) return { kind: 'binding', expr: badBinding.expr, slot: badBinding.slot };
  // A node carrying `each` introduces its loop variable into scope for its subtree.
  const scope = node.each?.as ? new Set([...loopVars, node.each.as]) : loopVars;
  for (const c of node.children ?? []) { const hit = findBadCondition(c, scope); if (hit) return hit; }
  for (const b of [node.then, node.else]) { if (b) { const hit = findBadCondition(b, scope); if (hit) return hit; } }
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
      reason: `a condition must be a plain boolean flag prop, or a per-item boolean field-access on the current loop item (e.g. \`item.active\`), not an embedded expression (found: \`${bad.expr}\`) — a comparison / logic / call is presentation logic that belongs in the data layer`,
      redirect: "pass a boolean flag prop (e.g. when: isEmpty), or for a per-item condition a boolean field on the item (e.g. when: item.active), computed in the data layer — not a JS expression",
      reference: 'knowledge/pattern-library/references/expression-variant.md',
    };
  }
  if (bad?.kind === 'boolean-attr') {
    return {
      category: 'expression-boolean-attr',
      reason: `a boolean-attribute binding (disabled) must be a plain caller-supplied flag ref, not an embedded expression (found: \`${bad.expr}\`) — a computed attribute is presentation logic that belongs in the data layer`,
      redirect: "pass a plain boolean flag prop (e.g. disabled: isBusy) computed in the data layer, not a JS expression",
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
  // F-13 depth cap: refuse conditional nesting deeper than the budget (checked
  // after condition validity, so an expression is reported as such first).
  const depth = spec?.root ? maxCondDepth(spec.root) : 0;
  if (depth > MAX_COND_DEPTH) {
    return {
      category: 'conditional-depth',
      reason: `conditional nesting depth ${depth} exceeds the cap of ${MAX_COND_DEPTH} — nested, else-if, and per-item conditionals all count toward one depth budget, and deeper branching is unreadable and hard to test`,
      redirect: `extract the innermost branch into its own sub-component (a component boundary resets the depth budget), or flatten the logic into fewer boolean flags computed in the data layer`,
      reference: 'knowledge/pattern-library/references/expression-variant.md',
    };
  }
  return null;
}
