/**
 * **A block's stored explain, in a popover** (migration 033, 2026-10-07).
 *
 * The comment badge beside a block (`chrome.ts`) and the search page open this: what Ellie would
 * answer to Explain on that line, written ahead of time and read with no network. The body is the
 * chat's closed markup subset, typeset by `aitext.ts` (KaTeX for `$…$`), so no stored string
 * ever becomes a tag.
 *
 * Like the slide peek (`sourcepop.ts`) it is `position: fixed`, appended to the notes pane (`.nd`)
 * or the body, outside ProseMirror's DOM: it is never in the document, never saved, never scaled
 * by the notes zoom. One at a time; Esc, a press outside, a scroll outside or a resize closes it.
 */
import { paragraphs } from '../aitext.js';
import { closeSourcePopover } from './sourcepop.js';

const EDGE = 8;
const WIDTH = 380;

let current: { anchor: HTMLElement; dispose: () => void } | null = null;

export function closeCommentPopover(): void {
  const was = current;
  current = null;
  was?.dispose();
}

/** Is the popover up for this anchor? (A second press on the badge closes it.) */
export function commentPopoverFor(anchor: HTMLElement): boolean {
  return current?.anchor === anchor;
}

/** Below the anchor, right edges aligned, inside the window; above it when below has no room. */
export function placeBelow(
  at: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(EDGE, Math.min(view.width - size.width - EDGE, at.right - size.width));
  const below = at.bottom + 6;
  const top = below + size.height + EDGE <= view.height ? below : Math.max(EDGE, at.top - size.height - 6);
  return { left: Math.round(left), top: Math.round(top) };
}

export function openCommentPopover(anchor: HTMLElement, body: string, opts: { title?: string } = {}): void {
  if (commentPopoverFor(anchor)) {
    closeCommentPopover();
    return;
  }
  closeCommentPopover();
  closeSourcePopover();

  const node = document.createElement('div');
  node.className = 'nd-cmtpop';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', 'Ellie explains this line');
  node.style.width = `${String(Math.min(WIDTH, globalThis.innerWidth - EDGE * 2))}px`;
  const head = document.createElement('div');
  head.className = 'nd-cmtpop-head';
  const dot = document.createElement('span');
  dot.className = 'nd-tool-dot nd-tool-dot-ellie';
  dot.setAttribute('aria-hidden', 'true');
  const who = document.createElement('span');
  who.className = 'nd-cmtpop-who';
  who.textContent = opts.title ?? 'Ellie explains';
  const note = document.createElement('span');
  note.className = 'nd-cmtpop-note';
  note.textContent = 'saved · offline';
  note.title = 'Written ahead of time and stored with your notes. It needs no network.';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'nd-cmtpop-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('mousedown', (e) => e.preventDefault());
  close.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeCommentPopover();
  });
  head.append(dot, who, note, close);
  const text = document.createElement('div');
  text.className = 'nd-cmtpop-body';
  // `paragraphs` escapes everything and puts back only its closed subset and KaTeX's output.
  text.innerHTML = paragraphs(body);
  node.append(head, text);

  (anchor.closest('.nd') ?? document.body).append(node);
  const place = (): void => {
    const spot = placeBelow(anchor.getBoundingClientRect(), { width: node.offsetWidth, height: node.offsetHeight }, { width: globalThis.innerWidth, height: globalThis.innerHeight });
    node.style.left = `${String(spot.left)}px`;
    node.style.top = `${String(spot.top)}px`;
  };
  place();

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeCommentPopover();
  };
  const onDown = (event: MouseEvent): void => {
    const target = event.target as globalThis.Node | null;
    if (target && (node.contains(target) || anchor.contains(target))) return;
    closeCommentPopover();
  };
  const onScroll = (event: Event): void => {
    if (event.target instanceof globalThis.Node && node.contains(event.target)) return;
    closeCommentPopover();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', closeCommentPopover);
  anchor.setAttribute('aria-expanded', 'true');
  current = {
    anchor,
    dispose: () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeCommentPopover);
      anchor.setAttribute('aria-expanded', 'false');
      node.remove();
    },
  };
}
