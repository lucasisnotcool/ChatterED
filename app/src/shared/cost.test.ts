import { describe, expect, it } from 'vitest';
import {
  addTokens,
  costLine,
  emptyTokens,
  formatTokens,
  formatUsd,
  modeFor,
  REPORTED_USD_LABEL,
  totalTokens,
  usdLabel,
  COST_SCOPES,
  COST_SCOPE_LABEL,
} from './cost.js';

describe('cost tokens', () => {
  it('adds the four counts independently', () => {
    const a = { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 };
    const b = { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 };
    expect(addTokens(a, b)).toEqual({ input: 11, output: 22, cacheWrite: 33, cacheRead: 44 });
  });

  it('totals all four — cache tokens are not folded into input anywhere', () => {
    expect(totalTokens({ input: 1, output: 2, cacheWrite: 3, cacheRead: 4 })).toBe(10);
    expect(totalTokens(emptyTokens())).toBe(0);
  });
});

describe('labelling', () => {
  /**
   * The one assertion in this file that is a product decision rather than arithmetic: on the
   * CLI path the learner is on a subscription and is not being billed per token, so no surface
   * may print a bare dollar figure. See the header of `cost.ts`.
   */
  it('never calls a subscription figure money spent', () => {
    expect(usdLabel('subscription')).toBe('API-equivalent');
    expect(usdLabel('mixed')).toBe('API-equivalent');
    expect(usdLabel('api')).toBe('estimated');
    expect(usdLabel('none')).toBe('nothing spent');
    expect(REPORTED_USD_LABEL).toBe('CLI-reported');
  });

  it('leads with tokens in every mode', () => {
    const tokens = { input: 6_700, output: 300, cacheWrite: 540, cacheRead: 6_140 };
    expect(costLine({ tokens, estimatedUsd: 0.0123, mode: 'subscription' })).toBe(
      '14K tokens · $0.012 API-equivalent',
    );
    expect(costLine({ tokens, estimatedUsd: 0, mode: 'none' })).toBe('14K tokens');
  });

  it('derives the mode from which backends actually appear', () => {
    expect(modeFor([])).toBe('none');
    expect(modeFor(['scripted', 'scripted'])).toBe('none');
    expect(modeFor(['claude-cli'])).toBe('subscription');
    expect(modeFor(['anthropic'])).toBe('api');
    expect(modeFor(['claude-cli', 'anthropic', 'scripted'])).toBe('mixed');
  });

  it('labels every scope it declares', () => {
    for (const scope of COST_SCOPES) expect(COST_SCOPE_LABEL[scope]).toBeTruthy();
    expect(new Set(COST_SCOPES).size).toBe(COST_SCOPES.length);
  });
});

describe('formatting', () => {
  it('abbreviates tokens without losing the order of magnitude', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_234)).toBe('1.2K');
    expect(formatTokens(58_400)).toBe('58K');
    expect(formatTokens(377_000)).toBe('377K');
    expect(formatTokens(1_234_567)).toBe('1.23M');
  });

  /** "$0.00" reads as free. A third of a cent is not free on the API path. */
  it('never prints a non-zero cost as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0033)).toBe('<$0.01');
    expect(formatUsd(0.14)).toBe('$0.14');
    expect(formatUsd(0.699)).toBe('$0.699');
    expect(formatUsd(12.5)).toBe('$12.50');
  });
});
