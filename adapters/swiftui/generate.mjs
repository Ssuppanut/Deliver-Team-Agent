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
  textExpr(vr) {
    if (!vr) return 'Text("")';
    if (vr.kind === 'literal') return `Text(${JSON.stringify(String(vr.value))})`;
    if (vr.kind === 'ref') return `Text(String(describing: ${safe(vr.value)}))`;
    const id = firstIdent(vr.value);
    this.warnings.push(`expr simplified to \`${id}\` (native cannot eval "${vr.value}")`);
    return `Text(String(describing: ${safe(id)}))`;
  }
  interp(vr) { return this.textExpr(vr); }
  modifiers(node) {
    if (!node.style) return '';
    return Object.entries(node.style)
      .filter(([slot]) => MODIFIER[slot])
      .map(([slot, token]) => `\n  ${MODIFIER[slot](mapToken(token))}`)
      .join('');
  }
  a11y(node) {
    if (!node.a11y?.label) return '';
    const l = node.a11y.label;
    const v = l.kind === 'literal' ? JSON.stringify(String(l.value)) : safe(l.value);
    return `\n  .accessibilityLabel(${v})`;
  }
  visitContainer(node, children) {
    return `VStack(alignment: .leading, spacing: 8) {\n${indent(children, 2)}\n}${this.modifiers(node)}${this.a11y(node)}`;
  }
  visitMedia(node) {
    const url = node.src.kind === 'literal' ? JSON.stringify(String(node.src.value)) : safe(node.src.value);
    return `AsyncImage(url: URL(string: ${url}))${this.modifiers(node)}${this.a11y(node)}`;
  }
  visitHeading(node) {
    const font = ['', '.largeTitle', '.title', '.title2', '.title3', '.headline', '.subheadline'][node.level ?? 3];
    return `${this.textExpr(node.text)}\n  .font(${font})${this.modifiers(node)}`;
  }
  visitText(node) {
    return `${this.textExpr(node.text)}${this.modifiers(node)}`;
  }
  visitAction(node) {
    const action = node.onEvent ? safe(node.onEvent) : '{}';
    const label = node.icon
      ? `Label(${node.label ? JSON.stringify(String(node.label.value)) : '""'}, systemImage: "${this.icon(node.icon)}")`
      : this.textExpr(node.label);
    return `Button(action: ${action}) {\n  ${label}\n}${this.modifiers(node)}${this.a11y(node)}`;
  }
  visitLink(node) {
    const url = node.href.kind === 'literal' ? JSON.stringify(String(node.href.value)) : safe(node.href.value);
    const label = node.label ? JSON.stringify(String(node.label.value)) : '""';
    return `Link(${label}, destination: URL(string: ${url})!)${this.modifiers(node)}`;
  }
  visitInput(node) {
    const i = node.input ?? {};
    const label = node.a11y?.label?.value ?? '';
    return `TextField(${JSON.stringify(String(label))}, text: $${safe(i.valueProp ?? 'value')})${this.modifiers(node)}`;
  }
  visitSlot() { return 'content'; }
  wrapConditional(node, rendered) {
    return `if ${safe(node.when)} {\n${indent(rendered, 2)}\n}`;
  }
  wrapIteration(node, rendered) {
    const { items, as, key } = node.each;
    return `ForEach(${safe(items)}, id: \\.${key}) { ${safe(as)} in\n${indent(rendered, 2)}\n}`;
  }
  swiftType(prop) {
    switch (prop.type) {
      case 'number': return 'Double';
      case 'boolean': return 'Bool';
      case 'function': return '() -> Void';
      case 'enum': return 'String';
      case 'array': return `[${this.ir.component}Item]`;
      default: return 'String';
    }
  }
  renderComponent(root) {
    const name = this.ir.component;
    const stored = this.ir.props
      .map((p) => (p.type === 'function' ? `  let ${safe(p.name)}: ${this.swiftType(p)}` : `  let ${safe(p.name)}: ${this.swiftType(p)}`))
      .join('\n');
    const arrayProp = this.ir.props.find((p) => p.type === 'array');
    const hasId = arrayProp?.itemShape && 'id' in arrayProp.itemShape;
    const itemStruct = arrayProp?.itemShape
      ? `struct ${name}Item: Identifiable {\n`
        + Object.entries(arrayProp.itemShape).map(([k, t]) => `  let ${k}: ${t === 'number' ? 'Double' : 'String'}`).join('\n')
        // Only synthesize `id` when the shape does not already carry one (avoids
        // a stored/computed `id` collision, which recurses).
        + (hasId ? '' : `\n  let id = UUID().uuidString`)
        + `\n}\n\n`
      : '';
    return `import SwiftUI\n\n${itemStruct}struct ${name}: View {\n${stored}\n\n  var body: some View {\n${indent(root, 4)}\n  }\n}\n`;
  }
}

export function generateSwiftUI(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new SwiftUIRenderer(ir, { iconMap });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/swiftui', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.swift`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`swiftui: wrote ${generateSwiftUI(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
