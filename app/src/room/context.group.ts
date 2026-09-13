/**
 * GROUP-scope prompt assembly.
 *
 * The invariant (architecture-mac.md §C.1 property 1, §D.4): **no code path that assembles a
 * group-scope prompt has read the whispers table.** This module is the enforcement point, and
 * it is enforced three ways:
 *   1. it takes a `GroupStore`, a store view with no `whispers` member at all;
 *   2. it imports nothing that can reach the whispers repository (ESLint + the import-graph
 *      assertion in context.test.ts);
 *   3. the canary test asserts a whisper-only string never appears in its output.
 *
 * The relay is not an exception. A promoted whisper becomes a *new row in `messages`*, authored
 * and approved by the student, and this builder reads it from there like any other message.
 */
import type { AgentProfile } from '../shared/types.js';
import { ROLE_LABEL } from './agents.js';
import type { GroupStore } from './ports.js';
import type { ConceptPack } from './records.js';
import { roleBlock, sharedBlock, turnDirective, type TurnDirective } from './prompts.js';
import type { CacheableBlock, LlmMessage, LlmRequest } from './llm/types.js';

export interface GroupContextInput {
  roomId: string;
  /** The agent about to speak. Its own past messages become `assistant` turns. */
  speaker: AgentProfile;
  roster: AgentProfile[];
  pack: ConceptPack;
  directive: TurnDirective;
  maxTokens?: number;
}

export function buildGroupContext(store: GroupStore, input: GroupContextInput): LlmRequest {
  const room = store.rooms.get(input.roomId);
  if (!room) throw new Error(`No such room: ${input.roomId}`);
  const material = store.materials.get(room.material_id);
  if (!material) throw new Error(`No material for room ${input.roomId}`);

  const shared = sharedBlock({ material, pack: input.pack, topic: room.topic, roster: input.roster });
  const other = input.roster.find((a) => a.role !== input.speaker.role && a.role !== 'tutee');
  const role = roleBlock(input.speaker.role, input.speaker, other);

  // Breakpoint 1 after the shared block (byte-identical for every agent, so the second caller
  // reads the first caller's entry). Breakpoint 2 after the role block.
  const system: CacheableBlock[] = [
    { type: 'text', text: shared, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: role, cache_control: { type: 'ephemeral' } },
  ];

  const participants = new Map(store.participants.forRoom(input.roomId).map((p) => [p.id, p]));
  const transcript = store.messages.forRoom(input.roomId);

  const turns: LlmMessage[] = [];
  for (const m of transcript) {
    const p = participants.get(m.participant_id);
    const mine = p?.agent_key === input.speaker.key;
    const label =
      p?.kind === 'student'
        ? 'Student'
        : `${p?.display_name ?? 'Agent'} (${ROLE_LABEL[roleOf(p?.agent_key)] ?? 'agent'})`;
    const content = mine ? m.body : `${label}: ${m.body}`;
    const role_: LlmMessage['role'] = mine ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role_) last.content = `${last.content}\n\n${content}`;
    else turns.push({ role: role_, content });
  }

  // The turn directive is the only volatile part, so it goes AFTER every breakpoint
  // (architecture-options.md §C.5 rule 2).
  const directive = turnDirective(input.directive);
  const last = turns[turns.length - 1];
  if (last && last.role === 'user') last.content = `${last.content}\n\n[${directive}]`;
  else turns.push({ role: 'user', content: `[${directive}]` });

  return {
    model: input.speaker.model,
    max_tokens: input.maxTokens ?? 400,
    system,
    messages: turns,
    meta: { scope: 'group', roomId: input.roomId, agentKey: input.speaker.key },
  };
}

function roleOf(agentKey: string | null | undefined): 'peer' | 'challenger' | 'tutee' | 'whisper' {
  if (!agentKey) return 'peer';
  const head = agentKey.split('.')[0];
  if (head === 'challenger' || head === 'tutee' || head === 'whisper') return head;
  return 'peer';
}
