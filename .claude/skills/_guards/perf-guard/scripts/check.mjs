/**
 * perf-guard (static tier)
 * Cheap structural checks that catch the common regressions:
 *   - an icon library imported but no icon actually used (dead import)
 *   - output far larger than the node count would justify (bloat heuristic)
 * Bundle-size (esbuild) and Web Vitals (Playwright) tiers run in 06-verify.
 */
export function checkPerf(ir, results) {
  const issues = [];
  const nodeCount = countNodes(ir.root);
  for (const [adapter, res] of Object.entries(results)) {
    if (!res?.code) continue;
    const lines = res.code.split('\n').length;
    const importsIcon = /import .*lucide|material\.icons\.filled/i.test(res.code);
    const usesIcon = (res.usedIconsCount ?? 0) > 0;
    if (importsIcon && !usesIcon) {
      issues.push({ severity: 'minor', rule: 'dead-icon-import', msg: `${adapter}: icon library imported but unused` });
    }
    const budget = 12 + nodeCount * 8;
    if (lines > budget) {
      issues.push({ severity: 'minor', rule: 'output-bloat', msg: `${adapter}: ${lines} lines exceeds heuristic budget ${budget}` });
    }
  }
  return { ok: true, issues };
}

function countNodes(node) {
  return 1 + (node.children ?? []).reduce((n, c) => n + countNodes(c), 0);
}
