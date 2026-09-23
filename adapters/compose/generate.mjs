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
    return { img: 'Role.Image', button: 'Role.Button', checkbox: 'Role.Checkbox', tab: 'Role.Tab' }[role];
  }
  /** contentDescription + role + liveRegion — never a silent drop of role/live. */
  a11ySemantics(node) {
    const props = [];
    if (node.a11y?.label) {
      const l = node.a11y.label;
      props.push(`contentDescription = ${l.kind === 'literal' ? JSON.stringify(String(l.value)) : l.value}`);
    }
    if (node.role) {
      const r = this.composeRole(node.role);
      if (r) props.push(`role = ${r}`);
      else if (!['presentation', 'none'].includes(node.role)) {
        this.warnings.push(`a11y: role "${node.role}" has no Compose Role; conveyed via liveRegion / contentDescription where present (documented divergence)`);
      }
    }
    if (node.a11y?.live) props.push(`liveRegion = LiveRegionMode.${node.a11y.live === 'assertive' ? 'Assertive' : 'Polite'}`);
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
    return `Column(${modArg}) {\n${indent(inner, 2)}\n}`;
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
    return `Button(onClick = ${onClick}${this._mod(node)}) {\n  ${inner}\n}`;
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
  visitInput(node) {
    const i = node.input ?? {};
    const parts = [`value = ${i.valueProp ?? 'value'}`, `onValueChange = ${i.changeProp ?? '{}'}`];
    const label = this.plain(node.label ?? node.a11y?.label);
    if (label) parts.push(`label = { Text(${label}) }`);
    if (node.a11y?.invalid) parts.push(`isError = ${node.a11y.invalid} != null`);
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
  wrapIteration(node, rendered) {
    const { items, as } = node.each;
    return `${items}.forEach { ${as} ->\n${indent(rendered, 2)}\n}`;
  }
  ktType(prop) {
    const opt = prop.required === false;
    switch (prop.type) {
      case 'number': return opt ? 'Double?' : 'Double';
      case 'boolean': return opt ? 'Boolean?' : 'Boolean';
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
        + Object.entries(arrayProp.itemShape).map(([k, t]) => `  val ${k}: ${t === 'number' ? 'Double' : 'String'}`).join(',\n')
        + `\n)\n\n`
      : '';
    const iconImport = this.usedIcons.size
      ? `import androidx.compose.material.icons.Icons\nimport androidx.compose.material.icons.filled.*\n`
      : '';
    // Semantics extras are imported only when the body actually emits them.
    const semExtra =
      (/\brole = Role\./.test(root) ? `import androidx.compose.ui.semantics.role\nimport androidx.compose.ui.semantics.Role\n` : '')
      + (/\bliveRegion = LiveRegionMode\./.test(root) ? `import androidx.compose.ui.semantics.liveRegion\nimport androidx.compose.ui.semantics.LiveRegionMode\n` : '');
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
  return { file, code, warnings: renderer.warnings, component: ir.component, usedIconsCount: renderer.usedIcons.size };
}

function main() {
  const [specPath, feature = 'demo'] = process.argv.slice(2);
  if (!specPath) { console.error('usage: generate.mjs <spec.yaml> <feature>'); process.exit(2); }
  console.log(`compose: wrote ${generateCompose(specPath, feature).file}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
