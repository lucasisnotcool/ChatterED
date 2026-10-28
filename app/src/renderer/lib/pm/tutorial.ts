/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A TUTORIAL SHEET IN THE EDITOR, AND ITS PARTS UNDER THE NOTES (`tutorials.md` §3, §4, §7)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The tutorial document is an ordinary notes document (`shared/doc/tutorialdoc.ts`); this file is
 * what makes it read as a problem sheet with answers in it, in the same editor:
 *
 *  - **Each part is a card** with one quiet header row: its label, its status in a word (untried ·
 *    working · ✓ correct · ½ partial · ✗ not yet · revealed, with who decided it on hover), three
 *    dots once a hint rung is taken, and on the right **Check** and one **Help ▾** menu: Hint
 *    (naming the rung it gives next), Refresher, and set apart, Show answer… (confirmed inline: it
 *    does not count). A wide card shows Hint and Refresher inline as well. Under the row, one line
 *    of *From the notes:* links to the notes sections and the lecture pages the part draws on.
 *  - **The sheet's words wear sheet ink** (a printed face), the learner's answer slot a rail and a
 *    tint in the learner's colour, with a placeholder shaped to the answer while it is empty.
 *  - **The sheet's housekeeping is folded** under one "Course admin" toggle.
 *  - **Max's (or Ellie's) one line under a part** after help is drawn as an agent's note.
 *  - In the **main notes**, each section ends with a row of the tutorial parts that practise it
 *    (`practiceChipsPlugin`), just above the section's slide strip.
 *
 * All of it is decorations, as the rest of the chrome is (`chrome.ts`): nothing here is in the
 * document, so none of it is saved, typed into, sent to a model or undone. The two controls that
 * *are* the learner's answer, the blanks and the tick boxes, are node views (`tutorialviews.ts`).
 *
 * The tutorial document is small (a sheet is tens of blocks, not hundreds), so its chrome is
 * rebuilt on every change rather than mapped: that is what lets *working* follow the first
 * keystroke. Every widget is keyed by what it shows, so a rebuild that changes nothing keeps its
 * DOM (the slide strip's pattern), and an open "Show the answer?" survives a keystroke elsewhere.
 */

import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { AttrStep, ReplaceAroundStep } from 'prosemirror-transform';
import { Decoration, DecorationSet, type EditorView, type NodeViewConstructor } from 'prosemirror-view';
import { partAnswerOf, SHEET_REASON } from '../../../shared/doc/tutorialdoc.js';
import type { TutorialAnswerKind, TutorialPartView, TutorialView } from '../../../shared/tutorial.js';
import {
  adminRanges,
  blankFromCaret,
  blankSpots,
  firstTextblock,
  fromNotesTitle,
  helpMenuItems,
  hintDotsTitle,
  notesChips,
  pageGroups,
  pageLinkLabel,
  partChromeState,
  practiceBySection,
  sheetSourceLabels,
  slotIsEmpty,
  slotPlaceholder,
  statusLook,
  TUTOR_HINT_REASON,
  type PartChromeState,
  type PracticeSection,
} from './tutorialmodel.js';
import { focusBlankAt, tutorialNodeViews as nodeViewsOfTutorial } from './tutorialviews.js';
// Carried by the module that draws with it, as `nodeviews.ts` carries `blocks.css`.
import './tutorial.css';

export { TUTOR_HINT_REASON } from './tutorialmodel.js';
export { TUTORIAL_INPUT } from './tutorialviews.js';

// ── the contract (S7) ───────────────────────────────────────────────────────────────────────

export interface TutorialChromeContext {
  part(partId: string): TutorialPartView | null;
  onHelp(partId: string, kind: 'hint' | 'refresher' | 'reveal'): void;
  onCheck(partId: string): void;
  onOpenNotesBlock(blockId: string): void;
  onOpenSlide(page: number, rect: DOMRect, anchor: HTMLElement): void;
  citation(pages: readonly number[]): string;
  notesHeading(blockId: string): string | null;
}

export interface PracticeChipsContext {
  tutorials(): TutorialView[];
  onOpenPart(fileId: string, partId: string): void;
}

export function tutorialNodeViews(): Record<string, NodeViewConstructor> {
  return nodeViewsOfTutorial();
}

interface TutorialChromeState {
  deco: DecorationSet;
  /** Whether the course-admin blocks are shown. Folded by default. */
  adminOpen: boolean;
}

interface TutorialMeta {
  bump?: boolean;
  toggleAdmin?: boolean;
}

export const tutorialChromeKey = new PluginKey<TutorialChromeState>('chattered:tutorial');
export const practiceKey = new PluginKey<DecorationSet>('chattered:practice');
const viewsKey = new PluginKey('chattered:tutorial-views');

/**
 * Redraw the part chrome and the practice chips without touching the document: a part's record
 * or the tutorial list changed. One bump serves both editors (each plugin reads its own meta).
 */
export function bumpTutorialChrome(tr: Transaction): Transaction {
  return tr.setMeta(tutorialChromeKey, { bump: true } satisfies TutorialMeta).setMeta(practiceKey, true);
}

// ── DOM helpers ─────────────────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A chrome button: it never takes the selection, and PM never sees its press. */
function button(className: string, text: string, title: string, onClick: (self: HTMLButtonElement) => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.title = title;
  node.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!node.disabled) onClick(node);
  });
  return node;
}

/** Disabled with a shimmer until the store's answer redraws the header (or a few seconds pass). */
function markBusy(control: HTMLButtonElement): void {
  control.disabled = true;
  control.classList.add('nd-tut-busy');
  setTimeout(() => {
    if (!control.isConnected) return;
    control.disabled = false;
    control.classList.remove('nd-tut-busy');
  }, 4000);
}

function widget(pos: number, key: string, side: number, build: (view: EditorView) => HTMLElement): Decoration {
  return Decoration.widget(
    pos,
    (view) => {
      const dom = build(view);
      dom.contentEditable = 'false';
      return dom;
    },
    {
      key,
      side,
      ignoreSelection: true,
      stopEvent: () => true,
      destroy: (node) => {
        cleanups.get(node as HTMLElement)?.();
      },
    },
  );
}

// ── a part's header ─────────────────────────────────────────────────────────────────────────
//
// One quiet row (Lucas, 4 Oct 2026: "too many buttons when not popped"): the label, the status as
// a word (quiet while untried), the hint dots once a hint is used, and on the right **Check** and
// one **Help ▾** menu (Hint · its rung, Refresher, and set apart, Show answer…). A part card wider
// than ~640 px (the popped-out window, a wide column) shows Hint and Refresher inline again: a
// container query in `tutorial.css`, so nothing here measures. Under the row, *From the notes:* as
// one line of plain links, cut with an ellipsis, the full list in its tooltip.

interface HeaderInput {
  partId: string;
  label: string;
  chrome: PartChromeState;
  verifiedSolution: boolean;
  solutionNeedsReview: boolean;
  notes: { blockId: string; label: string }[];
  /** Each page run, its link's short words and its full citation (the tooltip). */
  pages: { pages: number[]; label: string; full: string }[];
}

/** Cleanups for header DOM that holds a document listener (the open menu), run on destroy. */
const cleanups = new WeakMap<HTMLElement, () => void>();

/**
 * A menu open when its header was rebuilt (a record arrived while it was open) reopens in the new
 * header, as long as that is drawn straight after (the same part, within half a second).
 */
let reopen: { partId: string; at: number } | null = null;

let menuSeq = 0;

function agentDot(who: 'max' | 'ellie'): HTMLElement {
  const dot = el('span', `nd-tool-dot nd-tool-dot-${who}`);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/** A small lightbulb, in the button's colour. */
function bulbIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'nd-tut-help-icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M6 12.6h4M6.6 14.6h2.8M8 1.6a4.4 4.4 0 0 0-2.5 8c.4.3.6.8.6 1.3v.3h3.8v-.3c0-.5.2-1 .6-1.3A4.4 4.4 0 0 0 8 1.6z');
  svg.append(path);
  return svg;
}

function rungDots(chrome: PartChromeState, className = 'nd-tut-dots'): HTMLElement {
  const dots = el('span', className);
  dots.title = hintDotsTitle(chrome.hintLevel);
  dots.setAttribute('aria-label', dots.title);
  for (const on of chrome.dots) dots.append(el('span', `nd-tut-dot${on ? ' nd-on' : ''}`));
  return dots;
}

/** A plain-text link on the *From the notes* line: never takes the selection, Enter opens it. */
function textLink(text: string, title: string, onOpen: (self: HTMLAnchorElement) => void): HTMLAnchorElement {
  const link = el('a', 'nd-tut-link', text);
  link.href = '#';
  link.title = title;
  link.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen(link);
  });
  return link;
}

function partHeader(input: HeaderInput, context: () => TutorialChromeContext): HTMLElement {
  const { partId, chrome } = input;
  const head = el('div', 'nd-tut-head');
  head.setAttribute('role', 'group');
  head.setAttribute('aria-label', `${input.label}: ${chrome.look.label}`);

  // ── left: label · status · dots ──
  const row = el('div', 'nd-tut-head-row');
  const left = el('div', 'nd-tut-head-left');
  left.append(el('span', 'nd-tut-label', input.label));
  const status = el('span', 'nd-tut-status', chrome.look.label);
  status.dataset.status = chrome.status;
  status.title = chrome.look.title;
  left.append(status);
  if (input.verifiedSolution) {
    const source = el('span', 'nd-tut-source-key', 'Answer PDF verified');
    source.title = 'This question’s answer was checked against the uploaded tutorial answers.';
    left.append(source);
  } else if (input.solutionNeedsReview) {
    const source = el('span', 'nd-tut-source-review', 'Using worked answer');
    source.title = 'The uploaded answer could not be matched to this question, so Max checks against the worked answer generated for it.';
    left.append(source);
  }
  if (chrome.hintLevel > 0) left.append(rungDots(chrome));

  // ── right: [Hint] [Refresher] (wide only) · Check · Help ▾, or the reveal's confirm ──
  const actions = el('div', 'nd-tut-actions');
  const controls = el('span', 'nd-tut-controls');

  const hint = button('nd-tut-btn nd-tut-wide nd-tut-hint-btn', '', chrome.hintTitle, (self) => {
    markBusy(self);
    context().onHelp(partId, 'hint');
  });
  hint.append(agentDot('max'), document.createTextNode(chrome.nextHint === null ? 'No more hints' : 'Hint'));
  if (chrome.nextHint !== null) hint.append(el('span', 'nd-tut-rung', chrome.nextHint));
  hint.disabled = chrome.nextHint === null;
  hint.setAttribute('aria-label', chrome.nextHint === null ? 'No more hints' : `Hint: ${chrome.nextHint} (Max)`);

  const refresher = button('nd-tut-btn nd-tut-wide', '', 'Ellie goes over what this part needs, from the lecture notes and slides', (self) => {
    markBusy(self);
    context().onHelp(partId, 'refresher');
  });
  refresher.append(agentDot('ellie'), document.createTextNode('Refresher'));
  refresher.setAttribute('aria-label', 'Refresher (Ellie)');

  const check = button('nd-tut-btn nd-tut-check', 'Check', chrome.checkTitle, (self) => {
    markBusy(self);
    context().onCheck(partId);
  });
  check.disabled = !chrome.canCheck;

  // The confirm, where the controls were: "Show the answer? It won't count. [Show it] [Keep trying]".
  const confirm = el('span', 'nd-tut-confirm');
  confirm.hidden = true;
  confirm.setAttribute('role', 'alertdialog');
  confirm.setAttribute('aria-label', 'Show the answer?');
  const yes = button('nd-tut-btn nd-tut-reveal-yes', 'Show it', 'Show the answer; this part will not count', (self) => {
    markBusy(self);
    context().onHelp(partId, 'reveal');
  });
  const no = button('nd-tut-btn nd-tut-reveal-no', 'Keep trying', 'Close this and keep working on it', () => {
    confirm.hidden = true;
    controls.hidden = false;
    helpButton.focus({ preventScroll: true });
  });
  confirm.append(el('span', 'nd-tut-confirm-q', 'Show the answer? It won’t count.'), yes, no);
  confirm.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      no.click();
    }
  });
  const askReveal = (): void => {
    controls.hidden = true;
    confirm.hidden = false;
    yes.focus({ preventScroll: true });
  };

  // ── the Help menu ──
  const wrap = el('span', 'nd-tut-help-wrap');
  const menuId = `nd-tut-menu-${String(++menuSeq)}`;
  const helpButton = button('nd-tut-btn nd-tut-help', '', 'Hints, a refresher, or the answer', () => {
    if (menu.hidden) openMenu();
    else closeMenu(true);
  });
  helpButton.setAttribute('aria-haspopup', 'menu');
  helpButton.setAttribute('aria-expanded', 'false');
  helpButton.setAttribute('aria-controls', menuId);
  helpButton.setAttribute('aria-label', 'Help');
  const bulb = bulbIcon();
  helpButton.append(bulb, el('span', 'nd-tut-help-word', 'Help'), el('span', 'nd-tut-help-more', 'More'), el('span', 'nd-tut-caret', '▾'));
  helpButton.querySelector('.nd-tut-help-more')!.setAttribute('aria-hidden', 'true');

  const menu = el('div', 'nd-tut-menu');
  menu.id = menuId;
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `Help with ${input.label}`);
  for (const item of helpMenuItems(chrome)) {
    if (item.apart) {
      const sep = el('div', 'nd-tut-menu-sep');
      sep.setAttribute('role', 'separator');
      menu.append(sep);
    }
    const entry = el('button', `nd-tut-menu-item nd-tut-menu-${item.id}`);
    entry.type = 'button';
    entry.tabIndex = -1;
    entry.dataset.item = item.id;
    entry.setAttribute('role', 'menuitem');
    entry.disabled = item.disabled;
    if (item.disabled) entry.setAttribute('aria-disabled', 'true');
    const mark = item.who ? agentDot(item.who) : el('span', 'nd-tut-menu-mark');
    const words = el('span', 'nd-tut-menu-words');
    const top = el('span', 'nd-tut-menu-label', item.label);
    if (item.rung) top.append(el('span', 'nd-tut-rung', item.rung));
    words.append(top, el('span', 'nd-tut-menu-detail', item.detail));
    entry.append(mark, words);
    if (item.id === 'hint') entry.append(rungDots(chrome, 'nd-tut-dots nd-tut-menu-dots'));
    entry.setAttribute('aria-label', item.rung ? `${item.label}: ${item.rung}. ${item.detail}` : `${item.label}. ${item.detail}`);
    entry.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    entry.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (entry.disabled) return;
      if (item.id === 'reveal') {
        closeMenu(false);
        askReveal();
        return;
      }
      closeMenu(true);
      markBusy(helpButton);
      context().onHelp(partId, item.id);
    });
    menu.append(entry);
  }

  /** The items a key can reach: shown (the wide card hides the inline ones) and enabled. */
  const reachable = (): HTMLButtonElement[] =>
    [...menu.querySelectorAll<HTMLButtonElement>('.nd-tut-menu-item')].filter((b) => !b.disabled && b.getClientRects().length > 0);
  const focusAt = (index: number): void => {
    const items = reachable();
    if (items.length === 0) return;
    items[(index + items.length) % items.length]!.focus({ preventScroll: true });
  };

  let outside: ((event: Event) => void) | null = null;
  const unlisten = (): void => {
    if (outside) document.removeEventListener('pointerdown', outside, true);
    outside = null;
  };
  function openMenu(at: 'first' | 'last' = 'first'): void {
    if (helpButton.disabled) return;
    menu.hidden = false;
    menu.classList.remove('nd-up');
    helpButton.setAttribute('aria-expanded', 'true');
    head.classList.add('nd-tut-menu-on');
    // Up, when the menu would run past the bottom of the pane that scrolls it and there is room above.
    const box = menu.getBoundingClientRect();
    const scroller = head.closest('.nd-scroll') ?? document.documentElement;
    const bound = scroller.getBoundingClientRect();
    const bottom = Math.min(bound.bottom, window.innerHeight);
    if (box.bottom > bottom - 6 && box.top - box.height - helpButton.offsetHeight - 8 > Math.max(bound.top, 0)) menu.classList.add('nd-up');
    focusAt(at === 'first' ? 0 : -1);
    unlisten();
    outside = (event: Event): void => {
      if (!wrap.isConnected) return unlisten();
      if (!wrap.contains(event.target as globalThis.Node)) closeMenu(false);
    };
    document.addEventListener('pointerdown', outside, true);
    reopen = null;
  }
  function closeMenu(returnFocus: boolean): void {
    unlisten();
    if (menu.hidden) return;
    menu.hidden = true;
    helpButton.setAttribute('aria-expanded', 'false');
    head.classList.remove('nd-tut-menu-on');
    if (returnFocus) helpButton.focus({ preventScroll: true });
  }

  helpButton.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
    } else if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      closeMenu(true);
    }
  });
  menu.addEventListener('keydown', (event) => {
    const items = reachable();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        focusAt(at + 1);
        break;
      case 'ArrowUp':
        focusAt(at < 0 ? -1 : at - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Escape':
      case 'Tab':
        closeMenu(true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  cleanups.set(head, () => {
    if (!menu.hidden) reopen = { partId, at: Date.now() };
    unlisten();
  });
  if (reopen?.partId === partId && Date.now() - reopen.at < 500) {
    reopen = null;
    requestAnimationFrame(() => {
      if (head.isConnected) openMenu();
    });
  }

  wrap.append(helpButton, menu);
  const reveal = helpMenuItems(chrome).some((item) => item.id === 'reveal')
    ? button('nd-tut-btn nd-tut-reveal-direct', 'Show answer', 'Show the answer; this part will not count', askReveal)
    : null;
  controls.append(check, hint, refresher);
  if (reveal) controls.append(reveal);
  controls.append(wrap);
  actions.append(controls, confirm);
  row.append(left, actions);
  head.append(row);

  // ── From the notes: Classical planning in PDDL · p. 3–5 ──
  if (input.notes.length > 0 || input.pages.length > 0) {
    const from = el('div', 'nd-tut-from');
    from.title = fromNotesTitle(input.notes, input.pages.map((p) => p.full));
    from.append(el('span', 'nd-tut-from-name', 'From the notes:'), document.createTextNode(' '));
    const links: HTMLElement[] = [
      ...input.notes.map((chip) => textLink(chip.label, `Open “${chip.label}” in the notes`, () => context().onOpenNotesBlock(chip.blockId))),
      ...input.pages.map((group) =>
        textLink(group.label, `Open ${group.full} beside the sheet`, (self) => context().onOpenSlide(group.pages[0]!, self.getBoundingClientRect(), self)),
      ),
    ];
    links.forEach((link, index) => {
      if (index > 0) from.append(el('span', 'nd-tut-sep', ' · '));
      from.append(link);
    });
    head.append(from);
  }
  return head;
}

// ── the chrome of the tutorial document ─────────────────────────────────────────────────────

/** The author of an agent's line, from its text's author marks. */
function hintAuthor(node: Node): 'max' | 'ellie' {
  let who: 'max' | 'ellie' | null = null;
  node.descendants((child) => {
    if (who) return false;
    const mark = child.marks.find((m) => m.type.name === 'author' && (m.attrs.by === 'max' || m.attrs.by === 'ellie'));
    if (mark) who = mark.attrs.by as 'max' | 'ellie';
    return true;
  });
  return who ?? 'max';
}

function partDecorations(
  part: Node,
  pos: number,
  ctx: TutorialChromeContext,
  out: Decoration[],
  context: () => TutorialChromeContext,
  sources: ReadonlyMap<string, string> | null,
): void {
  const partId = part.attrs.partId as string;
  const label = (part.attrs.label as string) || partId;
  const answer = partAnswerOf(part);
  const view = ctx.part(partId);
  const chrome = partChromeState(view, answer.empty);
  out.push(Decoration.node(pos, pos + part.nodeSize, { class: 'nd-tut-part', 'data-status': chrome.status }));

  const notes = view ? notesChips(view.links.notesBlockIds, (id) => ctx.notesHeading(id)) : [];
  const pages = view
    ? pageGroups(view.links.pages)
        .slice(0, 4)
        .map((group) => {
          const full = ctx.citation(group);
          return { pages: group, label: pageLinkLabel(full, sources) || full, full };
        })
    : [];
  const key = [
    'tuthead',
    partId,
    label,
    chrome.status,
    String(chrome.hintLevel),
    view?.checkedBy ?? '-',
    String(view?.verifiedSolution ?? false),
    String(view?.solutionNeedsReview ?? false),
    String(view?.attempts ?? 0),
    notes.map((n) => `${n.blockId}=${n.label}`).join(','),
    pages.map((p) => `${p.label}=${p.full}`).join(','),
  ].join('|');
  out.push(widget(pos + 1, key, -1, () => partHeader({ partId, label, chrome,
    verifiedSolution: view?.verifiedSolution ?? false, solutionNeedsReview: view?.solutionNeedsReview ?? false, notes, pages }, context)));

  part.forEach((child, offset) => {
    if (child.type.name !== 'tut_answer') return;
    const at = pos + 1 + offset;
    const kind = (child.attrs.answerKind as TutorialAnswerKind) || answer.kind;
    out.push(Decoration.node(at, at + child.nodeSize, { class: 'nd-tut-slot', 'data-kind': kind }));
    if (!slotIsEmpty(child)) return;
    const first = firstTextblock(child);
    if (!first) return;
    const from = at + 1 + first.offset;
    out.push(
      Decoration.node(from, from + first.node.nodeSize, {
        class: 'nd-tut-ph',
        'data-placeholder': slotPlaceholder(kind, answer.prompt),
      }),
    );
  });
}

function adminToggle(open: boolean, count: number): HTMLElement {
  const holder = el('div', 'nd-tut-admin-bar');
  const toggle = el('button', 'nd-tut-admin-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.append(
    el('span', 'nd-strip-caret', open ? '▾' : '▸'),
    el('span', 'nd-tut-admin-name', 'Course admin'),
    el('span', 'nd-tut-admin-act', open ? '· hide' : `· show${count > 1 ? ` (${String(count)})` : ''}`),
  );
  toggle.title = open ? 'Fold the sheet’s housekeeping away' : 'The sheet’s housekeeping: sign-up, submission, deadlines';
  holder.append(toggle);
  return holder;
}

/**
 * The short names of the lecture sources the sheet's page links cite, or null when they cite one:
 * then a part's links read `p. 3–5`, since the name says nothing the slide window does not.
 */
function sheetSources(doc: Node, ctx: TutorialChromeContext): Map<string, string> | null {
  const pages: number[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'tut_part') {
      pages.push(...(ctx.part(node.attrs.partId as string)?.links.pages ?? []));
      return false;
    }
    return node.isBlock && !node.isTextblock;
  });
  const clean = pageGroups(pages).flat();
  return clean.length === 0 ? null : sheetSourceLabels(ctx.citation(clean));
}

function buildChrome(state: EditorState, ctx: TutorialChromeContext, adminOpen: boolean, context: () => TutorialChromeContext): DecorationSet {
  const doc = state.doc;
  const out: Decoration[] = [];
  const sources = sheetSources(doc, ctx);

  const admin = adminRanges(doc);
  if (admin.length > 0) {
    out.push(
      widget(admin[0]!.from, `tutadmin:${adminOpen ? 'o' : 'c'}:${String(admin.length)}`, -1, (view) => {
        const bar = adminToggle(adminOpen, admin.length);
        const toggle = bar.querySelector('button')!;
        toggle.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        toggle.addEventListener('click', (event) => {
          event.preventDefault();
          view.dispatch(view.state.tr.setMeta(tutorialChromeKey, { toggleAdmin: true } satisfies TutorialMeta));
        });
        return bar;
      }),
    );
    for (const range of admin) {
      out.push(Decoration.node(range.from, range.to, { class: adminOpen ? 'nd-tut-admin' : 'nd-tut-admin nd-tut-folded' }));
    }
  }

  doc.descendants((node, pos) => {
    if (!node.isBlock) return false;
    if (node.type.name === 'tut_part') {
      partDecorations(node, pos, ctx, out, context, sources);
      return true;
    }
    if (node.type.name === 'tut_answer' || node.type.name === 'tut_choices') return false;
    const reason = typeof node.attrs.reason === 'string' ? (node.attrs.reason as string) : null;
    if (reason === SHEET_REASON) {
      out.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nd-tut-sheet' }));
    } else if (reason === TUTOR_HINT_REASON) {
      const who = hintAuthor(node);
      out.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `nd-tut-hint nd-${who}`,
          'data-who': who === 'max' ? 'Max' : 'Ellie',
        }),
      );
    }
    // Lists and other non-textblocks: their items have no reason of their own worth a look.
    return false;
  });

  return DecorationSet.create(doc, out);
}

/** The part's `tut_part` around the caret, when it takes blanks. */
function blanksPartAt(state: EditorState): string | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'tut_part') return node.attrs.answerKind === 'blanks' ? (node.attrs.partId as string) : null;
  }
  return null;
}

/**
 * The tutorial document's plugins: its node views, its chrome, and the keys that reach the blanks
 * from the text (→ into a blank just after the caret, ← into one just before, Tab and Shift+Tab
 * through a blanks part's fields). Put them ahead of the base keymaps (`setup.ts` does).
 */
export function tutorialPlugins(context: () => TutorialChromeContext): Plugin[] {
  const chrome = new Plugin<TutorialChromeState>({
    key: tutorialChromeKey,
    state: {
      init: (_config, state) => ({ adminOpen: false, deco: buildChrome(state, context(), false, context) }),
      apply(tr, value, _old, next) {
        const meta = tr.getMeta(tutorialChromeKey) as TutorialMeta | undefined;
        const adminOpen = meta?.toggleAdmin ? !value.adminOpen : value.adminOpen;
        if (meta || tr.docChanged) return { adminOpen, deco: buildChrome(next, context(), adminOpen, context) };
        return value;
      },
    },
    props: {
      decorations: (state) => tutorialChromeKey.getState(state)?.deco,
      handleKeyDown(view, event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return false;
        const { selection } = view.state;
        if (event.key === 'ArrowRight' && !event.shiftKey && selection.empty) {
          const after = selection.$from.nodeAfter;
          if (after?.type.name === 'tut_blank') return focusBlankAt(view, selection.from, 'start');
        }
        if (event.key === 'ArrowLeft' && !event.shiftKey && selection.empty) {
          const before = selection.$from.nodeBefore;
          if (before?.type.name === 'tut_blank') return focusBlankAt(view, selection.from - before.nodeSize, 'end');
        }
        if (event.key === 'Tab') {
          const partId = blanksPartAt(view.state);
          if (!partId) return false;
          const target = blankFromCaret(blankSpots(view.state.doc), partId, selection.from, event.shiftKey ? -1 : 1);
          if (!target) return false;
          event.preventDefault();
          return focusBlankAt(view, target.pos, 'all');
        }
        return false;
      },
    },
  });

  return [tutorialNodeViewsPlugin(), chrome];
}

/**
 * The node views alone, as a plugin: an editor built without the tutorial chrome still draws a
 * tutorial document's blanks and tick boxes as controls (`setup.ts` adds it when no `tutorial`
 * context is given).
 */
export function tutorialNodeViewsPlugin(): Plugin {
  return new Plugin({ key: viewsKey, props: { nodeViews: tutorialNodeViews() } });
}

// ── the main notes: each section's practice ─────────────────────────────────────────────────

function practiceRow(section: PracticeSection, context: () => PracticeChipsContext): HTMLElement {
  const row = el('div', 'nd-practice');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Practise this section');
  row.append(el('span', 'nd-practice-name', 'Practise'));
  for (const group of section.groups) {
    const block = el('span', 'nd-practice-group');
    block.append(el('span', 'nd-practice-tut', `${group.title}:`));
    group.parts.forEach((part, index) => {
      if (index > 0) block.append(el('span', 'nd-practice-sep', '·'));
      const look = statusLook(part.status);
      const chip = button('nd-practice-part', '', `${part.label}: ${look.label}. Open it in the tutorial.`, () =>
        context().onOpenPart(part.fileId, part.partId),
      );
      chip.dataset.status = part.status;
      chip.append(document.createTextNode(part.partId));
      if (look.glyph) chip.append(el('span', 'nd-practice-glyph', look.glyph));
      chip.setAttribute('aria-label', `${part.label}, ${look.label}`);
      block.append(chip);
    });
    row.append(block);
  }
  return row;
}

function buildPractice(state: EditorState, ctx: PracticeChipsContext, context: () => PracticeChipsContext): DecorationSet {
  const sections = practiceBySection(state.doc, ctx.tutorials());
  return DecorationSet.create(
    state.doc,
    sections.map((section) => {
      const signature = section.groups
        .map((g) => `${g.fileId}=${g.title}:${g.parts.map((p) => `${p.partId}/${p.status}/${p.label}`).join(',')}`)
        .join(';');
      // Side -2: before the section's slide strip (-1) at the same position (`slidestrip.ts`).
      return widget(section.pos, `practice:${section.headingBlockId}:${signature}`, -2, () => practiceRow(section, context));
    }),
  );
}

/**
 * **"Practise · Tutorial 1: P1a ✓ · P1b · P3A.i"** at the end of each section of the main notes
 * whose blocks a tutorial part links to (`tutorials.md` §7: two-way links). A click opens the part
 * in the tutorial. Rebuilt on `bumpTutorialChrome` and on structural changes; a keystroke maps it.
 */
export function practiceChipsPlugin(context: () => PracticeChipsContext): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: practiceKey,
    state: {
      init: (_config, state) => buildPractice(state, context(), context),
      apply(tr, value, old, next) {
        const structural = tr.docChanged && tr.doc.childCount !== old.doc.childCount;
        const remarked = tr.steps.some((step) => step instanceof ReplaceAroundStep || step instanceof AttrStep);
        if (tr.getMeta(practiceKey) || structural || remarked) return buildPractice(next, context(), context);
        return tr.docChanged ? value.map(tr.mapping, tr.doc) : value;
      },
    },
    props: {
      decorations: (state) => practiceKey.getState(state),
    },
  });
}
