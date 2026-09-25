import { describe, expect, it } from 'vitest';
import {
  CSV_COLUMNS,
  applyDelta,
  callLine,
  compactTokens,
  counterLine,
  counterTitle,
  csvFilename,
  failedClause,
  indicatorTitle,
  ingestSplit,
  meterLine,
  meterTitle,
  msLabel,
  partHasCost,
  reportedLine,
  scopeRows,
  sessionChip,
  sessionLine,
  sliceLine,
  tokensLabel,
  toCsv,
  updateBelongs,
  usdApprox,
  usdSuffix,
  usdWithLabel,
  validateRateCard,
  windowChip,
  windowLine,
} from './cost.js';
import {
  emptyTokens,
  modeFor,
  totalTokens,
  type CliWindowBurn,
  type CostCallView,
  type CostMessageCost,
  type CostSlice,
  type CostSummary,
  type CostTokens,
} from '../../shared/cost.js';

function tokens(partial: Partial<CostTokens> = {}): CostTokens {
  return { ...emptyTokens(), ...partial };
}

function summary(partial: Partial<CostSummary> = {}): CostSummary {
  return {
    level: 'thread',
    fileId: 'file-1',
    anchorId: 'seg-1',
    tokens: tokens({ input: 4000, output: 200 }),
    calls: 3,
    estimatedUsd: 0.03,
    reportedUsd: null,
    reportedCalls: 0,
    byModel: [],
    byScope: [],
    byBackend: [],
    windowStart: null,
    firstCallAt: '2026-09-16T10:00:00.000Z',
    lastCallAt: '2026-09-16T10:04:00.000Z',
    mode: 'api',
    rateCardDate: '2026-09-01',
    cliWindow: null,
    backfilledCalls: 0,
    ...partial,
  };
}

function call(partial: Partial<CostCallView> = {}): CostCallView {
  return {
    id: 'c1',
    createdAt: '2026-09-16T10:05:00.000Z',
    scope: 'group',
    model: 'claude-haiku-4-5',
    backend: 'claude-cli',
    tokens: tokens({ input: 1000, output: 100 }),
    estimatedUsd: 0.01,
    reportedUsd: null,
    durationMs: 940,
    roomId: 'room-1',
    fileId: 'file-1',
    anchorId: 'seg-1',
    turnId: 't1',
    backfilled: false,
    // `outcome` became a required field on the view when failed calls started being recorded
    // (`main/cost/client.ts`); without a default here the spread of a `Partial` widens it back
    // to `CostOutcome | undefined` and the factory stops type-checking. Every call this file
    // builds is a call that returned, so 'ok' is the right default.
    outcome: 'ok',
    ...partial,
  };
}

describe('tokens, in the units they are actually written in', () => {
  it('lowercases the thousands and leaves the millions', () => {
    expect(tokensLabel(4200)).toBe('4.2k');
    expect(tokensLabel(61_000)).toBe('61k');
    expect(tokensLabel(1_234_567)).toBe('1.23M');
    expect(tokensLabel(940)).toBe('940');
    expect(tokensLabel(0)).toBe('0');
  });
});

describe('the hedge on a dollar figure', () => {
  it('approximates, because every one of these is arithmetic this app did', () => {
    expect(usdApprox(0.03)).toBe('≈ $0.03');
    expect(usdApprox(12.5)).toBe('≈ $12.50');
  });

  it('does not say "approximately less than"', () => {
    expect(usdApprox(0.002)).toBe('<$0.01');
    expect(usdApprox(0)).toBe('$0.00');
  });
});

describe('the "API-equivalent" rule', () => {
  it('labels the CLI path, always — an unlabelled figure says a student owes money', () => {
    expect(usdSuffix('subscription')).toBe(' API-equivalent');
    expect(usdSuffix('mixed')).toBe(' API-equivalent');
  });

  it('leaves the API path unlabelled, where ≈ already says estimated', () => {
    expect(usdSuffix('api')).toBe('');
    expect(usdSuffix('none')).toBe('');
  });
});

describe('the three counters, worded once', () => {
  it('is the brief’s own thread line', () => {
    expect(counterLine(summary())).toBe('this thread · 4.2k tokens · ≈ $0.03');
  });

  it('is the brief’s own file line, on the CLI path', () => {
    const file = summary({
      level: 'file',
      tokens: tokens({ input: 60_000, output: 1000 }),
      estimatedUsd: 0.41,
      mode: 'subscription',
    });
    expect(counterLine(file)).toBe('this file · 61k tokens · ≈ $0.41 API-equivalent');
  });

  it('prints tokens and stops when nothing was billable — the scripted video path', () => {
    expect(counterLine(summary({ mode: 'none', estimatedUsd: 0 }))).toBe('this thread · 4.2k tokens');
  });

  it('puts the CLI’s own figure in the tooltip, never in the total', () => {
    const title = counterTitle(summary({ mode: 'subscription', reportedUsd: 0.57, reportedCalls: 2 }));
    expect(title).toContain('CLI-reported $0.57');
    expect(title).toContain('2 of 3');
    expect(title).toContain('rate card 2026-09-01');
    // A sub-cent CLI figure is still shown, still named, and still not added to the estimate.
    expect(counterTitle(summary({ reportedUsd: 0.0057, reportedCalls: 1 }))).toContain('CLI-reported <$0.01');
  });

  it('says how many rows were reconstructed rather than recorded', () => {
    expect(counterTitle(summary({ backfilledCalls: 4 }))).toContain('4 reconstructed');
  });
});

describe('the 5-hour window', () => {
  it('is the constraint that actually bites on a subscription', () => {
    const line = windowLine(
      {
        windowStart: '2026-09-16T05:00:00.000Z',
        windowEnd: '2026-09-16T10:00:00.000Z',
        hours: 5,
        tokens: tokens({ input: 120_000 }),
        calls: 40,
        estimatedUsd: 0.8,
        reportedUsd: null,
      },
      'subscription',
    );
    expect(line).toBe('last 5 h · 120k tokens · ≈ $0.80 API-equivalent');
  });

  it('is absent when there is no CLI in play', () => {
    expect(windowLine(null, 'api')).toBeNull();
  });
});

describe('which counter a cost.updated belongs to', () => {
  const update = { call: call(), sessionTotals: { tokens: tokens(), calls: 1, estimatedUsd: 0.01 } };

  it('nests: thread ⊆ file ⊆ app', () => {
    expect(updateBelongs({ level: 'thread', fileId: 'file-1', anchorId: 'seg-1' }, update)).toBe(true);
    expect(updateBelongs({ level: 'file', fileId: 'file-1', anchorId: null }, update)).toBe(true);
    expect(updateBelongs({ level: 'app', fileId: null, anchorId: null }, update)).toBe(true);
  });

  it('excludes another thread and another file', () => {
    expect(updateBelongs({ level: 'thread', fileId: 'file-1', anchorId: 'seg-2' }, update)).toBe(false);
    expect(updateBelongs({ level: 'file', fileId: 'file-2', anchorId: null }, update)).toBe(false);
  });

  it('keeps a call with no file out of every file counter, by construction', () => {
    const background = { ...update, call: call({ fileId: null, anchorId: null }) };
    expect(updateBelongs({ level: 'file', fileId: 'file-1', anchorId: null }, background)).toBe(false);
    expect(updateBelongs({ level: 'app', fileId: null, anchorId: null }, background)).toBe(true);
  });
});

describe('ticking a counter without a round trip', () => {
  const update = { call: call(), sessionTotals: { tokens: tokens(), calls: 1, estimatedUsd: 0.01 } };

  it('adds the delta to the scalars', () => {
    const next = applyDelta(summary(), update);
    expect(next.tokens.input).toBe(5000);
    expect(next.calls).toBe(4);
    expect(next.estimatedUsd).toBeCloseTo(0.04);
    expect(next.lastCallAt).toBe('2026-09-16T10:05:00.000Z');
  });

  it('leaves the slices alone, so a table can never quietly disagree with the ledger', () => {
    const withSlices = summary({ byModel: [{ key: 'm', calls: 1, tokens: tokens(), estimatedUsd: 0, reportedUsd: null }] });
    expect(applyDelta(withSlices, update).byModel).toBe(withSlices.byModel);
  });

  it('moves the mode when a first CLI call lands beside API calls', () => {
    expect(applyDelta(summary({ mode: 'none' }), update).mode).toBe('subscription');
    expect(applyDelta(summary({ mode: 'api' }), update).mode).toBe('mixed');
  });

  it('a scripted call costs nothing and claims nothing', () => {
    const scripted = { ...update, call: call({ backend: 'scripted', estimatedUsd: 0 }) };
    expect(applyDelta(summary({ mode: 'none' }), scripted).mode).toBe('none');
  });

  it('accumulates the CLI’s own figure separately from the estimate', () => {
    const reported = { ...update, call: call({ reportedUsd: 0.0057 }) };
    const next = applyDelta(summary(), reported);
    expect(next.reportedUsd).toBeCloseTo(0.0057);
    expect(next.reportedCalls).toBe(1);
    expect(next.estimatedUsd).toBeCloseTo(0.04);
  });
});

describe('Export CSV', () => {
  it('writes a header and one row per call', () => {
    const csv = toCsv([call()]);
    const [head, row] = csv.trim().split('\n');
    expect(head).toBe(CSV_COLUMNS.join(','));
    expect(row).toContain('claude-haiku-4-5');
    expect(row).toContain('1100'); // total tokens
    expect(row?.split(',')).toHaveLength(CSV_COLUMNS.length);
  });

  it('neutralises a cell a spreadsheet would run as a formula', () => {
    const csv = toCsv([call({ model: '=HYPERLINK("http://x")' })]);
    expect(csv).not.toContain(',=HYPERLINK');
    expect(csv).toContain("'=HYPERLINK");
  });

  it('quotes a cell containing a comma or a quote', () => {
    expect(toCsv([call({ model: 'a,b' })])).toContain('"a,b"');
    expect(toCsv([call({ model: 'a"b' })])).toContain('"a""b"');
  });

  it('writes an empty cell for a null, not the word null', () => {
    const csv = toCsv([call({ fileId: null, durationMs: null })]);
    expect(csv).not.toContain('null');
  });

  it('names the file by the day it was taken', () => {
    expect(csvFilename(new Date('2026-09-16T10:00:00Z'))).toBe('chattered-usage-2026-09-16.csv');
  });
});

describe('the debug drawer’s line', () => {
  it('is scope, model, tokens, ms — and no body, ever', () => {
    expect(callLine(call(), 'Agent turns')).toBe('Agent turns · claude-haiku-4-5 · 1.1k · 940ms');
    expect(callLine(call({ durationMs: null }), 'Setup')).toContain('· —');
  });
});

describe('the rate-card override, checked before it is saved', () => {
  it('accepts the documented shape, and an empty box', () => {
    expect(validateRateCard('{"claude-sonnet-5": {"input": 2, "output": 10}}').ok).toBe(true);
    expect(validateRateCard('   ').ok).toBe(true);
    expect(validateRateCard('{"m": {"input": 1, "output": 2, "cacheWrite": 1.25, "cacheRead": 0.1}}').ok).toBe(true);
  });

  it('says what is wrong rather than dropping the line silently', () => {
    expect(validateRateCard('{').errors[0]).toContain('not JSON');
    expect(validateRateCard('[1,2]').errors).toEqual(['expected an object of model id → prices']);
    expect(validateRateCard('{}').errors).toEqual(['no models in it']);
    expect(validateRateCard('{"m": {"input": 2}}').errors[0]).toContain('output is required');
    expect(validateRateCard('{"m": {"input": -1, "output": 2}}').errors[0]).toContain('input is required');
    expect(validateRateCard('{"m": 4}').errors[0]).toContain('expected an object');
    expect(validateRateCard('{"m": {"input": 1, "output": 2, "cacheRead": "free"}}').errors[0]).toContain('cacheRead');
  });
});

describe('a zero needs no hedge', () => {
  it('drops the label on $0.00, in every mode that has one', () => {
    expect(usdWithLabel(0, 'subscription')).toBe('$0.00');
    expect(usdWithLabel(0, 'mixed')).toBe('$0.00');
    expect(usdWithLabel(0, 'api')).toBe('$0.00');
    expect(usdWithLabel(0, 'none')).toBe('');
  });

  it('keeps it on anything that is actually money', () => {
    expect(usdWithLabel(0.03, 'subscription')).toBe('≈ $0.03 API-equivalent');
    expect(usdWithLabel(0.002, 'subscription')).toBe('<$0.01 API-equivalent');
    expect(usdWithLabel(0.03, 'api')).toBe('≈ $0.03');
  });

  it('is what the scripted video path shows — tokens, and nothing about money', () => {
    expect(counterLine(summary({ mode: 'none', estimatedUsd: 0 }))).toBe('this thread · 4.2k tokens');
  });
});

// ── The always-available surfaces (#42 item C) ──────────────────────────────

function slice(key: string, partial: Partial<CostSlice> = {}): CostSlice {
  return {
    key,
    calls: 1,
    tokens: tokens({ input: 1_000, output: 200 }),
    estimatedUsd: 0.004,
    reportedUsd: null,
    ...partial,
  };
}

function messageCost(partial: Partial<CostMessageCost> = {}): CostMessageCost {
  return {
    messageId: 'm7',
    kind: 'message',
    turnId: 'turn_m7',
    anchorId: 'doc',
    calls: 2,
    tokens: tokens({ input: 900, output: 260, cacheRead: 6_000 }),
    estimatedUsd: 0.0046,
    reportedUsd: null,
    ms: 4_200,
    models: ['claude-sonnet-5'],
    byScope: [],
    mode: 'subscription',
    failedCalls: 0,
    ...partial,
  };
}

describe('the per-message meter', () => {
  it('leads with tokens and keeps the label on the dollars, every single card', () => {
    // 7160 tokens → `7.2k`. The label is the point: forty of these a session, unlabelled, is
    // forty claims that a student on a subscription owes money.
    expect(meterLine(messageCost())).toBe('7.2k tok · <$0.01 API-equivalent');
    expect(meterLine(messageCost({ estimatedUsd: 0.023 }))).toBe('7.2k tok · ≈ $0.023 API-equivalent');
  });

  it('drops the money on the API path’s own hedge, and on the scripted path entirely', () => {
    expect(meterLine(messageCost({ mode: 'api', estimatedUsd: 0.023 }))).toBe('7.2k tok · ≈ $0.023');
    expect(meterLine(messageCost({ mode: 'none', estimatedUsd: 0 }))).toBe('7.2k tok');
  });

  /** BYOK: a model the rate card has no price for is "cost unknown", never "$0.00". */
  it('says cost unknown for an unpriced BYOK call, and flags a partly-priced one', () => {
    expect(meterLine(messageCost({ mode: 'api', estimatedUsd: 0, unpricedCalls: 2 }))).toBe('7.2k tok · cost unknown');
    expect(meterLine(messageCost({ mode: 'api', estimatedUsd: 0.023, unpricedCalls: 1 }))).toBe('7.2k tok · ≈ $0.023 + unpriced');
    expect(meterLine(messageCost({ mode: 'api', estimatedUsd: 0.023, unpricedCalls: 0 }))).toBe('7.2k tok · ≈ $0.023');
  });

  it('counts every BYOK provider as the api billing mode', () => {
    for (const backend of ['openai', 'gemini', 'openai-compatible'] as const) {
      expect(modeFor([backend])).toBe('api');
      expect(modeFor([backend, 'claude-cli'])).toBe('mixed');
    }
  });

  it('says calls, model, latency in the tooltip', () => {
    const title = meterTitle(messageCost());
    expect(title).toBe('2 calls · claude-sonnet-5 · 4.2 s');
    expect(meterTitle(messageCost({ calls: 1 }))).toContain('1 call ·');
  });

  it('puts the CLI’s own figure beside the estimate and never into it', () => {
    const cost = messageCost({ reportedUsd: 0.0078, estimatedUsd: 0.0046 });
    expect(meterTitle(cost)).toContain('CLI-reported <$0.01');
    // The headline is still the app's own arithmetic, untouched by the CLI's.
    expect(meterLine(cost)).toBe('7.2k tok · <$0.01 API-equivalent');
    expect(reportedLine(0.0078)).toBe('CLI-reported <$0.01');
    expect(reportedLine(null)).toBeNull();
  });

  it('says in one clause that a retried turn was paid for twice', () => {
    expect(failedClause(1)).toBe('1 call failed or was pre-empted — a retried turn costs twice');
    expect(failedClause(2)).toContain('2 calls failed or were pre-empted');
    expect(failedClause(0)).toBeNull();
    expect(meterTitle(messageCost({ failedCalls: 1 }))).toContain('a retried turn costs twice');
  });

  it('times itself in the unit a human reads, or not at all', () => {
    expect(msLabel(940)).toBe('940 ms');
    expect(msLabel(4_200)).toBe('4.2 s');
    expect(msLabel(42_000)).toBe('42.0 s');
    expect(msLabel(null)).toBeNull();
  });
});

describe('a breakdown row', () => {
  it('names a scope in the app’s own words, not the wire’s', () => {
    const rows = scopeRows([slice('group'), slice('orchestrator'), slice('docedit')], 'subscription');
    expect(rows.map((r) => r.label)).toEqual(['Agent turns', 'Turn decisions', 'Doc edits']);
    expect(rows[0]?.detail).toBe('1.2k tok · <$0.01 API-equivalent');
  });

  it('shows a call count only when there was more than one call', () => {
    expect(sliceLine(slice('group', { calls: 1 }), 'api')).toBe('1.2k tok · <$0.01');
    expect(sliceLine(slice('group', { calls: 6, estimatedUsd: 0.3 }), 'api')).toBe('1.2k tok · ≈ $0.30 · 6 calls');
  });

  it('falls back to the raw key rather than dropping a scope it has never heard of', () => {
    expect(scopeRows([slice('futurescope')], 'api')[0]?.label).toBe('futurescope');
  });
});

describe('the ingest split, which is the doc counter’s whole reason to exist', () => {
  const slices = [
    slice('notes', { calls: 4, tokens: tokens({ cacheRead: 300_000 }), estimatedUsd: 0.06 }),
    slice('objectives', { calls: 1, tokens: tokens({ input: 20_000 }), estimatedUsd: 0.04 }),
    slice('ingest', { calls: 1, tokens: tokens({ input: 20_000 }), estimatedUsd: 0.04 }),
    slice('group', { calls: 9, tokens: tokens({ input: 30_000, output: 4_000 }), estimatedUsd: 0.1 }),
    slice('docedit', { calls: 3, tokens: tokens({ input: 10_000 }), estimatedUsd: 0.02 }),
  ];

  it('puts the once-per-deck work on one side and the conversation on the other', () => {
    const { ingest, conversation } = ingestSplit(slices);
    expect(ingest.calls).toBe(6);
    expect(totalTokens(ingest.tokens)).toBe(340_000);
    expect(ingest.estimatedUsd).toBeCloseTo(0.14);
    expect(conversation.calls).toBe(12);
    expect(totalTokens(conversation.tokens)).toBe(44_000);
    expect(conversation.estimatedUsd).toBeCloseTo(0.12);
  });

  it('adds back up to the whole, so the two lines can never exceed the total', () => {
    const { ingest, conversation } = ingestSplit(slices);
    const whole = slices.reduce((n, s) => n + totalTokens(s.tokens), 0);
    expect(totalTokens(ingest.tokens) + totalTokens(conversation.tokens)).toBe(whole);
  });

  it('is empty on the side that has nothing, which is what gets drawn as nothing at all', () => {
    const { ingest, conversation } = ingestSplit([slice('group')]);
    expect(partHasCost(ingest)).toBe(false);
    expect(partHasCost(conversation)).toBe(true);
    expect(ingestSplit([]).conversation.calls).toBe(0);
  });
});

describe('the title-bar indicator', () => {
  const burn: CliWindowBurn = {
    windowStart: '2026-09-16T05:00:00.000Z',
    windowEnd: '2026-09-16T10:00:00.000Z',
    hours: 5,
    tokens: tokens({ input: 120_000 }),
    calls: 40,
    estimatedUsd: 0.8,
    reportedUsd: null,
  };

  it('is two short halves, tokens only — there is no room for a claim up there', () => {
    expect(compactTokens(tokens({ input: 12_000 }))).toBe('12k tok');
    expect(sessionChip(summary({ level: 'app', tokens: tokens({ input: 12_000 }), calls: 5 }))).toBe('session 12k tok');
    expect(windowChip(burn)).toBe('5 h 120k tok');
  });

  it('hides the window half entirely on an install that has no window', () => {
    expect(windowChip(null)).toBeNull();
  });

  it('hides itself before the first call rather than showing a zero', () => {
    expect(sessionChip(null)).toBeNull();
    expect(sessionChip(summary({ level: 'app', tokens: emptyTokens(), calls: 0 }))).toBeNull();
  });

  it('calls this launch "this session", because counterLine would call it all time', () => {
    const session = summary({ level: 'app', tokens: tokens({ input: 12_000 }), estimatedUsd: 0.05, mode: 'subscription' });
    expect(sessionLine(session)).toBe('this session · 12k tokens · ≈ $0.05 API-equivalent');
    expect(counterLine(session)).toContain('all time');
  });

  it('says the rest in the tooltip, one claim per line', () => {
    const app = summary({ level: 'app', mode: 'subscription', estimatedUsd: 0.28, cliWindow: burn });
    const session = summary({ level: 'app', tokens: tokens({ input: 12_000 }), estimatedUsd: 0.05, mode: 'subscription' });
    const lines = indicatorTitle(app, session).split('\n');
    expect(lines[0]).toBe('this session · 12k tokens · ≈ $0.05 API-equivalent');
    expect(lines[1]).toBe('all time · 4.2k tokens · ≈ $0.28 API-equivalent');
    expect(lines[2]).toBe('last 5 h · 120k tokens · ≈ $0.80 API-equivalent');
    expect(lines[3]).toContain('rate card');
    expect(indicatorTitle(null, null)).toBe('Click for the whole picture.');
  });
});
