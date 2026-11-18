/**
 * **Copy Debug Info for the Team**: the contract between main, preload and the renderer's panel.
 *
 * A field-study participant whose Mac we cannot reach presses one shortcut; the main process
 * builds a plain-text report (`src/main/debug/report.ts`), puts it on the clipboard, and asks the
 * window to show it in a small panel (`renderer/components/debug/DebugReportPanel.svelte`). They
 * paste it into the chat with the research team, and `npm run debug:read` reads it back.
 *
 * The renderer never builds or edits the report: it receives the finished text to *show*, and its
 * Copy button asks main to copy main's own copy again. So nothing the page holds reaches the
 * clipboard through these channels, and a broken page cannot make the report wrong.
 *
 * Shared by main, preload and renderer, so it imports nothing.
 */

export const DEBUG_IPC = {
  /** main → renderer: show this report (it is already on the clipboard). */
  show: 'debug:show',
  /** renderer → main: the panel for this token is on screen (else main falls back to a dialog). */
  shown: 'debug:shown',
  /** renderer → main: copy the last report again (the panel's Copy button, ⌘C, Ctrl+C). */
  copy: 'debug:copy',
} as const;

/**
 * **⇧⌘D.** Free in macOS and in the app, checked 2026-11-18: ⌥⌘D is the Dock's hide, ⌃⌘D is Look
 * Up, ⌥⌘D inside the app is the researcher's turn log (`App.svelte`), and ⇧⌘D is bound by
 * nothing in the app's menu, its ProseMirror keymaps or MathLive's defaults. Finder's own ⇧⌘D
 * (Desktop) only applies while Finder is frontmost.
 */
export const DEBUG_ACCELERATOR = 'CommandOrControl+Shift+D';
/** As the participant guide and the menu print it. */
export const DEBUG_SHORTCUT_LABEL = '⇧⌘D';
export const DEBUG_MENU_LABEL = 'Copy Debug Info for the Team';
export const DEBUG_COPIED_LINE = 'Copied. Paste it into your chat with the research team.';

export interface DebugShow {
  /** The report, exactly as it was copied. */
  text: string;
  /** Echoed back on `shown`, so a late acknowledgement for an older report is ignored. */
  token: string;
}

/** `window.chattered.debug`. */
export interface DebugApi {
  onShow(listener: (show: DebugShow) => void): () => void;
  shown(token: string): Promise<void>;
  /** Copies main's last report again; resolves to its length in characters. */
  copy(): Promise<{ ok: boolean; chars: number }>;
}
