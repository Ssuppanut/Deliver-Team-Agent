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
    if (!node.style) return '';
    const entries = Object.entries(node.style)
      .map(([slot, token]) => `${STYLE_PROP[slot] ?? slot}: ${mapToken(token)}`);
    return ` style={{ ${entries.join(', ')} }}`;
  }
  visitContainer(node, children) {
    const label = node.a11y?.label ? ` accessibilityLabel={${this.attr(node.a11y.label)}}` : '';
    return `<View accessible${label}${this.style(node)}>\n${indent(children, 2)}\n</View>`;
  }
  visitMedia(node) {
    const label = node.alt ? ` accessibilityLabel={${this.attr(node.alt)}}` : '';
    return `<Image source={{ uri: ${this.attr(node.src)} }}${label}${this.style(node)} />`;
  }
  visitHeading(node, children) {
    return `<Text accessibilityRole="header"${this.style(node)}>${node.text ? this.interp(node.text) : children}</Text>`;
  }
  visitText(node) {
    return `<Text${this.style(node)}>${this.interp(node.text)}</Text>`;
  }
  visitAction(node) {
    const press = node.onEvent ? ` onPress={${node.onEvent}}` : '';
    const icon = node.icon ? `<${this.icon(node.icon)} />` : '';
    return `<Pressable accessibilityRole="button"${press}${this.style(node)}>\n  ${icon}<Text>${node.label ? this.interp(node.label) : ''}</Text>\n</Pressable>`;
  }
  visitLink(node, children) {
    const press = node.href ? ` onPress={() => Linking.openURL(${this.attr(node.href)})}` : '';
    return `<Pressable accessibilityRole="link"${press}${this.style(node)}>\n  <Text>${node.label ? this.interp(node.label) : children}</Text>\n</Pressable>`;
  }
  visitInput(node) {
    const i = node.input ?? {};
    const value = i.valueProp ? ` value={${i.valueProp}}` : '';
    const change = i.changeProp ? ` onChangeText={${i.changeProp}}` : '';
    const label = node.a11y?.label ? ` accessibilityLabel={${this.attr(node.a11y.label)}}` : '';
    return `<TextInput${value}${change}${label}${this.style(node)} />`;
  }
  visitSlot(node) {
    const name = node.label?.value ?? 'children';
    return `{${name}}`;
  }
  wrapConditional(node, rendered) {
    return `{${node.when} && (\n${indent(rendered, 2)}\n)}`;
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
    const iconImport = this.usedIcons.size
      ? `import { ${[...this.usedIcons].join(', ')} } from '${ICON_LIB}';\n`
      : '';
    return `import React from 'react';\n`
      + `import { ${[...rnImports].join(', ')} } from 'react-native';\n`
      + `${iconImport}import { tokens } from '../../_shared/tokens/tokens-rn';\n\n`
      + `export interface ${name}Props {\n${props}\n}\n\n`
      + `export function ${name}({ ${args} }: ${name}Props) {\n  return (\n${indent(root, 4)}\n  );\n}\n`;
  }
}

export function generateReactNative(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new RNRenderer(ir, { iconMap });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/react-native', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.tsx`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`react-native: wrote ${generateReactNative(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
