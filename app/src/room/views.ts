/**
 * Row → view mapping. The renderer never sees a database row, and never sees a whisper row in
 * anything it renders into the group thread.
 */
import type {
  AgentProfile,
  VaultFileKind,
  LedgerRowView,
  LedgerView,
  MessageView,
  TimerView,
  WhisperTurnView,
} from '../shared/types.js';
import { ROLE_LABEL } from './agents.js';
import { bloomRung, coverage, levelToState } from './ledger.js';
import type {
  ConceptPack,
  LedgerRow,
  MessageRefRow,
  MessageRow,
  ParticipantRow,
  WhisperRow,
} from './records.js';
import type { TimerSnapshot } from './timer.js';

export function messageView(
  row: MessageRow,
  participants: Map<string, ParticipantRow>,
  roster: AgentProfile[],
  reference?: MessageRefRow,
): MessageView {
  const p = participants.get(row.participant_id);
  const agent = p?.agent_key ? roster.find((a) => a.key === p.agent_key) : undefined;
  const disagreement = row.disagreement ? (JSON.parse(row.disagreement) as MessageView['disagreement']) : null;
  return {
    id: row.id,
    seq: row.seq,
    speaker: agent
      ? { kind: 'agent', key: agent.key, role: agent.role, displayName: agent.displayName, colour: agent.colour }
      : { kind: 'student', displayName: 'You' },
    body: row.body,
    createdAt: row.created_at,
    latencyTargetMs: row.latency_target_ms,
    ttftActualMs: row.ttft_actual_ms,
    promotedFromWhisper: row.promoted_from_whisper !== null,
    disagreement,
    divider: row.divider_cause ? { cause: row.divider_cause, control: 'dont_do_this' } : null,
    // The page text the agents were given is deliberately absent: the card says a document was
    // shown and which pages, not the pages themselves (issue #22 decision 4).
    reference: reference
      ? {
          fileId: reference.file_id,
          fileName: reference.file_name,
          relPath: reference.rel_path,
          kind: reference.kind as VaultFileKind,
          pageFrom: reference.page_from,
          pageTo: reference.page_to,
          selection: reference.selection,
          attachedChars: reference.page_text.length,
        }
      : null,
  };
}

export function ledgerRowView(row: LedgerRow, pack: ConceptPack): LedgerRowView {
  const element = pack.elements.find((e) => e.id === row.element_id);
  return {
    elementId: row.element_id,
    label: element?.label ?? row.element_id,
    learnerLabel: element?.learner_label ?? element?.label ?? row.element_id,
    level: row.level,
    state: levelToState(row.level),
    evidenceText: row.evidence_text,
    evidenceMsgId: row.evidence_msg_id,
    evidenceTurn: row.evidence_seq,
    defendedAgainst: row.defended_against,
    revisit: row.revisit === 1,
    contested: row.contested === 1,
    openMisconceptions: safeArray(row.misconceptions_open),
  };
}

export function ledgerView(rows: LedgerRow[], pack: ConceptPack): LedgerView {
  const ordered = [...rows].sort((a, b) => (a.element_id < b.element_id ? -1 : 1));
  return {
    rows: ordered.map((r) => ledgerRowView(r, pack)),
    covered: ordered.filter((r) => r.level > 0).length,
    total: ordered.length,
    bloom: bloomRung(ordered),
    coverage: coverage(ordered, pack.target_level),
  };
}

export function timerView(snapshot: TimerSnapshot, silenceMs: number, now: number, typingPause: boolean): TimerView {
  return {
    deadlineTs: snapshot.deadlineTs === null ? null : new Date(snapshot.deadlineTs).toISOString(),
    epoch: snapshot.epoch,
    silenceMs,
    stage: snapshot.firesThisRound >= 2 ? 2 : (snapshot.firesThisRound as 0 | 1 | 2),
    paused: typingPause || snapshot.nudgesPaused,
    pausedReason: snapshot.nudgesPaused ? 'user' : typingPause ? 'typing' : null,
    nudgesDone: snapshot.firesThisRound >= 2,
    now: new Date(now).toISOString(),
  };
}

export function whisperTurnView(row: WhisperRow): WhisperTurnView {
  return {
    id: row.id,
    threadId: row.thread_id,
    seq: row.seq,
    sender: row.sender,
    body: row.body,
    createdAt: row.created_at,
    relayOffer: row.relay_offer ? (JSON.parse(row.relay_offer) as WhisperTurnView['relayOffer']) : null,
  };
}

export function speakerLabel(agent: AgentProfile): string {
  return `${agent.displayName.toUpperCase()} · ${ROLE_LABEL[agent.role]}`;
}

function safeArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
