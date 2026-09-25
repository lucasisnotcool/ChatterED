/**
 * The fixed Concept Pack for the **Critique 1 deck** — Lucas's own critique of Claude Code's
 * `/btw` side channel (`Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`).
 *
 * It exists because the A1 video is filmed on that deck (`flow-build-plan.md` §2, issue #32) and
 * the ledger needs claims that are *in the deck*. Every criterion below is traceable to a page:
 * the pages are named in `source` and in each element's comment, and nothing here is invented —
 * the deck is the arbiter, exactly as the slide is the arbiter for a crop.
 *
 * Schema: `progress-tracking.md` §3, the same one `psd-hessian-convexity-v1.ts` uses. Three
 * elements, because `flow.ts`'s `minTaught` is 2 and a third gives the Tester somewhere to go on
 * a second hand-off without the demo running out of material.
 */
import type { ConceptPack } from '../records.js';

export const BTW_SIDE_CHANNEL_V1: ConceptPack = {
  concept_id: 'btw-side-channel-v1',
  title: '/btw — whispering with your agent',
  source: 'CS3249 Critique 1 slides (Loh, 2026), pp. 1–7',
  target_level: 3,
  elements: [
    {
      // Pages 1–2 (the documentation quote and the goal) and page 5 (the limit tests table).
      id: 'C1',
      label: '/btw answers from main-session context only — no tools, no memory, and the exchange never enters the conversation history',
      learner_label: 'what /btw can and cannot do',
      criteria: {
        '1': 'States that /btw asks a side question without adding to the conversation history.',
        '2': 'Explains that its context is a strict subset of the main session: it can see the work in progress, and it has no tools and no memory of its own.',
        '3': 'Uses one of the deck\'s three limit tests as a case — the file it correctly declined to discuss, the mid-task test state it answered accurately, or the todo it claimed to write and did not.',
        '4': 'Separates "cannot act" from "claimed to have acted" under challenge, and says which of the three results is the bug and why memory being protected is the right outcome.',
      },
      misconceptions: [
        { id: 'M1a', text: 'Thinks /btw has tools of its own, or can change the main agent\'s memory or files.' },
        { id: 'M1b', text: 'Thinks the side question and its answer are added to the main conversation history.' },
      ],
      probe_seeds: {
        clarification: 'When you say /btw "sees" the session — sees what, exactly, and with what?',
        reasons_evidence: 'Which of the three limit tests on page 5 shows that, and what did it actually return?',
        assumptions: 'You are assuming the side channel is read-only. Which test on page 5 says so?',
        implications: 'If it has no memory, what happens to anything you decide inside /btw?',
        alternatives: 'Is there a way to get the same answer without a side channel, and what would it cost?',
      },
    },
    {
      // Pages 3–4: the whisper diagram, and Dennis et al. (2010) pp. 849–850 and 864–868.
      id: 'C2',
      label: 'The side channel is a silent whisper: interactive, polychronic and ephemeral, which buys participation, satisfaction, efficiency and politeness',
      learner_label: 'why whispering helps',
      criteria: {
        '1': 'States that asking in the main conversation may be disruptive, and that the side question avoids interrupting.',
        '2': 'Explains the mechanism with at least one of Dennis et al.\'s three properties — engage at any moment, hold a conversation in parallel, remarks stay tentative.',
        '3': 'Maps the human–human row of page 3 onto the human–AI row: the same catch, reached by a remark made at the side rather than in the main thread.',
        '4': 'Says which benefit is doing the work in a given case and what would be lost without the side channel — participation, satisfaction, efficiency, or politeness.',
      },
      misconceptions: [
        { id: 'M2a', text: 'Reduces the whisper to politeness, missing participation and parallelism.' },
        { id: 'M2b', text: 'Thinks the whisper is private *from the agent*; it is not — it reads the main session.' },
      ],
      probe_seeds: {
        clarification: 'Whispering to whom, in the bottom row of page 3?',
        reasons_evidence: 'Which of Dennis\'s three properties is the one your example needs?',
        assumptions: 'You are treating it as politeness. Is politeness the benefit that matters here?',
        implications: 'If the remark had gone into the main thread instead, what would it have cost?',
        alternatives: 'A meeting has a chat panel and a hand-raise. Which one is /btw?',
      },
    },
    {
      // Pages 6–7: "Gap: discussion and decisions in btw cannot be forwarded to agent", and the
      // proposed feature — the agent offers to relay decision points back through steering.
      id: 'C3',
      label: 'The gap: nothing decided inside /btw can be forwarded to the main agent — the user must re-parse the side conversation into a steering prompt',
      learner_label: 'the forwarding gap',
      criteria: {
        '1': 'States that a decision reached in /btw does not reach the main agent by itself.',
        '2': 'Explains the cost the deck names: the user has to parse the side conversation into a steering prompt, on top of having already said it once.',
        '3': 'Describes the proposed fix concretely — the agent offers to relay the decision points, and the user approves the relay.',
        '4': 'Argues why the fix is a relay the user approves rather than giving /btw tools or memory, and names what that relies on (agents being directive and clear with each other).',
      },
      misconceptions: [
        { id: 'M3a', text: 'Thinks the fix is to give /btw tools or memory rather than a user-approved relay.' },
        { id: 'M3b', text: 'Assumes the main agent already acts on what was decided in the side channel.' },
      ],
      probe_seeds: {
        clarification: 'What exactly is it that cannot be forwarded — the answer, or the decision?',
        reasons_evidence: 'Page 6 has a worked case of the gap. Which one, and what went wrong?',
        assumptions: 'You are assuming the main agent can see what you settled in /btw. Can it?',
        implications: 'If the relay existed, what would the user still have to do?',
        alternatives: 'Why not just give /btw write access and be done with it?',
      },
    },
  ],
};

/**
 * The deck, as the flow sees it, page by page — the extracted text of each page, trimmed to what
 * a crop of that page actually carries. Used as the material's `extracted_text` in the demo and
 * as the segment text handed to the REFERENCE scope, so that what the voice is given is the same
 * text the learner is looking at.
 *
 * Lifted from `pdftotext -layout` over the committed PDF. It is **the deck's own words**: the
 * script is Lucas's critique replayed, not a story written around it. The author line on page 1
 * is redacted to `[author]` because this string ships in the app.
 */
export const CRITIQUE1_PAGE_TEXT: Record<number, string> = {
  1: '/btw — Whispering with your agent. Collaborating with an agent, behind its back. Text-based · Task-oriented · Agentic. [author]. CS3249 / AY2627 S1 / Critique 1.',
  2:
    'Official Docs. "Use /btw to ask a question about your current work without adding to the conversation history." — Claude Code documentation, ‘Side questions with /btw’ (accessed 31 Aug 2026). ' +
    'Goal: 1. Help users understand what the agent is doing, 2. without interrupting it, or affecting main session context. ' +
    'Normal coding agents: prompt → agent takeover → steer → agent takeover → prompt fork. /btw question → agent answer: Claude Code responds based on main session context only (no tools / memory).',
  3:
    '/btw as a whisper. HUMAN–HUMAN COLLABORATION: "Is there something wrong with the slide?" → "Sorry, I think there\'s something wrong.." → "Oh! Thanks for the catch!"; aside: "Yeah, I cannot see the screen too!". ' +
    'HUMAN–AI COLLABORATION: "/btw is this a safe way to code.." *Coding...* → "Sorry, I think there\'s something wrong.." → "Oh! Thanks for the catch!"; btw: "Oops, this will expose data..".',
  4:
    '/btw vs. texting in a meeting (or, students chatting while the lecturer is talking). Asking in main conversation may be disruptive. Agent did not need interjection; user was able to receive clarification. ' +
    'Silent Whispering (Dennis et al., 2010), instant messaging at a meeting (pp. 849–850): 1. Interactivity — able to engage at any moment; 2. Polychronic — hold conversation in parallel; 3. Ephemeral — remarks are tentative. ' +
    'Benefits (pp. 864–868): 1. Participation — members unable to get air time can engage at the sidelines; 2. Satisfaction — able to seek clarification and contribute remarks; 3. Efficiency — steps and decisions made in parallel within the meeting; 4. Politeness — avoid "rude" interruption.',
  5:
    'Limit Tests of /btw show it adheres to Claude Code\'s specs. General coding task · asked about a file never opened in the main task → correctly declined to answer, cited not opened → context is a strict subset of the main session → /btw is a strictly tool-less version of the agent. ' +
    'Run tests, modify code, run tests again · asked whether tests passed mid-task → correctly answered, and also pointed out changes in progress, tests pending → tool-call level understanding of the agent\'s work → live view into the agent\'s tool calls and reasoning. ' +
    'General coding task · asked to add a todo to memory → claimed to do so (inaccurate) — bug → did not actually do so, memory protected → /btw has no memory, cannot affect the main agent. Tested model: Claude Sonnet 5.',
  6:
    '/btw removes context penalty, encourages user participation. NORMAL STEERING — CLUTTERS CONTEXT: "why can\'t we.." during coding → "We can, but it contradicts your earlier decision.." → "Nevermind." — steering pollutes context. ' +
    'REDUCED RISK FOR CONTEXT CLUTTERING: "/btw why can\'t we.." → btw: "We can, but it contradicts your earlier decision.." → "Ohh ok thanks", while the agent keeps coding. ' +
    'Gap: discussion and decisions in btw cannot be forwarded to agent. Agent falsely claims it has done things it cannot. User needs to parse the conversation into a steering prompt.',
  7:
    'From silent whispering to speaking up at meeting. Feature: allow /btw to communicate back to the main agent through steering. User as Director: prompt → agent takeover → steer → agent takeover → prompt. ' +
    'User as Directed: /btw question → agent answer → ask to steer → agent summary of conversation. The agent offers to relay decision points / user directives back to the main agent. ' +
    '1. Allows the user to explore and ask questions with minimal cost to main context; 2. Reduces the cost to steer when the user has already communicated to the CUI on /btw; 3. /btw serves as a hygiene layer in behaviour and communication; 4. Relies on agents being directive and clear when communicating with each other.',
};

/** The whole deck as one block, for the material row the demo session is created with. */
export const CRITIQUE1_DECK_TEXT = Object.entries(CRITIQUE1_PAGE_TEXT)
  .map(([page, text]) => `p. ${page}\n${text}`)
  .join('\n\n');
