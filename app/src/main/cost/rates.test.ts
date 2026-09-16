import { describe, expect, it } from 'vitest';
import {
  estimateUsd,
  normaliseForPricing,
  parseRateCardOverride,
  rateFor,
  RATE_CARD,
  RATE_CARD_DATE,
} from './rates.js';

describe('the rate card', () => {
  /**
   * The three models this app runs on, at the `claude-api` skill's cached prices. If this test
   * fails it is because somebody edited the table, which is exactly when a human should look.
   */
  it('prices the three models the app runs on', () => {
    expect(RATE_CARD_DATE).toBe('2026-06-24');
    const haiku = rateFor('claude-haiku-4-5').rate;
    expect([haiku.inputPerMTok, haiku.outputPerMTok]).toEqual([1, 5]);
    const sonnet = rateFor('claude-sonnet-5').rate;
    expect([sonnet.inputPerMTok, sonnet.outputPerMTok]).toEqual([2, 10]);
    const opus = rateFor('claude-opus-5').rate;
    expect([opus.inputPerMTok, opus.outputPerMTok]).toEqual([5, 25]);
  });

  it('derives cache write at 1.25x input and cache read at 0.1x', () => {
    const sonnet = rateFor('claude-sonnet-5').rate;
    expect(sonnet.cacheWritePerMTok).toBe(2.5);
    expect(sonnet.cacheReadPerMTok).toBe(0.2);
  });

  /** Fable is a hard invariant, not a price. It must not be on the card at any price. */
  it('has no Fable entry and prices a Fable id inexactly', () => {
    expect(RATE_CARD.some((r) => /fable/i.test(r.model))).toBe(false);
    expect(rateFor('claude-fable-5-1').exact).toBe(false);
  });
});

describe('resolving an id to a rate', () => {
  it('takes the CLI aliases the Settings dropdown stores', () => {
    expect(rateFor('sonnet').rate.model).toBe('claude-sonnet-5');
    expect(rateFor('haiku').rate.model).toBe('claude-haiku-4-5');
    expect(rateFor('opus').rate.model).toBe('claude-opus-5');
    for (const alias of ['sonnet', 'haiku', 'opus']) expect(rateFor(alias).exact).toBe(true);
  });

  /**
   * The CLI reports back a dated id from `modelUsage` — a different string from the one this app
   * asked for. `claude-sonnet-5-20260401` is Sonnet 5; `claude-sonnet-4-5-20250929` is a model
   * this app has no price for and must say so rather than quietly charging Sonnet 5 rates.
   */
  it('strips a date suffix but does not invent a generation', () => {
    expect(normaliseForPricing('claude-sonnet-5-20260401')).toBe('claude-sonnet-5');
    expect(rateFor('claude-sonnet-5-20260401')).toMatchObject({ exact: true });
    expect(rateFor('claude-sonnet-5-20260401').rate.model).toBe('claude-sonnet-5');
    expect(rateFor('claude-sonnet-4-5-20250929').exact).toBe(false);
  });

  it('falls back to Sonnet 5 for junk, and flags it', () => {
    const r = rateFor('totally-made-up');
    expect(r.exact).toBe(false);
    expect(r.rate.model).toBe('claude-sonnet-5');
  });
});

describe('estimating a call', () => {
  /**
   * The real shape of a CLI call, from `segmentation-cost.md` §1.4's measurement: 540
   * cache-creation + 6,140 cache-read tokens of Claude Code system prompt, before the payload.
   */
  it('prices the four token counts separately and never folds cache into input', () => {
    const { usd } = estimateUsd('claude-sonnet-5', {
      input: 2_000,
      output: 500,
      cacheWrite: 540,
      cacheRead: 6_140,
    });
    // 2000*2 + 500*10 + 540*2.5 + 6140*0.2 = 4000 + 5000 + 1350 + 1228 = 11,578 per MTok-unit
    expect(usd).toBeCloseTo(11_578 / 1_000_000, 9);
  });

  it('is zero for a call that reported nothing — the scripted path', () => {
    expect(estimateUsd('claude-sonnet-5', { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }).usd).toBe(0);
  });

  /**
   * §1.1's own figure, recomputed here: a 40-slide deck at 2,744 in / 150 out per page on Haiku
   * 4.5 is $0.140. Pins this card against the research document rather than against itself.
   */
  it('reproduces segmentation-cost.md §1.1 for a 40-slide deck on Haiku', () => {
    const { usd } = estimateUsd('claude-haiku-4-5', {
      input: 2_744 * 40,
      output: 150 * 40,
      cacheWrite: 0,
      cacheRead: 0,
    });
    expect(usd).toBeCloseTo(0.14, 3);
  });
});

describe('the settings override', () => {
  it('is the built-in card when unset or empty', () => {
    expect(parseRateCardOverride(undefined).card).toBe(RATE_CARD);
    expect(parseRateCardOverride('   ').card).toBe(RATE_CARD);
  });

  it('replaces one model and leaves the rest alone', () => {
    const { card, errors } = parseRateCardOverride('{"claude-sonnet-5":{"input":4,"output":20}}');
    expect(errors).toEqual([]);
    expect(rateFor('claude-sonnet-5', card).rate.inputPerMTok).toBe(4);
    expect(rateFor('claude-sonnet-5', card).rate.cacheWritePerMTok).toBe(5);
    expect(rateFor('claude-haiku-4-5', card).rate.inputPerMTok).toBe(1);
  });

  it('adds a model that is not on the card', () => {
    const { card } = parseRateCardOverride('{"claude-sonnet-4-5":{"input":3,"output":15}}');
    expect(rateFor('claude-sonnet-4-5', card).exact).toBe(true);
  });

  /** One malformed entry must not blank the panel. It is dropped, named, and the rest applies. */
  it('ignores a bad entry rather than throwing the whole card away', () => {
    const { card, errors } = parseRateCardOverride('{"a":{"input":"free"},"claude-opus-5":{"input":9,"output":45}}');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('a:');
    expect(rateFor('claude-opus-5', card).rate.inputPerMTok).toBe(9);
  });

  it('survives junk JSON with the built-in card intact', () => {
    const { card, errors } = parseRateCardOverride('{not json');
    expect(card).toBe(RATE_CARD);
    expect(errors[0]).toContain('not JSON');
  });
});
