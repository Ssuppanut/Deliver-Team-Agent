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

// F-22 — colour-family slots carry no information under grayscale / CVD.
const COLOR_SLOTS = new Set(['background', 'color', 'border']);
// Enum values that read as a decodable status (so a variant over them is a
// `status` variant that must survive grayscale). Used both to enforce the rule
// and as the `emphasis` backstop. Exact, case-insensitive token match — NOT a
// fuzzy match, so a genuine emphasis label like `destructive` is not swept in.
export const STATUS_VOCAB = new Set([
  'success', 'warning', 'warn', 'error', 'err', 'info',
  'positive', 'negative', 'danger', 'critical', 'caution', 'failure',
]);

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
  // F-28: SwiftUI has no declarative live-region trait (.updatesFrequently does not announce), so
  // there is nothing to look for: `null` means "never present", so absence needs a ledger reason.
  swiftui: null,
  compose: /liveRegion\s*=/,
};

// F-28: where OMITTING the live trait is the correct lowering of `live: off` (the platform has no
// "off" value, absence is off). On every other adapter `off` is emitted explicitly.
const LIVE_OFF_BY_OMISSION = new Set(['swiftui', 'compose']);

/**
 * Is a missing live-region trait justified for this adapter and value? Only by (a) the correct
 * omission for `off` on an adapter with no off value, or (b) a ledger divergence for exactly this
 * value that cites a waiver id (the ledger gate validates the waiver itself). A free-text warning
 * is NOT enough.
 */
function liveAbsenceJustified(adapter, live, ledger) {
  const id = `a11y.live=${live}`;
  const entries = (ledger ?? []).filter((e) => e.adapter === adapter && e.traitId === id);
  if (live === 'off' && LIVE_OFF_BY_OMISSION.has(adapter)) return entries.some((e) => e.status === 'expressed');
  return entries.some((e) => e.status === 'diverged' && typeof e.waiver === 'string' && e.waiver !== '');
}

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

  // --- F-22: status variants must not convey state by colour alone -----------
  // A variant whose `intent` is `status` (the default when omitted — fail-closed)
  // must distinguish every pair of states by at least one NON-colour slot
  // (a per-state icon / text / shape / sign), compared on resolved values, not
  // just key presence. Colour slots are {background,color,border}. Caller-supplied
  // props (child text bound to a ref) are not variant-bound cues and do not count.
  // `emphasis` variants are exempt — EXCEPT the backstop: an `emphasis` label on a
  // status-vocabulary enum is a mislabeled status variant and FAILS. This is a
  // spec-tier, output-agnostic contract: `intent` is metadata, nothing emitted.
  const variantNodes = [];
  const gather = (n) => { if (n?.variant) variantNodes.push(n); (n?.children ?? []).forEach(gather); };
  gather(ir.root);
  for (const n of variantNodes) {
    const v = n.variant;
    const intent = v.intent ?? 'status'; // fail-closed default
    const cases = Object.entries(v.cases ?? {});
    const values = cases.map(([k]) => String(k));
    if (intent === 'emphasis') {
      const statusish = values.filter((val) => STATUS_VOCAB.has(val.toLowerCase()));
      if (statusish.length) {
        issues.push({ severity: 'serious', rule: 'status-color-only', at: '/container',
          msg: `variant "${v.prop}" is marked intent=emphasis but its values (${statusish.join(', ')}) read as status states; a status variant must convey state by more than colour — reclassify as status and add a per-state non-colour cue` });
      }
      continue;
    }
    // intent === 'status' (or default): the non-colour signature of each state
    // must be unique. Two states sharing a signature (including the empty one =
    // colour-only) are indistinguishable without colour.
    const sig = (slots) => Object.entries(slots || {})
      .filter(([slot]) => !COLOR_SLOTS.has(slot))
      .map(([slot, token]) => `${slot}=${token}`)
      .sort()
      .join('|');
    const sigs = cases.map(([k, slots]) => [k, sig(slots)]);
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        if (sigs[i][1] === sigs[j][1]) {
          const detail = sigs[i][1] === ''
            ? 'neither carries a non-colour cue (colour-only)'
            : `both resolve to the same non-colour cue "${sigs[i][1]}"`;
          issues.push({ severity: 'serious', rule: 'status-color-only', at: '/container',
            msg: `variant "${v.prop}" states "${sigs[i][0]}" and "${sigs[j][0]}" are indistinguishable without colour — ${detail}. A status variant needs a per-state non-colour cue (icon / text / shape / sign).` });
        }
      }
    }
  }

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
          const hasTrait = re === null ? false : re ? re.test(code) : true; // unknown adapter: don't invent a failure
          if (!hasTrait && !liveAbsenceJustified(adapter, n.a11y.live, res?.ledger)) {
            issues.push({ severity: 'serious', rule: 'a11y-output-live', at: `/${n.kind}`,
              msg: `${adapter}: IR declares aria-live="${n.a11y.live}" but the output has no live-region trait and no waiver-backed ledger divergence for this value` });
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
