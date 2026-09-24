#!/usr/bin/env node
/** Vue 3 adapter — <script setup lang="ts"> SFC. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererBase, indent } from '../_shared/renderer-base.mjs';
import { specToIrFromFile } from '../../_shared/scripts/spec-to-ir.mjs';
import { mapToken, STYLE_PROP } from './token-map.mjs';
import { iconMap, ICON_LIB } from './icon-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

class VueRenderer extends RendererBase {
  interp(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return String(vr.value);
    return `{{ ${vr.value} }}`;
  }
  bind(attr, vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return ` ${attr}=${JSON.stringify(String(vr.value))}`;
    return ` :${attr}="${vr.value}"`;
  }
  styleAttr(node) {
    const v = this.variantData(node);
    if (!node.style && !v) return '';
    if (!v) {
      const entries = Object.entries(node.style)
        .map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: ${mapToken(token)}`);
      return ` style="${entries.join('; ')}"`;
    }
    // Dynamic :style object binding so the variant resolves at runtime.
    const base = node.style
      ? Object.entries(node.style).map(([slot, token]) => `'${STYLE_PROP[slot] ?? slot}': '${mapToken(token)}'`)
      : [];
    const cases = Object.entries(v.styleCases)
      .map(([value, slots]) => {
        const inner = Object.entries(slots).map(([s, t]) => `'${STYLE_PROP[s] ?? s}': '${mapToken(t)}'`).join(', ');
        return `${JSON.stringify(value)}: { ${inner} }`;
      })
      .join(', ');
    const inner = [...base, `...({ ${cases} })[${v.prop}]`].filter(Boolean).join(', ');
    return ` :style="{ ${inner} }"`;
  }
  a11y(node) {
    const out = [];
    if (node.role) out.push(` role="${node.role}"`);
    if (node.a11y?.label) out.push(this.bind('aria-label', node.a11y.label));
    if (node.a11y?.live) out.push(` aria-live="${node.a11y.live}"`);
    return out.join('');
  }
  idAttr(node) {
    return node.id ? ` id="${node.id}"` : '';
  }
  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    const cases = Object.entries(v.iconCases)
      .map(([val, tok]) => `${JSON.stringify(val)}: ${this.icon(tok)}`)
      .join(', ');
    return `<component :is="({ ${cases} })[${v.prop}]" aria-hidden="true" />`;
  }
  visitContainer(node, children) {
    const tag = node.as || 'div';
    const lead = this.variantIcon(node);
    const inner = lead ? `${lead}\n${children}` : children;
    return `<${tag}${this.idAttr(node)}${this.a11y(node)}${this.styleAttr(node)}>\n${indent(inner, 2)}\n</${tag}>`;
  }
  visitMedia(node) {
    return `<img${this.bind('src', node.src)}${this.bind('alt', node.alt ?? { kind: 'literal', value: '' })}${this.styleAttr(node)} />`;
  }
  visitHeading(node, children) {
    const tag = `h${node.level ?? 2}`;
    const body = node.text ? this.interp(node.text) : children;
    return `<${tag}${this.idAttr(node)}${this.styleAttr(node)}>${body}</${tag}>`;
  }
  visitText(node) {
    return `<span${this.idAttr(node)}${this.a11y(node)}${this.styleAttr(node)}>${this.interp(node.text)}</span>`;
  }
  visitAction(node) {
    const handler = node.onEvent ? ` @click="${node.onEvent}"` : '';
    const icon = node.icon ? `<${this.icon(node.icon)} aria-hidden="true" />` : '';
    return `<button type="button"${handler}${this.a11y(node)}${this.styleAttr(node)}>${icon}${node.label ? this.interp(node.label) : ''}</button>`;
  }
  visitIcon(node) {
    const sym = this.icon(node.icon);
    return node.a11y?.label
      ? `<${sym} role="img"${this.bind('aria-label', node.a11y.label)}${this.styleAttr(node)} />`
      : `<${sym} aria-hidden="true"${this.styleAttr(node)} />`;
  }

  visitLink(node, children) {
    return `<a${this.bind('href', node.href)}${this.styleAttr(node)}>${node.label ? this.interp(node.label) : children}</a>`;
  }
  visitInput(node) {
    const i = node.input ?? {};
    const id = node.id || `${this.ir.component.toLowerCase()}-${i.valueProp ?? 'input'}`;
    const labelEl = node.label ? `<label for="${id}">${this.interp(node.label)}</label>\n` : '';
    const model = i.valueProp ? ` :value="${i.valueProp}"` : '';
    const change = i.changeProp ? ` @input="${i.changeProp}(($event.target as HTMLInputElement).value)"` : '';
    const invalid = node.a11y?.invalid;
    const desc = node.a11y?.describedBy;
    let aria = '';
    if (invalid) aria += ` :aria-invalid="!!${invalid}"`;
    if (desc) aria += invalid ? ` :aria-describedby="${invalid} ? '${desc}' : undefined"` : ` aria-describedby="${desc}"`;
    return `${labelEl}<input id="${id}" type="${i.inputType ?? 'text'}"${model}${change}${aria}${this.a11y(node)}${this.styleAttr(node)} />`;
  }
  visitSlot(node) {
    const name = node.label?.value;
    return name ? `<slot name="${name}" />` : '<slot />';
  }
  wrapConditional(node, rendered) {
    // Vue applies v-if on the element; wrap in <template> to attach directive.
    return `<template v-if="${node.when}">\n${indent(rendered, 2)}\n</template>`;
  }

  condBlock(flag, thenStr, elseStr) {
    const t = `<template v-if="${flag}">\n${indent(thenStr, 2)}\n</template>`;
    if (elseStr == null) return t;
    return `${t}\n<template v-else>\n${indent(elseStr, 2)}\n</template>`;
  }
  wrapIteration(node, rendered) {
    const { items, as, key } = node.each;
    return `<template v-for="${as} in ${items}" :key="${as}.${key}">\n${indent(rendered, 2)}\n</template>`;
  }
  tsType(prop) {
    switch (prop.type) {
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'function': return /change/i.test(prop.name) ? '(value: string) => void' : '() => void';
      case 'enum': return (prop.values ?? []).map((v) => `'${v}'`).join(' | ') || 'string';
      case 'array': {
        const shape = prop.itemShape
          ? `{ ${Object.entries(prop.itemShape).map(([k, t]) => `${k}: ${t}`).join('; ')} }`
          : 'unknown';
        return `${shape}[]`;
      }
      default: return 'string';
    }
  }
  renderComponent(root) {
    const props = this.ir.props.map((p) => `  ${p.name}${p.required ? '' : '?'}: ${this.tsType(p)}`).join(';\n');
    const iconImport = this.usedIcons.size
      ? `import { ${[...this.usedIcons].join(', ')} } from '${ICON_LIB}';\n`
      : '';
    return `<script setup lang="ts">\n${iconImport}import '../../_shared/tokens/tokens.css';\n\n`
      + `defineProps<{\n${props}\n}>();\n</script>\n\n`
      + `<template>\n${indent(root, 2)}\n</template>\n`;
  }
}

export function generateVue(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new VueRenderer(ir, { iconMap });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/vue', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.vue`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`vue: wrote ${generateVue(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
