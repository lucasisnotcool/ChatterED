/**
 * `study` for the dev mock (`mockBridge.ts`). Off unless the page URL carries `?study=1`, so the
 * ordinary dev harness looks like an ordinary build. With it, any code of the right shape unlocks
 * a $30 credit that is already 85% spent, so both the unlock card and the low-credit bar can be
 * seen without a bundle; `?study=out` starts it used up. `?grader=1` (a grader copy, `shared/grader.ts`)
 * starts it already unlocked, as a preloaded copy is, and hands out the dev renderer's sample sheet.
 */
import { NO_STUDY, creditFrom, type StudyApi, type StudyStatus } from '../../shared/study.js';
import { GRADER_SAMPLE_MISSING } from '../../shared/grader.js';

export function createMockStudy(): StudyApi {
  const mode = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('study');
  const grader = typeof location !== 'undefined' && new URLSearchParams(location.search).get('grader') === '1';
  let status: StudyStatus = grader
    ? { ...NO_STUDY, available: true, unlocked: true, slot: '99', budgetUsd: 50, spentUsd: 0, ...creditFrom(50, 0), active: true }
    : { ...NO_STUDY, available: mode === '1' || mode === 'out' };
  const listeners = new Set<(s: StudyStatus) => void>();
  return {
    async status() {
      return { ...status };
    },
    async unlock({ code }) {
      if (!status.available) return { ok: false, error: 'This copy of ChatterED is not a study build.' };
      if (!/^S\d{2,3}[-\s]?[0-9A-Z]{4}/i.test(code.trim())) {
        return { ok: false, error: 'That is not a study code. It looks like S07-K3QX-9MZT-4HRA.' };
      }
      const spent = mode === 'out' ? 30 : 25.5;
      status = {
        ...status,
        unlocked: true,
        slot: code.trim().slice(1, 3),
        budgetUsd: 30,
        spentUsd: spent,
        ...creditFrom(30, spent),
        active: true,
        exhausted: spent >= 30,
      };
      listeners.forEach((l) => l({ ...status }));
      return { ok: true, status: { ...status } };
    },
    async graderSample() {
      return grader ? { ok: true, path: '/mock/Graph traversal tutorial.pdf' } : { ok: false, error: GRADER_SAMPLE_MISSING };
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
