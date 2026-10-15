/**
 * **The study build: unlock with a participant code, then spend a fixed API credit.**
 *
 * A study build carries a sealed key bundle (`src/main/study/crypto.ts`). The participant types
 * their code once; it unseals their own Anthropic key, which runs the app until the credit is
 * spent. After that they can carry on with their own provider (Settings ▸ Where the study
 * partners run), or stop. Ordinary builds have no bundle, and none of this shows.
 *
 * **The credit shown is the app's own estimate**: the sum of `llm_usage.estimated_cost_usd` for
 * Anthropic calls since the code was entered. The cap that actually holds is the spend limit on
 * the slot's Anthropic workspace, which nothing on the participant's Mac can change. The estimate
 * stops calls at the budget so the participant meets a clear screen rather than an API error, and
 * a refusal from Anthropic that names the limit is recorded as "used up" too
 * (`main/study/service.ts`).
 *
 * Shared by main, preload and renderer, so it imports nothing.
 */

export const STUDY_IPC = {
  status: 'study:status',
  unlock: 'study:unlock',
  /** main → renderer: the status changed (a call was counted, the credit ran out, a key changed). */
  changed: 'study:changed',
} as const;

/** The settings rows a study install keeps. None of them is a key; the key is the key file. */
export const STUDY_SETTINGS = {
  slot: 'study_slot',
  budgetUsd: 'study_budget_usd',
  unlockedAt: 'study_unlocked_at',
  /** The first 16 hex digits of the key's SHA-256: enough to tell it is still the study key. */
  keyFingerprint: 'study_key_fp',
  /** Set when the study key stopped being the one in use, and why. */
  endedAt: 'study_ended_at',
  endedReason: 'study_ended_reason',
  /** Set when Anthropic refused a call because the workspace's spend limit was reached. */
  serverCappedAt: 'study_server_capped_at',
} as const;

export type StudyEndReason = 'key_replaced' | 'key_removed';

export interface StudyStatus {
  /** This build carries a key bundle. False on every ordinary build. */
  available: boolean;
  /** A code has been entered on this install. */
  unlocked: boolean;
  slot: string | null;
  budgetUsd: number;
  spentUsd: number;
  /** `budgetUsd - spentUsd`, never below zero. */
  remainingUsd: number;
  /** 0…1, the share of the budget spent. */
  fraction: number;
  /** The study key is the Anthropic key in use. */
  active: boolean;
  /** The credit is used up, by the estimate or because Anthropic said so. */
  exhausted: boolean;
  /** Anthropic refused a call over the workspace limit (the authoritative "used up"). */
  serverCapped: boolean;
  /** Why the study key is no longer in use, when it is not. */
  endedReason: StudyEndReason | null;
}

export const NO_STUDY: StudyStatus = {
  available: false,
  unlocked: false,
  slot: null,
  budgetUsd: 0,
  spentUsd: 0,
  remainingUsd: 0,
  fraction: 0,
  active: false,
  exhausted: false,
  serverCapped: false,
  endedReason: null,
};

export type UnlockOutcome =
  | { ok: true; status: StudyStatus }
  | { ok: false; error: string };

/** `window.chattered.study`. */
export interface StudyApi {
  status(): Promise<StudyStatus>;
  unlock(input: { code: string }): Promise<UnlockOutcome>;
  onChanged(listener: (status: StudyStatus) => void): () => void;
}

/** The share of the budget at which the bar turns amber and the title bar starts to say so. */
export const LOW_CREDIT_FRACTION = 0.8;

/** The credit numbers from a budget and what has been spent. Pure, so both sides agree. */
export function creditFrom(budgetUsd: number, spentUsd: number): Pick<StudyStatus, 'remainingUsd' | 'fraction'> {
  const budget = budgetUsd > 0 ? budgetUsd : 0;
  const spent = spentUsd > 0 ? spentUsd : 0;
  return {
    remainingUsd: Math.max(0, round2(budget - spent)),
    fraction: budget === 0 ? 0 : Math.min(1, spent / budget),
  };
}

/** `$12.40`. Credit is shown to the cent; the estimate is not more exact than that. */
export function usd(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** What the participant reads when a call is refused because the credit is spent. */
export const CREDIT_USED_UP_MESSAGE =
  'Your study credit is used up. To keep going, add your own API key in Settings ▸ Where the study partners run.';

/**
 * Whether an Anthropic error says the workspace's spend limit was reached. Deliberately broad on
 * the wording, because the exact sentence is not documented: it is checked against a live refusal
 * in the pilot (`app/docs/STUDY-RELEASE.md` §5).
 */
export function looksLikeSpendLimit(status: number | null, message: string): boolean {
  if (status !== null && status !== 400 && status !== 402 && status !== 403 && status !== 429) return false;
  return /spend(ing)?[ _-]?limit|usage[ _-]?limit|credit balance|billing|monthly limit/i.test(message);
}
