/**
 * **The Usage page's aggregation, against a seeded database** (#42 item D).
 *
 * `attribution.test.ts` proves the rows are written correctly; this proves they are *added up*
 * correctly. Every number on that page is a `GROUP BY` in `analytics.ts`, and a page of charts is
 * exactly the kind of surface where an off-by-one in a `SUM` looks plausible — a bar is a bar. So
 * the fixture below is deliberately lopsided and the assertions are arithmetic a reader can do in
 * their head: two documents, one of which is almost all ingest, and two calls that were killed.
 */
import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import { totalTokens, type CostOutcome, type CostScope } from '../../shared/cost.js';
import { CostLedger } from './ledger.js';
import { analytics, median } from './analytics.js';

const SESSION_START = '2026-09-19T12:00:00.000Z';

interface Call {
  scope: CostScope;
  fileId: string | null;
  at: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  model?: string;
  backend?: 'claude-cli' | 'anthropic' | 'scripted';
  ms?: number;
  reportedUsd?: number | null;
  outcome?: CostOutcome;
  roomId?: string | null;
  turnId?: string | null;
  anchorId?: string | null;
}

/**
 * Two decks. `file_deck` has been worked through — a large notes ingest and a conversation on top
 * of it; `file_quiet` was ingested and never opened, which is the shape that makes the
 * ingest/conversation split worth drawing at all.
 */
function seed(extra: Call[] = []) {
  const { db } = openTestDb();
  const ledger = new CostLedger({ db, readSetting: () => undefined, fileForRoom: () => null, startedAt: SESSION_START });
  const write = (c: Call): void => {
    ledger.record({
      scope: c.scope,
      model: c.model ?? 'claude-sonnet-5',
      backend: c.backend ?? 'claude-cli',
      tokens: {
        input: c.input ?? 100,
        output: c.output ?? 50,
        cacheWrite: c.cacheWrite ?? 0,
        cacheRead: c.cacheRead ?? 900,
      },
      fileId: c.fileId,
      roomId: c.roomId ?? null,
      turnId: c.turnId ?? null,
      anchorId: c.anchorId ?? null,
      durationMs: c.ms ?? 1_000,
      reportedUsd: c.reportedUsd === undefined ? 0.002 : c.reportedUsd,
      outcome: c.outcome ?? 'ok',
      at: c.at,
    });
  };

  const calls: Call[] = [
    // The big one-off: three notes windows on the deck that was worked through.
    { scope: 'notes', fileId: 'file_deck', at: '2026-09-17T09:00:00.000Z', input: 4_000, output: 2_000, cacheRead: 40_000, ms: 62_000 },
    { scope: 'notes', fileId: 'file_deck', at: '2026-09-17T09:01:00.000Z', input: 4_000, output: 2_000, cacheRead: 40_000, ms: 58_000 },
    { scope: 'objectives', fileId: 'file_deck', at: '2026-09-17T09:02:00.000Z', input: 2_000, output: 900, cacheRead: 8_000 },
    // …and the conversation since.
    { scope: 'group', fileId: 'file_deck', at: '2026-09-18T10:00:00.000Z', roomId: 'room_1', turnId: 'turn_1', anchorId: 'doc' },
    { scope: 'ledger', fileId: 'file_deck', at: '2026-09-18T10:00:01.000Z', roomId: 'room_1', turnId: 'turn_1', anchorId: 'doc' },
    { scope: 'docedit', fileId: 'file_deck', at: '2026-09-18T10:00:02.000Z', roomId: 'room_1', turnId: 'turn_1', anchorId: 'doc' },
    { scope: 'group', fileId: 'file_deck', at: '2026-09-18T10:05:00.000Z', roomId: 'room_1', turnId: 'turn_2', anchorId: 'doc', model: 'claude-haiku-4-5' },
    // The deck nobody opened.
    { scope: 'notes', fileId: 'file_quiet', at: '2026-09-18T11:00:00.000Z', input: 3_000, output: 1_500, cacheRead: 30_000 },
    // Two calls that never came back, and one the learner stopped.
    { scope: 'notes', fileId: 'file_deck', at: '2026-09-18T11:30:00.000Z', input: 0, output: 0, cacheRead: 0, outcome: 'preempted', reportedUsd: null },
    { scope: 'group', fileId: 'file_deck', at: '2026-09-18T11:31:00.000Z', input: 0, output: 0, cacheRead: 0, outcome: 'error', reportedUsd: null },
    { scope: 'group', fileId: 'file_deck', at: '2026-09-18T11:32:00.000Z', input: 0, output: 0, cacheRead: 0, outcome: 'aborted', reportedUsd: null },
    // A call belonging to no document at all — background work. Invisible at file level by
    // construction, and present in the totals, which is what the two must disagree about.
    { scope: 'ingest', fileId: null, at: '2026-09-18T12:00:00.000Z' },
    ...extra,
  ];
  for (const c of calls) write(c);
  return { db, ledger, deps: { db, sessionStart: SESSION_START } };
}

describe('the totals', () => {
  it('count every call, including the one that belongs to no document', () => {
    const h = seed();
    const a = analytics(h.deps);
    expect(a.total.calls).toBe(12);
    // …and the ranked documents do not, because a row called "(none)" in a list of documents
    // invites the reader to treat it as one.
    const inDocuments = a.documents.reduce((n, d) => n + d.calls, 0);
    expect(inDocuments).toBe(11);
  });

  it('never adds the CLI-reported figure to the rate-card estimate', () => {
    const h = seed();
    const a = analytics(h.deps);
    expect(a.total.reportedUsd).not.toBeNull();
    expect(a.total.reportedUsd).not.toBeCloseTo(a.total.estimatedUsd, 6);
    // Nine of the twelve reported one; the three that were killed did not.
    expect(a.total.reportedCalls).toBe(9);
  });

  it('reports the session window from the launch time, whatever the filter says', () => {
    const h = seed([{ scope: 'group', fileId: 'file_deck', at: '2026-09-19T13:00:00.000Z' }]);
    const a = analytics(h.deps, { since: '2026-09-18T00:00:00.000Z', until: '2026-09-18T23:59:59.000Z' });
    // The filter excludes the 19th; the session figure does not, because it answers "right now".
    expect(a.session.calls).toBe(1);
    expect(a.total.calls).toBeGreaterThan(1);
  });
});

describe('the ranked documents', () => {
  it('ranks by tokens and splits the one-off ingest from the conversation', () => {
    const a = analytics(seed().deps);
    expect(a.documents.map((d) => d.fileId)).toEqual(['file_deck', 'file_quiet']);

    const deck = a.documents[0]!;
    // notes ×2 + objectives + the pre-empted notes call = four ingest calls.
    expect(deck.ingest.calls).toBe(4);
    expect(deck.conversation.calls).toBe(deck.calls - deck.ingest.calls);
    // The two halves are a partition, not two overlapping filters.
    expect(totalTokens(deck.ingest.tokens) + totalTokens(deck.conversation.tokens)).toBe(totalTokens(deck.tokens));
    expect(deck.ingest.estimatedUsd + deck.conversation.estimatedUsd).toBeCloseTo(deck.estimatedUsd, 6);
    // And the point of drawing it: the ingest dwarfs the talking.
    expect(totalTokens(deck.ingest.tokens)).toBeGreaterThan(totalTokens(deck.conversation.tokens) * 10);
  });

  it('shows a deck that was ingested and never opened as all ingest', () => {
    const quiet = analytics(seed().deps).documents.find((d) => d.fileId === 'file_quiet')!;
    expect(quiet.conversation.calls).toBe(0);
    expect(totalTokens(quiet.conversation.tokens)).toBe(0);
    expect(quiet.ingest.calls).toBe(1);
  });

  it('narrows to one document when asked, and the slices narrow with it', () => {
    const a = analytics(seed().deps, { fileId: 'file_quiet' });
    expect(a.documents).toHaveLength(1);
    expect(a.total.calls).toBe(1);
    expect(a.byScope.map((s) => s.key)).toEqual(['notes']);
  });
});

describe('the slices', () => {
  it('are the same rows counted three ways, so the three agree', () => {
    const a = analytics(seed().deps);
    const sum = (slices: { calls: number }[]): number => slices.reduce((n, s) => n + s.calls, 0);
    expect(sum(a.byScope)).toBe(a.total.calls);
    expect(sum(a.byModel)).toBe(a.total.calls);
    expect(sum(a.byBackend)).toBe(a.total.calls);
  });

  it('puts the biggest first, because a breakdown is read to find where the tokens went', () => {
    const a = analytics(seed().deps);
    expect(a.byScope[0]!.key).toBe('notes');
    const totals = a.byScope.map((s) => totalTokens(s.tokens));
    expect([...totals].sort((x, y) => y - x)).toEqual(totals);
  });

  it('groups the day series by the timestamp’s own UTC date, oldest first', () => {
    const a = analytics(seed().deps);
    expect(a.byDay.map((d) => d.day)).toEqual(['2026-09-17', '2026-09-18']);
    expect(a.byDay[0]!.calls).toBe(3);
    expect(a.byDay[1]!.calls).toBe(9);
  });
});

describe('what was killed', () => {
  it('lists every outcome, including the zeroes, and keeps Stop apart from a failure', () => {
    const a = analytics(seed().deps);
    const byOutcome = new Map(a.outcomes.map((o) => [o.outcome, o.calls]));
    expect([...byOutcome.keys()]).toEqual(['ok', 'error', 'aborted', 'preempted']);
    expect(byOutcome.get('ok')).toBe(9);
    expect(byOutcome.get('error')).toBe(1);
    expect(byOutcome.get('aborted')).toBe(1);
    expect(byOutcome.get('preempted')).toBe(1);
  });
});

describe('the cache panel', () => {
  it('measures the hit share against fresh input, not against everything', () => {
    const a = analytics(seed().deps);
    expect(a.cache.cacheRead).toBeGreaterThan(a.cache.freshInput);
    expect(a.cache.hitShare).toBeCloseTo(a.cache.cacheRead / (a.cache.cacheRead + a.cache.freshInput), 6);
    expect(a.cache.hitShare).toBeGreaterThan(0.8);
  });

  it('reads zero rather than NaN on an empty ledger', () => {
    const { db } = openTestDb();
    const a = analytics({ db, sessionStart: SESSION_START });
    expect(a.cache.hitShare).toBe(0);
    expect(a.total.calls).toBe(0);
    expect(a.documents).toEqual([]);
    expect(a.byDay).toEqual([]);
    expect(a.cliWindow).toBeNull();
    expect(a.mode).toBe('none');
    // The outcome panel still has its four rows: a panel whose shape changes is a panel a reader
    // cannot learn.
    expect(a.outcomes).toHaveLength(4);
  });
});

describe('the recent-call panels', () => {
  it('order by what each is about and cap at ten', () => {
    const a = analytics(seed().deps);
    expect(a.slowest.length).toBeLessThanOrEqual(10);
    expect(a.slowest[0]!.durationMs).toBe(62_000);
    expect(a.priciest[0]!.scope).toBe('notes');
    const usd = a.priciest.map((c) => c.estimatedUsd);
    expect([...usd].sort((x, y) => y - x)).toEqual(usd);
  });
});

describe('the filter menu', () => {
  it('lists every document the ledger knows, whatever the current filter is', () => {
    const a = analytics(seed().deps, { fileId: 'file_quiet' });
    expect(a.knownFiles.map((f) => f.fileId).sort()).toEqual(['file_deck', 'file_quiet']);
  });
});

describe('the 5-hour window', () => {
  it('is null when nothing recent went through the CLI, and is not narrowed by the filters', () => {
    const now = Date.parse('2026-09-19T13:00:00.000Z');
    const h = seed([{ scope: 'group', fileId: 'file_deck', at: '2026-09-19T12:30:00.000Z' }]);
    const recent = analytics({ ...h.deps, now: () => now }, { fileId: 'file_quiet' });
    // `file_quiet` has nothing in the last five hours, and the window still reports the machine's.
    expect(recent.cliWindow?.calls).toBe(1);
    expect(recent.total.calls).toBe(1);

    const later = analytics({ ...h.deps, now: () => now + 30 * 3_600_000 });
    expect(later.cliWindow).toBeNull();
  });
});

describe('median', () => {
  it('is the middle of an odd list and the mean of the middle two of an even one', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
