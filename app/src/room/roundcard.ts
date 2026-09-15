/**
 * The round card — the first thing a learner reads in the room (product-design.md §B3, §C1).
 *
 * It used to be `SCRIPT_ROUND_CARD`, unconditionally, in every session: a room opened on
 * pedagogical agent roles and announced *"Your slide: convexity and the Hessian."* The UX review
 * caught it as blocker B4, and it is the kind of defect that only shows up on camera, because
 * the demo session is the one it happens to be right for.
 *
 * So: built from the live Concept Pack and the live roster, and the scripted card is used only
 * in scripted mode, where it *is* the live pack.
 */
import type { AgentProfile } from '../shared/types.js';
import type { ConceptPack } from './records.js';
import { SCRIPT_ROUND_CARD } from './llm/script.psd-hessian.js';

export interface RoundCard {
  title: string;
  body: string;
}

/**
 * "Ellie and Max" — the two agents who are actually in the room. Theo is never named here: he
 * is invited at the end of a round and never co-occurs with them (agents.ts, §P2).
 */
export function roomMates(roster: readonly AgentProfile[]): string {
  const names = roster
    .filter((a) => a.role === 'peer' || a.role === 'challenger')
    .map((a) => a.displayName);
  if (names.length === 0) return 'the group';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Trim a concept title so it reads inside a sentence rather than ending it twice. */
export function titlePhrase(title: string): string {
  return title.trim().replace(/[.\s]+$/, '');
}

export function roundCardFor(input: {
  pack: ConceptPack;
  roster: readonly AgentProfile[];
  mode: 'scripted' | 'live';
  round?: number;
}): RoundCard {
  // In scripted mode the fixed pack *is* the session, so the hand-written card is the honest
  // one — it carries the same house rules in the same order.
  if (input.mode === 'scripted') return { ...SCRIPT_ROUND_CARD };
  const subject = titlePhrase(input.pack.title) || 'your slide';
  return {
    title: `Round ${input.round ?? 1} · Explain`,
    body:
      `Your slide: ${subject}. You'll explain it to ${roomMates(input.roster)}. ` +
      "House rules: they won't answer for you, they'll disagree with each other sometimes, and " +
      'replies here are deliberately paced so you get room to think first. You can whisper to ' +
      'either of them privately. You have the last word.',
  };
}
