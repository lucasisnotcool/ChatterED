/**
 * **What the renderer may write into `main.log` for the field study** (`docs/group/field-study.md`,
 * "What must be added before the build goes out", items 3, 4 and 6).
 *
 * Some of what the study measures happens only in the renderer: a *From the notes* link or a page
 * link opened from a part, the tutorial or the notes made the main view, the Source PDF opened
 * beside the sheet, and how long the app was actually in use. None of it reaches main on its own,
 * so the renderer sends one of the events below over `app:logStudyEvent`.
 *
 * The channel is closed: `studyEvent()` accepts exactly these events with exactly these fields, ids
 * only by their own shape, and drops anything else. **No learner text, no page text, no names**,
 * the same promise as `main/log.ts`. Nothing here changes what the learner sees.
 */

export type StudyEvent =
  /** A link under a part's *From the notes:* line: a notes block, or a lecture page. */
  | { event: 'tutorial.link_open'; fileId: string; partId: string; target: 'notes' | 'page' }
  /** The main view switched between the tutorial sheet and the lecture notes. */
  | { event: 'tutorial.main_view'; view: 'tutorial' | 'notes' }
  /** The tutorial's Source PDF panel opened or closed beside the sheet. */
  | { event: 'tutorial.source_pdf'; fileId: string; open: boolean }
  /**
   * Minutes of use since the last report: a minute counts when the learner typed, clicked,
   * scrolled or pointed in the window during it (`renderer/lib/activeclock.ts`).
   */
  | { event: 'app.active'; minutes: number };

/** The line `main.log` gets: the event name and snake_case fields, as every other line has. */
export interface StudyLogLine {
  event: StudyEvent['event'];
  fields: Record<string, string | number | boolean>;
}

/** The longest stretch one `app.active` may report (the renderer reports every few minutes). */
export const MAX_ACTIVE_MINUTES = 60;

/** An app id (`file_…`, `nb_…`, a part's id): letters, digits and `_ : . -`, nothing longer than 200. */
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;

function id(raw: unknown): string | null {
  return typeof raw === 'string' && ID.test(raw) ? raw : null;
}

/**
 * The log line for a renderer's study event, or null when it is not one of `StudyEvent` exactly.
 * Run in main on whatever arrived over IPC: the renderer is trusted no further than the log is.
 */
export function studyEvent(raw: unknown): StudyLogLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  switch (input.event) {
    case 'tutorial.link_open': {
      const fileId = id(input.fileId);
      const partId = id(input.partId);
      if (!fileId || !partId || (input.target !== 'notes' && input.target !== 'page')) return null;
      return { event: input.event, fields: { file_id: fileId, part_id: partId, target: input.target } };
    }
    case 'tutorial.main_view':
      if (input.view !== 'tutorial' && input.view !== 'notes') return null;
      return { event: input.event, fields: { view: input.view } };
    case 'tutorial.source_pdf': {
      const fileId = id(input.fileId);
      if (!fileId || typeof input.open !== 'boolean') return null;
      return { event: input.event, fields: { file_id: fileId, open: input.open } };
    }
    case 'app.active': {
      const m = input.minutes;
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > MAX_ACTIVE_MINUTES) return null;
      return { event: input.event, fields: { minutes: m } };
    }
    default:
      return null;
  }
}
