/**
 * The preload allowlist. `contextIsolation` is on, so this is the only surface the renderer
 * has: a fixed set of channels, no `ipcRenderer`, no Node, no filesystem.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ChatterEdApi } from '../shared/ipc.js';
import type { AppCommand, RoomEvent, VaultView, WindowState } from '../shared/types.js';
import type { CostUpdate } from '../shared/cost.js';

const api: ChatterEdApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  setApiKey: (key) => ipcRenderer.invoke(IPC.setApiKey, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.clearApiKey),
  completeFirstRun: () => ipcRenderer.invoke(IPC.completeFirstRun),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  detectCli: (input) => ipcRenderer.invoke(IPC.detectCli, input),
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
  getVault: () => ipcRenderer.invoke(IPC.vaultGet),
  chooseVault: () => ipcRenderer.invoke(IPC.vaultChoose),
  rescanVault: () => ipcRenderer.invoke(IPC.vaultRescan),
  topicCandidates: () => ipcRenderer.invoke(IPC.vaultCandidates),
  promoteTopics: (input) => ipcRenderer.invoke(IPC.vaultPromote, input),
  vaultTree: (input) => ipcRenderer.invoke(IPC.vaultTree, input),
  findFiles: (input) => ipcRenderer.invoke(IPC.vaultFind, input),
  searchVault: (input) => ipcRenderer.invoke(IPC.vaultSearch, input),
  openDocument: (input) => ipcRenderer.invoke(IPC.vaultDocument, input),
  revealFile: (input) => ipcRenderer.invoke(IPC.vaultReveal, input),
  sessionSeed: (input) => ipcRenderer.invoke(IPC.vaultSeed, input),
  showDocument: (input) => ipcRenderer.invoke(IPC.showDocument, input),
  getSegments: (input) => ipcRenderer.invoke(IPC.segmentsGet, input),
  splitSegment: (input) => ipcRenderer.invoke(IPC.segmentsSplit, input),
  mergeSegments: (input) => ipcRenderer.invoke(IPC.segmentsMerge, input),
  reorderSegments: (input) => ipcRenderer.invoke(IPC.segmentsReorder, input),
  renameSegment: (input) => ipcRenderer.invoke(IPC.segmentsRename, input),
  flowAskHere: (input) => ipcRenderer.invoke(IPC.flowAskHere, input),
  flowAskDeck: (input) => ipcRenderer.invoke(IPC.flowAskDeck, input),
  flowExplainBack: (input) => ipcRenderer.invoke(IPC.flowExplainBack, input),
  // The artefact (issue #41): a thread summarised into the document, and the way back to the
  // conversation it was written from.
  flowSummarise: (input) => ipcRenderer.invoke(IPC.flowSummarise, input),
  flowThreadOf: (input) => ipcRenderer.invoke(IPC.flowThreadOf, input),
  // The attempt loop (issue #47): one Tester question on a card, and the answer after one try.
  flowTryHere: (input) => ipcRenderer.invoke(IPC.flowTryHere, input),
  flowShowAnswer: (input) => ipcRenderer.invoke(IPC.flowShowAnswer, input),
  flowSend: (input) => ipcRenderer.invoke(IPC.flowSend, input),
  flowMessages: (input) => ipcRenderer.invoke(IPC.flowMessages, input),
  flowWhisperOpen: (input) => ipcRenderer.invoke(IPC.flowWhisperOpen, input),
  flowWhisperSend: (input) => ipcRenderer.invoke(IPC.flowWhisperSend, input),
  flowWhisperRelay: (input) => ipcRenderer.invoke(IPC.flowWhisperRelay, input),
  flowWhisperClose: (input) => ipcRenderer.invoke(IPC.flowWhisperClose, input),
  flowSelection: (input) => ipcRenderer.invoke(IPC.flowSelection, input),
  flowStop: (input) => ipcRenderer.invoke(IPC.flowStop, input),
  flowTurnTrace: (input) => ipcRenderer.invoke(IPC.flowTurnTrace, input),
  flowMarkSeen: (input) => ipcRenderer.invoke(IPC.flowMarkSeen, input),
  flowCardState: (input) => ipcRenderer.invoke(IPC.flowCardState, input),
  // collab-doc (#48)
  notesGet: (input) => ipcRenderer.invoke(IPC.notesGet, input),
  notesIngest: (input) => ipcRenderer.invoke(IPC.notesIngest, input),
  notesPageImages: (input) => ipcRenderer.invoke(IPC.notesPageImages, input),
  notesSave: (input) => ipcRenderer.invoke(IPC.notesSave, input),
  notesFreeze: (input) => ipcRenderer.invoke(IPC.notesFreeze, input),
  notesEditResolved: (input) => ipcRenderer.invoke(IPC.notesEditResolved, input),
  notesSuggestionResolved: (input) => ipcRenderer.invoke(IPC.notesSuggestionResolved, input),
  notesDocText: (input) => ipcRenderer.invoke(IPC.notesDocText, input),
  chatThreads: (input) => ipcRenderer.invoke(IPC.chatThreads, input),
  chatSend: (input) => ipcRenderer.invoke(IPC.chatSend, input),
  chatOpenSpan: (input) => ipcRenderer.invoke(IPC.chatOpenSpan, input),
  chatPrivateOpen: (input) => ipcRenderer.invoke(IPC.chatPrivateOpen, input),
  chatPrivateSend: (input) => ipcRenderer.invoke(IPC.chatPrivateSend, input),
  chatInsertIntoDoc: (input) => ipcRenderer.invoke(IPC.chatInsertIntoDoc, input),
  quizPass: (input) => ipcRenderer.invoke(IPC.quizPass, input),
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
  onCostUpdated: (listener) => {
    const handler = (_event: unknown, payload: CostUpdate) => listener(payload);
    ipcRenderer.on(IPC.costUpdated, handler);
    return () => {
      ipcRenderer.removeListener(IPC.costUpdated, handler);
    };
  },
  onVaultChanged: (listener) => {
    const handler = (_event: unknown, payload: VaultView) => listener(payload);
    ipcRenderer.on(IPC.vaultChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC.vaultChanged, handler);
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
