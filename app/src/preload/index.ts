/**
 * The preload allowlist. `contextIsolation` is on, so this is the only surface the renderer
 * has: a fixed set of channels, no `ipcRenderer`, no Node, no filesystem.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type ChatterEdApi } from '../shared/ipc.js';
import type { AppCommand, RoomEvent, WindowState } from '../shared/types.js';
import type { CostUpdate } from '../shared/cost.js';
import type { NotebookChange } from '../shared/notebook.js';
import type { TutorialChange } from '../shared/tutorial.js';
import { trialApi } from './trial.js';

const api: ChatterEdApi = {
  trial: trialApi,
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  setApiKey: (key) => ipcRenderer.invoke(IPC.setApiKey, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.clearApiKey),
  completeFirstRun: () => ipcRenderer.invoke(IPC.completeFirstRun),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  detectCli: (input) => ipcRenderer.invoke(IPC.detectCli, input),
  setProviderKey: (input) => ipcRenderer.invoke(IPC.setProviderKey, input),
  clearProviderKey: (input) => ipcRenderer.invoke(IPC.clearProviderKey, input),
  testProvider: (input) => ipcRenderer.invoke(IPC.testProvider, input),
  draftConcept: (input) => ipcRenderer.invoke(IPC.draftConcept, input),
  createSession: (input) => ipcRenderer.invoke(IPC.createSession, input),
  openRoom: (roomId) => ipcRenderer.invoke(IPC.openRoom, roomId),
  sendMessage: (input) => ipcRenderer.invoke(IPC.sendMessage, input),
  typing: (input) => ipcRenderer.invoke(IPC.typing, input),
  holdTimer: (input) => ipcRenderer.invoke(IPC.holdTimer, input),
  pauseNudges: (input) => ipcRenderer.invoke(IPC.pauseNudges, input),
  wrapUp: (input) => ipcRenderer.invoke(IPC.wrapUp, input),
  retryTurn: (input) => ipcRenderer.invoke(IPC.retryTurn, input),
  logRendererError: (input) => ipcRenderer.invoke(IPC.logRendererError, input),
  openLogFolder: () => ipcRenderer.invoke(IPC.openLogFolder),
  diagnostics: () => ipcRenderer.invoke(IPC.diagnostics),
  acceptTeachback: (input) => ipcRenderer.invoke(IPC.acceptTeachback, input),
  openWhisper: (input) => ipcRenderer.invoke(IPC.openWhisper, input),
  sendWhisper: (input) => ipcRenderer.invoke(IPC.sendWhisper, input),
  relayWhisper: (input) => ipcRenderer.invoke(IPC.relayWhisper, input),
  closeWhisper: (input) => ipcRenderer.invoke(IPC.closeWhisper, input),
  onEvent: (listener) => {
    const handler = (_event: unknown, payload: RoomEvent) => listener(payload);
    ipcRenderer.on(IPC.event, handler);
    return () => {
      ipcRenderer.removeListener(IPC.event, handler);
    };
  },
  openDocument: (input) => ipcRenderer.invoke(IPC.vaultDocument, input),
  getSegments: (input) => ipcRenderer.invoke(IPC.segmentsGet, input),
  splitSegment: (input) => ipcRenderer.invoke(IPC.segmentsSplit, input),
  mergeSegments: (input) => ipcRenderer.invoke(IPC.segmentsMerge, input),
  reorderSegments: (input) => ipcRenderer.invoke(IPC.segmentsReorder, input),
  renameSegment: (input) => ipcRenderer.invoke(IPC.segmentsRename, input),
  // The artefact (issue #41): a thread summarised into the document, and the way back to the
  // conversation it was written from.
  // The attempt loop (issue #47): one Tester question on a card, and the answer after one try.
  flowStop: (input) => ipcRenderer.invoke(IPC.flowStop, input),
  flowTurnTrace: (input) => ipcRenderer.invoke(IPC.flowTurnTrace, input),
  // collab-doc (#48)
  notesGet: (input) => ipcRenderer.invoke(IPC.notesGet, input),
  notesIngest: (input) => ipcRenderer.invoke(IPC.notesIngest, input),
  notesPageImages: (input) => ipcRenderer.invoke(IPC.notesPageImages, input),
  notesSave: (input) => ipcRenderer.invoke(IPC.notesSave, input),
  notesFreeze: (input) => ipcRenderer.invoke(IPC.notesFreeze, input),
  notesEditResolved: (input) => ipcRenderer.invoke(IPC.notesEditResolved, input),
  notesSuggestionResolved: (input) => ipcRenderer.invoke(IPC.notesSuggestionResolved, input),
  notesRegenerate: (input) => ipcRenderer.invoke(IPC.notesRegenerate, input),
  notesPageLines: (input) => ipcRenderer.invoke(IPC.notesPageLines, input),
  notesPageTexts: (input) => ipcRenderer.invoke(IPC.notesPageTexts, input),
  notesSlideGroups: (input) => ipcRenderer.invoke(IPC.notesSlideGroups, input),
  notesSetSlideGroup: (input) => ipcRenderer.invoke(IPC.notesSetSlideGroup, input),
  notesDocText: (input) => ipcRenderer.invoke(IPC.notesDocText, input),
  notesAnswerQuestion: (input) => ipcRenderer.invoke(IPC.notesAnswerQuestion, input),
  notesGenerateBlock: (input) => ipcRenderer.invoke(IPC.notesGenerateBlock, input),
  chatThreads: (input) => ipcRenderer.invoke(IPC.chatThreads, input),
  chatSend: (input) => ipcRenderer.invoke(IPC.chatSend, input),
  chatOpenSpan: (input) => ipcRenderer.invoke(IPC.chatOpenSpan, input),
  chatPrivateOpen: (input) => ipcRenderer.invoke(IPC.chatPrivateOpen, input),
  chatPrivateSend: (input) => ipcRenderer.invoke(IPC.chatPrivateSend, input),
  chatInsertIntoDoc: (input) => ipcRenderer.invoke(IPC.chatInsertIntoDoc, input),
  chatReset: (input) => ipcRenderer.invoke(IPC.chatReset, input),
  chatCloseFile: (input) => ipcRenderer.invoke(IPC.chatCloseFile, input),
  quizPass: (input) => ipcRenderer.invoke(IPC.quizPass, input),
  quizHint: (input) => ipcRenderer.invoke(IPC.quizHint, input),
  progressGet: (input) => ipcRenderer.invoke(IPC.progressGet, input),
  progressStart: (input) => ipcRenderer.invoke(IPC.progressStart, input),
  // The learning-objective tree (issue #38). Five channels, no events of their own: the two
  // pushes ride `IPC.event` with everything else the room emits.
  objectivesTree: (input) => ipcRenderer.invoke(IPC.objectivesTree, input),
  objectivesStates: (input) => ipcRenderer.invoke(IPC.objectivesStates, input),
  objectivesRegenerate: (input) => ipcRenderer.invoke(IPC.objectivesRegenerate, input),
  objectivesReset: (input) => ipcRenderer.invoke(IPC.objectivesReset, input),
  objectivesTeach: (input) => ipcRenderer.invoke(IPC.objectivesTeach, input),
  costSummary: (input) => ipcRenderer.invoke(IPC.costSummary, input),
  costRecent: (input) => ipcRenderer.invoke(IPC.costRecent, input),
  costExport: (input) => ipcRenderer.invoke(IPC.costExport, input),
  costMessages: (input) => ipcRenderer.invoke(IPC.costMessages, input),
  costAnalytics: (input) => ipcRenderer.invoke(IPC.costAnalytics, input),
  onCostUpdated: (listener) => {
    const handler = (_event: unknown, payload: CostUpdate) => listener(payload);
    ipcRenderer.on(IPC.costUpdated, handler);
    return () => {
      ipcRenderer.removeListener(IPC.costUpdated, handler);
    };
  },
  // Notebooks (`docs/research/notebooks.md`, 2026-10-01).
  notebookList: () => ipcRenderer.invoke(IPC.notebookList),
  notebookGet: (input) => ipcRenderer.invoke(IPC.notebookGet, input),
  notebookCreate: (input) => ipcRenderer.invoke(IPC.notebookCreate, input),
  notebookRename: (input) => ipcRenderer.invoke(IPC.notebookRename, input),
  notebookDelete: (input) => ipcRenderer.invoke(IPC.notebookDelete, input),
  notebookOpen: (input) => ipcRenderer.invoke(IPC.notebookOpen, input),
  notebookPickFiles: () => ipcRenderer.invoke(IPC.notebookPickFiles),
  notebookAddSources: (input) => ipcRenderer.invoke(IPC.notebookAddSources, input),
  notebookSetEnabled: (input) => ipcRenderer.invoke(IPC.notebookSetEnabled, input),
  notebookRemoveSource: (input) => ipcRenderer.invoke(IPC.notebookRemoveSource, input),
  notebookMove: (input) => ipcRenderer.invoke(IPC.notebookMove, input),
  folderList: () => ipcRenderer.invoke(IPC.folderList),
  folderCreate: (input) => ipcRenderer.invoke(IPC.folderCreate, input),
  folderRename: (input) => ipcRenderer.invoke(IPC.folderRename, input),
  folderMove: (input) => ipcRenderer.invoke(IPC.folderMove, input),
  folderDelete: (input) => ipcRenderer.invoke(IPC.folderDelete, input),
  searchQuery: (input) => ipcRenderer.invoke(IPC.searchQuery, input),
  searchStatus: (input) => ipcRenderer.invoke(IPC.searchStatus, input),
  onNotebookChanged: (listener) => {
    const handler = (_event: unknown, payload: NotebookChange) => listener(payload);
    ipcRenderer.on(IPC.notebookChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC.notebookChanged, handler);
    };
  },
  // Electron's documented replacement for the sandbox's missing `File.path`. A path, never bytes:
  // main copies the file itself, so a 200 MB deck never crosses IPC.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  notesUpdateOverview: (input) => ipcRenderer.invoke(IPC.notesUpdateOverview, input),
  notesSetRecommendation: (input) => ipcRenderer.invoke(IPC.notesSetRecommendation, input),
  notesBlockAction: (input) => ipcRenderer.invoke(IPC.notesBlockAction, input),
  // Tutorials (`docs/research/tutorials.md`, 2026-10-03).
  notebookSetRole: (input) => ipcRenderer.invoke(IPC.notebookSetRole, input),
  tutorialList: (input) => ipcRenderer.invoke(IPC.tutorialList, input),
  tutorialDoc: (input) => ipcRenderer.invoke(IPC.tutorialDoc, input),
  tutorialIngest: (input) => ipcRenderer.invoke(IPC.tutorialIngest, input),
  tutorialCheck: (input) => ipcRenderer.invoke(IPC.tutorialCheck, input),
  tutorialHelp: (input) => ipcRenderer.invoke(IPC.tutorialHelp, input),
  onTutorialChanged: (listener) => {
    const handler = (_event: unknown, payload: TutorialChange) => listener(payload);
    ipcRenderer.on(IPC.tutorialChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC.tutorialChanged, handler);
    };
  },
  onAppCommand: (listener) => {
    const handler = (_event: unknown, payload: AppCommand) => listener(payload);
    ipcRenderer.on(IPC.appCommand, handler);
    return () => {
      ipcRenderer.removeListener(IPC.appCommand, handler);
    };
  },
  onWindowState: (listener) => {
    const handler = (_event: unknown, payload: WindowState) => listener(payload);
    ipcRenderer.on(IPC.windowState, handler);
    return () => {
      ipcRenderer.removeListener(IPC.windowState, handler);
    };
  },
};

contextBridge.exposeInMainWorld('chattered', api);
