import { describe, expect, it } from 'vitest';
import {
  CSV_COLUMNS,
  applyDelta,
  callLine,
  counterLine,
  counterTitle,
  csvFilename,
  tokensLabel,
  toCsv,
  updateBelongs,
  usdApprox,
  usdSuffix,
  usdWithLabel,
  validateRateCard,
  windowLine,
} from './cost.js';
import { emptyTokens, type CostCallView, type CostSummary, type CostTokens } from '../../shared/cost.js';

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
