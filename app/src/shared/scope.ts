/**
 * **What a question is about: this segment, or this deck.**
 *
 * `docs/research/whole-file-context.md` §3: every question in the flow is anchored to a segment,
 * so a deck-level question — *"summarise what I will be learning"*, *"how does p. 40 relate to
 * p. 12"* — has **nowhere to go**. The learner asks it under whatever card happens to be nearest
 * and the REFERENCE path answers from that page's text, which is why build 102 on the 58-page
 * CS4246 deck "does not have context from whole file": the system did not know the question's
 * scope, so it used the only one it had.
 *
 * Portable and dependency-free, like everything else in `src/shared`, because both halves need
 * it: the main process guesses the scope and builds the context, and the renderer shows the
 * guess and lets the learner override it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE RENDERER CONTRACT (issue #35 item 3; main-side landed first, on purpose)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Three surfaces, all optional to *use* and all already carried on the wire:
 *
 * 1. **"Ask about this deck"** — a line at the top of the flow, above the first card. It calls
 *    `api.flowAskDeck({ fileId, question })` (IPC `flow:askDeck`) and returns the same
 *    `FlowAnswerView` as "+ Ask here". Its answer is anchored to the synthetic anchor
 *    `DECK_ANCHOR_ID`, and `FlowRoomView.threads` **always puts that thread first**, so a deck
 *    thread renders above the flow rather than under a slide.
 *
 * 2. **A scope chip on any Ask composer**. `api.flowAskHere` now takes an optional
 *    `scope: AskScope`. Omit it and the main process guesses with `guessScope()` below — the
 *    same function the chip should call to show the guess before the learner presses send, so
 *    the chip and the answer can never disagree. Passing it explicitly is the override, and the
 *    log records `overridden: true` when it differs from the guess.
 *
 * 3. **A scope line in the card footer**. Every `MessageView` now carries
 *    `scopeShown: string | null` — a ready-to-render phrase, one of `'p. 14'`,
 *    `'p. 14 + outline'`, `'whole deck'` or `'outline + pp. 3, 14, 40'`. It is *not* a code the
 *    renderer has to map: it is the sentence, already formatted, so the footer that today shows
 *    `14:22 · 9.4s · haiku-4-5 · claude-cli` becomes `14:22 · 9.4s · whole deck · claude-cli`.
 *    `null` on every message that is not a REFERENCE answer, and on every one written before
 *    migration 015.
 */

/** The two scopes that ship. The third — *the topic*, a promoted folder — is A2. */
export type AskScope = 'segment' | 'deck';

/**
 * The anchor a deck-level question hangs off.
 *
 * A synthetic id rather than `null`: a null anchor already means "the room-level stream" in
 * `messages.anchor_id`, the REFERENCE lock is per anchor and `isAnchorLocked(null)` is false by
 * construction (`reference.ts`), so a deck question with a null anchor could not be locked and
 * its thread could not be found. `'deck'` cannot collide with a segment id — those are minted
 * `seg_…` by `newId()`.
 */
export const DECK_ANCHOR_ID = 'deck';

export function isDeckAnchor(anchorId: string | null): boolean {
  return anchorId === DECK_ANCHOR_ID;
}

/**
 * The deck-level verbs. `whole-file-context.md` §4 recommendation 3 calls for "a cheap
 * classifier — deck-level verbs ('summarise', 'overview', 'what will I learn', 'outline',
 * 'across') or no anchor".
 *
 * Deliberately a word list and not a model. It runs before every question, it has to be
 * instant, and it is **advisory**: it sets the chip, the learner can change it, and the log
 * records both. A classifier that is wrong 10 % of the time in front of an override is a
 * better product than a 20-second call that is wrong 3 % of the time behind a wait.
 */
const DECK_PATTERNS: RegExp[] = [
  /\bsummar(y|ise|ize|ising|izing)\b/i,
  /\boverview\b/i,
  /\boutline\b/i,
  /\bagenda\b/i,
  /\btable of contents\b/i,
  /\bwhat (will|am i going to|do i) (i )?learn/i,
  /\bwhat('s| is) (this|the) (deck|lecture|document|file|slides?) about\b/i,
  /\bwhat does (this|the) (deck|lecture|document|file) cover\b/i,
  /\bacross (the )?(deck|lecture|document|file|slides|chapter)\b/i,
  /\b(whole|entire|full|rest of the) (deck|lecture|document|file|slides|thing)\b/i,
  /\b(main|key|big) (topics?|ideas?|points?|takeaways?|themes?)\b/i,
  /\bhow (do|does) .{0,40}\brelate to\b/i,
  /\b(later|earlier) (slides?|pages?|sections?)\b/i,
  /\bp+\.? ?\d+\b.{0,30}\bp+\.? ?\d+\b/i,
  /\bwhat (comes|do we do) (next|after (this|that))\b/i,
];

export interface ScopeGuess {
  scope: AskScope;
  /** Why, for the log and for the chip's tooltip. Never shown as an error. */
  reason: 'no_anchor' | 'deck_verb' | 'default_segment';
  /** The pattern that fired, when one did. Logged; not rendered. */
  matched: string | null;
}

/**
 * **The rule.** Deck-level verbs, or no anchor at all, mean the whole deck; anything else means
 * the segment the learner asked on.
 *
 * The default is `segment` and that is the important half: the flow's whole premise is that a
 * question has a place, and answering a question about *this slide* from the whole deck would
 * make every answer vaguer to fix the one case in ten that needs the deck.
 */
export function guessScope(input: { question: string; anchorId: string | null }): ScopeGuess {
  if (input.anchorId === null || isDeckAnchor(input.anchorId)) {
    return { scope: 'deck', reason: 'no_anchor', matched: null };
  }
  for (const pattern of DECK_PATTERNS) {
    if (pattern.test(input.question)) return { scope: 'deck', reason: 'deck_verb', matched: pattern.source };
  }
  return { scope: 'segment', reason: 'default_segment', matched: null };
}

/**
 * The footer phrase — **the sentence, not a code**. The renderer prints it verbatim.
 *
 * `'p. 14'` when a page answer had nothing else; `'p. 14 + outline'` when it also carried the
 * deck's headings (so the answer can say where the page sits); `'whole deck'` when the whole
 * text went in; `'outline + pp. 3, 14, 40'` when the document was too large for that and the
 * retrieval fallback picked pages.
 */
export function scopeShownFor(input: {
  scope: AskScope;
  /** The page a segment question was on; null when it had none. */
  page?: number | null;
  /** True when the outline travelled alongside. */
  outline?: boolean;
  /** Set only on the retrieval fallback: the pages that were actually attached. */
  retrievedPages?: number[];
}): string {
  if (input.scope === 'deck') {
    const pages = (input.retrievedPages ?? []).filter((p) => Number.isFinite(p));
    if (pages.length > 0) return `outline + pp. ${pages.join(', ')}`;
    return 'whole deck';
  }
  const page = input.page ?? null;
  const where = page === null ? 'this part' : `p. ${page}`;
  return input.outline ? `${where} + outline` : where;
}
