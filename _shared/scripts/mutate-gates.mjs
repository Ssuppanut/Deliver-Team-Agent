#!/usr/bin/env node
/**
 * mutate-gates — Layer 3: gate mutation testing.
 * ----------------------------------------------
 * Throughout this project we proved each gate works by hand: revert a fix,
 * confirm the gate goes RED, restore. A gate you have never seen go RED is a
 * gate you cannot trust. This automates that proof across every gate and every
 * defect class, so a BLIND SPOT in the gates is found before shipping.
 *
 * Method:
 *   1. For a corpus of already-passing features, generate the full bundle
 *      { ir, results(6 adapters), ledger }.
 *   2. Confirm the un-mutated baseline is all-GREEN (so any RED comes from the
 *      mutation, never a pre-existing failure).
 *   3. For each mutation operator, inject exactly ONE defect into a clone of the
 *      bundle, producing a MUTANT.
 *   4. Run ALL gates against the mutant.
 *   5. Kill criterion: a mutant is KILLED if >=1 blocking gate goes RED.
 *      A mutant that leaves every gate GREEN is a SURVIVING MUTANT — a proven
 *      blind spot, reported as a finding.
 *
 * Faithfulness: a mutant models a state a real buggy generator could actually
 * produce. A dropped trait is removed from the adapter's `code` AND its ledger
 * entry flips to `unaccounted` (a real adapter that drops a trait also never
 * called express()). IR-anchored defects (native-expr-leak, unresolved-TBD)
 * mutate the IR. This avoids "false survivors" that only exist because the
 * harness left an artifact inconsistent.
 *
 * Determinism: the corpus is discovered and sorted; every operator selects its
 * sites deterministically; re-runs are identical.
 *
 * Exit code: 0 when the baseline is clean AND every surviving mutant is in the
 * KNOWN_SURVIVORS allowlist (logged findings). Non-zero on a dirty baseline, on
 * a NEW survivor class (a fresh blind spot), or on an operator whose known-
 * defect mutants stopped being killed (a gate regression). Survivors that are
 * already-logged findings do NOT fail the run — they are triage data, per the
 * Layer-3 brief.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { specToIrFromFile } from './spec-to-ir.mjs';
import { generateReact } from '../../adapters/react/generate.mjs';
import { generateVue } from '../../adapters/vue/generate.mjs';
import { generateSvelte } from '../../adapters/svelte/generate.mjs';
import { generateReactNative } from '../../adapters/react-native/generate.mjs';
import { generateSwiftUI } from '../../adapters/swiftui/generate.mjs';
import { generateCompose } from '../../adapters/compose/generate.mjs';
import { checkA11y } from '../../.claude/skills/_guards/a11y-guard/scripts/check.mjs';
import { checkTokens } from '../../.claude/skills/_guards/token-guard/scripts/check.mjs';
import { checkPerf } from '../../.claude/skills/_guards/perf-guard/scripts/check.mjs';
import { checkSlop } from '../../.claude/skills/_guards/slop-guard/scripts/check.mjs';
import { checkTbd } from '../../.claude/skills/_meta/critique/scripts/check-tbd.mjs';
import { checkParity } from './e2e-multi.mjs';
import { checkNativeExprLeak, checkDeclaredDropped } from './output-guards.mjs';
import { checkLedger } from './ledger-gate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const REFUSED = new Set(['overlay', 'data-table']);

const GENERATORS = {
  react: generateReact,
  vue: generateVue,
  svelte: generateSvelte,
  'react-native': generateReactNative,
  swiftui: generateSwiftUI,
  compose: generateCompose,
};
const WEB = ['react', 'vue', 'svelte'];
const NATIVE = ['react-native', 'swiftui', 'compose'];

// -------------------------------------------------------------------------
// Corpus discovery (mirrors ci.mjs) + baseline bundle construction.
// -------------------------------------------------------------------------
export function discoverCorpus() {
  const feats = new Map();
  const exDir = resolve(ROOT, '_shared/schemas/examples');
  for (const f of readdirSync(exDir)) {
    if (f.endsWith('.spec.yaml')) feats.set(f.replace('.spec.yaml', ''), resolve(exDir, f));
  }
  const artDir = resolve(ROOT, '.claude/artifacts');
  if (existsSync(artDir)) {
    for (const d of readdirSync(artDir)) {
      const spec = resolve(artDir, d, 'design-spec.yaml');
      if (existsSync(spec)) feats.set(d, spec);
    }
  }
  // Deterministic order; drop refused categories (they never generate).
  return [...feats.entries()]
    .filter(([, spec]) => !REFUSED.has(parse(readFileSync(spec, 'utf8')).category))
    .sort(([a], [b]) => a.localeCompare(b));
}

export function buildBaseline(feature, specPath) {
  const ir = specToIrFromFile(specPath);
  const results = {};
  for (const [adapter, gen] of Object.entries(GENERATORS)) results[adapter] = gen(specPath, feature);
  const ledger = Object.values(results).flatMap((r) => r.ledger ?? []);
  return { feature, ir, results, ledger };
}

// -------------------------------------------------------------------------
// The gate battery — identical wiring to e2e-multi.mjs. Returns which gates
// are RED (blocking). perf is advisory (never blocks) and is excluded from the
// kill set, exactly as e2e-multi's gatesPass excludes nothing but perf is ok:true.
// -------------------------------------------------------------------------
export function runGates(bundle) {
  const { ir, results, ledger } = bundle;
  const gates = {
    readiness: checkTbd(ir),
    a11y: checkA11y(ir, results),
    token: checkTokens(ir, results),
    slop: checkSlop(ir, results),
    parity: checkParity(results, ir),
    'native-code': checkNativeExprLeak(ir, results),
    'declared-io': checkDeclaredDropped(ir, results),
    ledger: checkLedger(ledger),
  };
  // perf-guard runs but is advisory-only (returns ok:true); kept for parity of
  // execution, never counted as a killer.
  checkPerf(ir, results);
  const red = Object.entries(gates).filter(([, g]) => !g.ok).map(([name]) => name);
  const messages = {};
  for (const [name, g] of Object.entries(gates)) {
    if (g.ok) continue;
    // parity returns raw strings; the other gates return { severity, msg } objects.
    messages[name] = g.issues
      .filter((i) => typeof i === 'string' || i.severity === 'serious' || i.severity === 'critical')
      .map((i) => (typeof i === 'string' ? i : i.msg));
  }
  return { red, messages };
}

const clone = (b) => structuredClone(b);

// -------------------------------------------------------------------------
// Mutation operators. Each `sites(bundle)` returns a deterministic list of
// { key, apply(clone) } — `apply` injects exactly ONE defect. `klass` is the
// defect class; `expect` documents which gate SHOULD kill it.
// -------------------------------------------------------------------------

/** Walk IR nodes depth-first (deterministic order). */
function irNodes(ir) {
  const out = [];
  const walk = (n) => { out.push(n); (n.children ?? []).forEach(walk); };
  walk(ir.root);
  return out;
}

const OPERATORS = [
  // O1 — drop a declared trait that is NOT in a11y-guard's enforced whitelist
  // (role=group/list/switch/…, a11y.label/live/invalid/describedBy). This is the
  // class that used to slip through every per-class gate; the ledger must catch it.
  {
    id: 'drop-trait',
    klass: 'ledger / declared-io',
    expect: 'ledger (unaccounted); declared-io for a dropped native label',
    sites(bundle) {
      const enforced = new Set(['status', 'alert', 'img', 'separator']);
      const out = [];
      for (const e of bundle.ledger) {
        if (e.status !== 'expressed') continue;
        // Skip enforced roles — those are O5's job (they also trip a11y-output).
        if (e.traitId.startsWith('role=') && enforced.has(e.traitId.slice(5))) continue;
        out.push({
          key: `${bundle.feature}:${e.adapter}:${e.traitId}`,
          apply(c) {
            // Faithful: the adapter neither expressed nor diverged the trait.
            for (const le of c.ledger) {
              if (le.adapter === e.adapter && le.component === e.component && le.traitId === e.traitId && le.status === 'expressed') {
                le.status = 'unaccounted'; delete le.mechanism; break;
              }
            }
            // Best-effort strip of the emitted marker from that adapter's output.
            stripTrait(c.results[e.adapter], e.traitId);
          },
        });
      }
      return out;
    },
  },

  // O5 — remove a REQUIRED a11y role/label that a11y-guard's output tier enforces
  // (status/alert/img/separator, or a live region). a11y-guard must go RED.
  {
    id: 'remove-a11y',
    klass: 'a11y',
    expect: 'a11y (output tier: role/live trait missing); ledger backs it up',
    sites(bundle) {
      const enforced = new Set(['status', 'alert', 'img', 'separator']);
      const out = [];
      for (const e of bundle.ledger) {
        const isRole = e.traitId.startsWith('role=') && enforced.has(e.traitId.slice(5));
        const isLive = e.traitId.startsWith('a11y.live');
        if (e.status !== 'expressed' || !(isRole || isLive)) continue;
        if (!WEB.includes(e.adapter)) continue; // web has the strongest ROLE_TRAIT contract
        out.push({
          key: `${bundle.feature}:${e.adapter}:${e.traitId}`,
          apply(c) {
            stripTrait(c.results[e.adapter], e.traitId);
            for (const le of c.ledger) {
              if (le.adapter === e.adapter && le.component === e.component && le.traitId === e.traitId && le.status === 'expressed') {
                le.status = 'unaccounted'; delete le.mechanism; break;
              }
            }
          },
        });
      }
      return out;
    },
  },

  // O2 — a native adapter emits an un-evaluatable JS expression verbatim. Models
  // a bypassed F-9 refusal reaching a native adapter. native-code must go RED.
  {
    id: 'native-expr-leak',
    klass: 'native-code',
    expect: 'native-code (un-evaluatable variant discriminant in native output)',
    sites(bundle) {
      return NATIVE.filter((a) => a === 'swiftui' || a === 'compose').map((adapter) => ({
        key: `${bundle.feature}:${adapter}`,
        apply(c) {
          const EXPR = "deltaValue >= 0 ? 'positive' : 'negative'";
          // Inject the expression discriminant into the IR (post-refusal state)…
          c.ir.root.variant = { prop: EXPR, cases: { positive: { background: 'color.info.bg' }, negative: { background: 'color.danger.bg' } } };
          // …and leak it verbatim into the native output.
          c.results[adapter].code += `\n// ${EXPR}\n`;
        },
      }));
    },
  },

  // O3 — render a `ref` prop as a string literal of its own name (the F-1
  // signature). parity must go RED.
  {
    id: 'ref-as-literal',
    klass: 'parity',
    expect: 'parity (ref prop emitted as the string literal of its own name)',
    sites(bundle) {
      const refProps = refUsedProps(bundle.ir);
      const out = [];
      for (const name of refProps) {
        // Choose an adapter whose output currently binds the ref as `{name}`.
        const adapter = ['react', 'svelte', 'react-native'].find((a) => bundle.results[a]?.code.includes(`{${name}}`));
        if (!adapter) continue;
        out.push({
          key: `${bundle.feature}:${adapter}:${name}`,
          apply(c) { c.results[adapter].code = c.results[adapter].code.replace(`{${name}}`, `"${name}"`); },
        });
        break; // one representative ref-literal mutant per feature
      }
      return out;
    },
  },

  // O4a — hardcode a raw hex color in a WEB adapter (should be a token).
  // token-guard must go RED.
  {
    id: 'hardcode-token-web',
    klass: 'token-guard',
    expect: 'token-guard (raw hex color in web output)',
    sites(bundle) {
      return [{
        key: `${bundle.feature}:react`,
        apply(c) { c.results.react.code += `\n/* injected */ const _c = '#ef4444';\n`; },
      }];
    },
  },

  // O4b — the SAME hardcode, but in a NATIVE adapter. token-guard only inspects
  // web output, so nothing catches it. Included to probe the blind spot.
  {
    id: 'hardcode-token-native',
    klass: 'token-guard (native)',
    expect: 'EXPECTED SURVIVOR — token-guard inspects web adapters only',
    sites(bundle) {
      return [{
        key: `${bundle.feature}:swiftui`,
        apply(c) { c.results.swiftui.code += `\n// injected\nlet _c = Color(hex: "#ef4444")\n`; },
      }];
    },
  },

  // O6 — leave a TBD/placeholder unresolved in the IR. readiness must go RED.
  {
    id: 'unresolved-tbd',
    klass: 'readiness',
    expect: 'readiness (unresolved TBD sentinel)',
    sites(bundle) {
      return [{
        key: `${bundle.feature}`,
        apply(c) {
          // Inject the sentinel into the first literal string field found, else
          // onto the root's a11y.label (checkTbd scans both).
          for (const n of irNodes(c.ir)) {
            for (const f of ['text', 'label', 'alt', 'href']) {
              if (n[f] && n[f].kind === 'literal') { n[f].value = 'TBD — unknown copy'; return; }
            }
          }
          c.ir.root.a11y = { ...(c.ir.root.a11y ?? {}), label: { kind: 'literal', value: 'TBD — unknown label' } };
        },
      }];
    },
  },

  // O7 — turn a good icon+color status variant into a color-ONLY one (state by
  // color alone). slop flags it, but only at `minor` severity.
  {
    id: 'state-by-color-only',
    klass: 'slop',
    expect: 'slop (status-color-only) — but advisory `minor`, so it does NOT block',
    sites(bundle) {
      const out = [];
      for (const n of irNodes(bundle.ir)) {
        const cases = Object.values(n.variant?.cases ?? {});
        const hasIconCase = cases.some((s) => 'icon' in s);
        if (n.variant && hasIconCase) {
          out.push({
            key: `${bundle.feature}:${n.variant.prop}`,
            apply(c) {
              for (const m of irNodes(c.ir)) {
                if (m.variant?.prop === n.variant.prop) {
                  for (const s of Object.values(m.variant.cases)) delete s.icon;
                  delete m.icon;
                  break;
                }
              }
            },
          });
          break; // one per feature
        }
      }
      return out;
    },
  },
];

/** Prop names consumed as a {kind:'ref'} value somewhere in the IR (mirrors e2e-multi). */
function refUsedProps(ir) {
  const propNames = new Set(ir.props.map((p) => p.name));
  const used = new Set();
  const consider = (vr) => { if (vr && vr.kind === 'ref' && propNames.has(vr.value)) used.add(vr.value); };
  const walk = (n) => {
    for (const k of ['text', 'label', 'src', 'alt', 'href']) consider(n[k]);
    consider(n.a11y?.label);
    (n.children ?? []).forEach(walk);
  };
  walk(ir.root);
  return [...used].sort();
}

/** Best-effort removal of an emitted trait marker from one adapter's output. */
function stripTrait(res, traitId) {
  if (!res?.code) return;
  let code = res.code;
  if (traitId.startsWith('role=')) {
    const role = traitId.slice(5);
    code = code
      .replace(new RegExp(`\\s+role="${role}"`, 'g'), '')
      .replace(new RegExp(`\\s+accessibilityRole="[^"]*"`, 'g'), '')
      .replace(/\s+\.accessibilityAddTraits\([^)]*\)/g, '')
      .replace(/;?\s*role = Role\.[A-Za-z]+/g, '');
  } else if (traitId === 'a11y.label') {
    code = code
      .replace(/\s+aria-label=(\{[^}]*\}|"[^"]*")/g, '')
      .replace(/\s+accessibilityLabel=\{[^}]*\}/g, '')
      .replace(/;?\s*contentDescription = [^;}]+/g, '');
  } else if (traitId.startsWith('a11y.live')) {
    code = code
      .replace(/\s+aria-live="[^"]*"/g, '')
      .replace(/\s+accessibilityLiveRegion="[^"]*"/g, '')
      .replace(/\s+\.accessibilityAddTraits\(\.updatesFrequently\)/g, '')
      .replace(/;?\s*liveRegion = LiveRegionMode\.[A-Za-z]+/g, '');
  }
  res.code = code;
}

// Known, already-logged survivors (blind spots). A survivor here is triage data,
// not a run failure. A survivor OUTSIDE this set is a fresh blind spot and fails
// the run so it cannot ship unnoticed.
const KNOWN_SURVIVORS = new Set(['hardcode-token-native', 'state-by-color-only']);

export function runMutationTesting() {
  const corpus = discoverCorpus();
  const baselineFailures = [];
  const bundles = [];
  for (const [feature, specPath] of corpus) {
    const b = buildBaseline(feature, specPath);
    const { red } = runGates(b);
    if (red.length) baselineFailures.push({ feature, red });
    bundles.push(b);
  }

  const mutants = [];
  for (const op of OPERATORS) {
    for (const b of bundles) {
      for (const site of op.sites(b)) {
        const c = clone(b);
        site.apply(c);
        const { red, messages } = runGates(c);
        mutants.push({ operator: op.id, klass: op.klass, expect: op.expect, key: site.key, red, messages, killed: red.length > 0 });
      }
    }
  }

  const killed = mutants.filter((m) => m.killed);
  const survived = mutants.filter((m) => !m.killed);
  return { corpus: corpus.map(([f]) => f), baselineFailures, mutants, killed, survived };
}

// -------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------
function main() {
  const { corpus, baselineFailures, mutants, killed, survived } = runMutationTesting();

  console.log('=== gate mutation testing (Layer 3) ===');
  console.log(`corpus (${corpus.length}): ${corpus.join(', ')}`);

  console.log('\n## baseline');
  if (baselineFailures.length) {
    console.log('FAIL — un-mutated baseline is not all-green:');
    for (const f of baselineFailures) console.log(`  ${f.feature}: RED [${f.red.join(', ')}]`);
  } else {
    console.log(`clean — all ${corpus.length} features GREEN on every gate (a RED below is caused by the mutation).`);
  }

  console.log(`\n## summary`);
  console.log(`  total mutants: ${mutants.length}`);
  console.log(`  killed (>=1 gate RED): ${killed.length}`);
  console.log(`  survived (all GREEN):  ${survived.length}`);

  // Per-operator rollup + one killed sample each.
  console.log('\n## per operator');
  const byOp = new Map();
  for (const m of mutants) {
    if (!byOp.has(m.operator)) byOp.set(m.operator, []);
    byOp.get(m.operator).push(m);
  }
  for (const op of OPERATORS) {
    const ms = byOp.get(op.id) ?? [];
    const k = ms.filter((m) => m.killed).length;
    console.log(`\n  [${op.id}] class=${op.klass}  mutants=${ms.length} killed=${k} survived=${ms.length - k}`);
    console.log(`     expect: ${op.expect}`);
    const sample = ms.find((m) => m.killed);
    if (sample) {
      const gate = sample.red[0];
      console.log(`     sample KILLED: ${sample.key}`);
      console.log(`        RED gates: [${sample.red.join(', ')}]`);
      console.log(`        ${gate}: ${(sample.messages[gate] ?? [])[0] ?? ''}`);
    }
    const surv = ms.find((m) => !m.killed);
    if (surv) console.log(`     sample SURVIVED: ${surv.key}  (all gates GREEN)`);
  }

  // Survivors — the deliverable of this phase.
  console.log('\n## surviving mutants (blind spots)');
  if (!survived.length) {
    console.log('  none — every mutant was killed by at least one gate.');
  } else {
    const bySurvOp = new Map();
    for (const m of survived) {
      if (!bySurvOp.has(m.operator)) bySurvOp.set(m.operator, []);
      bySurvOp.get(m.operator).push(m);
    }
    for (const [op, ms] of bySurvOp) {
      const known = KNOWN_SURVIVORS.has(op) ? 'KNOWN (logged finding)' : 'NEW BLIND SPOT';
      console.log(`  [${op}] ${ms.length} survivor(s) — ${known}`);
      console.log(`     e.g. ${ms[0].key} — all gates GREEN`);
    }
  }

  // Exit policy: green while blind spots are known/logged; red on a surprise.
  const unexpectedSurvivors = survived.filter((m) => !KNOWN_SURVIVORS.has(m.operator));
  const ok = baselineFailures.length === 0 && unexpectedSurvivors.length === 0;
  console.log(`\n${ok ? 'MUTATION-TESTING PASS' : 'MUTATION-TESTING FAIL'}` +
    (unexpectedSurvivors.length ? ` (${unexpectedSurvivors.length} unexpected survivor(s) — new blind spot)` : '') +
    (baselineFailures.length ? ` (baseline not clean)` : ''));
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
