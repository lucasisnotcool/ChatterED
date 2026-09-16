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
   * Measured on the CLI against `room_6a9609d5c6fb` (`app/docs/STATUS.md`): ingest 37.0 s for
   * 4,053 output tokens, ledger 17.2 s for 1,523 and 9.8 s for 858. Both are dominated by
   * reasoning tokens, not by the prompt — `whole-file-context.md` §2: *latency scales with
   * output, not input*. Neither call produces a word the learner reads: ingest fills a rail
   * that is empty for the first few seconds either way, and the ledger moves a glyph. Spending
   * the room's best model on them buys nothing and costs the learner the wait.
   *
   * The learner's two dropdowns still govern everything they actually hear — the agents' voice
   * and the turn-taking decision. This is the third role they were never offered, because
   * "which model writes the JSON nobody reads" is not a choice worth a row in Settings.
   */
  fast: string;
}

export const API_PLAN: ModelPlan = { agent: HAIKU_API, orchestrator: SONNET_API, fast: HAIKU_API };

/** The CLI's alias for the fast lane. Fixed, for the reason `ModelPlan.fast` gives. */
export const CLI_FAST_MODEL = 'haiku';

export function cliPlan(agent: string, orchestrator: string): ModelPlan {
  return {
    agent: normaliseModelId(agent) ?? DEFAULT_CLI_AGENT_MODEL,
    orchestrator: normaliseModelId(orchestrator) ?? DEFAULT_CLI_ORCHESTRATOR_MODEL,
    fast: CLI_FAST_MODEL,
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
