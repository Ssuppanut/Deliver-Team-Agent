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
 * Exit code: 0 when the baseline is clean AND checkSurvivors() passes: every surviving
 * mutant is matched by a scoped, approved, unexpired entry of
 * _shared/policy/mutation-known-survivors.yaml (rules M0 to M4, see
 * mutation-known-survivors.mjs), and no entry is stale. Non-zero on a dirty baseline,
 * on a NEW survivor (M1), or on a stale / over-broad / malformed entry. Survivors that
 * are already-logged findings do NOT fail the run: they are triage data. An entry is removed only when a gate
 * checks the emitted value for that construct and kills the mutant; the cluster field is context, and fixing the
 * defect alone does not kill a mutant (planned: a value-lowering gate).
 *
 * Scope note (D4b): the harness mutates generated OUTPUT text, ledger and IR clones. It
 * never edits adapter source, so an adapter regression is only seen by gates that run
 * on their own (for example check-live-lowering), not by a mutant.
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
import { checkA11y, STATUS_VOCAB } from '../../.claude/skills/_guards/a11y-guard/scripts/check.mjs';
import { checkTokens } from '../../.claude/skills/_guards/token-guard/scripts/check.mjs';
import { checkPerf } from '../../.claude/skills/_guards/perf-guard/scripts/check.mjs';
import { checkSlop } from '../../.claude/skills/_guards/slop-guard/scripts/check.mjs';
import { checkTbd } from '../../.claude/skills/_meta/critique/scripts/check-tbd.mjs';
import { checkParity } from './e2e-multi.mjs';
import { checkNativeExprLeak, checkDeclaredDropped } from './output-guards.mjs';
import { checkLedger } from './ledger-gate.mjs';
import { checkTimeZones } from './validate-schema.mjs';
import { checkLiveLowering, schemaLiveValues } from './check-live-lowering.mjs';
import { checkSurvivors, formatSurvivorReport } from './mutation-known-survivors.mjs';

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
  return { feature, specPath, ir, results, ledger };
}

// The live-lowering gate needs the live enum values; deriving them re-walks the schema (~27 ms), so
// compute them once per process, never per mutant.
let LIVE_VALUES = null;
const liveValues = () => (LIVE_VALUES ??= schemaLiveValues());

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
    // F-27 (follow-up): the validate-schema literal-timezone gate, run on the IR
    // so a bad literal timeZone injected into a datetime value is caught here.
    'timezone-schema': (() => { const e = checkTimeZones(ir.root); return { ok: e.length === 0, issues: e.map((x) => ({ severity: 'serious', msg: x.message })) }; })(),
    // D4b: the F-28 live-lowering gate, run on the MUTANT's generated code (its `generate` parameter) and
    // the feature's own spec. The gate is wrapped, not edited: its issues carry no severity, so the wrapper
    // adds one to pass the message filter below (RED already counted on `ok`).
    'live-lowering': (() => {
      const r = checkLiveLowering({ specPaths: [bundle.specPath], values: liveValues(), generate: (a) => results[a].code });
      return { ok: r.ok, issues: r.issues.map((i) => ({ severity: 'serious', msg: i.msg })) };
    })(),
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
const ADAPTER_IDS = Object.keys(GENERATORS);

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

/** True if the IR has a container that declares orientation AND has children
 *  (PR A2: the case that lowers to a real layout axis on every adapter). */
function hasOrientedContainer(ir) {
  return irNodes(ir).some((n) => n.kind === 'container' && n.orientation && (n.children?.length));
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

  // O4b — the SAME hardcode, but in a NATIVE adapter. Since F-21, token-guard's
  // source scan covers the native adapters, so this must now be KILLED. (Before
  // F-21 it was the surviving blind spot.)
  {
    id: 'hardcode-token-native',
    klass: 'token-guard (native)',
    expect: 'token-guard (native color literal) — resolved by F-21 (was the blind spot)',
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

  // O8 — F-27: emit a timezone PROP-REF as the string literal of its own name
  // (the F-1 class, re-entering through the date formatter's timeZone). Since
  // refUsedProps now tracks the timeZone ref, parity's ref-as-literal lint fires.
  {
    id: 'tz-ref-as-literal',
    klass: 'parity',
    expect: 'parity (timezone prop-ref emitted as the string literal of its own name)',
    sites(bundle) {
      let ref = null;
      for (const n of irNodes(bundle.ir)) {
        for (const f of ['text', 'label']) {
          const tz = n[f]?.kind === 'datetime' ? n[f].dateFormat?.timeZone : undefined;
          if (tz && typeof tz === 'object' && tz.kind === 'ref') { ref = tz.value; break; }
        }
        if (ref) break;
      }
      if (!ref) return [];
      // react binds the tz ref as `__dtfTimeZone(<ref>)`; stringify it as its own name.
      if (!bundle.results.react?.code.includes(`__dtfTimeZone(${ref})`)) return [];
      return [{
        key: `${bundle.feature}:react:${ref}`,
        apply(c) { c.results.react.code = c.results.react.code.replace(`__dtfTimeZone(${ref})`, `"${ref}"`); },
      }];
    },
  },

  // O9 — F-27 follow-up: inject a cross-platform-unsafe LITERAL timeZone (a
  // case-variant ICU would normalize but Swift/Java reject) into a datetime value.
  // The validate-schema literal-timezone gate (now in the battery) must kill it;
  // if checkTimeZones were disabled/loosened, this mutant would survive.
  {
    id: 'invalid-literal-timezone',
    klass: 'timezone-schema',
    expect: 'timezone-schema (validate-schema rejects a case-variant / offset / invalid literal timeZone)',
    sites(bundle) {
      for (const n of irNodes(bundle.ir)) {
        for (const f of ['text', 'label']) {
          if (n[f]?.kind === 'datetime') {
            return [{
              key: `${bundle.feature}:${f}`,
              apply(c) {
                for (const m of irNodes(c.ir)) {
                  if (m[f]?.kind === 'datetime') { m[f].dateFormat = { ...(m[f].dateFormat ?? {}), timeZone: 'asia/bangkok' }; return; }
                }
              },
            }];
          }
        }
      }
      return [];
    },
  },

  // O7 — turn a good icon+color status variant into a color-ONLY one (state by
  // color alone). F-22: now a BLOCKING a11y contract (was a slop `minor`
  // advisory). Stripping every per-state icon collapses all states to the empty
  // non-color signature → a11y-guard RED.
  {
    id: 'state-by-color-only',
    klass: 'a11y',
    expect: 'a11y (status-color-only, serious) — all states collapse to color-only, so it BLOCKS',
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

  // O8 (F-22) — strip the per-state icon from all but one case of a status
  // variant with >=3 cases. The >=2 newly-bare cases share the empty non-color
  // signature → indistinguishable without color → a11y-guard RED (pairwise).
  {
    id: 'strip-icon-all-but-one',
    klass: 'a11y',
    expect: 'a11y (status-color-only) — >=2 states share the empty non-color signature',
    sites(bundle) {
      const out = [];
      for (const n of irNodes(bundle.ir)) {
        const v = n.variant;
        if (!v) continue;
        const intent = v.intent ?? 'status';
        const cases = Object.entries(v.cases ?? {});
        const iconKeys = cases.filter(([, s]) => 'icon' in s).map(([k]) => k);
        // >=3 total cases so that keeping ONE icon leaves >=2 bare cases that
        // collide on the empty signature (a 2-case variant would not collide).
        if (intent === 'status' && iconKeys.length >= 1 && cases.length >= 3) {
          const keep = iconKeys[0];
          out.push({
            key: `${bundle.feature}:${v.prop}`,
            apply(c) {
              for (const m of irNodes(c.ir)) {
                if (m.variant?.prop === v.prop) {
                  for (const [k, s] of Object.entries(m.variant.cases)) if (k !== keep) delete s.icon;
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

  // O9 (F-22) — set the SAME icon token on every case of a status variant. All
  // states then share one non-color signature → pairwise collision → a11y RED.
  {
    id: 'same-icon-every-case',
    klass: 'a11y',
    expect: 'a11y (status-color-only) — all states share one icon ⇒ identical non-color signatures',
    sites(bundle) {
      const out = [];
      for (const n of irNodes(bundle.ir)) {
        const v = n.variant;
        if (!v) continue;
        const intent = v.intent ?? 'status';
        if (intent === 'status' && Object.keys(v.cases ?? {}).length >= 2) {
          out.push({
            key: `${bundle.feature}:${v.prop}`,
            apply(c) {
              for (const m of irNodes(c.ir)) {
                if (m.variant?.prop === v.prop) {
                  for (const s of Object.values(m.variant.cases)) s.icon = 'icon.same';
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

  // O11 (PR A) — empty the link navigation body in ONE adapter WITHOUT touching
  // the ledger (the trait stays expressed). This isolates the parity nav-primitive
  // lint: the ledger alone cannot see an inert body (the old Compose `/* open */`
  // stub), so only the parity gate can kill this. One mutant per adapter per link
  // feature.
  {
    id: 'link-empty-body',
    klass: 'parity',
    expect: 'parity (link nav-primitive lint) — an emptied navigation body is ledger-green but parity RED',
    sites(bundle) {
      const hasLink = (() => { let f = false; const w = (n) => { if (n?.kind === 'link') f = true; (n?.children ?? []).forEach(w); }; w(bundle.ir.root); return f; })();
      if (!hasLink) return [];
      const STRIP = {
        react: (s) => s.replace(/href=/g, 'x='),
        vue: (s) => s.replace(/href=/g, 'x='),
        svelte: (s) => s.replace(/href=/g, 'x='),
        'react-native': (s) => s.replace(/Linking\.openURL\(/g, 'noop('),
        swiftui: (s) => s.replace(/Link\(/g, 'Text('),
        compose: (s) => s.replace(/uriHandler\.openUri\(/g, 'run('),
      };
      const out = [];
      for (const adapter of Object.keys(bundle.results)) {
        if (!STRIP[adapter]) continue;
        out.push({
          key: `${bundle.feature}:${adapter}`,
          apply(c) { if (c.results[adapter]?.code) c.results[adapter].code = STRIP[adapter](c.results[adapter].code); },
        });
      }
      return out;
    },
  },

  // O12 (PR A2) — drop the web layout axis (display/flex-direction) per web
  // adapter for an oriented container. The ledger stays green (orientation is
  // still expressed), so only the layout-axis parity lint can kill this.
  {
    id: 'layout-axis-drop-web',
    klass: 'parity',
    expect: 'parity (layout-axis lint) — web output lacks flex-direction for an oriented container',
    sites(bundle) {
      if (!hasOrientedContainer(bundle.ir)) return [];
      const STRIP = {
        react: (s) => s.replace(/flexDirection: '(?:row|column)'/g, "flexN: 'x'"),
        vue: (s) => s.replace(/flex-direction: (?:row|column)/g, 'flexN: x'),
        svelte: (s) => s.replace(/flex-direction: (?:row|column)/g, 'flexN: x'),
      };
      return ['react', 'vue', 'svelte'].map((a) => ({
        key: `${bundle.feature}:${a}`,
        apply(c) { if (c.results[a]?.code) c.results[a].code = STRIP[a](c.results[a].code); },
      }));
    },
  },

  // O13 (PR A2) — flip the layout axis direction per adapter (web + native).
  // The emitted axis no longer matches the spec orientation → layout-axis lint.
  {
    id: 'layout-axis-flip',
    klass: 'parity',
    expect: 'parity (layout-axis lint) — flipped axis no longer matches the spec orientation',
    sites(bundle) {
      if (!hasOrientedContainer(bundle.ir)) return [];
      const FLIP = {
        react: (s) => s.replace(/flexDirection: '(row|column)'/g, (_, d) => `flexDirection: '${d === 'row' ? 'column' : 'row'}'`),
        vue: (s) => s.replace(/flex-direction: (row|column)/g, (_, d) => `flex-direction: ${d === 'row' ? 'column' : 'row'}`),
        svelte: (s) => s.replace(/flex-direction: (row|column)/g, (_, d) => `flex-direction: ${d === 'row' ? 'column' : 'row'}`),
        'react-native': (s) => s.replace(/flexDirection: "(row|column)"/g, (_, d) => `flexDirection: "${d === 'row' ? 'column' : 'row'}"`),
        swiftui: (s) => s.replace(/HStack/g, '\u0001').replace(/VStack/g, 'HStack').replace(/\u0001/g, 'VStack'),
        compose: (s) => s.replace(/\bRow\(/g, '\u0001').replace(/\bColumn\(/g, 'Row(').replace(/\u0001/g, 'Column('),
      };
      return Object.keys(FLIP).map((a) => ({
        key: `${bundle.feature}:${a}`,
        apply(c) { if (c.results[a]?.code) c.results[a].code = FLIP[a](c.results[a].code); },
      }));
    },
  },

  // O10 (F-22) — flip a status variant's `intent` to `emphasis`. Its enum values
  // are status vocabulary, so a11y-guard's emphasis backstop fires → a11y RED.
  // This proves the backstop can't be used to silence a real status variant.
  {
    id: 'flip-intent-to-emphasis',
    klass: 'a11y',
    expect: 'a11y (status-color-only backstop) — emphasis on a status-vocabulary enum is a mislabel',
    sites(bundle) {
      const out = [];
      for (const n of irNodes(bundle.ir)) {
        const v = n.variant;
        if (!v) continue;
        const intent = v.intent ?? 'status';
        const values = Object.keys(v.cases ?? {});
        if (intent === 'status' && values.some((val) => STATUS_VOCAB.has(val.toLowerCase()))) {
          out.push({
            key: `${bundle.feature}:${v.prop}`,
            apply(c) {
              for (const m of irNodes(c.ir)) {
                if (m.variant?.prop === v.prop) { m.variant.intent = 'emphasis'; break; }
              }
            },
          });
          break; // one per feature
        }
      }
      return out;
    },
  },

  // ===== D4b: value-substitution operators ====================================================
  // Output-text edits in the style of link-empty-body / layout-axis-*: the ledger is NOT touched, so
  // only a gate that looks at the emitted VALUE can kill them. Sites are found from the IR (never from
  // the ledger) and a site only exists when the baseline output really contains the text to edit.

  // O14 - an `off` live region is lowered as polite (the F-28 defect). check-live-lowering must kill it.
  {
    id: 'live-off-as-polite',
    klass: 'live-lowering',
    expect: 'live-lowering (L1: an off live region emitted as polite)',
    sites(bundle) {
      if (!irNodes(bundle.ir).some((n) => n.a11y?.live === 'off')) return [];
      return [
        textSite(bundle, 'react-native', 'off', rx('accessibilityLiveRegion="none"', 'accessibilityLiveRegion="polite"')),
        textSite(bundle, 'compose', 'off', rx('Column() {', 'Column(modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {')),
      ].filter(Boolean);
    },
  },

  // O15 - a web live value collapses to polite (assertive -> polite, off -> polite).
  {
    id: 'live-value-collapse',
    klass: 'live-lowering',
    expect: 'live-lowering (L1: a web aria-live value replaced by another valid value)',
    sites(bundle) {
      const values = [...new Set(irNodes(bundle.ir).map((n) => n.a11y?.live).filter((v) => v === 'assertive' || v === 'off'))].sort();
      return values.flatMap((v) => WEB.map((a) => textSite(bundle, a, v, rx(`aria-live="${v}"`, 'aria-live="polite"')))).filter(Boolean);
    },
  },

  // O16 - a NON-enforced role is replaced by another valid role (web group -> list, RN button -> link).
  {
    id: 'role-value-swap',
    klass: 'a11y (role value)',
    expect: 'none today: a11y-guard enforces the output role only for status, alert, img and separator',
    sites(bundle) {
      const nodes = irNodes(bundle.ir);
      const out = [];
      if (nodes.some((n) => n.role === 'group')) for (const a of WEB) out.push(textSite(bundle, a, 'group', rx('role="group"', 'role="list"')));
      if (nodes.some((n) => n.kind === 'action')) out.push(textSite(bundle, 'react-native', 'button', rx('accessibilityRole="button"', 'accessibilityRole="link"')));
      return out.filter(Boolean);
    },
  },

  // O17 - an ENFORCED role (img) is replaced by button on every adapter that emits it. a11y-guard's output
  // tier must kill it (this is the contrast case for role-value-swap).
  {
    id: 'enforced-role-swap',
    klass: 'a11y (role value)',
    expect: 'a11y (output tier: IR declares role="img" but the output has no img trait)',
    sites(bundle) {
      if (!irNodes(bundle.ir).some((n) => n.role === 'img')) return [];
      return [
        ...WEB.map((a) => textSite(bundle, a, 'img', rx('role="img"', 'role="button"'))),
        textSite(bundle, 'react-native', 'img', rx('accessibilityRole="image"', 'accessibilityRole="button"')),
        textSite(bundle, 'swiftui', 'img', rx('.isImage', '.isButton')),
        textSite(bundle, 'compose', 'img', rx('Role.Image', 'Role.Button')),
      ].filter(Boolean);
    },
  },

  // O18 - the heading LEVEL is lost: web <hN> -> <h1>; SwiftUI font of level N -> font of level N-1.
  {
    id: 'heading-level-collapse',
    klass: 'heading (level)',
    expect: 'none today: no gate compares the emitted heading level with the IR level',
    sites(bundle) {
      const levels = [...new Set(irNodes(bundle.ir).filter((n) => n.kind === 'heading' && (n.level ?? 3) >= 2).map((n) => n.level ?? 3))].sort();
      return levels.flatMap((L) => [
        ...WEB.map((a) => textSite(bundle, a, `h${L}`, (c) => {
          const o = c.replace(new RegExp(`<h${L}(?=[\\s>])`), '<h1');
          return o === c ? null : o.replace(`</h${L}>`, '</h1>');
        })),
        textSite(bundle, 'swiftui', `h${L}`, rx(`.font(${SWIFT_HEADING_FONT[L]})`, `.font(${SWIFT_HEADING_FONT[L - 1]})`)),
      ]).filter(Boolean);
    },
  },

  // O19 - heading SEMANTICS are lost: web <hN> -> <div>; React Native drops accessibilityRole="header".
  {
    id: 'heading-semantic-drop',
    klass: 'heading (semantics)',
    expect: 'none today: no gate checks that an IR heading keeps a heading element or role',
    sites(bundle) {
      const levels = [...new Set(irNodes(bundle.ir).filter((n) => n.kind === 'heading').map((n) => n.level ?? 3))].sort();
      if (!levels.length) return [];
      return [
        ...levels.flatMap((L) => WEB.map((a) => textSite(bundle, a, `h${L}`, (c) => {
          const o = c.replace(new RegExp(`<h${L}(?=[\\s>])`), '<div');
          return o === c ? null : o.replace(`</h${L}>`, '</div>');
        }))),
        textSite(bundle, 'react-native', 'header', rx('accessibilityRole="header" ', '')),
      ].filter(Boolean);
    },
  },

  // O20 - the number rounding mode is flipped (floor <-> ceil) on every adapter that emits it.
  {
    id: 'rounding-mode-swap',
    klass: 'number format (rounding)',
    expect: 'none today: the ledger records number-format as expressed whatever the rounding mode',
    sites(bundle) {
      const modes = [...new Set(irNodes(bundle.ir).flatMap((n) => ['text', 'label'].map((f) => n[f]?.kind === 'format' ? n[f].format?.rounding : undefined)).filter((m) => m === 'floor' || m === 'ceil'))].sort();
      return modes.flatMap((m) => {
        const to = m === 'floor' ? 'ceil' : 'floor';
        const JS = (v) => `roundingMode: "${v}"`;
        const SW = (v) => `f.roundingMode = .${v === 'floor' ? 'floor' : 'ceiling'}`;
        const KT = (v) => `RoundingMode.${v === 'floor' ? 'FLOOR' : 'CEILING'}`;
        return [
          ...[...WEB, 'react-native'].map((a) => textSite(bundle, a, m, rx(JS(m), JS(to)))),
          textSite(bundle, 'swiftui', m, rx(SW(m), SW(to))),
          textSite(bundle, 'compose', m, rx(KT(m), KT(to))),
        ];
      }).filter(Boolean);
    },
  },

  // O21 - the date style is changed (short/medium -> long, long -> short).
  {
    id: 'date-style-swap',
    klass: 'date format (style)',
    expect: 'none today: the ledger records date-format as expressed whatever the dateStyle',
    sites(bundle) {
      const styles = [...new Set(irNodes(bundle.ir).flatMap((n) => ['text', 'label'].map((f) => n[f]?.kind === 'datetime' ? n[f].dateFormat?.dateStyle : undefined)).filter((v) => ['short', 'medium', 'long'].includes(v)))].sort();
      return styles.flatMap((v) => {
        const to = v === 'long' ? 'short' : 'long';
        return [
          ...[...WEB, 'react-native'].map((a) => textSite(bundle, a, v, rx(`dateStyle: "${v}"`, `dateStyle: "${to}"`))),
          textSite(bundle, 'swiftui', v, rx(`f.dateStyle = .${v}`, `f.dateStyle = .${to}`)),
          textSite(bundle, 'compose', v, rx(`java.text.DateFormat.${v.toUpperCase()}`, `java.text.DateFormat.${to.toUpperCase()}`)),
        ];
      }).filter(Boolean);
    },
  },

  // O22 - a numeric input loses its numeric type (web type="number" -> "text"; RN drops keyboardType).
  {
    id: 'inputtype-drop',
    klass: 'input (type)',
    expect: 'none today: nothing compares the emitted input type with the IR inputType',
    sites(bundle) {
      if (!irNodes(bundle.ir).some((n) => n.kind === 'input' && n.input?.inputType === 'number')) return [];
      return [
        ...WEB.map((a) => textSite(bundle, a, 'number', rx('type="number"', 'type="text"'))),
        textSite(bundle, 'react-native', 'number', rx('keyboardType="numeric" ', '')),
      ].filter(Boolean);
    },
  },

  // O23 - one emitted STATIC style slot (padding, background, radius) is removed per adapter output.
  {
    id: 'style-slot-drop',
    klass: 'style (static slot)',
    expect: 'none today: style=background/radius are recorded as expressed whatever the output, padding has no trait',
    sites(bundle) {
      const slots = ['padding', 'background', 'radius'].filter((sl) => irNodes(bundle.ir).some((n) => n.style?.[sl]));
      return slots.flatMap((sl) => Object.keys(STYLE_DROP).map((a) => textSite(bundle, a, sl, STYLE_DROP[a][sl]))).filter(Boolean);
    },
  },

  // O24 - an image loses its alternative text (web alt attribute, React Native image accessibilityLabel, Compose AsyncImage contentDescription).
  {
    id: 'alt-drop',
    klass: 'media (alt)',
    expect: 'none today: a11y-guard img-alt checks the IR, not the emitted alt',
    sites(bundle) {
      if (!irNodes(bundle.ir).some((n) => n.kind === 'media' && n.alt)) return [];
      return [
        textSite(bundle, 'react', 'alt', (c) => rmFirst(c, / alt=(\{[^}]*\}|"[^"]*")/)),
        textSite(bundle, 'vue', 'alt', (c) => rmFirst(c, / :?alt=("[^"]*")/)),
        textSite(bundle, 'svelte', 'alt', (c) => rmFirst(c, / alt=(\{[^}]*\}|"[^"]*")/)),
        textSite(bundle, 'react-native', 'alt', (c) => { const o = c.replace(/(<Image\b[^>]*?) accessibilityLabel=(\{[^}]*\}|"[^"]*")/, '$1'); return o === c ? null : o; }),
        // Compose: the AsyncImage contentDescription (taken from the alt text) becomes null.
        textSite(bundle, 'compose', 'alt', (c) => { const o = c.replace(/(AsyncImage\(model = [^,]+, contentDescription = )[^,)]+/, '$1null'); return o === c ? null : o; }),
      ].filter(Boolean);
    },
  },
];

// ---- helpers for the D4b operators ----------------------------------------------------------
const SWIFT_HEADING_FONT = ['', '.largeTitle', '.title', '.title2', '.title3', '.headline', '.subheadline'];
/** A first-occurrence string replacement edit: code -> new code, or null when the text is absent. */
function rx(from, to) { return (code) => (code.includes(from) ? code.replace(from, to) : null); }
function rmFirst(code, re) { const o = code.replace(re, ''); return o === code ? null : o; }
/** One mutant site: `edit` is applied to the CLONE's code. Skipped when the baseline output lacks the target text. */
function textSite(bundle, adapter, detail, edit) {
  const code = bundle.results[adapter]?.code;
  if (!code || edit(code) == null) return null;
  return {
    key: `${bundle.feature}:${adapter}:${detail}`,
    apply(c) { const next = edit(c.results[adapter].code); if (next != null) c.results[adapter].code = next; },
  };
}
/** Removal of ONE emitted static style slot, per adapter (first occurrence in the generated source). */
const STYLE_DROP = {
  react: {
    padding: (c) => rmFirst(c, /padding: '[^']*', |, padding: '[^']*'/),
    background: (c) => rmFirst(c, /backgroundColor: '[^']*', |, backgroundColor: '[^']*'/),
    radius: (c) => rmFirst(c, /borderRadius: '[^']*', |, borderRadius: '[^']*'/),
  },
  vue: {
    padding: (c) => rmFirst(c, /'padding': '[^']*', |, 'padding': '[^']*'|padding: [^;"]*; |; padding: [^;"]*/),
    background: (c) => rmFirst(c, /'background-color': '[^']*', |, 'background-color': '[^']*'|background-color: [^;"]*; |; background-color: [^;"]*/),
    radius: (c) => rmFirst(c, /'border-radius': '[^']*', |, 'border-radius': '[^']*'|border-radius: [^;"]*; |; border-radius: [^;"]*/),
  },
  svelte: {
    padding: (c) => rmFirst(c, /padding: [^;"]*; |; padding: [^;"]*/),
    background: (c) => rmFirst(c, /background-color: [^;"]*; |; background-color: [^;"]*/),
    radius: (c) => rmFirst(c, /border-radius: [^;"]*; |; border-radius: [^;"]*/),
  },
  'react-native': {
    padding: (c) => rmFirst(c, /padding: tokens[^,}]*, |, padding: tokens[^,}]*/),
    background: (c) => rmFirst(c, /backgroundColor: tokens[^,}]*, |, backgroundColor: tokens[^,}]*/),
    radius: (c) => rmFirst(c, /borderRadius: tokens[^,}]*, |, borderRadius: tokens[^,}]*/),
  },
  swiftui: {
    padding: (c) => rmFirst(c, /\n\s*\.padding\([^)]*\)/),
    background: (c) => rmFirst(c, /\n\s*\.background\([^)]*\)/),
    radius: (c) => rmFirst(c, /\n\s*\.cornerRadius\([^)]*\)/),
  },
  compose: {
    padding: (c) => rmFirst(c, /\.padding\([^)]*\)/),
    background: (c) => rmFirst(c, /\.background\([^)]*\)/),
    radius: (c) => rmFirst(c, /\.clip\(RoundedCornerShape\([^)]*\)\)/),
  },
};

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

// Known, already-logged survivors live in _shared/policy/mutation-known-survivors.yaml and are checked by
// checkSurvivors() (rules M0 to M4, mutation-known-survivors.mjs). There is no allowlist in this file.

/**
 * Mutant identity: `<operator>|<feature>|<adapter>|<site>`. The adapter and site are read from the site key,
 * which every operator builds as `<feature>[:<adapter>[:<detail>]]`; `*` stands for "not adapter specific".
 */
export function mutantIdentity(operator, feature, siteKey) {
  const rest = siteKey.startsWith(`${feature}:`) ? siteKey.slice(feature.length + 1) : (siteKey === feature ? '' : siteKey);
  const parts = rest.split(':');
  const adapter = ADAPTER_IDS.includes(parts[0]) ? parts[0] : '*';
  const site = adapter === '*' ? rest : parts.slice(1).join(':');
  return { id: `${operator}|${feature}|${adapter}|${site}`, adapter, site };
}

/** The corpus baseline bundles (generates all 6 adapters per feature; the slow part of a run). */
export function buildBundles() {
  return discoverCorpus().map(([feature, specPath]) => buildBaseline(feature, specPath));
}

/** @param {object[]} [bundles] prebuilt baselines (default: build them); lets a caller run the mutants twice cheaply */
export function runMutationTesting(bundles = buildBundles()) {
  const corpus = bundles.map((b) => [b.feature]);
  const baselineFailures = [];
  for (const b of bundles) {
    const { red } = runGates(b);
    if (red.length) baselineFailures.push({ feature: b.feature, red });
  }

  const mutants = [];
  const seenIds = new Map();
  for (const op of OPERATORS) {
    for (const b of bundles) {
      for (const site of op.sites(b)) {
        const c = clone(b);
        site.apply(c);
        const { red, messages } = runGates(c);
        const base = mutantIdentity(op.id, b.feature, site.key);
        // Two sites with the same key (for example the same ledger trait on two nodes) get a deterministic
        // ordinal: the first keeps the bare id, later ones are suffixed #2, #3, ... in site order.
        const n = (seenIds.get(base.id) ?? 0) + 1;
        seenIds.set(base.id, n);
        const id = n === 1 ? base.id : `${base.id}#${n}`;
        const adapter = base.adapter;
        const siteDetail = n === 1 ? base.site : `${base.site}#${n}`;
        mutants.push({ id, operator: op.id, feature: b.feature, adapter, site: siteDetail, klass: op.klass, expect: op.expect, key: site.key, red, messages, killed: red.length > 0 });
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

  // Survivors: every one must be matched by a scoped, approved entry; every entry must still match one.
  const known = checkSurvivors({ mutants });
  console.log('\n## surviving mutants (blind spots) vs _shared/policy/mutation-known-survivors.yaml');
  if (!survived.length) console.log('  none: every mutant was killed by at least one gate.');
  console.log(formatSurvivorReport(known).split('\n').map((l) => `  ${l}`).join('\n'));

  // Exit policy: green while blind spots are known/logged; red on a surprise or a stale entry.
  const ok = baselineFailures.length === 0 && known.ok;
  console.log(`\n${ok ? 'MUTATION-TESTING PASS' : 'MUTATION-TESTING FAIL'}` +
    (known.ok ? '' : ` (${known.issues.length} known-survivors issue(s))`) +
    (baselineFailures.length ? ` (baseline not clean)` : ''));
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
