/**
 * output-guards — Batch-3 output-tier hardenings that generalize the Batch-1.1
 * "check the generated output, not just the IR" discipline beyond F-1/F-2.
 *
 * H1 · checkNativeExprLeak (F-9 class) — the most dangerous class: native output
 *   that does NOT compile while every other gate is green. A native adapter
 *   (SwiftUI / Compose) must never emit a raw JS expression verbatim inside
 *   native syntax. Detector (targeted, IR-anchored + output-confirmed): collect
 *   every "native-unevaluable" discriminant from the IR — a `variant.prop` that
 *   is not a plain identifier / dotted member path (i.e. it contains a JS
 *   ternary, comparison, call, or quotes) — then FAIL if that exact string
 *   appears verbatim in a native adapter's generated code.
 *   Limit: it targets the one place the engine currently emits an un-evaluated
 *   expression verbatim (the variant discriminant). Text/label `expr`s are not
 *   covered here because the native adapters already simplify them to a single
 *   identifier and emit a documented `expr simplified` warning — that path is
 *   handled by H2a (the dropped secondary prop), not by H1.
 *
 * H2 · checkDeclaredDropped (F-10 / F-11 class) — a thing the IR declares that a
 *   target adapter's output neither expresses NOR documents with a divergence
 *   warning is a silent drop and FAILS. Two detectors:
 *     H2a declared-but-unused prop — a prop that never appears in a native
 *         adapter's rendered BODY (dropped when the adapter simplifies away the
 *         `expr` that was its only reference), unless a warning names it. A
 *         declared prop that survives only in the type signature is a FAIL.
 *     H2b unrenderable declared icon — an `icon` on a node that is neither an
 *         `action` nor a container carrying a `variant` with icon cases. The
 *         renderers only emit icons in those two positions, so any other `icon`
 *         placement is silently dropped by every adapter.
 *   Limit: H2a is enforced on the two native adapters via body extraction, since
 *   expr-simplification (the only current silent-drop mechanism for a prop) is
 *   native-only; web/RN keep the `expr` and use the prop inline. H2b is
 *   structural (IR-anchored), matching the renderers' two icon-bearing positions.
 */

const NATIVE = new Set(['swiftui', 'compose']);
// A discriminant a native adapter CAN evaluate: a bare identifier or a dotted
// member path (e.g. `direction`, `item.field`). Anything else (spaces, operators,
// `?`, quotes, calls) is a JS expression that leaks as uncompilable native code.
const PLAIN_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

const blocking = (issues) => issues.every((i) => i.severity !== 'serious' && i.severity !== 'critical');

function walk(node, visit) {
  visit(node);
  (node.children ?? []).forEach((c) => walk(c, visit));
}

/** H1 — native adapters must not emit an un-evaluated JS expression verbatim. */
export function checkNativeExprLeak(ir, results) {
  const issues = [];
  const exprs = new Set();
  walk(ir.root, (n) => {
    const p = n.variant?.prop;
    if (p && !PLAIN_PATH.test(String(p).trim())) exprs.add(String(p).trim());
  });
  if (exprs.size) {
    for (const [adapter, res] of Object.entries(results ?? {})) {
      if (!NATIVE.has(adapter)) continue;
      const code = res?.code ?? '';
      for (const e of exprs) {
        if (code.includes(e)) {
          issues.push({ severity: 'serious', rule: 'native-expr-leak',
            msg: `${adapter}: emits the un-evaluated JS expression \`${e}\` verbatim in native syntax (uncompilable output)` });
        }
      }
    }
  }
  return { ok: blocking(issues), issues };
}

/** Return the rendered body of a native component (props/type signature stripped). */
function nativeBody(adapter, code) {
  if (adapter === 'swiftui') { const i = code.indexOf('var body: some View {'); return i >= 0 ? code.slice(i) : code; }
  if (adapter === 'compose') { const i = code.indexOf(') {'); return i >= 0 ? code.slice(i + 3) : code; }
  return code;
}

/** H2 — a declared prop / icon that an adapter silently drops (no warning) FAILS. */
export function checkDeclaredDropped(ir, results) {
  const issues = [];
  // H2b — an icon on a node the renderers cannot place is dropped on EVERY adapter.
  const badIcons = [];
  walk(ir.root, (n) => {
    if (!n.icon) return;
    const renders = n.kind === 'action'
      || (n.kind === 'container' && n.variant && Object.values(n.variant.cases ?? {}).some((c) => 'icon' in c));
    if (!renders) badIcons.push(n.icon);
  });
  for (const [adapter, res] of Object.entries(results ?? {})) {
    // A genuine divergence note names the dropped thing in prose; the
    // `expr simplified to \`x\`` warning merely QUOTES the raw expression (in
    // double quotes), which may incidentally contain other prop names. Strip the
    // quoted expression so only a real drop-note counts as "documented".
    const warns = (res?.warnings ?? []).join('\n').replace(/"[^"]*"/g, '');
    for (const icon of badIcons) {
      issues.push({ severity: 'serious', rule: 'declared-icon-dropped',
        msg: `${adapter}: declared icon \`${icon}\` sits on a non-action / non-variant node — no standalone icon element exists, so it is silently dropped` });
    }
    // H2a — declared-but-unused prop on a native adapter (dropped by expr-simplification).
    if (!NATIVE.has(adapter)) continue;
    const body = nativeBody(adapter, res?.code ?? '');
    for (const p of ir.props ?? []) {
      const used = new RegExp(`\\b${p.name}\\b`).test(body);
      const warned = warns.includes(p.name);
      if (!used && !warned) {
        issues.push({ severity: 'serious', rule: 'declared-prop-dropped',
          msg: `${adapter}: declared prop \`${p.name}\` never appears in the rendered body (silently dropped) and no divergence warning names it` });
      }
    }
  }
  return { ok: blocking(issues), issues };
}
