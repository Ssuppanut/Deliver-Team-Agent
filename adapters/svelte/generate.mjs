#!/usr/bin/env node
/** Svelte adapter — <script lang="ts"> component. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererBase, indent } from '../_shared/renderer-base.mjs';
import { specToIrFromFile } from '../../_shared/scripts/spec-to-ir.mjs';
import { mapToken, STYLE_PROP } from './token-map.mjs';
import { iconMap, ICON_LIB } from './icon-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

class SvelteRenderer extends RendererBase {
  interp(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return String(vr.value);
    return `{${vr.value}}`;
  }
  bind(attr, vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return ` ${attr}=${JSON.stringify(String(vr.value))}`;
    return ` ${attr}={${vr.value}}`;
  }
  styleAttr(node) {
    const v = this.variantData(node);
    if (!node.style && !v) return '';
    const base = node.style
      ? Object.entries(node.style).map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: ${mapToken(token)}`)
      : [];
    if (!v) return ` style="${base.join('; ')}"`;
    // Inline a per-value CSS string, indexed by the variant prop, via Svelte
    // attribute interpolation — no extra script state needed.
    const cases = Object.entries(v.styleCases)
      .map(([value, slots]) => {
        const css = Object.entries(slots).map(([s, t]) => `${STYLE_PROP[s] ?? s}: ${mapToken(t)}`).join('; ');
        return `${JSON.stringify(value)}: ${JSON.stringify(css)}`;
      })
      .join(', ');
    const prefix = base.length ? `${base.join('; ')}; ` : '';
    return ` style="${prefix}{({ ${cases} })[${v.prop}]}"`;
  }
  a11y(node) {
    const out = [];
    if (node.role) { out.push(` role="${node.role}"`); this.express(`role=${node.role}`, { mechanism: `role="${node.role}"` }); }
    if (node.a11y?.label) { out.push(this.bind('aria-label', node.a11y.label)); this.express('a11y.label', { mechanism: 'aria-label' }); }
    if (node.a11y?.live) { out.push(` aria-live="${node.a11y.live}"`); this.express(`a11y.live=${node.a11y.live}`, { mechanism: 'aria-live' }); }
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
    return `<svelte:component this={({ ${cases} })[${v.prop}]} aria-hidden="true" />`;
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
    return `<${tag}${this.idAttr(node)}${this.styleAttr(node)}>${node.text ? this.interp(node.text) : children}</${tag}>`;
  }
  visitText(node) {
    return `<span${this.idAttr(node)}${this.a11y(node)}${this.styleAttr(node)}>${this.interp(node.text)}</span>`;
  }
  visitAction(node) {
    const handler = node.onEvent ? ` on:click={${node.onEvent}}` : '';
    const icon = node.icon ? `<svelte:component this={${this.icon(node.icon)}} aria-hidden="true" />` : '';
    return `<button type="button"${handler}${this.a11y(node)}${this.styleAttr(node)}>${icon}${node.label ? this.interp(node.label) : ''}</button>`;
  }
  visitIcon(node) {
    const sym = this.icon(node.icon);
    return node.a11y?.label
      ? `<svelte:component this={${sym}} role="img"${this.bind('aria-label', node.a11y.label)}${this.styleAttr(node)} />`
      : `<svelte:component this={${sym}} aria-hidden="true"${this.styleAttr(node)} />`;
  }

  visitLink(node, children) {
    return `<a${this.bind('href', node.href)}${this.styleAttr(node)}>${node.label ? this.interp(node.label) : children}</a>`;
  }
  // Control-state primitive — controlled (caller-held) two-way binding. `bind:`
  // to a local is the UNCONTROLLED idiom (scope guard: controlled-only), so the
  // controlled form binds the value and routes change to the caller's handler.
  renderControlState(node, cs) {
    const id = node.id || `${this.ir.component.toLowerCase()}-${cs.value ?? 'input'}`;
    const labelEl = node.label ? `<label for="${id}">${this.interp(node.label)}</label>\n` : '';
    const tail = `${this.a11y(node)}${this.styleAttr(node)}`;
    const num = (n, v) => (v == null ? '' : ` ${n}={${v}}`);
    if (cs.kind === 'boolean') {
      this.express('state=boolean', { mechanism: 'checked={} + on:change (controlled)' });
      return `${labelEl}<input id="${id}" type="checkbox" checked={${cs.value}} on:change={(e) => ${cs.change}(e.currentTarget.checked)}${tail} />`;
    }
    if (cs.kind === 'selected-value') {
      this.express('state=selected-value', { mechanism: 'value={} + on:change on <select> (controlled)' });
      return `${labelEl}<select id="${id}" value={${cs.value}} on:change={(e) => ${cs.change}(e.currentTarget.value)}${tail}></select>`;
    }
    this.express('state=numeric-range', { mechanism: 'value={} + on:input + min/max/step (controlled)' });
    return `${labelEl}<input id="${id}" type="range" value={${cs.value}} on:input={(e) => ${cs.change}(Number(e.currentTarget.value))}${num('min', cs.min)}${num('max', cs.max)}${num('step', cs.step)}${tail} />`;
  }

  visitInput(node) {
    const i = node.input ?? {};
    const cs = this.controlState(node);
    if (cs) return this.renderControlState(node, cs);
    const id = node.id || `${this.ir.component.toLowerCase()}-${i.valueProp ?? 'input'}`;
    const labelEl = node.label ? `<label for="${id}">${this.interp(node.label)}</label>\n` : '';
    const value = i.valueProp ? ` value={${i.valueProp}}` : '';
    const change = i.changeProp ? ` on:input={(e) => ${i.changeProp}((e.currentTarget as HTMLInputElement).value)}` : '';
    const invalid = node.a11y?.invalid;
    const desc = node.a11y?.describedBy;
    let aria = '';
    if (invalid) { aria += ` aria-invalid={!!${invalid}}`; this.express('a11y.invalid', { mechanism: 'aria-invalid' }); }
    if (desc) { aria += invalid ? ` aria-describedby={${invalid} ? '${desc}' : undefined}` : ` aria-describedby="${desc}"`; this.express('a11y.describedBy', { mechanism: 'aria-describedby' }); }
    return `${labelEl}<input id="${id}" type="${i.inputType ?? 'text'}"${value}${change}${aria}${this.a11y(node)}${this.styleAttr(node)} />`;
  }
  visitSlot(node) {
    const name = node.label?.value;
    return name ? `<slot name="${name}" />` : '<slot />';
  }
  wrapConditional(node, rendered) {
    return `{#if ${node.when}}\n${indent(rendered, 2)}\n{/if}`;
  }

  condBlock(flag, thenStr, elseStr) {
    if (elseStr == null) return `{#if ${flag}}\n${indent(thenStr, 2)}\n{/if}`;
    return `{#if ${flag}}\n${indent(thenStr, 2)}\n{:else}\n${indent(elseStr, 2)}\n{/if}`;
  }
  wrapIteration(node, rendered) {
    const { items, as, key } = node.each;
    return `{#each ${items} as ${as} (${as}.${key})}\n${indent(rendered, 2)}\n{/each}`;
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
    const decls = this.ir.props
      .map((p) => `  export let ${p.name}${p.required ? '' : ' = undefined'}: ${this.tsType(p)};`)
      .join('\n');
    const iconImport = this.usedIcons.size
      ? `  import { ${[...this.usedIcons].join(', ')} } from '${ICON_LIB}';\n`
      : '';
    return `<script lang="ts">\n${iconImport}  import '../../_shared/tokens/tokens.css';\n\n${decls}\n</script>\n\n${root}\n`;
  }
}

export function generateSvelte(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new SvelteRenderer(ir, { iconMap, adapter: "svelte" });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/svelte', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.svelte`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size, ledger: renderer.ledger };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`svelte: wrote ${generateSvelte(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
