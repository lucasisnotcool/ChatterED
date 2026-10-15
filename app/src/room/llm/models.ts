/**
 * Which model answers which call.
 *
 * Two roles, not three: **agent turns** (Ellie, Max, Theo) and **orchestrator + ledger**
 * (the structured-output calls, plus concept ingestion). The split is the one the learner is
 * offered in Settings, because it is the only one that changes what they experience — a
 * cheaper agent model changes the room's voice, a cheaper orchestrator changes whether the
 * ledger and the turn-taking hold together (issue #19).
 *
 * The two backends want different spellings of the same thing. The API path needs exact,
 * dated-suffix-free ids (`claude-haiku-4-5`); the local CLI takes an alias (`sonnet`) and
 * resolves it itself, which is what makes "whatever I am subscribed to" the right default
 * there. So a plan is a pair of already-resolved strings and the resolver is per backend.
 *
 * Portable: this module is imported by `src/room` and by `src/main`, and imports nothing.
 */

/** The exact ids the API path uses (CLAUDE.md policy: Haiku 4.5 agents, Sonnet 5 orchestrator). */
export const HAIKU_API = 'claude-haiku-4-5';
export const SONNET_API = 'claude-sonnet-5';

/** The three aliases offered in the Settings dropdowns, in order. Fable is deliberately absent. */
export const CLI_MODEL_CHOICES = ['haiku', 'sonnet', 'opus'] as const;
export type CliModelChoice = (typeof CLI_MODEL_CHOICES)[number];

/**
 * Default on the CLI path: **sonnet for both** (issue #19). Not Haiku for agent turns as on
 * the API path — a local CLI turn costs the learner nothing per token, so the reason to drop
 * to Haiku (many cheap turns) does not apply, and the room reads better on Sonnet.
 */
export const DEFAULT_CLI_AGENT_MODEL: CliModelChoice = 'sonnet';
export const DEFAULT_CLI_ORCHESTRATOR_MODEL: CliModelChoice = 'sonnet';

export interface ModelPlan {
  /** Ellie, Max and Theo's group turns and whisper replies. */
  agent: string;
  /** The orchestrator decision. */
  orchestrator: string;
  /**
   * **The two calls nobody is waiting to read**: the concept ingest and the ledger update
   * (issue #35 item 5). Always Haiku, and deliberately **not** a Settings choice.
   *
   * **It is the orchestrator model, and that is a measurement, not an oversight.**
   *
   * This field was added to put both calls on Haiku, on the reasoning that neither produces a
   * word the learner reads. Measured on the CLI, on the real CS4246 deck, it made them *worse*:
   *
   * | call   | model  | output tokens | wall |
   * |--------|--------|---------------|------|
   * | ingest | sonnet | 4,053         | 37.0 s |
   * | ingest | haiku  | 7,399 / 6,412 | 70.6 s / 64.4 s |
   * | ledger | sonnet | 1,523 / 858   | 17.2 s / 9.8 s |
   * | ledger | haiku  | 2,839–6,886   | 27–65 s of generation |
   *
   * Latency here is output tokens (`whole-file-context.md` §2), and Haiku 4.5 on the CLI emits
   * two to four times as many of them on a schema-bound call — it reasons its way to the object
   * where Sonnet writes it. So the fast lane resolves to the orchestrator model on both paths.
   *
   * The seam stays, because it is the right seam: these two calls are not turns, they are not
   * the agents' voice, and the day a model is actually faster at strict JSON this is the one
   * line that changes. The learner's two dropdowns still govern everything they hear.
   */
  fast: string;
}

export const API_PLAN: ModelPlan = { agent: HAIKU_API, orchestrator: SONNET_API, fast: SONNET_API };

// ── BYOK providers (2026-09-25) ─────────────────────────────────────────────
//
// Every id below was checked against the provider's own model and pricing pages on 2026-09-25:
//   OpenAI — developers.openai.com/api/docs/pricing and /guides/latest-model (GPT-6 is the
//            current flagship family; gpt-6-sol and gpt-6-luna accept Chat Completions).
//   Gemini — ai.google.dev/gemini-api/docs/models (gemini-3.8-flash is the current stable
//            Flash; 3.1 Pro is still `-preview`, so it is offered, never defaulted).
// The Anthropic list is the `claude-api` skill's model table (cached 2026-06-24).
//
// **Defaults follow the Claude CLI's reasoning, not the API plan's.** The API plan puts agent
// turns on Haiku to keep many small turns cheap; for OpenAI and Gemini the mid-tier model is
// already priced at or below Sonnet 5, and the cheapest tier is built for "focused, high-volume
// tasks", not for explaining a slide. So both roles default to the mid tier, and the learner
// can drop the agent role to the cheap tier in Settings. `fast` follows the orchestrator on
// every provider, for the reason `ModelPlan.fast` records.

/** The API providers a learner can bring a key for. Mirrors `ApiProvider` in `src/shared/types.ts`. */
export type ApiProviderId = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

export const OPENAI_DEFAULT_MODEL = 'gpt-6-sol';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

/**
 * The default plan per provider. `openai_compatible` has none — the endpoint could be anything
 * from a laptop's Ollama to a router with four hundred models, so the learner names the model and
 * an empty id means "not configured yet", never a guess.
 */
export const PROVIDER_PLANS: Record<ApiProviderId, ModelPlan | null> = {
  anthropic: API_PLAN,
  openai: { agent: OPENAI_DEFAULT_MODEL, orchestrator: OPENAI_DEFAULT_MODEL, fast: OPENAI_DEFAULT_MODEL },
  gemini: { agent: GEMINI_DEFAULT_MODEL, orchestrator: GEMINI_DEFAULT_MODEL, fast: GEMINI_DEFAULT_MODEL },
  openai_compatible: null,
};

/** The dropdown suggestions per provider, cheapest-to-strongest. Free text is always allowed too. */
export const PROVIDER_MODEL_SUGGESTIONS: Record<ApiProviderId, readonly string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
  openai: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.4-mini', 'gpt-5.4'],
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.1-pro-preview'],
  openai_compatible: [],
};

/**
 * A provider's plan from the learner's two stored choices, falling back per role to the
 * provider default. Returns null for a compatible endpoint with no model named.
 */
export function providerPlan(
  provider: ApiProviderId,
  agent: string | null | undefined,
  orchestrator: string | null | undefined,
): ModelPlan | null {
  const base = PROVIDER_PLANS[provider];
  const a = normaliseApiModelId(agent) ?? base?.agent ?? null;
  const o = normaliseApiModelId(orchestrator) ?? base?.orchestrator ?? a;
  if (!a || !o) return null;
  return { agent: a, orchestrator: o, fast: o };
}

/**
 * The API-path counterpart of `normaliseModelId`: trims, rejects Fable and junk, and **keeps
 * case and `/` and `:`** — an OpenRouter id is `anthropic/claude-sonnet-5`, an Ollama tag is
 * `llama3.3:70b`, and neither is an alias to lower-case.
 */
export function normaliseApiModelId(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return null;
  if (isBlockedModelId(trimmed)) return null;
  if (!/^[A-Za-z0-9._:/@+-]+$/.test(trimmed) || trimmed.length > 200) return null;
  return trimmed;
}

export function cliPlan(agent: string, orchestrator: string): ModelPlan {
  const resolved = normaliseModelId(orchestrator) ?? DEFAULT_CLI_ORCHESTRATOR_MODEL;
  return {
    agent: normaliseModelId(agent) ?? DEFAULT_CLI_AGENT_MODEL,
    orchestrator: resolved,
    // See `ModelPlan.fast`: measured, Haiku is slower here, not faster.
    fast: resolved,
  };
}

/**
 * Fable is never a model this app may run on, at any depth (CLAUDE.md hard invariant). It is
 * not in the dropdown, and the free-text field rejects it rather than silently substituting —
 * a silent substitution is exactly the kind of drift the invariant exists to prevent.
 */
export function isBlockedModelId(id: string): boolean {
  return /fable/i.test(id.trim());
}

/** Trims and lower-cases an alias; leaves a full model id alone. Returns null for junk. */
export function normaliseModelId(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return null;
  if (isBlockedModelId(trimmed)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  return (CLI_MODEL_CHOICES as readonly string[]).includes(lower) ? lower : trimmed;
}
