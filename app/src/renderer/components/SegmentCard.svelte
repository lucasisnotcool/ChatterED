<script lang="ts">
  /**
   * One crop card (`pdf-fidelity-segmentation.md` §C3, `flow-build-plan.md` §4.1).
   *
   * **A crop segment looks like the slide, because it is the slide.** The card draws its
   * rectangle straight off the page canvas the flow rasterised — one `drawImage` with a source
   * rectangle, no re-typesetting, no conversion, the lecturer's own pixels. Everything this
   * component adds lives *outside* those pixels:
   *
   *   - a thin label strip above (the concept name, editable → `segments:rename`) with the page
   *     chip and the build-steps chip on the right;
   *   - a drag handle in the left gutter (→ `segments:reorder`) and the ticks in the right one;
   *   - the faint "+ Ask here" line below.
   *
   * The **one** thing ever drawn over slide pixels is the active split guide, and it is drawn
   * only while a tick is hovered or focused (`segmentation-lazy-split.md` §4). That is a rule,
   * not a preference: the moment the app paints on the deck, the claim that nothing was
   * converted stops being visible.
   *
   * Every number comes from `lib/flowview.ts`, which has the tests.
   */
  import {
    CONTENT_WIDTH,
    DEFAULT_ZOOM,
    PLACEHOLDER,
    backingRatio,
    buildChipLabel,
    cardSize,
    compareCaption,
    drawPlan,
    normFromOffset,
    offsetFromNorm,
    pageChipLabel,
    snapPreview,
    tickPositions,
    type FlowCard,
    type PagePt,
  } from '../lib/flowview.js';
  import type { AnchorClaim } from '../../shared/flowthread.js';
  import { LEDGER_GLYPH, LEDGER_WORD } from '../lib/labels.js';
  import { glyphFor, wordFor, type SegmentObjective } from '../lib/objectives.js';
  import AskHereLine from './AskHereLine.svelte';
  import type { AskScope } from '../../shared/scope.js';

  let {
    card,
    page,
    canvas = null,
    /** Bumped by the flow when this page has been (re-)rasterised into the same element. */
    rev = 0,
    background = PLACEHOLDER,
    contentWidth = CONTENT_WIDTH,
    /**
     * The flow's **committed** zoom (`FlowCanvas`). The card is still laid out in unzoomed CSS
     * pixels — the flow scales it with one CSS `zoom` on a wrapper — so the only thing this
     * changes is the crop's backing store: at 200 % the same box is painted over twice as many
     * device pixels, and without it zooming in would be an upscale of the pixels already there.
     */
    zoom = DEFAULT_ZOOM,
    index,
    total,
    /** The sentence `segments:*` refused with, shown inline under the label for ~2 s. */
    refusal = null,
    active = false,
    dragging = false,
    dropHere = false,
    /** The claims this segment has moved, for the glyph strip. Empty until one has. */
    claims = [],
    /** This card's "+ Ask here" prompt is open / its question is in flight. */
    askOpen = false,
    askBusy = false,
    /** The objective the open question is about — the removable `about:` chip (§5). */
    askAbout = null,
    /** A question the app has proposed and the learner has not yet sent (**Teach me this**). */
    askPrefill = '',
    /**
     * The objectives this segment teaches, from the file's tree. The glyph strip now means
     * "what this slide is for and how far you have got with it" as well as which claims moved
     * here (`learning-objectives.md` §5).
     */
    objectives = [],
    /** Jumped to from the objectives panel: a ring, for a moment. */
    highlight = false,
    /** The private popover is open on this card (§3.5). Only the affordance's state. */
    privateOpen = false,
    /** A public turn is held on this card — `pivot-spec.md` §B9 device 1 draws the anchor ring. */
    pending = false,
    /** This thread has turns above its `lastSeenSeq` (audit §7). A dot on the label strip. */
    unread = false,
    onsplit,
    onrename,
    onask,
    onaskopen,
    onaskcancel,
    onaskabout,
    onaskprivately,
    onactivate,
    ondragbegin,
    ondragover,
    ondropon,
    ondragfinish,
  }: {
    card: FlowCard;
    page: PagePt;
    canvas?: HTMLCanvasElement | null;
    rev?: number;
    background?: string;
    contentWidth?: number;
    zoom?: number;
    index: number;
    total: number;
    refusal?: string | null;
    active?: boolean;
    dragging?: boolean;
    dropHere?: boolean;
    claims?: AnchorClaim[];
    askOpen?: boolean;
    askBusy?: boolean;
    askAbout?: { id: string; title: string } | null;
    askPrefill?: string;
    objectives?: SegmentObjective[];
    highlight?: boolean;
    privateOpen?: boolean;
    pending?: boolean;
    unread?: boolean;
    onsplit?: (input: { at: number; axis: 'horizontal' | 'vertical'; free: boolean; cutOffset: number }) => void;
    onrename?: (label: string) => void;
    onask?: (question: string, scope: AskScope) => void;
    onaskopen?: () => void;
    onaskcancel?: () => void;
    /** ✕ on the `about:` chip. The question stays; what it is tagged with does not. */
    onaskabout?: () => void;
    /** "Ask privately" / ⌘K. The card raises it; `FlowCanvas` owns what opens (§3.5). */
    onaskprivately?: () => void;
    onactivate?: () => void;
    ondragbegin?: () => void;
    ondragover?: (before: boolean) => void;
    ondropon?: () => void;
    ondragfinish?: () => void;
  } = $props();

  let crop = $state<HTMLCanvasElement | null>(null);

  const box = $derived(cardSize(card.rect, page, contentWidth));
  const ticks = $derived(tickPositions({ ...card.rect, candidates: card.candidates }, page, contentWidth));
  const buildChip = $derived(buildChipLabel(card.buildSteps));

  /**
   * The crop.
   *
   * Painted in two passes on purpose. The placeholder goes down first, in the **page's own
   * background colour**, so a card that is waiting for its page is a correctly sized rectangle
   * of the right colour rather than a white flash or a hole — risk 3 in `flow-build-plan.md` §5
   * is precisely this, and it is the artefact most likely to be caught on camera.
   */
  $effect(() => {
    const target = crop;
    const source = canvas;
    const rect = card.rect;
    const size = box;
    void rev;
    void background;
    if (!target) return;
    const ratio = backingRatio(window.devicePixelRatio || 1, zoom);
    const plan = drawPlan(rect, page, { width: source?.width ?? 0, height: source?.height ?? 0 }, size.w, ratio);
    // One integer decides the backing store and the CSS box, so the crop can never overhang its
    // own card by a pixel (the same rule PdfViewer.draw() follows).
    target.width = plan.backing.w;
    target.height = plan.backing.h;
    target.style.width = `${plan.css.w}px`;
    target.style.height = `${plan.css.h}px`;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, target.width, target.height);
    if (!source || source.width === 0 || source.height === 0) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, plan.src.sx, plan.src.sy, plan.src.sw, plan.src.sh, 0, 0, target.width, target.height);
  });

  // ── The split guide ───────────────────────────────────────────────────────
  /** Where the guide is, in CSS px inside the crop, or null when nothing is being proposed. */
  let guide = $state<{ axis: 'horizontal' | 'vertical'; offset: number; free: boolean } | null>(null);

  function guideFor(at: number, axis: 'horizontal' | 'vertical', free: boolean): void {
    const lo = axis === 'horizontal' ? card.rect.y0 : card.rect.x0;
    const hi = axis === 'horizontal' ? card.rect.y1 : card.rect.x1;
    const span = axis === 'horizontal' ? box.h : box.w;
    guide = { axis, offset: Math.round(offsetFromNorm(at, span, lo, hi)), free };
  }

  function split(at: number, axis: 'horizontal' | 'vertical', free: boolean): void {
    const lo = axis === 'horizontal' ? card.rect.y0 : card.rect.x0;
    const hi = axis === 'horizontal' ? card.rect.y1 : card.rect.x1;
    const span = axis === 'horizontal' ? box.h : box.w;
    guide = null;
    onsplit?.({ at, axis, free, cutOffset: Math.round(offsetFromNorm(at, span, lo, hi)) });
  }

  /**
   * A drag anywhere down the gutter track is the free cut: it snaps to a real gap within 8 pt
   * with exactly the arithmetic the main process will use, and the modifier releases the snap
   * (`segmentation-lazy-split.md` §4). Holding a modifier and landing on a figure is still
   * refused — `splitSegment` refuses `free` cuts across a figure too — which is the case the
   * inline message exists for.
   */
  function trackAt(e: MouseEvent, axis: 'horizontal' | 'vertical'): { at: number; free: boolean } {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const lo = axis === 'horizontal' ? card.rect.y0 : card.rect.x0;
    const hi = axis === 'horizontal' ? card.rect.y1 : card.rect.x1;
    const span = axis === 'horizontal' ? box.h : box.w;
    /**
     * `clientY` and `getBoundingClientRect()` are in the flow's **visual** pixels; `box` is the
     * card's own layout pixels, inside the zoomed wrapper. The ratio is measured off the track
     * element itself rather than taken from a prop — one number, read from the thing the
     * learner is actually pointing at, so it cannot drift from what is on screen.
     */
    const drawn = axis === 'horizontal' ? rect.height : rect.width;
    const k = drawn > 0 && span > 0 ? span / drawn : 1;
    const offset = (axis === 'horizontal' ? e.clientY - rect.top : e.clientX - rect.left) * k;
    const free = e.altKey;
    const raw = normFromOffset(offset, span, lo, hi);
    return { at: snapPreview(raw, axis, card.candidates, page, { free }).at, free };
  }

  function trackMove(e: MouseEvent, axis: 'horizontal' | 'vertical'): void {
    const { at, free } = trackAt(e, axis);
    guideFor(at, axis, free);
  }

  function trackClick(e: MouseEvent, axis: 'horizontal' | 'vertical'): void {
    const { at, free } = trackAt(e, axis);
    split(at, axis, free);
  }

  // ── The label strip ───────────────────────────────────────────────────────
  let editing = $state(false);
  let draft = $state('');

  function startEdit(): void {
    draft = card.label;
    editing = true;
  }

  function commitEdit(): void {
    if (!editing) return;
    editing = false;
    const next = draft.trim();
    if (next.length > 0 && next !== card.label) onrename?.(next);
  }

  // ── Compare on hover ──────────────────────────────────────────────────────
  /**
   * The page chip's panel: the source page, dimmed, with this segment's rectangle outlined
   * bright on it (§C3, §D2 — "the learner should never be more than one gesture from the
   * unsegmented, unmodified page"). It draws off the same canvas the card draws off, so it
   * costs nothing and can never disagree with the crop about where the segment is.
   */
  let comparing = $state(false);
  let compare = $state<HTMLCanvasElement | null>(null);
  const COMPARE_W = 280;

  $effect(() => {
    if (!comparing) return;
    const target = compare;
    const source = canvas;
    const rect = card.rect;
    void rev;
    if (!target) return;
    const dpr = backingRatio(window.devicePixelRatio || 1, zoom);
    const h = Math.max(1, Math.round((COMPARE_W * page.height) / page.width));
    target.width = Math.round(COMPARE_W * dpr);
    target.height = Math.round(h * dpr);
    target.style.width = `${COMPARE_W}px`;
    target.style.height = `${h}px`;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, target.width, target.height);
    if (source && source.width > 0) {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, target.width, target.height);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = '#5b50e8';
    ctx.lineWidth = Math.max(2, Math.round(2 * dpr));
    ctx.strokeRect(
      rect.x0 * target.width,
      rect.y0 * target.height,
      (rect.x1 - rect.x0) * target.width,
      (rect.y1 - rect.y0) * target.height,
    );
  });
</script>

<!-- The card is focusable on purpose: §5 of the task asks for keyboard reach, and a card is
     the thing a learner tabs to before tabbing into its ticks. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<article
  class="card"
  class:active
  class:dragging
  class:drophere={dropHere}
  class:pending
  class:highlight
  data-segment={card.segmentId}
  data-page={card.page}
  tabindex="0"
  role="group"
  aria-label={`${card.label || 'Segment'} — card ${index + 1} of ${total}, page ${card.page}`}
  onfocus={() => onactivate?.()}
  ondragover={(e) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ondragover?.(e.clientY < rect.top + rect.height / 2);
  }}
  ondrop={(e) => {
    e.preventDefault();
    ondropon?.();
  }}
>
  <header class="strip">
    <!-- The handle is the only thing that arms the drag: a card that starts dragging when you
         happen to press on the slide would make selecting anything on it impossible. -->
    <span
      class="handle"
      role="button"
      tabindex="-1"
      draggable="true"
      aria-label="Reorder this card"
      title="Drag to reorder"
      ondragstart={(e) => {
        e.dataTransfer?.setData('text/plain', card.segmentId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        ondragbegin?.();
      }}
      ondragend={() => ondragfinish?.()}
    >⣿</span>

    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="label edit"
        autofocus
        bind:value={draft}
        onblur={commitEdit}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitEdit();
          if (e.key === 'Escape') editing = false;
          e.stopPropagation();
        }}
      />
    {:else}
      <button type="button" class="label" title="Rename this segment" onclick={startEdit}>
        {card.label || 'Untitled'}
      </button>
    {/if}

    <!--
      The ledger glyphs for this segment (`flow-build-plan.md` §3.4 track C). Monochrome and a
      progression, not a traffic light — `LedgerRow`'s glyphs and words, verbatim, moved out of
      the retired rail and onto the card the evidence was written under. A glyph appears only
      when the learner's own words on *this* thread became the evidence for a claim, which is why
      reading a REFERENCE answer can never put one here.
    -->
    <!--
      **The objectives this slide teaches** (`learning-objectives.md` §5: "the glyph now means
      the objectives the card's segment teaches"). Same four marks as the panel and the same four
      as the ledger rail, so one vocabulary covers all three; the claims strip below is unchanged
      and stays what it always was — the claims whose evidence was written *here*.
    -->
    {#if objectives.length > 0}
      <span
        class="glyphs objectives"
        role="note"
        aria-label={`This slide teaches: ${objectives.map((o) => `${o.title}, ${wordFor(o.level)}`).join('; ')}`}
      >
        {#each objectives as o (o.id)}
          <span class="glyph" class:dim={o.level === 0} title={`${o.title} — ${wordFor(o.level)}`}>
            {glyphFor(o.level)}
          </span>
        {/each}
      </span>
    {/if}

    {#if claims.length > 0}
      <span class="glyphs" role="note" aria-label={`Claims moved here: ${claims.map((c) => `${c.learnerLabel}, ${LEDGER_WORD[c.state]}`).join('; ')}`}>
        {#each claims as claim (claim.elementId)}
          <span class="glyph" class:filled={claim.state === 'defended'} title={`${claim.elementId} · ${claim.learnerLabel} — ${LEDGER_WORD[claim.state]}`}>
            {LEDGER_GLYPH[claim.state]}
          </span>
        {/each}
      </span>
    {/if}

    {#if buildChip}
      <span class="chip build" title={`Built up over pages ${card.buildSteps.join(', ')} — the finished slide is shown`}>
        {buildChip}
      </span>
    {/if}

    <!--
      **Ask privately** (`flow-build-plan.md` §3.5). The small affordance ⌘K duplicates, because
      a gesture with no visible handle is a gesture only its author knows about — and the person
      this feature is for (`design-brief.md` §D5: the one who will not ask in public) is the
      least likely of anyone to have read a shortcut list. Faint until the card is hovered or
      focused, so it is never competing with the slide.
    -->
    {#if onaskprivately}
      <button
        type="button"
        class="chip ask-private"
        class:on={privateOpen}
        title="Ask about this segment privately — nothing said there reaches the document"
        onclick={(e) => {
          e.stopPropagation();
          onaskprivately?.();
        }}
      >
        <span aria-hidden="true">🔒</span> Ask privately <kbd>⌘K</kbd>
      </button>
    {/if}

    {#if unread}
      <!-- The reply that landed eight slides up, made findable at a glance (audit §7). It
           clears when the thread is actually scrolled onto the screen, not when it arrives. -->
      <span class="dot" role="note" aria-label="Unread replies in this thread" title="Unread replies"></span>
    {/if}

    <span
      class="chip page"
      role="note"
      onmouseenter={() => (comparing = true)}
      onmouseleave={() => (comparing = false)}
    >
      {pageChipLabel(card)}
    </span>
  </header>

  {#if refusal}
    <p class="refused" role="status">{refusal}</p>
  {/if}

  <div class="body" style={`width: ${box.w}px`}>
    <!-- The right gutter. Ticks live here, outside the pixels (SEGMENTS.md §2). -->
    <!-- The track is the free cut, which is a pointer gesture by nature: the keyboard path is
         the ticks inside it, which are real buttons and split on Enter. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="gutter"
      style={`height: ${box.h}px`}
      onmousemove={(e) => trackMove(e, 'horizontal')}
      onmouseleave={() => (guide = null)}
      onclick={(e) => trackClick(e, 'horizontal')}
    >
      {#each ticks.filter((t) => t.axis === 'horizontal') as tick (tick.key)}
        <button
          type="button"
          class="tick"
          style={`top: ${tick.offset}px`}
          aria-label={`Split here, ${Math.round(tick.gapPt)} point gap`}
          onmouseenter={() => guideFor(tick.at, 'horizontal', false)}
          onfocus={() => guideFor(tick.at, 'horizontal', false)}
          onblur={() => (guide = null)}
          onclick={(e) => {
            e.stopPropagation();
            split(tick.at, 'horizontal', false);
          }}
        ></button>
      {/each}
    </div>

    <div class="cropwrap" style={`width: ${box.w}px; height: ${box.h}px; background: ${background}`}>
      <!-- `data-crop` is the flow's double-click target: 100 % ↔ fit-width, like Preview. -->
      <canvas class="crop" data-crop bind:this={crop}></canvas>
      <!-- The only thing ever drawn over slide pixels. -->
      {#if guide}
        <span
          class="guide"
          class:free={guide.free}
          style={guide.axis === 'horizontal'
            ? `top: ${guide.offset}px; left: 0; right: 0; border-top-width: 1px`
            : `left: ${guide.offset}px; top: 0; bottom: 0; border-left-width: 1px`}
        ></span>
      {/if}
    </div>
  </div>

  {#if ticks.some((t) => t.axis === 'vertical')}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="vgutter"
      style={`width: ${box.w}px`}
      onmousemove={(e) => trackMove(e, 'vertical')}
      onmouseleave={() => (guide = null)}
      onclick={(e) => trackClick(e, 'vertical')}
    >
      {#each ticks.filter((t) => t.axis === 'vertical') as tick (tick.key)}
        <button
          type="button"
          class="tick v"
          style={`left: ${tick.offset}px`}
          aria-label={`Split down the column gutter, ${Math.round(tick.gapPt)} point gap`}
          onmouseenter={() => guideFor(tick.at, 'vertical', false)}
          onfocus={() => guideFor(tick.at, 'vertical', false)}
          onblur={() => (guide = null)}
          onclick={(e) => {
            e.stopPropagation();
            split(tick.at, 'vertical', false);
          }}
        ></button>
      {/each}
    </div>
  {/if}

  <!-- Every boundary in this document is the learner's, and so is every question (beat 7). -->
  <div class="askrow" style={`width: ${box.w}px`}>
    <AskHereLine
      open={askOpen}
      busy={askBusy}
      anchorId={card.segmentId}
      about={askAbout}
      prefill={askPrefill}
      onabout={() => onaskabout?.()}
      onopen={() => onaskopen?.()}
      oncancel={() => onaskcancel?.()}
      onask={(question, scope) => onask?.(question, scope)}
    />
  </div>

  {#if comparing}
    <div class="comparepanel">
      <canvas bind:this={compare}></canvas>
      <p class="caption">{compareCaption(card.page)}</p>
    </div>
  {/if}
</article>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 auto 16px;
    width: max-content;
    outline-offset: 3px;
  }
  .card:focus-visible { outline: 2px solid var(--indigo); }
  /* Jumped to from the objectives panel. A ring rather than a fill, and it fades: the learner
     asked to be brought here, so this only has to answer "which card" for a second or two. */
  .card.highlight::after {
    content: '';
    position: absolute;
    inset: -6px;
    border: 2px solid var(--indigo);
    border-radius: 8px;
    pointer-events: none;
    animation: ringout 1600ms ease-out forwards;
  }
  @keyframes ringout {
    0% { opacity: 0.9; }
    70% { opacity: 0.9; }
    100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card.highlight::after { animation: none; opacity: 0.9; }
  }
  .card.dragging { opacity: 0.45; }
  .card.drophere::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -9px;
    border-top: 2px solid var(--indigo);
  }

  /* The label strip: 28 px, matching LABEL_STRIP in flowview.ts, which the split's scroll
     anchor assumes. */
  .strip {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    width: 100%;
    padding: 0 2px;
  }
  .handle {
    cursor: grab;
    color: var(--muted);
    font-size: 11px;
    line-height: 1;
    letter-spacing: -1px;
    user-select: none;
  }
  .handle:active { cursor: grabbing; }
  .label {
    flex: 1;
    min-width: 0;
    text-align: left;
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 2px 4px;
    border-radius: 4px;
    border: 1px solid transparent;
  }
  .label:hover { border-color: var(--hairline); }
  .label.edit {
    background: var(--pane);
    border-color: var(--indigo);
    font-weight: 500;
    outline: none;
  }
  .chip {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 1px 5px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .chip.page:hover { color: var(--text-2); border-color: var(--muted); cursor: help; }
  .chip.build { color: var(--text-2); }

  /* Faint until the card is hovered or focused: present, never competing with the slide. */
  .chip.ask-private { opacity: 0.35; transition: opacity 120ms ease-out, color 120ms ease-out; }
  .card:hover .chip.ask-private,
  .card:focus-within .chip.ask-private { opacity: 1; }
  .chip.ask-private:hover { color: var(--indigo); border-color: var(--indigo); }
  .chip.ask-private.on { opacity: 1; color: var(--indigo); border-color: var(--indigo); background: var(--indigo-tint); }
  .chip.ask-private kbd { font: inherit; font-size: 9px; opacity: 0.7; }

  .refused {
    margin: 0 0 4px;
    align-self: flex-start;
    font-size: 11px;
    color: #8a2708;
    background: #fdf3ef;
    border: 1px solid #f0d9d0;
    border-radius: 4px;
    padding: 3px 8px;
  }

  .body { position: relative; display: block; }

  /* The crop: full-bleed, hairline border, no radius on the image (§C3). */
  .cropwrap {
    position: relative;
    border: 1px solid var(--hairline);
    box-shadow: 0 1px 4px rgba(27, 27, 34, 0.14);
    overflow: hidden;
  }
  .crop { display: block; }

  /**
   * `pivot-spec.md` §B9 device 1 — **the anchor ring**. While a public turn is held on this
   * card, the crop wears a ring *outside its own bounds*: the never-rule holds for the ring
   * exactly as it does for an AI card, so it is an outline offset off the edge and never a
   * pixel drawn on the slide. It is what makes a held reply read as *belonging here* rather
   * than as the app having stopped.
   */
  .card.pending .cropwrap {
    outline: 2px solid color-mix(in srgb, var(--indigo) 55%, transparent);
    outline-offset: 4px;
    animation: anchorpulse 2.2s ease-in-out infinite;
  }
  @keyframes anchorpulse {
    0%, 100% { outline-color: color-mix(in srgb, var(--indigo) 22%, transparent); }
    50% { outline-color: color-mix(in srgb, var(--indigo) 62%, transparent); }
  }

  /* The unread dot (audit §7). */
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--indigo);
  }

  /**
   * `styles/app.css` honours `prefers-reduced-motion` once, for transitions; neither the
   * three-dot pulse nor this ring was covered by it (audit §8). Both are now.
   */
  @media (prefers-reduced-motion: reduce) {
    .card.pending .cropwrap { animation: none; }
  }

  .guide {
    position: absolute;
    border: 0 dashed var(--indigo);
    pointer-events: none;
  }
  .guide.free { border-color: #b4310c; }

  /* Ticks sit in a 22 px track hanging off the right edge — outside the pixels, always. */
  .gutter {
    position: absolute;
    top: 0;
    left: 100%;
    width: 22px;
    cursor: crosshair;
  }
  .vgutter {
    position: relative;
    height: 16px;
    cursor: crosshair;
  }
  .tick {
    position: absolute;
    left: 4px;
    width: 13px;
    height: 0;
    padding: 0;
    border-top: 1px solid var(--muted);
    opacity: 0.55;
    transform: translateY(-50%);
    border-radius: 0;
  }
  .tick:hover, .tick:focus-visible {
    opacity: 1;
    border-top-color: var(--indigo);
    border-top-width: 2px;
    width: 17px;
    outline: none;
  }
  .tick.v {
    top: 3px;
    left: 0;
    width: 0;
    height: 11px;
    border-top: 0;
    border-left: 1px solid var(--muted);
    transform: translateX(-50%);
  }
  .tick.v:hover, .tick.v:focus-visible { border-left-color: var(--indigo); border-left-width: 2px; height: 14px; width: 0; }

  /* The "+ Ask here" line lives in AskHereLine.svelte; this only gives it the card's width. */
  .askrow { align-self: flex-start; }

  /* The ledger glyphs. 400 ms fade on arrival, carried over from LedgerRow verbatim. */
  .glyphs { display: inline-flex; align-items: baseline; gap: 3px; flex: none; }
  .glyph {
    font-size: 12px;
    color: var(--glyph, var(--text-2));
    animation: glyphin 400ms ease-out;
    cursor: help;
  }
  .glyph.filled { color: var(--text); }
  /* An objective the learner has not touched yet is present but quiet: the strip should read as
     "this slide is for four things" at a glance, without four dots competing with the label. */
  .glyphs.objectives .glyph { animation: none; opacity: 0.9; }
  .glyphs.objectives .glyph.dim { color: var(--muted); opacity: 0.45; }
  @keyframes glyphin {
    0% { opacity: 0.15; }
    100% { opacity: 1; }
  }

  .comparepanel {
    position: absolute;
    z-index: 40;
    top: 26px;
    right: -18px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    box-shadow: 0 10px 28px rgba(27, 27, 34, 0.2);
    padding: 8px;
    pointer-events: none;
  }
  .comparepanel canvas { display: block; border: 1px solid var(--hairline); }
  .caption { margin: 6px 2px 0; font-size: 10px; color: var(--muted); max-width: 280px; }
</style>
