/**
 * **`DocHost.notebooks`: a notebook as one virtual deck** (`dochost.ts` `NotebookHost`, contract
 * C1, C2, C4).
 *
 * Every page here is a **notebook page**: the sources laid end to end at their fixed bases. The
 * doc-path modules (the overview ingest, the block actions, the span context) read a notebook
 * through these four calls and never see a source's own numbering; only `locate` translates, for
 * the code that has to open a source's bytes.
 *
 * All of it is synchronous SQLite: a source's text is in `file_text`, one row per notebook page
 * of that source, written when the source became `ready` (`service.ts`). Nothing here reads a
 * file or runs pdf.js.
 */
import type { SqlDatabase } from '../db/driver.js';
import type { LocatedPage, NotebookHost, NotebookSubject, SourceRoleFilter } from '../dochost.js';
import type { SourceRole } from '../../shared/tutorial.js';
import { capText } from '../vault/extract.js';
import { DECK_TEXT_CAP } from '../vault/service.js';
import { createVaultRepo } from '../vault/repo.js';
import {
  contextFingerprint,
  isNotebookId,
  locatePage,
  notebookContentKey,
  type NotebookSourceView,
} from '../../shared/notebook.js';
import { notebooksRepo, sourceView, type SourceRecord } from './repo.js';

/** The line each source's text opens under in `deckText`. */
export function sourceHeader(name: string): string {
  return `=== SOURCE: ${name} ===`;
}

/** What an image source contributes to the deck text: its page marker and this line. */
export function imagePageLine(name: string): string {
  return `(An image: ${name}. It has no text to read.)`;
}

/** The room's context (`refreezeNotebookMaterial`, the doc chat): lecture and tutorial sources. */
export const ROOM_ROLES: readonly SourceRole[] = ['lecture', 'tutorial'];

/** The overview's: lecture sources only. */
export const OVERVIEW_ROLES: readonly SourceRole[] = ['lecture'];

function roleOf(record: Pick<SourceRecord, 'role'>): SourceRole {
  return record.role === 'tutorial' || record.role === 'solutions' ? record.role : 'lecture';
}

export interface NotebookHostImpl extends NotebookHost {
  /**
   * The room's outline for a notebook (C4): the first line of each page of the ticked, ready
   * sources, `p. N — head` with N the notebook page, under each source's name when there is more
   * than one. Never generated: what the sources say about themselves.
   */
  outline(notebookId: string, opts?: SourceRoleFilter): string;
  /**
   * What the scripted backend should recognise this notebook as: its first ticked, ready source
   * (name and the sha of its bytes), so a fixture deck added to a notebook still replays its
   * script. Falls back to the notebook's own name and content key.
   */
  scriptMaterial(notebookId: string): { fileName: string; contentSha: string };
}

export function createNotebookHost(db: SqlDatabase, deps: { absPath(relPath: string): string }): NotebookHostImpl {
  const repo = notebooksRepo(db);
  const vault = createVaultRepo(db);

  /**
   * The ticked, ready sources of the roles asked for (`tutorials.md` §1): by default the room's
   * context, lecture and tutorial. Solutions are never context, whatever is asked.
   */
  const inContext = (records: SourceRecord[], roles: readonly SourceRole[] = ROOM_ROLES) =>
    records.filter(
      (r) => r.enabled === 1 && r.status === 'ready' && roleOf(r) !== 'solutions' && roles.includes(roleOf(r)),
    );

  /** One source's indexed pages as notebook pages, in order. */
  const pagesOf = (record: SourceRecord, from: number | null = null, to: number | null = null) =>
    vault.text
      .pages(record.file_id, from, to)
      .filter((c): c is { page: number; body: string } => c.page !== null)
      .map((c) => ({ page: record.page_base + c.page, body: c.body.trim() }));

  const host: NotebookHostImpl = {
    subject(notebookId): NotebookSubject | null {
      if (!isNotebookId(notebookId)) return null;
      const view = repo.view(notebookId);
      if (!view) return null;
      return {
        id: view.id,
        name: view.name,
        contentKey: notebookContentKey(view.id),
        sources: view.sources,
        // The pages in use, present or past: a removed last source's pages stay in range, as a
        // gap, so the blocks that cite them still validate (`repo.ts` `view`).
        pageCount: view.pageCount,
        fingerprint: contextFingerprint(view.sources),
      };
    },

    deckText(notebookId, opts) {
      if (!isNotebookId(notebookId)) return { text: '', truncated: false };
      const parts: string[] = [];
      for (const record of inContext(repo.sources(notebookId), opts?.roles)) {
        parts.push(sourceHeader(record.display_name));
        if (record.file_kind === 'image') {
          parts.push(`[p. ${record.page_base + 1}]\n${imagePageLine(record.display_name)}`);
          continue;
        }
        for (const p of pagesOf(record)) {
          if (p.body.length > 0) parts.push(`[p. ${p.page}]\n${p.body}`);
        }
      }
      const text = parts.join('\n\n');
      const capped = capText(text, DECK_TEXT_CAP);
      return { text: capped, truncated: capped.length < text.length };
    },

    textFor({ notebookId, pageFrom, pageTo, includeSolutions }) {
      if (!isNotebookId(notebookId)) return '';
      if (!Number.isFinite(pageFrom) || !Number.isFinite(pageTo)) return '';
      const lo = Math.max(1, Math.floor(Math.min(pageFrom, pageTo)));
      const hi = Math.floor(Math.max(pageFrom, pageTo));
      const bodies: string[] = [];
      for (const record of repo.sources(notebookId)) {
        if (record.page_count < 1) continue;
        // Solutions are read only to rewrite a tutorial's key (`main/tutorial/`), never as context.
        if (roleOf(record) === 'solutions' && includeSolutions !== true) continue;
        const first = Math.max(lo, record.page_base + 1);
        const last = Math.min(hi, record.page_base + record.page_count);
        if (first > last) continue;
        if (record.file_kind === 'image') {
          bodies.push(imagePageLine(record.display_name));
          continue;
        }
        for (const p of pagesOf(record, first - record.page_base, last - record.page_base)) {
          if (p.body.length > 0) bodies.push(p.body);
        }
      }
      // Sources are in the order added, which is also page order (bases are append-only).
      return capText(bodies.join('\n\n'), DECK_TEXT_CAP);
    },

    locate(notebookId, page): LocatedPage | null {
      if (!isNotebookId(notebookId)) return null;
      const records = repo.sources(notebookId);
      const views: (NotebookSourceView & { record: SourceRecord })[] = records.map((r) => ({
        ...sourceView(r),
        record: r,
      }));
      const hit = locatePage(views, page);
      if (!hit || hit.source.record.rel_path === null) return null;
      let path: string;
      try {
        path = deps.absPath(hit.source.record.rel_path);
      } catch {
        return null;
      }
      return {
        fileId: hit.source.fileId,
        localPage: hit.localPage,
        path,
        kind: hit.source.kind,
        contentSha: hit.source.record.sha256,
      };
    },

    outline(notebookId, opts) {
      if (!isNotebookId(notebookId)) return '';
      const records = inContext(repo.sources(notebookId), opts?.roles);
      const named = records.length > 1;
      const lines: string[] = [];
      for (const record of records) {
        if (named) lines.push(`${record.display_name}:`);
        if (record.file_kind === 'image') {
          lines.push(`p. ${record.page_base + 1} — (image) ${record.display_name}`);
          continue;
        }
        let last = '';
        for (const p of pagesOf(record)) {
          const head = p.body
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.length > 0);
          if (!head) continue;
          const short = head.length > 80 ? `${head.slice(0, 79)}…` : head;
          if (short === last) continue;
          lines.push(`p. ${p.page} — ${short}`);
          last = short;
        }
      }
      return lines.join('\n');
    },

    scriptMaterial(notebookId) {
      const first = inContext(repo.sources(notebookId), ['lecture'])[0] ?? inContext(repo.sources(notebookId))[0];
      if (first && first.sha256) return { fileName: first.display_name, contentSha: first.sha256 };
      return { fileName: repo.get(notebookId)?.name ?? notebookId, contentSha: notebookContentKey(notebookId) };
    },
  };
  return host;
}
