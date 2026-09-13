import { describe, expect, it } from 'vitest';
import { applyLedgerRules, bloomRung, isAgreementOnly, type LedgerProposal } from './ledger.js';
import type { LedgerRow } from './records.js';

const NOW = '2026-09-13T10:10:00.000Z';

function row(elementId: string, level: 0 | 1 | 2 | 3 | 4): LedgerRow {
  return {
    id: `led_${elementId}`,
    session_id: 'sess_test',
    element_id: elementId,
    level,
    level_proposed: level,
    confidence: null,
    evidence_text: null,
    evidence_msg_id: null,
    evidence_seq: null,
    defended_against: null,
    revisit: 0,
    contested: 0,
    misconceptions_open: '[]',
    misconceptions_resolved: '[]',
    updated_at: NOW,
  };
}

const STUDENT = {
  id: 'm_2',
  seq: 2,
  body: "Right — it's zᵀHz ≥ 0 for every vector z, not the entries. It has to be PSD everywhere on S.",
};

function proposal(elements: LedgerProposal['elements']): LedgerProposal {
  return { schema: 'ledger.v1', concept_id: 'psd-hessian-convexity-v1', message_id: 'm_2', elements };
}

describe('the four hard ledger rules', () => {
  it('rule 1: rejects an advance whose evidence is not verbatim in a student message', () => {
    const result = applyLedgerRules({
      proposal: proposal([
        { id: 'R2', level: 2, evidence: 'the student clearly understands positive semidefiniteness', confidence: 0.9 },
      ]),
      current: [row('R2', 0)],
      studentMessages: [STUDENT],
      triggerMessage: STUDENT,
      challengedElementIds: new Set(),
      now: NOW,
    });
    expect(result.rows[0]!.level).toBe(0);
    expect(result.history[0]!.gate).toBe('evidence_check_failed');
    expect(result.changed).toEqual([]);
  });

  it('rule 1: accepts an advance quoting the student verbatim, ignoring case and whitespace', () => {
    const result = applyLedgerRules({
      proposal: proposal([{ id: 'R2', level: 2, evidence: "it's   zᵀHz ≥ 0 FOR every vector z", confidence: 0.9 }]),
      current: [row('R2', 0)],
      studentMessages: [STUDENT],
      triggerMessage: STUDENT,
      challengedElementIds: new Set(),
      now: NOW,
    });
    expect(result.rows[0]!.level).toBe(2);
    expect(result.rows[0]!.evidence_msg_id).toBe('m_2');
    expect(result.changed).toEqual(['R2']);
  });

  it('rule 2: refuses a downgrade unless the student contradicted themselves, and caps it at one level', () => {
    const monotonic = applyLedgerRules({
      proposal: proposal([{ id: 'R1', level: 0, evidence: null, confidence: 0.9 }]),
      current: [row('R1', 2)],
      studentMessages: [STUDENT],
      triggerMessage: STUDENT,
      challengedElementIds: new Set(),
      now: NOW,
    });
    expect(monotonic.rows[0]!.level).toBe(2);
    expect(monotonic.history[0]!.gate).toBe('monotonic');

    const capped = applyLedgerRules({
      proposal: proposal([{ id: 'R1', level: 0, evidence: null, confidence: 0.9, self_contradiction: true }]),
      current: [row('R1', 3)],
      studentMessages: [STUDENT],
      triggerMessage: STUDENT,
      challengedElementIds: new Set(),
      now: NOW,
    });
    expect(capped.rows[0]!.level).toBe(2);
    expect(capped.rows[0]!.revisit).toBe(1);
    expect(capped.history[0]!.gate).toBe('downgrade_capped');
  });

  it('rule 3: holds an advance below the confidence floor', () => {
    const result = applyLedgerRules({
      proposal: proposal([{ id: 'R2', level: 2, evidence: 'not the entries', confidence: 0.41 }]),
      current: [row('R2', 1)],
      studentMessages: [STUDENT],
      triggerMessage: STUDENT,
      challengedElementIds: new Set(),
      now: NOW,
    });
    expect(result.rows[0]!.level).toBe(1);
    expect(result.rows[0]!.level_proposed).toBe(2);
    expect(result.history[0]!.gate).toBe('low_confidence');
  });

  it('rule 4: a message that only agrees advances nothing', () => {
    const agree = { id: 'm_3', seq: 3, body: 'yeah ok that makes sense' };
    const result = applyLedgerRules({
      proposal: proposal([{ id: 'R1', level: 3, evidence: 'ok', confidence: 0.99 }]),
      current: [row('R1', 1)],
      studentMessages: [STUDENT, agree],
      triggerMessage: agree,
      challengedElementIds: new Set(['R1']),
      now: NOW,
    });
    expect(result.skipped).toBe('agreement_not_evidence');
    expect(result.rows[0]!.level).toBe(1);
    expect(isAgreementOnly('yeah ok that makes sense')).toBe(true);
    expect(isAgreementOnly(STUDENT.body)).toBe(false);
  });

  it('only the Challenger can move a row to defended', () => {
    const args = {
      proposal: proposal([{ id: 'R3', level: 3, evidence: 'It has to be PSD everywhere on S', confidence: 0.95 }]),
      current: [row('R3', 2)],
      studentMessages: [STUDENT],
      triggerMessage: STUDENT,
      now: NOW,
    };
    const unchallenged = applyLedgerRules({ ...args, challengedElementIds: new Set<string>() });
    expect(unchallenged.rows[0]!.level).toBe(2);
    expect(unchallenged.history[0]!.gate).toBe('defended_requires_challenge');

    const challenged = applyLedgerRules({
      ...args,
      challengedElementIds: new Set(['R3']),
      defenceLabel: () => "defended against Max's probe on assumptions (turn 3)",
    });
    expect(challenged.rows[0]!.level).toBe(3);
    expect(challenged.rows[0]!.defended_against).toContain('probe on assumptions');
  });

  it('reports the Bloom rung at the lowest element', () => {
    expect(bloomRung([row('R1', 4), row('R2', 2), row('R3', 0)])).toBe('remember');
    expect(bloomRung([row('R1', 3), row('R2', 2), row('R3', 2)])).toBe('understand');
    expect(bloomRung([row('R1', 4), row('R2', 4), row('R3', 4)])).toBe('analyse');
  });
});
