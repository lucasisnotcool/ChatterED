/**
 * **The `tutorial:*` channels** (`shared/ipc.ts`, `TUTORIAL-CONTRACT.md` S2). Registered from
 * `AppService.register()` through its wrapped `handle`, like every other channel. The bodies are
 * thin: `ingest.ts`, `check.ts` and `help.ts` own the rules; this file checks the shape of what
 * the renderer sent and builds `TutorialDeps` from the `DocHost`.
 */
import { IPC } from '../../shared/ipc.js';
import { isNotebookId } from '../../shared/notebook.js';
import type {
  TutorialChange,
  TutorialCheckInput,
  TutorialHelpInput,
  TutorialIngestInput,
  TutorialListInput,
} from '../../shared/tutorial.js';
import type { DocHost, IpcHandle } from '../dochost.js';
import { notesRepo } from '../db/repos/notes.js';
import { emitProgress } from '../docroom/progress.js';
import { pageGeometry } from '../vault/pagecache.js';
import { checkPart } from './check.js';
import { listViews, tutorialRecord, type TutorialDeps } from './context.js';
import { helpPart } from './help.js';
import { ingestTutorial } from './ingest.js';
import { tutorialDocView } from './view.js';

/** `TutorialDeps` over the app: the overview's client, the notebook's room, the bar's push. */
export function tutorialDepsFor(host: DocHost, push: (change: TutorialChange) => void): TutorialDeps {
  return {
    db: host.db,
    notebooks: host.notebooks,
    userDataDir: host.userDataDir,
    llm(notebookId) {
      const backend = host.backend();
      if (backend.kind === 'scripted') return null;
      const client = host.llm(backend, { fileName: host.notebooks.subject(notebookId)?.name ?? null, contentSha: null });
      return client.kind === 'scripted' ? null : client;
    },
    models: () => host.backend().models,
    geometry: (input) => pageGeometry(input),
    objectivesTree: (notebookId) => host.objectivesTree(notebookId),
    push,
    openRoom: async (notebookId) => {
      const { roomId, actor } = await host.openFlowRoom(notebookId);
      return { roomId, actor };
    },
    persistFlow: () => host.persistFlow(),
    onOutcome: (notebookId) => void emitProgress(host, notebookId),
  };
}

function requireNotebook(raw: unknown): string {
  if (typeof raw !== 'string' || !isNotebookId(raw)) throw new Error('Not a notebook id.');
  return raw;
}

function requireString(raw: unknown, what: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) throw new Error(`Missing ${what}.`);
  return raw;
}

export function registerTutorialIpc(deps: TutorialDeps, handle: IpcHandle): void {
  handle<TutorialListInput>(IPC.tutorialList, (input) => listViews(deps, requireNotebook(input?.notebookId)));

  handle<{ notebookId: string; fileId: string }>(IPC.tutorialDoc, (input) => {
    const record = tutorialRecord(deps, requireNotebook(input?.notebookId), requireString(input?.fileId, 'the tutorial'));
    return record ? tutorialDocView(notesRepo(deps.db), record) : null;
  });

  handle<TutorialIngestInput>(IPC.tutorialIngest, (input) =>
    ingestTutorial(deps, {
      notebookId: requireNotebook(input?.notebookId),
      fileId: requireString(input?.fileId, 'the tutorial'),
      force: input?.force === true,
    }),
  );

  handle<TutorialCheckInput>(IPC.tutorialCheck, (input) =>
    checkPart(deps, {
      notebookId: requireNotebook(input?.notebookId),
      fileId: requireString(input?.fileId, 'the tutorial'),
      partId: requireString(input?.partId, 'the part'),
    }),
  );

  handle<TutorialHelpInput>(IPC.tutorialHelp, (input) =>
    helpPart(deps, {
      notebookId: requireNotebook(input?.notebookId),
      fileId: requireString(input?.fileId, 'the tutorial'),
      partId: requireString(input?.partId, 'the part'),
      kind: input?.kind,
    }),
  );
}
