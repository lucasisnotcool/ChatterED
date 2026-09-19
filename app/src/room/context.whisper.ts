/**
 * WHISPER-scope prompt assembly — the only builder that may read the whispers table.
 *
 * It sees the group transcript **only up to `upToGroupSeq`**, the snapshot taken when the
 * aside began (critique1-btw.txt T1–T3: the side channel knows what the room had said by then,
 * and nothing after it), plus this one thread.
 */
import type { AgentProfile } from '../shared/types.js';
import { ROLE_LABEL, otherStandingAgent } from './agents.js';
import type { WhisperStore } from './ports.js';
import type { ConceptPack } from './records.js';
import { sharedBlock } from './prompts.js';
import { whisperRoleBlock } from './prompts.whisper.js';
import type { CacheableBlock, LlmMessage, LlmRequest } from './llm/types.js';

export interface WhisperContextInput {
  roomId: string;
  threadId: string;
  upToGroupSeq: number;
  speaker: AgentProfile;
  roster: AgentProfile[];
  pack: ConceptPack;
  maxTokens?: number;
  /**
   * The segment the popover is anchored to (`flow-build-plan.md` §3.5).
   *
   * **The same anchored context the REFERENCE call gets**, and for the same reason: a private
   * question about the lower half of slide 3 is answerable only by something that has read
   * slide 3. `flowroom.segmentText()` resolves it in the main process — the page's text, not
   * the rectangle's, which is the approximation `SEGMENTS.md` §2 forces and STATUS.md records.
   *
   * It goes in `messages`, never in `system`: system[0] is byte-identical across agents and
   * frozen at pack confirmation (architecture-mac.md §E.3), and a per-segment block there would
   * invalidate every cached prefix in the room on every ⌘K.
   */
  segment?: { label: string; page: number | null; text: string } | null;
}

export function buildWhisperContext(store: WhisperStore, input: WhisperContextInput): LlmRequest {
  const room = store.rooms.get(input.roomId);
  if (!room) throw new Error(`No such room: ${input.roomId}`);
  const material = store.materials.get(room.material_id);
  if (!material) throw new Error(`No material for room ${input.roomId}`);

  const shared = sharedBlock({ material, pack: input.pack, topic: room.topic, roster: input.roster });
  const other = otherStandingAgent(input.roster, input.speaker);
  const system: CacheableBlock[] = [
    // Byte-identical to the group system[0], so the whisper call reads the same cache entry.
    { type: 'text', text: shared, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: whisperRoleBlock(input.speaker, other?.displayName ?? 'the challenger'), cache_control: { type: 'ephemeral' } },
  ];

  const participants = new Map(store.participants.forRoom(input.roomId).map((p) => [p.id, p]));
  const prefix = store.messages.forRoomUpToSeq(input.roomId, input.upToGroupSeq);
  const groupPrefix = prefix
    .map((m) => {
      const p = participants.get(m.participant_id);
      const label =
        p?.kind === 'student' ? 'Student' : `${p?.display_name ?? 'Agent'} (${ROLE_LABEL[roleOf(p?.agent_key)]})`;
      return `${label}: ${m.body}`;
    })
    .join('\n\n');

  const turns: LlmMessage[] = [
    {
      role: 'user',
      content: `THE GROUP CONVERSATION SO FAR (read-only, up to the moment this aside began)\n\n${groupPrefix}`,
    },
  ];

  if (input.segment && input.segment.text.trim().length > 0) {
    const where = input.segment.page === null ? input.segment.label : `${input.segment.label} · page ${input.segment.page}`;
    turns.push({
      role: 'user',
      content:
        `THE PART OF THE DOCUMENT THIS ASIDE IS ABOUT (${where})\n\n` +
        `${input.segment.text.trim()}\n\n` +
        'Answer about this, and say so if the answer is not on it.',
    });
  }

  for (const w of store.whispers.forThread(input.threadId)) {
    const role_: LlmMessage['role'] = w.sender === 'student' ? 'user' : 'assistant';
    const last = turns[turns.length - 1];
    if (last && last.role === role_) last.content = `${last.content}\n\n${w.body}`;
    else turns.push({ role: role_, content: w.body });
  }

  return {
    model: input.speaker.model,
    max_tokens: input.maxTokens ?? 400,
    system,
    messages: turns,
    /**
     * **A private thread is a thread, and it is billed to one** (#42 item A).
     *
     * `anchorId` is the whisper thread's id, which is what `cost:summary` at thread level keys
     * on — so the footer on a `PrivateThread` card asks the same question, of the same column,
     * as the footer on the doc chat. Before this it was omitted and every whisper call landed in
     * the ledger with a null anchor: countable at file level, invisible at the level the learner
     * was looking at.
     *
     * `fileId` is deliberately *not* set: the ledger resolves it from `roomId`
     * (`CostLedger#fileFor`), and a second spelling of the same fact is a second thing to get
     * wrong. `turnId` is the caller's — `#whisper()` mints one per exchange, because a whisper
     * is not a `#runAgentTurn` turn and has no `PendingTurn` to borrow an id from.
     */
    meta: {
      scope: 'whisper',
      roomId: input.roomId,
      agentKey: input.speaker.key,
      anchorId: input.threadId,
    },
  };
}

function roleOf(agentKey: string | null | undefined): 'peer' | 'challenger' | 'tutee' | 'whisper' {
  if (!agentKey) return 'peer';
  const head = agentKey.split('.')[0];
  if (head === 'challenger' || head === 'tutee' || head === 'whisper') return head;
  return 'peer';
}
