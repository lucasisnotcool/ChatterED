# What segmentation costs — tokens, dollars, milliseconds, megabytes, days

**Question.** `pdf-fidelity-segmentation.md` §C2 specifies one Claude vision call per page at import.
Lucas proposes not running it there. This prices both.

**Answer in one line.** The dollars are irrelevant at every model tier; the deadline, the first-open
latency and the 5-hour window are not — **ship geometry-only for A1, add the vision call lazily and
behind a flag if Days 1–3 allow, never build eager**.

**Headline finding.** `claude -p` **can** do vision, but not the way the repo's CLI client is
written, and **ChatterED's own LLM port cannot represent an image at all**. Details in §1.4.

Date: 2026-09-15. Measurements on this Mac, Claude Code 2.1.259, `claude-haiku-4-5-20251001`.
Read alongside `pdf-fidelity-segmentation.md` §B1.5, §B5, §C2, §C7.

## 0. Assumptions

| | Value | Source |
|---|---|---|
| Image tokens | `w × h / 750` | Anthropic estimate (§B5). **Confirmed here**: a 1333×750 PNG measured **1,310** tokens over a text-only baseline; formula predicts 1,333 (−1.7 %) |
| Slide image, 1568 px long edge | 1568 × 882 = **1,844 tok** | arithmetic |
| A4 page image, 1568 px long edge | 1109 × 1568 = **2,318 tok** | arithmetic |
| Tool schema + instruction | ~400 tok | estimate |
| Enumerated candidate cuts + neighbour text | ~500 tok (slide), ~900 (paper page) | §B5 estimate |
| JSON reply | ~150 tok (slide), ~200 (paper page) | §B5 estimate |
| **Per slide page** | **2,744 in / 150 out** | sum |
| **Per paper page** | **3,618 in / 200 out** | sum |
| Prices ($/MTok in / out) | Haiku 4.5 **1 / 5**; Sonnet 5 **2 / 10**; Opus 5 **5 / 25** | `claude-api` skill, cached 2026-06-24 |

Caching cannot help this call: the stable prefix is ~400 tokens, under every model's minimum
cacheable prefix (512–4096). Batch API halves the price but its turnaround rules it out for anything
a learner waits on.

## 1. Eager mode — segment every page at import

### 1.1–1.2 Tokens and dollars per document

| Document | Calls | Input | Output | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|---|---|---|
| 40-slide deck | 40 | 110 K | 6.0 K | **$0.140** | $0.280 | $0.699 |
| 15-page paper | 15 | 54 K | 3.0 K | **$0.069** | $0.139 | $0.346 |

Stage 0 build-group merge cuts the page count before any of this; 40 is the worst case.

### 1.3 Wall-clock latency

Measured, n=6 CLI calls, 1333×750 image, Haiku 4.5: per-call `duration_ms` 1,666–2,031, API time
1,952–2,416 ms, wall clock with process spawn ~2.5–2.8 s. **Four concurrent `claude` processes
finished in 2.93 s** against 2.81 s for one — parallelism at 4 is essentially free.

Scaled for a 1568-px image and a real JSON reply (~3.0 s/call estimated):

| Document | Sequential | 4-way parallel |
|---|---|---|
| 40-slide deck | **~100–120 s** | **~29–35 s** |
| 15-page paper | ~38–45 s | ~11–14 s |
| 200-page reading | ~10 min | **~2.5 min** |

The API path should be faster (no process spawn, no CLI system prompt): ~1.5–2.5 s/page on Haiku.
Sonnet 5 slower; Opus 5 with thinking, much slower.

### 1.4 The CLI backend — can it do vision? **Yes, but not as written.** ⚠️

Four findings, all verified on this machine today:

1. **There is no `--image` flag.** `--file <file_id:path>` is for Files-API resources, not local
   images — so a naive read of `claude -p --help` says no vision. That read is wrong.
2. **`--input-format stream-json` accepts image content blocks.** Feed stdin a JSON user message
   whose `content` array holds `{"type":"image","source":{"type":"base64","media_type":"image/png",…}}`:
   the model read the slide's title back correctly in **2.52 s**, `--tools ""`, no filesystem access.
   Requires `--output-format stream-json --verbose`.
3. **The `Read`-tool path works and should not be used.** `--allowedTools Read` on a PNG returned the
   right title in **7.06 s** carrying **10,604 cache-creation + 59,209 cache-read tokens** of tool
   definitions — ~9× the payload for the same answer.
4. **The blocker is ChatterED's code, not the CLI.** `argsFor()`
   (`app/src/main/llm/claude-cli.ts:200`) writes the prompt as a **plain string on stdin** with no
   `--input-format`; it must emit a JSON envelope. And `LlmMessage.content` is `string` while
   `CacheableBlock` is `{type:'text'}` only (`app/src/room/llm/types.ts:11–21`) — **the port cannot
   represent an image on any backend**, the API client included. Widening it touches `types.ts`,
   `anthropic.ts`, `claude-cli.ts`, `scripted.ts` and their tests.

**And the number that decides eager vs lazy.** Even with `--tools ""`, every CLI invocation carries
**~6,680 tokens** of Claude Code system prompt (measured: 540 cache-creation + 6,140 cache-read).
Over 40 pages that is **267 K tokens of pure overhead — 2.4× the useful payload** — making a deck
**377 K tokens** on the CLI path against 116 K on the API path. On a subscription that is $0 of cash
but real burn against the 5-hour window, failing invisibly on the evening the video is recorded.
(Secondary: `claude-cli.ts:382` drops cache breakpoints — the CLI path has no prompt caching at all.)

## 2. Lazy mode — geometry now, model on demand

### 2.1 What changes

Import runs stages 0–3 only — build-group merge, geometry, chrome removal, candidate cuts — all pure,
local, in-process, **zero tokens and zero network**. The flow opens at once as one segment per page
with faint proposed-cut ticks. The vision call fires on a "Suggest cuts" click, or as a background
prefetch for visible ± 2.

### 2.2 Savings

| | Calls/deck | Tokens (API) | Haiku | First-open |
|---|---|---|---|---|
| Eager | 40 | 110 K / 6 K | $0.140 | 29–100 s |
| Lazy, on-demand (assume 6 of 40 pages asked) | 6 | 16 K / 0.9 K | **$0.021** | **0 ms** |
| Lazy, prefetch ±2, learner reads 15 pages | 15 | 41 K / 2.3 K | $0.053 | 0 ms |
| Lazy, prefetch ±2, learner reads all 40 | 40 | 110 K / 6 K | $0.140 | 0 ms |

**Honest caveat: prefetch ±2 converges on eager's token cost** for a learner who scrolls the whole
deck — its saving is latency redistribution, not tokens. Only on-demand saves tokens, and that saving
scales linearly with an engagement rate nobody has measured (UNVERIFIED #5).

**UX cost.** First open is free, and the per-page wait (2.5–3.5 s, on the page being looked at,
caused by the learner's own click) is legible in a way a 100 s import bar is not. What is lost is the
hero moment: at import the flow is *not yet a flow*. **Mitigation — "eager head, lazy tail":** segment
the first ~8 pages at import (8 calls ≈ 6 s at 4-way, $0.028 Haiku).

### 2.3 Variant: geometry-only, no model at all

Free, offline, instant, unfailable. Lost:

- **Concept labels.** The text layer gives the slide's *title*, not the *concept* — "KKT conditions
  (2/3)" labels three segments identically, and on a maths slide the title may be glyph soup (§A1.2).
- **Which candidates are real.** Stage 3 gives 2–6 candidates per slide, unranked. Accept all → a
  bullet list becomes five segments; accept none → whole-page segments. **Accept none is the correct
  default**, and is already §C2's fallback.
- **Per-boundary confidence**, so no "review this cut" affordance (§C4).
- **Cross-page grouping** (Slide-Gestalt-style consecutive-slide merging).

What is **not** lost: fidelity (identical — it is the same crop), build-group merge, chrome removal,
split/merge/reorder, AI chat segments. **The entire learner-authorship story survives with no model.**

## 3. Per-segment chat cost

Measured precedent in the repo: one page of the Xu et al. paper is **5,675 characters** of page text
→ `token_count` **2,064** with the topic block, `cache_eligible` **0** against the 4,096 threshold
(`app/docs/STATUS.md`, stage (e)).

| Context option | New tokens/question | Haiku cost | When |
|---|---|---|---|
| (a) Segment text + 2 neighbours | **200** (slide) – **1,500** (paper) | $0.0002–0.0015 | **always** |
| (b) Crop image (½–⅓ page at 1568 px) | **615–922** | ~$0.0009 | when `region_text` is empty or short |
| (c) Whole page image | 1,844 (slide) / 2,318 (paper) | ~$0.002 | only for "how do these halves relate?" |

All three are negligible in dollars. Make the rule mechanical: **(a) always; add (b) when the
segment's `region_text` is below a length floor** — exactly the maths-and-figure case (§A1.1: 97.8 %
of a TikZ slide carries no text), the only case where text context is a lie. Never (c) by default: it
re-introduces the context segmentation exists to remove.

**Caching.** A whole deck's text (~8 K tokens for 40 slides) *would* clear the 4,096 threshold and
cache at 0.1× read — but it must **not** go in `system[0]`. The existing "Show the room" design
deliberately puts `message_refs.page_text` into `messages` **after the last cache breakpoint**,
because a mid-session document touching the prefix invalidates every cached prefix in the room
(asserted in `context.test.ts` and `actor.test.ts`). A cached deck prefix needs its own scope —
`LlmScope` already has `'ingest'` — not the room's. For the room a 200–1,500 token tail per question
is too cheap to be worth the invalidation risk; on the CLI backend it is moot, there are no
breakpoints there at all.

## 4. Memory and CPU on the client

| | Per page | 40-slide deck | 200-page A4 reading |
|---|---|---|---|
| Page canvas, DPR 2 | **8.3 MB** (16:9) / 8.0 MB (A4) | 332 MB if all resident | **1.6 GB** if all resident |
| + crop bitmaps (§B1.5 option 1) | ~2× | ~660 MB | ~3.2 GB |
| **With existing `KEEP_RADIUS = 3`** | ≤7 pages | **~58 MB** page + ~58 MB crops | **same ~116 MB** |

The existing machinery is correct and carries over unchanged: `dpr = Math.min(2, dPR)`,
`IntersectionObserver` with `rootMargin: '200px 0px'`, `release()` setting `width = height = 0`, and
`KEEP_RADIUS = 3` capping residency **independently of document length**. CPU is unchanged — the crop
is a `drawImage` with a source rect, a GPU blit; the page render was already being paid.

**Recommended caps:** (1) keep `KEEP_RADIUS = 3`, do not raise it for the flow; (2) cap total resident
bitmap **bytes** at ~256 MB rather than page count, evicting by distance from `currentPage` — it only
bites for unusually large pages (`MIN_FIT = 0.05` says the viewer expects A1 posters); (3) cap
segments per page at **8**, below which a crop is thinner than a line of text; (4)
`createImageBitmap` + `close()` (§B1.5 option 3) if the byte budget ever bites — not for A1.

## 5. Engineering cost in days

Today 15 Sep, A1 due 22 Sep: **5 build days**, Days 6–7 for record and report (§C7).

| Stage | Eager | Lazy | Geometry-only |
|---|---|---|---|
| 0 build-group merge | 0.5 | 0.5 | 0.5 |
| 1 geometry (text + ink boxes) | 1.0 | 1.0 | 1.0 |
| 2 chrome removal | 0.3 | 0.3 | 0.3 |
| 3 candidate cuts (+ tick rendering for lazy) | 0.5 | 0.7 | 0.7 |
| 4 vision call + cache + schema | **2.0** | **1.5** | **0** |
| 5 flow UI with crops | 1.0 | 1.0 | 1.0 |
| 6 split/merge UI | 0.8 | 0.8 | 0.8 |
| 7 reorder | 0.5 | 0.5 | 0.5 |
| 8 AI segments | 1.0 | 1.0 | 1.0 |
| 9 save-format migration | 0.5 | 0.5 | 0.5 |
| **Total** | **8.1** | **7.8** | **6.3** (4.6 without stage 8) |

Stage 4 decomposed: widen the LLM port for images **0.7 d** (unavoidable either way); `argsFor` +
stdin for `--input-format stream-json` **0.3 d**; prompt, forced tool schema, reply validation
**0.4 d**; SQLite cache on `content_sha` **0.2 d**. **Eager then adds 0.5 d** for an import job queue,
concurrency limiter, backoff, cancel path, progress UI and window-exhaustion recovery — the riskiest
half-day in the table. **Lazy adds 0.3 d** for per-page request state and a prefetch scheduler,
localised to one page.

**What lazy skips or defers:** the import job queue and everything around it; the "import took 100
seconds" progress UI; rate-limit handling at import (lazily, a 429 is one page's ticks missing with a
retry button; eagerly it is a half-segmented document the learner **cannot tell is half-segmented**);
Batch API plumbing.

**Recommended cut line.**
- **Ship for A1** (~4.6 d): stages 0, 1, 2, 3, 5, 6, 7 — geometry-only. The whole learner-authorship
  story, no model in the segmentation path.
- **If Days 1–3 go well** (+1.5 d): stage 4, lazy, on-demand only, flagged, geometry as the fallback.
- **Defer to A2**: prefetch ±2, eager in any form, reflow mode, vertical cuts. **Stage 8 (AI segments)
  makes this ChatterED rather than a PDF splitter** — if something must give for it, give up stage 4.
- **The video**: record the geometry-only path. No network, no window, no 429, nothing to fail on
  camera (§C2: "this fallback must be built first and demoed once"). Cut in one "Suggest cuts" click
  as a second take if stage 4 lands.

## 6. Storage

| Row | Size | 40-slide deck | 200-page reading |
|---|---|---|---|
| Segment (page, 4 floats, label, confidence, order, ids) | 150–250 B | 100 rows ≈ **20 KB** | 400 rows ≈ 80 KB |
| Cached model reply, keyed `(content_sha, page, prompt_version)` | ~600 B | **24 KB** | — |
| Cached request (enumerated cuts, no image) | ~2 KB | 80 KB | — |

**Negligible** — under 0.5 % of the source PDFs, against an `Academia/` already carrying ~30 MB of
them. **Do not store page images**: a 1568-px slide PNG is ~170 KB (measured: the 1333-px render was
167 KB), 6.7 MB per deck, and redundant — pdf.js re-renders in ~50 ms. Render, base64, send, discard.
One rule worth writing down: put `prompt_version` in the cache key, so a prompt change invalidates
cleanly instead of serving stale cuts forever.

## 7. The comparison, and the recommendation

40-slide deck:

| | Eager | Lazy (on-demand) | Lazy (prefetch ±2) | **Geometry-only** |
|---|---|---|---|---|
| Vision calls | 40 | ~6 (assumed) | 15–40 | **0** |
| Tokens/deck, API path | 116 K | 17 K | 43–116 K | **0** |
| Tokens/deck, CLI path (+6.7 K/call) | **377 K** | 56 K | 142–377 K | **0** |
| $/deck — Haiku 4.5 | $0.140 | $0.021 | $0.05–0.14 | **$0** |
| $/deck — Sonnet 5 | $0.280 | $0.042 | $0.11–0.28 | **$0** |
| $/deck — Opus 5 | $0.699 | $0.105 | $0.26–0.70 | **$0** |
| CLI feasible? | Yes, at 377 K tokens of window burn per deck | Yes, comfortably | Marginal | **N/A — nothing to call** |
| First-open latency | **29–100 s** | **0 ms** | **0 ms** | **0 ms** |
| Engineering days | 8.1 | 7.8 | 8.1 | **6.3 / 4.6** |
| Failure visibility | **Bad** — a half-segmented deck looks segmented | **Good** — one page, one retry button | Fair | **Perfect** — nothing can fail |
| Learner-authorship fit | Weak — the machine already decided | **Strong** — learner asks, then edits | Fair — decides quietly ahead | **Strongest** — every cut is the learner's |

**Recommendation.** Ship geometry-only for A1; put the vision call behind a flag as lazy on-demand if
Days 1–3 allow; never build eager. The dollars decide nothing — $0.14 a deck is free, and Opus 5 at
$0.70 is still free. Three other numbers decide it: **0 ms against 29–100 s** of first-open latency;
**4.6 against 8.1 engineering days** inside a week that must also contain a recorded video; and
**377 K CLI tokens per deck** against a usage window that will be at its most fragile on the evening
you record. The fourth reason is not a number: §B5 establishes that concept boundaries have **no
ground truth**, so a confidently pre-cut deck is a confident claim nobody can check, while whole-page
segments with faint tick marks and a "Suggest cuts" button are honest about what is known and put the
learner in the authoring seat. That is the better CUI and the better research instrument — §C8's one
measurable question, *how often does the learner adjust a boundary*, only means anything if the
learner is the one adjusting.

## UNVERIFIED

1. **Prices** from the `claude-api` skill's cached table (2026-06-24), not fetched live.
2. **`w × h / 750`** confirmed to 1.7 % on one 1333×750 PNG, CLI path only — not across aspect
   ratios, not on the API path. The 1568-px long edge and the 1,844-token slide figure are §B5's.
3. **~500 tok of enumerated cuts per slide, ~900 per paper page, ~400 tok tool schema** are estimates;
   Stage 3 is not built, so there is nothing to count.
4. **"~6 of 40 pages asked"** in the lazy column has no data behind it and the entire lazy saving
   scales linearly with it — **the single number most likely to be wrong.** Measurable the moment
   Stage 3 ships; log it from Day 3 beside the boundary-adjustment rate (§C8).
5. **Latency**: n=6, this Mac and network, Haiku 4.5, CLI path, 1333-px image, trivial reply. Not
   measured: the API path, Sonnet 5, Opus 5, a 1568-px image, a real forced-tool reply, or a loaded
   5-hour window. The 3.0 s/call scaling factor is a guess.
6. **The CLI's own `total_cost_usd`** ($0.0057/image call) is ~1.7× my rate-card figure ($0.0033),
   unreconciled. Every dollar here is computed from the rate card.
7. **4-way parallelism** near-free; 8- and 16-way untested, and the rate limiter's behaviour under a
   real 40-call burst is unknown.
8. **~58 MB at `KEEP_RADIUS = 3`**, 8.0 MB/page A4 and 1.6 GB for 200 pages are arithmetic from
   §B1.5's 8.3 MB/page, not measured heaps.
9. **Engineering days are judgement.** Three most likely wrong: the port widening (0.7 d — four files
   and their tests), ink-box geometry (in Stage 1), split/merge on crops (0.8 d).
10. Whether `--input-format stream-json` image input **counts against the subscription window** as
    interactive use does — assumed, not verified.
11. **Chromium canvas limits** in this Electron version (carried over from §B1.5).
