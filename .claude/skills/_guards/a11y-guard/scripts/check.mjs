/**
 * a11y-guard (static / spec tier)
 * Walks the IR and enforces baseline accessibility contracts before any code
 * is trusted. Dynamic tier (axe-core via Playwright) runs in 06-verify.
 */
export function checkA11y(ir) {
  const issues = [];
  const walk = (node, path) => {
    const at = `${path}/${node.kind}`;
    if (node.kind === 'media' && !node.alt) {
      issues.push({ severity: 'serious', rule: 'img-alt', at, msg: 'media element has no alt text' });
    }
    if (node.kind === 'action' && !node.label && !node.icon) {
      issues.push({ severity: 'serious', rule: 'button-name', at, msg: 'action has neither label nor icon' });
    }
    if (node.kind === 'action' && !node.label && node.icon) {
      issues.push({ severity: 'moderate', rule: 'icon-button-name', at, msg: 'icon-only action should carry an aria-label' });
    }
    if (node.kind === 'input' && !node.a11y?.label) {
      issues.push({ severity: 'serious', rule: 'label', at, msg: 'input has no accessible label' });
    }
    if (node.kind === 'heading' && !node.level) {
      issues.push({ severity: 'moderate', rule: 'heading-level', at, msg: 'heading missing level' });
    }
    if (node.kind === 'link' && !node.href) {
      issues.push({ severity: 'moderate', rule: 'link-href', at, msg: 'link missing href' });
    }
    (node.children ?? []).forEach((c, i) => walk(c, `${at}[${i}]`));
  };
  walk(ir.root, '');
  const blocking = issues.filter((i) => i.severity === 'serious' || i.severity === 'critical');
  return { ok: blocking.length === 0, issues };
}
