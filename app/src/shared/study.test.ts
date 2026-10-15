/** The study credit's arithmetic and the spend-limit sniff, shared by main and the renderer. */
import { describe, expect, it } from 'vitest';
import { creditFrom, looksLikeSpendLimit, usd } from './study.js';

describe('creditFrom', () => {
  it('is what is left and the share spent, clamped at both ends', () => {
    expect(creditFrom(30, 7.5)).toEqual({ remainingUsd: 22.5, fraction: 0.25 });
    expect(creditFrom(30, 0)).toEqual({ remainingUsd: 30, fraction: 0 });
    expect(creditFrom(30, 45)).toEqual({ remainingUsd: 0, fraction: 1 });
    expect(creditFrom(0, 5)).toEqual({ remainingUsd: 0, fraction: 0 });
  });

  it('prints to the cent', () => {
    expect(usd(22.499)).toBe('$22.50');
    expect(usd(0)).toBe('$0.00');
  });
});

describe('looksLikeSpendLimit', () => {
  it('recognises a refusal that names a limit or the balance', () => {
    expect(looksLikeSpendLimit(400, 'You have reached your specified workspace API usage limits.')).toBe(true);
    expect(looksLikeSpendLimit(400, 'Your credit balance is too low to access the Anthropic API.')).toBe(true);
    expect(looksLikeSpendLimit(429, 'workspace spend limit reached')).toBe(true);
  });

  it('leaves rate limits, server errors and unrelated refusals alone', () => {
    expect(looksLikeSpendLimit(429, 'Number of request tokens has exceeded your per-minute rate limit')).toBe(false);
    expect(looksLikeSpendLimit(500, 'usage limit')).toBe(false);
    expect(looksLikeSpendLimit(400, 'messages: text content blocks must be non-empty')).toBe(false);
  });
});
