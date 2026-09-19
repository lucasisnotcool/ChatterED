/**
 * The Explanation Ledger's four hard rules, enforced in code rather than in the prompt
 * (progress-tracking.md §4.4 — "a prompt asking nicely for these will be violated").
 *
 * Rule 1, the verbatim-evidence check, is the single most important line of code in this
 * feature: it is a deterministic, nearly-free guard against the ledger hallucinating progress.
 *
 * A fifth gate is added here because product-design.md §D2 makes it a product promise rather
 * than a model judgement: the terminal state `defended` is reachable **only** after the
 * Challenger has probed that element. "Only Max's challenge can produce this glyph" is the
 * answer to "could a quiz do this?", so it cannot be left to the model to honour.
 */
import type { LedgerLevel, LedgerState } from '../shared/types.js';
import type { LedgerGate, LedgerHistoryRow, LedgerRow } from './records.js';

export interface LedgerProposalElement {
  id: string;
  level: number;
  prev_level?: number;
  evidence: string | null;
  evidence_msg_id?: string | null;
  confidence: number;
  rationale?: string;
  misconceptions_present?: string[];
  misconceptions_resolved?: string[];
  /** The sole downgrade path (rule 2). */
  self_contradiction?: boolean;
}

export interface LedgerProposal {
  schema: 'ledger.v1';
  concept_id: string;
  message_id: string;
  elements: LedgerProposalElement[];
  coverage?: number;
  open_misconceptions?: string[];
  suggested_target_element?: string | null;
  suggested_probe_type?: string | null;
  notes_for_agents?: string;
}

export interface StudentMessage {
  id: string;
  seq: number;
  body: string;
}

export interface ApplyInput {
  proposal: LedgerProposal;
  current: LedgerRow[];
  /** Every student message so far — rule 1 checks `evidence` against all of them. */
  studentMessages: StudentMessage[];
  /** The message that triggered this update; rule 4 inspects it. */
  triggerMessage: StudentMessage;
  /** Element ids the Challenger has probed, from turn_decisions. Gates `defended`. */
  challengedElementIds: Set<string>;
  /** e.g. "defended against Max's probe on assumptions (turn 3)". */
  defenceLabel?: (elementId: string) => string | null;
  now: string;
}

export interface ApplyResult {
  rows: LedgerRow[];
  history: LedgerHistoryRow[];
  changed: string[];
  /** Set when rule 4 stopped the whole update. */
  skipped: LedgerGate | null;
}

/**
 * **The shape the ledger call must answer in.**
 *
 * Until 2026-09-16 the ledger call went out with no schema and no instructions — the Teacher's
 * own role block, plus `[Your move this turn: ledger_update. Reply with the message only…]` —
 * and then `JSON.parse(result.text)` on whatever prose came back. It failed every single turn:
 * `progress.update {"parse_ok":false}` at 02:30:38 in room_6a9609d5c6fb is that, and the rail
 * had simply never moved in a live room.
 *
 * `evidence` is the field that matters: rule 1 checks it verbatim against the learner's own
 * messages and drops anything that is not there, so the schema asks for a quote and the prompt
 * says why. The schema cannot enforce "is a substring" — `applyLedgerRules` does, and it is
 * deliberately the code and not the prompt that decides (progress-tracking.md §4.4).
 */
export const LEDGER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'concept_id', 'message_id', 'elements'],
  properties: {
    schema: { type: 'string', enum: ['ledger.v1'] },
    concept_id: { type: 'string' },
    message_id: { type: 'string' },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'level', 'evidence', 'confidence'],
        properties: {
          id: { type: 'string' },
          level: { type: 'integer', minimum: 0, maximum: 4 },
          evidence: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string' },
          misconceptions_present: { type: 'array', items: { type: 'string' } },
          misconceptions_resolved: { type: 'array', items: { type: 'string' } },
          self_contradiction: { type: 'boolean' },
        },
      },
    },
    open_misconceptions: { type: 'array', items: { type: 'string' } },
    suggested_target_element: { type: ['string', 'null'] },
    suggested_probe_type: {
      type: ['string', 'null'],
      enum: ['clarification', 'assumptions', 'reasons_evidence', 'implications', 'alternatives', null],
    },
    notes_for_agents: { type: 'string' },
  },
};

export const CONFIDENCE_FLOOR = 0.6;
const MIN_CONTENT_WORDS = 8;

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim();
}

export function levelToState(level: number): LedgerState {
  if (level >= 3) return 'defended';
  if (level === 2) return 'justified';
  if (level === 1) return 'stated';
  return 'not_yet';
}

const AGREEMENT =
  /^(ok(ay)?|yes|yeah|yep|sure|right|true|fair|agreed|i agree|makes sense|got it|i see|fine|exactly|correct)\b/i;

/**
 * **The agreement half of rule 4, on its own** (issue #47).
 *
 * Rule 4 refuses to advance a row on a message with no student-generated claim, and it refuses on
 * two grounds: the message is too short to contain one (`MIN_CONTENT_WORDS`), or it is agreement
 * rather than a claim. The attempt loop needs the *second* ground alone — `attempt.ts` classifies
 * a two-word answer as an attempt on purpose, because the answer lock is about having tried and
 * the ledger is about having explained (`attempt-first.md` §2.2). Splitting it here keeps one
 * definition of what agreement sounds like instead of two that can drift.
 */
export function isAgreementPhrase(body: string): boolean {
  const words = body.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const stripped = body.trim().replace(/[.!,]/g, '');
  return AGREEMENT.test(stripped) && words.length < 14;
}

/** Rule 4's heuristic: a message with no student-generated claim may not advance anything. */
export function isAgreementOnly(body: string): boolean {
  const words = body.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words.length < MIN_CONTENT_WORDS) return true;
  return isAgreementPhrase(body);
}

export function applyLedgerRules(input: ApplyInput): ApplyResult {
  const byId = new Map(input.current.map((r) => [r.element_id, r]));
  const history: LedgerHistoryRow[] = [];
  const changed: string[] = [];
  const rows: LedgerRow[] = [];

  // ── Rule 4 — agreement is not evidence. The system must never reward capitulating. ──
  if (isAgreementOnly(input.triggerMessage.body)) {
    for (const el of input.proposal.elements) {
      const before = byId.get(el.id);
      if (!before) continue;
      if (el.level > before.level) {
        history.push(hist(input, el, before.level, el.level, before.level, 'agreement_not_evidence'));
      }
    }
    return { rows: input.current, history, changed: [], skipped: 'agreement_not_evidence' };
  }

  const haystacks = input.studentMessages.map((m) => normalise(m.body));

  for (const el of input.proposal.elements) {
    const before = byId.get(el.id);
    if (!before) continue;
    const proposed = clampLevel(el.level);
    let after: LedgerLevel = before.level;
    let gate: LedgerGate | null = null;

    if (proposed > before.level) {
      // ── Rule 1 — evidence must be a verbatim substring of a student message. ──
      const evidence = el.evidence ? normalise(el.evidence) : '';
      const found = evidence.length > 0 && haystacks.some((h) => h.includes(evidence));
      // ── Rule 3 — confidence gate. ──
      if (!found) {
        gate = 'evidence_check_failed';
      } else if (el.confidence < CONFIDENCE_FLOOR) {
        gate = 'low_confidence';
      } else if (proposed >= 3 && !input.challengedElementIds.has(el.id)) {
        // ── The `defended` gate (product-design.md §D2). ──
        gate = 'defended_requires_challenge';
        after = clampLevel(Math.min(proposed, 2));
      } else {
        after = proposed;
      }
    } else if (proposed < before.level) {
      // ── Rule 2 — monotonic, with one exception, capped at one level. ──
      if (el.self_contradiction) {
        after = clampLevel(before.level - 1);
        gate = proposed < before.level - 1 ? 'downgrade_capped' : null;
      } else {
        gate = 'monotonic';
      }
    }

    if (after !== before.level || gate !== null) {
      history.push(hist(input, el, before.level, proposed, after, gate));
    }

    const row: LedgerRow = {
      ...before,
      level: after,
      level_proposed: proposed,
      confidence: el.confidence,
      updated_at: input.now,
      misconceptions_open: JSON.stringify(el.misconceptions_present ?? JSON.parse(before.misconceptions_open)),
      misconceptions_resolved: JSON.stringify(
        el.misconceptions_resolved ?? JSON.parse(before.misconceptions_resolved),
      ),
    };
    if (after > before.level) {
      row.evidence_text = el.evidence;
      row.evidence_msg_id = el.evidence_msg_id ?? input.triggerMessage.id;
      row.evidence_seq = input.triggerMessage.seq;
      row.revisit = 0;
      if (after >= 3) row.defended_against = input.defenceLabel?.(el.id) ?? before.defended_against;
      changed.push(el.id);
    } else if (after < before.level) {
      // Shown to the learner as "let's revisit this", never as a demotion.
      row.revisit = 1;
      changed.push(el.id);
    }
    rows.push(row);
  }

  // Elements the model did not mention keep their current row untouched.
  for (const row of input.current) {
    if (!rows.some((r) => r.element_id === row.element_id)) rows.push(row);
  }

  return { rows, history, changed, skipped: null };
}

function hist(
  input: ApplyInput,
  el: LedgerProposalElement,
  before: LedgerLevel,
  proposed: number,
  after: LedgerLevel,
  gate: LedgerGate | null,
): LedgerHistoryRow {
  return {
    session_id: input.current[0]?.session_id ?? '',
    message_id: input.proposal.message_id || input.triggerMessage.id,
    element_id: el.id,
    level_before: before,
    level_proposed: clampLevel(proposed),
    level_after: after,
    gate,
    created_at: input.now,
  };
}

function clampLevel(n: number): LedgerLevel {
  const i = Math.max(0, Math.min(4, Math.round(n)));
  return i as LedgerLevel;
}

/** Layer 2 of the rail: one line at the *lowest* element's rung (product-design.md §D1). */
export function bloomRung(rows: LedgerRow[]): 'remember' | 'understand' | 'apply' | 'analyse' {
  // No rows is a `pending` pack, not a mastered one. Without this the reduce's seed of 4 made
  // an empty rail report `analyse` — the top rung — for a deck nobody had explained anything
  // about yet (issue #35).
  if (rows.length === 0) return 'remember';
  const lowest = rows.reduce((min, r) => Math.min(min, r.level), 4);
  switch (lowest) {
    case 4:
      return 'analyse';
    case 3:
      return 'apply';
    case 2:
      return 'understand';
    default:
      return 'remember';
  }
}

export function coverage(rows: LedgerRow[], targetLevel: number): number {
  if (rows.length === 0) return 0;
  const mean = rows.reduce((sum, r) => sum + r.level, 0) / rows.length;
  return Math.max(0, Math.min(1, mean / Math.max(1, targetLevel)));
}
