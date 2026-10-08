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
    if (vr.kind === 'format') { this.express('number-format', { mechanism: 'Intl.NumberFormat' }); return `{${this.intlFormatExpr(this.numberFormat(vr))}}`; }
    if (vr.kind === 'datetime') {
      const df = this.dateFormat(vr);
      this.express('date-format', { mechanism: 'Intl.DateTimeFormat' });
      if (df.timeZone) this.express('date-timezone', { mechanism: df.timeZone.kind === 'literal' ? 'Intl timeZone option (literal)' : 'Intl timeZone option + __dtfTimeZone runtime fallback to device' });
      return `{${this.intlDateExpr(df)}}`;
    }
    return `{${vr.value}}`;
  }
  bind(attr, vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return ` ${attr}=${JSON.stringify(String(vr.value))}`;
    return ` ${attr}={${vr.value}}`;
  }
  styleAttr(node) {
    const v = this.variantData(node);
    // F-7 size slot: a dimension TOKEN drives width/height (never a raw px).
    if (node.size) this.express('size', { mechanism: 'width/height (dimension token)' });
    // D4a: per-slot static style traits (variant cases are not counted; padding is not a ledger trait, F-30).
    if (node.style?.background) this.express('style=background', { mechanism: 'background-color (static style)' });
    if (node.style?.radius) this.express('style=radius', { mechanism: 'border-radius (static style)' });
    // F-4 orientation (PR A2): an oriented container WITH children gets a real
    // layout axis — display:flex + flex-direction (keywords, not tokens).
    const oriented = node.orientation && node.children?.length;
    const flex = oriented ? [`display: flex`, `flex-direction: ${node.orientation === 'horizontal' ? 'row' : 'column'}`] : [];
    if (!node.style && !v && !node.size && !oriented) return '';
    const base = [
      ...flex,
      ...(node.style ? Object.entries(node.style).map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: ${mapToken(token)}`) : []),
      ...(node.size ? [`width: ${mapToken(node.size)}`, `height: ${mapToken(node.size)}`] : []),
    ];
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
    // D4a: labelledBy needs a target element id and ids are not plumbed to referenced elements yet, so aria-labelledby
    // could point to nothing. Emit nothing; time-boxed waiver until id plumbing exists (see docs/audits).
    if (node.a11y?.labelledBy) {
      this.diverge('a11y.labelledBy', { reason: 'aria-labelledby needs a target element id and ids are not plumbed to referenced elements yet', fallback: 'nothing emitted until id plumbing exists', waiver: 'a11y-labelledby-svelte' });
      this.warnings.push('a11y: labelledBy is not emitted (no id plumbing to the referenced element yet; documented divergence)');
    }
    if (node.a11y?.live) { out.push(` aria-live="${node.a11y.live}"`); this.express(`a11y.live=${node.a11y.live}`, { mechanism: 'aria-live' }); }
    return out.join('');
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
  // F-5 boolean-attribute binding: a caller boolean flag ref -> `disabled`.
  disabledAttr(node) {
    if (!node.disabled) return '';
    this.express('disabled', { mechanism: 'disabled={flag}' });
    return ` disabled={${node.disabled}}`;
  }
  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    this.express('icon', { mechanism: 'variant icon cases (aria-hidden dynamic component)' });
    const cases = Object.entries(v.iconCases)
      .map(([val, tok]) => `${JSON.stringify(val)}: ${this.icon(tok)}`)
      .join(', ');
    return `<svelte:component this={({ ${cases} })[${v.prop}]} aria-hidden="true" />`;
  }
  visitContainer(node, children) {
    const tag = node.as || 'div';
    const lead = this.variantIcon(node);
    const inner = lead ? `${lead}\n${children}` : children;
    return `<${tag}${this.idAttr(node)}${this.a11y(node)}${this.orientationAttr(node)}${this.styleAttr(node)}>\n${indent(inner, 2)}\n</${tag}>`;
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
    if (node.icon) this.express('icon', { mechanism: 'action icon (aria-hidden icon component)' });
    return `<button type="button"${handler}${this.disabledAttr(node)}${this.a11y(node)}${this.styleAttr(node)}>${icon}${node.label ? this.interp(node.label) : ''}</button>`;
  }
  visitIcon(node) {
    const sym = this.icon(node.icon);
    this.express('icon', { mechanism: 'icon component' });
    return node.a11y?.label
      ? `<svelte:component this={${sym}} role="img"${this.bind('aria-label', node.a11y.label)}${this.styleAttr(node)} />`
      : `<svelte:component this={${sym}} aria-hidden="true"${this.styleAttr(node)} />`;
  }

  visitLink(node, children) {
    if (node.href) this.express('link-href', { mechanism: '<a href> (browser navigation)' });
    return `<a${this.bind('href', node.href)}${this.styleAttr(node)}>${node.label ? this.interp(node.label) : children}</a>`;
  }
  // Control-state primitive — controlled (caller-held) two-way binding. `bind:`
  // to a local is the UNCONTROLLED idiom (scope guard: controlled-only), so the
  // controlled form binds the value and routes change to the caller's handler.
  inputAria(node) {
    let aria = '';
    const invalid = node.a11y?.invalid;
    const desc = node.a11y?.describedBy;
    if (invalid) { aria += ` aria-invalid={!!${invalid}}`; this.express('a11y.invalid', { mechanism: 'aria-invalid' }); }
    if (desc) { aria += invalid ? ` aria-describedby={${invalid} ? '${desc}' : undefined}` : ` aria-describedby="${desc}"`; this.express('a11y.describedBy', { mechanism: 'aria-describedby' }); }
    return aria;
  }

  // F-25 rich options: per-option decorative icon via the emitted runtime registry.
  richOptionIcon(node) {
    if (!this.hasOptionIcons(node)) return '';
    this.usesOptionIcons = true;
    for (const sym of Object.values(this.iconMap)) this.usedIcons.add(sym);
    this.express('option-icon', { mechanism: 'per-option lucide icon via runtime registry (decorative, aria-hidden)' });
    return '<svelte:component this={OPTION_ICONS[opt.icon]} aria-hidden="true" />\n      ';
  }

  renderControlState(node, cs) {
    const id = node.id || `${this.ir.component.toLowerCase()}-${cs.value ?? 'input'}`;
    const labelEl = node.label ? `<label for="${id}">${this.interp(node.label)}</label>\n` : '';
    const tail = `${this.a11y(node)}${this.inputAria(node)}${this.styleAttr(node)}`;
    const num = (n, v) => (v == null ? '' : ` ${n}={${v}}`);
    if (cs.kind === 'boolean') {
      this.express('state=boolean', { mechanism: 'checked={} + on:change (controlled)' });
      return `${labelEl}<input id="${id}" type="checkbox" checked={${cs.value}} on:change={(e) => ${cs.change}(e.currentTarget.checked)}${tail} />`;
    }
    if (cs.kind === 'selected-value') {
      if (node.role === 'radiogroup') {
        this.express('state=selected-value', { mechanism: 'radiogroup: name-grouped radios, checked from bound value + on:change (controlled)' });
        const ic = this.richOptionIcon(node);
        const items = cs.options
          ? `\n  {#each ${cs.options} as opt (opt.value)}\n    <label>\n      <input type="radio" name="${id}" value={opt.value} checked={${cs.value} === opt.value} on:change={() => ${cs.change}(opt.value)} />\n      ${ic}{opt.label}\n    </label>\n  {/each}\n`
          : '';
        return `${labelEl}<div id="${id}"${tail}>${items}</div>`;
      }
      this.express('state=selected-value', { mechanism: 'value={} + on:change on <select> with <option> children (controlled)' });
      const items = cs.options
        ? `\n  {#each ${cs.options} as opt (opt.value)}\n    <option value={opt.value}>{opt.label}</option>\n  {/each}\n`
        : '';
      return `${labelEl}<select id="${id}" value={${cs.value}} on:change={(e) => ${cs.change}(e.currentTarget.value)}${tail}>${items}</select>`;
    }
    this.express('state=numeric-range', { mechanism: 'value={} + on:input + min/max/step (controlled)' });
    const t = node.input?.inputType === 'number' ? 'number' : 'range';
    return `${labelEl}<input id="${id}" type="${t}" value={${cs.value}} on:input={(e) => ${cs.change}(Number(e.currentTarget.value))}${num('min', cs.min)}${num('max', cs.max)}${num('step', cs.step)}${tail} />`;
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
    // F-19 textarea: a multi-line text input renders as <textarea>.
    if (i.multiline) {
      this.express('input.multiline', { mechanism: '<textarea>' });
      return `${labelEl}<textarea id="${id}"${value}${change}${aria}${this.a11y(node)}${this.styleAttr(node)}></textarea>`;
    }
    return `${labelEl}<input id="${id}" type="${i.inputType ?? 'text'}"${value}${change}${aria}${this.a11y(node)}${this.styleAttr(node)} />`;
  }
  visitSlot(node) {
    const name = node.label?.value;
    return name ? `<slot name="${name}" />` : '<slot />';
  }
  wrapConditional(node, rendered) {
    return `{#if ${node.when}}\n${indent(rendered, 2)}\n{/if}`;
  }

  // Native Svelte if / {:else if} / {:else}; a nested-in-then body is itself a
  // full {#if}…{/if} block, so nesting composes without any special-casing.
  condChainRender(branches, elseBody) {
    let s = `{#if ${branches[0].when}}\n${indent(branches[0].body, 2)}`;
    for (let i = 1; i < branches.length; i++) {
      s += `\n{:else if ${branches[i].when}}\n${indent(branches[i].body, 2)}`;
    }
    if (elseBody != null) s += `\n{:else}\n${indent(elseBody, 2)}`;
    return `${s}\n{/if}`;
  }
  wrapIteration(node, rendered) {
    const { items, as, key } = node.each;
    return `{#each ${items} as ${as} (${as}.${key})}\n${indent(rendered, 2)}\n{/each}`;
  }
  tsType(prop) {
    switch (prop.type) {
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'date': return 'Date';
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
    // F-25: runtime registry mapping known icon tokens to lucide components.
    const optionIcons = this.usesOptionIcons
      ? `\n  const OPTION_ICONS: Record<string, unknown> = { ${Object.entries(this.iconMap).map(([t, sym]) => `${JSON.stringify(t)}: ${sym}`).join(', ')} };`
      : '';
    const tzGuard = this.usesTzGuard ? `\n  ${this.tzGuardHelper().trimEnd().split('\n').join('\n  ')}` : '';
    return `<script lang="ts">\n${iconImport}  import '../../_shared/tokens/tokens.css';\n\n${decls}${optionIcons}${tzGuard}\n</script>\n\n${root}\n`;
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
