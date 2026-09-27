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

describe('BYOK providers (priced 2026-09-25)', () => {
  it('prices the verified OpenAI and Gemini ids with their own cached-input rate', () => {
    expect(rateFor('gpt-6-sol', undefined, 'openai')).toMatchObject({
      exact: true,
      rate: { inputPerMTok: 2, cacheReadPerMTok: 0.2, outputPerMTok: 10 },
    });
    // A dated snapshot the API reports back is the same model.
    expect(rateFor('gpt-6-sol-2026-09-01', undefined, 'openai').rate.model).toBe('gpt-6-sol');
    expect(rateFor('gemini-3.8-flash', undefined, 'gemini')).toMatchObject({ exact: true, rate: { inputPerMTok: 0.75, outputPerMTok: 3.75 } });
    expect(rateFor('gpt-5.4-mini', undefined, 'openai').rate.model).toBe('gpt-5.4-mini');
  });

  it('prices an unknown non-Claude model at zero and flags it, rather than inventing a bill', () => {
    for (const backend of ['openai', 'gemini', 'openai-compatible']) {
      const r = rateFor('llama3.3:70b', undefined, backend);
      expect(r.exact).toBe(false);
      expect(r.rate.inputPerMTok).toBe(0);
    }
    expect(estimateUsd('some-router/model', { input: 1e6, output: 1e6, cacheWrite: 0, cacheRead: 0 }, undefined, 'openai-compatible').usd).toBe(0);
    // An alias spelling is a Claude CLI thing; on another provider it is simply unknown.
    expect(rateFor('sonnet', undefined, 'openai-compatible').exact).toBe(false);
  });

  it('leaves the Claude fallback as it was', () => {
    expect(rateFor('totally-made-up', undefined, 'anthropic').rate.model).toBe('claude-sonnet-5');
    expect(rateFor('totally-made-up', undefined, 'claude-cli').rate.model).toBe('claude-sonnet-5');
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

  /**
   * **The CLI writes its cache at the 1-hour TTL** (#49). Claude Code picks `ttl: "1h"` for a
   * logged-in subscriber (its own `reason: "subscriber"` branch), and the `claude-api` skill
   * prices a 1-hour write at 2× input, not the 5-minute 1.25×. Checked against the CLI's own
   * `total_cost_usd` over 386 Sonnet 5 calls in main.log: 1.25× came out 28% low with no call
   * within 2%; 2× came out 6% low, 24 calls within 2% (the rest is the CLI's auxiliary Haiku
   * calls, billed in its total but not in `result.usage`).
   */
  it('prices a CLI call’s cache writes at the 1-hour rate, and the API path’s at the 5-minute one', () => {
    const tokens = { input: 2, output: 534, cacheWrite: 2_883, cacheRead: 1_487 };
    // 2*2 + 534*10 + 2883*4 + 1487*0.2 = 4 + 5340 + 11532 + 297.4
    expect(estimateUsd('claude-sonnet-5', tokens, RATE_CARD, 'claude-cli').usd).toBeCloseTo(17_173.4 / 1e6, 6);
    // 2883*2.5 on the API path, which sets `ephemeral` with no ttl.
    expect(estimateUsd('claude-sonnet-5', tokens, RATE_CARD, 'anthropic').usd).toBeCloseTo(12_848.9 / 1e6, 6);
    expect(estimateUsd('claude-sonnet-5', tokens).usd).toBeCloseTo(12_848.9 / 1e6, 6);
    expect(rateFor('claude-sonnet-5').rate.cacheWrite1hPerMTok).toBe(4);
    expect(rateFor('claude-haiku-4-5').rate.cacheWrite1hPerMTok).toBe(2);
    expect(rateFor('claude-opus-5').rate.cacheWrite1hPerMTok).toBe(10);
  });

  it('honours an override’s own 1-hour write price', () => {
    const { card } = parseRateCardOverride('{"claude-sonnet-5":{"input":2,"output":10,"cacheWrite1h":3}}');
    const usd = estimateUsd('claude-sonnet-5', { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 0 }, card, 'claude-cli').usd;
    expect(usd).toBe(3);
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
