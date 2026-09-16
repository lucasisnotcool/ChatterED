import { describe, expect, it } from 'vitest';
import { IPC } from './ipc.js';
import {
  MAX_OBJECTIVES,
  MIN_OBJECTIVES,
  ONLINE_LEVEL,
  isOnline,
  objectiveLevelFromLedger,
  onlineCount,
  type LearningObjectiveState,
} from './objectives.js';

const state = (level: LearningObjectiveState['level']): LearningObjectiveState => ({
  objectiveId: `o${level}`,
  fileId: 'f1',
  level,
  evidenceMessageIds: [],
  lastMovedAt: null,
  taughtAt: null,
});

describe('the objective level', () => {
  it('is online at justified, which is Lucas’s decision of 2026-09-16', () => {
    expect(ONLINE_LEVEL).toBe(2);
    expect(isOnline(1)).toBe(false);
    expect(isOnline(2)).toBe(true);
    expect(isOnline(3)).toBe(true);
  });

  /**
   * The ledger scores five rungs and the panel shows four. `levelToState()` in `room/ledger.ts`
   * already calls anything >= 3 `defended`, so the two surfaces agree where it matters and this
   * is a clamp — not a second scale that could drift from the first.
   */
  it('clamps the ledger’s 0–4 scale without re-scaling it', () => {
    expect(objectiveLevelFromLedger(0)).toBe(0);
    expect(objectiveLevelFromLedger(2)).toBe(2);
    expect(objectiveLevelFromLedger(3)).toBe(3);
    expect(objectiveLevelFromLedger(4)).toBe(3);
    expect(objectiveLevelFromLedger(-1)).toBe(0);
  });

  it('counts the online ones for the panel header', () => {
    expect(onlineCount([state(0), state(1), state(2), state(3)])).toBe(2);
    expect(onlineCount([])).toBe(0);
  });
});

describe('the ingest bounds', () => {
  it('are §3’s, and are enforced rather than only asked for', () => {
    expect(MIN_OBJECTIVES).toBe(6);
    expect(MAX_OBJECTIVES).toBe(20);
  });
});

/**
 * The renderer track is building the panel against these channel names before the main-process
 * half exists. A rename here is a silently dead panel there, so the names are asserted.
 */
describe('the IPC contract of §6', () => {
  it('names the five channels the panel calls', () => {
    expect(IPC.objectivesTree).toBe('objectives:tree');
    expect(IPC.objectivesStates).toBe('objectives:states');
    expect(IPC.objectivesRegenerate).toBe('objectives:regenerate');
    expect(IPC.objectivesReset).toBe('objectives:reset');
    expect(IPC.objectivesTeach).toBe('objectives:teach');
  });
});
