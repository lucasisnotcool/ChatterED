import { describe, expect, it } from 'vitest';
import { TRAFFIC_LIGHT_INSET, titleBarInset } from './chrome.js';

describe('title bar inset (issue #21)', () => {
  it('reserves enough room for the three traffic lights at trafficLightPosition x=14', () => {
    // 14 px inset + 3 × 12 px buttons + 2 × 20 px gaps = 90 px of macOS furniture at most;
    // the guard that matters is that we never reserve *less* than the buttons occupy.
    expect(TRAFFIC_LIGHT_INSET).toBeGreaterThanOrEqual(64);
    expect(titleBarInset(false)).toBe(TRAFFIC_LIGHT_INSET);
  });

  it('collapses in fullscreen, where macOS hides the buttons', () => {
    expect(titleBarInset(true)).toBe(0);
  });
});
