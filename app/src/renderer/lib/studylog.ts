/**
 * **Send a field-study event to `main.log`** (`shared/studylog.ts`). Best-effort and silent: an app
 * that cannot log must still run, and the mock and the tests have no main process to send to.
 */
import type { StudyEvent } from '../../shared/studylog.js';

export function logStudy(event: StudyEvent): void {
  try {
    const send = (globalThis as { chattered?: { logStudyEvent?: (e: StudyEvent) => Promise<void> } }).chattered?.logStudyEvent;
    void send?.(event).catch(() => undefined);
  } catch {
    /* no bridge */
  }
}
