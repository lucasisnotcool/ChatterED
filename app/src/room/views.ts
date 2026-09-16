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
import { profile, ROLE_LABEL } from './agents.js';
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

/**
 * The speaker of a turn whose agent key has left the roster, rebuilt from the row itself.
 * Display name from `participants.display_name` (stored per room, at join), role from the
 * key prefix, colour from the role. Returns undefined for a key that is not role-shaped.
 */
function historicalAgent(p: ParticipantRow): AgentProfile | undefined {
  const role = (p.agent_key ?? '').split('.')[0];
  if (role !== 'peer' && role !== 'challenger' && role !== 'tutee' && role !== 'whisper') return undefined;
  return { ...profile(role, p.display_name), key: p.agent_key! };
}

export function messageView(
  row: MessageRow,
  participants: Map<string, ParticipantRow>,
  roster: AgentProfile[],
  reference?: MessageRefRow,
): MessageView {
  const p = participants.get(row.participant_id);
  /**
   * An `agent_key` the **current** roster does not contain is a historical room: the pairing was
   * randomised at install until #32 pinned it (`agents.ts`), so a room played before the pin can
   * hold `peer.max` while today's roster holds `peer.ellie`. The row is not re-written and the
   * transcript is not rebranded — the participant carries the display name it was played under,
   * and the role is the key's own prefix. Without this the turn fell through to
   * `{ kind: 'student' }` and an agent's words came out wearing the learner's face, which is the
   * same defect the reference participant hit above.
   */
  const agent = p?.agent_key
    ? (roster.find((a) => a.key === p.agent_key) ?? historicalAgent(p))
    : undefined;
  const disagreement = row.disagreement ? (JSON.parse(row.disagreement) as MessageView['disagreement']) : null;
  /**
   * The reference participant is `kind = 'agent'` with a **null** `agent_key` — that is how the
   * schema says "not an agent" (`reference.ts`). Before this it fell through the `agent` lookup
   * and came out of here as `{ kind: 'student' }`, i.e. the 120-word machine answer rendered
   * wearing the learner's face. It gets its own speaker kind instead.
   */
  const isReference = p?.kind === 'agent' && !p.agent_key;
  return {
    id: row.id,
    seq: row.seq,
    speaker: agent
      ? { kind: 'agent', key: agent.key, role: agent.role, displayName: agent.displayName, colour: agent.colour }
      : isReference
        ? { kind: 'reference', displayName: 'REFERENCE' }
        : { kind: 'student', displayName: 'You' },
    body: row.body,
    createdAt: row.created_at,
    latencyTargetMs: row.latency_target_ms,
    ttftActualMs: row.ttft_actual_ms,
    promotedFromWhisper: row.promoted_from_whisper !== null,
    disagreement,
    divider: row.divider_cause ? { cause: row.divider_cause, control: 'dont_do_this' } : null,
    anchorId: row.anchor_id,
    // `model` carries `rule:handoff` for the one turn `flow.ts` *writes* rather than generates
    // (`handOffLine()`). The flow shows that as a small `by rule` tag; nothing else reads it.
    // A quiz or feedback turn is decided by rule but still generated, so it is not tagged —
    // claiming otherwise would be the kind of overclaim the tag exists to rule out.
    byRule: row.model?.startsWith('rule:') ? row.model.slice('rule:'.length) : null,
    /**
     * The learner pressed Stop and this is the partial (migration 011). The card should say so:
     * an unmarked partial is a turn that looks like it ended where the agent meant it to.
     */
    stopped: row.stopped === 1,
    /**
     * Provenance (audit §6). Shown on hover as `14:22 · 9.4s · haiku-4-5 · claude-cli`, with
     * `scripted` shown **unconditionally** — the one case where not saying it is a claim.
     * `model` here is the id the backend reported, which for a rule-written line is `rule:…`
     * and for the nudge pool is `pool:content_free`; `byRule` above is the rendered form.
     */
    model: row.model,
    backend: row.backend,
    totalMs: row.total_ms ?? null,
    decidedBy: row.decided_by ?? null,
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
