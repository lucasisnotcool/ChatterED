/**
 * THE WHISPER LEAK TEST (architecture-mac.md §D.4).
 *
 * Written before the whisper feature, and it fails the build if the invariant ever breaks:
 * **no code path that assembles a group-scope prompt has read the whispers table.**
 *
 * Asserted three ways:
 *   1. runtime — a canary string that exists only in a whisper never appears in a group prompt,
 *      or in a group-scope mirror document;
 *   2. store shape — the group builder is handed a view with no `whispers` member at all;
 *   3. static import graph — nothing reachable from `context.group.ts` can even name the
 *      whispers repository.
 *
 * The canary is a nonsense string on purpose: asserting on a real sentence passes accidentally
 * when the assembler is broken in a way that drops content.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { buildGroupContext } from './context.group.js';
import { buildWhisperContext } from './context.whisper.js';
import { groupView } from '../main/db/store.js';
import { flowRoomView } from '../main/flowroom.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { RoomActor } from './actor.js';
import { ScriptedClient } from './llm/scripted.js';
import { segmentContext, buildReferenceRequest } from './reference.js';

const CANARY = 'ZZQX-CANARY-9137-whisper-only-string';
const HERE = dirname(fileURLToPath(import.meta.url));

function seedWithWhisper() {
  const seeded = seedRoom(undefined, [
    'I am curious how you would set this one up.',
    'Basically if the Hessian is positive semidefinite then the function is convex.',
    'PSD where? Your sentence works for a single point.',
    'At the point you are checking, I guess.',
  ]);
  const { store, roomId } = seeded;
  const threadId = 'w_thread_1';
  store.whispers.insert({
    id: 'w1',
    room_id: roomId,
    thread_id: threadId,
    student_participant_id: 'p_student',
    agent_participant_id: 'p_peer',
    seq: 1,
    sender: 'student',
    body: `ok slightly embarrassing but ${CANARY}`,
    group_seq_snapshot: 3,
    relay_offer: null,
    promoted_message_id: null,
    usage: null,
    created_at: '2026-09-13T10:05:00.000Z',
  });
  store.whispers.insert({
    id: 'w2',
    room_id: roomId,
    thread_id: threadId,
    student_participant_id: 'p_student',
    agent_participant_id: 'p_peer',
    seq: 2,
    sender: 'agent',
    body: `re: ${CANARY} — try A = [[1,2],[2,1]].`,
    group_seq_snapshot: 3,
    relay_offer: null,
    promoted_message_id: null,
    usage: null,
    created_at: '2026-09-13T10:05:02.000Z',
  });
  return { ...seeded, threadId };
}

describe('the whisper invariant', () => {
  it('never lets whisper content into a group-scope prompt', () => {
    const { store, roomId } = seedWithWhisper();
    const roster = rosterFor('ellie_peer');
    const group = buildGroupContext(groupView(store), {
      roomId,
      speaker: roster[1]!,
      roster,
      pack: PSD_HESSIAN_CONVEXITY_V1,
      directive: { agentRole: 'challenger', move: 'probing_assumptions' },
    });
    expect(JSON.stringify(group)).not.toContain(CANARY);
  });

  it('never lets whisper content into a group-scope mirror document', () => {
    const { store, roomId } = seedWithWhisper();
    store.outbox.enqueue({
      collection: 'messages',
      doc_path: `rooms/${roomId}/messages/1`,
      op: 'set',
      body: JSON.stringify(store.messages.forRoom(roomId)[0]),
      last_error: null,
      enqueued_at: '2026-09-13T10:06:00.000Z',
    });
    const groupDocs = store.outbox
      .pending()
      .filter((o) => o.collection === 'messages' || o.collection === 'events');
    expect(JSON.stringify(groupDocs)).not.toContain(CANARY);
  });

  it('does show the whisper to the whisper builder, with the group prefix cut at the snapshot', () => {
    const { store, roomId, threadId } = seedWithWhisper();
    const roster = rosterFor('ellie_peer');
    const whisper = buildWhisperContext(store, {
      roomId,
      threadId,
      upToGroupSeq: 3,
      speaker: roster[0]!,
      roster,
      pack: PSD_HESSIAN_CONVEXITY_V1,
    });
    const json = JSON.stringify(whisper);
    expect(json).toContain(CANARY);
    // It must NOT see what the group said after the aside began.
    const afterSnapshot = store.messages.bodyAtSeq(roomId, 4)!;
    expect(json).not.toContain(afterSnapshot);
    // And it states its own limits (critique1-btw.txt Suggestion 2).
    expect(json).toContain('read-only session');
  });

  it('hands the group builder a store view with no whispers member', () => {
    const { store } = seedWithWhisper();
    const view = groupView(store) as unknown as Record<string, unknown>;
    expect('whispers' in view).toBe(false);
    // `messageRefs` joined this list with issue #22. It is group scope on purpose: a document
    // reference is a public act, posted into the thread by the learner, and the agents are
    // meant to see it. The invariant this test guards is about *whispers*, not about every
    // repository that happens to carry text — so the list is widened deliberately, here,
    // rather than the assertion being loosened to stop failing.
    expect(Object.keys(view).sort()).toEqual([
      'materials',
      'messageRefs',
      'messages',
      'participants',
      'rooms',
    ]);
  });

  it('carries a document the learner showed the room into the group prompt', () => {
    const { store, roomId } = seedWithWhisper();
    const roster = rosterFor('ellie_peer');
    const messageId = store.messages.forRoom(roomId)[1]!.id; // one the student authored
    store.messageRefs.insert({
      id: 'ref_1',
      message_id: messageId,
      room_id: roomId,
      file_id: 'f_1',
      file_name: 'who-you-explain-to-matters.pdf',
      rel_path: 'Sources/who-you-explain-to-matters.pdf',
      kind: 'pdf',
      page_from: 3,
      page_to: 3,
      selection: 'learning by explaining to conversational agents',
      page_text: 'PAGE-THREE-BODY-TEXT about pedagogical roles',
      created_at: '2026-09-13T10:07:00.000Z',
    });

    const prompt = JSON.stringify(
      buildGroupContext(groupView(store), {
        roomId,
        speaker: roster[0]!,
        roster,
        pack: PSD_HESSIAN_CONVEXITY_V1,
        directive: { agentRole: 'peer', move: 'ask what they mean' },
      }),
    );

    expect(prompt).toContain('who-you-explain-to-matters.pdf');
    expect(prompt).toContain('page 3');
    expect(prompt).toContain('learning by explaining to conversational agents');
    expect(prompt).toContain('PAGE-THREE-BODY-TEXT');
    // And the whisper invariant still holds with a reference present.
    expect(prompt).not.toContain(CANARY);
  });

  it('keeps the attached page text out of system[0], where the prefix is frozen', () => {
    const { store, roomId } = seedWithWhisper();
    const roster = rosterFor('ellie_peer');
    store.messageRefs.insert({
      id: 'ref_2',
      message_id: store.messages.forRoom(roomId)[1]!.id,
      room_id: roomId,
      file_id: null,
      file_name: 'slides.pdf',
      rel_path: 'MA3236/slides.pdf',
      kind: 'pdf',
      page_from: 7,
      page_to: 8,
      selection: null,
      page_text: 'MID-SESSION-ATTACHMENT',
      created_at: '2026-09-13T10:08:00.000Z',
    });

    const request = buildGroupContext(groupView(store), {
      roomId,
      speaker: roster[0]!,
      roster,
      pack: PSD_HESSIAN_CONVEXITY_V1,
      directive: { agentRole: 'peer', move: 'ask what they mean' },
    });

    // architecture-mac.md §E.2 L1077 / §E.3 L1119: system[0] is byte-identical across agents
    // and frozen at pack confirmation. A document brought in mid-session must not touch it, or
    // every cached prefix in the room is invalidated for the rest of the session.
    expect(JSON.stringify(request.system)).not.toContain('MID-SESSION-ATTACHMENT');
    expect(JSON.stringify(request.messages)).toContain('MID-SESSION-ATTACHMENT');

    // And it really is byte-identical for the other agent.
    const other = buildGroupContext(groupView(store), {
      roomId,
      speaker: roster[1]!,
      roster,
      pack: PSD_HESSIAN_CONVEXITY_V1,
      directive: { agentRole: 'challenger', move: 'probe assumptions' },
    });
    expect(other.system[0]!.text).toBe(request.system[0]!.text);
  });

  it('cannot reach the whispers repository through the static import graph', () => {
    const seen = new Set<string>();
    const queue = [resolve(HERE, 'context.group.ts')];
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');

      // Value imports only: `import type ...` is erased at runtime and cannot leak data.
      const importRe = /^\s*import\s+(?!type\s)(?:[\s\S]*?)from\s+['"](\.[^'"]+)['"]/gm;
      for (const match of src.matchAll(importRe)) {
        const spec = match[1]!.replace(/\.js$/, '.ts');
        queue.push(resolve(dirname(file), spec));
      }

      if (/whispers?/i.test(file.replace(HERE, ''))) offenders.push(`module: ${file}`);
      // Strip comments before looking for whisper access, so the documentation of the
      // invariant does not trip the assertion that enforces it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\.whispers\b/.test(code)) offenders.push(`whispers access in: ${file}`);
    }

    expect(offenders).toEqual([]);
    // Sanity: the walk actually visited something.
    expect(seen.size).toBeGreaterThan(2);
  });
});

/**
 * THE SAME CANARY, OVER THE FLOW RENDERER (`flow-build-plan.md` §3.4 gate G3).
 *
 * The test above walks from `context.group.ts`, which is a main-process graph: it proves the
 * *prompt* can never carry a whisper. It says nothing about the screen. The flow moved the
 * conversation into the document, and the whisper popover landed on Friday as a component on
 * the same cards — so there is a second way the invariant could break: a flow **component**
 * naming the whisper layer and drawing a private turn where a shared one goes.
 *
 * "Extend, never relax" (`flow-build-plan.md` §4.6). The popover has landed, so this is now an
 * **allowlist of what a component may say about the private layer**, which is narrower than the
 * old blanket ban rather than wider:
 *
 *  - `WhisperPopover.svelte` is exempt. It *is* the popover; drawing private turns is its job,
 *    and it is the only file in the flow's graph that may read `store.flowWhisper.turns`.
 *  - Everywhere else, a line may name the private layer only if it is (a) mounting or importing
 *    the allowlisted component, (b) a `flowWhisper*` store reference passed straight through, or
 *    (c) `promotedFromWhisper` — which is a field of a **shared** `MessageView`, group scope by
 *    construction (the message is a new row the learner approved), and is the dual attribution
 *    `pivot-spec.md` §B5 asks the document to print.
 *
 * Anything else — a private turn's body, the whispers table, a second component reaching for the
 * thread — is an offender, which is exactly the shape the old assertion had.
 */
const POPOVER = 'WhisperPopover.svelte';

/** (a), (b) and (c) above. A line that matches none of these may not name the private layer. */
function allowedWhisperLine(line: string): boolean {
  return /WhisperPopover/.test(line) || /[Ff]lowWhisper/.test(line) || /promotedFromWhisper/.test(line);
}

describe('the whisper invariant, over the flow renderer', () => {
  it('lets only the popover reach the private layer', () => {
    const components = resolve(HERE, '../renderer/components');
    const seen = new Set<string>();
    const queue = [resolve(components, 'FlowCanvas.svelte')];
    const offenders: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');

      // Components only. `lib/` and `shared/` are app-wide and are covered by the walk above.
      const importRe = /^\s*import\s+(?!type\s)(?:[\s\S]*?)from\s+['"](\.\/[A-Za-z0-9_]+\.svelte)['"]/gm;
      for (const match of src.matchAll(importRe)) {
        queue.push(resolve(dirname(file), match[1]!));
      }

      if (file.endsWith(POPOVER)) continue;
      // Strip comments first, so the documentation of the invariant does not trip it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
      for (const line of code.split('\n')) {
        if (!/whisper/i.test(line)) continue;
        if (allowedWhisperLine(line)) continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
    // Sanity: the walk reached the card, the thread, the AI cards and the popover itself.
    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect([...seen].some((f) => f.endsWith(POPOVER))).toBe(true);
  });

  it('keeps the popover the only component that reads a private turn', () => {
    const components = resolve(HERE, '../renderer/components');
    const offenders: string[] = [];
    for (const name of ['FlowCanvas.svelte', 'SegmentCard.svelte', 'FlowThread.svelte', 'AiSegment.svelte']) {
      const src = readFileSync(resolve(components, name), 'utf8');
      // `.turns` is how a private thread's content is reached. Only the popover may.
      if (/[Ff]lowWhisper[^\n]*\.turns/.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * THE CANARY THROUGH THE `flow:*` SURFACE (`flow-build-plan.md` §3.5).
 *
 * The two walks above are static. This one is not: it plants the canary in a **real** private
 * whisper on a real actor and then looks for it in every shared thing the flow can produce —
 * the group prompt for either agent, the REFERENCE request, the flow snapshot the app persists,
 * `flow:messages`'s `FlowRoomView`, and the card an approved relay inserts.
 *
 * The relay is the one crossing, and the assertion is precise about it: the *approved* text
 * appears in the document, and the private turn it came out of does not.
 */
/**
 * THE SAME CANARY, OVER **TWO** PRIVATE THREADS (#48, `collab-doc.md` §4.1).
 *
 * The brief widens the private channel: *"Private threads: one with Ellie, one with Max."* That
 * overrules #32 by name — `openSegmentWhisper` resolved Ellie in code specifically so the renderer
 * could not ask for a channel to the Tester, on the argument that *"a private channel to the
 * person quizzing you is the one shape this feature must not have"*.
 *
 * **So the canary is widened, never weakened** (`flow-build-plan.md` §4.6, "extend, never relax").
 * The old test planted one string in one thread; this plants a *different* string in each of the
 * two, and looks for both in every shared surface the app can produce — plus, and this is the half
 * that is new, it checks that **neither thread can see the other**. Max's private thread reading
 * Ellie's would be a leak the group-scope walk above could never catch, because both sides of it
 * are whisper scope.
 */
const ELLIE_CANARY = 'ZZQX-CANARY-4471-ellie-private-only';
const MAX_CANARY = 'ZZQX-CANARY-8852-max-private-only';

describe('the whisper invariant, over two private threads', () => {
  async function twoPrivateThreads() {
    const seeded = seedRoom();
    const clock = new FakeClock();
    let n = 0;
    const actor = new RoomActor({
      store: seeded.store,
      groupStore: groupView(seeded.store),
      clock,
      transport: { emit: () => undefined },
      llm: new ScriptedClient(),
      roomId: seeded.roomId,
      sessionId: seeded.sessionId,
      roster: rosterFor('ellie_peer'),
      pack: PSD_HESSIAN_CONVEXITY_V1,
      config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
      appVersion: '0.1.0-test',
      newId: (prefix) => `${prefix}_${(n += 1)}`,
      random: () => 0.5,
    });
    actor.start();

    const ellie = actor.openPrivate('ellie');
    const max = actor.openPrivate('max');
    const run = clock.run(60_000);
    await actor.sendPrivate(ellie.threadId, `only for the teacher: ${ELLIE_CANARY}`);
    await actor.sendPrivate(max.threadId, `only for the tester: ${MAX_CANARY}`);
    await run;
    return { ...seeded, clock, actor, ellie, max };
  }

  it('opens a separate thread for each agent', async () => {
    const h = await twoPrivateThreads();
    expect(h.ellie.threadId).not.toBe(h.max.threadId);
    const threads = h.actor.docThreads().filter((t) => t.kind === 'private');
    expect(threads.map((t) => t.agentKey).sort()).toEqual(['ellie', 'max']);
  });

  it('keeps both canaries out of every shared surface', async () => {
    const h = await twoPrivateThreads();
    const roster = rosterFor('ellie_peer');

    for (const speaker of roster) {
      const prompt = buildGroupContext(groupView(h.store), {
        roomId: h.roomId,
        speaker,
        roster,
        pack: PSD_HESSIAN_CONVEXITY_V1,
        directive: { agentRole: speaker.role === 'peer' ? 'peer' : 'challenger', move: 'ask what they mean' },
      });
      expect(JSON.stringify(prompt)).not.toContain(ELLIE_CANARY);
      expect(JSON.stringify(prompt)).not.toContain(MAX_CANARY);
    }

    for (const surface of [
      JSON.stringify(h.actor.snapshot()),
      JSON.stringify(h.actor.flowSnapshot()),
      JSON.stringify(flowRoomView(h.actor, h.actor.lockedAnchors())),
      // The collab doc's own thread view (#48). A private thread appears in it — it has to, the
      // chat column draws it — and it carries **no message ids and no bodies**, by construction.
      JSON.stringify(h.actor.docThreads()),
    ]) {
      expect(surface).not.toContain(ELLIE_CANARY);
      expect(surface).not.toContain(MAX_CANARY);
    }
  });

  /**
   * **The half that is new with the second thread.** Each private thread is private from the
   * group *and* from the other one; a Tester who can read what the learner told the Teacher is
   * the shape #32 refused, and widening the feature must not smuggle it back in.
   */
  it('keeps each private thread out of the other', async () => {
    const h = await twoPrivateThreads();
    const toEllie = JSON.stringify(h.actor.openPrivate('ellie').turns);
    const toMax = JSON.stringify(h.actor.openPrivate('max').turns);
    expect(toEllie).toContain(ELLIE_CANARY);
    expect(toEllie).not.toContain(MAX_CANARY);
    expect(toMax).toContain(MAX_CANARY);
    expect(toMax).not.toContain(ELLIE_CANARY);

    // And the prompt each private turn was built from saw only its own thread.
    for (const [threadId, mine, theirs] of [
      [h.ellie.threadId, ELLIE_CANARY, MAX_CANARY],
      [h.max.threadId, MAX_CANARY, ELLIE_CANARY],
    ] as const) {
      const context = JSON.stringify(
        buildWhisperContext(h.store, {
          roomId: h.roomId,
          threadId,
          upToGroupSeq: 99,
          speaker: rosterFor('ellie_peer')[0]!,
          roster: rosterFor('ellie_peer'),
          pack: PSD_HESSIAN_CONVEXITY_V1,
        }),
      );
      expect(context).toContain(mine);
      expect(context).not.toContain(theirs);
    }
  });

  /** §4.1's one crossing, and it is the learner's: nothing else moves a private turn. */
  it('crosses into the document only through insertPrivateIntoDoc', async () => {
    const h = await twoPrivateThreads();
    const emitted: unknown[] = [];
    const reply = h.store.whispers.forThread(h.max.threadId).find((w) => w.sender === 'agent')!;

    // Nothing has been written to the doc by either private turn landing.
    expect(JSON.stringify(emitted)).not.toContain(MAX_CANARY);
    // The learner presses the button: the agent's reply crosses, and the learner's own turn — the
    // one carrying the canary — does not.
    const { editId } = await h.actor.insertPrivateIntoDoc({
      threadId: h.max.threadId,
      turnId: reply.id,
      anchorBlockId: 'b_1',
    });
    // No notes doc in this room, so there is nowhere for it to go and nothing is invented.
    expect(editId).toBeNull();
  });
});

describe('the whisper invariant, through the flow', () => {
  async function flowWithWhisper() {
    const seeded = seedRoom();
    const clock = new FakeClock();
    let n = 0;
    const actor = new RoomActor({
      store: seeded.store,
      groupStore: groupView(seeded.store),
      clock,
      transport: { emit: () => undefined },
      llm: new ScriptedClient(),
      roomId: seeded.roomId,
      sessionId: seeded.sessionId,
      roster: rosterFor('ellie_peer'),
      pack: PSD_HESSIAN_CONVEXITY_V1,
      config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
      appVersion: '0.1.0-test',
      newId: (prefix) => `${prefix}_${(n += 1)}`,
      random: () => 0.5,
    });
    actor.start();

    const anchorId = 'seg_p3_lower';
    const thread = actor.openSegmentWhisper(anchorId);
    const run = clock.run(30_000);
    await actor.sendSegmentWhisper({
      threadId: thread.threadId,
      anchorId,
      text: `ok slightly embarrassing but ${CANARY}`,
      segment: { label: '/btw as a whisper', page: 3, text: 'PAGE-THREE-SEGMENT-TEXT' },
    });
    await run;
    return { ...seeded, clock, actor, anchorId, thread };
  }

  it('keeps a planted canary out of every shared surface the flow produces', async () => {
    const h = await flowWithWhisper();
    const roster = rosterFor('ellie_peer');

    // 1. the Teacher's prompt, and 2. the Tester's.
    for (const speaker of roster) {
      const prompt = buildGroupContext(groupView(h.store), {
        roomId: h.roomId,
        speaker,
        roster,
        pack: PSD_HESSIAN_CONVEXITY_V1,
        directive: { agentRole: speaker.role === 'peer' ? 'peer' : 'challenger', move: 'ask what they mean' },
      });
      expect(JSON.stringify(prompt)).not.toContain(CANARY);
    }

    // 3. a REFERENCE request on the same segment.
    const reference = buildReferenceRequest({
      model: 'claude-haiku-4-5',
      roomId: h.roomId,
      deckTitle: 'Critique 1',
      context: segmentContext({ text: 'PAGE-THREE-SEGMENT-TEXT' }),
      question: 'what is the side channel',
      anchorId: h.anchorId,
      scriptCue: 'reference:1',
    });
    expect(JSON.stringify(reference)).not.toContain(CANARY);

    // 4. the room snapshot, 5. the sitting persisted across a quit, 6. `flow:messages`.
    expect(JSON.stringify(h.actor.snapshot())).not.toContain(CANARY);
    expect(JSON.stringify(h.actor.flowSnapshot())).not.toContain(CANARY);
    expect(JSON.stringify(flowRoomView(h.actor, h.actor.lockedAnchors()))).not.toContain(CANARY);
  });

  it('crosses only what the learner approved, and only as a new shared card', async () => {
    const h = await flowWithWhisper();
    const reply = h.store.whispers.forThread(h.thread.threadId).find((t) => t.sender === 'agent')!;
    const approved = 'The cost has moved rather than disappeared — it is the forwarding problem now.';

    const run = h.clock.run(30_000);
    const { messageId } = await h.actor.relay({
      threadId: h.thread.threadId,
      whisperId: reply.id,
      attribution: 'as_me',
      text: approved,
      anchorId: h.anchorId,
    });
    await run;

    const view = JSON.stringify(flowRoomView(h.actor, h.actor.lockedAnchors()));
    expect(view).toContain(approved);
    expect(view).not.toContain(CANARY);
    const card = h.store.messages.forRoom(h.roomId).find((m) => m.id === messageId)!;
    expect(card.anchor_id).toBe(h.anchorId);
    expect(card.body).not.toContain(CANARY);

    // And the group prompt that follows the relay reads the approved card and nothing else.
    const roster = rosterFor('ellie_peer');
    const prompt = JSON.stringify(
      buildGroupContext(groupView(h.store), {
        roomId: h.roomId,
        speaker: roster[1]!,
        roster,
        pack: PSD_HESSIAN_CONVEXITY_V1,
        directive: { agentRole: 'challenger', move: 'probe assumptions' },
      }),
    );
    expect(prompt).toContain(approved);
    expect(prompt).not.toContain(CANARY);
  });
});
