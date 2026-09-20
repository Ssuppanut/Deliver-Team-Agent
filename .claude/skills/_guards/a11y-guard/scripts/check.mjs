/**
 * a11y-guard (static / spec tier + per-adapter output tier)
 * Walks the IR and enforces baseline accessibility contracts before any code
 * is trusted. Dynamic tier (axe-core via Playwright) runs in 06-verify.
 *
 * Two tiers:
 *   1. IR tier   — structural contracts on the spec (alt, button-name, label…).
 *   2. output tier (additive; only when adapter `results` are passed) — when the
 *      IR declares role / aria-live, the GENERATED code for each adapter must
 *      carry the platform-correct trait, OR the adapter must have emitted a
 *      documented divergence warning naming that role. IR-declared-but-output-
 *      missing (no trait AND no warning) is a silent drop and FAILS. This closes
 *      the blind spot where a live region existed in the IR but a native adapter
 *      dropped it (F-2), which the IR-only check could never catch.
 */

// Roles whose a11y weight makes an output-tier check worthwhile. A role outside
// this set (e.g. group/region) is still emitted on web and may warn on native,
// but is not a hard output-tier contract.
const ENFORCED_ROLES = new Set(['status', 'alert', 'img', 'separator']);

// Per-adapter regex for a live-region trait in the generated source.
const LIVE_TRAIT = {
  react: /aria-live=/,
  vue: /aria-live=/,
  svelte: /aria-live=/,
  'react-native': /accessibilityLiveRegion=/,
  swiftui: /updatesFrequently/,
  compose: /liveRegion\s*=/,
};

// Per-role, per-adapter regex for the expressed trait. A missing adapter entry
// means that platform cannot express the role as a trait — it must instead have
// emitted a divergence warning naming the role.
const ROLE_TRAIT = {
  status:    { react: /role="status"/, vue: /role="status"/, svelte: /role="status"/ },
  alert:     { react: /role="alert"/, vue: /role="alert"/, svelte: /role="alert"/, 'react-native': /accessibilityRole="alert"/ },
  img:       { react: /role="img"/, vue: /role="img"/, svelte: /role="img"/, 'react-native': /accessibilityRole="image"/, swiftui: /\.isImage/, compose: /role = Role\.Image/ },
  separator: { react: /role="separator"/, vue: /role="separator"/, svelte: /role="separator"/ },
};

export function checkA11y(ir, results) {
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
    // An input is labeled by any of: a visible associated label, an aria-label,
    // or an aria-labelledby reference.
    if (node.kind === 'input' && !node.label && !node.a11y?.label && !node.a11y?.labelledBy) {
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

  // --- output tier (additive) ------------------------------------------------
  if (results && Object.keys(results).length) {
    const nodes = [];
    const collect = (n) => { nodes.push(n); (n.children ?? []).forEach(collect); };
    collect(ir.root);
    for (const [adapter, res] of Object.entries(results)) {
      const code = res?.code ?? '';
      const warns = (res?.warnings ?? []).join('\n');
      for (const n of nodes) {
        if (n.a11y?.live) {
          const re = LIVE_TRAIT[adapter];
          const hasTrait = re ? re.test(code) : true; // unknown adapter: don't invent a failure
          const warned = /a11y:.*live/i.test(warns);
          if (!hasTrait && !warned) {
            issues.push({ severity: 'serious', rule: 'a11y-output-live', at: `/${n.kind}`,
              msg: `${adapter}: IR declares aria-live="${n.a11y.live}" but the output has no live-region trait and no divergence warning` });
          }
        }
        if (n.role && ENFORCED_ROLES.has(n.role)) {
          const re = ROLE_TRAIT[n.role]?.[adapter];
          const hasTrait = re ? re.test(code) : false;
          const warned = warns.includes(`role "${n.role}"`);
          if (!hasTrait && !warned) {
            issues.push({ severity: 'serious', rule: 'a11y-output-role', at: `/${n.kind}`,
              msg: `${adapter}: IR declares role="${n.role}" but the output has neither the platform trait nor a divergence warning` });
          }
        }
      }
    }
  }

  const blocking = issues.filter((i) => i.severity === 'serious' || i.severity === 'critical');
  return { ok: blocking.length === 0, issues };
}
