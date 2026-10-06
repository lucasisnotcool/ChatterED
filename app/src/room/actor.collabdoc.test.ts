/**
 * **The collab-doc loop, through the actor** (#48, `docs/research/collab-doc.md` §4–§6).
 *
 * `orchestrator.test.ts` proves the rules and `pitch.test.ts` proves the pitch; this proves the
 * wiring neither of them can see — that Ellie's answer really is followed by one Max question and
 * only one, that the cue fires once and records what it reported about itself, that the resolving
 * turn is *asked* to correct her mistake, that a release fills nothing, that closure pays the debt
 * rather than dropping it, and that the doc edits go out as `doc.edit` batches addressed to block
 * ids.
 *
 * It runs on `script.notes.ts` through the real `ScriptedClient`, so the rules, the thread
 * registry, the latency floor, the timer and the doc-edit call all run for real. No network, as
 * everywhere else in this repo.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import type { AgentDocOpBatch, OutlineEntry, ProgressView, QuizOutcome } from '../shared/doc/types.js';
import { progressFill } from '../shared/doc/progress.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor, parseCue, type RoomActorDeps } from './actor.js';
import type { DocPort } from './docport.js';
import { ScriptedClient } from './llm/scripted.js';
import { NOTES_SCRIPT } from './llm/script.notes.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';
import { DEMO, FLOW, openSession, type TaughtItem } from './flow.js';

const DOC = 'doc';
const SPAN = 'span_0123456789ab';
const ELEMENT = PSD_HESSIAN_CONVEXITY_V1.elements[0]!.id;

/**
 * A `DocPort` that is a document rather than a stub: it records what was written to it, so a test
 * can assert on the batch the actor produced without a ProseMirror view anywhere near it.
 */
function docPort(over: Partial<DocPort> = {}) {
  const edits: { batch: AgentDocOpBatch; objectiveId: string | null }[] = [];
  const outcomes: Omit<QuizOutcome, 'id' | 'contentSha' | 'createdAt'>[] = [];
  const outline: OutlineEntry[] = [
    { blockId: 'b_aaa', kind: 'heading', path: [], text: 'The side channel', pages: [3], learnerText: false, questionId: null },
    { blockId: 'b_bbb', kind: 'paragraph', path: ['The side channel'], text: 'A private turn with one agent.', pages: [3], learnerText: false, questionId: null },
    { blockId: 'b_mine', kind: 'paragraph', path: ['The side channel'], text: 'my own note: the cost moves to forwarding', pages: [3], learnerText: true, questionId: null },
  ];
  const port: DocPort = {
    docId: () => 'doc_1',
    frozen: () => false,
    outlineNear: () => outline,
    blocksForPages: () => ['b_bbb'],
    hasQuestion: () => false,
    recordEdit: (input) => edits.push({ batch: input.batch, objectiveId: input.objectiveId }),
    recordOutcome: (o) => outcomes.push(o),
    ...over,
  };
  return { port, edits, outcomes, outline };
}

/**
 * A reply to put in place of the script's for one request, or null to play the script. How a test
 * gives Max a turn the script does not have — `Not marked.` (#49) — without a network.
 */
type Reply = (request: LlmRequest) => string | null;

/** A client that answers the doc-edit schema call, and plays the notes script for everything else. */
function client(docEdit: Record<string, unknown> | null = null, reply: Reply = () => null): LLMClient & { requests: LlmRequest[] } {
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const requests: LlmRequest[] = [];
  return {
    kind: 'scripted',
    requests,
    async complete(request, onDelta, signal) {
      requests.push(request);
      const own = reply(request);
      if (own !== null) {
        onDelta?.(own);
        return { text: own, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      if (request.meta.scope === 'docedit') {
        const body = JSON.stringify(docEdit ?? { edit: 'none', points_to: 'b_bbb', why: 'the notes already say it' });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      return scripted.complete(request, onDelta, signal);
    },
  };
}

function build(over: Partial<RoomActorDeps> = {}, docEdit: Record<string, unknown> | null = null, reply?: Reply) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client(docEdit, reply);
  const doc = docPort();
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm,
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    models: API_PLAN,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    docPort: doc.port,
    /**
     * **This file is the #48 loop**, `rule:max_followup` included, and since `notebooks.md` §5.2
     * (C8) that loop is legacy coverage: it runs only with the flag off. The notebooks default is
     * pinned in `actor.notebooks.test.ts`.
     */
    maxOnlyOnRequest: false,
    ...over,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm, doc };
}

/**
 * A second actor on the same room, store and clock, as `AppService.openRoom` builds one when the
 * file is opened again: after a relaunch, or after another file's room was open in between.
 */
function relaunch(h: ReturnType<typeof build>, over: Partial<RoomActorDeps> = {}): RoomActor {
  let n = 1000;
  const actor = new RoomActor({
    store: h.store,
    groupStore: groupView(h.store),
    clock: h.clock,
    transport: { emit: (e) => h.events.push(e) },
    llm: h.llm,
    roomId: h.roomId,
    sessionId: h.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    models: API_PLAN,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_r${(n += 1)}`,
    random: () => 0.5,
    docPort: h.doc.port,
    maxOnlyOnRequest: false,
    ...over,
  });
  actor.start();
  return actor;
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 120_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const decisions = (h: ReturnType<typeof build>) => h.store.turnDecisions.forRoom(h.roomId);
const rules = (h: ReturnType<typeof build>) => decisions(h).map((d) => d.decided_by);
const bodies = (h: ReturnType<typeof build>) => h.store.messages.forRoom(h.roomId).map((m) => m.body);
const flat = (text: string) => text.replace(/\s+/g, ' ');
const prompts = (h: ReturnType<typeof build>) =>
  h.llm.requests.filter((r) => r.meta.scope === 'group').map((r) => r.messages.at(-1)!.content);

// ── §4.2: Ellie answers, then Max asks one ────────────────────────────────

describe('rule:ellie_answers, then rule:max_followup', () => {
  it('answers in full and chains exactly one Max question after it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
    const messages = h.store.messages.forRoom(h.roomId);
    // The learner's row, Ellie's answer, Max's question. Two agent turns, which is the cap.
    expect(messages).toHaveLength(3);
    expect(messages[1]!.participant_id).toBe(h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!.id);
    expect(messages[2]!.participant_id).toBe(h.store.participants.byAgentKey(h.roomId, 'challenger.max')!.id);
  });

  /**
   * **A question the bar cannot answer for.** `docroom/progress.ts` counts only what the deck
   * teaches, so a `Well done` on a prerequisite the deck merely assumes fills an objective that
   * is not in the total — the learner answers correctly and the bar does not move. That is what
   * the live run of 20 Sep saw: nothing had been taught in the sitting yet, so the follow-up fell
   * back to the lowest-level element in the pack, which was an assumed one.
   */
  it('never asks about an objective the deck only assumes', async () => {
    const first = PSD_HESSIAN_CONVEXITY_V1.elements[0]!.id;
    const h = build({
      learnerObjectives: () => [
        { objectiveId: first, title: 'assumed', level: 0, assumedByDeck: true },
        ...PSD_HESSIAN_CONVEXITY_V1.elements.slice(1).map((e) => ({
          objectiveId: e.id,
          title: e.learner_label,
          level: 0 as const,
          assumedByDeck: false,
        })),
      ],
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
    const quiz = decisions(h).find((d) => d.decided_by === 'rule:max_followup')!;
    expect(quiz.target_element_id).not.toBe(first);
    expect(quiz.target_element_id).toBe(PSD_HESSIAN_CONVEXITY_V1.elements[1]!.id);
  });

  /**
   * **#49, Lucas's 2026-09-23 run on Lecture 4.** The follow-up to an answer on p. 11 was filed
   * under the pp. 3–6 objective, because `rule:ellie_answers` names no element and the pick fell
   * through to deck order's first — so a *Well done* on p. 11's heuristics completed PDDL, and the
   * p. 11 objective stayed *not started*. The page the learner asked on is what the answer touched.
   */
  it('files the follow-up under the objective of the page the learner asked on', async () => {
    const [a, b, c] = PSD_HESSIAN_CONVEXITY_V1.elements;
    const objectives = [
      { e: a!, pages: [3, 4, 5, 6] },
      { e: b!, pages: [7] },
      { e: c!, pages: [11, 12] },
    ].map(({ e, pages }, i) => ({
      objectiveId: e.id,
      title: e.learner_label,
      level: 0 as const,
      assumedByDeck: false,
      refs: pages.map((page) => ({ page })),
      order: i + 1,
    }));
    const onPage = (page: number) => ({
      scope: 'segment' as const,
      passageText: `the text of p. ${page}`,
      outline: '',
      retrievedPages: [],
      scopeShown: `p. ${page}`,
      page,
    });

    const h = build({ learnerObjectives: () => objectives });
    await settle(h.clock, h.actor.sendMessage('what are some example of problem and heuristic?', DOC, onPage(11)));
    const quiz = decisions(h).find((d) => d.decided_by === 'rule:max_followup')!;
    expect(quiz.target_element_id).toBe(c!.id);

    // A page between two objectives' refs takes the nearest earlier one, not deck order's first.
    const h2 = build({ learnerObjectives: () => objectives });
    await settle(h2.clock, h2.actor.sendMessage('what is this slide saying?', DOC, onPage(9)));
    expect(decisions(h2).find((d) => d.decided_by === 'rule:max_followup')!.target_element_id).toBe(b!.id);
  });

  /**
   * **#49: a whole-deck question has no page asked on**, and its follow-up fell through to deck
   * order's first objective, whatever the answer was about. The pages Ellie's answer cited are
   * what it touched — the same pages §5.2 already anchors that follow-up's Q block at.
   */
  it('files a whole-deck follow-up under an objective of the pages Ellie’s answer cited', async () => {
    const [a, b, c] = PSD_HESSIAN_CONVEXITY_V1.elements;
    const objectives = [
      { e: a!, pages: [3, 4, 5, 6] },
      { e: b!, pages: [7] },
      { e: c!, pages: [11, 12] },
    ].map(({ e, pages }, i) => ({
      objectiveId: e.id,
      title: e.learner_label,
      level: 0 as const,
      assumedByDeck: false,
      refs: pages.map((page) => ({ page })),
      order: i + 1,
    }));
    const deck = {
      scope: 'deck' as const,
      passageText: 'the whole deck',
      outline: '',
      retrievedPages: [],
      scopeShown: 'whole deck',
    };
    const answer =
      'Heuristics estimate the distance to the goal; the deck’s example is the 8-puzzle on p. 11. ' +
      'A good one never overestimates, which is what makes A* optimal.';
    const h = build({ learnerObjectives: () => objectives }, null, (request) =>
      request.meta.scope === 'group' && request.meta.scriptCue === 'student:1' ? answer : null,
    );
    await settle(h.clock, h.actor.sendMessage('what is this deck about overall?', DOC, deck));
    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
    expect(decisions(h).find((d) => d.decided_by === 'rule:max_followup')!.target_element_id).toBe(c!.id);
  });

  /**
   * **#49: the time-based hand-off is superseded in the doc chat** (brief §9: *"`flow-session.md`
   * §8.2 time-based hand-off as a door to the Tester — Superseded by `rule:max_followup`"*). A
   * sitting that satisfies §8.2 used to give the learner's doc-chat question to Max as a quiz, with
   * no answer from Ellie, contradicting §4.2 row 1.
   */
  it('answers a doc-chat question with Ellie even when the old hand-off is due', async () => {
    const start = new FakeClock().now();
    let session = openSession({ id: 'fs_ready', documentId: 'room_test' }, start - 8 * 60_000);
    session = {
      ...session,
      lastActivityAt: start,
      gapDeadlineTs: start + session.profile.sessionGapMs,
      learnerTurns: [start - 180_000, start - 120_000, start - 60_000],
    };
    const taught: TaughtItem[] = [
      { elementId: 'R1', taughtAt: start - 7 * 60_000, by: 'teacher', sessionId: 'fs_ready', label: 'the PSD condition' },
      { elementId: 'R2', taughtAt: start - 6 * 60_000, by: 'teacher', sessionId: 'fs_ready', label: 'the domain' },
    ];
    for (const anchor of [DOC, SPAN]) {
      const h = build({ flowState: { session, taught } });
      await settle(h.clock, h.actor.sendMessage('what is the side channel?', anchor));
      expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
      expect(h.store.messages.forRoom(h.roomId).some((m) => m.model === 'rule:handoff')).toBe(false);
    }
  });

  /**
   * §4.2's own invariant, stated in the brief in as many words: *"One open Max question at a time
   * per file. `rule:max_followup` does not fire while one is open; Ellie's answer to a new learner
   * question simply stands, and Max's open question stays open."*
   */
  it('does not fire a second follow-up while a question is open', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    // An attempt draws feedback (Rowland's rule, §4.2 row 4) and the question stays open; a
    // clarification draws `rule:quiz_clarify` (row 5). Neither may add a second question.
    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));
    await settle(h.clock, h.actor.sendMessage('what do you mean by forwarding?', DOC));

    expect(rules(h)).toEqual([
      'rule:ellie_answers',
      'rule:max_followup',
      'rule:quiz_feedback',
      'rule:quiz_clarify',
    ]);
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);
  });

  /**
   * Max's question belongs to the thread it was asked in. A question the learner asks from
   * another thread (a Ctrl+E span elsewhere in the notes) is Ellie's, and it neither clarifies
   * nor attempts the one that is open.
   */
  it('sends a question asked in another thread to Ellie, and leaves Max’s question open', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('what does a strict subset mean here?', 'span_0123456789ab'));

    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup', 'rule:ellie_answers']);
    const quiz = h.actor.pendingQuizView()!.quiz;
    expect(quiz.attempts).toBe(0);
    expect(quiz.answerShown).toBe(false);
  });

  /** …and it fires again once that question has been resolved. */
  it('fires again on the next question, once the open one has closed', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await settle(h.clock, h.actor.sendMessage('what does forwarding cost?', DOC));

    expect(rules(h)).toEqual([
      'rule:ellie_answers',
      'rule:max_followup',
      'rule:answer_released',
      'rule:ellie_answers',
      'rule:max_followup',
    ]);
  });

  it('is suppressed by @Ellie, and @Max answers alone', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('@Ellie what is the side channel?', DOC));
    expect(rules(h)).toEqual(['rule:mention']);
    expect(h.store.messages.forRoom(h.roomId)[1]!.participant_id).toBe(
      h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!.id,
    );

    const g = build();
    await settle(g.clock, g.actor.sendMessage('@Max what would you want to see?', DOC));
    expect(rules(g)).toEqual(['rule:mention']);
    expect(decisions(g).at(-1)!.move_type).toBe('mention_reply');
  });

  /** The row is the learner's, verbatim; the model is asked the question without the marker. */
  it('keeps the mention in the row and strips it from what the model is asked', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('@Ellie what is the side channel?', DOC));
    expect(bodies(h)[0]).toBe('@Ellie what is the side channel?');
    const prompt = prompts(h).at(-1)!;
    expect(prompt).toContain('WHAT THEY ASKED, WITHOUT THE @NAME');
    expect(prompt).toContain('what is the side channel?');
  });

  /** Interview finding (`findings.md` §6): the answer names the slide it is about. */
  /**
   * **#49: Max's follow-up stays inside the deck.** The page block Ellie reads lifts the fence
   * (*"or your own knowledge of the field, use it"*); Max's question gets the fenced variant.
   */
  it('gives Max the fenced page block for his follow-up, and Ellie the open one', async () => {
    const h = build();
    const onPage7 = {
      scope: 'segment' as const,
      passageText: 'Encode as SAT (CNF). Solved by SATPlan and other SAT planners.',
      outline: '',
      retrievedPages: [],
      scopeShown: 'p. 7',
      page: 7,
    };
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC, onPage7));
    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
    const [ellie, max] = prompts(h).map(flat);
    expect(ellie).toContain('Encode as SAT (CNF)');
    expect(ellie).toContain('your own knowledge of the field');
    expect(max).toContain('Encode as SAT (CNF)');
    expect(max).not.toContain('your own knowledge of the field');
    expect(max).toContain('your question must be answerable from');
  });

  it('asks Ellie to name the page, so three rounds later it is still anchored', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(prompts(h)[0]).toContain('Say which slide this is about');
  });

  /** Interview finding: what the learner writes in the notes is in the agents' context. */
  it('puts the learner’s own notes near the anchor into the prompt, labelled as theirs', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const prompt = prompts(h)[0]!;
    expect(prompt).toContain('WHAT THE LEARNER HAS WRITTEN IN THEIR OWN NOTES');
    expect(prompt).toContain('my own note: the cost moves to forwarding');
    expect(prompt).toContain('Build on this rather than repeating it');
    expect(prompt).toContain('Never rewrite their words');
  });

  /** Interview finding: no repeats, and no question that gives its own answer away. */
  it('tells Max what he has already asked, and that the answer must not be readable off it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    // Close the first question, so a second follow-up is due and has a history to avoid.
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await settle(h.clock, h.actor.sendMessage('what does forwarding cost?', DOC));

    const first = prompts(h).filter((p) => p.includes('ASK ONE FOLLOW-UP QUESTION'));
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('must not be readable off the question');
    // The second follows a give-up, so it is a fill-in-the-blank (§4.5), with the same history.
    const second = prompts(h).filter((p) => p.includes('ASK ONE FILL-IN-THE-BLANK'));
    expect(second).toHaveLength(1);
    expect(second[0]).toContain('YOU HAVE ALREADY ASKED, ON THIS FILE');
    expect(second[0]).toContain('who pays it now');
  });
});

// ── §4.3: Ellie's cue and Max's prompt ────────────────────────────────────

describe('rule:ellie_cue and rule:max_prompt', () => {
  /** The threshold is `clamp(2 × words / 238 wpm, 120 s, 300 s)`, unchanged from #47 §5. */
  async function silentAfterQuestion(reply?: Reply) {
    const h = build({}, null, reply);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    // Past stage 1, then past stage 2, with nothing typed. Two runs, because stage 2's window is
    // armed by stage 1's own fill landing (`#armTimer(true)`).
    await h.clock.run(400_000);
    await h.clock.run(400_000);
    return h;
  }

  it('fills an unattempted silence with a peer guess and then a prompt, once', async () => {
    const h = await silentAfterQuestion();
    const fired = rules(h).filter((r) => r === 'rule:ellie_cue' || r === 'rule:max_prompt');
    expect(fired).toEqual(['rule:ellie_cue', 'rule:max_prompt']);

    // More silence buys nothing: §4.3 fires once per question.
    await h.clock.run(600_000);
    expect(rules(h).filter((r) => r === 'rule:ellie_cue')).toHaveLength(1);
    expect(rules(h).filter((r) => r === 'rule:max_prompt')).toHaveLength(1);
  });

  /**
   * The cue is a **structured** call, so what it reported about itself is a fact on the question
   * rather than prose (architect §E6). `script.notes.ts`'s `cue:1` plants a mistake on purpose.
   */
  it('records what the cue reported about itself, and never posts the JSON', async () => {
    const h = await silentAfterQuestion();
    const quiz = h.actor.flowSnapshot().pendingQuiz!;
    expect(quiz.cueGivenAt).toBeTypeOf('number');
    expect(quiz.cueHasMistake).toBe(true);
    expect(quiz.cueClaim).toContain('same context window');
    // The learner sees the prose, not the object.
    const cueBody = bodies(h).find((b) => b.includes('side channel'))!;
    expect(bodies(h).some((b) => b.trimStart().startsWith('{'))).toBe(false);
    expect(cueBody).not.toContain('has_mistake');
  });

  it('asks Ellie for a peer register and Max for a prompt aimed at the learner', async () => {
    const h = await silentAfterQuestion();
    const cue = prompts(h).find((p) => p.includes('YOU ARE THINKING ALOUD AS A PEER'))!;
    expect(cue).toContain('At most 60 words');
    expect(cue).toContain('Never the full correct answer');
    expect(cue).toContain('do not open with a definition');

    const prompt = prompts(h).find((p) => p.includes('RESPOND TO THE GUESS'))!;
    expect(prompt).toContain('AIMED AT THE LEARNER');
    expect(prompt).toContain('At most 50 words');
    expect(prompt).toContain('Do not confirm it and do not correct it yet');
    // It answers *her guess*, which is why the guess is in the prompt.
    expect(prompt).toContain('same context window');
  });

  /** §4.3, and the whole reason it is a *guess*: it is never written to the notes. */
  it('never writes the cue or the prompt to the document', async () => {
    const h = await silentAfterQuestion();
    expect(h.doc.edits.map((e) => e.batch.cause)).not.toContain('answer_missing');
    for (const edit of h.doc.edits) {
      expect(JSON.stringify(edit.batch)).not.toContain('same context window');
    }
  });

  /**
   * §4.7's second invariant: *"If Ellie's cue contained a mistake and the thread ends by any path,
   * the resolving Max turn corrects it explicitly."* Code cannot check that he did; what it can
   * check — and what this asserts — is that the directive carried the correction.
   */
  it('puts the correction of Ellie’s mistake into the resolving turn’s directive', async () => {
    const h = await silentAfterQuestion();
    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));

    const feedback = prompts(h).at(-1)!;
    expect(feedback).toContain('Correct');
    expect(feedback).toContain('same context window');
    expect(feedback).toContain('leaving it uncorrected is the one thing it must not cost');
  });

  /** Live run, 2026-10-03: the same correction in six feedback turns on one question. */
  it('corrects Ellie once, not on every feedback turn after it', async () => {
    const partly = (request: LlmRequest) =>
      request.meta.scope === 'group' && request.messages.at(-1)!.content.includes('WHICH IS WHAT YOU MARK')
        ? 'Partly there. You have who pays it, p. 3. When do they pay it?'
        : null;
    const h = await silentAfterQuestion(partly);
    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));
    expect(prompts(h).at(-1)).toContain('same context window');

    await settle(h.clock, h.actor.sendMessage('they pay it at the moment of forwarding the reply', DOC));
    expect(rules(h).at(-1)).toBe('rule:quiz_feedback');
    expect(prompts(h).at(-1)).not.toContain('same context window');
    expect(h.actor.flowSnapshot().pendingQuiz?.cueCorrected).toBe(true);
  });

  it('carries the same correction on a release, when the learner gives up instead', async () => {
    const h = await silentAfterQuestion();
    await settle(h.clock, h.actor.sendMessage("I don't know", DOC));
    expect(rules(h).at(-1)).toBe('rule:answer_released');
    const release = prompts(h).at(-1)!;
    expect(release).toContain('GIVE THE ANSWER');
    expect(release).toContain('same context window');
  });
});

describe('parseCue', () => {
  it('reads the structured reply, and claims no mistake it cannot name', () => {
    expect(parseCue(JSON.stringify({ text: 'I think it is X.', has_mistake: true, claim: 'X' }))).toEqual({
      text: 'I think it is X.',
      hasMistake: true,
      claim: 'X',
    });
    // A flag with no claim is not a mistake the closure rule could correct, so it is not one.
    expect(parseCue(JSON.stringify({ text: 'hm', has_mistake: true, claim: null })).hasMistake).toBe(false);
    // Prose the model wrapped the object in, and prose that is not an object at all.
    expect(parseCue('Here you go:\n{"text":"maybe Y","has_mistake":false}').text).toBe('maybe Y');
    expect(parseCue('just words')).toEqual({ text: 'just words', hasMistake: false, claim: null });
  });
});

// ── §4.4 and §4.7: the release, and closure ───────────────────────────────

describe('releasing and closing a question', () => {
  async function withOpenQuestion() {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    return h;
  }

  it('records an outcome that fills nothing on a give-up', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.sendMessage('this is too hard', DOC));

    const released = h.doc.outcomes.filter((o) => o.kind === 'released');
    expect(released).toHaveLength(1);
    expect(released[0]!.releasedBy).toBe('give_up');
    expect(released[0]!.verdict).toBeNull();
    expect(released[0]!.questionId).toMatch(/^q_/);
  });

  /**
   * **#49: the exchange is the chat's; the notes get the answer once.** The live runs of 20–23 Sep
   * wrote 17 resolutions under 5 questions — every *Partly there* and *Not yet*, verbatim, the
   * verdict, the marking and the follow-up question included.
   */
  it('writes nothing to the notes on a Partly there, and one resolution when the question closes', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));
    // Partly there: the question is still open, and the notes are left alone.
    expect(h.doc.edits.filter((e) => e.batch.cause === 'q_resolved')).toEqual([]);
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);

    await settle(h.clock, h.actor.sendMessage('this is too hard', DOC));
    const resolves = h.doc.edits.filter((e) => e.batch.cause === 'q_resolved');
    expect(resolves).toHaveLength(1);
    // Released after a Partly there: part of it was theirs (brief §5.3).
    expect(resolves[0]!.batch.ops[0]).toMatchObject({ op: 'resolve_q', resolution: 'partly_yours', learnerAnswer: null });
    // 2026-10-06 (D4): a released answer is the chat's alone. The notes get no Max words, and no
    // model call writes them: the Q block only folds into a chip that says revisit.
    expect(resolves[0]!.batch.ops[0]).toMatchObject({ blocks: [] });
    expect(h.llm.requests.some((r) => r.system.some((b) => b.text.includes('it is now closed')))).toBe(false);

    // A further turn on the closed question resolves nothing again.
    await settle(h.clock, h.actor.closeOpenQuestion('closure'));
    expect(h.doc.edits.filter((e) => e.batch.cause === 'q_resolved')).toHaveLength(1);
  });

  /**
   * **#49: a question resolves once** (brief §5.3, §4.4). The dogfood logs had the learner's next
   * message after a release, or after a *Well done*, marked against the closed question: `answerQuiz`
   * put it back in feedback debt, `rule:quiz_feedback` fired ahead of Ellie, and the extra verdicts
   * filled an objective. After a question closes, the next message follows the ordinary rules.
   */
  it('does not mark the next message against a question the learner gave up on', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.sendMessage('this is too hard', DOC));
    expect(rules(h).at(-1)).toBe('rule:answer_released');

    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));
    const after = rules(h).slice(3);
    expect(after[0]).toBe('rule:ellie_answers');
    expect(after).not.toContain('rule:quiz_feedback');
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toEqual([]);
  });

  it('does not mark the next message against a question that drew a Well done', async () => {
    const wellDone =
      'Well done. The cost lands on the learner, at the moment they decide whether to forward. ' +
      'p. 5: "did not actually do so, memory protected".';
    const h = build({}, null, (request) =>
      request.meta.scope === 'group' && request.meta.scriptCue === 'feedback:1' ? wellDone : null,
    );
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));
    expect(rules(h).at(-1)).toBe('rule:quiz_feedback');
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict').map((o) => o.verdict)).toEqual(['complete']);

    await settle(h.clock, h.actor.sendMessage('the learner carries it, since only they can forward', DOC));
    expect(rules(h).slice(3)[0]).toBe('rule:ellie_answers');
    expect(rules(h).slice(3)).not.toContain('rule:quiz_feedback');
    // Still one verdict: the closed question is not marked again.
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toHaveLength(1);
  });

  it('does not mark the learner’s doc text against a closed question', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.sendMessage('this is too hard', DOC));
    await settle(
      h.clock,
      h.actor.assessDocText({
        anchorId: DOC,
        objectiveId: ELEMENT,
        blockId: 'b_mine',
        text: 'The learner carries the forwarding decision, so the cost is theirs.',
      }),
    );
    expect(rules(h).slice(3)).not.toContain('rule:quiz_feedback');
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toEqual([]);
  });

  it('records a three-valued verdict on a feedback turn', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.sendMessage('the learner pays it, when they decide to forward', DOC));
    const verdicts = h.doc.outcomes.filter((o) => o.kind === 'verdict');
    expect(verdicts).toHaveLength(1);
    // `script.notes.ts`'s feedback beat opens "Partly there." — half the objective, not all of it.
    expect(verdicts[0]!.verdict).toBe('partial');
    expect(verdicts[0]!.source).toBe('chat');
    expect(verdicts[0]!.messageId).toBeTypeOf('string');
  });

  /**
   * **#49: a request for background is not an answer, and not a give-up.** Before the classifier
   * was widened, *"I don't know how…"* was a give-up — the learner asking for the format was handed
   * the answer and the question closed.
   */
  it('clarifies a request for background, and neither marks it nor releases the answer', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.sendMessage("I don't know how forwarding works here, we never covered it", DOC));

    expect(rules(h).at(-1)).toBe('rule:quiz_clarify');
    expect(rules(h)).not.toContain('rule:answer_released');
    const quiz = h.actor.pendingQuizView()!.quiz;
    expect(quiz.attempts).toBe(0);
    expect(quiz.answerShown).toBe(false);
    expect(h.doc.outcomes).toEqual([]);
  });

  /**
   * **#49's fallback, end to end.** The classifier cannot catch every phrasing, so the feedback
   * turn may open `Not marked.` when the turn it was asked to mark was a request. Code un-counts
   * it: no outcome row (no fill, nothing for the pitch to read as *Not yet*), nothing in the
   * notes, and the question still open — and a later release does not say they attempted it.
   */
  it('un-counts an attempt when Max says "Not marked.", and leaves the question open', async () => {
    const notMarked =
      'Not marked.\n\nForwarding means copying a private turn into the shared thread, where everyone ' +
      'can read it — like reposting a DM to a group chat. p. 5 shows the choice being made.\n\n' +
      'So: who pays the cost of the side channel now, and at what moment?';
    const h = build({}, null, (request) =>
      request.meta.scope === 'group' && request.meta.scriptCue === 'feedback:1' ? notMarked : null,
    );
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const editsBefore = h.doc.edits.length;
    // Classified as an attempt (a statement), which is exactly the miss the fallback is for.
    await settle(h.clock, h.actor.sendMessage('the forwarding step from p. 5 is new to me, we skipped it', DOC));

    expect(decisions(h).at(-1)!.move_type).toBe('quiz_feedback');
    expect(bodies(h).at(-1)).toMatch(/^Not marked\./);
    const quiz = h.actor.pendingQuizView()!.quiz;
    expect(quiz.attempts).toBe(0);
    expect(quiz.feedbackGiven).toBe(false);
    expect(quiz.verdict).toBeNull();
    expect(quiz.answerShown).toBe(false);
    // No verdict row, so no progress, and nothing to the notes: no suggestion, no resolution.
    expect(h.doc.outcomes).toEqual([]);
    expect(h.doc.edits.length).toBe(editsBefore);
    const thread = h.actor.docThreads().find((t) => t.threadId === DOC)!;
    expect(thread.quiz!.open).toBe(true);
    expect(thread.quiz!.resolution).toBeNull();
    const logged = h.store.events.forSession(h.sessionId).filter((e) => e.type === 'quiz.attempt_unmarked');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!.payload).attempts).toBe(0);

    // The give-up that follows is released as one with no attempt behind it.
    await settle(h.clock, h.actor.sendMessage('this is too hard', DOC));
    expect(rules(h).at(-1)).toBe('rule:answer_released');
    expect(flat(prompts(h).at(-1)!)).not.toContain('They did attempt it');
    const released = h.doc.outcomes.filter((o) => o.kind === 'released');
    expect(released).toHaveLength(1);
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toEqual([]);
  });

  /**
   * **§4.7: no question Max asked is left without its answer.** `expireQuizOnClose` used to drop
   * it as a debt avoided; the brief pays it instead.
   */
  it('releases an open question at closure, and closes it', async () => {
    const h = await withOpenQuestion();
    await settle(h.clock, h.actor.closeOpenQuestion('closure'));

    expect(rules(h).at(-1)).toBe('rule:closure');
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
    const released = h.doc.outcomes.filter((o) => o.kind === 'released');
    expect(released[0]!.releasedBy).toBe('closure');
    // The doc's Q block is resolved as *released* (§5.3).
    const resolve = h.doc.edits.find((e) => e.batch.cause === 'q_resolved');
    expect(resolve!.batch.ops[0]).toMatchObject({ op: 'resolve_q', resolution: 'released' });
  });

  /**
   * §4.7's first clause, on its own clock: *"If a question is still open when the flow session
   * goes idle (the existing inactivity gap)… Max releases the answer."* The gap is 20 minutes
   * (`flow.FLOW.sessionGapMs`) and the actor checks every 30 s.
   */
  it('releases it on its own when the sitting goes idle, without anyone calling close', async () => {
    const h = await withOpenQuestion();
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);

    // Past the 20-minute inactivity gap, with nothing typed.
    await h.clock.run(21 * 60_000);
    await h.clock.run(60_000);

    expect(rules(h)).toContain('rule:closure');
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
    expect(h.doc.outcomes.filter((o) => o.releasedBy === 'closure')).toHaveLength(1);
  });

  /**
   * **A quit records the question; the relaunch pays it** (§4.7, #49). A quit cannot wait for a
   * model turn, so the open question goes to SQLite with the sitting (`AppService.dispose`). When
   * the file is next opened after the gap, the debt is paid at once: the first closure tick used
   * to come 30 s after the room opened, and a learner who typed before it rolled the stale
   * sitting over into a new one, so the question was never released.
   */
  it('releases a question whose sitting went idle while the app was shut, before the learner’s first act', async () => {
    const h = await withOpenQuestion();
    const stored = h.actor.flowSnapshot();
    h.actor.stop();
    h.clock.advance(21 * 60_000);

    const relaunched = relaunch(h, { flowState: stored });
    // The learner asks something straight away, inside the first tick's 30 s.
    await settle(h.clock, relaunched.sendMessage('what does a strict subset mean here?', DOC));

    expect(rules(h)).toContain('rule:closure');
    expect(h.doc.outcomes.filter((o) => o.releasedBy === 'closure')).toHaveLength(1);
    relaunched.stop();
  });

  it('is a no-op when nothing is open, so a file close is always safe to call', async () => {
    const h = build();
    await expect(h.actor.closeOpenQuestion('closure')).resolves.toBeUndefined();
    expect(rules(h)).toEqual([]);
  });

  /**
   * Architect §E3: a close must never block on a model call. When the turn cannot be had, the Q
   * block is still resolved — from the objective's own criteria — because silence is the one
   * outcome §4.7 rules out.
   */
  it('resolves from the objective’s criteria when no model answer can be had', async () => {
    const failing: LLMClient = {
      kind: 'scripted',
      async complete(request) {
        if (request.meta.scope === 'group') throw new Error('the backend is gone');
        return { text: '{}', model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      },
    };
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    h.actor.rebind({ llm: failing });

    await settle(h.clock, h.actor.closeOpenQuestion('closure'));
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
    const resolve = h.doc.edits.filter((e) => e.batch.cause === 'q_resolved').at(-1)!;
    expect(resolve.batch.ops[0]).toMatchObject({ op: 'resolve_q', resolution: 'released' });
    // #49: the criteria are what an answer is written from, never the answer. The 22 Sep run put
    // "The answer needed to cover: - Lists all four steps in order" under a question.
    expect(JSON.stringify(resolve.batch.ops)).not.toContain('The answer needed to cover');
  });
});

// ── §5: the doc edits ─────────────────────────────────────────────────────

describe('the doc-edit call', () => {
  const editsOf = (h: ReturnType<typeof build>) => h.events.filter((e) => e.type === 'doc.edit');

  it('writes Max’s question in as a Q block at the segment it is about (§5.2)', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const q = h.doc.edits.find((e) => e.batch.cause === 'q_block')!;
    expect(q.batch.author).toBe('max');
    expect(q.batch.ops[0]).toMatchObject({ op: 'insert_q', anchorBlockId: 'b_bbb' });
    // Recorded before it was emitted, so an edit the renderer never reports on is still logged.
    expect(editsOf(h).some((e) => e.type === 'doc.edit' && e.batch.editId === q.batch.editId)).toBe(true);
  });

  it('moves the cursor to the block before it types, and says who is typing', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const cursors = h.events.filter((e) => e.type === 'doc.cursor');
    expect(cursors.map((c) => c.type === 'doc.cursor' && c.state)).toContain('thinking');
    expect(cursors.map((c) => c.type === 'doc.cursor' && c.state)).toContain('typing');
  });

  /**
   * `notebooks.md` §4.2 (C7): after a doc-chat question the notes get **one line**, under the block
   * the planner judges best, and a plain doc-chat question may get none when nothing fits.
   */
  it('writes no line when nothing in the outline fits a doc-chat answer', async () => {
    const h = build({}, { line: null, anchor_block_id: null, why: 'nothing here is about it' });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(h.doc.edits.some((e) => e.batch.cause === 'block_action' || e.batch.cause === 'answer_missing')).toBe(false);
    // And the chat says nothing about an edit that did not happen.
    expect(bodies(h).some((b) => b.includes('Added one line'))).toBe(false);
  });

  it('adds one line under the block the planner picked, with provenance, and the chat says so', async () => {
    const h = build({}, { line: 'The learner carries the forwarding decision.', anchor_block_id: 'b_bbb', why: 'the notes never say who pays' });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const added = h.doc.edits.find((e) => e.batch.cause === 'block_action')!;
    expect(added.batch.author).toBe('ellie');
    expect(added.batch.ops).toEqual([
      {
        op: 'insert_after',
        anchorBlockId: 'b_bbb',
        blocks: [{ kind: 'paragraph', text: 'The learner carries the forwarding decision.', prov: { pages: [3], reason: null } }],
      },
    ]);
    expect(added.batch.why).toBe('the notes never say who pays');
    const ellie = h.store.messages.forRoom(h.roomId).find((m) => m.decided_by === 'rule:ellie_answers')!;
    expect(ellie.body.endsWith('Added one line under that paragraph in \u201cThe side channel\u201d.')).toBe(true);
  });

  /** Interview finding: a span thread's edit lands at that span's block, not where it is tidier. */
  it('pins a span thread’s edit to the span’s own block', async () => {
    const h = build({}, { line: 'An addition beside the learner’s note.', anchor_block_id: 'b_aaa', why: 'somewhere tidier' });
    h.actor.noteSelection(SPAN);
    await settle(
      h.clock,
      h.actor.assessDocText({ anchorId: SPAN, objectiveId: ELEMENT, blockId: 'b_mine', text: 'the cost moves to forwarding, so the learner pays it' }),
    );
    await settle(h.clock, h.actor.sendMessage('so who pays it?', SPAN));

    const added = h.doc.edits.find((e) => e.batch.cause === 'block_action')!;
    expect(added.batch.ops[0]).toMatchObject({ anchorBlockId: 'b_mine' });
    // And it adds beside the learner's block rather than over it.
    expect(added.batch.ops[0]!.op).toBe('insert_after');
  });

  /** §3's Freeze: *"Edits that would have happened are dropped, not queued."* */
  it('drops every edit while the doc is frozen', async () => {
    const frozen = docPort({ frozen: () => true });
    const h = build({ docPort: frozen.port });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(frozen.edits).toEqual([]);
    expect(h.events.filter((e) => e.type === 'doc.edit')).toEqual([]);
  });

  /** A doc-edit failure is never a turn failure (§5, and the ledger's rule in §4.6). */
  it('never lets a doc-edit failure fail the turn', async () => {
    const angry = docPort({
      recordEdit: () => {
        throw new Error('the doc is gone');
      },
    });
    const h = build({ docPort: angry.port });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
    expect(h.events.filter((e) => e.type === 'turn.failed')).toEqual([]);
  });

  it('bills the call as its own scope, so the document’s cost is visible as one', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const call = h.llm.requests.find((r) => r.meta.scope === 'docedit')!;
    expect(call.meta.costScope).toBe('docedit');
    expect(call.meta.anchorId).toBe(DOC);
    expect(call.jsonSchema).toBeTypeOf('object');
  });

  /**
   * **The split is reversed** (`notebooks.md` §4.2, C7; it was 2026-09-23's short half in the
   * chat). The chat turn is the full Teacher answer, five-step shape and all, and the notes call
   * is given what the learner asked and asked for one line of at most 25 words.
   */
  it('answers in full in the chat, and asks the notes call for one line', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const ellie = prompts(h)[0]!;
    expect(ellie).toContain('About 120 words,');
    expect(ellie).toContain('use the shape');
    expect(ellie).not.toContain('SHORT HERE');
    // The legacy loop: Max still follows, so she leaves the question to him.
    expect(ellie).toContain('Max asks the next one.');
    const edit = h.llm.requests.find((r) => r.meta.scope === 'docedit')!;
    const system = edit.system.map((b) => b.text).join('\n');
    expect(system).toContain('WHAT THEY ASKED');
    expect(system).toContain('what is the side channel?');
    // §11.2 (amended 2026-10-06): one note of about 120 words, not the 25-word line.
    expect(system).toContain('At most 120 words in all');
  });

  /**
   * **New Conversation** (2026-09-23): a retired room posts nothing more and edits nothing more,
   * even for a reply that was already being generated when the learner reset it.
   */
  it('drops the reply in flight and makes no notes edit once the room is retired', async () => {
    const h = build();
    const sent = h.actor.sendMessage('what is the side channel?', DOC);
    await h.clock.run(200);
    h.actor.retire();
    await settle(h.clock, sent);
    const agentRows = h.store.messages
      .forRoom(h.roomId)
      .filter((m) => m.participant_id !== h.store.participants.forRoom(h.roomId).find((p) => p.kind === 'student')?.id);
    expect(agentRows).toEqual([]);
    expect(h.doc.edits).toEqual([]);
    expect(h.events.filter((e) => e.type === 'doc.edit')).toEqual([]);
  });

  it('gives the whole answer in the chat when the notes are frozen, since nothing will reach them', async () => {
    const frozen = docPort({ frozen: () => true });
    const h = build({ docPort: frozen.port });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const ellie = prompts(h)[0]!;
    expect(ellie).toContain('This answer is the whole of it.');
    expect(ellie).toContain('use the shape');
    expect(ellie).not.toContain('SHORT HERE');
    // Frozen: no notes call at all, and so nothing for the chat to announce.
    expect(h.llm.requests.some((r) => r.meta.scope === 'docedit')).toBe(false);
  });
});

// ── §6: the learner's own doc text, and the lesson card ───────────────────

describe('assessDocText', () => {
  it('inserts the learner’s words as a doc_text message and marks them like a chat attempt', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(
      h.clock,
      h.actor.assessDocText({
        anchorId: SPAN,
        objectiveId: ELEMENT,
        blockId: 'b_mine',
        text: 'The learner carries the forwarding decision, so the cost is theirs.',
      }),
    );

    const row = h.store.messages.forRoom(h.roomId).find((m) => m.kind === 'doc_text')!;
    expect(row.body).toBe('The learner carries the forwarding decision, so the cost is theirs.');
    expect(row.anchor_id).toBe(SPAN);
    expect(row.participant_id).toBe(h.store.participants.student(h.roomId)!.id);
    expect(row.objective_id).toBe(ELEMENT);
    // The ledger's evidence id stays a message id (architect §E4): no second evaluator.
    expect(rules(h).at(-1)).toBe('rule:quiz_feedback');
  });

  /**
   * **§6's suggestion, and the one gate on it.** The learner's own words are the only text an
   * agent may not simply rewrite, so a correction to them is offered rather than applied — and
   * the quote has to be findable in the document, which is why `buildSuggestionEdit` checks it
   * against their text rather than trusting the model.
   */
  it('offers a suggestion when their own words are wrong, quoting them verbatim', async () => {
    const text = 'The agent carries the forwarding decision, so the cost is the agent’s.';
    const h = build({}, {
      suggest: true,
      quote: 'The agent carries the forwarding decision',
      replacement: 'The learner carries the forwarding decision',
      note: 'it is the learner who decides',
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.assessDocText({ anchorId: SPAN, objectiveId: ELEMENT, blockId: 'b_mine', text }));

    const suggestion = h.doc.edits.find((e) => e.batch.cause === 'suggestion')!;
    expect(suggestion.batch.ops).toEqual([]);
    expect(suggestion.batch.suggestion).toMatchObject({
      blockId: 'b_mine',
      quote: 'The agent carries the forwarding decision',
      replacement: 'The learner carries the forwarding decision',
      threadId: SPAN,
    });
    expect(text).toContain(suggestion.batch.suggestion!.quote);
  });

  it('offers nothing when the correction would be a paraphrase of what they wrote', async () => {
    const h = build({}, { suggest: true, quote: 'a line they never wrote', replacement: 'x', note: 'y' });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(
      h.clock,
      h.actor.assessDocText({ anchorId: SPAN, objectiveId: ELEMENT, blockId: 'b_mine', text: 'The learner carries it.' }),
    );
    expect(h.doc.edits.some((e) => e.batch.cause === 'suggestion')).toBe(false);
  });

  /**
   * **§6: the attempt is on the block's objective, not the chat's** (#49). Text written under
   * another objective's block is not an answer to Max's open question about this one: marking it
   * against his question filed a repair-strategy paragraph under the HCD-loop objective. It is
   * recorded under its own block's objective, and Max's question stays open and untouched, as a
   * question asked in another thread does.
   */
  it('does not mark text under another objective’s block as an answer to the open question', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const asked = h.actor.pendingQuizView()!.quiz;
    // Objective and element share one id space (`objectives/pack.ts`).
    const other = PSD_HESSIAN_CONVEXITY_V1.elements.find((e) => e.id !== asked.elementId)!.id;

    await settle(
      h.clock,
      h.actor.assessDocText({
        anchorId: SPAN,
        objectiveId: other,
        blockId: 'b_mine',
        text: 'The learner carries the forwarding decision, so the cost is theirs.',
      }),
    );

    const row = h.store.messages.forRoom(h.roomId).find((m) => m.kind === 'doc_text')!;
    expect(row.objective_id).toBe(other);
    expect(rules(h)).not.toContain('rule:quiz_feedback');
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toEqual([]);
    const quiz = h.actor.pendingQuizView()!.quiz;
    expect(quiz.attempts).toBe(0);
    expect(quiz.answerShown).toBe(false);
  });

  it('tells Max the answer came out of the document, and records the outcome as such', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(
      h.clock,
      h.actor.assessDocText({ anchorId: SPAN, objectiveId: ELEMENT, blockId: 'b_mine', text: 'The learner carries it.' }),
    );
    expect(prompts(h).at(-1)).toContain('WRITTEN IN THE DOCUMENT, NOT IN THE CHAT');
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict').at(-1)!.source).toBe('doc_text');
  });
});

describe('startLesson', () => {
  /** Max's lesson question, in place of the script's, so the test does not depend on its cues. */
  const LESSON_Q = 'Why does a side channel keep the main thread clean?';
  const maxAsks: Reply = (r) =>
    r.meta.scope === 'group' && r.meta.agentKey?.startsWith('challenger') && r.meta.scriptCue?.startsWith('try') ? LESSON_Q : null;

  /**
   * 2026-10-06 (D2, `collab-doc.md` §6 amended): Start is Ellie's walk-through and nothing else.
   * From 1 Oct it was her two-sentence intro and then Max's question within seconds; in the 10-03
   * to 10-05 runs every quiz came that way and Quiz me was never pressed.
   */
  it('has Ellie walk the learner through the section, and Max ask nothing', async () => {
    const h = build({}, null, maxAsks);
    await settle(
      h.clock,
      h.actor.startLesson({
        objectiveId: ELEMENT,
        anchorId: DOC,
        blockId: 'b_bbb',
        section: 'Side channels\nA side channel keeps the main thread clean.',
        pages: [4, 5],
      }),
    );

    expect(rules(h)).toEqual(['rule:lesson_start']);
    const messages = h.store.messages.forRoom(h.roomId);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.anchor_id).toBe(DOC);
    expect(h.actor.pendingQuizView()).toBeNull();
    expect(h.doc.edits.flatMap((e) => e.batch.ops).find((op) => op.op === 'insert_q')).toBeUndefined();

    const ellie = flat(prompts(h)[0]!);
    expect(ellie).toContain('THE LEARNER PRESSED START ON A LESSON');
    expect(ellie).toContain('Walk them through it');
    expect(ellie).toContain('A side channel keeps the main thread clean.');
    expect(ellie).toContain('pp. 4, 5');
    expect(ellie).toContain('Ask the learner nothing');
    expect(ellie).not.toContain('Do not teach it yet');
    expect(ellie).not.toContain('Max asks');
  });

  it('runs only Ellie\'s turn when Max already has a question open, and she points back to it', async () => {
    const h = build({}, null, maxAsks);
    await settle(h.clock, h.actor.tryHere({ anchorId: SPAN, objectiveId: ELEMENT }));
    expect(rules(h)).toEqual(['rule:try_here']);

    await settle(h.clock, h.actor.startLesson({ objectiveId: ELEMENT, anchorId: DOC, blockId: 'b_bbb' }));
    // The silence on his open question may still bring Ellie's cue; what must not happen is a
    // second question from Max.
    expect(rules(h).slice(0, 2)).toEqual(['rule:try_here', 'rule:lesson_start']);
    expect(rules(h).filter((r) => r === 'rule:try_here')).toHaveLength(1);
    const lesson = prompts(h).find((p) => p.includes('THE LEARNER PRESSED START ON A LESSON'))!;
    expect(flat(lesson)).toContain('Max already has a question open for them');
  });
});

// ── §4.1 and the thread registry ──────────────────────────────────────────

describe('docThreads and chat.thread', () => {
  it('reports the doc chat, a span thread and a private thread under their own ids', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('and here?', SPAN));
    const priv = h.actor.openPrivate('max');

    const threads = h.actor.docThreads();
    expect(threads.find((t) => t.threadId === DOC)!.kind).toBe('doc');
    expect(threads.find((t) => t.threadId === SPAN)!.kind).toBe('span');
    const p = threads.find((t) => t.threadId === priv.threadId)!;
    expect(p.kind).toBe('private');
    expect(p.agentKey).toBe('max');
    // A private thread's turns live in `whispers`, so it never carries message ids.
    expect(p.messageIds).toEqual([]);
  });

  it('carries the quiz on the thread it was asked in, and emits chat.thread when it changes', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const doc = h.actor.docThreads().find((t) => t.threadId === DOC)!;
    expect(doc.quiz!.open).toBe(true);
    expect(doc.quiz!.questionId).toMatch(/^q_/);
    expect(doc.quiz!.cueGiven).toBe(false);
    expect(doc.quiz!.resolution).toBeNull();
    expect(h.events.filter((e) => e.type === 'chat.thread').length).toBeGreaterThan(0);

    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    const after = h.actor.docThreads().find((t) => t.threadId === DOC)!;
    expect(after.quiz!.open).toBe(false);
    expect(after.quiz!.resolution).toBe('released');
  });

  it('keeps “deck” working as the doc chat’s old name', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', 'deck'));
    expect(h.actor.docThreads().find((t) => t.threadId === 'deck')!.kind).toBe('doc');
    expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
  });
});

describe('private threads with Ellie and Max', () => {
  it('opens one of each, and they are different threads', () => {
    const h = build();
    const ellie = h.actor.openPrivate('ellie');
    const max = h.actor.openPrivate('max');
    expect(ellie.threadId).not.toBe(max.threadId);
    // Reopening is the same thread inside one sitting.
    expect(h.actor.openPrivate('max').threadId).toBe(max.threadId);
  });

  it('answers in the thread, emits chat.private, and never opens a question', async () => {
    const h = build();
    const max = h.actor.openPrivate('max');
    await settle(h.clock, h.actor.sendPrivate(max.threadId, 'is my last answer close?'));

    const turns = h.actor.openPrivate('max').turns;
    expect(turns.map((t) => t.role)).toEqual(['learner', 'agent']);
    expect(turns[1]!.agentKey).toBe('max');
    expect(h.events.filter((e) => e.type === 'chat.private')).toHaveLength(2);
    // A private turn is not a turn: nothing was decided, nothing was written to `messages`.
    expect(rules(h)).toEqual([]);
    expect(h.store.messages.forRoom(h.roomId)).toHaveLength(0);
  });

  /** §4.1's one crossing, and it is the learner's own act. */
  it('inserts a private turn into the document only when the learner asks', async () => {
    const h = build();
    const ellie = h.actor.openPrivate('ellie');
    await settle(h.clock, h.actor.sendPrivate(ellie.threadId, 'say it in one line'));
    const reply = h.store.whispers.forThread(ellie.threadId).find((w) => w.sender === 'agent')!;

    const { editId } = await h.actor.insertPrivateIntoDoc({
      threadId: ellie.threadId,
      turnId: reply.id,
      anchorBlockId: 'b_bbb',
    });
    expect(editId).toBeTypeOf('string');
    const inserted = h.doc.edits.find((e) => e.batch.cause === 'whisper_insert')!;
    expect(inserted.batch.author).toBe('ellie');
    expect(inserted.batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_bbb' });
  });

  it('refuses to insert a learner’s own private turn, or one from another thread', async () => {
    const h = build();
    const ellie = h.actor.openPrivate('ellie');
    await settle(h.clock, h.actor.sendPrivate(ellie.threadId, 'say it in one line'));
    const own = h.store.whispers.forThread(ellie.threadId).find((w) => w.sender === 'student')!;
    expect(await h.actor.insertPrivateIntoDoc({ threadId: ellie.threadId, turnId: own.id, anchorBlockId: null })).toEqual({
      editId: null,
    });
    expect(await h.actor.insertPrivateIntoDoc({ threadId: 'wthread_nope', turnId: own.id, anchorBlockId: null })).toEqual({
      editId: null,
    });
  });
});

// ── #40: Settings ▸ Tester pacing reaches the room that is open ────────────

describe('rebind with a pacing profile', () => {
  /**
   * The profile used to be read at construction only, and the open sitting kept its own copy — so
   * switching to Demo mid-sitting did nothing until the sitting closed, reopen or not.
   */
  it('applies to the open sitting, not only to the next one', async () => {
    const h = build({ flowProfile: FLOW });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(h.actor.flowSnapshot().session?.profile.name).toBe(FLOW.name);

    h.actor.rebind({ flowProfile: DEMO });
    expect(h.actor.flowSnapshot().session?.profile.name).toBe(DEMO.name);
  });

  /**
   * #49: the same rule when the room is opened again. `openRoom` builds a new actor with the
   * Settings profile *and* the stored sitting, and the sitting's saved profile won, so a sitting
   * first opened under Demo kept Demo's pacing (a cue at a sixth of the 120 s floor) after the
   * learner had switched to Study while that file was not open, or across a relaunch.
   */
  it('applies to a sitting restored when the room is opened again', async () => {
    const h = build({ flowProfile: DEMO });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const stored = h.actor.flowSnapshot();
    expect(stored.session?.profile.name).toBe(DEMO.name);
    h.actor.stop();

    const reopened = relaunch(h, { flowState: stored, flowProfile: FLOW });
    expect(reopened.flowSnapshot().session?.profile.name).toBe(FLOW.name);
    reopened.stop();
  });
});

// ── progress-tracking.md §1.1: ● needs a reply to Max's question on that element ──

describe('the defended gate', () => {
  /**
   * **#49's audit.** The ledger was handed every element Max had ever asked about in the room, so
   * any later message on one of them could be scored level 3 (● Defended). The brief allows level
   * 3 only on a message that answers Max's probe on that element.
   */
  it('lets level 3 through only on the reply to Max’s question, not on a message in another thread', async () => {
    let target: string | null = null;
    const reply: Reply = (request) => {
      if (request.meta.scope !== 'ledger' || target === null) return null;
      const said = request.messages.at(-1)!.content;
      const evidence = [ELSEWHERE, ANSWER].find((t) => said.includes(t)) ?? ANSWER;
      return JSON.stringify({
        schema: 'ledger.v1',
        concept_id: PSD_HESSIAN_CONVEXITY_V1.concept_id,
        message_id: 'm',
        elements: [{ id: target, level: 3, evidence, confidence: 0.9 }],
      });
    };
    const ELSEWHERE = 'the side channel lets me ask the agent privately without the whole group reading it';
    const ANSWER = 'the side channel is a private thread with one agent that the rest of the group never sees';
    const h = build({}, null, reply);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    target = decisions(h).find((d) => d.decided_by === 'rule:max_followup')!.target_element_id;
    expect(target).not.toBeNull();
    const level = () => h.store.ledger.forSession(h.sessionId).find((r) => r.element_id === target)!.level;

    // A long claim about the same element, typed in another thread while Max's question waits.
    await settle(h.clock, h.actor.sendMessage(ELSEWHERE, SPAN));
    expect(level()).toBe(2);

    // The answer in the question's own thread is the reply the brief means.
    await settle(h.clock, h.actor.sendMessage(ANSWER, DOC));
    expect(level()).toBe(3);
  });
});

// ── §4.5 (2026-10-01): after a release, the easier question is a fill-in-the-blank ─────────

describe('the fill-in-the-blank after a release', () => {
  const BLANK = 'Fill in the blank: the side channel is private from the rest of the ____.';
  const asksBlank = (request: LlmRequest) =>
    request.meta.scope === 'group' && request.messages.at(-1)!.content.includes('ASK ONE FILL-IN-THE-BLANK');
  const marksBlank = (request: LlmRequest) =>
    request.meta.scope === 'group' && request.messages.at(-1)!.content.includes('YOUR QUESTION WAS A FILL-IN-THE-BLANK');

  async function withBlankOpen(feedback = 'Well done. "The side channel is private from the rest of the group." p. 3.') {
    const h = build({}, null, (request) => (asksBlank(request) ? BLANK : marksBlank(request) ? feedback : null));
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await settle(h.clock, h.actor.sendMessage('what does forwarding cost?', DOC));
    return h;
  }

  it('asks for one blank, and tells Max how to write it', async () => {
    const h = await withBlankOpen();
    const prompt = prompts(h).find((p) => p.includes('ASK ONE FILL-IN-THE-BLANK'))!;
    expect(prompt).toContain('fill-in-the-blank');
    expect(prompt).toContain('One blank only');
    expect(flat(prompt)).toContain('one key term replaced by ____');
    expect(h.actor.docThreads().find((t) => t.quiz)?.quiz?.form).toBe('cloze');
  });

  it('records the verdict as a cloze, which fills nothing, and does not run the ledger on it', async () => {
    const h = await withBlankOpen();
    const ledgerCalls = () => h.llm.requests.filter((r) => r.meta.scope === 'ledger').length;
    const before = ledgerCalls();
    await settle(h.clock, h.actor.sendMessage('group', DOC));

    expect(rules(h).at(-1)).toBe('rule:quiz_feedback');
    const verdicts = h.doc.outcomes.filter((o) => o.kind === 'verdict');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ verdict: 'complete', form: 'cloze' });
    expect(progressFill(verdicts.map((o) => ({ ...o, id: 'x', contentSha: 's', createdAt: 't' })))).toBe(0);
    expect(ledgerCalls()).toBe(before);
    expect(prompts(h).at(-1)).toContain('YOUR QUESTION WAS A FILL-IN-THE-BLANK');
  });

  /** The scripted follow-up has no blank in it, and a question with no blank is an open question. */
  it('marks the question as open when Max wrote no blank, so a fill is not withheld', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await settle(h.clock, h.actor.sendMessage('what does forwarding cost?', DOC));
    const quiz = h.actor.docThreads().find((t) => t.quiz)?.quiz;
    expect(quiz?.open).toBe(true);
    expect(quiz?.form).toBeUndefined();
  });

  it('asks for own words after a filled blank, not something harder', async () => {
    const h = await withBlankOpen();
    await settle(h.clock, h.actor.sendMessage('group', DOC));
    await settle(h.clock, h.actor.sendMessage('and what is forwarding?', DOC));
    const last = prompts(h).filter((p) => p.includes('HOW HARD THIS QUESTION SHOULD BE')).at(-1)!;
    expect(last).toContain('Now ask for it in their own words');
    expect(last).not.toContain('You may go harder');
  });
});

// ── 2026-10-03: two open follow-ups, then a blank; a guess gets a blank ────────────────────

describe('the follow-up after Partly there', () => {
  const marking = (request: LlmRequest) =>
    request.meta.scope === 'group' && request.messages.at(-1)!.content.includes('WHICH IS WHAT YOU MARK');
  const reply: Reply = (request) => {
    if (!marking(request)) return null;
    const prompt = request.messages.at(-1)!.content;
    if (prompt.includes('**ask nothing**')) return 'Partly there. You have who can read it; the rest is on p. 3. Press Show me, or try once more.';
    return 'Partly there. You have part of it, p. 3. Who else can read it?';
  };
  const ANSWERS = [
    'the side channel is a private thread with one agent',
    'the agent can read it but nobody else in the room',
  ];

  it('asks one open follow-up, and marks the second try with the first', async () => {
    const h = build({}, null, reply);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage(ANSWERS[0]!, DOC));
    expect(prompts(h).at(-1)).not.toContain('THIS IS THEIR TRY');
    expect(flat(prompts(h).at(-1)!)).toContain('your last sentence is one follow-up question on the gap');
    expect(h.actor.pendingQuizView()!.quiz.showMe).toBe(false);

    await settle(h.clock, h.actor.sendMessage(ANSWERS[1]!, DOC));
    const second = flat(prompts(h).at(-1)!);
    expect(second).toContain('THIS IS THEIR TRY 2');
    expect(second).toContain('taken together');
  });

  /**
   * 2026-10-06 (D3, `collab-doc.md` §4.2 amended): after the second answer that is not Well done,
   * Max asks nothing smaller, never a blank, and offers Show me. It reverses 2026-10-03's blank.
   */
  it('offers Show me after the second partial, with no blank, and Show me releases it as revisit', async () => {
    const h = build({}, null, reply);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    for (const answer of ANSWERS) await settle(h.clock, h.actor.sendMessage(answer, DOC));
    const second = flat(prompts(h).at(-1)!);
    expect(second).toContain('**ask nothing**');
    expect(second).toContain('Show me');
    expect(second).not.toContain('Fill in the blank');
    expect(h.actor.flowSnapshot().pendingQuiz?.followUpBlank).toBe(false);
    expect(h.actor.pendingQuizView()!.quiz.showMe).toBe(true);
    expect(h.actor.docThreads().find((t) => t.quiz)!.quiz!.showMe).toBe(true);

    const released = await settle(h.clock, h.actor.pass(DOC));
    expect(released).toEqual({ released: true, refused: null });
    const resolve = h.doc.edits.flatMap((e) => e.batch.ops).find((op) => op.op === 'resolve_q');
    expect(resolve).toMatchObject({ resolution: 'partly_yours', blocks: [], learnerAnswer: null });
    expect(h.actor.pendingQuizView()!.quiz).toMatchObject({ answerShown: true, showMe: false });
  });

  it('answers a guess with the offer of Show me, on the first try', async () => {
    const h = build({}, null, reply);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage(':action ?', DOC));
    const prompt = flat(prompts(h).at(-1)!);
    expect(prompt).toContain('they are guessing at what you want');
    expect(prompt).toContain('**ask nothing**');
    expect(prompt).not.toContain('taken together');
  });
});

// ── 2026-10-06 (D3): the words agree with the record ─────────────────────────────────────

describe('one verdict per message, and it is the logged one', () => {
  const marking = (request: LlmRequest) =>
    request.meta.scope === 'group' && request.messages.at(-1)!.content.includes('WHICH IS WHAT YOU MARK');

  /** The 2026-10-05 turn: Well done first, then the page read again, then Not yet. */
  it('stores the cautious verdict of two, and logs that one', async () => {
    const h = build({}, null, (r) =>
      marking(r)
        ? '**Well done.** p. 3: "private from the rest". Wait, the page puts it the other way round. **Not yet.**'
        : null,
    );
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('the side channel is public to the whole group', DOC));
    const feedback = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(feedback.body.startsWith('**Not yet.** p. 3:')).toBe(true);
    expect(feedback.body).not.toMatch(/well done/i);
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict').map((o) => o.verdict)).toEqual(['not_yet']);
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);
  });

  it('drops the "Why…?" tail after a Well done, and the answer earned is the learner’s alone', async () => {
    const h = build({}, null, (r) =>
      marking(r) ? 'Well done. It is private from the rest of the group, p. 3. Why does that keep the main thread clean?' : null,
    );
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('a private thread, out of everyone else’s view', DOC));
    const feedback = h.store.messages.forRoom(h.roomId).at(-1)!;
    expect(feedback.body).toBe('Well done. It is private from the rest of the group, p. 3.');
    const resolve = h.doc.edits.flatMap((e) => e.batch.ops).find((op) => op.op === 'resolve_q');
    expect(resolve).toMatchObject({
      resolution: 'you_got_this',
      blocks: [],
      learnerAnswer: 'a private thread, out of everyone else’s view',
    });
  });
});

// ── §5.5 (2026-10-01): an answer typed inside Max's Q block ───────────────────────────────

describe('answerInPlace', () => {
  const ANSWER = 'the learner pays it, at the moment they decide whether to forward';
  const questionId = (h: ReturnType<typeof build>) => h.actor.docThreads().find((t) => t.quiz)!.quiz!.questionId;

  it('marks it as an attempt on the open question, in the thread Max asked in', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const result = await settle(h.clock, h.actor.answerInPlace({ questionId: questionId(h), blockId: 'b_ans', text: ANSWER }));

    expect(result).toEqual({ accepted: true, threadId: DOC, reason: null });
    expect(rules(h).at(-1)).toBe('rule:quiz_feedback');
    const row = h.store.messages.forRoom(h.roomId).find((m) => m.body === ANSWER)!;
    expect(row.kind).toBe('doc_text');
    expect(row.anchor_id).toBe(DOC);
    const verdicts = h.doc.outcomes.filter((o) => o.kind === 'verdict');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.source).toBe('doc_text');
    expect(prompts(h).at(-1)).toContain('THIS ANSWER WAS WRITTEN IN THE DOCUMENT');
  });

  it('takes a one-word answer: a Submit is an attempt, whatever its length', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const result = await settle(h.clock, h.actor.answerInPlace({ questionId: questionId(h), blockId: 'b_ans', text: 'privacy' }));
    expect(result.accepted).toBe(true);
    expect(rules(h).at(-1)).toBe('rule:quiz_feedback');
  });

  it('releases the answer on a give-up phrase, as the chat does', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.answerInPlace({ questionId: questionId(h), blockId: 'b_ans', text: 'I give up' }));
    expect(rules(h).at(-1)).toBe('rule:answer_released');
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toEqual([]);
  });

  it('refuses an answer to a question that is not the open one, and writes nothing', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const before = h.store.messages.forRoom(h.roomId).length;
    expect(await h.actor.answerInPlace({ questionId: 'q_other', blockId: 'b_ans', text: ANSWER })).toEqual({
      accepted: false,
      threadId: null,
      reason: 'not_open',
    });
    expect((await h.actor.answerInPlace({ questionId: questionId(h), blockId: 'b_ans', text: '  ' })).reason).toBe('empty');
    expect(h.store.messages.forRoom(h.roomId)).toHaveLength(before);
  });

  it('refuses once the question has been released', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const id = questionId(h);
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    expect((await h.actor.answerInPlace({ questionId: id, blockId: 'b_ans', text: ANSWER })).reason).toBe('not_open');
  });
});

// ── §5.6 (2026-10-01): the learner's own question ─────────────────────────────────────────

describe('markOwnQuestion', () => {
  const OWN = { anchorId: SPAN, questionId: 'q_own1', blockId: 'b_q', question: 'Why is the side channel private?', answer: 'Because only one agent sees the turn and the group never does.' };
  const marks = (request: LlmRequest) =>
    request.meta.scope === 'group' && request.messages.at(-1)!.content.includes('THE LEARNER WROTE THIS QUESTION THEMSELVES');

  function own(verdict: string, over: Partial<DocPort> = {}) {
    const doc = docPort(over);
    const h = build({ docPort: doc.port }, null, (request) => (marks(request) ? verdict : null));
    return { ...h, doc };
  }

  it('has Max mark it, shown the question and the answer, and files nothing', async () => {
    const h = own('Partly there. It is private from the group, p. 3: "A private turn with one agent."');
    const ledgerCalls = () => h.llm.requests.filter((r) => r.meta.scope === 'ledger').length;
    const result = await settle(h.clock, h.actor.markOwnQuestion(OWN));

    expect(result).toEqual({ accepted: true, reason: null });
    expect(rules(h)).toEqual(['rule:own_question']);
    expect(decisions(h)[0]!.move_type).toBe('own_question_feedback');
    const prompt = prompts(h).at(-1)!;
    expect(prompt).toContain(OWN.question);
    expect(prompt).toContain(OWN.answer);
    // No outcome row, so no fill and nothing for the pitch; no ledger run; nothing to the notes.
    expect(h.doc.outcomes).toEqual([]);
    expect(ledgerCalls()).toBe(0);
    expect(h.doc.edits).toEqual([]);
    expect(h.actor.pendingQuizView()).toBeNull();
  });

  it('closes the learner’s Q block on a Well done, writing nothing under it', async () => {
    const h = own('Well done. p. 3: "A private turn with one agent."', { hasQuestion: (id) => id === OWN.questionId });
    await settle(h.clock, h.actor.markOwnQuestion(OWN));

    expect(h.doc.edits).toHaveLength(1);
    const batch = h.doc.edits[0]!.batch;
    expect(batch.cause).toBe('q_resolved');
    expect(batch.ops).toEqual([
      { op: 'resolve_q', questionId: OWN.questionId, resolution: 'you_got_this', blocks: [], learnerAnswer: null },
    ]);
    expect(h.doc.outcomes).toEqual([]);
  });

  it('leaves Max’s own open question open and unmarked', async () => {
    const h = own('Not yet. The deck says otherwise, p. 3: "A private turn with one agent."');
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const open = h.actor.pendingQuizView()!;
    await settle(h.clock, h.actor.markOwnQuestion(OWN));

    expect(rules(h).at(-1)).toBe('rule:own_question');
    expect(h.actor.pendingQuizView()).toEqual(open);
    expect(h.doc.outcomes).toEqual([]);
  });

  it('refuses a question with no text, or no answer', async () => {
    const h = own('Well done.');
    expect((await h.actor.markOwnQuestion({ ...OWN, question: ' ' })).reason).toBe('no_question');
    expect((await h.actor.markOwnQuestion({ ...OWN, answer: '' })).reason).toBe('empty');
    expect(rules(h)).toEqual([]);
  });
});

// ── §4.8 (2026-10-01): where to look next, when the sitting goes idle ─────────────────────

describe('the focus recap', () => {
  const view = (fills: (0 | 0.5 | 1)[]): ProgressView => ({
    fileId: 'f_1',
    docId: 'doc_1',
    status: 'ready',
    completed: fills.filter((f) => f === 1).length,
    total: fills.length,
    fraction: 0,
    objectives: fills.map((fill, i) => ({
      objectiveId: `o_${String(i)}`,
      title: `Objective ${String(i)}`,
      statement: '',
      criteria: [],
      pages: [i + 3],
      blockIds: [],
      fill,
      level: 0,
      assumedByDeck: false,
      evidence: null,
      lastMovedAt: null,
    })),
  });
  const recaps = (h: ReturnType<typeof build>) =>
    h.store.messages.forRoom(h.roomId).filter((m) => m.decided_by === 'rule:focus_recap');

  function withProgress(outcomesAt: (now: number) => QuizOutcome[]) {
    const ref: { clock: FakeClock | null } = { clock: null };
    const h = build({
      fileProgress: async () => ({ view: view([1, 0, 0.5]), outcomes: outcomesAt(ref.clock!.now()) }),
    });
    ref.clock = h.clock;
    return h;
  }
  const released = (now: number): QuizOutcome[] => [
    {
      id: 'qo_x', contentSha: 's', roomId: 'r', objectiveId: 'o_1', questionId: 'q', kind: 'released',
      verdict: null, releasedBy: 'closure', messageId: null, source: 'chat', attemptIndex: null,
      ownWords: null, createdAt: new Date(now).toISOString(),
    },
  ];

  it('posts one message from Ellie in the doc chat when the sitting goes idle, after the release', async () => {
    const h = withProgress(released);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await h.clock.run(21 * 60_000);
    await h.clock.run(60_000);

    expect(rules(h)).toContain('rule:closure');
    const posted = recaps(h);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.anchor_id).toBe(DOC);
    expect(posted[0]!.participant_id).toBe(h.store.participants.byAgentKey(h.roomId, 'peer.ellie')!.id);
    expect(posted[0]!.body).toContain('Where this file stands: 1 of 3 objectives complete.');
    expect(posted[0]!.body).toContain('- Answer shown, worth another try: **Objective 1** (p. 4)');
    expect(posted[0]!.body).toContain('- Partly there: **Objective 2** (p. 5)');
    // The recap is the last thing in the room: it comes after Max's release, not before it.
    expect(h.store.messages.forRoom(h.roomId).at(-1)!.id).toBe(posted[0]!.id);

    // Once per sitting: more idle time posts nothing more.
    await h.clock.run(5 * 60_000);
    expect(recaps(h)).toHaveLength(1);
  });

  it('calls no model for it', async () => {
    const h = withProgress(released);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    const calls = h.llm.requests.length;
    await h.clock.run(22 * 60_000);
    expect(recaps(h)).toHaveLength(1);
    expect(h.llm.requests).toHaveLength(calls);
  });

  it('says nothing about a sitting in which no question was resolved', async () => {
    const h = withProgress(() => []);
    await settle(h.clock, h.actor.sendMessage('@Ellie what is the side channel?', DOC));
    await h.clock.run(22 * 60_000);
    expect(recaps(h)).toEqual([]);
  });

  it('is not posted a second time when the file is reopened with the sitting still closed', async () => {
    const h = withProgress(released);
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await h.clock.run(22 * 60_000);
    expect(recaps(h)).toHaveLength(1);

    const stored = h.actor.flowSnapshot();
    h.actor.stop();
    const again = relaunch(h, { flowState: stored, fileProgress: async () => ({ view: view([1, 0, 0.5]), outcomes: released(h.clock.now()) }) });
    await h.clock.run(60_000);
    expect(recaps(h)).toHaveLength(1);
    again.stop();
  });
});

// ── §5.7 (2026-10-01): a table or a diagram, asked for at a block ──────────────────────────

describe('generateBlock', () => {
  const TABLE = {
    make: true,
    why: 'Who sees a private turn.',
    table: { columns: ['Who', 'Sees it'], rows: [{ cells: ['The agent', 'yes'] }, { cells: ['The group', 'no'] }] },
  };

  it('emits one agent edit from Ellie after the block, outside any turn', async () => {
    const h = build({}, TABLE);
    const out = await h.actor.generateBlock({ blockId: 'b_bbb', kind: 'table', instruction: null });

    expect(out.inserted).toBe(true);
    expect(out.reason).toBeNull();
    expect(h.doc.edits).toHaveLength(1);
    const batch = h.doc.edits[0]!.batch;
    expect(batch.editId).toBe(out.editId);
    expect(batch.author).toBe('ellie');
    expect(batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_bbb' });
    expect(h.events.filter((e) => e.type === 'doc.edit')).toHaveLength(1);
    // No message, no decision, no outcome: it is the learner's act on the document, not a turn.
    expect(h.store.messages.forRoom(h.roomId)).toEqual([]);
    expect(rules(h)).toEqual([]);
    expect(h.doc.outcomes).toEqual([]);
  });

  it('shows the model the section the block is in', async () => {
    const h = build({}, TABLE);
    await h.actor.generateBlock({ blockId: 'b_bbb', kind: 'table', instruction: 'who can see it', passage: 'SLIDE THREE TEXT' });
    const prompt = h.llm.requests.find((r) => r.meta.scope === 'docedit')!.system[0]!.text;
    expect(prompt).toContain('A private turn with one agent.');
    expect(prompt).toContain('SLIDE THREE TEXT');
    expect(prompt).toContain('who can see it');
  });

  it('refuses while the doc is frozen, and makes no call', async () => {
    const frozen = docPort({ frozen: () => true });
    const h = build({ docPort: frozen.port }, TABLE);
    expect(await h.actor.generateBlock({ blockId: 'b_bbb', kind: 'table', instruction: null })).toEqual({
      inserted: false,
      editId: null,
      reason: 'frozen',
    });
    expect(h.llm.requests).toEqual([]);
  });

  it('reports a decline and a bad reply without inserting anything', async () => {
    const declined = build({}, { make: false, why: 'nothing to compare' });
    expect((await declined.actor.generateBlock({ blockId: 'b_bbb', kind: 'diagram', instruction: null })).reason).toBe('declined');
    expect(declined.doc.edits).toEqual([]);

    const bad = build({}, { make: true, why: 'x', diagram: { layout: 'flow', nodes: [{ id: 'a', label: 'only one' }] } });
    expect((await bad.actor.generateBlock({ blockId: 'b_bbb', kind: 'diagram', instruction: null })).reason).toBe('failed');
    expect(bad.doc.edits).toEqual([]);
  });

  it('refuses a second request while one is still out', async () => {
    const h = build({}, TABLE);
    const first = h.actor.generateBlock({ blockId: 'b_bbb', kind: 'table', instruction: null });
    const second = await h.actor.generateBlock({ blockId: 'b_bbb', kind: 'table', instruction: null });
    expect(second.reason).toBe('in_flight');
    expect((await first).inserted).toBe(true);
  });
});

// ── 2026-10-06 decision (D3): a blank that gives its answer away is not sent ─────────────────

/**
 * W1's check (2026-10-06, D3; `core/pitch.blankGiveaway`), on the one blank left: the easier
 * question Quiz me asks after a release (§4.5). A run of *Partly there* no longer ends on a blank
 * (it offers Show me), so the check is exercised here rather than on a follow-up.
 */
describe('the blank that gives its answer away', () => {
  const GIVEN_AWAY =
    'p. 3: "The side channel is private from the rest of the group." ' +
    'Fill in the blank: p. 3: "The side channel is private from the rest of the ____."';
  const CLEAN = 'Fill in the blank: the side channel is private from the rest of the ____.';
  const OPEN = 'Who is kept out of the side channel, besides the one agent?';
  const asking = (request: LlmRequest) =>
    request.meta.scope === 'group' &&
    (request.meta.agentKey ?? '').startsWith('challenger') &&
    !request.messages.at(-1)!.content.includes('WHICH IS WHAT YOU MARK') &&
    /fill-in-the-blank/i.test(request.messages.at(-1)!.content);

  /** Max's question after the release is a blank; `second` is what he writes when told it gave it away. */
  function reply(second: string): Reply {
    return (request) => {
      if (!asking(request)) return null;
      const prompt = request.messages.at(-1)!.content;
      if (prompt.includes('NO FILL-IN-THE-BLANK THIS TIME')) return OPEN;
      if (prompt.includes('YOUR LAST DRAFT GAVE THE BLANK AWAY')) return second;
      return GIVEN_AWAY;
    };
  }

  async function afterRelease(second: string) {
    const h = build({}, null, reply(second));
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await settle(h.clock, h.actor.sendMessage('and who can read it?', DOC));
    return h;
  }

  const askingPrompts = (h: ReturnType<typeof build>) => h.llm.requests.filter(asking).map((r) => r.messages.at(-1)!.content);

  it('writes the question again once, saying what to leave out, and sends the second draft', async () => {
    const h = await afterRelease(CLEAN);
    const drafts = askingPrompts(h);
    expect(drafts).toHaveLength(2);
    const again = flat(drafts.at(-1)!);
    expect(again).toContain('YOUR LAST DRAFT GAVE THE BLANK AWAY');
    expect(again).toContain('do not use "group"');
    expect(bodies(h)).toContain(CLEAN);
    expect(bodies(h)).not.toContain(GIVEN_AWAY);
    expect(h.actor.flowSnapshot().pendingQuiz?.form).toBe('cloze');
  });

  it('drops the blank for an open question when the second draft gives it away too', async () => {
    const h = await afterRelease(GIVEN_AWAY);
    const drafts = askingPrompts(h);
    expect(drafts).toHaveLength(3);
    expect(flat(drafts.at(-1)!)).toContain('NO FILL-IN-THE-BLANK THIS TIME');
    expect(bodies(h)).toContain(OPEN);
    expect(bodies(h)).not.toContain(GIVEN_AWAY);
    expect(h.actor.flowSnapshot().pendingQuiz?.form).not.toBe('cloze');
  });

  /** 2026-10-06 (D4): a question closed by a correct blank is revisit, never you got this. */
  it('closes a question answered by a correct blank as revisit', async () => {
    const h = build({}, null, (r) => {
      if (asking(r)) return CLEAN;
      if (r.meta.scope === 'group' && r.messages.at(-1)!.content.includes('WHICH IS WHAT YOU MARK')) {
        return 'Well done. "Private from the rest of the group." p. 3.';
      }
      return null;
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    await settle(h.clock, h.actor.sendMessage('I give up', DOC));
    await settle(h.clock, h.actor.sendMessage('and who can read it?', DOC));
    expect(h.actor.flowSnapshot().pendingQuiz?.form).toBe('cloze');
    await settle(h.clock, h.actor.sendMessage('group', DOC));
    const resolves = h.doc.edits.flatMap((e) => e.batch.ops).filter((op) => op.op === 'resolve_q');
    expect(resolves.at(-1)).toMatchObject({ resolution: 'revisit', blocks: [], learnerAnswer: null });
  });
});

