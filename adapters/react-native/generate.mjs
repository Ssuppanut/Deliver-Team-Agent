#!/usr/bin/env node
/** React Native adapter — View/Text/Image/Pressable with JS design tokens. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererBase, indent } from '../_shared/renderer-base.mjs';
import { specToIrFromFile } from '../../_shared/scripts/spec-to-ir.mjs';
import { mapToken, STYLE_PROP } from './token-map.mjs';
import { iconMap, ICON_LIB } from './icon-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

class RNRenderer extends RendererBase {
  interp(vr) {
    if (!vr) return '';
    if (vr.kind === 'literal') return String(vr.value);
    return `{${vr.value}}`;
  }
  attr(vr) {
    if (!vr) return "''";
    if (vr.kind === 'literal') return JSON.stringify(String(vr.value));
    return vr.value;
  }
  style(node) {
    const base = node.style
      ? Object.entries(node.style).map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: ${mapToken(token)}`)
      : [];
    let spread = '';
    const v = this.variantData(node);
    if (v) {
      const cases = Object.entries(v.styleCases)
        .map(([value, slots]) => {
          const inner = Object.entries(slots).map(([s, t]) => `${STYLE_PROP[s] ?? s}: ${mapToken(t)}`).join(', ');
          return `${JSON.stringify(value)}: { ${inner} }`;
        })
        .join(', ');
      spread = `...({ ${cases} })[${v.prop}]`;
    }
    const inner = [...base, spread].filter(Boolean).join(', ');
    return inner ? ` style={{ ${inner} }}` : '';
  }
  variantIcon(node) {
    const v = this.variantData(node);
    if (!v || !Object.keys(v.iconCases).length) return '';
    const cases = Object.entries(v.iconCases)
      .map(([val, tok]) => `${JSON.stringify(val)}: <${this.icon(tok)} />`)
      .join(', ');
    return `{({ ${cases} })[${v.prop}]}`;
  }
  /** ARIA-style role -> React Native accessibilityRole (undefined where none exists). */
  rnRole(role) {
    return { img: 'image', alert: 'alert', button: 'button', link: 'link', header: 'header', presentation: 'none', none: 'none' }[role];
  }
  /** accessibilityLabel + role + live + busy — never a silent drop of role/live. */
  a11yProps(node) {
    const out = [];
    if (node.a11y?.label) { out.push(` accessibilityLabel={${this.attr(node.a11y.label)}}`); this.express('a11y.label', { mechanism: 'accessibilityLabel' }); }
    if (node.role) {
      const r = this.rnRole(node.role);
      if (r) { out.push(` accessibilityRole="${r}"`); this.express(`role=${node.role}`, { mechanism: `accessibilityRole="${r}"` }); }
      else {
        this.diverge(`role=${node.role}`, { reason: `no React Native accessibilityRole for "${node.role}"`, fallback: 'label + live region convey the role', waiver: `a11y-role-${node.role}` });
        this.warnings.push(`a11y: role "${node.role}" has no React Native accessibilityRole; conveyed via live region / label where present (documented divergence)`);
      }
    }
    if (node.a11y?.live) { out.push(` accessibilityLiveRegion="${node.a11y.live === 'assertive' ? 'assertive' : 'polite'}"`); this.express(`a11y.live=${node.a11y.live}`, { mechanism: 'accessibilityLiveRegion' }); }
    // A live status region is a busy/updating region (e.g. Spinner).
    if (node.role === 'status' && node.a11y?.live) out.push(` accessibilityState={{ busy: true }}`);
    return out.join('');
  }
  visitContainer(node, children) {
    const lead = this.variantIcon(node);
    const inner = lead ? `${lead}\n${children}` : children;
    return `<View accessible${this.a11yProps(node)}${this.style(node)}>\n${indent(inner, 2)}\n</View>`;
  }
  visitMedia(node) {
    const label = node.alt ? ` accessibilityLabel={${this.attr(node.alt)}}` : '';
    return `<Image source={{ uri: ${this.attr(node.src)} }}${label}${this.style(node)} />`;
  }
  visitHeading(node, children) {
    return `<Text accessibilityRole="header"${this.style(node)}>${node.text ? this.interp(node.text) : children}</Text>`;
  }
  visitText(node) {
    return `<Text${this.a11yProps(node)}${this.style(node)}>${this.interp(node.text)}</Text>`;
  }
  visitAction(node) {
    const press = node.onEvent ? ` onPress={${node.onEvent}}` : '';
    const icon = node.icon ? `<${this.icon(node.icon)} />` : '';
    // a11yProps accounts for an explicit accessibilityLabel / live on the button
    // (role is already fixed to "button" here). Without this the IR's a11y.label
    // was silently dropped — caught by the Lowering Ledger.
    return `<Pressable accessibilityRole="button"${press}${this.a11yProps(node)}${this.style(node)}>\n  ${icon}<Text>${node.label ? this.interp(node.label) : ''}</Text>\n</Pressable>`;
  }
  visitIcon(node) {
    const sym = this.icon(node.icon);
    return node.a11y?.label
      ? `<${sym} accessibilityRole="image" accessibilityLabel={${this.attr(node.a11y.label)}}${this.style(node)} />`
      : `<${sym} accessible={false}${this.style(node)} />`;
  }

  visitLink(node, children) {
    const press = node.href ? ` onPress={() => Linking.openURL(${this.attr(node.href)})}` : '';
    return `<Pressable accessibilityRole="link"${press}${this.style(node)}>\n  <Text>${node.label ? this.interp(node.label) : children}</Text>\n</Pressable>`;
  }
  visitInput(node) {
    const i = node.input ?? {};
    const role = node.role;
    // A visible label also serves as the accessible name (no htmlFor on native).
    const labelSource = node.label ?? node.a11y?.label;
    const labelEl = node.label ? `<Text>${this.interp(node.label)}</Text>\n` : '';
    const a11yLabel = labelSource ? ` accessibilityLabel={${this.attr(labelSource)}}` : '';
    if (node.a11y?.label) this.express('a11y.label', { mechanism: 'accessibilityLabel' });
    if (node.a11y?.describedBy) this.diverge('a11y.describedBy', { reason: 'React Native has no aria-describedby', fallback: 'adjacent live-region Text / accessibilityHint', waiver: 'a11y-describedby-native' });
    const invalidAttr = node.a11y?.invalid ? ` aria-invalid={!!${node.a11y.invalid}}` : '';
    if (node.a11y?.invalid) this.express('a11y.invalid', { mechanism: 'aria-invalid' });

    // Real form controls for the toggle / adjustable roles — never a bare TextInput.
    if (role === 'checkbox' || role === 'switch') {
      const v = i.valueProp ?? 'checked';
      const onCh = i.changeProp ? ` onValueChange={${i.changeProp}}` : '';
      this.express(`role=${role}`, { mechanism: `<Switch> + accessibilityRole="${role}" + accessibilityState={{checked}}` });
      return `${labelEl}<Switch value={${v}}${onCh} accessibilityRole="${role}" accessibilityState={{ checked: ${v} }}${a11yLabel}${invalidAttr}${this.style(node)} />`;
    }
    if (role === 'slider') {
      const v = i.valueProp ?? 'value';
      const onCh = i.changeProp ? ` onValueChange={${i.changeProp}}` : '';
      this.express(`role=${role}`, { mechanism: '<Slider> + accessibilityRole="adjustable" + accessibilityValue' });
      return `${labelEl}<Slider value={${v}}${onCh} accessibilityRole="adjustable" accessibilityValue={{ now: ${v} }}${a11yLabel}${this.style(node)} />`;
    }
    const value = i.valueProp ? ` value={${i.valueProp}}` : '';
    const change = i.changeProp ? ` onChangeText={${i.changeProp}}` : '';
    let roleAttr = '';
    if (role) {
      const r = this.rnRole(role);
      if (r) { roleAttr = ` accessibilityRole="${r}"`; this.express(`role=${role}`, { mechanism: `accessibilityRole="${r}"` }); }
      else this.diverge(`role=${role}`, { reason: `no React Native accessibilityRole for "${role}"`, fallback: 'label', waiver: `a11y-role-${role}` });
    }
    return `${labelEl}<TextInput${value}${change}${a11yLabel}${invalidAttr}${roleAttr}${this.style(node)} />`;
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
    return `{${items}.map((${as}) => (\n  <React.Fragment key={${as}.${key}}>\n${indent(rendered, 4)}\n  </React.Fragment>\n))}`;
  }
  tsType(prop) {
    switch (prop.type) {
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'function': return prop.name.toLowerCase().includes('change') ? '(value: string) => void' : '() => void';
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
    const name = this.ir.component;
    const props = this.ir.props.map((p) => `  ${p.name}${p.required ? '' : '?'}: ${this.tsType(p)};`).join('\n');
    const args = this.ir.props.map((p) => p.name).join(', ');
    const rnImports = new Set(['View', 'Text', 'Image', 'Pressable', 'TextInput', 'Linking']);
    if (/<Switch\b/.test(root)) rnImports.add('Switch');
    const sliderImport = /<Slider\b/.test(root) ? `import Slider from '@react-native-community/slider';\n` : '';
    const iconImport = this.usedIcons.size
      ? `import { ${[...this.usedIcons].join(', ')} } from '${ICON_LIB}';\n`
      : '';
    return `import React from 'react';\n`
      + `import { ${[...rnImports].join(', ')} } from 'react-native';\n`
      + `${sliderImport}${iconImport}import { tokens } from '../../_shared/tokens/tokens-rn';\n\n`
      + `export interface ${name}Props {\n${props}\n}\n\n`
      + `export function ${name}({ ${args} }: ${name}Props) {\n  return (\n${indent(root, 4)}\n  );\n}\n`;
  }
}

export function generateReactNative(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new RNRenderer(ir, { iconMap, adapter: "react-native" });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/react-native', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.tsx`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size, ledger: renderer.ledger };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`react-native: wrote ${generateReactNative(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
