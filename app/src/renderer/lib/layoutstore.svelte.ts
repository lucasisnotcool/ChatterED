/**
 * The window's own layout: how wide the file panel and the chat column are, whether the file
 * panel is open, and how far the notes are zoomed. Kept per install in `localStorage`, the way
 * the chat width already was, and read by every surface that shows the same panel — so the
 * file panel is the same width in the shell and beside the page viewer.
 *
 * It is its own module rather than fields on `store` because none of it is about a document or
 * a conversation, and the menu's `files.toggle` is the only thing outside the panels that
 * touches it.
 */
import {
  CHAT,
  FILES,
  HOME_ZOOM,
  NOTES_ZOOM,
  TUTORIAL,
  clamp,
  clampSplit,
  filesChosen,
  readFloatFrame,
  readSplitRatio,
  readTutorialMain,
  readZoom,
  roomForTutorial,
  withTutorialMain,
  type FilesRoom,
  type FloatFrame,
  type PanelBounds,
  type TutorialMainMap,
} from './layout.js';

const KEYS = {
  filesOpen: 'chattered.files.open',
  filesWidth: 'chattered.files.width',
  chatWidth: 'chattered.chat.width',
  notesZoom: 'chattered.notes.zoom',
  tutorialZoom: 'chattered.tutorial.zoom',
  homeZoom: 'chattered.home.zoom',
  mapOpen: 'chattered.notesmap.open',
  tutorialWidth: 'chattered.tutorial.width',
  tutorialSplit: 'chattered.tutorial.split',
  tutorialMain: 'chattered.tutorial.main',
  notesFrame: 'chattered.notes.frame',
} as const;

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // A denied or full store is not worth failing a drag over.
  }
}

function readWidth(key: string, bounds: PanelBounds): number {
  const raw = Number(read(key));
  if (!Number.isFinite(raw) || raw <= 0) return bounds.initial;
  return Math.round(clamp(raw, bounds.min, bounds.max));
}

export class LayoutStore {
  filesOpen = $state(read(KEYS.filesOpen) !== 'false');
  filesWidth = $state(readWidth(KEYS.filesWidth, FILES));
  chatWidth = $state(readWidth(KEYS.chatWidth, CHAT));
  /** The tutorial column docked beside the notes (`tutorials.md` §2). */
  tutorialWidth = $state(readWidth(KEYS.tutorialWidth, TUTORIAL));
  /** The tutorial's Split: the top view's share of the pane's body (`TUTORIAL_SPLIT`). */
  tutorialSplit = $state(readSplitRatio(read(KEYS.tutorialSplit)));
  notesZoom = $state(readZoom(read(KEYS.notesZoom), NOTES_ZOOM));
  /** The tutorial's sheet, zoomed on its own (2026-10-04): it sits beside the notes, not in them. */
  tutorialZoom = $state(readZoom(read(KEYS.tutorialZoom), NOTES_ZOOM));
  homeZoom = $state(readZoom(read(KEYS.homeZoom), HOME_ZOOM));
  /** The map of the notes in the file panel: open until the learner folds it away. */
  mapOpen = $state(read(KEYS.mapOpen) !== 'false');
  /**
   * The sources panel is folded away to make room for a docked tutorial, by the app rather than
   * the learner (`roomForTutorial`). Never persisted: what is stored is still the learner's own
   * choice, so a restart with no tutorial open finds the panel where they left it.
   */
  filesMadeRoom = $state(false);
  /**
   * **The tutorial as the main view** (2026-10-04, `tutorials.md` §2): per notebook, the tutorial
   * the middle column shows instead of the notes. Off (absent) by default; kept per install.
   */
  tutorialMain = $state<TutorialMainMap>(readTutorialMain(read(KEYS.tutorialMain)));
  /**
   * With the tutorial as the main view, the notes float in a window over the app when the learner
   * opens them (the **Notes** control, a part's *From the notes*, the map, a lesson's Start). Open
   * or not is this sitting's; the window's place and size are kept, as the tutorial window's are.
   */
  notesWindowOpen = $state(false);
  notesFrame = $state<FloatFrame | null>(readFloatFrame(read(KEYS.notesFrame)));
  #docked = false;
  #learnerChose = false;

  #room(): FilesRoom {
    return { open: this.filesOpen, madeRoom: this.filesMadeRoom, docked: this.#docked, chose: this.#learnerChose };
  }

  #apply(next: FilesRoom): void {
    if (this.filesOpen !== next.open) this.filesOpen = next.open;
    if (this.filesMadeRoom !== next.madeRoom) this.filesMadeRoom = next.madeRoom;
    this.#docked = next.docked;
    this.#learnerChose = next.chose;
  }

  /** The learner's choice (the toggle, the edge, View ▸ Show/Hide Files): always respected. */
  setFilesOpen(open: boolean): void {
    this.#apply(filesChosen(this.#room(), open));
    write(KEYS.filesOpen, String(open));
  }

  /** Room for a docked tutorial (`layout.ts` `roomForTutorial`): `null` when none is docked. */
  roomForTutorial(crowded: boolean | null): void {
    this.#apply(roomForTutorial(this.#room(), crowded));
  }

  toggleFiles(): void {
    this.setFilesOpen(!this.filesOpen);
  }

  setFilesWidth(width: number): void {
    this.filesWidth = Math.round(clamp(width, FILES.min, FILES.max));
    write(KEYS.filesWidth, String(this.filesWidth));
  }

  setChatWidth(width: number): void {
    this.chatWidth = Math.round(clamp(width, CHAT.min, CHAT.max));
    write(KEYS.chatWidth, String(this.chatWidth));
  }

  setTutorialWidth(width: number): void {
    this.tutorialWidth = Math.round(clamp(width, TUTORIAL.min, TUTORIAL.max));
    write(KEYS.tutorialWidth, String(this.tutorialWidth));
  }

  /** `height`: the body's, so neither view goes below `SPLIT_VIEW_MIN`. Stored to the permille. */
  setTutorialSplit(ratio: number, height = 0): void {
    this.tutorialSplit = clampSplit(ratio, height);
    write(KEYS.tutorialSplit, String(this.tutorialSplit));
  }

  /** The swap, for one notebook: a tutorial's file id makes it the main view; null puts the notes back. */
  setTutorialMain(notebookId: string, fileId: string | null): void {
    if ((this.tutorialMain[notebookId] ?? null) === fileId) return;
    const next = withTutorialMain(this.tutorialMain, notebookId, fileId);
    this.tutorialMain = next;
    // Back to the notes: their window has nothing left to float over.
    if (fileId === null) this.notesWindowOpen = false;
    write(KEYS.tutorialMain, JSON.stringify(next));
  }

  setNotesWindowOpen(open: boolean): void {
    this.notesWindowOpen = open;
  }

  setNotesFrame(frame: FloatFrame): void {
    this.notesFrame = { ...frame };
    write(KEYS.notesFrame, JSON.stringify(frame));
  }

  setMapOpen(open: boolean): void {
    this.mapOpen = open;
    write(KEYS.mapOpen, String(open));
  }

  /** Rounded to the percent, so a pinch does not persist `1.3472918`. */
  setHomeZoom(zoom: number): void {
    this.homeZoom = Math.round(clamp(zoom, HOME_ZOOM.min, HOME_ZOOM.max) * 100) / 100;
    write(KEYS.homeZoom, String(this.homeZoom));
  }

  setNotesZoom(zoom: number): void {
    this.notesZoom = Math.round(clamp(zoom, NOTES_ZOOM.min, NOTES_ZOOM.max) * 100) / 100;
    write(KEYS.notesZoom, String(this.notesZoom));
  }

  setTutorialZoom(zoom: number): void {
    this.tutorialZoom = Math.round(clamp(zoom, NOTES_ZOOM.min, NOTES_ZOOM.max) * 100) / 100;
    write(KEYS.tutorialZoom, String(this.tutorialZoom));
  }
}

export const layout = new LayoutStore();
