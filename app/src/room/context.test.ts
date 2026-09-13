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
import { seedRoom } from '../test-support/db.js';

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
    expect(Object.keys(view).sort()).toEqual(['materials', 'messages', 'participants', 'rooms']);
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
