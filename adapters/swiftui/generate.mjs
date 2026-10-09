#!/usr/bin/env node
/** SwiftUI adapter — a View struct using DesignTokens + SF Symbols. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererBase, indent } from '../_shared/renderer-base.mjs';
import { specToIrFromFile } from '../../_shared/scripts/spec-to-ir.mjs';
import { mapToken, MODIFIER } from './token-map.mjs';
import { iconMap } from './icon-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

/** Extract the first meaningful JS identifier from an expression (native cannot eval JS). */
const firstIdent = (expr) => (String(expr).match(/[A-Za-z_][A-Za-z0-9_$]*/) || ['value'])[0];
/** Swift reserved words that cannot be bare identifiers. */
const RESERVED = new Set(['default', 'class', 'struct', 'enum', 'protocol', 'return', 'case', 'let', 'var']);
const safe = (id) => (RESERVED.has(id) ? `\`${id}\`` : id);

class SwiftUIRenderer extends RendererBase {
  // F-12 number formatting — NumberFormatter (locale / currency / grouping /
  // rounding / precision compose into one formatter). Extends the F-11 precision
  // path with the same NumberFormatter construction, now fully configurable.
  formatNumber(fmt) {
    const sv = (o) => (o.kind === 'literal' ? JSON.stringify(String(o.value)) : safe(o.value));
    const boolv = (o) => (o.kind === 'literal' ? String(!!o.value) : safe(o.value));
    const intv = (o) => (o.kind === 'literal' ? `${parseInt(o.value, 10)}` : `Int(${safe(o.value)})`);
    const num = fmt.value.kind === 'literal' ? `${fmt.value.value}` : safe(fmt.value.value);
    const ROUND = { round: '.halfUp', floor: '.floor', ceil: '.ceiling' };
    const lines = ['let f = NumberFormatter()', `f.numberStyle = .${fmt.style === 'currency' ? 'currency' : 'decimal'}`];
    if (fmt.locale) lines.push(`f.locale = Locale(identifier: ${sv(fmt.locale)})`);
    if (fmt.style === 'currency' && fmt.currency) lines.push(`f.currencyCode = ${sv(fmt.currency)}`);
    if (fmt.grouping) lines.push(`f.usesGroupingSeparator = ${boolv(fmt.grouping)}`);
    if (fmt.rounding) {
      const r = fmt.rounding;
      lines.push(`f.roundingMode = ${r.kind === 'literal'
        ? (ROUND[r.value] ?? '.halfUp')
        : `${safe(r.value)} == "floor" ? .floor : ${safe(r.value)} == "ceil" ? .ceiling : .halfUp`}`);
    }
    if (fmt.precision) { const p = intv(fmt.precision); lines.push(`f.minimumFractionDigits = ${p}`, `f.maximumFractionDigits = ${p}`); }
    lines.push(`return f.string(from: NSNumber(value: ${num})) ?? String(${num})`);
    return `SwiftUI.Text({ ${lines.join('; ')} }())`;
  }
  // F-26 date/time formatting — DateFormatter (dateStyle / timeStyle presets +
  // locale). Mirrors the NumberFormatter approach; presets only, no custom pattern.
  formatDate(fmt) {
    const sv = (o) => (o.kind === 'literal' ? JSON.stringify(String(o.value)) : safe(o.value));
    const STYLE = { short: '.short', medium: '.medium', long: '.long' };
    const src = safe(fmt.value.value);
    const lines = ['let f = DateFormatter()'];
    if (fmt.locale) lines.push(`f.locale = Locale(identifier: ${sv(fmt.locale)})`);
    lines.push(`f.dateStyle = ${fmt.dateStyle ? STYLE[fmt.dateStyle] : '.none'}`);
    lines.push(`f.timeStyle = ${fmt.timeStyle ? STYLE[fmt.timeStyle] : '.none'}`);
    // F-27 timezone: TimeZone(identifier:) returns nil for an unknown id, so fall
    // back to .current (device) — identical device fallback as the other adapters.
    if (fmt.timeZone) lines.push(`f.timeZone = TimeZone(identifier: ${sv(fmt.timeZone)}) ?? .current`);
    lines.push(`return f.string(from: ${src})`);
    return `SwiftUI.Text({ ${lines.join('; ')} }())`;
  }
  textExpr(vr) {
    if (!vr) return 'SwiftUI.Text("")';
    if (vr.kind === 'literal') return `SwiftUI.Text(${JSON.stringify(String(vr.value))})`;
    if (vr.kind === 'format') { this.express('number-format', { mechanism: 'NumberFormatter' }); return this.formatNumber(this.numberFormat(vr)); }
    if (vr.kind === 'datetime') {
      const df = this.dateFormat(vr);
      this.express('date-format', { mechanism: 'DateFormatter' });
      if (df.timeZone) this.express('date-timezone', { mechanism: 'DateFormatter.timeZone = TimeZone(identifier:) ?? .current' });
      return this.formatDate(df);
    }
    if (vr.kind === 'ref') return `SwiftUI.Text(String(describing: ${safe(vr.value)}))`;
    // F-11 (precision-only): `<num>.toFixed(<precision>)` -> a real native decimal
    // formatter with `precision` fraction digits. No locale / grouping / currency
    // / rounding-mode — that is a separate future pass (F-12).
    const fx = String(vr.value).trim().match(/^([A-Za-z_$][\w$]*)\.toFixed\(([A-Za-z_$][\w$]*)\)$/);
    if (fx) {
      const [, num, prec] = fx;
      return `SwiftUI.Text({ let f = NumberFormatter(); f.numberStyle = .decimal; f.usesGroupingSeparator = false; f.minimumFractionDigits = Int(${safe(prec)}); f.maximumFractionDigits = Int(${safe(prec)}); return f.string(from: NSNumber(value: ${safe(num)})) ?? String(${safe(num)}) }())`;
    }
    const id = firstIdent(vr.value);
    this.warnings.push(`expr simplified to \`${id}\` (native cannot eval "${vr.value}")`);
    return `SwiftUI.Text(String(describing: ${safe(id)}))`;
  }
  interp(vr) { return this.textExpr(vr); }
  modifiers(node) {
    const out = [];
    if (node.style) {
      for (const [slot, token] of Object.entries(node.style)) {
        if (MODIFIER[slot]) out.push(`\n  ${MODIFIER[slot](mapToken(token))}`);
        // D4a: per-slot static style traits (variant cases are not counted; padding is not a ledger trait, F-30).
        if (slot === 'background') this.express('style=background', { mechanism: '.background (static style)' });
        if (slot === 'radius') this.express('style=radius', { mechanism: '.cornerRadius (static style)' });
      }
    }
    // F-7 size slot: a dimension TOKEN drives .frame(width:height:) (never a literal).
    if (node.size) {
      out.push(`\n  .frame(width: ${mapToken(node.size)}, height: ${mapToken(node.size)})`);
      this.express('size', { mechanism: '.frame(width:height:) (dimension token)' });
    }
    const v = this.variantData(node);
    if (v) {
      // .foregroundColor cascades to child Text in SwiftUI, so a container-level
      // color variant is honored natively here.
      const slots = new Set();
      for (const s of Object.values(v.styleCases)) for (const k of Object.keys(s)) slots.add(k);
      // Per slot kind: colour slots fall back to a Color, padding / radius to a CGFloat 0 (the dictionary values are CGFloat tokens).
      const fallback = { background: 'SwiftUI.Color.clear', color: 'SwiftUI.Color.primary', padding: '0', radius: '0' };
      for (const slot of slots) {
        if (!MODIFIER[slot]) continue;
        const dict = Object.entries(v.styleCases)
          .filter(([, s]) => s[slot])
          .map(([val, s]) => `${JSON.stringify(val)}: ${mapToken(s[slot])}`)
          .join(', ');
        const expr = `([${dict}][${safe(v.prop)}] ?? ${fallback[slot]})`;
        out.push(`\n  ${MODIFIER[slot](expr)}`);
      }
    }
    return out.join('');
  }
  a11y(node) {
    const out = [];
    if (node.a11y?.label) {
      const l = node.a11y.label;
      const v = l.kind === 'literal' ? JSON.stringify(String(l.value)) : safe(l.value);
      out.push(`\n  .accessibilityLabel(${v})`);
      this.express('a11y.label', { mechanism: '.accessibilityLabel' });
    }
    // D4a: labelledBy needs a target element id and ids are not plumbed to referenced elements yet, so the
    // native equivalent could point to nothing. Emit nothing; time-boxed waiver until id plumbing exists (see docs/audits).
    if (node.a11y?.labelledBy) {
      this.diverge('a11y.labelledBy', { reason: 'the SwiftUI label relationship needs the referenced element and ids are not plumbed to referenced elements yet', fallback: 'nothing emitted until id plumbing exists', waiver: 'a11y-labelledby-swiftui' });
      this.warnings.push('a11y: labelledBy is not emitted (no id plumbing to the referenced element yet; documented divergence)');
    }
    // Map ARIA-style role + live to SwiftUI accessibility traits — never a silent drop.
    const TRAIT = { img: '.isImage', button: '.isButton', header: '.isHeader', link: '.isLink' };
    if (node.role && TRAIT[node.role]) {
      out.push(`\n  .accessibilityAddTraits(${TRAIT[node.role]})`);
      this.express(`role=${node.role}`, { mechanism: `.accessibilityAddTraits(${TRAIT[node.role]})` });
    } else if (node.role && ['presentation', 'none'].includes(node.role)) {
      this.express(`role=${node.role}`, { mechanism: 'decorative (SwiftUI default: no a11y role)' });
    } else if (node.role) {
      this.diverge(`role=${node.role}`, { reason: `no direct SwiftUI trait for role "${node.role}"`, fallback: 'label / live updates convey the role', waiver: `a11y-role-${node.role}` });
      this.warnings.push(`a11y: role "${node.role}" has no direct SwiftUI trait; conveyed via label / updates where present (documented divergence)`);
    }
    // F-28: SwiftUI has no declarative live region. .updatesFrequently only tells the system the
    // element may be polled (it does not announce changes), so NOTHING is emitted for any value.
    // off is correctly expressed by omission; polite/assertive are waived divergences (a spoken
    // announcement needs the imperative AccessibilityNotification.Announcement, future work).
    if (node.a11y?.live) {
      const live = node.a11y.live;
      if (live === 'off') this.express('a11y.live=off', { mechanism: 'omitted (no live region = off)' });
      else {
        this.diverge(`a11y.live=${live}`, { reason: 'SwiftUI has no declarative live region; .updatesFrequently does not announce changes', fallback: 'nothing emitted', waiver: `a11y-live-${live}-swiftui` });
        this.warnings.push(`a11y: live "${live}" has no declarative SwiftUI live region; nothing emitted (documented divergence)`);
      }
    }
    return out.join('');
  }
  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    this.express('icon', { mechanism: 'variant icon cases (Image(systemName:))' });
    const dict = Object.entries(v.iconCases)
      .map(([val, tok]) => `${JSON.stringify(val)}: ${JSON.stringify(this.icon(tok))}`)
      .join(', ');
    return `SwiftUI.Image(systemName: ([${dict}][${safe(v.prop)}] ?? ""))\n  .accessibilityHidden(true)`;
  }
  // F-4 orientation: the container's main layout axis. horizontal -> HStack,
  // vertical (or unset) -> VStack. Express the trait when the IR declares it.
  visitContainer(node, children) {
    const lead = this.variantIcon(node);
    const inner = lead ? `${lead}\n${children}` : children;
    const horizontal = node.orientation === 'horizontal';
    if (node.orientation) this.express(`orientation=${node.orientation}`, { mechanism: `${horizontal ? 'HStack' : 'VStack'} layout axis` });
    const stack = horizontal
      ? `SwiftUI.HStack(alignment: .center, spacing: 8)`
      : `SwiftUI.VStack(alignment: .leading, spacing: 8)`;
    return `${stack} {\n${indent(inner, 2)}\n}${this.modifiers(node)}${this.a11y(node)}`;
  }
  visitMedia(node) {
    const url = node.src.kind === 'literal' ? JSON.stringify(String(node.src.value)) : safe(node.src.value);
    return `SwiftUI.AsyncImage(url: URL(string: ${url}))${this.modifiers(node)}${this.a11y(node)}`;
  }
  visitHeading(node) {
    const font = ['', '.largeTitle', '.title', '.title2', '.title3', '.headline', '.subheadline'][node.level ?? 3];
    return `${this.textExpr(node.text)}\n  .font(${font})${this.modifiers(node)}`;
  }
  visitText(node) {
    return `${this.textExpr(node.text)}${this.modifiers(node)}${this.a11y(node)}`;
  }
  // F-5 boolean-attribute binding: a caller boolean flag ref -> .disabled().
  disabledMod(node) {
    if (!node.disabled) return '';
    this.express('disabled', { mechanism: '.disabled(flag)' });
    return `\n  .disabled(${safe(node.disabled)})`;
  }
  visitAction(node) {
    const action = node.onEvent ? safe(node.onEvent) : '{}';
    if (node.icon) this.express('icon', { mechanism: 'action icon (Label systemImage)' });
    const label = node.icon
      ? `SwiftUI.Label(${this.plain(node.label)}, systemImage: "${this.icon(node.icon)}")`
      : this.textExpr(node.label);
    return `SwiftUI.Button(action: ${action}) {\n  ${label}\n}${this.disabledMod(node)}${this.modifiers(node)}${this.a11y(node)}`;
  }
  visitIcon(node) {
    const sym = this.icon(node.icon);
    this.express('icon', { mechanism: 'Image(systemName:)' });
    if (node.a11y?.label) {
      const l = node.a11y.label;
      const v = l.kind === 'literal' ? JSON.stringify(String(l.value)) : safe(l.value);
      return `SwiftUI.Image(systemName: "${sym}")\n  .accessibilityLabel(${v})`;
    }
    return `SwiftUI.Image(systemName: "${sym}")\n  .accessibilityHidden(true)`;
  }

  visitLink(node) {
    if (node.href) this.express('link-href', { mechanism: 'Link(destination: URL)' });
    const url = node.href.kind === 'literal' ? JSON.stringify(String(node.href.value)) : safe(node.href.value);
    // A ref label must bind the variable, not emit its own name as a literal
    // (mirrors the url handling above; parity enforces this).
    const label = node.label ? (node.label.kind === 'literal' ? JSON.stringify(String(node.label.value)) : safe(node.label.value)) : '""';
    return `SwiftUI.Link(${label}, destination: URL(string: ${url})!)${this.modifiers(node)}`;
  }
  // Callback arity is declared by the prop NAME (the convention React and React Native share): a name
  // matching /change/i takes the new value, any other name takes none and is called without arguments.
  takesValue(name) { return /change/i.test(name); }
  setter(name) { return this.takesValue(name) ? `{ ${safe(name)}($0) }` : `{ _ in ${safe(name)}() }`; }
  binding(getName, changeName) { return `SwiftUI.Binding(get: { ${safe(getName)} }, set: ${this.setter(changeName)})`; }
  // The value a bound control hands its callback, mirroring the branches of visitInput:
  // boolean state or checkbox / switch role -> Bool, numeric-range state or slider role -> Double,
  // selected-value state or a plain text field -> String.
  inputValueType(node) {
    const cs = this.controlState(node);
    if (cs) return { boolean: 'Bool', 'numeric-range': 'Double', 'selected-value': 'String' }[cs.kind];
    if (node.role === 'checkbox' || node.role === 'switch') return 'Bool';
    if (node.role === 'slider') return 'Double';
    return 'String';
  }
  walkIr(node, fn) { fn(node); for (const c of node.children ?? []) this.walkIr(c, fn); }
  callbackValueTypes() {
    const types = new Map();
    this.walkIr(this.ir.root, (n) => {
      if (n.kind === 'input' && n.input?.changeProp && !types.has(n.input.changeProp)) types.set(n.input.changeProp, this.inputValueType(n));
    });
    return types;
  }
  plain(vr, fallback = '""') {
    if (!vr) return fallback;
    return vr.kind === 'literal' ? JSON.stringify(String(vr.value)) : safe(vr.value);
  }
  // Control-state primitive — controlled (caller-held) two-way binding. The
  // @Binding is constructed from the caller's value + handler, so the caller
  // holds the source of truth (controlled-only).
  renderControlState(node, cs) {
    const role = node.role;
    const title = this.plain(node.label ?? node.a11y?.label);
    if (node.a11y?.label) this.express('a11y.label', { mechanism: 'label (accessible name)' });
    if (node.a11y?.describedBy) this.diverge('a11y.describedBy', { reason: 'SwiftUI has no aria-describedby', fallback: '.accessibilityHint / adjacent Text', waiver: 'a11y-describedby-native' });
    if (node.a11y?.labelledBy) this.diverge('a11y.labelledBy', { reason: 'the SwiftUI label relationship needs the referenced element and ids are not plumbed to referenced elements yet', fallback: 'nothing emitted until id plumbing exists', waiver: 'a11y-labelledby-swiftui' });
    if (node.a11y?.invalid) this.diverge('a11y.invalid', { reason: 'SwiftUI has no direct aria-invalid trait', fallback: 'label / adjacent error Text conveys the invalid state', waiver: 'a11y-invalid-swiftui' });
    const num = (v) => (typeof v === 'number' ? String(v) : safe(String(v)));
    const bind = this.binding(cs.value, cs.change);
    if (cs.kind === 'boolean') {
      // Toggle is SwiftUI's control for both checkbox and switch; it conveys the role.
      if (role) this.express(`role=${role}`, { mechanism: 'Toggle conveys the on/off role' });
      this.express('state=boolean', { mechanism: 'Toggle(isOn: @Binding get/set from caller)' });
      return `SwiftUI.Toggle(${title}, isOn: ${bind})${this.modifiers(node)}`;
    }
    if (cs.kind === 'selected-value') {
      if (role === 'radiogroup') this.express('role=radiogroup', { mechanism: 'Picker (single-select group)' });
      else if (role) this.diverge(`role=${role}`, { reason: `no direct SwiftUI trait for role "${role}"`, fallback: 'Picker conveys single-select', waiver: `a11y-role-${role}` });
      this.express('state=selected-value', { mechanism: 'Picker(selection: @Binding) + ForEach options with .tag (native match, no expression)' });
      // F-25 rich options: a Label(title, systemImage:) renders a decorative SF
      // Symbol (resolved at runtime from the icon-token registry) beside the label.
      const rich = this.hasOptionIcons(node);
      if (rich) { this.usesOptionIcons = true; this.express('option-icon', { mechanism: 'Label(systemImage:) SF Symbol via runtime registry (decorative)' }); }
      const row = rich
        ? `SwiftUI.Label(opt.label, systemImage: Self.optionIconSymbols[opt.icon] ?? "").tag(opt.value)`
        : `SwiftUI.Text(opt.label).tag(opt.value)`;
      const items = cs.options
        ? `\n  SwiftUI.ForEach(${safe(cs.options)}, id: \\.value) { opt in\n    ${row}\n  }\n`
        : `\n  // options supplied by the component\n`;
      return `SwiftUI.Picker(${title}, selection: ${bind}) {${items}}${this.modifiers(node)}`;
    }
    // numeric-range: a Stepper number input (inputType=number, NumberInput) or a Slider.
    const stepArg = cs.step != null ? `, step: ${num(cs.step)}` : '';
    const numberField = node.input?.inputType === 'number';
    if (!numberField) {
      if (role === 'slider') this.express('role=slider', { mechanism: 'Slider conveys the adjustable role' });
      else if (role) this.diverge(`role=${role}`, { reason: `no direct SwiftUI trait for role "${role}"`, fallback: 'Slider conveys the adjustable value', waiver: `a11y-role-${role}` });
      this.express('state=numeric-range', { mechanism: 'Slider(value: @Binding, in: min...max, step:)' });
      // Slider has no title argument, so the visible label rides an explicit modifier.
      const labelMod = node.label ? `\n  .accessibilityLabel(${title})` : '';
      return `SwiftUI.Slider(value: ${bind}, in: ${num(cs.min)}...${num(cs.max)}${stepArg})${labelMod}${this.modifiers(node)}`;
    }
    if (role) this.diverge(`role=${role}`, { reason: `no direct SwiftUI trait for role "${role}"`, fallback: 'Stepper conveys the numeric value', waiver: `a11y-role-${role}` });
    this.express('state=numeric-range', { mechanism: 'Stepper(value: @Binding, in: min...max, step:) — no formatting' });
    return `SwiftUI.Stepper(${title}, value: ${bind}, in: ${num(cs.min)}...${num(cs.max)}${stepArg})${this.modifiers(node)}`;
  }

  visitInput(node) {
    const i = node.input ?? {};
    const cs = this.controlState(node);
    if (cs) return this.renderControlState(node, cs);
    const role = node.role;
    const title = this.plain(node.label ?? node.a11y?.label);
    if (node.a11y?.describedBy) this.diverge('a11y.describedBy', { reason: 'SwiftUI has no aria-describedby', fallback: '.accessibilityHint / adjacent Text', waiver: 'a11y-describedby-native' });
    if (node.a11y?.labelledBy) this.diverge('a11y.labelledBy', { reason: 'the SwiftUI label relationship needs the referenced element and ids are not plumbed to referenced elements yet', fallback: 'nothing emitted until id plumbing exists', waiver: 'a11y-labelledby-swiftui' });
    if (node.a11y?.invalid) this.diverge('a11y.invalid', { reason: 'SwiftUI has no direct aria-invalid trait', fallback: 'label / adjacent error Text conveys the invalid state', waiver: 'a11y-invalid-swiftui' });

    // Real form controls for the toggle / adjustable roles — never a bare TextField.
    if (role === 'checkbox' || role === 'switch') {
      const bind = i.changeProp
        ? this.binding(i.valueProp ?? 'checked', i.changeProp)
        : `$${safe(i.valueProp ?? 'checked')}`;
      this.express(`role=${role}`, { mechanism: 'Toggle (isOn binding)' });
      // The Toggle's title label IS its accessible name.
      if (node.a11y?.label) this.express('a11y.label', { mechanism: 'Toggle title label (accessible name)' });
      return `SwiftUI.Toggle(${title}, isOn: ${bind})${this.modifiers(node)}`;
    }
    if (role === 'slider') {
      const bind = i.changeProp
        ? this.binding(i.valueProp ?? 'value', i.changeProp)
        : `$${safe(i.valueProp ?? 'value')}`;
      this.express(`role=${role}`, { mechanism: 'Slider (value binding)' });
      // Slider has no title argument, so the label rides an explicit modifier.
      let labelMod = '';
      if (node.a11y?.label) { labelMod = `\n  .accessibilityLabel(${title})`; this.express('a11y.label', { mechanism: '.accessibilityLabel' }); }
      return `SwiftUI.Slider(value: ${bind})${labelMod}${this.modifiers(node)}`;
    }

    // Wire the controlled value+onChange contract through a custom Binding.
    const binding = i.changeProp
      ? this.binding(i.valueProp ?? 'value', i.changeProp)
      : `$${safe(i.valueProp ?? 'value')}`;
    if (node.a11y?.label) this.express('a11y.label', { mechanism: 'TextField title label (accessible name)' });
    if (role) {
      // A generic role on a text field has no SwiftUI trait — account for it honestly.
      this.diverge(`role=${role}`, { reason: `no direct SwiftUI trait for role "${role}"`, fallback: 'label conveys intent', waiver: `a11y-role-${role}` });
    }
    // F-19 textarea: a multi-line TextField grows vertically (axis: .vertical).
    let axis = '';
    if (i.multiline) { axis = ', axis: .vertical'; this.express('input.multiline', { mechanism: 'TextField(axis: .vertical)' }); }
    return `SwiftUI.TextField(${title}, text: ${binding}${axis})${this.modifiers(node)}`;
  }
  visitSlot() { return 'content'; }
  wrapConditional(node, rendered) {
    const prop = this.ir.props.find((p) => p.name === node.when);
    const w = safe(node.when);
    // An optional value (String?, closure?, ...) can't be used as a Bool;
    // bind-unwrap it. The bound name shadows the optional inside the block.
    if (prop && prop.required === false) {
      return `if let ${w} = ${w} {\n${indent(rendered, 2)}\n}`;
    }
    return `if ${w} {\n${indent(rendered, 2)}\n}`;
  }

  // Native SwiftUI if / else if / else. A plain boolean flag prop is tested
  // directly; an optional flag prop is bind-unwrapped (`if let`); a per-item
  // boolean field (`item.active`) is a direct native Bool read (`if item.active`).
  condHead(when, kw) {
    const prop = this.ir.props.find((p) => p.name === when);
    const w = safe(when);
    if (prop && prop.required === false) return `${kw} let ${w} = ${w}`;
    return `${kw} ${w}`;
  }
  condChainRender(branches, elseBody) {
    let s = `${this.condHead(branches[0].when, 'if')} {\n${indent(branches[0].body, 2)}\n}`;
    for (let i = 1; i < branches.length; i++) {
      s += ` ${this.condHead(branches[i].when, 'else if')} {\n${indent(branches[i].body, 2)}\n}`;
    }
    if (elseBody != null) s += ` else {\n${indent(elseBody, 2)}\n}`;
    return s;
  }
  wrapIteration(node, rendered) {
    const { items, as, key } = node.each;
    return `SwiftUI.ForEach(${safe(items)}, id: \\.${key}) { ${safe(as)} in\n${indent(rendered, 2)}\n}`;
  }
  swiftType(prop) {
    const opt = prop.required === false;
    switch (prop.type) {
      case 'number': return opt ? 'Double?' : 'Double';
      case 'boolean': return opt ? 'Bool?' : 'Bool';
      case 'date': return opt ? 'Date?' : 'Date';
      case 'function': {
        const base = this.takesValue(prop.name) ? `(${this.cbTypes.get(prop.name) ?? 'String'}) -> Void` : '() -> Void';
        return opt ? `(${base})?` : base;
      }
      case 'enum': return opt ? 'String?' : 'String';
      case 'array': return `[${this.ir.component}Item]`;
      default: return opt ? 'String?' : 'String';
    }
  }
  renderComponent(root) {
    const name = this.ir.component;
    this.cbTypes = this.callbackValueTypes();
    let hasSlot = false;
    this.walkIr(this.ir.root, (n) => { if (n.kind === 'slot') hasSlot = true; });
    const stored = this.ir.props
      .map((p) => (p.type === 'function' ? `  let ${safe(p.name)}: ${this.swiftType(p)}` : `  let ${safe(p.name)}: ${this.swiftType(p)}`))
      .join('\n');
    const arrayProp = this.ir.props.find((p) => p.type === 'array');
    const hasId = arrayProp?.itemShape && 'id' in arrayProp.itemShape;
    const itemStruct = arrayProp?.itemShape
      ? `struct ${name}Item: Identifiable {\n`
        + Object.entries(arrayProp.itemShape).map(([k, t]) => `  let ${k}: ${t === 'number' ? 'Double' : t === 'boolean' ? 'Bool' : 'String'}`).join('\n')
        // Only synthesize `id` when the shape does not already carry one (avoids
        // a stored/computed `id` collision, which recurses).
        + (hasId ? '' : `\n  let id = UUID().uuidString`)
        + `\n}\n\n`
      : '';
    // F-25: static registry mapping the known icon tokens to SF Symbol names
    // (private/static → excluded from the memberwise initializer).
    const optionIcons = this.usesOptionIcons
      ? `  static let optionIconSymbols: [String: String] = [${Object.entries(this.iconMap).map(([t, sym]) => `${JSON.stringify(t)}: ${JSON.stringify(sym)}`).join(', ')}]\n\n`
      : '';
    // A slot is a generic content view: one stored `content`, built by an @ViewBuilder closure.
    // Named slots collapse onto the same content (known limitation, no separate slot contract yet).
    let slotMembers = '';
    if (hasSlot) {
      const params = this.ir.props.map((p) => {
        const t = this.swiftType(p);
        return `${safe(p.name)}: ${p.type === 'function' && !t.endsWith('?') ? '@escaping ' : ''}${t}`;
      });
      const assigns = this.ir.props.map((p) => `self.${safe(p.name)} = ${safe(p.name)}`);
      slotMembers = `  let content: Content\n\n  init(${[...params, '@SwiftUI.ViewBuilder content: () -> Content'].join(', ')}) {\n${[...assigns, 'self.content = content()'].map((l) => `    ${l}`).join('\n')}\n  }`;
    }
    const generic = hasSlot ? '<Content: SwiftUI.View>' : '';
    return `import SwiftUI\n\n${itemStruct}struct ${name}${generic}: SwiftUI.View {\n${stored}${slotMembers ? `${stored ? '\n\n' : ''}${slotMembers}` : ''}\n\n${optionIcons}  var body: some SwiftUI.View {\n${indent(root, 4)}\n  }\n}\n`;
  }
}

export function generateSwiftUI(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new SwiftUIRenderer(ir, { iconMap, adapter: "swiftui" });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/swiftui', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.swift`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size, ledger: renderer.ledger };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`swiftui: wrote ${generateSwiftUI(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
