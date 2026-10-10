#!/usr/bin/env node
/**
 * React adapter (reference implementation).
 * Emits a typed, accessible .tsx component from the IR.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererBase, indent } from '../_shared/renderer-base.mjs';
import { specToIrFromFile } from '../../_shared/scripts/spec-to-ir.mjs';
import { mapToken, STYLE_PROP } from './token-map.mjs';
import { iconMap, ICON_LIB } from './icon-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const escapeJsx = (s) => String(s).replace(/[{}<>]/g, (c) => `{'${c}'}`);

/**
 * Split a rendered JSX block into its top-level parts: elements, `{...}` containers and bare text.
 * The adapter emits well-formed JSX, so a small scanner is enough: it skips string literals and balanced
 * braces (an arrow `=>` or a `>` inside braces or a quoted attribute is not a tag end).
 * @returns {{ kind: 'element'|'expr'|'text', start: number, end: number }[]}
 */
export function topLevelParts(src) {
  const parts = [];
  const n = src.length;
  let i = 0;
  const skipString = (q) => { i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; };
  const skipBraces = () => {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') { skipString(c); continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      i++;
      if (depth === 0) break;
    }
  };
  // Consume one tag starting at `<`; returns 'open' | 'self' | 'close'.
  const tag = () => {
    const closing = src[i + 1] === '/';
    i++;
    while (i < n && src[i] !== '>') {
      const c = src[i];
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '{') { skipBraces(); continue; }
      i++;
    }
    const selfClosing = src[i - 1] === '/';
    i++;
    return closing ? 'close' : selfClosing ? 'self' : 'open';
  };
  while (i < n) {
    if (/\s/.test(src[i])) { i++; continue; }
    const start = i;
    if (src[i] === '{') { skipBraces(); parts.push({ kind: 'expr', start, end: i }); continue; }
    if (src[i] === '<') {
      let depth = 0;
      do {
        if (src[i] === '<') { const t = tag(); if (t === 'open') depth++; else if (t === 'close') depth--; }
        else if (src[i] === '{') skipBraces();
        else i++;
      } while (i < n && depth > 0);
      parts.push({ kind: 'element', start, end: i });
      continue;
    }
    while (i < n && src[i] !== '<' && src[i] !== '{') i++;
    parts.push({ kind: 'text', start, end: i });
  }
  return parts;
}

class ReactRenderer extends RendererBase {
  // TS-1 callback signatures (shared helper in renderer-base): arity from the prop name, value type from the bound control.
  get sigs() { return (this._sigs ??= this.callbackSignatures()); }
  takesValue(name) { return this.sigs.get(name)?.takesValue ?? /change/i.test(name); }
  /** Call a change callback: `name(arg)` when the name takes the value, `name()` otherwise. */
  callCb(name, arg) { return this.takesValue(name) ? `${name}(${arg})` : `${name}()`; }
  /** `onChange={(e) => name(arg)}`, or `onChange={() => name()}` for a zero-argument callback. */
  onChangeAttr(name, arg) { return this.takesValue(name) ? `onChange={(e) => ${name}(${arg})}` : `onChange={() => ${name}()}`; }

  /**
   * A rendered block used where ONE JSX expression is required (the component return, a ternary or `&&`
   * branch): several top-level elements become a fragment; a single `{...}` container (an iteration) is
   * unwrapped to its bare expression, because a `{ }` block inside parentheses is not valid JSX. A block that
   * is already a bare expression (a nested conditional, `null`) is left alone.
   */
  asExpression(src) {
    const t = src.trim();
    if (!t.startsWith('<') && !t.startsWith('{')) return src;
    const parts = topLevelParts(t);
    if (parts.length === 1 && parts[0].kind === 'expr') return t.slice(1, -1);
    if (parts.length > 1) return `<>\n${indent(t, 2)}\n</>`;
    return src;
  }

  interp(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return escapeJsx(vr.value);
    if (vr.kind === 'format') { this.express('number-format', { mechanism: 'Intl.NumberFormat' }); return `{${this.intlFormatExpr(this.numberFormat(vr))}}`; }
    if (vr.kind === 'datetime') {
      const df = this.dateFormat(vr);
      this.express('date-format', { mechanism: 'Intl.DateTimeFormat' });
      if (df.timeZone) this.express('date-timezone', { mechanism: df.timeZone.kind === 'literal' ? 'Intl timeZone option (literal)' : 'Intl timeZone option + __dtfTimeZone runtime fallback to device' });
      return `{${this.intlDateExpr(df)}}`;
    }
    return `{${vr.value}}`;
  }

  attr(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return JSON.stringify(String(vr.value));
    return `{${vr.value}}`;
  }

  styleAttr(node) {
    // F-4 orientation (PR A2): an explicit orientation on a container WITH
    // children is a real layout axis — emit display:flex + flex-direction
    // (keywords, not tokens). No orientation or no children → nothing added.
    const flex = (node.orientation && node.children?.length)
      ? [`display: 'flex'`, `flexDirection: '${node.orientation === 'horizontal' ? 'row' : 'column'}'`]
      : [];
    const base = [
      ...flex,
      ...(node.style ? Object.entries(node.style).map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: '${mapToken(token)}'`) : []),
    ];
    // D4a: per-slot static style traits (variant cases are not counted; padding is not a ledger trait, F-30).
    if (node.style?.background) this.express('style=background', { mechanism: 'backgroundColor (static style)' });
    if (node.style?.radius) this.express('style=radius', { mechanism: 'borderRadius (static style)' });
    // F-7 size slot: a dimension TOKEN drives width/height (never a raw px).
    if (node.size) {
      base.push(`width: '${mapToken(node.size)}'`, `height: '${mapToken(node.size)}'`);
      this.express('size', { mechanism: 'width/height (dimension token)' });
    }
    let spread = '';
    const v = this.variantData(node);
    if (v) {
      // Every enum value gets an entry (a value with no style slots maps to an empty object).
      const entries = Object.entries(v.styleCases).map(([value, slots]) => {
        const inner = Object.entries(slots).map(([s, t]) => `${STYLE_PROP[s] ?? s}: '${mapToken(t)}'`).join(', ');
        return [value, inner ? `{ ${inner} }` : '{}'];
      });
      for (const val of this.enumValues(v.prop)) if (!(val in v.styleCases)) entries.push([val, '{}']);
      const cases = entries.map(([value, obj]) => `${JSON.stringify(value)}: ${obj}`).join(', ');
      spread = `...({ ${cases} })[${v.prop}]`;
    }
    const inner = [...base, spread].filter(Boolean).join(', ');
    return inner ? ` style={{ ${inner} }}` : '';
  }

  /** The values of an enum prop (empty when the prop is not an enum or is not declared). */
  enumValues(propName) {
    const p = (this.ir.props ?? []).find((x) => x.name === propName);
    return p?.type === 'enum' ? (p.values ?? []) : [];
  }

  idAttr(node) {
    return node.id ? ` id="${node.id}"` : '';
  }

  // F-4 orientation: WAI-ARIA semantic on the container (correct for separator).
  orientationAttr(node) {
    if (!node.orientation) return '';
    const axis = node.children?.length ? ` + display:flex/flex-direction:${node.orientation === 'horizontal' ? 'row' : 'column'}` : '';
    this.express(`orientation=${node.orientation}`, { mechanism: `aria-orientation="${node.orientation}"${axis}` });
    return ` aria-orientation="${node.orientation}"`;
  }

  // F-5 boolean-attribute binding: a caller boolean flag ref -> HTML `disabled`.
  disabledAttr(node) {
    if (!node.disabled) return '';
    this.express('disabled', { mechanism: 'disabled={flag}' });
    return ` disabled={${node.disabled}}`;
  }

  a11yAttrs(node) {
    const out = [];
    if (node.role) { out.push(` role="${node.role}"`); this.express(`role=${node.role}`, { mechanism: `role="${node.role}"` }); }
    if (node.a11y?.label) { out.push(` aria-label=${this.attr(node.a11y.label)}`); this.express('a11y.label', { mechanism: 'aria-label' }); }
    // D4a: labelledBy needs a target element id and ids are not plumbed to referenced elements yet, so aria-labelledby
    // could point to nothing. Emit nothing; time-boxed waiver until id plumbing exists (see docs/audits).
    if (node.a11y?.labelledBy) {
      this.diverge('a11y.labelledBy', { reason: 'aria-labelledby needs a target element id and ids are not plumbed to referenced elements yet', fallback: 'nothing emitted until id plumbing exists', waiver: 'a11y-labelledby-react' });
      this.warnings.push('a11y: labelledBy is not emitted (no id plumbing to the referenced element yet; documented divergence)');
    }
    if (node.a11y?.live) { out.push(` aria-live="${node.a11y.live}"`); this.express(`a11y.live=${node.a11y.live}`, { mechanism: 'aria-live' }); }
    return out.join('');
  }

  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    this.express('icon', { mechanism: 'variant icon cases (aria-hidden icon component)' });
    // Every enum value gets an entry (a value with no icon maps to null), so indexing by the full enum type type-checks.
    const entries = Object.entries(v.iconCases).map(([val, tok]) => [val, `<${this.icon(tok)} aria-hidden="true" />`]);
    for (const val of this.enumValues(v.prop)) if (!(val in v.iconCases)) entries.push([val, 'null']);
    const cases = entries.map(([val, jsx]) => `${JSON.stringify(val)}: ${jsx}`).join(', ');
    return `{({ ${cases} })[${v.prop}]}`;
  }

  visitContainer(node, children) {
    const tag = node.as || 'div';
    const open = `<${tag}${this.idAttr(node)}${this.a11yAttrs(node)}${this.orientationAttr(node)}${this.styleAttr(node)}>`;
    const lead = this.variantIcon(node);
    const inner = lead ? `${lead}\n${children}` : children;
    return `${open}\n${indent(inner, 2)}\n</${tag}>`;
  }

  visitMedia(node) {
    return `<img src=${this.attr(node.src)} alt=${this.attr(node.alt ?? { kind: 'literal', value: '' })}${this.styleAttr(node)} />`;
  }

  visitHeading(node, children) {
    const tag = `h${node.level ?? 2}`;
    const body = node.text ? this.interp(node.text) : children;
    return `<${tag}${this.idAttr(node)}${this.styleAttr(node)}>${body}</${tag}>`;
  }

  visitText(node) {
    return `<span${this.idAttr(node)}${this.a11yAttrs(node)}${this.styleAttr(node)}>${this.interp(node.text)}</span>`;
  }

  visitAction(node) {
    const handler = node.onEvent ? ` onClick={${node.onEvent}}` : '';
    const label = node.label ? this.interp(node.label) : '';
    const icon = node.icon ? `<${this.icon(node.icon)} aria-hidden="true" />` : '';
    if (node.icon) this.express('icon', { mechanism: 'action icon (aria-hidden icon component)' });
    return `<button type="button"${handler}${this.disabledAttr(node)}${this.a11yAttrs(node)}${this.styleAttr(node)}>${icon}${label}</button>`;
  }

  visitIcon(node) {
    const sym = this.icon(node.icon);
    this.express('icon', { mechanism: 'icon component' });
    return node.a11y?.label
      ? `<${sym} role="img" aria-label=${this.attr(node.a11y.label)}${this.styleAttr(node)} />`
      : `<${sym} aria-hidden="true"${this.styleAttr(node)} />`;
  }

  visitLink(node, children) {
    if (node.href) this.express('link-href', { mechanism: '<a href> (browser navigation)' });
    const label = node.label ? this.interp(node.label) : children;
    return `<a href=${this.attr(node.href)}${this.styleAttr(node)}>${label}</a>`;
  }

  inputId(node) {
    const i = node.input ?? {};
    return node.id || `${this.ir.component.toLowerCase()}-${i.valueProp ?? 'input'}`;
  }

  // Control-state primitive — controlled (caller-held) two-way binding via
  // React's `value/checked` + `onChange`.
  // describedBy / invalid accounting for control-state controls (mirrors visitInput).
  inputAria(node) {
    let aria = '';
    const invalid = node.a11y?.invalid;
    const desc = node.a11y?.describedBy;
    if (invalid) { aria += ` aria-invalid={!!${invalid}}`; this.express('a11y.invalid', { mechanism: 'aria-invalid' }); }
    if (desc) {
      aria += invalid ? ` aria-describedby={${invalid} ? "${desc}" : undefined}` : ` aria-describedby="${desc}"`;
      this.express('a11y.describedBy', { mechanism: 'aria-describedby' });
    }
    return aria;
  }

  // F-25 rich options: a per-option icon (decorative) resolved at runtime from the
  // known icon-token set via an emitted registry. Returns the per-option markup
  // (empty when options carry no icon), and records the ledger trait + imports.
  richOptionIcon(node) {
    if (!this.hasOptionIcons(node)) return '';
    this.usesOptionIcons = true;
    for (const sym of Object.values(this.iconMap)) this.usedIcons.add(sym);
    this.express('option-icon', { mechanism: 'per-option lucide icon via runtime registry (decorative, aria-hidden)' });
    return '<OptionIcon token={opt.icon} />\n      ';
  }

  renderControlState(node, cs) {
    const id = this.inputId(node);
    const labelEl = node.label ? `<label htmlFor="${id}">${this.interp(node.label)}</label>\n` : '';
    const tail = `${this.a11yAttrs(node)}${this.inputAria(node)}${this.styleAttr(node)}`;
    const num = (n, v) => (v == null ? '' : ` ${n}={${v}}`);
    if (cs.kind === 'boolean') {
      this.express('state=boolean', { mechanism: 'checked + onChange (controlled)' });
      return `${labelEl}<input id="${id}" type="checkbox" checked={${cs.value}} ${this.onChangeAttr(cs.change, 'e.target.checked')}${tail} />`;
    }
    if (cs.kind === 'selected-value') {
      if (node.role === 'radiogroup') {
        // Native radio group: name-grouped <input type="radio">; the browser
        // enforces single-select, checked reflects the bound value.
        this.express('state=selected-value', { mechanism: 'radiogroup: name-grouped <input type="radio"> + checked/onChange (controlled)' });
        const ic = this.richOptionIcon(node);
        const items = cs.options
          ? `\n  {${cs.options}.map((opt) => (\n    <label key={opt.value}>\n      <input type="radio" name="${id}" value={opt.value} checked={${cs.value} === opt.value} onChange={() => ${this.callCb(cs.change, 'opt.value')}} />\n      ${ic}{opt.label}\n    </label>\n  ))}\n`
          : '';
        return `${labelEl}<div id="${id}"${tail}>${items}</div>`;
      }
      this.express('state=selected-value', { mechanism: 'value + onChange on <select> with <option> children (controlled)' });
      const items = cs.options
        ? `\n  {${cs.options}.map((opt) => (\n    <option key={opt.value} value={opt.value}>{opt.label}</option>\n  ))}\n`
        : '';
      return `${labelEl}<select id="${id}" value={${cs.value}} ${this.onChangeAttr(cs.change, 'e.target.value')}${tail}>${items}</select>`;
    }
    this.express('state=numeric-range', { mechanism: 'value + onChange + min/max/step (controlled)' });
    const t = node.input?.inputType === 'number' ? 'number' : 'range';
    return `${labelEl}<input id="${id}" type="${t}" value={${cs.value}} ${this.onChangeAttr(cs.change, 'Number(e.target.value)')}${num('min', cs.min)}${num('max', cs.max)}${num('step', cs.step)}${tail} />`;
  }

  visitInput(node) {
    const i = node.input ?? {};
    const cs = this.controlState(node);
    if (cs) return this.renderControlState(node, cs);
    const id = this.inputId(node);
    const labelEl = node.label ? `<label htmlFor="${id}">${this.interp(node.label)}</label>\n` : '';
    // What the control hands its callback (shared rule): a checkbox or switch is a boolean checkbox input
    // (checked + e.target.checked), a number or slider hands a number, everything else the string value.
    const kind = i.multiline ? 'string' : this.inputValueKind(node);
    const value = i.valueProp ? (kind === 'boolean' ? ` checked={${i.valueProp}}` : ` value={${i.valueProp}}`) : '';
    const arg = { boolean: 'e.target.checked', number: 'Number(e.target.value)', string: 'e.target.value' }[kind];
    const change = i.changeProp ? ` ${this.onChangeAttr(i.changeProp, arg)}` : '';
    const invalid = node.a11y?.invalid;
    const desc = node.a11y?.describedBy;
    let aria = '';
    if (invalid) { aria += ` aria-invalid={!!${invalid}}`; this.express('a11y.invalid', { mechanism: 'aria-invalid' }); }
    if (desc) {
      // Only point at the description while it is actually rendered.
      aria += invalid ? ` aria-describedby={${invalid} ? "${desc}" : undefined}` : ` aria-describedby="${desc}"`;
      this.express('a11y.describedBy', { mechanism: 'aria-describedby' });
    }
    // F-19 textarea: a multi-line text input renders as <textarea>.
    if (i.multiline) {
      this.express('input.multiline', { mechanism: '<textarea>' });
      return `${labelEl}<textarea id="${id}"${value}${change}${aria}${this.a11yAttrs(node)}${this.styleAttr(node)} />`;
    }
    const type = kind === 'boolean' ? 'checkbox' : (i.inputType ?? 'text');
    return `${labelEl}<input id="${id}" type="${type}"${value}${change}${aria}${this.a11yAttrs(node)}${this.styleAttr(node)} />`;
  }

  visitSlot(node) {
    const name = node.label?.value ?? 'children';
    return `{${name}}`;
  }

  wrapConditional(node, rendered) {
    return `{${node.when} && (\n${indent(this.asExpression(rendered), 2)}\n)}`;
  }

  // A conditional lowers to a bare JS expression; wrapTopConditional adds the
  // single `{…}` container at the JSX-child boundary (never on a nested one, so a
  // nested/else-if conditional never emits `{…}` inside `{…}`).
  condChainRender(branches, elseBody) {
    // One-way (single clause, no else): `flag && (body)`.
    if (branches.length === 1 && elseBody == null) {
      return `${branches[0].when} && (\n${indent(this.asExpression(branches[0].body), 2)}\n)`;
    }
    // if/else and else-if chains → a nested ternary (native JSX else-if idiom).
    return branches.reduceRight(
      (acc, b) => `${b.when} ? (\n${indent(this.asExpression(b.body), 2)}\n) : (\n${indent(acc, 2)}\n)`,
      elseBody != null ? this.asExpression(elseBody) : 'null',
    );
  }
  wrapTopConditional(str) {
    return `{${str}}`;
  }

  wrapIteration(node, rendered) {
    const { items, as, key } = node.each;
    return `{${items}.map((${as}) => (\n`
      + `  <React.Fragment key={${as}.${key}}>\n${indent(rendered, 4)}\n  </React.Fragment>\n`
      + `))}`;
  }

  tsType(prop) {
    switch (prop.type) {
      case 'string': return 'string';
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'date': return 'Date';
      case 'function': {
        const sig = this.sigs.get(prop.name);
        return this.takesValue(prop.name) ? `(value: ${sig?.valueType ?? 'string'}) => void` : '() => void';
      }
      case 'enum': return (prop.values ?? []).map((v) => `'${v}'`).join(' | ') || 'string';
      case 'node': return 'React.ReactNode';
      case 'array': {
        const shape = prop.itemShape
          ? `{ ${Object.entries(prop.itemShape).map(([k, t]) => `${k}: ${t}`).join('; ')} }`
          : 'unknown';
        return `${shape}[]`;
      }
      default: return 'unknown';
    }
  }

  renderComponent(root) {
    const name = this.ir.component;
    // A slot renders a caller-supplied node (`{children}`, `{header}`): declare each one as an optional
    // React.ReactNode prop unless the spec already declares a prop of that name.
    const slotProps = [];
    this.irNodes(this.ir.root, (n) => {
      if (n.kind !== 'slot') return;
      const slot = n.label?.value ?? 'children';
      if (!slotProps.includes(slot) && !this.ir.props.some((p) => p.name === slot)) slotProps.push(slot);
    });
    const propLines = [
      ...this.ir.props.map((p) => `  ${p.name}${p.required ? '' : '?'}: ${this.tsType(p)};`),
      ...slotProps.map((slot) => `  ${slot}?: React.ReactNode;`),
    ];
    const propsIface = propLines.length
      ? `export interface ${name}Props {\n${propLines.join('\n')}\n}\n\n`
      : `export interface ${name}Props {}\n\n`;
    const args = [...this.ir.props.map((p) => p.name), ...slotProps].join(', ');
    const iconImport = this.usedIcons.size
      ? `import { ${[...this.usedIcons].join(', ')} } from '${ICON_LIB}';\n`
      : '';
    // F-25: a runtime registry mapping the known icon tokens to lucide components,
    // plus a tiny decorative <OptionIcon> helper (per-option icons are runtime data).
    const optionIcons = this.usesOptionIcons
      ? `const OPTION_ICONS: Record<string, React.ComponentType<{ 'aria-hidden'?: boolean }>> = { ${Object.entries(this.iconMap).map(([t, sym]) => `${JSON.stringify(t)}: ${sym}`).join(', ')} };\n`
        + `function OptionIcon({ token }: { token: string }) {\n  const Icon = OPTION_ICONS[token];\n  return Icon ? <Icon aria-hidden={true} /> : null;\n}\n\n`
      : '';
    const tzGuard = this.usesTzGuard ? this.tzGuardHelper() + '\n' : '';
    return `import React from 'react';\n${iconImport}import '../../_shared/tokens/tokens.css';\n\n`
      + propsIface
      + optionIcons
      + tzGuard
      + `export function ${name}({ ${args} }: ${name}Props) {\n`
      + `  return (\n${indent(this.asExpression(root), 4)}\n  );\n}\n`;
  }
}

export function generateReact(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new ReactRenderer(ir, { tokenMap: {}, iconMap, adapter: "react" });
  // React resolves tokens by CSS var, not tokenMap, so token() is overridden by mapToken usage.
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/react', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.tsx`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size, ledger: renderer.ledger };
}

function main() {
  const specPath = process.argv[2];
  const feature = process.argv[3] ?? 'demo';
  if (!specPath) {
    console.error('usage: generate.mjs <spec.yaml> <feature>');
    process.exit(2);
  }
  const { file } = generateReact(specPath, feature);
  console.log(`react: wrote ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
