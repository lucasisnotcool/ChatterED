import { describe, expect, it } from 'vitest';
import { a2Loop } from './ipc.js';

describe('a2Loop: which question loop this build runs', () => {
  it('runs Max’s follow-up by default, with every guard on', () => {
    expect(a2Loop({})).toEqual({ maxFollowsUp: true, legacyGuardsOff: false });
  });

  it('CHATTERED_MAX_ON_REQUEST=1 restores Max asking only when asked', () => {
    expect(a2Loop({ CHATTERED_MAX_ON_REQUEST: '1' }).maxFollowsUp).toBe(false);
    expect(a2Loop({ CHATTERED_MAX_ON_REQUEST: '0' }).maxFollowsUp).toBe(true);
  });

  it('CHATTERED_LEGACY_GUARDS_OFF=1 switches the 6 Oct checks off, and nothing else does', () => {
    expect(a2Loop({ CHATTERED_LEGACY_GUARDS_OFF: '1' }).legacyGuardsOff).toBe(true);
    expect(a2Loop({ CHATTERED_LEGACY_GUARDS_OFF: 'yes' }).legacyGuardsOff).toBe(false);
  });
});
