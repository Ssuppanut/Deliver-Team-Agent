/**
 * check-tbd — readiness gate for the "never invent what you do not know" rule.
 * An author who does not know a value writes the sentinel `TBD` instead of
 * guessing. This check scans the IR for that sentinel and refuses to treat the
 * spec as ready: a fabricated value is worse than a blank one, because it ships.
 *
 * Resolve every finding (fill the value, or drop the element) before generating.
 */
const SENTINEL = /^TBD\b/;

const isTbd = (v) => typeof v === 'string' && SENTINEL.test(v.trim());

function walk(node, path, hits) {
  const at = `${path}/${node.kind}`;
  for (const field of ['text', 'label', 'alt', 'src', 'href']) {
    const vr = node[field];
    if (vr && vr.kind === 'literal' && isTbd(vr.value)) {
      hits.push({ at, field, value: vr.value });
    }
  }
  if (node.a11y?.label?.kind === 'literal' && isTbd(node.a11y.label.value)) {
    hits.push({ at, field: 'a11y.label', value: node.a11y.label.value });
  }
  for (const [slot, token] of Object.entries(node.style ?? {})) {
    if (isTbd(token)) hits.push({ at, field: `style.${slot}`, value: token });
  }
  (node.children ?? []).forEach((c, i) => walk(c, `${at}[${i}]`, hits));
}

export function checkTbd(ir) {
  const hits = [];
  for (const token of ir.tokens ?? []) {
    if (isTbd(token)) hits.push({ at: '/tokens', field: 'token', value: token });
  }
  walk(ir.root, '', hits);
  const issues = hits.map((h) => ({
    severity: 'serious',
    rule: 'unresolved-tbd',
    msg: `${h.at} ${h.field}: "${h.value}" — resolve before generating (never invent)`,
  }));
  return { ok: issues.length === 0, issues };
}
