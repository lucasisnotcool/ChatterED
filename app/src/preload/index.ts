/**
 * The preload allowlist. `contextIsolation` is on, so this is the only surface the renderer
 * has: a fixed set of channels, no `ipcRenderer`, no Node, no filesystem.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ChatterEdApi } from '../shared/ipc.js';
import type { RoomEvent, VaultView, WindowState } from '../shared/types.js';

const api: ChatterEdApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  chooseSlidesFolder: () => ipcRenderer.invoke(IPC.chooseSlidesFolder),
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
  onVaultChanged: (listener) => {
    const handler = (_event: unknown, payload: VaultView) => listener(payload);
    ipcRenderer.on(IPC.vaultChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC.vaultChanged, handler);
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
