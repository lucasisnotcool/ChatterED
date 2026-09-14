/**
 * The agent roster.
 *
 * Ellie and Max are the standing pair — one female-coded, one male-coded — and the
 * **role–name pairing is randomised at install** and recorded in every log envelope, so the
 * study cannot confound role with gender (product-design.md §C2, Song et al. §3.2).
 * Theo is the Tutee and is invited only, at the end of a round; he never co-occurs with them.
 */
import type { AgentProfile, AgentRole, RolePairing } from '../shared/types.js';
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

/** Max *thinks*; everyone else *types*. The verb does the persona work for free (§C3). */
const VERB: Record<AgentRole, 'thinking' | 'typing'> = {
  challenger: 'thinking',
  peer: 'typing',
  tutee: 'typing',
  whisper: 'typing',
};

export const ROLE_LABEL: Record<AgentRole, string> = {
  peer: 'peer',
  challenger: 'challenger',
  tutee: 'first year',
  whisper: 'peer',
};

/**
 * `agentModel` is the resolved id for **agent turns** — Haiku 4.5 on the API path, the
 * learner's Settings choice (default `sonnet`) on the local-CLI path. The orchestrator and
 * ledger model is not here: those calls are not made *as* an agent.
 */
export function rosterFor(pairing: RolePairing, agentModel: string = HAIKU): AgentProfile[] {
  const peerName = pairing === 'ellie_peer' ? 'Ellie' : 'Max';
  const challengerName = pairing === 'ellie_peer' ? 'Max' : 'Ellie';
  return [
    profile('peer', peerName, agentModel),
    profile('challenger', challengerName, agentModel),
    profile('tutee', 'Theo', agentModel),
  ];
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

export function randomPairing(rand: () => number = Math.random): RolePairing {
  return rand() < 0.5 ? 'ellie_peer' : 'ellie_challenger';
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
