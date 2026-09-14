#!/usr/bin/env node
/**
 * AI Router — selects a provider + runtime + model for a capability request.
 *
 * Design rules (all enforced here):
 *  - Provider-agnostic: no vendor name is hard-coded in the selection logic;
 *    ordering comes only from the policy's `provider_preference`, then registry
 *    order. There is no baked-in universal priority.
 *  - Honest availability: a provider whose status is not `available`/`configured`
 *    is never presented as a working selection. Such matches surface as
 *    `needs_configuration`, never a fabricated route.
 *  - Never fake capabilities: a model whose required capability is `unsupported`
 *    is excluded; `unknown` is allowed only if the policy permits, and is flagged.
 *  - No ToS bypass: the router only PLANS a route. It never authenticates, calls,
 *    or executes anything, so it cannot bypass auth, quotas, or subscription
 *    limits. The policy's `never` list is echoed into every plan as a guardrail.
 *
 * Pure `route(request, ctx)` is the unit-testable core; `loadContext()` reads the
 * `.ai/*.yaml` data; the CLI prints a plan.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AI = resolve(__dirname, '..');

export function loadContext() {
  const y = (p) => parse(readFileSync(resolve(AI, p), 'utf8'));
  const reg = y('registry/models.yaml');
  return {
    providers: y('providers/providers.yaml').providers,
    runtimes: y('runtimes/runtimes.yaml').runtimes,
    models: reg.models,
    vocabulary: reg.capabilities_vocabulary ?? [],
    policy: y('policies/default.policy.yaml').policy,
  };
}

const AVAILABLE = new Set(['available', 'configured']);

/**
 * @param {{ capabilities?: string[], accessModes?: string[], privacy?: string }} request
 * @param {{ providers, runtimes, models, policy }} ctx
 */
export function route(request, ctx) {
  const { providers, runtimes, models, policy, vocabulary = [] } = ctx;
  const reqCaps = request.capabilities ?? [];
  const flags = [];
  const reasons = [];

  // A capability the registry does not even model cannot be routed honestly.
  const unknownCaps = reqCaps.filter((c) => vocabulary.length && !vocabulary.includes(c));
  if (unknownCaps.length) {
    return {
      status: 'unavailable',
      selection: null,
      reasons: [`capability not in registry vocabulary: ${unknownCaps.join(', ')}`],
      request: { capabilities: reqCaps },
      guardrails: policy.never ?? [],
      flags: [],
      eligible: [],
    };
  }

  const providerStatus = Object.fromEntries(providers.map((p) => [p.id, p.status]));
  const runtimeKind = Object.fromEntries(runtimes.map((r) => [r.id, r.kind]));
  const allowedModes = new Set(
    (policy.allowed_access_modes ?? []).filter((m) => !request.accessModes || request.accessModes.includes(m)),
  );
  const sensitive = (request.privacy ?? policy.privacy) === 'sensitive';

  // 1. Capability + access-mode eligibility (availability handled separately).
  const eligible = [];
  for (const m of models) {
    const caps = m.capabilities ?? {};
    let capOk = true;
    for (const c of reqCaps) {
      const v = caps[c] ?? 'unknown';
      if (v === 'unsupported') { capOk = false; break; }
      if (v === 'unknown') {
        if (!policy.allow_unknown_capabilities) { capOk = false; break; }
        flags.push(`${m.provider}/${m.model}: capability "${c}" is unknown (policy allows, flagged)`);
      }
    }
    if (!capOk) continue;

    // Pick a runtime whose access mode is allowed; prefer local when sensitive.
    const modeOf = (rt) => (runtimeKind[rt] === 'local' ? 'local' : runtimeKind[rt] === 'subscription' ? 'subscription' : 'api');
    let rts = (m.runtimes ?? []).filter((rt) => allowedModes.has(modeOf(rt)));
    if (sensitive) rts = [...rts].sort((a, b) => (runtimeKind[a] === 'local' ? -1 : 1) - (runtimeKind[b] === 'local' ? -1 : 1));
    if (!rts.length) continue;

    eligible.push({ provider: m.provider, model: m.model, runtime: rts[0], available: AVAILABLE.has(providerStatus[m.provider]) });
  }

  // 2. Order by policy preference, then registry order (never by a vendor default).
  const pref = policy.provider_preference ?? [];
  const rank = (p) => { const i = pref.indexOf(p); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  eligible.sort((a, b) => rank(a.provider) - rank(b.provider));
  if (!pref.length && (policy.cost_preference !== 'balanced' || policy.latency_preference !== 'balanced')) {
    flags.push('cost/latency ordering requested but registry has no cost/latency data (unknown) — using registry order');
  }

  const guardrails = policy.never ?? [];
  const base = { request: { capabilities: reqCaps }, guardrails, flags, eligible };

  const confirmed = eligible.filter((e) => e.available);
  if (confirmed.length) {
    reasons.push(`selected ${confirmed[0].provider}/${confirmed[0].model} via ${confirmed[0].runtime}`);
    return { status: 'selected', selection: confirmed[0], fallbacks: confirmed.slice(1), reasons, ...base };
  }
  if (eligible.length) {
    reasons.push('models match the request but no provider is configured/available yet');
    return {
      status: 'needs_configuration',
      selection: null,
      needs: [...new Set(eligible.map((e) => e.provider))],
      reasons,
      ...base,
    };
  }
  reasons.push(reqCaps.length ? `no registered model declares support for: ${reqCaps.join(', ')}` : 'no eligible model under current access-mode policy');
  return { status: 'unavailable', selection: null, reasons, ...base };
}

function main() {
  const args = process.argv.slice(2);
  const capsArg = args[args.indexOf('--caps') + 1];
  const request = {
    capabilities: capsArg && !capsArg.startsWith('--') ? capsArg.split(',') : [],
    privacy: args.includes('--sensitive') ? 'sensitive' : undefined,
  };
  const plan = route(request, loadContext());
  console.log(JSON.stringify(plan, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
