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
  constructor(ir, { tokenMap = {}, iconMap = {}, adapter = 'unknown' } = {}) {
    this.ir = ir;
    this.tokenMap = tokenMap;
    this.iconMap = iconMap;
    this.adapter = adapter;
    this.usedIcons = new Set();
    this.warnings = [];
    // --- Lowering Ledger (Layer 1: totality) -------------------------------
    // Every semantic trait the IR declares on a node must be ACCOUNTED FOR by
    // this adapter: `express`ed via a real platform mechanism, or `diverge`d
    // with an explicit documented reason. A trait left unaccounted after the
    // node renders is recorded `unaccounted` and FAILS the ledger gate. The
    // gate reads this ledger, never the generated source.
    this.ledger = [];
    this._pending = null;      // Set<traitId> for the node currently rendering
    this._pendingNode = null;
  }

  /**
   * The semantic traits the IR declares on a node — derived from the IR, with
   * NO hardcoded list of known roles/values. Any new role value or a11y field
   * enrols automatically, so a brand-new trait is enforced without a gate edit.
   * @returns {string[]} trait ids (value-encoded so distinct values stay distinct)
   */
  declaredTraits(node) {
    const t = [];
    if (node.role) t.push(`role=${node.role}`);
    const a = node.a11y || {};
    if (a.label) t.push('a11y.label');
    if (a.live) t.push(`a11y.live=${a.live}`);
    if (a.invalid) t.push('a11y.invalid');
    if (a.labelledBy) t.push('a11y.labelledBy');
    if (a.describedBy) t.push('a11y.describedBy');
    // Control-state primitive: a two-way state binding is a trait every adapter
    // must account for (express its native binding), or the ledger flags it.
    if (node.input?.state?.kind) t.push(`state=${node.input.state.kind}`);
    return t;
  }

  /**
   * Normalize an input node's control-state binding — the renderer-base
   * representation of the primitive (single value, controlled-only). Adapters
   * read this and emit their platform's native two-way binding.
   * @returns {null | { kind, value, change, min, max, step }}
   */
  controlState(node) {
    const s = node.input?.state;
    if (!s) return null;
    const i = node.input;
    return { kind: s.kind, value: i.valueProp, change: i.changeProp, min: s.min, max: s.max, step: s.step };
  }

  /** Account for a trait: this adapter emitted it via a real platform mechanism. */
  express(traitId, { mechanism, loc } = {}) {
    if (this._pending && this._pending.has(traitId)) {
      this._pending.delete(traitId);
      this.ledger.push({ component: this.ir.component, adapter: this.adapter, kind: this._pendingNode?.kind, traitId, status: 'expressed', mechanism, loc });
    }
  }

  /** Account for a trait: this platform genuinely cannot express it (documented). */
  diverge(traitId, { reason, fallback, waiver } = {}) {
    if (this._pending && this._pending.has(traitId)) {
      this._pending.delete(traitId);
      this.ledger.push({ component: this.ir.component, adapter: this.adapter, kind: this._pendingNode?.kind, traitId, status: 'diverged', reason, fallback, waiver });
    }
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

  // --- Conditional (F-3): platform if / if-else syntax -----------------------
  // elseStr is null for a one-way (show/hide) conditional.
  condBlock(_flag, _thenStr, _elseStr) { throw new Error('condBlock not implemented'); }

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
    // Open a ledger frame for this node: its declared traits are `pending` until
    // the adapter accounts for each. Frames nest (save/restore) so a parent's
    // traits are accounted in its own visitor after its children have rendered.
    const prevPending = this._pending;
    const prevNode = this._pendingNode;
    this._pending = new Set(this.declaredTraits(node));
    this._pendingNode = node;

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
      case 'conditional': out = this.visitConditional(node); break;
      default: throw new Error(`Unknown IR node kind: ${node.kind}`);
    }

    // Totality check: anything still pending was neither expressed nor diverged.
    for (const traitId of this._pending) {
      this.ledger.push({ component: this.ir.component, adapter: this.adapter, kind: node.kind, traitId, status: 'unaccounted' });
    }
    this._pending = prevPending;
    this._pendingNode = prevNode;

    // A `conditional` node consumes its own `when` (the branch condition) inside
    // visitConditional, so it must NOT also be wrapped by the element-level
    // one-way `when` here.
    if (node.when && node.kind !== 'conditional') out = this.wrapConditional(node, out);
    if (node.each) out = this.wrapIteration(node, out);
    return out;
  }

  /**
   * Render an F-3 conditional node. children[0] is the "then" branch; an optional
   * children[1] is the "else" branch. Each branch is a normal node (it may carry
   * its own `each` for the list-vs-fallback shape). Traversal is shared here; the
   * adapter only supplies the platform if / if-else syntax via `condBlock`.
   */
  visitConditional(node) {
    const kids = node.children ?? [];
    const thenStr = kids[0] ? this.renderNode(kids[0]) : '';
    const elseStr = kids.length > 1 ? this.renderNode(kids[1]) : null;
    return this.condBlock(node.when, thenStr, elseStr);
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
