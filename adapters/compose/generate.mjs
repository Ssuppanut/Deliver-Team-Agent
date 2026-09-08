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
  strExpr(vr) {
    if (!vr) return '""';
    if (vr.kind === 'literal') return JSON.stringify(String(vr.value));
    if (vr.kind === 'ref') return vr.value;
    const id = firstIdent(vr.value);
    this.warnings.push(`expr simplified to \`${id}\` (native cannot eval "${vr.value}")`);
    return `${id}.toString()`;
  }
  interp(vr) { return this.strExpr(vr); }
  /** Build a Modifier chain from style slots, excluding color (a Text param). */
  modifier(node) {
    if (!node.style) return '';
    const chain = [];
    for (const [slot, token] of Object.entries(node.style)) {
      const t = mapToken(token);
      if (slot === 'background') chain.push(`.background(${t})`);
      else if (slot === 'padding') chain.push(`.padding(${t})`);
      else if (slot === 'radius') chain.push(`.clip(RoundedCornerShape(${t}))`);
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
  semantics(node) {
    if (!node.a11y?.label) return '';
    const l = node.a11y.label;
    const v = l.kind === 'literal' ? JSON.stringify(String(l.value)) : l.value;
    return `.semantics { contentDescription = ${v} }`;
  }
  visitContainer(node, children) {
    const mod = this.modifier(node);
    const modArg = mod ? `modifier = ${mod}${this.semantics(node)}` : (node.a11y?.label ? `modifier = Modifier${this.semantics(node)}` : '');
    return `Column(${modArg}) {\n${indent(children, 2)}\n}`;
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
    return `Text(text = ${this.strExpr(node.text)}${this._colorTail(node)}${this._mod(node)})`;
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
    return `Button(onClick = ${onClick}${this._mod(node)}) {\n  ${inner}\n}`;
  }
  visitLink(node, children) {
    return `Text(text = ${node.label ? this.strExpr(node.label) : `"${'link'}"`}, modifier = Modifier.clickable { /* open ${node.href?.value ?? ''} */ })`;
  }
  visitInput(node) {
    const i = node.input ?? {};
    return `TextField(value = ${i.valueProp ?? 'value'}, onValueChange = ${i.changeProp ?? '{}'}${this._mod(node)})`;
  }
  visitSlot() { return 'content()'; }
  wrapConditional(node, rendered) {
    return `if (${node.when}) {\n${indent(rendered, 2)}\n}`;
  }
  wrapIteration(node, rendered) {
    const { items, as } = node.each;
    return `${items}.forEach { ${as} ->\n${indent(rendered, 2)}\n}`;
  }
  ktType(prop) {
    switch (prop.type) {
      case 'number': return 'Double';
      case 'boolean': return 'Boolean';
      case 'function': return '() -> Unit';
      case 'enum': return 'String';
      case 'array': return `List<${this.ir.component}Item>`;
      default: return 'String';
    }
  }
  renderComponent(root) {
    const name = this.ir.component;
    const params = this.ir.props.map((p) => `  ${p.name}: ${this.ktType(p)}`).join(',\n');
    const arrayProp = this.ir.props.find((p) => p.type === 'array');
    const itemClass = arrayProp?.itemShape
      ? `data class ${name}Item(\n`
        + Object.entries(arrayProp.itemShape).map(([k, t]) => `  val ${k}: ${t === 'number' ? 'Double' : 'String'}`).join(',\n')
        + `\n)\n\n`
      : '';
    const iconImport = this.usedIcons.size
      ? `import androidx.compose.material.icons.Icons\nimport androidx.compose.material.icons.filled.*\n`
      : '';
    return `import androidx.compose.foundation.layout.*\n`
      + `import androidx.compose.foundation.background\n`
      + `import androidx.compose.foundation.shape.RoundedCornerShape\n`
      + `import androidx.compose.material3.*\n`
      + `import androidx.compose.runtime.Composable\n`
      + `import androidx.compose.ui.Modifier\n`
      + `import androidx.compose.ui.draw.clip\n`
      + `import androidx.compose.ui.semantics.contentDescription\n`
      + `import androidx.compose.ui.semantics.semantics\n`
      + `import androidx.compose.foundation.clickable\n`
      + `import coil.compose.AsyncImage\n`
      + `${iconImport}import designtokens.DesignTokens\n\n`
      + `${itemClass}@Composable\nfun ${name}(\n${params}\n) {\n${indent(root, 2)}\n}\n`;
  }
}

export function generateCompose(specPath, feature) {
  const ir = specToIrFromFile(specPath);
  const renderer = new ComposeRenderer(ir, { iconMap });
  const code = renderer.build();
  const outDir = resolve(ROOT, 'out/compose', feature);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${ir.component}.kt`);
  writeFileSync(file, code);
  return { file, code, warnings: renderer.warnings, component: ir.component };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`compose: wrote ${generateCompose(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
