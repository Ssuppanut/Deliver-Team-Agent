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
    // PR A: a link's href is a trait every adapter must express via its native
    // URL-navigation primitive (<a href> / Linking.openURL / Link / openUri), or
    // the ledger flags a silent drop (e.g. an empty clickable body).
    if (node.kind === 'link' && node.href) t.push('link-href');
    const a = node.a11y || {};
    if (a.label) t.push('a11y.label');
    if (a.live) t.push(`a11y.live=${a.live}`);
    if (a.invalid) t.push('a11y.invalid');
    if (a.labelledBy) t.push('a11y.labelledBy');
    if (a.describedBy) t.push('a11y.describedBy');
    // Control-state primitive: a two-way state binding is a trait every adapter
    // must account for (express its native binding), or the ledger flags it.
    if (node.input?.state?.kind) t.push(`state=${node.input.state.kind}`);
    // Schema-expressiveness long-tail (Phase H): each is a leaf trait every
    // adapter must express (or the ledger flags it unaccounted).
    if (node.orientation) t.push(`orientation=${node.orientation}`); // F-4
    if (node.disabled) t.push('disabled');                           // F-5
    if (node.size) t.push('size');                                   // F-7
    if (node.input?.multiline) t.push('input.multiline');            // F-19
    // F-12 number formatting: a formatted value is a trait every adapter must
    // express via its native formatter (or the ledger flags a silent drop).
    for (const f of ['text', 'label']) if (node[f]?.kind === 'format') t.push('number-format');
    // F-25 rich options: a selected-value control whose options carry an `icon`
    // field is a trait every adapter must render (RadioGroup) — the ledger flags
    // a silent drop. (A native Select with icon options is refused upstream.)
    if (this.hasOptionIcons(node)) t.push('option-icon');
    // F-26 date/time formatting: a datetime value is a trait every adapter must
    // express via its native date formatter (or the ledger flags a silent drop).
    for (const f of ['text', 'label']) if (node[f]?.kind === 'datetime') t.push('date-format');
    // F-27 timezone: a datetime value that sets a timeZone is an extra trait every
    // adapter must express via its native formatter's timezone (or the ledger flags
    // it). Omitted timeZone -> no trait -> output byte-identical to F-26.
    for (const f of ['text', 'label']) if (node[f]?.kind === 'datetime' && node[f]?.dateFormat?.timeZone != null) t.push('date-timezone');
    // D4a icon: a node that carries an icon (el: icon, an action icon) or a variant icon
    // case is a trait every adapter must render, or the ledger flags a silent drop.
    if (node.icon || Object.keys(this.variantData(node)?.iconCases ?? {}).length) t.push('icon');
    // D4a per-slot STATIC style traits (node.style only, never variant cases). Declared
    // one literal id per slot so R7 checks each slot separately per adapter. padding is
    // deliberately NOT declared (finding F-30: Compose drops static padding on input controls).
    if (node.style?.background) t.push('style=background');
    if (node.style?.radius) t.push('style=radius');
    return t;
  }

  /** True if the node's control-state options array declares a per-option `icon`
   *  field (F-25 rich options). Looks the options prop up in the IR props. */
  hasOptionIcons(node) {
    if (node.input?.state?.kind !== 'selected-value') return false;
    const optName = node.input.state.options;
    if (!optName) return false;
    const p = (this.ir.props || []).find((x) => x.name === optName && x.type === 'array');
    return !!(p && p.itemShape && 'icon' in p.itemShape);
  }

  /**
   * Normalize a number-format value (kind=format, F-11 precision + F-12 locale /
   * currency / grouping / rounding). Each option is a valueRef { kind, value }
   * (a static literal or a plain prop ref) or undefined. Adapters read this and
   * emit ONE native formatter call (Intl / NumberFormatter / NumberFormat).
   * @returns {null | { value, style, currency, locale, grouping, rounding, precision }}
   */
  numberFormat(vr) {
    if (!vr || vr.kind !== 'format') return null;
    const f = vr.format || {};
    // A scalar is a literal; a { kind, value } object is a (plain) ref.
    const opt = (x) => (x == null ? undefined
      : (typeof x === 'object' && 'kind' in x ? { kind: x.kind, value: x.value } : { kind: 'literal', value: x }));
    return {
      // The number source: a numeric literal, else a prop ref.
      value: typeof vr.value === 'number' ? { kind: 'literal', value: vr.value } : { kind: 'ref', value: vr.value },
      style: f.style === 'currency' ? 'currency' : 'decimal',
      currency: opt(f.currency),
      locale: opt(f.locale),
      grouping: opt(f.grouping),
      rounding: opt(f.rounding),   // 'round' | 'floor' | 'ceil'
      precision: opt(f.precision),
    };
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
    return { kind: s.kind, value: i.valueProp, change: i.changeProp, min: s.min, max: s.max, step: s.step, options: s.options };
  }

  /**
   * TS-1 callback signatures. Derives, for every `function` prop, how its callback is typed and called:
   *   - ARITY from the prop NAME (the convention React, React Native and SwiftUI share): a name matching
   *     /change/i takes the new value, any other name takes none and is called without arguments;
   *   - VALUE TYPE from the control the callback is bound to (`input.changeProp`), see inputValueKind().
   * A value-taking callback bound to no control defaults to 'string'. Used by the React adapter only (the
   * other adapters keep their own typing until their own PRs; there is no cross-adapter signature gate).
   * @returns {Map<string, { takesValue: boolean, valueType: 'boolean'|'number'|'string' }>}
   */
  callbackSignatures() {
    const bound = new Map();
    this.irNodes(this.ir.root, (n) => {
      if (n.kind === 'input' && n.input?.changeProp && !bound.has(n.input.changeProp)) bound.set(n.input.changeProp, this.inputValueKind(n));
    });
    const out = new Map();
    for (const p of this.ir.props ?? []) {
      if (p.type === 'function') out.set(p.name, { takesValue: /change/i.test(p.name), valueType: bound.get(p.name) ?? 'string' });
    }
    return out;
  }

  /**
   * The kind of value an input control hands its change callback:
   *   boolean state, or a checkbox / switch (role or inputType) -> 'boolean';
   *   numeric-range state, or a slider role or number inputType  -> 'number';
   *   selected-value state, a select, a text field or anything else -> 'string'.
   */
  inputValueKind(node) {
    const cs = this.controlState(node);
    if (cs) return { boolean: 'boolean', 'numeric-range': 'number', 'selected-value': 'string' }[cs.kind] ?? 'string';
    const t = node.input?.inputType;
    if (node.role === 'checkbox' || node.role === 'switch' || t === 'checkbox') return 'boolean';
    if (node.role === 'slider' || t === 'number') return 'number';
    return 'string';
  }

  /** Depth-first walk of the IR tree. */
  irNodes(node, fn) {
    fn(node);
    for (const c of node.children ?? []) this.irNodes(c, fn);
  }

  /**
   * Build the JS `Intl.NumberFormat(...).format(...)` expression for a normalized
   * number-format descriptor. Shared by every web adapter and React Native (all
   * have a native Intl). Precision + the four F-12 dimensions compose into ONE
   * formatter call. Pure string builder — the caller records the ledger trait.
   */
  intlFormatExpr(fmt) {
    // literal -> a JS literal (number/string/bool via JSON); ref -> the identifier.
    const jsv = (o) => (o.kind === 'literal' ? JSON.stringify(o.value) : String(o.value));
    const ROUND = { round: 'halfExpand', floor: 'floor', ceil: 'ceil' };
    const opts = [`style: ${JSON.stringify(fmt.style)}`];
    if (fmt.style === 'currency' && fmt.currency) opts.push(`currency: ${jsv(fmt.currency)}`);
    if (fmt.grouping) opts.push(`useGrouping: ${jsv(fmt.grouping)}`);
    if (fmt.rounding) {
      const rm = fmt.rounding.kind === 'literal'
        ? JSON.stringify(ROUND[fmt.rounding.value] ?? 'halfExpand')
        : `({ round: 'halfExpand', floor: 'floor', ceil: 'ceil' }[${fmt.rounding.value}])`;
      opts.push(`roundingMode: ${rm}`);
    }
    if (fmt.precision) opts.push(`minimumFractionDigits: ${jsv(fmt.precision)}, maximumFractionDigits: ${jsv(fmt.precision)}`);
    const locale = fmt.locale ? jsv(fmt.locale) : 'undefined';
    return `new Intl.NumberFormat(${locale}, { ${opts.join(', ')} }).format(${jsv(fmt.value)})`;
  }

  /**
   * Normalize a date/time-format value (kind=datetime, F-26). dateStyle/timeStyle
   * are native presets (literals); locale is a static literal or a plain prop ref.
   * @returns {null | { value, dateStyle, timeStyle, locale }}
   */
  dateFormat(vr) {
    if (!vr || vr.kind !== 'datetime') return null;
    const f = vr.dateFormat || {};
    const opt = (x) => (x == null ? undefined
      : (typeof x === 'object' && 'kind' in x ? { kind: x.kind, value: x.value } : { kind: 'literal', value: x }));
    return {
      value: { kind: 'ref', value: vr.value },  // the date source (a date prop)
      dateStyle: f.dateStyle,                     // 'short' | 'medium' | 'long' (preset)
      timeStyle: f.timeStyle,                     // 'short' | 'medium' | 'long' (preset)
      locale: opt(f.locale),
      timeZone: opt(f.timeZone),                  // F-27: IANA id literal or plain ref
    };
  }

  /**
   * Build the JS `Intl.DateTimeFormat(...).format(...)` expression for a date
   * descriptor. Shared by every web adapter and React Native. Presets only
   * (dateStyle/timeStyle); no custom pattern string. Pure string builder.
   */
  intlDateExpr(fmt) {
    const jsv = (o) => (o.kind === 'literal' ? JSON.stringify(o.value) : String(o.value));
    const opts = [];
    if (fmt.dateStyle) opts.push(`dateStyle: ${JSON.stringify(fmt.dateStyle)}`);
    if (fmt.timeStyle) opts.push(`timeStyle: ${JSON.stringify(fmt.timeStyle)}`);
    // F-27 timezone: a literal id is schema-validated, so emit it directly (the
    // same engine that validated it runs it). A runtime prop-ref is guarded by
    // __dtfTimeZone, which returns the id only if Intl accepts it, else undefined
    // (= device timezone) — never a RangeError throw.
    if (fmt.timeZone) {
      if (fmt.timeZone.kind === 'literal') opts.push(`timeZone: ${JSON.stringify(fmt.timeZone.value)}`);
      else { this.usesTzGuard = true; opts.push(`timeZone: __dtfTimeZone(${fmt.timeZone.value})`); }
    }
    const locale = fmt.locale ? jsv(fmt.locale) : 'undefined';
    return `new Intl.DateTimeFormat(${locale}, { ${opts.join(', ')} }).format(${jsv(fmt.value)})`;
  }

  /** The web/RN runtime timezone guard helper source (F-27), emitted once per
   *  component when a prop-ref timeZone is present. */
  tzGuardHelper() {
    return `function __dtfTimeZone(tz: string | undefined): string | undefined {\n`
      + `  if (!tz) return undefined;\n`
      + `  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return undefined; }\n`
      + `}\n`;
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

  // --- Conditional (F-3 shapes 1-3; F-13 nested / else-if / per-item) --------
  // Adapters implement `condChainRender(branches, elseBody)`:
  //   branches  = [{ when, body, node }]  one entry per if / else-if clause
  //   elseBody  = the final `else` body string, or null (one-way / chain w/o else)
  // and return the platform conditional WITHOUT any top-level JSX wrapper.
  // JSX adapters additionally override `wrapTopConditional` to add the single
  // `{…}` expression container at the outermost position (never on a nested one).
  condChainRender(_branches, _elseBody) { throw new Error('condChainRender not implemented'); }
  /** JSX child wrapper for the OUTERMOST conditional; block adapters need none. */
  wrapTopConditional(str, _node) { return str; }

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
   * Render a conditional node (F-3 shapes 1-3 + F-13 nested / else-if / per-item).
   * children[0] is the `then` branch; optional children[1] is the `else` branch.
   *
   * Two kinds of nesting compose here, both from the fact that a branch is just a
   * normal node:
   *   - nested-in-then : a `then` (or `else`) branch that is itself a conditional
   *     recurses through `branchBody` → `renderCond`, producing native nested
   *     if/else. The recursion returns the BARE inner conditional (no JSX
   *     wrapper) so a JSX adapter never emits a `{…}` inside another `{…}`.
   *   - else-if chain  : an `else` branch that is a conditional is flattened into
   *     successive `{when, body}` clauses so the adapter can emit the platform's
   *     native else-if (`v-else-if` / `{:else if}` / `else if`), not deep nesting.
   * The outermost conditional gets the single JSX wrapper via `wrapTopConditional`.
   */
  visitConditional(node) {
    return this.wrapTopConditional(this.renderCond(node), node);
  }

  /** Bare (unwrapped) render of a conditional: flatten else-if, recurse nesting. */
  renderCond(node) {
    const branches = [];
    let cur = node;
    let elseBody = null;
    // Flatten an else-if chain: keep collecting clauses while the else is a conditional.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const kids = cur.children ?? [];
      const thenNode = kids[0] ?? null;
      const elseNode = kids.length > 1 ? kids[1] : null;
      branches.push({ when: cur.when, node: cur, body: thenNode ? this.branchBody(thenNode) : '' });
      if (elseNode && elseNode.kind === 'conditional') { cur = elseNode; continue; }
      elseBody = elseNode ? this.branchBody(elseNode) : null;
      break;
    }
    return this.condChainRender(branches, elseBody);
  }

  /** A branch body: a nested conditional recurses bare; any other node renders normally. */
  branchBody(node) {
    return node.kind === 'conditional' ? this.renderCond(node) : this.renderNode(node);
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
