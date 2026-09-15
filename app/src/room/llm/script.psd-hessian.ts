/**
 * The scripted session — design-brief.md §G, all eleven turns, as data.
 *
 * This is milestone M4b, the non-negotiable fallback: "a scripted transcript player that
 * replays a hand-written ideal session with correct timings and a live-looking ledger rail…
 * if the API misbehaves on recording day the video still happens" (architecture-mac.md §H.2).
 *
 * It is consumed by `ScriptedClient`, which is a fake **LLM**, not a fake app: the room actor,
 * the orchestrator gates, the latency buffer, the silence timer, the ledger's four hard rules
 * and the whisper scoping all run for real against it. That is what makes the scripted demo an
 * honest demonstration of the interaction rather than a video of a slideshow.
 *
 * Cues are deterministic: 'open', 'student:N', 'silence:N', 'whisper:N', and — since the
 * Teacher + Tester reframe (#32) — 'handoff:N' for the Tester's quiz, 'feedback:N' for the
 * feedback turn it owes afterwards (flow-session.md §8.3, Rowland 2014), and 'reference:N' for
 * a REFERENCE answer, which is not an agent turn at all (pivot-spec.md §B1).
 */
import type { AgentRole } from '../../shared/types.js';

export interface ScriptedDecision {
  /** null = deliberate silence: the room says nothing and lets the timer do its work. */
  role: AgentRole | null;
  move: string;
  probeType?: string;
  targetElementId?: string;
  /** Every element this probe puts under test — what gates the `defended` state. */
  challenges?: string[];
  rationale: string;
}

export interface ScriptedLedgerElement {
  id: string;
  level: number;
  confidence: number;
  /** 'last_student' quotes the learner verbatim, which is what rule 1 requires. */
  evidence: 'last_student' | 'none';
  misconceptions_present?: string[];
  misconceptions_resolved?: string[];
}

export interface ScriptedBeat {
  cue: string;
  decision: ScriptedDecision;
  /** The agent's message, if one is spoken. */
  text?: string;
  /** Which segment of the document this beat happens on (flow-build-plan.md §4.4). */
  segment?: string;
  disagreement?: { marker: 'pushes back on' | "isn't sure about" | 'sides with you against'; targetRole: AgentRole };
  ledger?: {
    elements: ScriptedLedgerElement[];
    suggestedTargetElement?: string;
    suggestedProbeType?: string;
    notesForAgents?: string;
  };
}

export interface ScriptedWhisperBeat {
  cue: string;
  text: string;
  relayOffer?: { draftText: string; defaultAttribution: 'as_me' | 'as_agent' };
}

/**
 * A REFERENCE answer, replayed. It is **not an agent turn** and carries no decision: it never
 * takes the floor, never counts toward anything and can never move the ledger (§B1). The
 * 120-word cap is applied in `reference.ts`, in code, so a script that overruns is truncated
 * exactly as a real answer would be — the script cannot smuggle a longer answer onto camera.
 */
export interface ScriptedReferenceBeat {
  cue: string;
  segment?: string;
  text: string;
}

/**
 * What a script is, as a shape. `script.critique1.ts` implements the same three lookups over the
 * Critique 1 deck and is dropped into `ScriptedClient` without editing it.
 */
export interface ScriptSource {
  /**
   * The Concept Pack this script's element ids belong to. It is stamped on the ledger proposal,
   * so a script over a different deck cannot quietly file its rows under another concept.
   * Optional for the original script, which predates the second one.
   */
  conceptId?: string;
  beatFor(cue: string): ScriptedBeat | undefined;
  whisperBeatFor(cue: string): ScriptedWhisperBeat | undefined;
  referenceBeatFor(cue: string): ScriptedReferenceBeat | undefined;
}

/** Turn 1 — the Peer's opener (Xu et al. §4.1). */
export const SCRIPT_BEATS: ScriptedBeat[] = [
  {
    cue: 'open',
    decision: { role: 'peer', move: 'opener', rationale: 'Open the round; the learner speaks first after this.' },
    text: "I'm curious how you'd set this one up — what's your first move when you see \"convex\" and \"Hessian\" in the same sentence?",
  },
  {
    // Turn 2 is the learner's. Turn 3 is Max, held 9–12 s, probing assumptions.
    cue: 'student:1',
    decision: {
      role: 'challenger',
      move: 'probing_assumptions',
      probeType: 'assumptions',
      targetElementId: 'R1',
      challenges: ['R1', 'R2'],
      rationale: 'R1 is stated but not justified, and the sentence is missing its quantifier.',
    },
    text:
      "You might not like this next question, and that's fine — I'm testing the statement, not you. " +
      'You said "if the Hessian is PSD then f is convex". PSD **where**? Your sentence works for a single point; ' +
      'the slide says something about a set. Does the point-version survive?',
    ledger: {
      elements: [{ id: 'R1', level: 1, confidence: 0.88, evidence: 'last_student' }],
      suggestedTargetElement: 'R1',
      suggestedProbeType: 'assumptions',
      notesForAgents: 'Asserted the second-order condition without a quantifier or a domain.',
    },
  },
  {
    // Turn 4 is the learner's. Nothing is said after it: the room yields the floor and the
    // silence timer takes over, which is the beat the video is built around.
    cue: 'student:2',
    decision: { role: null, move: 'yield', rationale: 'Give the learner room; a nudge is the timer\'s job, not an agent\'s.' },
    ledger: {
      elements: [
        { id: 'R3', level: 0, confidence: 0.9, evidence: 'none', misconceptions_present: ['M3a'] },
      ],
      suggestedTargetElement: 'R3',
      suggestedProbeType: 'implications',
      notesForAgents: 'Conflating the convexity test with the second-order optimality condition at a stationary point.',
    },
  },
  {
    // Turn 5 — stage 1. Content-free by construction: it adds no mathematics.
    cue: 'silence:1',
    decision: { role: 'peer', move: 'content_free_nudge', rationale: '45 s with no keystrokes; stage 1.' },
    text: 'Still turning it over? Happy to wait. Or I can make the question smaller if that helps.',
  },
  {
    // Turn 5b — stage 2, if the quiet continues. Hedged, partial, correctable; never complete.
    cue: 'silence:2',
    decision: {
      role: 'peer',
      move: 'incomplete_scaffold',
      targetElementId: 'R3',
      rationale: '90 s cumulative idle; stage 2 offers a starting point, not an answer.',
    },
    text:
      "Here's a half-thought you can knock down: I *think* the condition has to hold across the whole set, " +
      'not just where you checked it — but I might be confusing that with the minimum test. What do you reckon?',
  },
  {
    // Turn 7 is the learner's self-correction. Turn 8 is Max, probing implications.
    cue: 'student:3',
    decision: {
      role: 'challenger',
      move: 'probing_implications',
      probeType: 'implications',
      targetElementId: 'R3',
      challenges: ['R3', 'R1'],
      rationale: 'The quantifier moved; make it bite with a concrete case.',
    },
    text:
      'Good — you moved the quantifier. Now make it bite. Give me a function on ℝ where the Hessian is PSD at ' +
      'one specific point and the function is **not** convex on any neighbourhood of that point. If no such ' +
      'function exists, your original sentence was fine after all.',
    ledger: {
      elements: [
        { id: 'R2', level: 2, confidence: 0.92, evidence: 'last_student', misconceptions_resolved: ['M2a'] },
        { id: 'R3', level: 2, confidence: 0.86, evidence: 'last_student', misconceptions_resolved: ['M3a'] },
      ],
      suggestedTargetElement: 'R3',
      suggestedProbeType: 'implications',
      notesForAgents: 'Self-corrected: definition given, quantifier moved from a point to the set.',
    },
  },
  {
    // Turn 9 is the learner's x³ counterexample. Turn 10 is Ellie's mandated disagreement (S2).
    cue: 'student:4',
    decision: {
      role: 'peer',
      move: 'teach_from_slide',
      targetElementId: 'R1',
      // Was the S2 quota's mandated-disagreement beat. The quota went with the social-group
      // framing (#32); the turn stays because what it actually does is *teach*, which is the
      // Teacher's job now, and it keeps the hedged-uncertainty safeguard S4 on camera.
      rationale: 'The Teacher explains why the distinction matters and flags her own uncertainty (S4).',
    },
    text:
      "Worth saying why that distinction matters — in most tutorial problems S is all of ℝⁿ and it never shows " +
      'up, which is exactly why it bites when it does. ' +
      "I'm also not fully certain whether openness of S is doing real work or just keeping the derivative " +
      'well-defined at the boundary — worth checking against your slide rather than taking my word for it.',
    ledger: {
      elements: [
        { id: 'R3', level: 4, confidence: 0.94, evidence: 'last_student' },
        { id: 'R1', level: 3, confidence: 0.9, evidence: 'last_student' },
      ],
      suggestedTargetElement: 'R2',
      suggestedProbeType: 'clarification',
      notesForAgents: 'Counterexample supplied under challenge; domain conditions now explicit.',
    },
  },
  {
    // Turn 11 — the learner closes the round. No agent is allowed to summarise the conclusion.
    cue: 'student:5',
    decision: { role: null, move: 'yield', rationale: 'Turn rule 5: the learner has the last word.' },
    ledger: {
      elements: [
        { id: 'R1', level: 4, confidence: 0.93, evidence: 'last_student' },
        { id: 'R2', level: 3, confidence: 0.93, evidence: 'last_student' },
      ],
      notesForAgents: 'Full restatement with quantifier, definition and domain conditions.',
    },
  },
];

/**
 * The hand-off pair. `handoff:N` is Max's question; `feedback:N` is the turn he **owes** after
 * the learner answers it — mandatory, not optional (flow-session.md §8.3: Rowland 2014's
 * meta-analysis gives g = 0.73 for retrieval practice with feedback against 0.39 without).
 *
 * Ellie's hand-off *line* is deliberately not here: it is written by `flow.handOffLine()` and
 * posted by the actor, so that what the camera sees is the rule firing, not a scripted sentence.
 */
export const SCRIPT_HANDOFFS: ScriptedBeat[] = [
  {
    cue: 'handoff:1',
    decision: {
      role: 'challenger',
      move: 'quiz',
      probeType: 'reasons_evidence',
      targetElementId: 'R1',
      challenges: ['R1'],
      rationale: 'The flow rule fired; the Tester asks the learner to apply what was just taught.',
    },
    text:
      "Alright — one question, and take your time with it. Ellie showed you that PSD is about zᵀHz, not the " +
      'entries. So: give me a matrix whose entries are all positive that is **not** PSD, and say how you know.',
  },
  {
    cue: 'feedback:1',
    decision: {
      role: 'challenger',
      move: 'quiz_feedback',
      targetElementId: 'R1',
      challenges: ['R1'],
      rationale: 'Feedback is required after every quiz answer, before anything else.',
    },
    text:
      "That's right, and the reason it's right is the part worth keeping: you picked a z that made the cross " +
      'terms dominate, rather than checking entries. The one thing you left out was saying which set the ' +
      'condition has to hold on — you said "it fails", not "it fails for this z".',
  },
];

export const SCRIPT_REFERENCES: ScriptedReferenceBeat[] = [
  {
    cue: 'reference:1',
    text:
      'A symmetric matrix H is positive semidefinite when zᵀHz ≥ 0 for every vector z. It is not a statement ' +
      'about the entries of H: a matrix of positive entries can fail the condition, and a matrix with negative ' +
      'entries can satisfy it. For a twice-differentiable f on an open convex set S, convexity on S is ' +
      'equivalent to ∇²f(x) being positive semidefinite at every x in S — the quantifier over S is part of the ' +
      'statement, not a detail of it.',
  },
];

export const SCRIPT_WHISPERS: ScriptedWhisperBeat[] = [
  {
    cue: 'whisper:1',
    text:
      "Not embarrassing, and quick answer: no. Two things first — I can see the group chat and I can explain " +
      "background bits, but I won't answer Max's question for you, and nothing here reaches him unless you send it.\n\n" +
      'On the maths: try **A = [[1, 2], [2, 1]]**. Every entry is positive. Take z = (1, −1)ᵀ: ' +
      "zᵀAz = 1 − 2 − 2 + 1 = **−2**. So entrywise-positive doesn't get you PSD. The actual definition is about " +
      'zᵀHz for *every* z. What that means for your R1 claim is still yours to work out.',
    relayOffer: {
      draftText:
        'Can we pin the definition down before we go further? I want to be sure I\'ve got it: is "PSD" a statement ' +
        'about the entries of the matrix, or about something else entirely?',
      defaultAttribution: 'as_agent',
    },
  },
  {
    cue: 'whisper:2',
    text:
      "Still read-only over here, so this stays between us. Say that version out loud in the group — it's the part " +
      "Max is actually pushing on, and it'll land better from you than from me.",
  },
];

/**
 * The card the sitting opens with (design-brief.md §G).
 *
 * The group framing is out (#32): no "the group", no cast, no "they'll disagree with each other".
 * The **pacing disclosure** is the one line that must survive every rewrite of this card —
 * undisclosed pacing is performative deliberation (flow-build-plan.md §4.5).
 */
export const SCRIPT_ROUND_CARD = {
  title: 'Explain',
  body:
    'Your slide: convexity and the Hessian. Ellie teaches from it; Max tests you on what she has covered, once ' +
    "you've been at it long enough for that to be worth doing. Replies here are deliberately paced so you get " +
    'room to think first. You can ask Ellie privately at any point. You have the last word.',
};

export function beatFor(cue: string): ScriptedBeat | undefined {
  return SCRIPT_BEATS.find((b) => b.cue === cue) ?? SCRIPT_HANDOFFS.find((b) => b.cue === cue);
}

export function referenceBeatFor(cue: string): ScriptedReferenceBeat | undefined {
  return SCRIPT_REFERENCES.find((b) => b.cue === cue) ?? SCRIPT_REFERENCES[0];
}

export function whisperBeatFor(cue: string): ScriptedWhisperBeat | undefined {
  return SCRIPT_WHISPERS.find((b) => b.cue === cue) ?? SCRIPT_WHISPERS.at(-1);
}
