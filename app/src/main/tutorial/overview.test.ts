/**
 * The overview reads lecture sources only (`tutorials.md` §1, `TUTORIAL-CONTRACT.md` S1): a
 * tutorial sheet and its solutions in the notebook change nothing about the overview's call, its
 * fingerprint, or its banner. And the part records keep the learner's half through a re-read.
 */
import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { notesRepo } from '../db/repos/notes.js';
import { notebookContentKey } from '../../shared/notebook.js';
import type { LLMClient, LlmRequest } from '../../room/llm/types.js';
import { EMPTY_USAGE } from '../../room/llm/types.js';
import { API_PLAN } from '../../room/llm/models.js';
import { ensureOverview, overviewInFlight, readySources } from '../notes/overviewingest.js';
import { fakeNotebook, slides } from '../notes/fakenotebook.test-support.js';
import { tutorialRepo } from './repo.js';

const NB = 'nb_0123456789ab';

const ANSWER = JSON.stringify({
  title: 'Planning',
  lede: { text: 'Planning when the world is big. Heuristics make it tractable.', pages: [1, 2] },
  objectives: [1, 2, 3, 4].map((p) => ({ title: `Objective ${p}`, statement: 's', criteria: ['a', 'b'], quizSeeds: ['Why?'], pages: [p] })),
  sections: [1, 2, 3, 4, 5].map((p) => ({
    heading: `Section ${p}`,
    pages: [p],
    takeaway: 'The point.',
    ideas: [{ text: `An idea on page ${p}.`, pages: [p] }],
    recommendation: null,
  })),
  next: null,
  greeting: 'Hi.',
  starterQuestions: ['One?', 'Two?', 'Three?'],
});

describe('the overview and roles', () => {
  it('is written from lecture sources only, and its fingerprint ignores tutorials and solutions', async () => {
    const { db, store } = openTestDb();
    const nb = fakeNotebook(NB, [
      { fileId: 'f_lecture', name: 'Lecture.pdf', pageBase: 0, pages: slides(6, 'heuristics') },
      { fileId: 'f_tut', name: 'Tutorial 1.pdf', pageBase: 6, pages: ['Problem 1 SHEETONLY give a plan'], role: 'tutorial' },
      { fileId: 'f_sol', name: 'Tutorial 1 Solutions.pdf', pageBase: 7, pages: ['SECRETANSWER'], role: 'solutions', keyFor: 'f_tut' },
    ]);
    expect(readySources(nb.subject()).map((s) => s.fileId)).toEqual(['f_lecture']);
    const calls: LlmRequest[] = [];
    const llm: LLMClient = {
      kind: 'anthropic',
      async complete(request) {
        calls.push(request);
        return { text: ANSWER, model: 'claude-sonnet-5', usage: EMPTY_USAGE, ttftMs: 1, backend: 'anthropic' };
      },
    };
    const repo = notesRepo(db);
    await ensureOverview(
      {
        repo,
        objectives: store.objectives,
        llm,
        models: API_PLAN,
        mode: 'live',
        userDataDir: '/nonexistent-user-data',
        notebooks: nb.host,
        emit: () => undefined,
        geometry: async () => [],
        requeueMs: 1,
      },
      { notebookId: NB, roomId: null },
    );
    await overviewInFlight(notebookContentKey(NB));
    expect(calls).toHaveLength(1);
    const message = calls[0]!.messages[0]!.content;
    expect(message).toContain('heuristics');
    expect(message).not.toContain('SHEETONLY');
    expect(message).not.toContain('SECRETANSWER');
    expect(message).not.toContain('Tutorial 1');
    const record = repo.byContentSha(notebookContentKey(NB))!;
    expect(record.ingestStatus).toBe('ready');
    expect(record.overview!.fingerprint).toBe('f_lecture@0');
    expect(nb.subject().fingerprint).toBe('f_lecture@0');
  });
});

describe('tutorial_parts', () => {
  it('keeps the learner\'s half of a record when a re-read lands new keys', () => {
    const { db } = openTestDb();
    const parts = tutorialRepo(db);
    const key = { partId: 'P1', answer: 'a', steps: [], mistakes: [], prerequisites: [], confidence: 'high' as const, from: 'model' as const };
    parts.landParts('doc_1', [{ partId: 'P1', key, links: { notesBlockIds: ['b_1'], pages: [3] }, objectiveIds: ['o'] }], 't0');
    expect(parts.part('doc_1', 'P1')).toMatchObject({ status: 'untried', hintLevel: 0, attempts: 0, checkedBy: null });
    parts.raiseHint('doc_1', 'P1', 2, 't1');
    parts.raiseHint('doc_1', 'P1', 1, 't2');
    expect(parts.recordCheck('doc_1', 'P1', { status: 'partial', checkedBy: 'model' }, 't3')).toMatchObject({
      status: 'partial',
      attempts: 1,
      hintLevel: 2,
    });
    parts.landParts('doc_1', [{ partId: 'P1', key: { ...key, answer: 'b' }, links: { notesBlockIds: [], pages: [] }, objectiveIds: [] }], 't4');
    expect(parts.part('doc_1', 'P1')).toMatchObject({
      key: { answer: 'b' },
      links: { notesBlockIds: [], pages: [] },
      status: 'partial',
      attempts: 1,
      hintLevel: 2,
      checkedBy: 'model',
    });
    parts.reveal('doc_1', 'P1', 't5');
    expect(parts.part('doc_1', 'P1')).toMatchObject({ status: 'revealed', revealedAt: 't5' });
    expect(() => parts.raiseHint('doc_1', 'P1', 4 as never, 't6')).toThrow();
  });
});
