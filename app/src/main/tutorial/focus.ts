/**
 * **The tutorial as the main view: what the agents are told** (2026-10-04, Lucas; `docs/research/
 * tutorials.md` §2).
 *
 * With the swap on, the sheet fills the middle of the screen and the lecture notes are a click
 * away. A question in the notebook chat, or Explain / Example / Ask… on a line of the sheet, is then
 * about the sheet, and the turn has to be told so: which sheet, its parts and which are still the
 * learner's, and the lecture behind them. Before this, the notebook chat was answered from the deck
 * alone (`docroom/ipc.ts` `contextFor`), and a line of the sheet from the sheet's own page: the
 * lecture notes blocks a part draws on reached only Max's tutor turns (`part.ts` `partMaterial`).
 *
 * Built here from the saved sheet, the parts' records and links, and the notebook's notes; handed
 * to the actor as one block (`prompts.tutor.tutorialFocusBlock`) by `chat:send`, `chat:openSpan`
 * and `notes:blockAction` when the renderer says the tutorial is the main view. **Never the key**:
 * the sheet's guard (`sheetGuardBlock`) still follows on every turn while a part is unsolved, and
 * a typed reply in a part's thread still goes to Max (`reply.ts`) before any of this is read.
 */
import { docOutline } from '../../shared/doc/schema.js';
import { partAnswers } from '../../shared/doc/tutorialdoc.js';
import { tutorialFocusBlock, type FocusPart, type TutorialFocusInput } from '../../room/prompts.tutor.js';
import { notebookDoc, tutorialRecord, tutorialSource, viewOf, type TutorialDeps } from './context.js';
import { partMaterial, promptInContext, resolvePart } from './part.js';
import { partsOf } from './reply.js';
import { parsedDoc } from './view.js';

export interface TutorialFocusRequest {
  notebookId: string;
  /** The tutorial the learner has as the main view. */
  fileId: string;
  /** The line asked about, when the action is on a line of that sheet; null for the notebook chat. */
  blockId?: string | null;
}

/**
 * What the turn reads about the sheet, or null when `fileId` is not a tutorial of this notebook
 * (the renderer names it; a stale or foreign id is refused, never trusted).
 */
export function tutorialFocus(deps: TutorialDeps, input: TutorialFocusRequest): TutorialFocusInput | null {
  const subject = deps.notebooks.subject(input.notebookId);
  const source = tutorialSource(subject, input.fileId);
  if (!source) return null;
  const view = viewOf(deps, input.notebookId, input.fileId);
  const title = view?.title?.trim() || source.name;
  const doc = parsedDoc(tutorialRecord(deps, input.notebookId, input.fileId));
  // Still being read: the turn still knows the learner is on a sheet, not the notes.
  if (!doc) return { title, parts: [], current: null, notes: [] };

  const records = new Map((view?.parts ?? []).map((p) => [p.partId, p]));
  const headings = notesHeadings(deps, input.notebookId);
  const parts: FocusPart[] = partAnswers(doc).map((a) => {
    const record = records.get(a.partId);
    const status = record?.status;
    return {
      label: a.label || a.partId,
      prompt: a.prompt,
      solved: status === 'correct' || status === 'revealed',
      notesHeadings: unique((record?.links.notesBlockIds ?? []).map((id) => headings.get(id) ?? '').filter(Boolean)),
      pages: record?.links.pages ?? [],
    };
  });

  // The line asked about, inside a part: that part, with its problem and its lecture, as a tutor
  // turn has them. Outside every part (a problem's stem, the title), the sheet as a whole.
  const blockId = input.blockId ?? null;
  const inPart = blockId ? partsOf(doc).find((p) => p.blockIds.includes(blockId)) : undefined;
  const resolved = inPart ? resolvePart(deps, { notebookId: input.notebookId, fileId: input.fileId, partId: inPart.partId }) : null;
  if (resolved) {
    return {
      title,
      parts,
      current: {
        label: resolved.answer.label || resolved.answer.partId,
        prompt: promptInContext(resolved.answer),
        ...partMaterial(deps, input.notebookId, resolved.part),
      },
      notes: [],
    };
  }

  // The notebook chat: the notes blocks every part links to, in the sheet's order, once each.
  const linked = unique((view?.parts ?? []).flatMap((p) => p.links.notesBlockIds));
  const { notes } = partMaterial(deps, input.notebookId, { links: { notesBlockIds: linked, pages: [] } });
  return { title, parts, current: null, notes };
}

/** The block itself, or null: what `DocHost.tutorialFocus` hands to `chat:send` and the rest. */
export function tutorialFocusText(deps: TutorialDeps, input: TutorialFocusRequest): string | null {
  const focus = tutorialFocus(deps, input);
  return focus ? tutorialFocusBlock(focus) : null;
}

/** Each notes block's section: its own text for a heading, else the heading it sits under. */
function notesHeadings(deps: TutorialDeps, notebookId: string): Map<string, string> {
  const doc = notebookDoc(deps, notebookId);
  const out = new Map<string, string>();
  if (!doc) return out;
  for (const e of docOutline(doc)) {
    const heading = e.kind === 'heading' ? e.text : (e.path[e.path.length - 1] ?? '');
    if (heading.trim()) out.set(e.blockId, heading.trim());
  }
  return out;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
