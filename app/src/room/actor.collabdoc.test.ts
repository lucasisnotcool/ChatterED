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
import type { AgentDocOpBatch, OutlineEntry, QuizOutcome } from '../shared/doc/types.js';
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

/** A client that answers the doc-edit schema call, and plays the notes script for everything else. */
function client(docEdit: Record<string, unknown> | null = null): LLMClient & { requests: LlmRequest[] } {
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const requests: LlmRequest[] = [];
  return {
    kind: 'scripted',
    requests,
    async complete(request, onDelta, signal) {
      requests.push(request);
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

function build(over: Partial<RoomActorDeps> = {}, docEdit: Record<string, unknown> | null = null) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client(docEdit);
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
    ...over,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm, doc };
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

    const followups = prompts(h).filter((p) => p.includes('ASK ONE FOLLOW-UP QUESTION'));
    expect(followups).toHaveLength(2);
    expect(followups.at(-1)).toContain('YOU HAVE ALREADY ASKED, ON THIS FILE');
    expect(followups.at(-1)).toContain('who pays it now');
    expect(followups.at(-1)).toContain('must not be readable off the question');
  });
});

// ── §4.3: Ellie's cue and Max's prompt ────────────────────────────────────

describe('rule:ellie_cue and rule:max_prompt', () => {
  /** The threshold is `clamp(2 × words / 238 wpm, 120 s, 300 s)`, unchanged from #47 §5. */
  async function silentAfterQuestion() {
    const h = build();
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

  /** §5.1's first clause: *"If the doc already says it, no edit; she points to the block."* */
  it('adds nothing when the planner says the notes already say it', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    expect(h.doc.edits.some((e) => e.batch.cause === 'answer_missing')).toBe(false);
    const idle = h.events.filter((e) => e.type === 'doc.cursor' && e.state === 'idle');
    expect(idle).not.toHaveLength(0);
  });

  it('inserts the missing answer with provenance when the planner says it is missing', async () => {
    const h = build({}, {
      edit: 'insert_after',
      anchor_block_id: 'b_bbb',
      why: 'the notes never say who pays',
      blocks: [{ kind: 'paragraph', text: 'The learner carries the forwarding decision.', prov: { pages: [5], reason: null } }],
    });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));

    const added = h.doc.edits.find((e) => e.batch.cause === 'answer_missing')!;
    expect(added.batch.author).toBe('ellie');
    expect(added.batch.ops[0]).toMatchObject({ op: 'insert_after', anchorBlockId: 'b_bbb' });
    expect(added.batch.why).toBe('the notes never say who pays');
  });

  /** Interview finding: a span thread's edit lands at that span's block, not where it is tidier. */
  it('pins a span thread’s edit to the span’s own block', async () => {
    const h = build({}, {
      edit: 'insert_after',
      anchor_block_id: 'b_aaa',
      why: 'somewhere tidier',
      blocks: [{ kind: 'paragraph', text: 'An addition.', prov: { pages: [3], reason: null } }],
    });
    h.actor.noteSelection(SPAN);
    await settle(
      h.clock,
      h.actor.assessDocText({ anchorId: SPAN, objectiveId: ELEMENT, blockId: 'b_mine', text: 'the cost moves to forwarding, so the learner pays it' }),
    );
    await settle(h.clock, h.actor.sendMessage('so who pays it?', SPAN));

    const added = h.doc.edits.find((e) => e.batch.cause === 'answer_missing');
    if (added) {
      expect(added.batch.ops[0]).toMatchObject({ anchorBlockId: 'b_mine' });
      // And it adds beside the learner's block rather than over it.
      expect(added.batch.ops[0]!.op).toBe('insert_after');
    }
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
   * **Short in the chat, the rest in the notes** (2026-09-23; A1 report §1.4 and DG4). The chat
   * turn is told the short half and not the five-step shape, and the notes edit is given what the
   * learner asked — it has to write the long half, and a 60-word reply is not enough to write it from.
   */
  it('splits Ellie’s answer: the short half in the chat, the question handed to the notes edit', async () => {
    const h = build();
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const ellie = prompts(h)[0]!;
    expect(ellie).toContain('SHORT HERE, THE REST GOES INTO THE NOTES');
    expect(ellie).toContain('about 60 words, 90 at most');
    expect(ellie).not.toContain('use the shape');
    const edit = h.llm.requests.find((r) => r.meta.scope === 'docedit')!;
    const system = edit.system.map((b) => b.text).join('\n');
    expect(system).toContain('WHAT THEY ASKED');
    expect(system).toContain('what is the side channel?');
    expect(system).toContain('Write what the chat left out');
  });

  it('gives the whole answer in the chat when the notes are frozen, since nothing will reach them', async () => {
    const frozen = docPort({ frozen: () => true });
    const h = build({ docPort: frozen.port });
    await settle(h.clock, h.actor.sendMessage('what is the side channel?', DOC));
    const ellie = prompts(h)[0]!;
    expect(ellie).toContain('The notes are frozen, so this answer is the whole of it.');
    expect(ellie).toContain('use the shape');
    expect(ellie).not.toContain('SHORT HERE');
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
  it('posts one Ellie turn that names the objective and asks the learner to begin', async () => {
    const h = build();
    await settle(h.clock, h.actor.startLesson({ objectiveId: ELEMENT, anchorId: DOC, blockId: 'b_bbb' }));

    expect(rules(h)).toEqual(['rule:lesson_start']);
    expect(h.store.messages.forRoom(h.roomId)).toHaveLength(1);
    expect(prompts(h)[0]).toContain('THE LEARNER PRESSED START ON A LESSON');
    expect(prompts(h)[0]).toContain('Do not teach it yet');
    // It opens no question, so Max is not waiting on anything.
    expect(h.actor.pendingQuizView()).toBeNull();
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
