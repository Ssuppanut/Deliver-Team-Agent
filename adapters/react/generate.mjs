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

class ReactRenderer extends RendererBase {
  interp(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return escapeJsx(vr.value);
    return `{${vr.value}}`;
  }

  attr(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return JSON.stringify(String(vr.value));
    return `{${vr.value}}`;
  }

  styleAttr(node) {
    const base = node.style
      ? Object.entries(node.style).map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: '${mapToken(token)}'`)
      : [];
    let spread = '';
    const v = this.variantData(node);
    if (v) {
      const cases = Object.entries(v.styleCases)
        .map(([value, slots]) => {
          const inner = Object.entries(slots).map(([s, t]) => `${STYLE_PROP[s] ?? s}: '${mapToken(t)}'`).join(', ');
          return `${JSON.stringify(value)}: { ${inner} }`;
        })
        .join(', ');
      spread = `...({ ${cases} })[${v.prop}]`;
    }
    const inner = [...base, spread].filter(Boolean).join(', ');
    return inner ? ` style={{ ${inner} }}` : '';
  }

  idAttr(node) {
    return node.id ? ` id="${node.id}"` : '';
  }

  a11yAttrs(node) {
    const out = [];
    if (node.role) { out.push(` role="${node.role}"`); this.express(`role=${node.role}`, { mechanism: `role="${node.role}"` }); }
    if (node.a11y?.label) { out.push(` aria-label=${this.attr(node.a11y.label)}`); this.express('a11y.label', { mechanism: 'aria-label' }); }
    if (node.a11y?.live) { out.push(` aria-live="${node.a11y.live}"`); this.express(`a11y.live=${node.a11y.live}`, { mechanism: 'aria-live' }); }
    return out.join('');
  }

  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    const cases = Object.entries(v.iconCases)
      .map(([val, tok]) => `${JSON.stringify(val)}: <${this.icon(tok)} aria-hidden="true" />`)
      .join(', ');
    return `{({ ${cases} })[${v.prop}]}`;
  }

  visitContainer(node, children) {
    const tag = node.as || 'div';
    const open = `<${tag}${this.idAttr(node)}${this.a11yAttrs(node)}${this.styleAttr(node)}>`;
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
    return `<button type="button"${handler}${this.a11yAttrs(node)}${this.styleAttr(node)}>${icon}${label}</button>`;
  }

  visitIcon(node) {
    const sym = this.icon(node.icon);
    return node.a11y?.label
      ? `<${sym} role="img" aria-label=${this.attr(node.a11y.label)}${this.styleAttr(node)} />`
      : `<${sym} aria-hidden="true"${this.styleAttr(node)} />`;
  }

  visitLink(node, children) {
    const label = node.label ? this.interp(node.label) : children;
    return `<a href=${this.attr(node.href)}${this.styleAttr(node)}>${label}</a>`;
  }

  inputId(node) {
    const i = node.input ?? {};
    return node.id || `${this.ir.component.toLowerCase()}-${i.valueProp ?? 'input'}`;
  }

  // Control-state primitive — controlled (caller-held) two-way binding via
  // React's `value/checked` + `onChange`.
  renderControlState(node, cs) {
    const id = this.inputId(node);
    const labelEl = node.label ? `<label htmlFor="${id}">${this.interp(node.label)}</label>\n` : '';
    const tail = `${this.a11yAttrs(node)}${this.styleAttr(node)}`;
    const num = (n, v) => (v == null ? '' : ` ${n}={${v}}`);
    if (cs.kind === 'boolean') {
      this.express('state=boolean', { mechanism: 'checked + onChange (controlled)' });
      return `${labelEl}<input id="${id}" type="checkbox" checked={${cs.value}} onChange={(e) => ${cs.change}(e.target.checked)}${tail} />`;
    }
    if (cs.kind === 'selected-value') {
      this.express('state=selected-value', { mechanism: 'value + onChange on <select> (controlled)' });
      return `${labelEl}<select id="${id}" value={${cs.value}} onChange={(e) => ${cs.change}(e.target.value)}${tail}></select>`;
    }
    this.express('state=numeric-range', { mechanism: 'value + onChange + min/max/step (controlled)' });
    const t = node.input?.inputType === 'number' ? 'number' : 'range';
    return `${labelEl}<input id="${id}" type="${t}" value={${cs.value}} onChange={(e) => ${cs.change}(Number(e.target.value))}${num('min', cs.min)}${num('max', cs.max)}${num('step', cs.step)}${tail} />`;
  }

  visitInput(node) {
    const i = node.input ?? {};
    const cs = this.controlState(node);
    if (cs) return this.renderControlState(node, cs);
    const id = this.inputId(node);
    const labelEl = node.label ? `<label htmlFor="${id}">${this.interp(node.label)}</label>\n` : '';
    const value = i.valueProp ? ` value={${i.valueProp}}` : '';
    const change = i.changeProp ? ` onChange={(e) => ${i.changeProp}(e.target.value)}` : '';
    const invalid = node.a11y?.invalid;
    const desc = node.a11y?.describedBy;
    let aria = '';
    if (invalid) { aria += ` aria-invalid={!!${invalid}}`; this.express('a11y.invalid', { mechanism: 'aria-invalid' }); }
    if (desc) {
      // Only point at the description while it is actually rendered.
      aria += invalid ? ` aria-describedby={${invalid} ? "${desc}" : undefined}` : ` aria-describedby="${desc}"`;
      this.express('a11y.describedBy', { mechanism: 'aria-describedby' });
    }
    return `${labelEl}<input id="${id}" type="${i.inputType ?? 'text'}"${value}${change}${aria}${this.a11yAttrs(node)}${this.styleAttr(node)} />`;
  }

  visitSlot(node) {
    const name = node.label?.value ?? 'children';
    return `{${name}}`;
  }

  wrapConditional(node, rendered) {
    return `{${node.when} && (\n${indent(rendered, 2)}\n)}`;
  }

  condBlock(flag, thenStr, elseStr) {
    if (elseStr == null) return `{${flag} && (\n${indent(thenStr, 2)}\n)}`;
    return `{${flag} ? (\n${indent(thenStr, 2)}\n) : (\n${indent(elseStr, 2)}\n)}`;
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
      case 'function': return /change/i.test(prop.name) ? '(value: string) => void' : '() => void';
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
    const propsIface = this.ir.props.length
      ? `export interface ${name}Props {\n`
        + this.ir.props.map((p) => `  ${p.name}${p.required ? '' : '?'}: ${this.tsType(p)};`).join('\n')
        + `\n}\n\n`
      : `export interface ${name}Props {}\n\n`;
    const args = this.ir.props.map((p) => p.name).join(', ');
    const iconImport = this.usedIcons.size
      ? `import { ${[...this.usedIcons].join(', ')} } from '${ICON_LIB}';\n`
      : '';
    return `import React from 'react';\n${iconImport}import '../../_shared/tokens/tokens.css';\n\n`
      + propsIface
      + `export function ${name}({ ${args} }: ${name}Props) {\n`
      + `  return (\n${indent(root, 4)}\n  );\n}\n`;
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
