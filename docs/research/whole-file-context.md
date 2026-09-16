# Whole-file context: why "summarise what I will be learning" fails, and what to do

*2026-09-16. Lucas's report, using build 102 on CS4246 `Lecture-complex v4.0.pdf` (58 pages): the model
"does not have context from whole file". Analysed across the system: what the model is given, what it
can do with it, what it costs, and what the interface offers.*

## 1. What the model is given today (measured)

| Path | Context | Size on this deck | Source |
|---|---|---|---|
| REFERENCE (Ask here) | the segment's **page** text only, plus the deck title | 1.7–3.8 K chars system, ~40 chars prompt | `flowroom.ts#segmentText`, `prompts.reference.ts` |
| Teacher / Tester thread | the frozen room prefix: the material's `extracted_text`, the concept pack, role block; then the thread | **15 K chars system** of which the material is **5,724 chars** | `context.group.ts`, `materials` row |
| Concept ingest (first Ask on a deck) | the same 5,724 chars | one 37 s Sonnet call on the CLI | `sessions.ts#draftConcept` |
| The deck itself | 58 pages, **27,948 chars** in the FTS index (≈ 7 K tokens) | | `file_text` |

Two defects, both mechanical:

1. **The material is capped to ~20 % of the deck.** `vault.textFor()` applies `REFERENCE_TEXT_CAP`
   (the per-*selection* character cap from issue #22 decision 4, a UI promise for pasted ranges) to the
   whole-deck material the flow room creates for pages 1–N. Whole-deck context was never truncated by
   design; it was truncated by reuse of the wrong helper.
2. **The concept pack is the fixture's.** The room was created while the backend was `scripted`, so it
   received the fixed PSD/Hessian pack (`pack_provenance = fixed`); switching to the live CLI kept it.
   The Teacher's prompt and the ledger have been scoring a planning deck against convexity claims.

## 2. What the model can do with a whole deck

A slide deck is small text. This one is ≈ 7 K tokens; the largest deck in the local corpus
(`segmentation-genres.md`) is under 20 K; a 200-page reading is ≈ 60–80 K. Every model on offer takes
200 K. So for decks the question is not *retrieval* but *what to put in the cached prefix*:

- **Sonnet 5 / Haiku 4.5 summarise 7 K tokens accurately** and can answer "what will I learn" from
  the deck's headings alone. Accuracy limits appear only for maths glyph soup (`pdf-fidelity-segmentation.md`
  §A1.2) — the model summarises what the text layer says, and `∑` is `P` there. The segmentation
  labels (one per crop, from the slide titles) are a cleaner outline than the raw text.
- **The API path caches the prefix**: the deck in `system[0]` behind a breakpoint costs full price once
  and 10 % after. **The CLI path drops cache breakpoints** (`segmentation-cost.md` §1.4) and adds
  ~6.7 K tokens of its own system prompt per call, so a 7 K-token deck in every call is 14 K tokens per
  turn — acceptable on a subscription, and still far below the 20 s the orchestrator used to cost.
- **Latency scales with output, not input**: the 37 s ingest is 2.9 K chars of reasoning + JSON out of
  Sonnet; input size barely matters. Haiku for ingest, or fewer output tokens, is the lever.

## 3. What the interface offers — and does not

Every question is anchored to a segment. A deck-level question ("what will I learn", "how does p. 40
relate to p. 12") has **nowhere to go**: the learner asks it under whatever card is nearest, and the
REFERENCE path answers from that page. The system does not know the question's *scope*.

## 4. Recommendation (whole of system)

1. **Fix the cap.** The flow room's material is the whole deck text (no `REFERENCE_TEXT_CAP`); keep the
   cap for pasted selections only. Store the outline (segment labels with page numbers) alongside.
2. **Fix the pack.** A room created in scripted mode on a non-fixture deck gets *no* pack until a live
   ingest runs; switching backends on an open room re-drafts the pack in the background and swaps it
   at the next turn. The fixture pack is bound to the fixture deck only.
3. **Three scopes, chosen by the learner and guessed by a rule:** *this segment* (default under a
   card), *this deck* (a new "Ask about this deck" line at the top of the flow, and a chip on any
   Ask), *the topic* (the promoted folder, A2). A cheap classifier — deck-level verbs ("summarise",
   "overview", "what will I learn", "outline", "across") or no anchor — sets the scope when the
   learner does not. Deck scope sends the outline + full text; segment scope sends the page + the
   outline (so a page question can still say where it sits).
4. **The prefix carries the deck on both paths.** API: behind the breakpoint. CLI: every call — the
   cost is measured above and is fine for slides; for readings over ~40 K tokens, fall back to the
   outline + FTS5 top-k pages (the index exists) and say so in the log.
5. **Ingest off the critical path, and cheaper.** The first Ask answers immediately (REFERENCE needs
   no pack); the pack drafts in the background on Haiku from the outline + text and is swapped in when
   ready; the ledger uses Haiku with a short prompt and never runs concurrently with the reply's CLI
   process (serialise `claude` invocations; the "exited 1, no output" failure was two at once).
6. **Say what the model saw.** Each AI card's footer already shows model and timings; add the scope
   ("p. 14" / "whole deck" / "p. 12–14 + outline") so the learner can tell why an answer is narrow.

## 5. Not recommended

- Vector retrieval for decks — nothing to retrieve from at 7 K tokens; adds a dependency and a failure
  mode. Revisit only for readings.
- The vision path for context — the text layer plus the outline answers "what will I learn"; images
  are for boundaries (#26), not for summaries.
