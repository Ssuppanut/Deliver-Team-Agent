/**
 * RendererBase — universal visitor for the IR tree.
 * -------------------------------------------------
 * All 6 adapters (react, vue, svelte, react-native, swiftui, compose) extend
 * this class. The base owns tree traversal, token/icon resolution, and the
 * ordering of conditional/iteration wrapping. Adapters override the visit*
 * methods to emit platform-specific code, plus:
 *   - interp(valueRef)          how a literal/ref/expr becomes inline code
 *   - wrapConditional(node,s)   how `when` gates a node
 *   - wrapIteration(node,s)     how `each` repeats a node
 *   - renderComponent(rootStr)  how the root is wrapped into a component file
 *
 * The base never emits platform syntax itself, so parity across adapters is a
 * property of the shared traversal, not of copy-pasted code.
 */
export class RendererBase {
  /**
   * @param {object} ir           IR produced by spec-to-ir.mjs
   * @param {object} opts
   * @param {Record<string,string>} opts.tokenMap  semantic token -> platform ref
   * @param {Record<string,string>} opts.iconMap   icon token -> platform symbol
   */
  constructor(ir, { tokenMap = {}, iconMap = {} } = {}) {
    this.ir = ir;
    this.tokenMap = tokenMap;
    this.iconMap = iconMap;
    this.usedIcons = new Set();
    this.warnings = [];
  }

  /** Resolve a semantic token name to its platform reference. */
  token(name) {
    if (name in this.tokenMap) return this.tokenMap[name];
    this.warnings.push(`unmapped token: ${name}`);
    return name;
  }

  /** Resolve an icon token to its platform symbol and record usage. */
  icon(name) {
    const sym = this.iconMap[name] ?? name;
    this.usedIcons.add(sym);
    return sym;
  }

  /**
   * Normalize a node's `variant` into data the adapters format identically.
   * Splits style slots from an optional per-case `icon`, so parity across
   * adapters is a property of this shared shaping, not of each adapter.
   * @returns {null | { prop: string, styleCases: Record<string,object>, iconCases: Record<string,string> }}
   */
  variantData(node) {
    if (!node.variant) return null;
    const { prop, cases } = node.variant;
    const styleCases = {};
    const iconCases = {};
    for (const [value, slots] of Object.entries(cases)) {
      styleCases[value] = {};
      for (const [slot, token] of Object.entries(slots)) {
        if (slot === 'icon') iconCases[value] = token;
        else styleCases[value][slot] = token;
      }
    }
    return { prop, styleCases, iconCases };
  }

  /** Adapter must override: format a { kind, value } reference. */
  interp(_valueRef) {
    throw new Error('interp() not implemented');
  }

  // --- Element visitors (adapters override) --------------------------------
  visitContainer(_node, _children) { throw new Error('visitContainer not implemented'); }
  visitMedia(_node) { throw new Error('visitMedia not implemented'); }
  visitHeading(_node, _children) { throw new Error('visitHeading not implemented'); }
  visitText(_node) { throw new Error('visitText not implemented'); }
  visitAction(_node) { throw new Error('visitAction not implemented'); }
  visitLink(_node, _children) { throw new Error('visitLink not implemented'); }
  visitInput(_node) { throw new Error('visitInput not implemented'); }
  visitSlot(_node) { throw new Error('visitSlot not implemented'); }
  visitIcon(_node) { throw new Error('visitIcon not implemented'); }

  // --- Control-flow wrapping (adapters override) ---------------------------
  wrapConditional(_node, rendered) { return rendered; }
  wrapIteration(_node, rendered) { return rendered; }

  // --- Component assembly (adapters override) ------------------------------
  renderComponent(_rootRendered) { throw new Error('renderComponent not implemented'); }

  /** Render a node's children (already indented by the adapter's visitor). */
  renderChildren(node) {
    if (!node.children) return '';
    return node.children.map((c) => this.renderNode(c)).join('\n');
  }

  /** Dispatch a single node to the right visitor, then apply control flow. */
  renderNode(node) {
    let out;
    switch (node.kind) {
      case 'container': out = this.visitContainer(node, this.renderChildren(node)); break;
      case 'media': out = this.visitMedia(node); break;
      case 'heading': out = this.visitHeading(node, this.renderChildren(node)); break;
      case 'text': out = this.visitText(node); break;
      case 'action': out = this.visitAction(node); break;
      case 'link': out = this.visitLink(node, this.renderChildren(node)); break;
      case 'input': out = this.visitInput(node); break;
      case 'slot': out = this.visitSlot(node); break;
      case 'icon': out = this.visitIcon(node); break;
      default: throw new Error(`Unknown IR node kind: ${node.kind}`);
    }
    // Conditional is applied before iteration: `each` repeats the guarded node.
    if (node.when) out = this.wrapConditional(node, out);
    if (node.each) out = this.wrapIteration(node, out);
    return out;
  }

  /** Produce the full component source for this adapter. */
  build() {
    const root = this.renderNode(this.ir.root);
    return this.renderComponent(root);
  }
}

/** Indent every line of a block by n spaces. */
export function indent(str, n) {
  const pad = ' '.repeat(n);
  return str
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}
