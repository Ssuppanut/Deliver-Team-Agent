# .ai — provider-agnostic AI architecture

The system is **not designed around Claude**. A professional role (an *agent*)
declares *AI capability requirements*; the **AI Router** maps those to a
**provider → runtime → model**. Provider and role stay strictly separate — there
is no "Claude Agent" or "ChatGPT Agent".

```
Agent → Skill → required AI capabilities → AI Router → Provider → Runtime → Model
```

## Layout
- `providers/providers.yaml` — ecosystems (Anthropic, OpenAI, Google, xAI, Qwen, local). `status: unknown` until the operator configures official access.
- `runtimes/runtimes.yaml` — how a provider is executed: API, official SDK/CLI, authorized subscription, local, desktop.
- `registry/models.yaml` — provider/model/capabilities/runtimes/access. Capabilities are `supported | unsupported | unknown` — never invented.
- `policies/default.policy.yaml` — routing preferences and the non-negotiable `never` guardrails. No hard-coded universal provider priority.
- `router/route.mjs` — the executable router (`route(request, ctx)`), pure and testable.

## Honesty & safety (enforced)
- No fabricated selection: an unconfigured provider is `needs_configuration`, never a working route.
- No faked capability: an out-of-vocabulary need is `unavailable`.
- **Only official/authorized access.** The router only *plans*; it never
  authenticates or calls anything, so it cannot bypass auth, quotas,
  subscription limits, or Terms of Service. Those are listed in the policy's
  `never` and echoed into every plan.

## Try it
```bash
node .ai/router/route.mjs --caps code,structured-output   # honest plan as JSON
```

## Future
A multi-model **AI Council** (generator → independent critic → second opinion →
synthesis) is a clean extension point on top of this router — intentionally not
built yet.
