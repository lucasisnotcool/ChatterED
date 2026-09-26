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
import { CHAT, FILES, NOTES_ZOOM, clamp, readZoom, type PanelBounds } from './layout.js';

const KEYS = {
  filesOpen: 'chattered.files.open',
  filesWidth: 'chattered.files.width',
  chatWidth: 'chattered.chat.width',
  notesZoom: 'chattered.notes.zoom',
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
  notesZoom = $state(readZoom(read(KEYS.notesZoom), NOTES_ZOOM));

  setFilesOpen(open: boolean): void {
    this.filesOpen = open;
    write(KEYS.filesOpen, String(open));
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

  /** Rounded to the percent, so a pinch does not persist `1.3472918`. */
  setNotesZoom(zoom: number): void {
    this.notesZoom = Math.round(clamp(zoom, NOTES_ZOOM.min, NOTES_ZOOM.max) * 100) / 100;
    write(KEYS.notesZoom, String(this.notesZoom));
  }
}

export const layout = new LayoutStore();
