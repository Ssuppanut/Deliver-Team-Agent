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

/**
 * @param {{category?: string}} spec
 * @returns {null | { category: string, reason: string, redirect: string, reference: string }}
 */
export function checkRefusal(spec) {
  const category = spec?.category;
  if (category && category in REFUSED) {
    return { category, ...REFUSED[category] };
  }
  return null;
}
