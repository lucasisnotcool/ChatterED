/**
 * The agent roster — **Ellie the Teacher and Max the Tester** (#32).
 *
 * **The pairing is pinned: Ellie is the Teacher, Max is the Tester** (#32, and the decision
 * recorded on it). It used to be *randomised at install* so that a between-subjects study could
 * not confound role with gender (product-design.md §C2, Song et al. §3.2) — that was a control
 * for the **group framing**, and the group framing is gone (`masg-drop-assessment.md` Option 2).
 * What is left is a two-agent flow whose copy names its agents out loud: the hand-off line, the
 * Critique 1 script and the video's own narration all say *Ellie teaches, Max tests*. A coin
 * flip at install made half of all installs read `MAX · TEACHER` under an *"Ellie, over to you"*
 * hand-off, which is what a live run on 16 Sep actually showed. Deterministic wins.
 *
 * Old installs correct themselves: `AppService.pairing()` rewrites a stored `ellie_challenger`
 * to `PINNED_PAIRING` on the next launch. That is safe because **the names are not in any frozen
 * prefix** — `sharedBlock()` dropped the cast list with the group framing, so `prefix_sha256`
 * does not depend on them — and a historical room keeps the names it was played with anyway:
 * its `participants.display_name` is stored per room, and `views.messageView()` falls back to it
 * for an `agent_key` the current roster no longer contains.
 *
 * **Theo has left the standing roster.** A teach-back *is* a quiz, so the Tutee's round folded
 * into the Tester's question (#32, flow-build-plan.md §4.2) and a third agent is not built for
 * A1. His profile and role block stay so that a historical transcript still renders his turns,
 * but `rosterFor()` no longer returns him and nothing can select him.
 *
 * **The stored role strings are deliberately NOT renamed.** `agents.role` and the
 * `DECISION_SCHEMA` keep `'peer'` and `'challenger'`; only `ROLE_LABEL` and the prompt text say
 * teacher and tester. Renaming them would need a migration, would touch every historical room,
 * and would move every frozen `prefix_sha256` for no learner-visible gain — the same call
 * already made for `rooms.module_code`. `ROLE_LABEL` is the one mapping function; read it rather
 * than spelling the display name out again anywhere else.
 */
import type { AgentProfile, AgentRole, AgentVerb, RolePairing } from '../shared/types.js';
import { HAIKU_API, SONNET_API } from './llm/models.js';

/**
 * Kept as named exports because the rest of the app spells the API-path defaults this way.
 * The per-role choice itself now lives in `llm/models.ts` (issue #19): which model an agent
 * runs on is a setting, and `rosterFor` takes it.
 */
export const HAIKU = HAIKU_API;
export const SONNET = SONNET_API;

/** Hue is never the only cue — see the redundant channels in product-design.md §C1. */
export const ROLE_COLOUR: Record<AgentRole, string> = {
  peer: '#0F7B6C',
  challenger: '#B45309',
  tutee: '#7C3AED',
  whisper: '#0F7B6C',
};

/**
 * Latency bands (design-brief.md §D4, product-design.md §C3). These are a **floor on visible
 * time-to-first-token, not an added delay**: generation starts immediately and the reply is
 * buffered until the floor is reached.
 */
export const LATENCY: Record<AgentRole, { ttftMinMs: number; ttftMaxMs: number }> = {
  challenger: { ttftMinMs: 9000, ttftMaxMs: 12000 },
  peer: { ttftMinMs: 4000, ttftMaxMs: 6000 },
  tutee: { ttftMinMs: 2000, ttftMaxMs: 3000 },
  whisper: { ttftMinMs: 1000, ttftMaxMs: 2000 },
};

/**
 * Max *reads*; everyone else *types*. The verb does the persona work for free (§C3), and which
 * verb is not cosmetic: `pivot-spec.md` §B9 and §2 beat 11 both say the chip on a held Tester
 * turn reads **`Max is reading…`** — *"what Max is doing first is reading your region"* — which is
 * the retrieval framing the hand-off is about. The app said `Max is thinking…`, which is the
 * generic LLM-wait verb and claims a mental state instead of naming an act. §4.2 of the build plan
 * said `VERB` was unchanged **and** that Max "still reads"; the code was the half that was wrong.
 *
 * Ellie is untouched: §B9 is equally explicit that *"Ellie types"*, and a Teacher composing an
 * explanation is typing one.
 */
const VERB: Record<AgentRole, AgentVerb> = {
  challenger: 'reading',
  peer: 'typing',
  tutee: 'typing',
  whisper: 'typing',
};

/** The display layer, and the only place `'peer' | 'challenger'` becomes teacher/tester. */
export const ROLE_LABEL: Record<AgentRole, string> = {
  peer: 'teacher',
  challenger: 'tester',
  tutee: 'first year',
  whisper: 'teacher',
};

/** The two agents the learner actually talks to. Theo and the whisper alias are not among them. */
export function isStandingAgent(role: AgentRole): boolean {
  return role === 'peer' || role === 'challenger';
}

/** "The other one" — the standing agent that is not the speaker. */
export function otherStandingAgent(
  roster: readonly AgentProfile[],
  self: AgentProfile,
): AgentProfile | undefined {
  return roster.find((a) => a.key !== self.key && isStandingAgent(a.role));
}

/**
 * `agentModel` is the resolved id for **agent turns** — Haiku 4.5 on the API path, the
 * learner's Settings choice (default `sonnet`) on the local-CLI path. The orchestrator and
 * ledger model is not here: those calls are not made *as* an agent.
 */
export function rosterFor(pairing: RolePairing = PINNED_PAIRING, agentModel: string = HAIKU): AgentProfile[] {
  // The parameter survives so a historical room can still be rendered with the pairing it was
  // played on; nothing in the running app passes anything but `PINNED_PAIRING`.
  const peerName = pairing === 'ellie_peer' ? 'Ellie' : 'Max';
  const challengerName = pairing === 'ellie_peer' ? 'Max' : 'Ellie';
  return [profile('peer', peerName, agentModel), profile('challenger', challengerName, agentModel)];
}

export function profile(role: AgentRole, displayName: string, model: string = HAIKU): AgentProfile {
  return {
    key: `${role}.${displayName.toLowerCase()}`,
    role,
    displayName,
    colour: ROLE_COLOUR[role],
    verb: VERB[role],
    model,
    latency: LATENCY[role],
  };
}

/**
 * The one pairing this app ships. `'ellie_peer'` reads as *"Ellie is the Teacher"*; the stored
 * string is unchanged so no setting, log envelope or historical row has to be rewritten.
 */
export const PINNED_PAIRING: RolePairing = 'ellie_peer';

/** The Teacher's name, off the live roster. Never spelled out in copy — see `fillAgentNames`. */
export function teacherName(roster: readonly AgentProfile[]): string {
  return roster.find((a) => a.role === 'peer')?.displayName ?? 'Ellie';
}

/** The Tester's name, off the live roster. */
export function testerName(roster: readonly AgentProfile[]): string {
  return roster.find((a) => a.role === 'challenger')?.displayName ?? 'Max';
}

/**
 * Fill `{teacher}` / `{tester}` from the live roster.
 *
 * Written copy that has to name an agent — the Critique 1 script's Tester question, its whisper
 * replies — uses the tokens instead of a literal, so a swapped or renamed roster can never put
 * *"Ellie had you on page 6"* in Ellie's own mouth. The hand-off line takes the names as
 * arguments instead (`flow.handOffLine()`); this is for text that is written ahead of time.
 */
export function fillAgentNames(text: string, roster: readonly AgentProfile[]): string {
  return text
    .replaceAll('{teacher}', teacherName(roster))
    .replaceAll('{tester}', testerName(roster));
}

export function agentByRole(roster: AgentProfile[], role: AgentRole): AgentProfile {
  const found = roster.find((a) => a.role === role);
  if (!found) throw new Error(`No agent for role ${role}`);
  return found;
}

export function agentByKey(roster: AgentProfile[], key: string): AgentProfile | undefined {
  return roster.find((a) => a.key === key);
}

/**
 * Pick this turn's latency floor inside the role's band, scaled by the learner's Reply speed
 * setting (Quick ×0.4 / Considered ×1 / Slow ×1.6 — product-design.md §C3).
 */
export function latencyTargetMs(
  agent: AgentProfile,
  scale = 1,
  rand: () => number = Math.random,
): number {
  const { ttftMinMs, ttftMaxMs } = agent.latency;
  return Math.round((ttftMinMs + rand() * (ttftMaxMs - ttftMinMs)) * scale);
}
