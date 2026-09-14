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
  /** The orchestrator decision, the ledger update and concept ingestion. */
  orchestrator: string;
}

export const API_PLAN: ModelPlan = { agent: HAIKU_API, orchestrator: SONNET_API };

export function cliPlan(agent: string, orchestrator: string): ModelPlan {
  return {
    agent: normaliseModelId(agent) ?? DEFAULT_CLI_AGENT_MODEL,
    orchestrator: normaliseModelId(orchestrator) ?? DEFAULT_CLI_ORCHESTRATOR_MODEL,
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
