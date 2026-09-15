# ChatterED renderer — code review of four reported issues

**Reviewed 15 Sep 2026** against the working tree at `/Users/lohzh/ChatterED` (no code changed).
Everything below was measured in the running app, not read off the source: a dev build
(`app/scripts/dev.mjs` equivalent: `tsc -p tsconfig.main.json` → Vite on `:5273` → Electron with
`--remote-debugging-port=9222`) was driven over the Chrome DevTools Protocol and, for the
menu bar, over the macOS accessibility API.

**Environment, verified.** `app/package.json` pins `electron: ^44.3.0`; the installed
`node_modules/electron/dist/Electron.app/Contents/Info.plist` says **44.3.0**, and
`http://127.0.0.1:9222/json/version` reports **Chrome/152.0.7977.78, Electron/44.3.0,
V8 15.2.124.19**. `devicePixelRatio` = 2. Window 1320 × 860 (`main/index.ts:49-50`).

**Caveat on git.** `git` on this Mac exits 69 (`You have not agreed to the Xcode license
agreements`), so the requested `git pull --ff-only` could **not** be run. The review is of the
tree as it stands on disk. Nothing else in the review depends on it.

**Caveat on the live instance.** Another agent was driving the same renderer during part of the
session (it re-pointed the vault from the OneDrive tree to `/Users/lohzh/ChatterED/Academia`
mid-run). Measurements below are labelled with the document they were taken against; each was
re-run at least once.

---

## Summary

| # | Issue | Root cause in one line | Effort | Risk |
|---|---|---|---|---|
| 1 | "Fit" does not fit | `PdfViewer.svelte:102` divides by a **hard-coded 612 pt** instead of the page's real width. Correct for US-Letter portrait, 38 % too wide for landscape A4, 57 % too wide for 16:9 slides. | **S** | Low |
| 2 | No chat pane in Library | `App.svelte:44-54` renders the screens as **mutually exclusive siblings**; `Room` only mounts when `store.room` is set *and* the screen is not `library`. `store.leaveRoom()` (`store.svelte.ts:425-433`) additionally **nulls the room**. | **M** | Medium |
| 3 | First column does nothing | `NavRail` is 3 items, one of them permanently disabled, plus a COURSES list derived from `rooms.module_code`, which is **hard-coded to `'MA3236'`** in two places. Two competing taxonomies 76 px apart. | **M** | Low–Medium |
| 4 | No trackpad gestures | Nothing in `src/` touches `wheel`, `swipe`, `zoom-changed`, `Menu`, or any zoom API (grep is clean). Electron's **default** menu is live, so ⌘+/⌘−/⌘0 are Chromium's, not ChatterED's. | **M** | Low |

Plus eight further renderer defects in §5, of which the largest is **901 MB of canvas bitmaps**
after reading one 60-page deck.

---

## 1. "Fit" does not fit the PDF to the pane width

### Root cause

`app/src/renderer/components/PdfViewer.svelte:99-103`

```js
/** Fit-width scale, recomputed whenever the pane resizes. */
const scale = $derived.by(() => {
  if (!fit) return zoom;
  if (width <= 0) return 1;
  return Math.min(3, Math.max(0.4, (width - 48) / 612)); // 612pt = US Letter, close enough to A4
});
```

The fit scale is computed against a **constant**, `612` — the width in points of a US-Letter
page in **portrait**. The page box that is actually laid out is sized from the *real* page width
(`PdfViewer.svelte:238`):

```svelte
style={base ? `width: ${Math.round(base.w * scale)}px; min-height: ${Math.round(base.h * scale)}px` : ''}
```

so the rendered width is `base.w × (width − 48) / 612`. That equals the available width **only
when `base.w === 612`**. The error factor is exactly `base.w / 612`:

| Page geometry | `base.w` (pt) | Error factor | Result |
|---|---|---|---|
| US Letter portrait | 612 | 1.00 | correct (the case that was tested) |
| A4 portrait | 595.3 | 0.97 | 3 % narrow — invisible |
| **A4 landscape** (LaTeX Beamer / most lecture decks) | 841.9 | **1.38** | 38 % too wide |
| **16:9 slides** (PowerPoint/Keynote export) | 960 | **1.57** | 57 % too wide |

The comment "612pt = US Letter, close enough to A4" is true for A4 *portrait* and false for
every landscape document, which is what a lecture deck is. `base` — the real page-1 viewport —
is already computed and in scope at `PdfViewer.svelte:48` / `:78-81`; it is simply not used here.

### Measured evidence

**A. 16:9 slide deck** (`CS3249/Critique 1/A0282987E_LohZhengLucas_Critique1_slides.pdf`,
7 pages, `base.w = 960 pt`), `Fit` active, window 1320 × 860:

```
Fit button:        on
Zoom readout:      140 %
.scroll clientW:   891 px      offsetW: 906 px   (15 px classic scrollbar)
.page style.width: 1346 px     ← 960 × 1.4020
.scroll scrollW:   1346 px     → horizontal scrollbar, 455 px clipped off the right
canvas backing:    2691 × 1514      canvas CSS: 1345 × 757
```

**B. A4-landscape lecture deck** (`CS4246/Lecture-mdp.pdf`, 60 pages, `base.w = 841.9 pt`):

```
Zoom readout:      140 %
.scroll clientW:   891 px
.page offsetW:     1180 px     ← 841.9 × 1.402 ;  289 px clipped
.page offsetH:     835 px      viewport height 678 px
```

**C. Which number is 169 %.** The readout at `PdfViewer.svelte:211` is `Math.round(scale * 100)`
— the **pdf.js user-space / CSS scale**, not the backing-store scale. The backing store is drawn
at `scale × dpr` (`:118-119`) and the canvas CSS size is divided back down (`:122-123`), so at a
readout of 140 % the canvas is rasterised at 280 %. The developer's 169 % is the same CSS number
at a wider pane: `(W − 48) / 612 = 1.69` ⇒ `W ≈ 1082 px`, i.e. a window around 1490 px wide, or
this window in fullscreen.

### Is there a ResizeObserver? Yes — and it works

`bind:clientWidth` on `.scroll` (`PdfViewer.svelte:228`) compiles to a `ResizeObserver` in
Svelte 5. Measured by collapsing and re-expanding the nav rail with the deck open:

```
start   pct 140 %   clientW 891   (stale: measured at 906 before the scrollbar appeared)
nav collapsed       pct 156 %   clientW 1003   page 1498 px
nav re-expanded     pct 138 %   clientW  891   page 1322 px
```

So the observer is live; the scale simply converges on the wrong number. Note the initial
**140 % vs the settled 138 %**: at first paint the scroller has no content, so no vertical
scrollbar, so `clientWidth` is 906; once 60 pages exist it drops to 891. That is a
measure → scrollbar → re-measure feedback path, benign here only because a vertical scrollbar
is always present in a multi-page document.

Two related facts from the same run:

- **Scrollbars take space on this Mac**: `offsetWidth − clientWidth = 15 px`. The `− 48`
  constant is a page-gutter fudge, not a scrollbar allowance; `clientWidth` already excludes the
  scrollbar, so the two are not double-counted — but there is no `scrollbar-gutter`, so the
  gutter appears and disappears under the measurement.
- **Stale canvases outlive a scale change.** After the resize cycle the page box was 1322 px
  while its canvas was still `style.width: 1345px` — the canvas **overhangs its own white page
  by 23 px**. `draw()` only re-runs when the `IntersectionObserver` fires (`:143-157`), and a
  page that was already intersecting and stayed intersecting produces no new entry, so the
  already-visible page keeps its old bitmap indefinitely.

### "Fit" means fit-width, and for slides that is the wrong default

There is one `fit` boolean (`PdfViewer.svelte:38`) and one formula, which is fit-**width**.
For a landscape deck, fit-width still leaves each slide taller than the pane (measured B: page
835 px in a 678 px viewport), so even after the arithmetic is fixed the learner cannot see a
whole slide. `product-design.md` §B2 L230 and §B3 both assume the learner *glances* at a slide;
a slide you have to scroll is not a glance.

### The fix

**In `PdfViewer.svelte`.** Replace `:99-103` and add a second fit mode:

```js
/** The horizontal breathing room either side of a page, in CSS px. */
const GUTTER = 24;

let fitMode = $state<'width' | 'page' | null>('page'); // null = manual zoom
let viewH = $state(0);                                  // bind:clientHeight on .scroll

const scale = $derived.by(() => {
  if (fitMode === null) return zoom;
  // Do not guess. Until both the pane and the page are measured, render nothing (see below).
  if (width <= 0 || !base) return 0;
  const byWidth = (width - GUTTER * 2) / base.w;         // clientWidth already excludes the scrollbar
  const byPage  = (viewH  - GUTTER * 2) / base.h;
  const s = fitMode === 'width' ? byWidth : Math.min(byWidth, byPage);
  return Math.min(3, Math.max(0.05, s));                 // NOT 0.4 — see the note on clamping
});
```

and guard the page loop so nothing is laid out at a guessed scale:

```svelte
{:else if doc && scale > 0}
  {#each …}
```

Three supporting changes, all in the same file:

1. **`.scroll { scrollbar-gutter: stable; }`** (`PdfViewer.svelte:300`). Chromium 152 supports
   it. This removes the measure → scrollbar → re-measure step entirely and makes the 140 %/138 %
   discrepancy go away; the first paint is then the final paint.
2. **Derive the page box and the canvas from one integer.** Today `.page` is
   `Math.round(base.w * scale)` (`:238`) and the canvas is `Math.floor(viewport.width / dpr)`
   (`:122`); they disagree by up to 1 px, which is a visible seam on the right edge of every
   page. Compute `const cssW = Math.round(base.w * scale)` once and use it for both.
3. **Invalidate every canvas on a scale change, not just the intersecting ones.** `setZoom()`
   already calls `drawn.clear()` (`:186`) but nothing clears it when the *fit* scale moves. Add

   ```js
   $effect(() => { void scale; drawn.clear(); for (const t of inFlight.values()) t.cancel(); inFlight.clear(); });
   ```

   and, in the same pass, set each already-drawn canvas's CSS size to the new `cssW` immediately
   (a cheap CSS-only rescale) so the 23 px overhang never appears while the re-render lands.

**On the `0.4` lower clamp.** `Math.max(0.4, …)` is a sensible floor for the *zoom steps*, but
applied to *fit* it reintroduces the bug: a 1683 pt A1 poster in a 500 px pane needs 0.3.
Keep 0.4 as the floor of `STEPS` (`:252`) and let fit go lower.

**Nothing changes in `DocumentPane.svelte`.** It contributes only the flex chain
(`.pane` → `.body` → `PdfViewer`, `DocumentPane.svelte:151-159, 221`), which is correct; the
pane does not participate in the scale computation.

### Verification the fix works, using the measured numbers

| Document | `base.w` | pane `clientW` | new scale | new page width | fits? |
|---|---|---|---|---|---|
| 16:9 slides | 960 | 891 | 0.878 | 843 px | yes (891 avail) |
| A4 landscape | 841.9 | 891 | 1.001 | 843 px | yes |
| A4 portrait | 595.3 | 891 | 1.417 | 843 px | yes |

### Effort and risk

**S** — about 30 lines in one component. **Risk: low.** The only behavioural surprise is that
`Fit` will now default to fit-**page** and therefore read as a *smaller* percentage than today
on a landscape deck (≈ 62 % rather than 140 % for measurement B). Ship the two-state toggle
(`Fit width` / `Fit page`) rather than a single `Fit`, and remember the last choice per session;
otherwise the fix will be reported as "zoom got worse".

---

## 2. No AI chat pane visible in the Library state

### The view/mode logic, mapped

`app/src/renderer/App.svelte:37-60` is the whole router:

```svelte
<div class="cols">
  <NavRail collapsed={store.navCollapsed} />
  {#if store.screen === 'loading'}      <div class="loading">…</div>
  {:else if store.screen === 'library'} <Library />
  {:else if store.screen === 'setup'}   <SessionSetup />
  {:else if store.screen === 'settings'}<Settings />
  {:else if store.room}                 <Room room={store.room} />
  {/if}
</div>
```

`Screen` is `'loading' | 'firstRun' | 'library' | 'setup' | 'room' | 'settings'`
(`store.svelte.ts:28`). The chain is a **single-slot router**: exactly one of the five things is
ever mounted next to the nav rail.

- `Room.svelte` mounts only on the final `{:else if store.room}` branch — i.e. only when the
  screen is none of `loading`/`library`/`setup`/`settings` *and* `store.room !== null`.
- `store.openRoom()` (`store.svelte.ts:413-423`) is the only writer of `store.room`, and it sets
  `screen = 'room'` in the same call.
- `store.leaveRoom()` (`store.svelte.ts:425-433`) sets `screen = 'library'` **and nulls
  `this.room`, `this.recap` and `this.whisper`.**
- `NavRail.svelte:31` calls `leaveRoom()` whenever the Library item is clicked from a room.

### Why the developer sees no chat at all with a document open

With a document open they are, by construction, on `screen === 'library'`:
`Library.svelte:88-89` renders `VaultBrowser`, which renders `DocumentPane` when
`store.openDoc` is set (`VaultBrowser.svelte:59-60`). That branch is taken *before*
`{:else if store.room}` can ever be reached, so `Room` is not mounted. And because the only
route back to the Library from a room is `leaveRoom()`, `store.room` is `null` by the time they
get there anyway — there is no room to re-mount even if the branch were reachable.

Measured, in the running app with the vault open and no document:

```
store.screen   "library"
store.room     null
DOM            nav.rail (168px) + div.browser (1152px)
                 └ aside.sidebar (244px) + div.right (908px)
```

Two columns of content, no third pane, no placeholder. The spec drew it this way on purpose —
`product-design.md` §B1 L177's ASCII labels the right column "(rail is empty on Library)", and
§B1 L222 says *"no agent avatars: Ellie and Max do not exist until a room is open"*. So this is
not a regression; it is the spec being followed, and the developer disagreeing with the spec.

### Minimal change to keep a persistent third pane

Four edits, none of which moves the ⌘K / focus / timer machinery.

**(a) Stop destroying the room on the way to the Library.** `store.svelte.ts:425-433`: split it.

```js
/** Go and look at something else. The room is still open — it is a trip to the shelf. */
goLibrary(): void {
  this.browserOpen = false;
  this.whisperOpen = false;
  this.navCollapsed = false;
  this.screen = 'library';
}

/** Actually end the session. Called from the recap's close, not from the nav rail. */
closeRoom(): void {
  this.goLibrary();
  this.room = null; this.recap = null; this.whisper = null;
}
```

Point `NavRail.svelte:31` at `goLibrary()`. This is the load-bearing change: without it the
third pane can never have anything but its empty state.

**(b) Make the third pane a sibling of the screen slot, not a branch of it.** `App.svelte:42-55`:

```svelte
<div class="cols">
  <NavRail collapsed={store.navCollapsed} />
  <div class="screen">
    {#if store.screen === 'loading'}      …
    {:else if store.screen === 'library'} <Library />
    {:else if store.screen === 'setup'}   <SessionSetup />
    {:else if store.screen === 'settings'}<Settings />
    {:else if store.room}                 <Room room={store.room} />
    {/if}
  </div>
  {#if store.screen !== 'room'}
    <PaneSplitter bind:size={store.chatWidth} />
    <aside class="chat" style="width: {store.chatWidth}px">
      {#if store.room}<Room room={store.room} embedded />{:else}<RoomEmpty />{/if}
    </aside>
  {/if}
</div>
```

The `store.screen !== 'room'` guard matters: inside a room `Room` already owns the full width
with its own three columns (`Room.svelte:110-129`), and mounting it twice would double its
`svelte:window` key handler (`Room.svelte:98`) and its timers.

**(c) `RoomEmpty.svelte` — new, ~60 lines.** Everything it needs is already in the store:

```svelte
<script lang="ts">
  import { store } from '../lib/store.svelte.js';
  const where = $derived.by(() => {
    if (store.openDoc?.kind !== 'pdf') return null;
    const from = store.docFrom ?? store.docPage, to = store.docTo ?? store.docPage;
    return from === to ? `p. ${from}` : `pp. ${from}–${to}`;
  });
  const recents = $derived((store.boot?.recentSessions ?? []).slice(0, 3));
</script>
```

`store.docPage` / `docFrom` / `docTo` are *store*-level, not `DocumentPane`-local
(`store.svelte.ts:88-90`), so the pane tracks the PDF live with no prop threading. The CTA is
the same call `DocumentPane.svelte:101-103` already makes:
`store.setupFromFile(doc.fileId, store.docFrom, store.docTo)`.

**Keep §B1 L222 intact.** The empty state must show the CTA and the recent-room cards and
**no agent avatars, names or colours** — no Ellie, no Max, no roster chips. That keeps the one
§B1 rule that carries a design decision while overriding the one that is only a layout
preference. Record it in `app/docs/STATUS.md` the way the issue #22 departures were recorded.

**(d) Delete the duplicate CTA.** Once `RoomEmpty` carries "Explain p. N →",
`DocumentPane.svelte:100-104`'s copy should go, or the learner sees the same button twice,
6 px apart.

### Pane widths, and the Divider question

**`Divider.svelte` is not a splitter.** `Divider.svelte:1-2` is *"the labelled divider above a
silence-fill message (product-design.md §C5)"* — a horizontal rule with a cause label inside the
thread. A grep for `resiz`, `splitter`, `col-resize`, `onpointerdown` across
`src/renderer` returns only textarea `resize: none` declarations. **There is no draggable pane
divider anywhere in ChatterED.** Every pane is a fixed CSS width:

| Pane | Width | Where |
|---|---|---|
| `NavRail` | 168 px, 56 px collapsed | `NavRail.svelte:67, 78` |
| `VaultSidebar` | 244 px | `VaultSidebar.svelte:88` |
| `SourcePane` | `clamp(320px, 24vw, 420px)` | `SourcePane.svelte:46` |
| `LedgerRail` / whisper | `clamp(260px, 20vw, 320px)` | `Room.svelte:18-24` |
| `.centre` (thread) | `flex: 1; min-width: 460px` | `Room.svelte:135-137` |

So "how would the Divider component work with three panes" has no answer as asked — a new
`PaneSplitter.svelte` has to be written. It is small:

```svelte
<script lang="ts">
  let { size = $bindable(360), min = 280, max = 520 }: {...} = $props();
  function down(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, s0 = size;
    const move = (m: PointerEvent) => { size = Math.min(max, Math.max(min, s0 - (m.clientX - x0))); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  }
</script>
<div class="split" role="separator" aria-orientation="vertical" tabindex="0"
     onpointerdown={down} onkeydown={(e) => { if (e.key === 'ArrowLeft') size += 16; if (e.key === 'ArrowRight') size -= 16; }}></div>
<style>.split { width: 5px; margin: 0 -2px; cursor: col-resize; z-index: 5; }</style>
```

Persist `size` in `localStorage` from the store, not in the component.

**The width budget is the real constraint.** The window minimum is 1040 px
(`main/index.ts:51`). Today: `1040 − 168 (nav) − 244 (sidebar) = 628 px` for the document.
Add a 360 px chat pane and the document gets **268 px** — unusable, and it will make issue 1
look unfixed again. Three mitigations, in order of preference:

1. **Do issue 3 first.** Merging the nav rail to a 48 px icon rail returns 120 px.
2. **Auto-collapse the chat pane below ~1200 px** to a 40 px vertical strip with a rotated
   label, reusing the pattern `SourcePane.svelte:15-18` already ships for the slide.
3. Raise `minWidth` to 1180 px. Cheapest, and defensible for a two-document-panes-plus-chat app,
   but it excludes a 1280 × 800 MacBook Air in a side-by-side Split View.

### Effort and risk

**M** — one new component, one new splitter, four small edits, plus the `localStorage` width.
**Risk: medium**, concentrated in (a): `leaveRoom()` nulling the room is currently what
guarantees that a stale `RoomSnapshot` never reaches the UI. Keeping the snapshot alive across a
Library visit means the main process's room actor and the renderer's copy can now diverge while
the learner is away (the actor pushes `RoomEvent`s to `store.apply()` regardless of screen —
`store.svelte.ts:124, 141-186` — so in practice it stays in sync, but `openRoom()` should still
be re-invoked, not skipped, when the learner clicks back into the room, and
`ipc.ts:195-196`'s `openRoom` short-circuit `if (this.#actor && …) return this.#actor.snapshot()`
makes that cheap).

---

## 3. The first sidebar column "does not do much"

### What is actually in it

`app/src/renderer/components/NavRail.svelte` — 168 px wide (`:67`), 56 px collapsed (`:78`) —
contains exactly four things:

| Element | Lines | State today |
|---|---|---|
| **Library** button | `:27-36` | Live. From a room it calls `store.leaveRoom()` and destroys the session snapshot (see §2). |
| **History** | `:38-41` | **Dead.** A `<span class="item off" title="Not in this build">`. Not a `<button>`, not focusable, no click handler, greyed by `.item.off { color: var(--muted); cursor: default }` (`:92-93`). It is the only permanently disabled affordance in the app. `app/docs/STATUS.md` lists "History, export to `~/Documents/ChatterED/`" under **Stubbed**, deferred to A2. |
| **Settings** button | `:42-51` | Live. |
| **COURSES** list | `:53-62` | Live, and wrong (below). |

That is one working navigation target (Library), one settings button, and a list. `Settings`
could be a gear in the title bar; `Library` is where you already are. The developer's read is
correct.

### Where COURSES / MA3236 comes from — the full data path

```
NavRail.svelte:8-16      courses = distinct s.moduleCode over store.boot.recentSessions
  ← store.svelte.ts:132   this.boot = await bridge().bootstrap()
  ← main/ipc.ts:164-193   bootstrap(): recentSessions = store.sessions.recent(3).map(...)
  ← main/ipc.ts:173         moduleCode: room?.module_code ?? ''
  ← rooms.module_code     (migration 001_init.sql:66, TEXT NOT NULL)
  ← main/sessions.ts:80     module_code: input.moduleCode || 'MA3236'        ← hard-coded
  ← CreateSessionInput.moduleCode
  ← SessionSetup.svelte:11  let moduleCode = $state(from?.moduleCode ?? 'MA3236')  ← hard-coded
  ← SessionSeed.moduleCode
  ← main/ipc.ts:255         moduleCode: this.#vault.moduleCodeFor(file.topic_id)
```

So the "COURSES" list is **"the distinct module codes of the three most recent rooms"**, and
`MA3236` is a literal string baked into two files as the fallback. `moduleCodeFor` only returns
a code when the *topic folder is named like a module code* (`vault/service.ts#promote`,
`STATUS.md` issue #22 stage (b)); for the developer's vault — whose topics are `CS3249`,
`CS4246`, `FYP`, `NST2030`, `NST2046` — a session started from `FYP` or from pasted text falls
through to `'MA3236'`.

### Measured evidence

Straight out of the running app's DOM (`document.body.innerText`, Library screen):

```
⌂ Library   ▤ History   ⚙ Settings

Courses
  MA3236  1                          ← column 1, from rooms.module_code

OneDrive-NationalUniversityofSingapore   Topics…
  CS3249  683                        ← column 2, from the vault `topics` table
  CS4246   35
  FYP      25
  NST2030  44
  NST2046  26
  Other  3940
```

**Two taxonomies of "a course", 76 px apart, and the one on the left is a single fabricated
entry.** This is exactly the pre-revamp "one module = one slides folder" concept (§B1 L179,
"Watched folders, one per module") surviving next to the issue #22 vault topics. `STATUS.md`
records the departure — *"One vault root, not 'Watched folders'… the course list in the nav rail
still counts sessions"* — so the survival was noticed and left in place; it has since become
misleading because nothing else in the UI speaks in module codes.

### The second dead path: `slides_folder`

Related, and worse, because it is on the first-run critical path:

```
FirstRun.svelte:134-145   card 3, "Choose your slides folder", button → pickFolder()
FirstRun.svelte:51-57     bridge().chooseSlidesFolder()
preload/index.ts:11       ipcRenderer.invoke(IPC.chooseSlidesFolder)
shared/ipc.ts:28, 70      the channel and its type
main/ipc.ts:288-296       dialog → settings.set('slides_folder', folder)
```

Nothing reads `slides_folder` back into the Library. It surfaces only as
`Bootstrap.slidesFolder` (`main/ipc.ts:188`) and `SettingsView.slidesFolder` (`:121`), and a
grep shows **no component renders either** — `Settings.svelte` has no folder row at all. The
vault is a separate table and a separate chooser (`store.chooseVault()` → `IPC.vaultChoose`).

The visible consequence: **a first-run learner picks their slides folder, presses Start, and
lands on a Library that asks them to choose a folder.** `vault/service.ts:110-112` keeps writing
`slides_folder` in step "so §F.4's first-run copy is not orphaned", which is precisely the copy
that should have gone.

### The proposed merge

**Recommended: a 48 px icon rail plus topics-as-the-first-column.** Not deletion — the rail is
where `product-design.md` §B0 puts global navigation, and the title bar is already spoken for by
the traffic-light spacer (issue #21).

1. **`NavRail` → 48 px, icons only, always.** Drop the `collapsed` prop and the 168/56 pair
   (`NavRail.svelte:6, 67, 78`), drop the text labels (`:34, 40, 49`), keep `aria-label` and
   `title` on each. Items: **Library ⌂**, **History ▤**, **Settings ⚙**. `store.navCollapsed`
   (`store.svelte.ts:56`) and its three writers (`:198, 421, 431`) become dead and go with it.
2. **Delete the COURSES block** (`NavRail.svelte:8-16, 53-62, 96-100`) and the `dot()` hue
   function. `VaultSidebar`'s topic list (`VaultSidebar.svelte:32-55`) is now the only course
   taxonomy, and it already has the coloured dot + name + count shape §B0 asks for, from a
   palette chosen to avoid the agent hues.
3. **History: build it or remove it.** The data is there — `sessions`, `rooms`, `ledger` — and
   `bootstrap()` already assembles the same shape for the Continue strip (`main/ipc.ts:167-186`)
   with a hard-coded `recent(3)`. Making History real is ~half a day: a `IPC.sessionsList`
   handler that takes a limit, and a screen that is the Continue strip without the slice. If
   that is out of scope for this milestone, **delete the item** — a permanently greyed control
   teaches the learner that parts of the app are broken.
4. Net width: **120 px back** to the document pane, which is what pays for §2's third column.

**The alternative — delete the column entirely** — is viable but costs more: `Library` and
`Settings` have to move somewhere (a title-bar segmented control), and `store.screen` stops
having a visible affordance for `settings`. Not recommended.

### Removing the dead data paths safely

**No database migration is needed for either.**

**`MA3236`.** `materials.module_code` and `rooms.module_code` are `TEXT NOT NULL` with **no
`CHECK` on their contents** (`001_init.sql:29, 66`), so `''` is already legal.

- `SessionSetup.svelte:11` → `$state(from?.moduleCode ?? '')`, and make the Module field
  optional in the form.
- `main/sessions.ts:80` → `module_code: input.moduleCode?.trim() || ''`.
- `room/prompts.ts:79` currently emits `` `MODULE ${input.material.module_code} — ${…title}` ``
  unconditionally. Make the `MODULE …` half conditional on a non-empty code.
- **Do not backfill existing rows.** `sharedBlock` is rebuilt from the material row on every
  turn and must hash byte-identically to `materials.prefix_sha256`
  (`sessions.ts:104-107`, architecture §E.2/E.3). Rewriting `module_code` on an existing
  material would silently invalidate the frozen prefix of every historical room. New sessions
  get the new behaviour; old ones keep their `MA3236` and their hash. A migration here would be
  a correctness bug, not a cleanup.

**`slides_folder`.** A settings key/value row, so there is nothing to migrate either.

- Replace `FirstRun.svelte:134-145` card 3 with the vault chooser: call
  `store.chooseVault()` and show `store.vault?.rootPath`. This also fixes the first-run
  dead end, and is the single highest-value line in this section.
- Delete `FirstRun.svelte:51-57`, `preload/index.ts:11`, `shared/ipc.ts:28` and `:70`, and
  `main/ipc.ts:288-296`.
- Delete `slidesFolder` from `Bootstrap` and `SettingsView` (`shared/types.ts:237, 255`) and its
  two producers (`main/ipc.ts:121, 188`) and the mock (`mockBridge.ts:64, 206, 215`).
- `vault/service.ts:110-112` may keep writing the key (harmless provenance) or drop it; if it is
  dropped, add `DELETE FROM settings WHERE key='slides_folder'` as migration `007` — optional,
  non-breaking, and only worth doing for tidiness.

### Effort and risk

**M** — mechanical, but it touches the preload allowlist and the shared IPC type, so `typecheck`
and the existing suite (`npm test`) both have to pass. **Risk: low–medium.** The one thing to
get right is the prompt-prefix invariant above; the one thing that will be noticed is the
first-run copy changing from "slides folder" to "vault", which `product-design.md` §F.4 L1247
still describes in the old words and which should be amended in the same commit.

---

## 4. Trackpad gesture support

### Current state, confirmed

```
$ grep -rn "Menu\|setApplicationMenu\|zoomFactor\|setVisualZoomLevelLimits\|setZoomLevel\|
           zoom-changed\|'swipe'\|wheel\|gesturestart\|touchstart\|globalShortcut" src/
src/main/vault/palette.ts:12:  * hues on the wheel. …           ← a comment about colour wheels
```

One false positive. **Nothing in ChatterED handles any gesture, and nothing configures zoom.**
`main/index.ts:45-90` builds the window and never touches `Menu` or `webContents` zoom.

### Mechanic 1 — pinch-to-zoom: it is a `wheel` event with `ctrlKey`. **Verified.**

Driven against the running app with `Input.synthesizePinchGesture` at (600, 400),
`scaleFactor: 2.0`, with a non-passive capture listener installed first:

```
31 wheel events, every one:
  ctrlKey:    true
  deltaMode:  0        (DOM_DELTA_PIXEL)
  deltaX:     0
  deltaY:     -3.27 … -2.81   (continuous, sub-pixel, decaying)
  cancelable: true     ← preventDefault() works
  clientX/Y:  600 / 400  ← the gesture centroid is on the event
```

So macOS pinch does arrive in the renderer as `ctrlKey`-wheel on **Electron 44.3.0 /
Chromium 152**, it is cancelable, and it carries the cursor position needed to zoom *around* the
pointer. Implement it in `PdfViewer.svelte`, on the `.scroll` element:

```svelte
<div class="scroll" bind:this={scroller} bind:clientWidth={width} onwheel={onwheel}>
```

```js
let gestureScale = $state(1);         // CSS-only multiplier while the fingers are down
let settle: ReturnType<typeof setTimeout> | null = null;

function onwheel(e: WheelEvent): void {
  // Two-finger horizontal → page turn (mechanic 3). Vertical without ctrl → ordinary scroll.
  if (!e.ctrlKey) return;
  e.preventDefault();                 // cancelable: true, verified above

  // Anchor: keep the document point under the cursor under the cursor.
  const box = scroller!.getBoundingClientRect();
  const px = scroller!.scrollLeft + e.clientX - box.left;
  const py = scroller!.scrollTop  + e.clientY - box.top;

  // Chromium sends deltaY ≈ -(magnification × 100) for a magnify gesture.
  const next = clamp(effectiveScale * Math.exp(-e.deltaY / 100), 0.1, 6);
  const k = next / effectiveScale;

  fitMode = null;                     // a pinch is an explicit zoom; leave Fit
  gestureScale = next / renderedScale; // what the CSS transform has to make up
  scroller!.scrollLeft = px * k - (e.clientX - box.left);
  scroller!.scrollTop  = py * k - (e.clientY - box.top);

  if (settle) clearTimeout(settle);
  settle = setTimeout(reRenderAtFinalScale, 150);
}
```

`Math.exp(-deltaY / 100)` rather than a linear step: pinch deltas are continuous and
momentum-decayed, so a multiplicative law is what feels proportional. Cap the per-event factor
(`Math.min(1.1, …)`) so one flicked event cannot jump three steps.

### Mechanic 2 — never let Chromium scale the UI

Two separate things, and only the second is currently a live problem.

**Visual (pinch) zoom is already off.** `electron.d.ts:18620-18626` states plainly: *"Visual zoom
is disabled by default in Electron."* Confirmed empirically — with **no** listener attached, a
synthesized pinch and two ctrl+wheel events left `devicePixelRatio` at 2,
`visualViewport.scale` at 1 and `innerWidth` at 1320. `setVisualZoomLevelLimits(1, 1)` is
therefore belt-and-braces; harmless, not required.

> **Could not verify.** CDP-synthesized input enters at the renderer's input pipeline and may
> not traverse the same browser-process gesture path as a real trackpad magnify. Re-test by
> hand on the trackpad before deleting the defensive call.

**The application menu is the live problem.** No `Menu.setApplicationMenu` call exists, so
Electron's default menu ships. Enumerated over the accessibility API against the running app:

```
menu bar:  Apple, Electron, File, Edit, View, Window
View:      Reload ⌘R · Force Reload ⇧⌘R · Toggle Developer Tools ⌥⌘I · ——
           Actual Size ⌘0 · Zoom In ⌘+ · Zoom Out ⌘− · —— · Toggle Full Screen ⌃⌘F
```

⌘+/⌘−/⌘0 are bound to Electron's `zoomIn`/`zoomOut`/`resetZoom` roles, which drive
**Chromium page zoom**, not the PDF. (Clicking those items via System Events did not change
`devicePixelRatio` or `innerWidth` in my harness, so I could **not** confirm end-to-end that a
real ⌘+ rescales the UI today — but the accelerators are taken either way, and the app has to
claim them.) It also ships **Reload**, **Force Reload** and **Toggle Developer Tools** to the
learner, which is a separate defect for a study tool.

`main/index.ts`, after `createWindow()`:

```ts
import { Menu, type MenuItemConstructorOptions } from 'electron';

win.webContents.setZoomMode('disabled');   // electron.d.ts:18670-18686 — "all zoom changes will be ignored"

const zoom = (kind: 'in' | 'out' | 'reset') => () =>
  mainWindow?.webContents.send(IPC.zoom, kind);

const template: MenuItemConstructorOptions[] = [
  { role: 'appMenu' },
  { role: 'editMenu' },
  {
    label: 'View',
    submenu: [
      { label: 'Zoom In',    accelerator: 'CommandOrControl+Plus',  click: zoom('in') },
      { label: 'Zoom In',    accelerator: 'CommandOrControl+=', visible: false, click: zoom('in') },
      { label: 'Zoom Out',   accelerator: 'CommandOrControl+-',     click: zoom('out') },
      { label: 'Actual Size',accelerator: 'CommandOrControl+0',     click: zoom('reset') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(process.env.CHATTERED_DEV_SERVER
        ? [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]
        : []),
    ],
  },
  { role: 'windowMenu' },
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));
```

`setZoomMode('disabled')` is the precise API (it is stronger than locking `zoomFactor`, which a
later `setZoomLevel` could still move). The hidden duplicate on `CommandOrControl+=` is needed
because ⌘+ on a US layout arrives as `=` without shift.

The renderer listens once and routes to whichever viewer is open — a small
`chrome.ts`-style store field is enough; the PDF viewer already exposes the vocabulary
(`nextZoom`/`prevZoom`, `PdfViewer.svelte:251-259`).

**`webContents 'zoom-changed'` is the wrong hook and should not be used.** Its own typing
(`electron.d.ts:17922-17926`) says *"Emitted when the user is requesting to change the zoom level
using the **mouse wheel**"* — it is the ctrl+wheel path, it only fires when the renderer has
**not** called `preventDefault`, and it carries only `'in' | 'out'`, no magnitude and no cursor
position. It is not macOS double-tap smart zoom; Electron exposes no event for that.

### Mechanic 3 — page turns

**Primary: horizontal two-finger wheel.** Verified deliverable: a dispatched
`deltaX: -140, deltaY: 0` arrived as a `wheel` with `ctrlKey: false`, `deltaMode: 0`,
`cancelable: true`. Because macOS sends momentum for tens of events after the fingers lift, it
has to be latched:

```js
let hAccum = 0, hLatched = false, hIdle: ReturnType<typeof setTimeout> | null = null;

function onwheel(e: WheelEvent): void {
  if (e.ctrlKey) { /* pinch, above */ return; }
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // vertical: let it scroll
  if (scroller!.scrollWidth > scroller!.clientWidth) return; // the page is panned, not turned
  e.preventDefault();
  hAccum += e.deltaX;
  if (!hLatched && Math.abs(hAccum) > 120) {              // ~a deliberate flick
    hLatched = true;
    goTo(currentPage + (hAccum > 0 ? 1 : -1));
  }
  if (hIdle) clearTimeout(hIdle);
  hIdle = setTimeout(() => { hAccum = 0; hLatched = false; }, 220);  // momentum has died
}
```

The latch is the whole trick: without it one flick turns fifteen pages. The
`scrollWidth > clientWidth` guard means that while a page *is* wider than the pane (i.e. while
issue 1 is unfixed, or at manual zoom) horizontal scrolling still pans, which is what the
learner expects.

**Secondary: `BrowserWindow`'s `'swipe'`.** Real, `@platform darwin`, three fingers — but read
its own typing (`electron.d.ts:2520-2532`):

> *"The method underlying this event is built to handle older macOS-style trackpad swiping…
> Most macOS trackpads are not configured to allow this kind of swiping anymore, so in order for
> it to emit properly the **'Swipe between pages' preference in System Preferences > Trackpad >
> More Gestures must be set to 'Swipe with two or three fingers'**."*

That is a per-user system preference the app cannot set, and on a default Mac it is
*"Swipe with two fingers"*, under which this event does **not** fire. So wire it as a bonus, not
as the mechanic:

```ts
win.on('swipe', (_e, direction) => {
  if (direction === 'left' || direction === 'right') {
    win.webContents.send(IPC.pageTurn, direction === 'left' ? 1 : -1);
  }
});
```

> **Could not verify.** Testing `'swipe'` needs real trackpad hardware *and* that preference
> changed; neither is reachable from this harness. Treat the snippet as unverified.

### Mechanic 4 — double-click / smart zoom

There is no Electron event for macOS's two-finger double-tap smart zoom, and `'zoom-changed'` is
not it (above). Do it in the renderer, on the page box, where it is also reachable by mouse:

```svelte
<div class="page" … ondblclick={(e) => { e.preventDefault(); toggleFit(); }}>
```

```js
function toggleFit(): void {
  if (fitMode !== null) { fitMode = null; zoom = 1; }        // Fit → 100 %
  else { fitMode = 'page'; }                                 // 100 % → Fit
  drawn.clear();
}
```

Suppress the text-selection side effect with `user-select: none` on `.page` — a pdf.js canvas
has no text layer today anyway (`STATUS.md`, stage (e), "Stubbed").

### Mechanic 5 — the pdf.js re-render strategy, so a 60-page deck stays smooth

Re-rasterising at 60 fps during a pinch is not possible: one page of the measured A4-landscape
deck is a **2360 × 1670 backing store** and pdf.js takes tens of milliseconds per page. The
standard answer — and the one that matches the ~150 ms idle the brief asks for — is to
**transform what is already on screen, then re-render once the fingers stop**:

```js
// While the gesture runs: pure compositor work, no pdf.js, no allocation.
// `renderedScale` is the scale the bitmaps were rasterised at; `scale` is where the pinch is now.
const gestureScale = $derived(renderedScale > 0 ? scale / renderedScale : 1);
```

```svelte
<div class="pages" style="transform: scale({gestureScale}); transform-origin: 0 0;
                          will-change: {gestureScale === 1 ? 'auto' : 'transform'}">
```

```js
async function reRenderAtFinalScale(): Promise<void> {
  renderedScale = scale;          // page boxes snap to the true size, transform returns to 1
  drawn.clear();
  for (const t of inFlight.values()) t.cancel();
  inFlight.clear();
  // Draw the current page first, then its neighbours; the IntersectionObserver picks up the rest.
  await draw(canvasFor(currentPage), currentPage);
}
```

Four points that matter on a 60-page deck:

1. **Transform a single wrapper, not 60 elements.** One composited layer; per-page transforms
   would give 60 layers and blow the GPU budget that §5.1 shows is already at 900 MB.
2. **`will-change: transform` only during the gesture.** Leaving it on permanently promotes the
   layer forever and costs memory at rest.
3. **Re-render the current page first and let the observer do the rest.** With the eviction fix
   from §5.1 in place, that is ~3 pages of work per settle, not 60.
4. **Do not clear `drawn` on every wheel event.** Clear it once, inside `reRenderAtFinalScale`.
   The upscaled bitmap is blurry for 150 ms, which is the accepted trade and what Preview does.

### Effort and risk

**M** — roughly: 60 lines in `PdfViewer.svelte`, 35 in `main/index.ts`, two new IPC channels
(`app:zoom`, `app:pageTurn`) through `shared/ipc.ts` and the preload allowlist, and a store field
to route them. **Risk: low.** The one genuine regression risk is `preventDefault` on wheel: scope
the handler to `.scroll` inside `PdfViewer` only, never to `window`, or ordinary scrolling in the
thread and the vault tree will start swallowing events.

---

## 5. Other renderer defects found while in there

### 5.1 The PDF viewer never releases a canvas — 901 MB after one read-through. **L, fix first**

`PdfViewer.svelte:59` caches `pageNumber → { canvas, scale }` and only ever grows. Nothing
resets a canvas's backing store when a page scrolls away; `drawn` is cleared on a zoom change
(`:186`) and on document teardown (`:93`), never on scroll.

Measured on `CS4246/Lecture-mdp.pdf` — 60 pages, A4 landscape — window 1320 × 860, dpr 2,
counting only canvases whose backing store is not the 300 × 150 default:

| moment | canvases rasterised | canvas bitmaps |
|---|---|---|
| on open | **2** of 60 | 30.1 MB |
| after scrolling once to the end | **60** of 60 | **901.5 MB** |
| after scrolling back to the top | 60 of 60 | **901.5 MB** |

15.0 MB per page, because each is `2360 × 1670 × 4` bytes: `dpr = Math.min(2, …)` (`:118`)
squares into 4× the CSS area. The lazy *render* works exactly as `app/docs/STATUS.md` claims
("2 of 24 canvases drawn on open") — what is missing is the other half, eviction. A learner who
reads one lecture deck end to end costs the renderer the best part of a gigabyte, and it is
never returned until the document is closed.

**Fix.** In the `IntersectionObserver` callback, handle `!entry.isIntersecting` — currently
`continue` (`:148`) — by releasing anything outside a window of ±3 pages:

```js
function release(pageNumber: number): void {
  const hit = drawn.get(pageNumber);
  if (!hit) return;
  inFlight.get(pageNumber)?.cancel();
  hit.canvas.width = 0;            // frees the backing store immediately
  hit.canvas.height = 0;
  drawn.delete(pageNumber);
}
```

Setting `width = 0` is the reliable release in Chromium; removing the element is not, because
Svelte owns it. Keep ±3 pages so a small scroll does not thrash. Also drop `rootMargin` from
`400px` to `200px` — at fit scale a page is ~1100 px tall, so 400 px eagerly rasterises a
neighbour that is 1100 px away from being looked at.

### 5.2 The page counter lands on an arbitrary page when a document opens. **S**

`PdfViewer.svelte:138-142` documents the rule as *"the page whose top edge is nearest the top of
the viewport is current"*. `:150` implements something else:

```js
if (entry.intersectionRatio > 0.5) currentPage = pageNumber;
```

— whichever entry happens to arrive last in the batch wins. There is no comparison against the
other entries and no "nearest the top" arbitration. On open, the observer's first delivery
arrives while the page boxes are still being sized (`base` is resolved a tick later, `:78-81`),
so several pages report a ratio above the threshold at once.

Measured: four consecutive opens of the same 24-page PDF, each at `scrollTop === 0` with only
page 1 on screen:

```
run 1  counter "1"      run 2  counter "3"      run 3  counter "2"      run 4  counter "2"
```

This is not cosmetic — `store.docPage` is what "Show the room · p. N"
(`DocumentPane.svelte:96-99`) and "Explain p. N →" (`:101-103`) send to the model. The learner
can post page 3 to the group while looking at page 1.

**Fix.** Keep a live map of ratios and pick a winner over the whole set, or — simpler and
correct — compute the current page from geometry on scroll rather than from the observer:

```js
function pickCurrent(): void {
  const top = scroller!.scrollTop;
  let best = 1, bestD = Infinity;
  for (const el of scroller!.querySelectorAll<HTMLElement>('[data-page]')) {
    const d = Math.abs(el.offsetTop - top);
    if (d < bestD) { bestD = d; best = Number(el.dataset.page); }
  }
  currentPage = best;
}
```

on a `scroll` listener rAF-throttled. Leave the observer to do lazy rendering only — one
responsibility each.

### 5.3 The page counter freezes entirely above ~180 % zoom. **S** (same fix as 5.2)

`intersectionRatio` is *intersected area ÷ target area*, so once a page is taller than about
twice the viewport the ratio can never reach the 0.5 threshold and `currentPage` stops updating.

Measured, 24-page A4 paper, viewport height 693 px:

```
at Fit (140 %)   page height 1110 px   max achievable ratio 0.624   → updates
at 300 %         page height 2376 px   max achievable ratio 0.285   → never fires
  scrolled to page 6 → counter still reads "1"
```

So at any zoom above ~180 % the reference the learner sends is pinned to whatever page the
counter froze on. The geometry-based `pickCurrent()` in 5.2 removes the threshold and fixes this
at the same time.

### 5.4 The page-range fields accept anything, including an inverted range. **S**

`PdfViewer.svelte:219-225` binds two bare `<input type="number">` to `pageFrom`/`pageTo`. The
`max={pageCount}` attribute constrains the spinner only, not typed input, and **nothing
validates `from ≤ to`** — not in the renderer, not in `sessionSeed` (`main/ipc.ts:246-261`), and
not in `textFor` (`vault/service.ts:343-357`), which simply filters
`page >= pageFrom && page <= pageTo` and returns `''` for an empty result.

Measured with `docFrom = 9`, `docTo = 3` on a 24-page PDF:

```
CTA label:        "Explain pp. 9–3 →"
pages outlined:   0
```

Pressing it seeds session setup with an **empty** paste box and no explanation of why. The same
range reaches `showDocument` (`main/ipc.ts:386-402`) and would post a reference with no page
text. The two-field design is the resolution `STATUS.md` records between §B2 L230 and
architecture L970, so the fields should stay — they just need semantics:

- clamp both to `[1, pageCount]` on `change`;
- when `pageFrom > pageTo`, swap them (Preview's behaviour) rather than rejecting;
- "Start here" (`:219`) should also push `pageTo` forward if it would be left behind, and
  "End here" (`:225`) pull `pageFrom` back — marking a range should never be able to produce
  an empty one;
- `null` in either field means "the page I am on" (`DocumentPane.svelte:55-58` already falls
  back that way) — make the placeholder say so instead of leaving the box blank.

### 5.5 No scroll restoration, and a stale page survives a close/reopen. **S**

`store.closeDoc()` (`store.svelte.ts:316-323`) drops everything, and `DocumentPane`'s reset
effect (`:36-43`) sets `docPage = 1`. Measured: scroll a PDF to `scrollTop 4000`, close it,
reopen the same file →

```
scrollTop     0      (position lost, expected)
store.docPage 7      (stale, *not* expected — and not 1 either)
```

Two separate problems: the position is not remembered at all, and the 5.2 race then overwrites
the reset with an arbitrary page. Fix 5.2 first; then remember `{ fileId → scrollTop }` in the
store (it already holds `selectedFileId`, `docPage`, `docFrom`, `docTo` for exactly this reason —
`store.svelte.ts:80, 86-93`) and restore it in the `wanted` effect (`:171-181`) alongside the
`pendingPage` jump. `VaultBrowser.svelte:5-8`'s own docstring promises this ("the file they were
last reading, the page they were on and the range they marked are all still there when they open
it again"); it is only true while the pane stays mounted.

### 5.6 The PDF is not keyboard-reachable. **S**

Measured after opening a document: `document.activeElement` is `BODY`, and `.scroll`
(`PdfViewer.svelte:228`) has `tabIndex === -1`. Space, PageDown and the arrow keys therefore do
nothing to the PDF until the learner clicks inside it. `product-design.md` §C10 is explicit
about keyboard reachability. Add `tabindex="0"`, an `aria-label`, and `onkeydown` for
`PageUp`/`PageDown`/`Home`/`End` → `goTo`, and focus the scroller when a document opens. This is
also the prerequisite for the ⌘+/⌘−/⌘0 routing in §4.

### 5.7 `Thread` marks the entire transcript `aria-live="polite"`. **S**

`Thread.svelte:47`. Every DOM change inside it — a new message, the thinking indicator
appearing and disappearing (`:54-56`), the connector heights being written by the `$effect` at
`:22-34` — is re-announced by VoiceOver, and on a long thread the live region re-reads far more
than the new turn. The live region belongs on a small wrapper around *newly appended* messages,
not on the scroll container. Worse, `ThinkingIndicator.svelte:15` declares
`aria-live="polite"` of its own **inside** that region — a nested live region whose elapsed-second
counter (`:25`, derived from the shared 200 ms clock at `:10`) ticks once a second. It should be `aria-live="off"`: a pulsing "thinking…" re-announced every
second is unusable.

### 5.8 `base` is page 1's size, applied to every page. **S**

`PdfViewer.svelte:42-48, 238`. Mixed-geometry PDFs are common in course material — a portrait
cover sheet in front of landscape slides, or an appendix in a different size. Every page box is
sized from page 1, so the wrong-sized pages are laid out at the wrong height and the scroll
position jumps when they finally render. Read each page's own viewport once (cheap —
`getPage(n).getViewport({scale: 1})` needs no rasterisation) and cache `n → {w, h}`, falling back
to page 1 until it arrives.

### 5.9 The default menu ships Reload / Force Reload / DevTools to the learner. **S**

Covered under §4, repeated here because it is a shipping defect independent of gestures: ⌘R in a
live study session reloads the renderer. The room actor and the SQLite state live in the main
process (`main/index.ts:1-7`), so a reload is recoverable, but it will drop the learner into
`screen: 'loading'` mid-round. The `Menu.setApplicationMenu` call in §4 removes it and gates
DevTools behind `CHATTERED_DEV_SERVER`.

---

## Suggested order

1. **5.1** (canvas eviction) — largest user-visible cost, independent of everything else.
2. **1** (fit) + **5.2 / 5.3** (page tracking) — one file, one sitting; 5.2 and 5.3 share a fix
   and they are what make the page references trustworthy.
3. **3** (nav rail merge) — frees the 120 px that issue 2 needs, and removes the `slides_folder`
   first-run dead end.
4. **2** (third pane) — the largest design change; do it after 3 so the width budget works.
5. **4** (gestures) — additive, low risk, nothing else depends on it.
6. **5.4–5.8** as cleanup alongside 2.

## What could not be verified

- **`git pull --ff-only`** — `git` exits 69 on this Mac pending the Xcode licence agreement.
- **Whether ⌘+ today rescales the UI.** The accelerators are confirmed present and bound to
  Electron's zoom roles (enumerated over the accessibility API); clicking those menu items via
  System Events did not move `devicePixelRatio` or `innerWidth` in this harness, so the
  end-to-end behaviour of a real keypress is unconfirmed. It does not change the fix.
- **`BrowserWindow`'s `'swipe'`.** Needs real trackpad hardware *and* System Settings →
  Trackpad → More Gestures → "Swipe between pages" set to "Swipe with two or three fingers".
  Its own typing says it will not fire otherwise.
- **Whether a real trackpad pinch could still reach Chromium's zoom path.** Synthesized pinch
  and ctrl+wheel did not zoom the page with no listener attached, matching
  `electron.d.ts`'s "Visual zoom is disabled by default in Electron", but CDP-synthesized input
  may not traverse the identical browser-process gesture path. Keep `setZoomMode('disabled')`
  until someone confirms on hardware.
- **Anything about the room's three columns under real load.** The room was never opened during
  this review (opening one costs a live Claude CLI round trip); §2's proposal is from the source
  and the Library-state measurements only.

## How to reproduce the measurements

```sh
cd /Users/lohzh/ChatterED/app
env -u ELECTRON_RUN_AS_NODE node node_modules/typescript/lib/tsc.js -p tsconfig.main.json
env -u ELECTRON_RUN_AS_NODE node scripts/copy-assets.mjs
# then start Vite on :5273 and launch Electron with `. --remote-debugging-port=9222`
# (scripts/dev.mjs does all of this except the debugging port)
```

In the renderer, reach the live store over CDP `Runtime.evaluate` with
`await import('/lib/store.svelte.ts')` — note the **`.ts`** specifier: importing
`/lib/store.svelte.js` resolves to a *different* Vite module URL and hands back a second,
unrelated `Store` instance.
