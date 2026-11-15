import type { NotesDocRecord } from '../db/repos/notes.js';
import { log } from '../log.js';
import { docFromJson } from '../../shared/doc/schema.js';
import { partsStarted } from '../../shared/doc/tutorialdoc.js';
import { parseTutorialContentKey } from '../../shared/tutorial.js';

/**
 * **When a tutorial slot got its first text** (`docs/group/field-study.md`, "What must be added",
 * item 2): the saved document carries no time per slot, and `updated_at` is overwritten, so a save
 * that fills a slot that was empty logs `tutorial.text_started` with the part and the attempt's
 * size, never its words. Only tutorial documents are read; a lecture's notes are left alone.
 */
export function logPartsStarted(prior: NotesDocRecord, docJson: unknown, learnerTouched: boolean): void {
  const tutorial = parseTutorialContentKey(prior.contentSha);
  if (!tutorial) return;
  try {
    const before = prior.doc === null || prior.doc === undefined ? null : docFromJson(prior.doc);
    for (const { partId, size } of partsStarted(before, docFromJson(docJson))) {
      log().info('tutorial.text_started', {
        notebook_id: tutorial.notebookId,
        file_id: tutorial.fileId,
        doc_id: prior.id,
        part_id: partId,
        attempt_chars: size.chars,
        attempt_picked: size.picked,
        learner_touched: learnerTouched,
      });
    }
  } catch (err) {
    log().warn('tutorial.text_started.failed', { doc_id: prior.id, class: (err as Error).name });
  }
}
