/**
 * **What the app already knows it spent, before it started counting.**
 *
 * The ledger starts empty on the build that introduces it, and an install that has been used for
 * a week would open a cost panel reading zero — which is the one number guaranteed to be wrong.
 * Three tables already carry a `usage` blob written by `src/room/records.ts`:
 *
 * | table | scope it becomes | what it is |
 * |---|---|---|
 * | `messages` (agent / REFERENCE rows) | `'group'` / `'reference'` | the reply the learner read |
 * | `turn_decisions` | `'orchestrator'` | the decision, including the ones that chose silence |
 * | `whispers` (agent rows) | `'whisper'` | a side-channel reply |
 *
 * **What cannot be recovered, said plainly.** The ledger call has never had a row of its own, so
 * every ledger update before this build is invisible; so is the concept ingest and the
 * objectives ingest, which write their result and not their usage. Those are, on the CLI, among
 * the largest calls the app makes (`models.ts`: 4,053 output tokens for one ingest). A
 * backfilled total is therefore a **floor**, and `CostSummary.backfilledCalls` is on the wire so
 * a panel can say how much of its own history it is inferring rather than reporting.
 *
 * `main.log` is deliberately *not* a source. It carries `llm.complete` with the full usage and
 * would close most of the gap — but it rotates at 4 MB keeping four files, so what it holds is a
 * sliding window of unknown length, and a backfill whose coverage depends on how chatty the last
 * fortnight was produces a total that changes for reasons nobody can explain. A floor that is
 * always computed the same way is worth more than a fuller number that is not reproducible.
 *
 * **Idempotent by construction.** Every reconstructed row's id is derived from the id of the row
 * it came from (`use_msg_<message id>`), so running the backfill at every launch — which is what
 * happens — inserts each call exactly once. `recordIfNew` does the `INSERT OR IGNORE`.
 */
import type { CostBackend, CostScope, CostTokens } from '../../shared/cost.js';
import type { SqlDatabase } from '../db/driver.js';
import type { CostLedger } from './ledger.js';

export interface BackfillResult {
  /** Rows written this run. Zero on every launch after the first. */
  inserted: number;
  /** Rows examined that carried a usable `usage` blob. */
  candidates: number;
  byScope: Record<string, number>;
  ms: number;
}

/** The `usage` blob as `records.ts` writes it: the four wire-named counts, or nothing at all. */
function tokensFrom(raw: string | null): CostTokens | null {
  if (raw === null || raw === undefined || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const u = parsed as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const tokens: CostTokens = {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
  };
  // An all-zero blob is the scripted client's `EMPTY_USAGE`. It is a real row — a scripted
  // sitting really did cost nothing — but it is not evidence of a *model* call, and counting it
  // would put "0 tokens, 40 calls" on a panel for a session that never touched a backend.
  return tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead === 0 ? null : tokens;
}

interface MessageUsageRow {
  id: string;
  room_id: string;
  anchor_id: string | null;
  model: string | null;
  backend: string | null;
  usage: string | null;
  created_at: string;
  turn_decision_id: string | null;
  kind: string | null;
  agent_key: string | null;
  file_id: string | null;
}

export function backfillUsage(db: SqlDatabase, ledger: CostLedger): BackfillResult {
  const startedAt = Date.now();
  let inserted = 0;
  let candidates = 0;
  const byScope: Record<string, number> = {};
  const bump = (scope: CostScope, added: boolean): void => {
    if (!added) return;
    inserted += 1;
    byScope[scope] = (byScope[scope] ?? 0) + 1;
  };

  /**
   * The join is what turns a message into an attributable call: `participants.kind` says whether
   * an agent or the REFERENCE voice wrote it (a `student` row never has usage), and
   * `materials.file_id` is how a call made inside a room is filed under the document — the same
   * path `CostLedger.record` takes live.
   */
  const messages = db
    .prepare(
      `SELECT m.id, m.room_id, m.anchor_id, m.model, m.backend, m.usage, m.created_at, m.turn_decision_id,
              p.kind, p.agent_key, mat.file_id
         FROM messages m
         JOIN participants p ON p.id = m.participant_id
         JOIN rooms r ON r.id = m.room_id
         JOIN materials mat ON mat.id = r.material_id
        WHERE m.usage IS NOT NULL AND m.usage != ''`,
    )
    .all<MessageUsageRow>();

  for (const row of messages) {
    const tokens = tokensFrom(row.usage);
    if (tokens === null) continue;
    candidates += 1;
    /**
     * `participants.agent_key IS NULL` on an agent-kind row is the REFERENCE voice: it is
     * created with the room precisely so the orchestrator cannot select it (`reference.ts`).
     * That is the only way to tell a REFERENCE card from a Teacher turn on an old row, and it
     * is the same discriminator `views.ts` uses to render one.
     */
    const scope: CostScope = row.agent_key === null ? 'reference' : 'group';
    bump(
      scope,
      ledger.recordIfNew({
        id: `use_msg_${row.id}`,
        scope,
        model: row.model ?? 'unknown',
        backend: backendOf(row.backend),
        tokens,
        roomId: row.room_id,
        fileId: row.file_id,
        anchorId: row.anchor_id,
        at: row.created_at,
        backfilled: true,
        source: 'messages',
      }),
    );
  }

  /**
   * The orchestrator's own calls. `turn_decisions` carries no model and no backend of its own —
   * it never needed them, because until now nothing read it for anything but the decision. The
   * message the decision produced has both, so the decision borrows them; a decision that chose
   * **silence** produced no message, and those are exactly the rows that were invisible before,
   * so they fall back to the session's recorded backend and are priced at the orchestrator's
   * default model with `rate_exact = 0` saying so.
   */
  const decisions = db
    .prepare(
      `SELECT d.id, d.room_id, d.usage, d.created_at,
              m.model AS model, m.backend AS backend, m.anchor_id AS anchor_id,
              s.llm_backend AS session_backend, mat.file_id AS file_id
         FROM turn_decisions d
         LEFT JOIN messages m ON m.turn_decision_id = d.id
         LEFT JOIN rooms r ON r.id = d.room_id
         LEFT JOIN materials mat ON mat.id = r.material_id
         LEFT JOIN sessions s ON s.room_id = d.room_id
        WHERE d.usage IS NOT NULL AND d.usage != ''`,
    )
    .all<{
      id: string;
      room_id: string;
      usage: string | null;
      created_at: string;
      model: string | null;
      backend: string | null;
      anchor_id: string | null;
      session_backend: string | null;
      file_id: string | null;
    }>();

  for (const row of decisions) {
    const tokens = tokensFrom(row.usage);
    if (tokens === null) continue;
    candidates += 1;
    bump(
      'orchestrator',
      ledger.recordIfNew({
        id: `use_dec_${row.id}`,
        scope: 'orchestrator',
        model: row.model ?? 'unknown',
        backend: backendOf(row.backend ?? row.session_backend),
        tokens,
        roomId: row.room_id,
        fileId: row.file_id,
        anchorId: row.anchor_id,
        at: row.created_at,
        backfilled: true,
        source: 'turn_decisions',
      }),
    );
  }

  /**
   * Whispers. Read with **raw SQL and named columns**, never through the whispers repository and
   * never selecting `body` — the §D.4 invariant is about a whisper's *content* reaching a group
   * prompt, and four token counts are not content. The eslint rule restricts importing
   * `repos/whispers`; nothing here does.
   */
  const whispers = db
    .prepare(
      `SELECT w.id, w.room_id, w.usage, w.created_at, mat.file_id AS file_id, s.llm_backend AS session_backend
         FROM whispers w
         LEFT JOIN rooms r ON r.id = w.room_id
         LEFT JOIN materials mat ON mat.id = r.material_id
         LEFT JOIN sessions s ON s.room_id = w.room_id
        WHERE w.sender = 'agent' AND w.usage IS NOT NULL AND w.usage != ''`,
    )
    .all<{ id: string; room_id: string; usage: string | null; created_at: string; file_id: string | null; session_backend: string | null }>();

  for (const row of whispers) {
    const tokens = tokensFrom(row.usage);
    if (tokens === null) continue;
    candidates += 1;
    bump(
      'whisper',
      ledger.recordIfNew({
        id: `use_whi_${row.id}`,
        scope: 'whisper',
        model: 'unknown',
        backend: backendOf(row.session_backend),
        tokens,
        roomId: row.room_id,
        fileId: row.file_id,
        anchorId: null,
        at: row.created_at,
        backfilled: true,
        source: 'whispers',
      }),
    );
  }

  return { inserted, candidates, byScope, ms: Date.now() - startedAt };
}

/**
 * `messages.backend` holds the client kind (`claude-cli`, `openai-compatible`); `sessions.llm_backend`
 * holds Settings' spelling (`claude_cli`, `openai_compatible`). Both are accepted.
 */
function backendOf(raw: string | null | undefined): CostBackend {
  if (raw === 'anthropic' || raw === 'scripted' || raw === 'claude-cli') return raw;
  if (raw === 'openai' || raw === 'gemini' || raw === 'openai-compatible') return raw;
  if (raw === 'openai_compatible') return 'openai-compatible';
  if (raw === 'claude_cli') return 'claude-cli';
  // Unknown means old: migration 003 added the column, and before it the only live backend was
  // the API path. Reading a missing value as `claude-cli` would invent a subscription that did
  // not exist and would put those rows into a 5-hour window they were never in.
  return 'anthropic';
}
