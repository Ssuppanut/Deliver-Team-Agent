#!/usr/bin/env node
/** Jetpack Compose adapter — a @Composable function using DesignTokens. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererBase, indent } from '../_shared/renderer-base.mjs';
import { specToIrFromFile } from '../../_shared/scripts/spec-to-ir.mjs';
import { mapToken } from './token-map.mjs';
import { iconMap } from './icon-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const firstIdent = (expr) => (String(expr).match(/[A-Za-z_][A-Za-z0-9_$]*/) || ['value'])[0];

class ComposeRenderer extends RendererBase {
  // F-12 number formatting — java.text.NumberFormat (locale / currency / grouping
  // / rounding / precision compose into one formatter). Extends the F-11 precision
  // path with the same NumberFormat construction, now fully configurable.
  formatNumber(fmt) {
    const sv = (o) => (o.kind === 'literal' ? JSON.stringify(String(o.value)) : o.value);
    const boolv = (o) => (o.kind === 'literal' ? String(!!o.value) : o.value);
    const intv = (o) => (o.kind === 'literal' ? `${parseInt(o.value, 10)}` : `${o.value}.toInt()`);
    const num = fmt.value.kind === 'literal' ? `${fmt.value.value}` : fmt.value.value;
    const ROUND = { round: 'HALF_UP', floor: 'FLOOR', ceil: 'CEILING' };
    const inst = fmt.style === 'currency' ? 'getCurrencyInstance' : 'getNumberInstance';
    const localeArg = fmt.locale ? `java.util.Locale.forLanguageTag(${sv(fmt.locale)})` : '';
    const app = [];
    if (fmt.style === 'currency' && fmt.currency) app.push(`currency = java.util.Currency.getInstance(${sv(fmt.currency)})`);
    if (fmt.grouping) app.push(`isGroupingUsed = ${boolv(fmt.grouping)}`);
    if (fmt.rounding) {
      const r = fmt.rounding;
      app.push(`roundingMode = ${r.kind === 'literal'
        ? `java.math.RoundingMode.${ROUND[r.value] ?? 'HALF_UP'}`
        : `when (${r.value}) { "floor" -> java.math.RoundingMode.FLOOR; "ceil" -> java.math.RoundingMode.CEILING; else -> java.math.RoundingMode.HALF_UP }`}`);
    }
    if (fmt.precision) { const p = intv(fmt.precision); app.push(`minimumFractionDigits = ${p}`, `maximumFractionDigits = ${p}`); }
    const applyBlock = app.length ? `.apply { ${app.join('; ')} }` : '';
    return `java.text.NumberFormat.${inst}(${localeArg})${applyBlock}.format(${num})`;
  }
  // F-26 date/time formatting — java.text.DateFormat (dateStyle / timeStyle presets
  // + locale). Mirrors the NumberFormat approach; presets only, no custom pattern.
  formatDate(fmt) {
    const sv = (o) => (o.kind === 'literal' ? JSON.stringify(String(o.value)) : o.value);
    const STYLE = { short: 'SHORT', medium: 'MEDIUM', long: 'LONG' };
    const src = fmt.value.value;
    const loc = fmt.locale ? `java.util.Locale.forLanguageTag(${sv(fmt.locale)})` : '';
    const D = fmt.dateStyle ? `java.text.DateFormat.${STYLE[fmt.dateStyle]}` : null;
    const T = fmt.timeStyle ? `java.text.DateFormat.${STYLE[fmt.timeStyle]}` : null;
    let inst;
    if (D && T) inst = `getDateTimeInstance(${D}, ${T}${loc ? `, ${loc}` : ''})`;
    else if (D) inst = `getDateInstance(${D}${loc ? `, ${loc}` : ''})`;
    else inst = `getTimeInstance(${T}${loc ? `, ${loc}` : ''})`;
    return `java.text.DateFormat.${inst}.format(${src})`;
  }
  strExpr(vr) {
    if (!vr) return '""';
    if (vr.kind === 'literal') return JSON.stringify(String(vr.value));
    if (vr.kind === 'format') { this.express('number-format', { mechanism: 'java.text.NumberFormat' }); return this.formatNumber(this.numberFormat(vr)); }
    if (vr.kind === 'datetime') { this.express('date-format', { mechanism: 'java.text.DateFormat' }); return this.formatDate(this.dateFormat(vr)); }
    if (vr.kind === 'ref') return vr.value;
    // F-11 (precision-only): `<num>.toFixed(<precision>)` -> a real native decimal
    // formatter with `precision` fraction digits. No locale / grouping / currency
    // / rounding-mode — that is a separate future pass (F-12).
    const fx = String(vr.value).trim().match(/^([A-Za-z_$][\w$]*)\.toFixed\(([A-Za-z_$][\w$]*)\)$/);
    if (fx) {
      const [, num, prec] = fx;
      return `java.text.NumberFormat.getNumberInstance().apply { isGroupingUsed = false; minimumFractionDigits = ${prec}.toInt(); maximumFractionDigits = ${prec}.toInt() }.format(${num})`;
    }
    const id = firstIdent(vr.value);
    this.warnings.push(`expr simplified to \`${id}\` (native cannot eval "${vr.value}")`);
    return `${id}.toString()`;
  }
  interp(vr) { return this.strExpr(vr); }
  /** Build a Modifier chain from style slots, excluding color (a Text param). */
  modifier(node) {
    const chain = [];
    if (node.style) {
      for (const [slot, token] of Object.entries(node.style)) {
        const t = mapToken(token);
        if (slot === 'background') chain.push(`.background(${t})`);
        else if (slot === 'padding') chain.push(`.padding(${t})`);
        else if (slot === 'radius') chain.push(`.clip(RoundedCornerShape(${t}))`);
      }
    }
    // F-7 size slot: a dimension TOKEN drives .size() (never a literal `.dp`).
    if (node.size) {
      chain.push(`.size(${mapToken(node.size)})`);
      this.express('size', { mechanism: '.size() (dimension token)' });
    }
    const v = this.variantData(node);
    if (v) {
      const whenExpr = (slot, fallback) => {
        const arms = Object.entries(v.styleCases)
          .filter(([, s]) => s[slot])
          .map(([val, s]) => `${JSON.stringify(val)} -> ${mapToken(s[slot])}`)
          .join('; ');
        return `when (${v.prop}) { ${arms}; else -> ${fallback} }`;
      };
      const slots = new Set();
      for (const s of Object.values(v.styleCases)) for (const k of Object.keys(s)) slots.add(k);
      if (slots.has('background')) chain.push(`.background(${whenExpr('background', 'Color.Transparent')})`);
      // Column has no cascading text color, so a container-level `color` variant
      // cannot be honored here — set text color on the Text children instead.
      if (slots.has('color')) {
        this.warnings.push('container `color` variant not applied on Compose (Column does not cascade text color); set it on Text children');
      }
    }
    return chain.length ? `Modifier${chain.join('')}` : '';
  }
  modifierArg(node) {
    const m = this.modifier(node);
    return m ? `modifier = ${m}` : '';
  }
  colorArg(node) {
    return node.style?.color ? `color = ${mapToken(node.style.color)}` : '';
  }
  /** ARIA-style role -> Compose Role (undefined where the enum has none). */
  composeRole(role) {
    return { img: 'Role.Image', button: 'Role.Button', checkbox: 'Role.Checkbox', switch: 'Role.Switch', slider: null, tab: 'Role.Tab' }[role];
  }
  /** contentDescription + role + liveRegion — never a silent drop of role/live. */
  a11ySemantics(node) {
    const props = [];
    if (node.a11y?.label) {
      const l = node.a11y.label;
      props.push(`contentDescription = ${l.kind === 'literal' ? JSON.stringify(String(l.value)) : l.value}`);
      this.express('a11y.label', { mechanism: 'contentDescription' });
    }
    if (node.role) {
      const r = this.composeRole(node.role);
      if (r) { props.push(`role = ${r}`); this.express(`role=${node.role}`, { mechanism: `semantics { role = ${r} }` }); }
      else if (['presentation', 'none'].includes(node.role)) {
        this.express(`role=${node.role}`, { mechanism: 'decorative (Compose default: no semantics role)' });
      } else {
        this.diverge(`role=${node.role}`, { reason: `no Compose Role for role "${node.role}"`, fallback: 'liveRegion / contentDescription convey the role', waiver: `a11y-role-${node.role}` });
        this.warnings.push(`a11y: role "${node.role}" has no Compose Role; conveyed via liveRegion / contentDescription where present (documented divergence)`);
      }
    }
    if (node.a11y?.live) { props.push(`liveRegion = LiveRegionMode.${node.a11y.live === 'assertive' ? 'Assertive' : 'Polite'}`); this.express(`a11y.live=${node.a11y.live}`, { mechanism: 'liveRegion' }); }
    if (!props.length) return '';
    return `.semantics { ${props.join('; ')} }`;
  }
  /** Combine the style Modifier chain with an a11y semantics block for leaf elements. */
  _a11yMod(node) {
    const mod = this.modifier(node);
    const sem = this.a11ySemantics(node);
    if (!mod && !sem) return '';
    return `, modifier = ${mod || 'Modifier'}${sem}`;
  }
  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    const entries = Object.entries(v.iconCases).map(([val, tok]) => [val, this.icon(tok)]);
    const arms = entries.map(([val, sym]) => `${JSON.stringify(val)} -> Icons.Default.${sym}`).join('; ');
    const fallback = `Icons.Default.${entries[0][1]}`;
    return `Icon(when (${v.prop}) { ${arms}; else -> ${fallback} }, contentDescription = null)`;
  }
  visitContainer(node, children) {
    const mod = this.modifier(node);
    const sem = this.a11ySemantics(node);
    let modArg = '';
    if (mod && sem) modArg = `modifier = ${mod}${sem}`;
    else if (mod) modArg = `modifier = ${mod}`;
    else if (sem) modArg = `modifier = Modifier${sem}`;
    const lead = this.variantIcon(node);
    const inner = lead ? `${lead}\n${children}` : children;
    // F-4 orientation: the container's main layout axis. horizontal -> Row,
    // vertical (or unset) -> Column. Express the trait when the IR declares it.
    const horizontal = node.orientation === 'horizontal';
    if (node.orientation) this.express(`orientation=${node.orientation}`, { mechanism: `${horizontal ? 'Row' : 'Column'} layout axis` });
    const layout = horizontal ? 'Row' : 'Column';
    return `${layout}(${modArg}) {\n${indent(inner, 2)}\n}`;
  }
  visitMedia(node) {
    return `AsyncImage(model = ${this.strExpr(node.src)}, contentDescription = ${this.strExpr(node.alt ?? { kind: 'literal', value: '' })}${this._mod(node)})`;
  }
  _mod(node) {
    const m = this.modifierArg(node);
    return m ? `, ${m}` : '';
  }
  visitHeading(node) {
    return `Text(text = ${this.strExpr(node.text)}, style = MaterialTheme.typography.titleMedium${this._colorTail(node)}${this._mod(node)})`;
  }
  visitText(node) {
    return `Text(text = ${this.strExpr(node.text)}${this._colorTail(node)}${this._a11yMod(node)})`;
  }
  _colorTail(node) {
    const c = this.colorArg(node);
    return c ? `, ${c}` : '';
  }
  visitAction(node) {
    const onClick = node.onEvent ? node.onEvent : '{}';
    const inner = node.icon
      ? `Icon(Icons.Default.${this.icon(node.icon)}, contentDescription = null)\n  Text(${this.strExpr(node.label)})`
      : `Text(${this.strExpr(node.label)})`;
    // Account for an explicit contentDescription / role / live on the button.
    // Previously only style modifiers were emitted, so the IR's a11y.label was
    // silently dropped — caught by the Lowering Ledger.
    const mod = this.modifier(node);
    const sem = this.a11ySemantics(node);
    let modArg = '';
    if (mod && sem) modArg = `, modifier = ${mod}${sem}`;
    else if (mod) modArg = `, modifier = ${mod}`;
    else if (sem) modArg = `, modifier = Modifier${sem}`;
    // F-5 boolean-attribute binding: a caller boolean flag ref -> enabled = !flag.
    let enabledArg = '';
    if (node.disabled) { enabledArg = `, enabled = !${node.disabled}`; this.express('disabled', { mechanism: 'enabled = !flag' }); }
    return `Button(onClick = ${onClick}${enabledArg}${modArg}) {\n  ${inner}\n}`;
  }
  visitIcon(node) {
    const sym = this.icon(node.icon);
    if (node.a11y?.label) {
      const l = node.a11y.label;
      const v = l.kind === 'literal' ? JSON.stringify(String(l.value)) : l.value;
      return `Icon(Icons.Default.${sym}, contentDescription = ${v})`;
    }
    return `Icon(Icons.Default.${sym}, contentDescription = null)`;
  }

  visitLink(node, children) {
    return `Text(text = ${node.label ? this.strExpr(node.label) : `"${'link'}"`}, modifier = Modifier.clickable { /* open ${node.href?.value ?? ''} */ })`;
  }
  plain(vr) {
    if (!vr) return null;
    return vr.kind === 'literal' ? JSON.stringify(String(vr.value)) : vr.value;
  }
  // Control-state primitive — controlled via Compose state hoisting: value +
  // onValueChange, with the state held at the caller.
  renderControlState(node, cs) {
    const role = node.role;
    if (node.a11y?.label) this.express('a11y.label', { mechanism: 'contentDescription (label)' });
    if (node.a11y?.describedBy) this.diverge('a11y.describedBy', { reason: 'Compose has no aria-describedby', fallback: 'adjacent Text / stateDescription', waiver: 'a11y-describedby-native' });
    if (node.a11y?.invalid) this.diverge('a11y.invalid', { reason: 'Compose control has no isError in this position', fallback: 'adjacent error Text conveys the invalid state', waiver: 'a11y-invalid-compose' });
    // A visible label (Compose controls have no label param) is rendered as an
    // adjacent Text inside a Column, so the label prop is honored, not dropped.
    const label = this.plain(node.label);
    const withLabel = (control) => (label ? `Column {\n  Text(text = ${label})\n  ${control}\n}` : control);

    let control;
    if (cs.kind === 'boolean') {
      // switch -> Switch + Role.Switch; checkbox (or default) -> Checkbox + Role.Checkbox.
      const isSwitch = role === 'switch';
      const ctrl = isSwitch ? 'Switch' : 'Checkbox';
      const roleName = isSwitch ? 'Role.Switch' : 'Role.Checkbox';
      const sem = role ? `, modifier = Modifier.semantics { role = ${roleName} }` : '';
      if (role) this.express(`role=${role}`, { mechanism: `${ctrl} + Modifier.semantics { role = ${roleName} }` });
      this.express('state=boolean', { mechanism: `${ctrl}(checked, onCheckedChange) — hoisted state` });
      control = `${ctrl}(checked = ${cs.value}, onCheckedChange = ${cs.change}${sem})`;
    } else if (cs.kind === 'selected-value') {
      if (role === 'radiogroup') this.express('role=radiogroup', { mechanism: 'Modifier.selectableGroup() + RadioButton per option' });
      else if (role) this.diverge(`role=${role}`, { reason: `no Compose Role for role "${role}" here`, fallback: 'selectable RadioButton group', waiver: `a11y-role-${role}` });
      this.express('state=selected-value', { mechanism: 'RadioButton group over options (selected = bound == option.value; hoisted onClick) — native match' });
      // F-25 rich options: a decorative Material Icon (resolved at runtime from the
      // icon-token registry) sits between the radio control and the label.
      const rich = this.hasOptionIcons(node);
      if (rich) { this.usesOptionIcons = true; this.express('option-icon', { mechanism: 'Material Icon via runtime registry (decorative, contentDescription = null)' }); }
      const iconRow = rich ? `\n      OPTION_ICONS[opt.icon]?.let { Icon(it, contentDescription = null) }` : '';
      const items = cs.options
        ? `${cs.options}.forEach { opt ->\n    Row {\n      RadioButton(selected = ${cs.value} == opt.value, onClick = { ${cs.change}(opt.value) })${iconRow}\n      Text(text = opt.label)\n    }\n  }`
        // No option list: hoist the selection state to the caller (the options
        // are supplied by a component built on this primitive).
        : `val selectedValue = ${cs.value}\n  val onSelectedChange = ${cs.change}`;
      control = `Column(modifier = Modifier.selectableGroup()) {\n  ${items}\n}`;
    } else {
      const n = (v) => (typeof v === 'number' ? `${v}f` : v);
      const numberField = node.input?.inputType === 'number';
      if (!numberField) {
        let steps = '';
        if (typeof cs.min === 'number' && typeof cs.max === 'number' && typeof cs.step === 'number' && cs.step > 0) {
          const c = Math.round((cs.max - cs.min) / cs.step) - 1;
          if (c > 0) steps = `, steps = ${c}`;
        }
        if (role === 'slider') this.express('role=slider', { mechanism: 'Slider — built-in progressBarRangeInfo semantics' });
        else if (role) this.diverge(`role=${role}`, { reason: `no Compose Role for role "${role}" here`, fallback: 'Slider conveys the adjustable value', waiver: `a11y-role-${role}` });
        this.express('state=numeric-range', { mechanism: 'Slider(value, onValueChange, valueRange, steps) — hoisted state' });
        control = `Slider(value = ${cs.value}, onValueChange = ${cs.change}, valueRange = ${n(cs.min)}..${n(cs.max)}${steps})`;
      } else {
        // NumberInput: numeric text field (value <-> text via toString / toFloatOrNull; no locale formatting).
        if (role) this.diverge(`role=${role}`, { reason: `no Compose Role for role "${role}" here`, fallback: 'numeric text field conveys the value', waiver: `a11y-role-${role}` });
        this.express('state=numeric-range', { mechanism: 'OutlinedTextField(value.toString(), onValueChange -> toFloatOrNull) — hoisted state' });
        control = `OutlinedTextField(value = ${cs.value}.toString(), onValueChange = { ${cs.change}(it.toFloatOrNull() ?: ${cs.value}) })`;
      }
    }
    return withLabel(control);
  }

  visitInput(node) {
    const i = node.input ?? {};
    const cs = this.controlState(node);
    if (cs) return this.renderControlState(node, cs);
    const role = node.role;
    if (node.a11y?.describedBy) this.diverge('a11y.describedBy', { reason: 'Compose has no aria-describedby', fallback: 'adjacent Text / stateDescription', waiver: 'a11y-describedby-native' });
    // The accessible name for a bare Compose control (which has no text-label param)
    // rides an explicit contentDescription in the semantics block.
    const label = this.plain(node.label ?? node.a11y?.label);
    const cd = (node.a11y?.label && label) ? `; contentDescription = ${label}` : '';

    // Real form controls for the toggle / adjustable roles — never a bare TextField.
    if (role === 'checkbox' || role === 'switch') {
      const checked = i.valueProp ?? 'checked';
      const onCh = i.changeProp ?? '{}';
      const roleName = role === 'switch' ? 'Role.Switch' : 'Role.Checkbox';
      const control = role === 'switch' ? 'Switch' : 'Checkbox';
      if (node.a11y?.invalid) this.diverge('a11y.invalid', { reason: `Compose ${control} has no isError`, fallback: 'adjacent error Text conveys the invalid state', waiver: 'a11y-invalid-compose' });
      this.express(`role=${role}`, { mechanism: `${control}(checked/onCheckedChange) + Modifier.semantics { role = ${roleName} }` });
      if (cd) this.express('a11y.label', { mechanism: 'semantics { contentDescription }' });
      return `${control}(checked = ${checked}, onCheckedChange = ${onCh}, modifier = Modifier.semantics { role = ${roleName}${cd} })`;
    }
    if (role === 'slider') {
      const value = i.valueProp ?? 'value';
      const onCh = i.changeProp ?? '{}';
      if (node.a11y?.invalid) this.diverge('a11y.invalid', { reason: 'Compose Slider has no isError', fallback: 'adjacent error Text conveys the invalid state', waiver: 'a11y-invalid-compose' });
      this.express(`role=${role}`, { mechanism: 'Slider(value/onValueChange) — built-in progressBarRangeInfo semantics' });
      if (cd) this.express('a11y.label', { mechanism: 'semantics { contentDescription }' });
      const sliderMod = cd ? `, modifier = Modifier.semantics { ${cd.replace(/^; /, '')} }` : '';
      return `Slider(value = ${value}, onValueChange = ${onCh}${sliderMod})`;
    }

    if (node.a11y?.label) this.express('a11y.label', { mechanism: 'TextField label slot (Text)' });
    const parts = [`value = ${i.valueProp ?? 'value'}`, `onValueChange = ${i.changeProp ?? '{}'}`];
    if (label) parts.push(`label = { Text(${label}) }`);
    if (node.a11y?.invalid) { parts.push(`isError = ${node.a11y.invalid} != null`); this.express('a11y.invalid', { mechanism: 'isError' }); }
    if (role) this.diverge(`role=${role}`, { reason: `no Compose Role for role "${role}" on a text field`, fallback: 'label conveys intent', waiver: `a11y-role-${role}` });
    // F-19 textarea: a multi-line text field is a TextField with singleLine = false.
    if (i.multiline) { parts.push('singleLine = false'); this.express('input.multiline', { mechanism: 'TextField(singleLine = false)' }); }
    const mod = this.modifierArg(node);
    if (mod) parts.push(mod);
    return `TextField(${parts.join(', ')})`;
  }
  visitSlot() { return 'content()'; }
  wrapConditional(node, rendered) {
    const prop = this.ir.props.find((p) => p.name === node.when);
    // A nullable value (String?, lambda?, ...) can't be a Boolean; null-check
    // it. Kotlin smart-casts it to non-null inside the block.
    const test = prop && prop.required === false ? `${node.when} != null` : node.when;
    return `if (${test}) {\n${indent(rendered, 2)}\n}`;
  }

  // Native Compose if / else if / else. A plain boolean flag is tested directly;
  // a nullable flag prop is null-checked (smart-cast); a per-item boolean field
  // (`item.active`) is a direct native Boolean read (`if (item.active)`).
  condTest(when) {
    const prop = this.ir.props.find((p) => p.name === when);
    return (prop && prop.required === false) ? `${when} != null` : when;
  }
  condChainRender(branches, elseBody) {
    let s = `if (${this.condTest(branches[0].when)}) {\n${indent(branches[0].body, 2)}\n}`;
    for (let i = 1; i < branches.length; i++) {
      s += ` else if (${this.condTest(branches[i].when)}) {\n${indent(branches[i].body, 2)}\n}`;
    }
    if (elseBody != null) s += ` else {\n${indent(elseBody, 2)}\n}`;
    return s;
  }
  wrapIteration(node, rendered) {
    const { items, as } = node.each;
    return `${items}.forEach { ${as} ->\n${indent(rendered, 2)}\n}`;
  }
  ktType(prop) {
    const opt = prop.required === false;
    switch (prop.type) {
      case 'number': return opt ? 'Double?' : 'Double';
      case 'boolean': return opt ? 'Boolean?' : 'Boolean';
      case 'date': return opt ? 'java.util.Date?' : 'java.util.Date';
      case 'function': {
        const base = /change/i.test(prop.name) ? '(String) -> Unit' : '() -> Unit';
        return opt ? `(${base})?` : base;
      }
      case 'enum': return opt ? 'String?' : 'String';
      case 'array': return `List<${this.ir.component}Item>`;
      default: return opt ? 'String?' : 'String';
    }
  }
  renderComponent(root) {
    const name = this.ir.component;
    const params = this.ir.props.map((p) => `  ${p.name}: ${this.ktType(p)}`).join(',\n');
    const arrayProp = this.ir.props.find((p) => p.type === 'array');
    const itemClass = arrayProp?.itemShape
      ? `data class ${name}Item(\n`
        + Object.entries(arrayProp.itemShape).map(([k, t]) => `  val ${k}: ${t === 'number' ? 'Double' : t === 'boolean' ? 'Boolean' : 'String'}`).join(',\n')
        + `\n)\n\n`
      : '';
    const iconImport = (this.usedIcons.size || this.usesOptionIcons)
      ? `import androidx.compose.material.icons.Icons\nimport androidx.compose.material.icons.filled.*\n`
      : '';
    // F-25: runtime registry mapping the known icon tokens to Material ImageVectors.
    const optionIcons = this.usesOptionIcons
      ? `val OPTION_ICONS = mapOf(${Object.entries(this.iconMap).map(([t, sym]) => `${JSON.stringify(t)} to Icons.Default.${sym}`).join(', ')})\n\n`
      : '';
    // Semantics extras are imported only when the body actually emits them.
    const semExtra =
      (/\brole = Role\./.test(root) ? `import androidx.compose.ui.semantics.role\nimport androidx.compose.ui.semantics.Role\n` : '')
      + (/\bliveRegion = LiveRegionMode\./.test(root) ? `import androidx.compose.ui.semantics.liveRegion\nimport androidx.compose.ui.semantics.LiveRegionMode\n` : '')
      + (/\.selectableGroup\(\)/.test(root) ? `import androidx.compose.foundation.selection.selectableGroup\n` : '');
    return `import androidx.compose.foundation.layout.*\n`
      + `import androidx.compose.foundation.background\n`
      + `import androidx.compose.foundation.shape.RoundedCornerShape\n`
      + `import androidx.compose.material3.*\n`
      + `import androidx.compose.runtime.Composable\n`
      + `import androidx.compose.ui.Modifier\n`
      + `import androidx.compose.ui.draw.clip\n`
      + `import androidx.compose.ui.graphics.Color\n`
      + `import androidx.compose.ui.semantics.contentDescription\n`
      + `import androidx.compose.ui.semantics.semantics\n`
      + semExtra
      + `import androidx.compose.foundation.clickable\n`
      + `import coil.compose.AsyncImage\n`
      + `${iconImport}import designtokens.DesignTokens\n\n`
      + `${itemClass}${optionIcons}@Composable\nfun ${name}(\n${params}\n) {\n${indent(root, 2)}\n}\n`;
  }
}

export function generateCompose(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new ComposeRenderer(ir, { iconMap, adapter: "compose" });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/compose', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.kt`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size, ledger: renderer.ledger };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`compose: wrote ${generateCompose(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
