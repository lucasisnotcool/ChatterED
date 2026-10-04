/**
 * **What the renderer is sent about a tutorial** (`TUTORIAL-CONTRACT.md` S2): `TutorialView`,
 * built from the source row, the tutorial's notes doc and its part records. The hidden key is
 * read here only to say whether the official solutions are in; it is never copied into a view.
 */
import type { Node } from 'prosemirror-model';
import type { NotesDocView } from '../../shared/doc/types.js';
import { docFromJson } from '../../shared/doc/schema.js';
import { partAnswers, type PartAnswer } from '../../shared/doc/tutorialdoc.js';
import type { LearningObjective } from '../../shared/objectives.js';
import type { NotebookSourceView } from '../../shared/notebook.js';
import {
  tutorialContentKey,
  type TutorialGap,
  type TutorialPartStatus,
  type TutorialPartView,
  type TutorialStatus,
  type TutorialView,
} from '../../shared/tutorial.js';
import type { NotesDocRecord, NotesRepo } from '../db/repos/notes.js';
import { ingestView } from '../notes/ingest.js';
import type { PartRecord } from './repo.js';

/** The source's name without its extension: a tutorial's title before it has been read. */
export function bareName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || name;
}

/** The stored doc, parsed; null when there is none or it will not parse. */
export function parsedDoc(record: NotesDocRecord | null): Node | null {
  if (!record || record.doc === null || record.doc === undefined) return null;
  try {
    return docFromJson(record.doc);
  } catch {
    return null;
  }
}

/**
 * A part's status as the learner sees it: the last check's verdict, `revealed`, or — when none
 * has run — `working` once anything is written in the saved document, else `untried`.
 */
export function partStatus(record: PartRecord | null, answer: PartAnswer): TutorialPartStatus {
  const stored = record?.status ?? 'untried';
  if (stored === 'untried' || stored === 'working') return answer.empty ? 'untried' : 'working';
  return stored;
}

/**
 * **What the lecture teaches that no part exercises** (Lucas, 3 Oct 2026). The notebook's
 * objectives that are taught on a lecture page (a ref on a page `isLecturePage` accepts, and not
 * assumed by the deck) and that no part's `objectiveIds` include, in the tree's order, each with
 * its lecture pages. Nothing is generated from it; it is shown so the learner can decide.
 */
export function tutorialGaps(
  objectives: readonly Pick<LearningObjective, 'id' | 'title' | 'refs' | 'assumedByDeck' | 'order'>[],
  parts: readonly { objectiveIds: readonly string[] }[],
  isLecturePage: (page: number) => boolean,
): TutorialGap[] {
  const covered = new Set(parts.flatMap((p) => p.objectiveIds));
  return [...objectives]
    .sort((a, b) => a.order - b.order)
    .flatMap((o) => {
      if (o.assumedByDeck || covered.has(o.id)) return [];
      const pages = [...new Set(o.refs.map((r) => r.page).filter((p) => Number.isInteger(p) && isLecturePage(p)))].sort((a, b) => a - b);
      return pages.length > 0 ? [{ objectiveId: o.id, title: o.title, pages }] : [];
    });
}

function tutorialStatus(record: NotesDocRecord | null): TutorialStatus {
  if (!record) return 'pending';
  if (record.ingestStatus === 'ready') return 'ready';
  if (record.ingestStatus === 'failed') return 'failed';
  return 'pending';
}

export interface ViewInput {
  notebookId: string;
  source: Pick<NotebookSourceView, 'fileId' | 'name'>;
  record: NotesDocRecord | null;
  records: readonly PartRecord[];
  objectives: readonly LearningObjective[];
  isLecturePage(page: number): boolean;
}

export function tutorialView(input: ViewInput): TutorialView {
  const { record } = input;
  const doc = record?.ingestStatus === 'ready' ? parsedDoc(record) : null;
  const byPart = new Map(input.records.map((r) => [r.partId, r]));
  const parts: TutorialPartView[] = doc
    ? partAnswers(doc).map((answer) => {
        const r = byPart.get(answer.partId) ?? null;
        return {
          partId: answer.partId,
          origin: 'sheet',
          blockId: answer.blockId,
          label: answer.label,
          answerKind: answer.kind,
          status: partStatus(r, answer),
          hintLevel: r?.hintLevel ?? 0,
          attempts: r?.attempts ?? 0,
          checkedBy: r?.checkedBy ?? null,
          links: r ? { notesBlockIds: [...r.links.notesBlockIds], pages: [...r.links.pages] } : { notesBlockIds: [], pages: [] },
          objectiveIds: r ? [...r.objectiveIds] : [],
        };
      })
    : [];
  const keyed = parts.map((p) => byPart.get(p.partId)).filter((r): r is PartRecord => r !== undefined);
  return {
    notebookId: input.notebookId,
    fileId: input.source.fileId,
    docId: record?.id ?? null,
    contentKey: tutorialContentKey(input.notebookId, input.source.fileId),
    title: record?.title.trim() || bareName(input.source.name),
    status: tutorialStatus(record),
    error: record?.error ?? null,
    parts,
    hasSolutions: keyed.length > 0 && keyed.every((r) => r.key.from === 'solutions'),
    gaps: doc ? tutorialGaps(input.objectives, parts, input.isLecturePage) : [],
  };
}

/** The document as `notes:get` returns the notes' (`TUTORIAL-CONTRACT.md` S2). */
export function tutorialDocView(repo: NotesRepo, record: NotesDocRecord): NotesDocView {
  return {
    docId: record.id,
    fileId: record.fileId ?? '',
    contentSha: record.contentSha,
    title: record.title,
    pageCount: record.pageCount,
    version: record.version,
    doc: record.doc,
    ingest: ingestView(record),
    frozen: record.frozen,
    edits: repo.edits(record.id, 'applied').map(({ roomId: _roomId, ...edit }) => ({ ...edit, status: 'applied' as const })),
    suggestions: repo.suggestions(record.id, 'open'),
    overview: null,
  };
}
