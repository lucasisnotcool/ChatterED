/**
 * **The study build's main-process half**: the bundle, the unlock, the credit and the guard.
 *
 * See `src/shared/study.ts` for the design and `src/main/study/crypto.ts` for the sealing. This
 * file decides three things.
 *
 *  1. **What unlocking does.** It writes the slot's key to the ordinary Anthropic key file (so
 *     every existing path, Test connection included, sees an ordinary key), forces the backend to
 *     Anthropic so `auto` never picks a Claude Code the participant happens to have, and sets the
 *     study's models on both roles. Then it records the slot, the budget, the time and a
 *     fingerprint of the key, never the key itself.
 *  2. **What has been spent.** Anthropic calls since the unlock, from `llm_usage`, up to the moment
 *     the study key stopped being the key in use. Replacing the Anthropic key with one's own ends
 *     the count, so a participant who moves on is not shown a bar for money that is not the study's.
 *  3. **When to stop.** `guard()` wraps the client every call goes through. On the Anthropic
 *     backend with the study key active, a call over budget is refused before it is made, and an
 *     Anthropic refusal that names the spend limit marks the credit used up.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { ApiKeyStore } from '../apikey.js';
import type { SqlDatabase } from '../db/driver.js';
import type { SettingsRepo } from '../db/repos/core.js';
import { SETTINGS_KEYS } from '../llm/detect.js';
import { agentModelKey, orchestratorModelKey, PROVIDER_SETTINGS } from '../llm/providers.js';
import type { LLMClient, LlmRequest, LlmResult } from '../../room/llm/types.js';
import {
  CREDIT_USED_UP_MESSAGE,
  NO_STUDY,
  STUDY_SETTINGS,
  creditFrom,
  looksLikeSpendLimit,
  type StudyEndReason,
  type StudyStatus,
  type UnlockOutcome,
} from '../../shared/study.js';
import { parseBundle, unsealSlot, type StudyBundle } from './crypto.js';

/** Thrown in place of a call when the study credit is spent. The message is the participant's. */
export class StudyCreditUsedUpError extends Error {
  constructor() {
    super(CREDIT_USED_UP_MESSAGE);
    this.name = 'StudyCreditUsedUpError';
  }
}

export interface StudyServiceDeps {
  db: SqlDatabase;
  settings: SettingsRepo;
  anthropicKey: ApiKeyStore;
  /** Where this build's bundle is, or null for an ordinary build. */
  bundlePath: string | null;
  now?: () => string;
  /** Pushed whenever the status may have changed. */
  onChanged?: (status: StudyStatus) => void;
}

export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key.trim(), 'utf8').digest('hex').slice(0, 16);
}

export class StudyService {
  readonly #d: StudyServiceDeps;
  readonly #now: () => string;
  #bundle: StudyBundle | null | undefined;

  constructor(deps: StudyServiceDeps) {
    this.#d = deps;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  /** The bundle, read once. A missing or unreadable file means an ordinary build. */
  bundle(): StudyBundle | null {
    if (this.#bundle !== undefined) return this.#bundle;
    const path = this.#d.bundlePath;
    this.#bundle = path && existsSync(path) ? parseBundle(readFileSync(path, 'utf8')) : null;
    return this.#bundle;
  }

  status(): StudyStatus {
    const s = this.#d.settings;
    const available = this.bundle() !== null;
    const slot = s.get(STUDY_SETTINGS.slot) ?? null;
    if (!slot) return { ...NO_STUDY, available };

    this.#reconcileKey();
    const budgetUsd = Number(s.get(STUDY_SETTINGS.budgetUsd) ?? '0') || 0;
    const spentUsd = this.spentUsd();
    const endedReason = (s.get(STUDY_SETTINGS.endedReason) || null) as StudyEndReason | null;
    const serverCapped = Boolean(s.get(STUDY_SETTINGS.serverCappedAt));
    const credit = creditFrom(budgetUsd, spentUsd);
    return {
      available,
      unlocked: true,
      slot,
      budgetUsd,
      spentUsd: Math.round(spentUsd * 100) / 100,
      ...credit,
      active: endedReason === null,
      exhausted: serverCapped || (budgetUsd > 0 && spentUsd >= budgetUsd),
      serverCapped,
      endedReason,
    };
  }

  /**
   * Anthropic calls between the unlock and the end of the study key's use. Read from the ledger
   * every time: one indexed sum, and it can never disagree with the Usage page.
   */
  spentUsd(): number {
    const s = this.#d.settings;
    const from = s.get(STUDY_SETTINGS.unlockedAt);
    if (!from) return 0;
    const until = s.get(STUDY_SETTINGS.endedAt) || null;
    const row = this.#d.db
      .prepare(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS usd FROM llm_usage
          WHERE backend = 'anthropic' AND created_at >= @from AND (@until IS NULL OR created_at < @until)`,
      )
      .get<{ usd: number }>({ from, until });
    return row?.usd ?? 0;
  }

  unlock(code: string): UnlockOutcome {
    const bundle = this.bundle();
    if (!bundle) return { ok: false, error: 'This copy of ChatterED is not a study build.' };
    const opened = unsealSlot(bundle, code);
    if (!opened.ok) {
      const error = {
        malformed: 'That is not a study code. It looks like S07-K3QX-9MZT-4HRA: check it against the one you were sent.',
        no_slot: 'That code is not for this copy of ChatterED. Check you downloaded the study build you were sent.',
        wrong_code: 'That code did not work. Check each character against the one you were sent.',
        bad_payload: 'That code opened something this version cannot read. Please tell the research team.',
      }[opened.reason];
      return { ok: false, error };
    }
    const p = opened.payload;
    const s = this.#d.settings;
    const now = this.#now();
    const sameSlot = s.get(STUDY_SETTINGS.slot) === p.slot;

    this.#d.anthropicKey.set(p.apiKey);
    s.set(SETTINGS_KEYS.backend, 'anthropic', now);
    s.set(PROVIDER_SETTINGS.preferred, 'anthropic', now);
    s.set(agentModelKey('anthropic'), p.models.agent, now);
    s.set(orchestratorModelKey('anthropic'), p.models.orchestrator, now);

    s.set(STUDY_SETTINGS.slot, p.slot, now);
    s.set(STUDY_SETTINGS.budgetUsd, String(p.budgetUsd), now);
    s.set(STUDY_SETTINGS.keyFingerprint, keyFingerprint(p.apiKey), now);
    // Re-entering the same code (after removing the key by mistake) carries on the same count.
    if (!sameSlot || !s.get(STUDY_SETTINGS.unlockedAt)) s.set(STUDY_SETTINGS.unlockedAt, now, now);
    if (!sameSlot) s.set(STUDY_SETTINGS.serverCappedAt, '', now);
    s.set(STUDY_SETTINGS.endedAt, '', now);
    s.set(STUDY_SETTINGS.endedReason, '', now);

    const status = this.status();
    this.#d.onChanged?.(status);
    return { ok: true, status };
  }

  /**
   * **The study key is the one in use, or the count stops.** A participant who pastes their own
   * Anthropic key, or clears it, has left the study's credit; the moment is recorded once, so a
   * later status still counts only what the study key spent.
   */
  #reconcileKey(): void {
    const s = this.#d.settings;
    if (s.get(STUDY_SETTINGS.endedAt)) return;
    const fp = s.get(STUDY_SETTINGS.keyFingerprint);
    if (!fp) return;
    const current = this.#d.anthropicKey.get();
    if (current !== null && keyFingerprint(current) === fp) return;
    const now = this.#now();
    s.set(STUDY_SETTINGS.endedAt, now, now);
    s.set(STUDY_SETTINGS.endedReason, current === null ? 'key_removed' : 'key_replaced', now);
  }

  /**
   * **Every client the app builds passes through here.** Only the Anthropic backend is guarded,
   * and only while the study key is the one in use: a participant on their own provider is never
   * stopped by the study's budget.
   */
  guard(inner: LLMClient, backendKind: string): LLMClient {
    if (backendKind !== 'anthropic' || !this.bundle()) return inner;
    return {
      kind: inner.kind,
      complete: async (request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> => {
        const before = this.status();
        if (before.active && before.exhausted) {
          this.#d.onChanged?.(before);
          throw new StudyCreditUsedUpError();
        }
        try {
          return await inner.complete(request, onDelta, signal);
        } catch (err) {
          if (before.active && looksLikeSpendLimit(statusOf(err), err instanceof Error ? err.message : String(err))) {
            const now = this.#now();
            this.#d.settings.set(STUDY_SETTINGS.serverCappedAt, now, now);
            throw new StudyCreditUsedUpError();
          }
          throw err;
        } finally {
          if (before.active) this.#d.onChanged?.(this.status());
        }
      },
    };
  }
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}
