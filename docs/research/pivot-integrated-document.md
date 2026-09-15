# ChatterED — the integrated-document pivot

**Status:** decision document, written 15 Sep 2026, seven days before the A1 deadline
(22 Sep 2026, 23:59). Written for the person making the pivot call this week.

**Inputs:** `Academia/New Idea/CS3249 Revised Idea.md` (Lucas's revised direction, unfinished);
Houde et al. 2025, *Controlling AI Agent Participation in Group Conversations* (arXiv 2501.17258,
IUI '25) via `Academia/Sources/_text/koala-2501.17258.txt`; `docs/research/design-brief.md`
§D–§F; `docs/research/product-design.md` §A–§C; `docs/research/progress-tracking.md` §1–§3;
`docs/research/competitor-notes.md`; `docs/research/ui-review-ux.md`; `app/docs/STATUS.md`;
`Academia/Sources/_text/assignment1-brief.txt`.

**The one-line answer**, stated first so the rest can be read as argument:
*the pivot is right, item (1) as written is wrong, and the cheapest correct version of the
pivot is a rendering change to a surface that already works.*

## Contents

- [A. What "conversation inside the document" means](#a-what-conversation-inside-the-document-means)
- [B. Koala (Houde et al. 2025) — summary and what to borrow](#b-koala-houde-et-al-2025--summary-and-what-to-borrow)
- [C. Prior art](#c-prior-art)
- [D. PDF → modifiable, high-fidelity, state-saving: four approaches](#d-pdf--modifiable-high-fidelity-state-saving-four-approaches)
- [E. The existing mechanics, relocated into the document](#e-the-existing-mechanics-relocated-into-the-document)
- [F. Rubric fit](#f-rubric-fit)
- [G. Recommendation: A1 MVP, A2 build, and the no-pivot alternative](#g-recommendation-a1-mvp-a2-build-and-the-no-pivot-alternative)
- [H. Open questions for Lucas](#h-open-questions-for-lucas)

---

## A. What "conversation inside the document" means

### A0. The claim, restated

Today ChatterED is a *chat that references a document*: `Show the room · p. 3` posts a learner
message whose body is `Look at this — <file>, p. 3.` and attaches the page text on a
`message_refs` row (`app/docs/STATUS.md`, issue #22 stage (e)). The document is an argument the
conversation cites. The transcript is the artefact; the PDF is an exhibit.

The revised idea inverts that. The **document becomes the transcript**. A conversational turn is
no longer a row in a thread with a timestamp; it is a *persistent, addressed object living at a
position in the document*. The document is the artefact; the conversation is a layer of it. Close
the app, reopen the file, and the argument you had about the middle of page 4 is still in the
middle of page 4.

Three consequences follow, and they are the whole design:

1. **The selection is the addressing act.** In a chat you must say *what* you are talking about
   ("in the second bullet on the slide…"). In a document you point. The learner's act of
   selecting a passage supplies the referent, the scope and the retrieval context in one gesture,
   for free, with no prose. This is the primitive that makes the pivot worth doing — and note it
   is already a *turn* under the assignment's own CUI definition, which counts what the learner
   "says, **does**, or **provides**" (`assignment1-brief.txt`, "What counts as a CUI?").
2. **Insertion is the reply channel.** An agent turn does not scroll away. It lands somewhere and
   stays. That buys permanence and spatial memory, and it costs the two things a linear
   transcript gives you for nothing: a single floor, and a legible order of who spoke when
   (§E).
3. **Saving the document saves the conversation.** State is not a session that ends; it is a file
   that accumulates. This is the "state saving" line in item (0), and it is a bigger change than
   it looks — ChatterED's whisper channel is currently specified to *clear at the end of a round*
   (`design-brief.md` §D5, Dennis et al.'s ephemerality). A document that saves everything and a
   channel defined by forgetting are in direct contradiction. Flagged in §H.

### A1. The interaction primitives it implies

| Primitive | Gesture | What is created | Why it matters here |
|---|---|---|---|
| **Anchor** | Select a passage / drag a box on a page | An anchor record: `{file, content hash, page, quote or rect, prefix/suffix}` | The referent for every subsequent turn. All state hangs off this. See §D for how it survives the file changing. |
| **Insert** | Ask, and the answer lands at the anchor | A note block in the flow or the margin | The thing Lucas's item (1) describes. Also the thing that most needs a pedagogical guard (§F). |
| **Margin thread** | Expand a note | An ordered, multi-turn exchange scoped to one anchor | **This is where the CUI lives.** A thread, not a note, is what makes the pivot rubric-legal. |
| **Agent annotation** | No gesture — the agent writes unprompted | A note the learner did not ask for | Koala's entire subject: *when*, *what*, *where*, and who may say no (§B). |
| **Layer** | Toggle a view | A set of notes shown or hidden (mine · shared · private · agent) | Carries the whisper channel, and carries the "is this a chorus?" safeguard (§E). |
| **Coverage** | No gesture — derived | A per-anchor state glyph in the gutter | The Explanation Ledger, re-projected onto the page. The strongest single win of the pivot (§E). |
| **Persist** | ⌘S, or implicitly | The sidecar record | Item (0). See §D for the format argument. |

### A2. Items (2)–(6), continuing Lucas's list

Lucas's list gives (0) the format requirement and (1) *Ask question*. Following the same
pattern — a gesture on a selection that produces a persistent object in the document — here are
the five that the rest of this document assumes, ordered so that each is a superset of the last.
One sentence each, as written for the idea file:

> **2. Explain this** — select a portion of the document and type or speak *your own* explanation
> of it, which is inserted as your callout anchored to that passage and becomes the thing the
> agents respond to.
>
> **3. Get challenged** — Max reads what you inserted and pins a single Socratic probe as a
> sticky note on the exact clause he doubts, which you answer in place.
>
> **4. Open a margin thread** — any anchored note expands into a running, turn-taking exchange
> with Ellie and Max beside the passage, and the document scrolls with it.
>
> **5. Ask privately** — a private note layer, visible only to you and one agent, where the
> question that feels too basic to write in the shared margin can be asked, and promoted to the
> shared margin later with your name or theirs on it.
>
> **6. Teach this page** — when every claim on a page has been defended, the page offers a
> teach-back block where you explain the whole page to Theo, and the page is marked *taught*.

A seventh, which is a view rather than an interaction and should be described as such:
**coverage** — the document's gutter shows, per passage, whether you have *stated*, *justified* or
*defended* it, so the thing you have only read is visibly different from the thing you have
defended.

### A3. The ordering is a pedagogical argument, not a backlog

(1) is the only item on the list where **the system produces the understanding and the learner
receives it**. (2)–(6) are all items where the learner produces and the system responds. The
project's entire evidentiary basis — the chosen difficulty is *uncritical use of AI output*
(`design-brief.md` §C), and DG1 is "make the learner produce justification, not answers" — says
that (1) is the disease and (2)–(6) are the treatment.

So: **(1) is the entry gesture, not the interaction.** Ship it because it is the honest reason a
student opens the app (they want to know what a Hermitian operator is), then make the answer
arrive in a form that hands the work back: an inserted answer that ends by asking the learner to
restate it, and a ledger row that stays at ○ *Stated* until they do. If item (1) is demonstrated
on video as the core interaction, the report is arguing against its own design goal. This is the
single most consequential sentence in this document.

Two independent pieces of external evidence say the same thing, and both are 2025–26 (§C16, §C17).
Joshi & Vogel's CHI 2026 study of AI margin notes found that **lower degrees of AI involvement
produced stronger psychological ownership**, and that participants **preferred selecting the text
themselves** over having the AI choose it. Fang et al. found that **multi-agent** in-situ exchanges
during reading produced more active engagement and more comparing of perspectives than a single
agent, and that agent-mediated exchange significantly improved critical-thinking scores. The
ordering above is not just internally consistent with DG1 — it is the ordering the literature
supports.

---

## B. Koala (Houde et al. 2025) — summary and what to borrow

### B1. Summary (278 words)

Houde, Brimijoin, Muller, Ross, Silva Moran, Gonzalez, Kunde, Foreman and Weisz (IBM Research),
*Controlling AI Agent Participation in Group Conversations: A Human-Centered Approach*, IUI '25,
arXiv:2501.17258v1, DOI [10.1145/3708359.3712089](https://doi.org/10.1145/3708359.3712089).
Local text: `Academia/Sources/_text/koala-2501.17258.txt`.

**It is not a document paper.** It is the missing citation for ChatterED's *orchestrator*.

The team built **Koala**, an LLM agent that participates in group brainstorming as a Slack bot,
and ran two studies with 18 IBM employees in six pre-existing groups of three (14 returned for
Study 2; ~1 h sessions, $25). Study 1 compared no Koala, a **reactive** Koala (replies only when
addressed) and a **proactive** Koala (decides for itself when to speak). Participants valued
having an agent in the group and liked its ideas — and **13 of 18 (72.2%) preferred the reactive
variant**. The proactive one was distracting, intrusive and overwhelming: it "jumped in at the
wrong times, wrote too much, responded too frequently". P6.2: *"Koala dominated the conversation.
It felt like a pedantic student who wouldn't create space for others to participate."*

For Study 2 they built **Koala II** plus a control panel operable by any group member:
proactive/reactive toggle; a **contribution threshold** (the agent scores its own candidate reply
0–100 and only posts above 90/75/50); **where** to post (channel vs thread); and truncation of
long messages into a thread. Behaviour improved and the controls were rated useful — but
participants who *predicted* threading would reduce distraction found, having tried it, that it
**detracted from their ability to collaborate**.

The contribution is a **taxonomy of controls** (Fig. 7): the aspects to control — **when**,
**what**, **where** — and the ways to control them — **how specified**, **who has access**, **how
implemented**. Its framing claim is that proactivity is not fixed at design time; users must be
able to retune it *during* the interaction.

### B2. Why it is relevant

Three reasons, in descending order of usefulness to the report.

1. **It is external, peer-reviewed validation of ChatterED's core engineering bet.** Koala's own
   self-scoring "decision-making quality was poor. We resorted to using external decision logic
   on Koala-scored responses to improve its overall behavior" (§7.2.6). ChatterED already does
   exactly this: `src/room/orchestrator.ts` runs **deterministic rules first** (anti-dog-pile,
   Peer-only silence fills, last word, the S2 disagreement quota) and consults the model **only
   when the rules have not decided** (`app/docs/STATUS.md`). That is one sentence in the report
   and it converts an implementation detail into a defended design decision.
2. **It supplies the empirical case for the silence timer's controls.** The "ask for permission
   instead of jumping in" suggestion (P6.2, §7.2.1) and "hold off contributing while others are
   typing" (P6.1) are, respectively, ChatterED's **Wait for me** and the **typing-only pause**.
   Those were designer instincts; they are now cited findings.
3. **Under the pivot it becomes the governing framework for the hardest new question: *where*
   may an agent write in my document.** Koala only had two locations (channel, thread) and still
   found that the intuitive answer was wrong. A document has a dozen.

### B3. The taxonomy mapped onto ChatterED as built

| Koala cell | ChatterED today | Verdict |
|---|---|---|
| **When — trigger events** | Orchestrator rules + Sonnet decision; 8 s floor-yield window after every learner message; silence timer at 45 s / 90 s, ≤2 fires per round, typing-aware | **Ahead of Koala.** Koala had one threshold; ChatterED has an event model. |
| **When — filters / threshold** | Rules are hard gates, not a score. No learner-visible threshold. | Partial. There is no "be less chatty" dial. |
| **When — rate** | Latency floors per role (Challenger 9–12 s, Peer 4–6 s, whisper 1–2 s), cancellable by a learner message | **Ahead.** And disclosed, per P3. |
| **What — content** | Persona contracts + hard bans (never supplies the target explanation); S2 disagreement quota; S3 banned cohesion cues; S4 hedging | **Ahead on bans, absent on learner control.** |
| **What — style / length** | Nothing learner-operable. No verbosity, tone, or "consolidate into one reply". | **Gap.** Koala's participants asked for min/max length, tone, enthusiasm, bullets, and consolidation. |
| **Where** | One location (the group thread) plus the whisper pane | **Trivial today, explosive under the pivot.** §B4. |
| **How specified** | A Settings screen carrying backend and model choice only; the Pacing group is unbuilt (`ui-review-ux.md` M12) | **Gap.** No natural-language steering ("be quieter"), no confirmation of interpretation. |
| **Who has access** | Single-learner app — trivially the learner | Not a gap *for people*; becomes a gap *for regions* under the pivot. |
| **How implemented** | Rules-then-model, exactly Koala's own resolution | **Ahead.** Cite it. |

### B4. What to borrow, specifically

**(a) The "where" cell is the pivot's design brief.** Koala's cautionary result — participants
predicted threads would help and then found threads *hurt collaboration* — transfers directly:
**margin notes are threads**. A margin that collapses every exchange into a numbered pin the
learner must click is the same mistake. Default to a **visible shared margin column**, not
collapsed pins, and make collapsing a control rather than a default.

**(b) A contribution threshold, but spatial.** Koala's 0–100 score gates *whether* to speak.
Under the pivot, the same score should gate *whether this passage is worth annotating at all* —
otherwise a 24-page PDF acquires 24 pages of margin. Ship a **density cap** (at most one
unsolicited agent note per passage, at most N per visible page) as external logic, not as a
prompt instruction; Koala's §7.2.6 is the evidence that a prompt will not hold this line.

**(c) Learner-operable controls ChatterED does not have and should add under the pivot.** In
priority order, cheapest first:

1. **Per-agent mute, per-document** — "Max, not on this file." (Koala's proactive/reactive
   toggle, per-agent.)
2. **A quiet / normal / active dial** — one three-way control over unsolicited annotation rate.
   Koala's 90/75/50 threshold, given a learner-legible name.
3. **Reject a note** — one click removes an agent annotation and is logged as a finding. Koala
   had no such gesture; the "where" problem makes one mandatory, because a note in the wrong
   place is now *litter*, not a scrolled-past message.
4. **Region permission** — the ability to mark a region (or the learner's own inserted
   explanation) **no-annotate**. This is Koala's *who has access* cell relocated from people to
   places, and it is the genuinely new cell the pivot needs. The learner's own explanation is
   precisely the text that must not be silently corrected.
5. **Length cap on inserted content** — Koala's truncation control. In a document this is not a
   comfort feature: an 800-word inserted answer *moves the page*.
6. **Natural-language steering with a confirmation** — "be quieter" typed into any thread,
   answered by a one-line confirmation of how it was interpreted. Koala's participants wanted it
   (P2.1) *and* doubted it would work (P2.3: "It's hard to confirm if Koala is understanding what
   we said"); the confirmation line is the fix the paper itself proposes (§7.2.4).

**(d) What *not* to borrow.** Koala's default was proactive and its participants hated it. The
temptation under the pivot — "the agents pre-annotate the paper before you read it" — is a demo
that will look magical for ten seconds and then reproduce P6.2's "pedantic student" verbatim.
**Do not ship pre-annotation.** The learner's selection opens the conversation; agents write
unprompted only where the learner has already been (see §E, silence timer).

---

## C. Prior art

Verified by web search on 15 Sep 2026 unless marked **UNVERIFIED**. Every entry answers the same
four questions: what the in-document interaction is, how state is stored, what it lacks against
*a multi-agent group conversation living inside the document*, and where the claim comes from.

### C0. The headline, before the catalogue

**Every shipped system falls into exactly one of two buckets, and none does both.**

- **Conversation, no document object** — Acrobat AI Assistant, NotebookLM, SciSpace, Explainpaper,
  Humata, ChatDOC, Cursor ⌘K. The answer is transient; what goes *back* into the document is a
  citation pointer, not an object.
- **Document object, no conversation** — Notion AI, Copilot in Word, Gemini in Docs, Lex,
  Scholarcy. The *artifact* is inserted and then becomes indistinguishable from human-written
  text; the question that produced it, the reasoning, and the provenance all evaporate at the
  moment of **Accept**.

Nobody ships *"the thread is the object, anchored at a passage, containing more than one agent and
the human, persisted with the document."* The closest shipped approximation is Hypothesis's
threaded anchored annotations (no AI at all) plus Readwise Ghostreader's save-to-note (which is
document-level, not passage-level).

This is a **stronger and better-evidenced novelty claim than the one currently in
`competitor-notes.md`**, and it survives the two nearest research systems (C16, C17), which have
each validated one half of it.

### C1–C15. Products

| # | System | (a) In-document interaction | (b) State storage | (c) What it lacks |
|---|---|---|---|---|
| **1** | **Adobe Acrobat AI Assistant / Generative Summary** ([helpx](https://helpx.adobe.com/acrobat/desktop/use-acrobat-ai/generative-ai-features/ai-get-answers.html), [announcement](https://news.adobe.com/news/news-details/2024/adobe-brings-conversational-ai-to-trillions-of-pdfs-with-the-new-ai-assistant-in-reader-and-acrobat)) | Right-hand **side panel** chat; you may scope it to a selection. The interesting direction is the reverse: answers carry numbered attribution citations, and clicking one **scrolls to and highlights the source sentence in the PDF** ("custom attribution engine"). Nothing is inserted. | **Cloud chat history keyed to the document**, re-shown as a "conversation timeline" on reopen. Nothing written to the PDF's `/Annots`. Citation anchoring internal, **UNVERIFIED** whether persisted or recomputed. | Any writable in-document object; multiple agents; branching threads; portability — the answers do not travel with the file. |
| **2** | **Hypothes.is** — *the anchoring reference implementation* ([W3C model](https://www.w3.org/TR/annotation-model/), [fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/), [pdf.ts](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/pdf.ts)) | Select → a **persistent highlight in the page** plus a sidebar card that is a first-class annotation with **threaded replies**. Object in the document, discussion in the margin. No AI. | **Sidecar cloud DB + a redundant selector array.** For PDF it stores exactly `[TextPositionSelector, TextQuoteSelector, PageSelector]`; `PageSelector` (`{index, label}`) is a **Hypothesis extension, not W3C**. `TextPositionSelector` offsets are **global across the document**, `getPageOffset(page) + offsetInTextLayer`. A **`ShapeSelector`** (rect or point, coordinates normalised 0–1 to the page box, `anchor:'page'`) handles figures and equations with no extractable text. Failure ⇒ a visible **orphan**, never a deletion. | Any AI or agent whatsoever; generated content; document-level shared state. **It is the missing half, and the half ChatterED already has.** |
| **3** | **Explainpaper** ([site](https://www.explainpaper.com/)) | Highlight any word/sentence/paragraph in the uploaded PDF → explanation in a **side column**, with follow-ups and a selectable explanation depth. Selection-scoped; not inserted. | Cloud, per upload. Persistence across sessions **UNVERIFIED**; believed a simple server-side store, no W3C selectors. | Insertion; persistent anchored objects; multi-agent; and — the pedagogical point — it explains *to* you, which is the difficulty ChatterED treats. |
| **4** | **SciSpace Copilot** (ex-Typeset) ([chat-pdf](https://scispace.com/chat-pdf), [highlighting](https://scispace.com/help/en/articles/10750976-how-to-highlight-text-in-chat-with-pdf)) | Highlight text, a table, or an equation (a "∑" affordance) → **Explain** → answer in the right pane. Highlights **are** persisted objects, and citations jump back to the PDF location. | Cloud workspace per paper; selector model **UNVERIFIED**, believed page + internal offsets. | Writing into the document; threads; roles. The answer is chat, not a document artefact. |
| **5** | **Google NotebookLM** ([overview](https://en.wikipedia.org/wiki/NotebookLM)) | Chat panel; every answer carries **inline numbered citations that open the source passage**, page-numbered. **Save to note** creates a note object — but in the notebook, **not anchored into the source**. 2026 additions are Studio-side artefact generation with editing (slides, infographics, quizzes) — editing of *AI output*, still not editing in source. | Fully cloud; sources are read-only uploads. No writable anchor into a source. | Writing back into a source; margin threads; per-passage conversation; multiple distinct agents. |
| **6** | **Notion AI inline / Notion 3.0 Agents** ([3.0](https://www.notion.com/blog/introducing-notion-3-0), [releases](https://www.notion.com/releases/2025-09-18)) | **The closest mainstream match to "output lands in the doc."** Highlight text or press space on an empty line → AI menu → generated text **inserted as blocks**, accept/discard. Notion 3.0 (18 Sep 2025) added Agents doing up to 20 min of autonomous multi-step work; Custom Agents GA 4 May 2026. | **Embedded in the block model** in the cloud. After acceptance the output is an ordinary block, indistinguishable from human text. **No anchor layer; provenance is lost on accept.** | **The conversation is not a document object.** You keep the artefact, not the thread. No per-passage margin thread; agents act *on* the page rather than converse *in* it. |
| **7** | **Google Docs — Gemini "Help me write", and comments/suggestions as an anchoring model** ([help](https://support.google.com/docs/answer/13447609), [Apr 2026 update](https://workspaceupdates.googleblog.com/2026/04/new-gemini-capabilities-in-google-docs-help-you-go-from-blank-page-to-brilliance.html), [Drive comments](https://developers.google.com/drive/web/manage-comments)) | Two patterns. (1) Select → prompt → Gemini's edits appear **as inline suggested edits**, private until Accept/Reject — the strongest shipped "AI output in the doc with an accept gate". (2) **Comments anchored to a `{startIndex, endIndex}` range that the editor shifts on every edit** — the model to envy. | Cloud. **A practical trap worth knowing:** the editor's own anchor format is the undocumented `kix.*`; the Drive API's `comments.create` accepts an `anchor` field and **the Docs editor ignores it**, rendering the comment unanchored. Named ranges are the community workaround. | Multi-agent; and the AI turn is ephemeral — an accepted suggestion leaves no thread. No agent participates in a comment thread as a peer. |
| **8** | **Cursor ⌘K / GitHub Copilot inline chat** — *the interaction pattern* ([comparison](https://www.builder.io/blog/cursor-vs-github-copilot)) | The canonical in-artifact primitive: place the cursor or **select a region → a prompt box opens at that location → the result renders as an inline diff in place, with Accept/Reject.** Context is the selection plus its surroundings. | **None.** The box closes on accept and the conversation is gone. | Persistence, anchoring, multiple participants, revisitability. **Its strength is the gesture to steal:** invoke at point → preview as diff → accept or reject. *The accept gate is what makes in-document AI insertion tolerable*, and item (1) needs one. |
| **9** | **LiquidText** ([features](https://www.liquidtext.net/features)) | Not AI. Document pane plus an infinite canvas; drag excerpts out and they **keep a live two-way link to their source location**; draw explicit connections between excerpts and your notes. The thinking lives *beside* the document, *bound* to it. | Proprietary **`.ltproj`** bundle (documents + annotations + highlights + connections); export to annotated PDF or Word. Anchor model internal, **UNVERIFIED**. | Any LLM or agent; generated text; threads. **Precedent for a bundle format** — see §D6. |
| **10** | **MarginNote 4** ([manual](https://manual.marginnote.com.cn/mn4/en/), [App Store](https://apps.apple.com/us/app/marginnote-4-ai-notes-mindmap/id1531657269)) | "Card Axis": one excerpt is simultaneously a PDF highlight, a mind-map node and a flashcard. MN4 adds "AI Notes"; **what it writes and where is UNVERIFIED**, believed to generate card/summary content attached to excerpts. | **Local SQLite sidecar** (`MarginNotes.sqlite`) holding annotations, notes and mind maps; iCloud sync. Third-party tools read it directly. | Conversation; multiple agents; threads. The AI is a content generator, not an interlocutor. **Direct precedent for ChatterED's SQLite-sidecar recommendation.** |
| **11** | **Readwise Reader "Ghostreader"** ([overview](https://docs.readwise.io/reader/guides/ghostreader/overview), [chat](https://docs.readwise.io/reader/guides/ghostreader/chat)) | Closest shipped thing to "the answer becomes part of the document". Select → `G` for preset prompts on the selection, `⇧G` for the whole document; responses now land in a Chat pane, but a notebook icon **saves a response to the document note**, which syncs alongside your highlights. Ghostreader can also be asked to **highlight a passage** itself. | Readwise cloud: document notes + highlights, synced onward to Obsidian/Notion. Selector details **UNVERIFIED**. | The saved answer attaches to the **document**, not to the passage that provoked it. No margin thread; one agent; no multi-turn exchange persisted at a location. |
| **12** | **Zotero 7 annotations** ([rationale](https://www.zotero.org/support/kb/annotations_in_database)) | Native PDF reader; select → highlight/underline/note/area-image, shown in-page and in a sidebar. No AI. | **Deliberately a sidecar DB, not the PDF** — `zotero.sqlite`, table `itemAnnotations`. Zotero publishes its reasoning: sync only the changed record rather than re-transferring the PDF and risking file conflicts, and enable tags and cross-library filtering. **"Export PDF…" embeds annotations as standard PDF annotations** as a one-way publish step. | AI, conversation, generated content. **Cite this entry in the report:** it is the clearest public argument for why the sidecar is the store and PDF embedding is an export. |
| **13** | **Apple Preview / PDFKit** ([PDFAnnotation](https://developer.apple.com/documentation/pdfkit/pdfannotation)) | Markup toolbar: highlight, underline, strikeout, notes, shapes, text boxes. Human annotation only. | **In the file format.** `PDFAnnotation` maps to PDF `/Annot` dictionaries; text-markup annotations carry `/QuadPoints` — **page-space geometry, not text anchoring**, which is why they break under re-render or re-OCR. | Everything AI, and text robustness. **This is why an `/Annot`-only design is a trap** for a conversational system, and why Zotero, Hypothesis and MarginNote all keep sidecars. |
| **14** | **Microsoft Copilot in Word** ([Draft with Copilot](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/revamp-and-refine-selected-text-using-draft-with-copilot-in-word/4227483), [overview](https://support.microsoft.com/en-us/office/welcome-to-copilot-in-word-2135e85f-a467-463b-b2f0-c51a46d625d1)) | Draft with Copilot on a blank line or on selected text writes **into the document body** with accept/discard; rewrite/tone/condense on a selection; `@`-mention to reference other files; **inline citations in the inline canvas** naming which source a passage came from (GA on Word desktop, Aug 2025). Copilot can summarise comments but **does not participate in comment threads** as a shipped feature (**UNVERIFIED** for any 2026 build). | Inserted content becomes ordinary OOXML in the `.docx`; citation provenance is rendered content, not a durable anchored object (**UNVERIFIED**). Chat history is cloud-side. | The thread as an object; multi-agent; agent-in-comment. Same failure as Notion: **the artefact survives, the conversation evaporates.** |
| **15** | **2025–26 AI-native document products** | **Lex** (by Every): `+++` on a new line **opens a prompt exactly where you are writing** and generates in place; AI feedback appears as **line-level suggestions highlighted inline**, not in a panel ([review](https://www.buildfastwithai.com/ai-tools/lex), secondary source). **Anara** (ex-Unriddle): an explicit *"in-document writing layer"* — annotations, highlights and AI summaries on the source, with passage-level citations and in-place citation suggestions ([listing](https://tooldirectory.ai/tools/unriddle)). **Humata**: clickable citations highlight the exact source sentence, and answers can be collected into exportable summaries ([review](https://www.seaflux.tech/blogs/humata-ai-document-analysis-summarizer-pdf-processing/)). **Scholarcy** "Robo-Highlighter": **AI writes highlights onto the document automatically** — AI-authored annotation with no conversation ([site](https://www.toolsforhumans.ai/ai-tools/scholarcy)). ChatDOC, Elicit, Petal, Afforai: sidebar chat with citation jump-back; **none verified to insert into the document**; Petal and Afforai **UNVERIFIED**. | Cloud in every case; selector models **UNVERIFIED** throughout. | Lex is the nearest on gesture and still one-shot per location, single agent, and the AI never joins a human comment thread. Scholarcy is the nearest on *unprompted* annotation and is exactly the pre-annotation pattern §B4(d) says not to copy. |

### C16–C20. Research — the five that matter

**These five are the spine of the report's related-work paragraph.** Two of them have already run
the experiment the pivot is betting on.

| # | Work | In-document interaction | Why it matters here |
|---|---|---|---|
| **16** | **Joshi & Vogel, *Designing and Evaluating AI Margin Notes in Document Reader Software*, CHI 2026** — [arXiv 2509.09840](https://arxiv.org/abs/2509.09840) | **This is almost exactly the pivot, formalised.** AI-generated annotations **anchored to selected text inside the document's comment layer**, explicitly contrasted with "chat-based tools placed in a separate side panel with the content disconnected from the context." A three-parameter design space: *integration with text* (integrated vs detached chat), *selection automation* (manual vs AI-chosen), *degree of AI involvement*. Three controlled experiments. | **Lead with it.** Findings, in order of usefulness: participants **preferred integrated margin notes over chat**; participants **preferred selecting the text themselves** (→ §B4(d): do not pre-annotate; the learner's selection opens the conversation); **lower AI involvement produced stronger psychological ownership** (→ DG1, and the strongest external support the project has for "the learner writes first"). **And the caution that must be reported honestly: the degree of AI involvement had no measurable effect on reading comprehension at a 2 h delay.** Margin notes are better *liked* and better *owned*; comprehension is not automatic. That is the honest limitation sentence for §F and it is worth a mark for being stated. |
| **17** | **Fang, Xu, Yang, Lin, Malacria & Yatani, *LLM-based In-situ Thought Exchanges for Critical Paper Reading*** — [arXiv 2510.15234](https://arxiv.org/abs/2510.15234) | Custom PDF viewer with **short Q&A exchanges with LLM agents in parallel with reading**. N=46, two weeks, three conditions: **no agent vs single agent vs multi-agent**. | **The empirical justification for *multiple* agents in a document, which nothing else supplies.** Agent-mediated exchanges **significantly improved critical-thinking scores**; single-agent produced **more reflective annotations**; **multi-agent produced more active engagement and more comparing of multiple perspectives.** That last clause is DG2 and safeguard S2, measured, in a document, by someone else. |
| **18** | **Chen, Han, Zhang, Liu & Zhong, *CommentScope*** — [arXiv 2512.06408](https://arxiv.org/abs/2512.06408) | Comments presented **inline at sentence ends and as marginal side notes**, with a fine-tuned LLM **aligning each comment to its relevant sentence** (classification accuracy 0.89, positioning exact-match 0.82). N=12. | Directly reusable: better comment discovery, better reading fluency and **lower mental demand** than a conventional comment list. It is also the evidence that LLM-assigned anchoring works well enough to ship — relevant if ChatterED ever lets an agent choose its own anchor (§E3 control 4 is the guard for when it chooses wrong). |
| **19** | **Head et al., *ScholarPhi* — "Augmenting Scientific Papers with Just-in-Time, Position-Sensitive Definitions of Terms and Symbols", CHI 2021** — [arXiv 2009.14237](https://arxiv.org/abs/2009.14237), [DOI](https://doi.org/10.1145/3411764.3445648) | Four in-document augmentations: position-sensitive definition tooltips for terms and symbols; a "declutter" filter showing every use of a term; automatic equation diagrams exposing symbol definitions; an auto-generated glossary. | The canonical statement of **"the augmentation lives at the point of confusion, not in a panel."** Also the nearest prior art to Lucas's own worked example — *"What is a Hermitian operator?"* selected inside an equation is ScholarPhi's symbol-definition case almost verbatim, which is a useful thing to know before building it. |
| **20** | **Head/August et al., *Paper Plain*** — [arXiv 2203.00130](https://arxiv.org/abs/2203.00130); and **The Semantic Reader Project** — [arXiv 2303.14334](https://arxiv.org/abs/2303.14334), [CACM 2024](https://doi.org/10.1145/3659096) | Paper Plain: in-line definitions, **in-situ plain-language section summaries**, guiding key questions, plain-language answer passages. Semantic Reader: the umbrella survey of ScholarPhi, CiteSee, Threddy and Paper Plain. | Paper Plain's result — readers found papers easier **without comprehension loss** — is the polite version of C16's caution. The Semantic Reader survey is the single citation to use if the word count only allows one for "AI-powered interactive reading interfaces". |

**Also relevant, in one line each:** **Threddy** (UIST 2022, [arXiv 2208.03455](https://arxiv.org/abs/2208.03455)) — clipped snippets organised into *threads* as first-class objects, retaining rich source context. **CiteSee** (CHI 2023, [arXiv 2302.07302](https://arxiv.org/abs/2302.07302)) — colours inline citations *in situ* by the reader's own history, i.e. augmentation painted onto the document's own text. **CiteRead** ([RG](https://www.researchgate.net/publication/359400574)) — inserts what *citing* papers said, at the cited location. **Marvista** (TOCHI 2023, [arXiv 2207.08401](https://arxiv.org/abs/2207.08401)) — **per-paragraph AI-generated reflection questions during reading**, the closest prior art to Max's anchored probe. **DirectGPT** (CHI 2024, [arXiv 2310.03691](https://arxiv.org/abs/2310.03691)) — direct manipulation of on-screen objects mapped to prompts; the best citation for "a gesture on content *is* a prompt", which is §A1's whole argument. **Graphologue** ([arXiv 2305.11473](https://arxiv.org/abs/2305.11473)) and **Sensecape** ([arXiv 2305.11483](https://arxiv.org/abs/2305.11483)) — LLM output as interactive diagrams and as multilevel structures. **Texterial** ([arXiv 2603.00452](https://arxiv.org/abs/2603.00452), Feb 2026) — text-as-material; AI output lands in the document and is manipulated in place. **Conversations in Space** ([arXiv 2605.15848](https://arxiv.org/abs/2605.15848), 2026) — prompts and responses as a graph on a canvas, with a good survey of this cluster. **Houde et al.** ([arXiv 2501.17258](https://arxiv.org/abs/2501.17258)) — §B.

**Searched and not found** (record these so they are not searched for twice): no HCI system named
"Koala" for in-document AI reading — the name belongs to the Slack agent *inside* Houde et al.
(§B), which is what `Academia/Sources/[NEW] Koala System/` is. "Lumos", "AI Threads", "fluid
transformers", "Marginalia" and a Microsoft "LLM-as-margin-note" resolve to unrelated work or to
nothing; the margin-note paper Lucas may be thinking of is **C16, which is Waterloo, not
Microsoft**. "Relatedly" and "Luminate" exist but their exact identifiers are **UNVERIFIED**.

### C21. What the catalogue changes about the plan

Four consequences, each of which should reach the report:

1. **The novelty claim gets stronger and more precise.** Not "nobody puts two personas in one
   learner conversation" (true but modest) — **"nobody makes the anchored thread the object."**
   C0 is the evidence.
2. **C16 gives the pivot external, peer-reviewed, this-year support for three separate design
   decisions**: integrated beats chat; the learner selects, the AI does not; less AI involvement
   yields more ownership. Those map onto the pivot itself, §B4(d), and DG1 respectively.
3. **C17 is the only citation anywhere that supports *multi*-agent in a document**, and it
   supports exactly the effect ChatterED claims (perspective comparison, engagement, critical
   thinking). Without it, "why two agents in a margin?" is an unanswered question in the report.
4. **C16's null result on comprehension is the honest limitation.** Margin notes were preferred
   and produced more ownership; they did **not** measurably improve delayed comprehension. State
   it. The project's own measure is not comprehension but *defended explanation* (the ledger's ●
   state), which is a different construct — and saying so is a stronger answer than ignoring the
   finding.

---

## D. PDF → modifiable, high-fidelity, state-saving: four approaches

Item (0) asks for three things at once — **high fidelity to the original**, **high ability to
modify**, and **state saving**. No approach gives all three. The four below trade them
differently, and the trade that matters for ChatterED is set by the material: the target corpus
is **lecture slides** (`product-design.md` P6: "slides already sitting in `~/Documents/MA3236/`"),
which is the single worst input class for every conversion tool, because slides are
layout-as-meaning, diagram-heavy, and often carry maths set as vector art rather than text.

### D0. What already exists, and must be priced into every option

From `app/docs/STATUS.md` (issue #22 stages b, d, e):

- `pdfjs-dist` 6.x in the **renderer** (`PdfViewer.svelte`): per-page canvas render,
  `IntersectionObserver` lazy rendering (2 of 24 canvases drawn on open), zoom, page box, a
  Start-here/End-here page-range marker outlined with a rule. Bytes reach it as a `Uint8Array`
  over IPC — deliberately not a URL.
- `pdfjs-dist` again in the **main process** (`vault/pdf.ts`), worker disabled, producing per-page
  text joined into lines by `hasEOL` and y-coordinate breaks. That text feeds the **FTS5 index,
  one row per PDF page**, so a hit names a page.
- SQLite at `~/Library/Application Support/ChatterED/app.db`, `user_version` = 6, WAL, a
  migration + repository layer, and an outbox with deterministic doc ids.
- `message_refs`: page range + the highlighted selection (capped at 1,500 chars **in the main
  process**) + the extracted page text, rendered into the message stream after the last cache
  breakpoint.
- **No pdf.js text layer.** STATUS says so explicitly: *"a pdf.js page is a canvas, so a PDF
  reference carries a page range and no highlighted passage. A pdf.js text layer would fix that
  and is not built."*
- Vault re-sync is keyed on `(size, mtime_ms)`; a changed file **loses its index**.

That last line is a landmine for every option below and is dealt with in §D5.

### D1. (i) Keep the PDF, overlay an annotation layer

Render the original PDF unchanged; store anchors and notes separately; draw them over and beside
the page.

Two sub-variants, and the difference decides a day of work:

- **(i-a) Box anchor — no text layer.** The learner drags a rectangle on the rendered page. Store
  the rectangle in **PDF user-space units** (divide CSS pixels by the current render scale and
  apply the page rotation), never in CSS pixels, so zoom and window size cannot move it. Works on
  scanned pages, diagrams and equations set as vector art — i.e. on exactly the slide content
  where text extraction fails. **Half a day.** No new dependency.
  **This is not an improvisation:** it is Hypothesis's `ShapeSelector` — a rect or point whose
  coordinates are *normalised 0–1 relative to the page box*, `anchor: 'page'` — which is precisely
  how the most-deployed annotation client in the world anchors to a figure or an equation that has
  no extractable text
  ([`pdf.ts`](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/pdf.ts)).
  Normalise to the page box rather than to raw user-space units and you match their wire format
  for free.
- **(i-b) Text anchor — build the text layer.** Add pdf.js's `TextLayer` so the canvas gets a
  transparent, positioned text overlay and the OS selection works. Store the anchor the way
  Hypothesis stores a PDF anchor — the triple `[TextPositionSelector, TextQuoteSelector, PageSelector]`, where
  the quote carries a ±32-character prefix/suffix window and `PageSelector` (`{index, label}`) is a
  documented **extension to the W3C model, not part of it**. Robust, searchable, and it makes ⌘F
  work inside a document (`ui-review-ux.md` M8 asks for this anyway). **One to two days**, plus
  three real traps, all already logged in Hypothesis's own issue tracker:
  (a) the renderer's text layer and the main process's `vault/pdf.ts` extraction join text
  *differently* — `vault/pdf.ts` joins by `hasEOL` and y-coordinate breaks, pdf.js's text layer
  does not — so an offset computed on one side will not address the other. Make the **quote
  authoritative and the offset a hint**;
  (b) describing a selection must run against a **rendered** text layer, or the quote picks up text
  from pdf.js placeholder elements on un-rendered pages
  ([client#3737](https://github.com/hypothesis/client/issues/3737)) — and ChatterED renders lazily,
  2 of 24 canvases on open, so this *will* happen;
  (c) quote anchoring can block the main thread on a large document
  ([client#3919](https://github.com/hypothesis/client/issues/3919)); anchor incrementally rather
  than anchoring the whole file on open.

| | |
|---|---|
| **Fidelity** | Perfect. It *is* the original file, unmodified on disk. |
| **Editability** | None of the source; full for the overlay. The learner cannot fix a typo on a slide — which, see §D4, is arguably correct. |
| **Anchoring stability** | Good within a fixed file; degrades gracefully across edits if anchors carry a quote (§D5). Box anchors do not survive re-pagination at all. |
| **Save format** | Migration 007 in the existing SQLite. See §D6. |
| **Effort** | **S–M.** Half a day to two days for the anchor machinery. |
| **Carry-over** | pdf.js viewer ~100%. FTS index 100% (unchanged, and it is what makes text anchors re-findable). Room actor, orchestrator, timer, ledger, whisper: 100%. |

**Write-back to the PDF via `pdf-lib` is optional and should stay optional.** A PDF `/Annot`
dictionary can carry a highlight and a text note; it cannot carry an agent identity, a ledger
state, a thread, or a private layer. Treat pdf-lib as an **export** ("flatten my notes into a PDF
I can print or submit"), never as the store, and never write over the learner's original file.

### D2. (ii) Convert to HTML/Markdown with layout, and edit that

Run the PDF through a modern converter — IBM **docling**, **marker**, Meta **nougat**,
**pdf2htmlEX**, **MinerU**, **Mathpix** — and make the output the document.

| | |
|---|---|
| **Fidelity** | The problem — and the 2026 numbers are worth knowing before deciding. On olmOCR-bench: **Marker v2 76.0** (best overall, ~2.9 pg/s on one B200; GPL-3.0 code plus RAIL-M weights that restrict commercial use — a licensing trap), **MinerU 2.5 72.7** but **best at maths** (formula CDM 88.46, tables TEDS 88.22) at ~0.54 pg/s, **IBM Docling 50.3** — the weakest OCR of the three and the **best structure model**, MIT-licensed and CPU-capable. **Nougat is superseded on every axis by the 2026 VLM generation; do not start a new project on it.** `pdf2htmlEX` reproduces the page almost pixel-exactly, but with absolutely-positioned divs and embedded fonts — precisely *not* a structure you can edit, and maths stays as positioned glyphs. **Mathpix** is strongest on handwriting and STEM and has one failure mode that matters for a learning tool: it "corrects" unusual-but-valid notation into standard LaTeX — plausible-looking and semantically wrong. |
| **Editability** | The best of the four. The output is a real document tree; insertion is native; an AI block is a node, not an overlay. |
| **Anchoring stability** | Excellent *once converted* (node ids), but the conversion itself is unstable: re-run the converter and the tree can change, orphaning every anchor. The anchor must therefore hang off the converted artefact, which must be cached and versioned — i.e. you have invented a second document format and must keep it. |
| **Save format** | The converted document plus its own state. A `.chattered` bundle becomes near-mandatory. |
| **Effort** | **L–XL for this codebase.** Every one of these tools is Python or native C++ with model weights. ChatterED is an unsigned Electron app installed by a shell script and a LaunchAgent (`tools/install-local.sh`). Bundling a Python runtime plus a layout model into that is a distribution project, not a feature. A hosted API (Mathpix) removes the bundling problem and adds a network dependency and a per-page cost to a local-first product whose whole positioning is "reads the slides already on your disk". |
| **Carry-over** | pdf.js viewer: **thrown away**. FTS index: survives conceptually but must be re-pointed at the converted text. Room actor and everything downstream: 100%, because they only ever receive plain text. |

**The slide-specific failure modes, named** (partly **UNVERIFIED** — extrapolated from benchmark
categories, because a slides benchmark does not appear to exist): reading order breaks on
free-floating slide layouts; header/footer bands and speaker notes interleave into the body
(Docling's `content_layer` flag is the explicit mitigation, and it is the only one of the three
that has one); text baked into figures and screenshots is lost unless OCR is forced; animation
builds yield duplicated near-identical slides; hand-drawn or image-rendered equations fall back to
OCR and hallucinate. Marker's fast `--disable_ocr` path (43.6 at 23.7 pg/s on CPU) is exactly the
wrong setting for slides.

**One reason to keep Docling in view for A2 anyway.** It is the only one of the three that natively
returns **`(page, bounding box)` provenance for every heading, paragraph, table, caption and
picture**. That is not a conversion feature, it is an **anchoring** feature: it would let ChatterED
place anchors on semantic regions — *this bullet*, *this equation* — instead of on a rectangle the
learner dragged, without ever making the converted text the document. Approach (ii) used as an
**anchor oracle** rather than as a replacement document is a genuinely interesting A2 idea and
costs none of (ii)'s fidelity loss.
([Docling](https://arxiv.org/abs/2408.09869) · [MinerU 2.5](https://arxiv.org/pdf/2509.22186) ·
[benchmark roundup](https://www.marktechpost.com/2026/07/24/datalab-marker-v2-vs-mineru-docling-and-liteparse-benchmark-breakdown/))

**Verdict:** this is the right answer for a product that means to be a *notes app*, and the wrong
answer for the next seven days, for this corpus, in this shell.

### D3. (iii) A block-document model (Notion-style)

Every page or region becomes a block with an id; AI outputs become new blocks between them;
the document is an ordered block list.

| | |
|---|---|
| **Fidelity** | Entirely dependent on how the original blocks are produced. If blocks come from (ii), you inherit (ii)'s fidelity loss. If blocks come from page images, this collapses into (iv). |
| **Editability** | Highest of all four — reorder, nest, transclude. |
| **Anchoring stability** | Best in principle: a block id is a stable address and a CRDT gives you concurrent edit for free. |
| **Save format** | A JSON block tree, or a CRDT document (Yjs/Automerge) plus a binary blob store. |
| **Effort** | **XL.** You are writing an editor. The sane base is ProseMirror/Tiptap or Lexical, and the sane estimate is weeks, not days. |
| **Carry-over** | pdf.js viewer: thrown away unless blocks are page images. FTS: rebuilt over blocks. Room actor: 100%. |

**Verdict:** not a seven-day option, and not an A2 option either unless the project stops being
about conversation and starts being about editing.

### D4. (iv) Hybrid — page images as immutable blocks, editable blocks interleaved

The recommended target. The document is a vertical list of blocks. Blocks of kind `page` render
the original PDF page and **cannot be edited**. Blocks of kind `note`, `explanation`, `probe`,
`thread` are ordinary editable content, inserted between pages and pinned into the margin beside
an anchor within a page.

| | |
|---|---|
| **Fidelity** | Perfect, for the same reason as (i): the page is the original. |
| **Editability** | Full for everything the learner and the agents create; zero for the source. |
| **Anchoring stability** | Two tiers. Block-level (between pages) is trivially stable. In-page anchors inherit (i)'s properties. |
| **Save format** | Same as (i) — a sidecar. A `.chattered` bundle becomes meaningful here as an *export*, because the block list is now a document in its own right. |
| **Effort** | **M.** It is (i) plus a block list. The existing `PdfViewer` already renders a lazy vertical list of pages; the change is that the list can contain things other than pages. |
| **Carry-over** | pdf.js viewer ~90% (the page renderer becomes a block renderer). FTS 100%. Room actor and below 100%. |

**And it has a design argument, not only a cost argument.** Safeguard **S5** says the slide is the
arbiter: *"Factual disputes resolve against the learner's uploaded slide… If both agents
contradict the slide, the slide wins"* (`design-brief.md` §D6). A document model in which the
original page is **structurally immutable** encodes S5 in the data model rather than in a prompt.
An agent cannot edit the ground truth because there is no operation that edits the ground truth.
That is one sentence in the report and it is worth a mark.

### D5. Anchoring when the source changes — a policy, not an afterthought

`repo.ts#sync` keys on `(size, mtime_ms)` and a changed file **loses its `indexed_*` stamp and its
FTS rows**. That is correct for an index and catastrophic for annotations: the anchors hold the
learner's own explanations.

Policy to implement with the first anchor:

1. Store `content_hash` (SHA-256 of the file bytes) on every anchor, alongside `file_id`.
2. On open: **hash matches** → offsets and rectangles are authoritative, render directly.
3. **Hash differs** → re-anchor with Hypothesis's four-stage cascade, cheapest and most precise
   first: (1) the stored position, *then verify the text matches*; (2) global character offsets into
   the flattened document text; (3) fuzzy search for the prefix and suffix, validating the text
   between them; (4) fuzzy search for the quote alone. Their fuzzy layer is a modified
   google-diff-match-patch (Bitap for approximate search, Myers for diff), with the stored position
   used to **bias the search toward the original location** — which is what makes it work when the
   quote occurs many times in one document
   ([fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/)). Redundancy is the whole
   trick: each selector degrades differently.
4. **Anything unmatched becomes a visible orphan**, listed in a panel ("3 notes could not be placed
   — here they are"), never deleted and never silently dropped. This is Hypothesis's own behaviour,
   and the orphan state should be designed in from day one rather than treated as a bug (§C2).
5. Re-indexing may drop FTS rows freely. It may never touch `anchors`. Assert this in a test, in
   the same spirit as the existing whisper-leak canary test.

### D6. Save format — the recommendation

| Candidate | Role |
|---|---|
| **SQLite (existing `app.db`), migration 007** | **Source of truth**, and the same choice Zotero and MarginNote both made (§C12, §C10). Zotero publishes its reasoning and it transfers exactly: sync the changed annotation record instead of re-transferring the whole PDF, avoid file conflicts, and allow tags and filtering on annotations ([Zotero](https://www.zotero.org/support/kb/annotations_in_database)). Cheapest possible for ChatterED: the migration and repository layers exist, it is transactional, and the room actor already writes there. Two tables: `anchors` (file_id, content_hash, page, kind, rect or quote/prefix/suffix, created_at) and a nullable `anchor_id` **column added to `messages`**. |
| **Sidecar JSON next to the file** (`lecture3.pdf` + `lecture3.chattered.json`) | **Derived mirror, written on save.** The vault root is the student's OneDrive folder (`ui-review-ux.md` M5 shows `OneDrive-NationalUnivers…`), so a sidecar syncs across machines and survives a reinstall. Known risk: OneDrive conflict copies. Not the source of truth. |
| **`.chattered` bundle** (zip: original PDF + state) | **Export only.** A working bundle format reintroduces import/export into a product whose §B1 rule is that *no upload button exists anywhere*. |
| **pdf-lib write-back into `/Annot`** | **Export only, lossy by design** — Zotero's "Export PDF…" is exactly this, a one-way publish step. A PDF text-markup annotation carries `/QuadPoints`, i.e. **page-space geometry and no text anchor** (§C13), so it breaks under any re-render or re-OCR, and it cannot express a thread, an agent identity, a ledger state or a private layer. Good for "give me a PDF with my highlights for revision"; fatal as a store. |

**The architectural move that makes all of this cheap:** an annotation *is a message*. Add
`anchor_id` to `messages` and a margin thread becomes `messages WHERE anchor_id = ?`. The room
actor, the orchestrator, the silence timer, the ledger gates, the whisper scoping and the
scripted transcript player all keep working unchanged, because none of them care where a message
is drawn. This is why the pivot is a **rendering** change and not a rewrite.

### D7. Comparison, one table

| | (i) Overlay | (ii) Convert | (iii) Blocks | (iv) Hybrid |
|---|---|---|---|---|
| Fidelity | **perfect** | poor on slides | inherited | **perfect** |
| Editability of source | none | **full** | **full** | none (by design) |
| Editability of AI/learner content | full | full | **full** | full |
| Anchor stability, same file | good | excellent | **excellent** | good |
| Anchor stability, changed file | quote re-anchor | breaks on re-convert | **id-stable** | quote re-anchor |
| New runtime dependency | none | Python + models, or an API | editor framework | none |
| Save format | SQLite sidecar | bundle, mandatory | JSON/CRDT | SQLite sidecar (+bundle export) |
| pdf.js viewer carried over | ~100% | 0% | 0% | ~90% |
| FTS index carried over | 100% | re-pointed | rebuilt | 100% |
| Room actor / ledger / whisper carried over | 100% | 100% | 100% | 100% |
| Effort | **S–M** | L–XL | XL | **M** |
| Verdict | **A1** | year-two | no | **A2** |

**(i) is a strict subset of (iv).** Nothing built for the A1 overlay is thrown away when the
block list arrives. That is the reason to take this path rather than the more impressive one.

---

## E. The existing mechanics, relocated into the document

The honest framing: ChatterED's mechanics are defined over **a single linear transcript with one
floor**. A document is **spatial and parallel**. Some mechanics get sharper when they acquire a
position; some are load-bearing precisely *because* the transcript is linear, and they break.

### E1. Mechanic by mechanic

| Mechanic | In the document | Verdict |
|---|---|---|
| **Ellie / Max as margin annotators** | Each agent turn is a note anchored to the passage it is about, in a shared right-hand margin column, y-aligned to its anchor. | **Stronger.** In the chat, Max must spend words re-establishing what he is talking about ("when you said the Hessian is PSD…"). Anchored, the referent is free and the whole turn can be the question. |
| **The learner's explanation as an inserted callout** | Item (2). The learner selects a passage, writes their explanation, and it is inserted as *their* block, visually distinct from the source. | **Stronger, and it fixes a real bug.** Today the ledger must quote the learner's message body and a slide can never become "evidence the learner explained it" (`STATUS.md`, stage (e)). With an inserted callout, the distinction between *what the slide says* and *what I said about it* is structural rather than enforced. |
| **Max's probe as a sticky note** | Item (3). One Socratic question pinned to the exact clause it doubts. | **Stronger.** `progress-tracking.md` §6.1 says a probe is only sharp when aimed at a specific `element × level`; an anchor *is* that address, obtained without an LLM guessing it. |
| **The silence timer** | Redefinition required. "Idle" currently means *no keystrokes in the composer* (`design-brief.md` §D3) — the property that distinguishes thinking from disengaging. A document has no single composer, and scrolling while re-reading is exactly the behaviour the timer must not punish. | **Weaker, and the hardest problem in the pivot.** New definition needed: idle = no keystrokes in any open thread **and** no new selection **and** no scroll, for 45 s, scoped to the currently open thread. Where the nudge lands is a new question Koala's *where* cell owns: it must appear **in the thread the learner last touched**, never as a floating note elsewhere in the document, or it reads as the agent wandering off. |
| **The latency holds (9–12 s / 4–6 s)** | A held reply in a chat is legible because a typing indicator names who is thinking. A note that appears in a margin nine seconds later, possibly off-screen, is indistinguishable from lag or from nothing. | **Weaker.** Needs a persistent per-thread "Max is writing…" placeholder occupying the slot the note will fill, so the wait has a location. More chrome than the chat version, for the same effect. |
| **Turn-taking rules (§D2: one agent per beat, no agent-to-agent volley, the learner closes)** | These are defined over *one* ordered stream. With N threads there are N floors and the rules no longer bind. | **Weaker; needs an explicit fix.** Keep **one global floor**: at most one agent may be writing anywhere in the document at any moment, and the anti-dog-pile rule applies across threads, not within them. This is Koala's *where* control made mandatory. |
| **S2, the disagreement quota** | "Ellie and Max must visibly disagree at least once per five agent turns." In a chat they are adjacent and the disagreement is seen. In margins twelve pages apart it is never seen. | **Weaker.** Fix: a disagreement must be **co-located** — rendered as two notes in the *same* thread, adjacent, or it does not count toward the quota. |
| **S1, "two voices, never a chorus"** | New failure mode: three notes stacked beside one paragraph *look* like a chorus even though they arrived minutes apart. Spatial adjacency manufactures the group identity S3 bans. | **Weaker; new safeguard needed.** Cap unsolicited agent notes per passage at one (§B4b), and never render two agent notes adjacent without a learner turn between them. |
| **The whisper channel** | Becomes a **private layer** with a toggle, and the relay becomes "promote this private note into the shared margin" with the same attribution choice. | **Stronger as an interaction, in tension on ephemerality.** The gesture is better: promotion is a direct manipulation rather than an approval dialog. But §D5 requires whispers to *clear at the end of a round* (Dennis et al.'s ephemerality), and a document saves everything. Decide explicitly (§H): either private notes are the one layer that is not persisted, or ephemerality is dropped and the report says so. Do not let it happen by accident. |
| **The Explanation Ledger** | The four layers project onto the document as a **coverage map**: each anchored claim carries its ○ / ◐ / ● glyph *in the gutter next to the passage it is about*, and the page shows at a glance what has been defended and what has only been read. | **Much stronger — the biggest single win of the pivot.** It also dissolves two live UX complaints: `ui-review-ux.md` m4 ("the round card prints `·C1 ·C2` but the rail rows carry no ids, so the two cannot be mapped") and M13's dead space. When the ledger row *is* the highlight, there is nothing to map. And the recap card — currently a 408 × 2043 px overlay showing three zeroes (M9) — stops being a screen: the document is the recap. |
| **Theo's teach-back** | Item (6). A page-scoped block: when every claim anchored on this page is ●, the page offers "teach this page", Ellie and Max grey out, and the learner explains the page to Theo in a block at the foot of it. | **Stronger and cheaper.** A page is a natural teaching unit, the gate (`every row === 'defended' && bloom === 'analyse'`, M9's fix) becomes visible *on the page it applies to*, and S1's "the group never exceeds two" is rendered spatially as the other two margins going quiet. |
| **"Show the room · p. N"** | Disappears as a feature, because it is what the whole app now does. | **Absorbed.** Note for the report: this is a feature *deleted* by the pivot, which is evidence the pivot is a simplification and not an addition. |
| **Rounds ("Round 1 · Explain")** | A round is temporal; a document is spatial. | **Should be redefined or dropped.** Recommend: **the round becomes a page or a marked page range.** That preserves every rule that depends on a round (the ≤2 silence fires per round, the S2 quota window, the ledger gate, whisper clearing) while giving the learner a unit they can see. |
| **The round card, the status-bar chips, the recap overlay** | System messages in a stream that no longer exists. | **Drop.** The round card becomes a header block on the page; the recap becomes the coverage map; the chips mostly go. |

### E2. Summary

- **Stronger:** the ledger as a coverage map (decisively); anchored probes; the learner's
  explanation as a first-class object; teach-this-page; the whisper's promote gesture.
- **Weaker, and each needs an explicit fix, not a hope:** the silence timer's definition of idle;
  the legibility of the latency hold; turn-taking across parallel threads; the disagreement quota's
  visibility; the anti-chorus safeguard against spatial pile-up.
- **Drop:** `Show the room` (absorbed), the round card as a message, the recap overlay, the
  status-bar chip cluster, and — unless it is defended on purpose — the temporal round.

### E3. Which behaviours now need learner-operable controls (Koala §7.2, applied)

Annotation is *litter* in a way a chat message is not: a chat message scrolls away, a badly
placed note sits on the learner's own document until removed. That asymmetry is what makes
Koala's taxonomy load-bearing here rather than nice-to-have. Minimum set for the pivot:

1. **Reject this note** (one click, logged) — mandatory, not optional. Nothing else on this list
   matters if the learner cannot undo an agent's intrusion into their own file.
2. **Quiet · normal · active** — one dial over unsolicited annotation rate (Koala's 90/75/50
   contribution threshold, renamed).
3. **Per-agent mute, per-document** — Koala's reactive/proactive toggle, per agent.
4. **`no-annotate` on a region**, always on by default for the learner's own inserted
   explanations — Koala's *who has access* cell, moved from people to places, and the genuinely
   new cell the pivot needs.
5. **Length cap on any inserted block** — Koala's long-message truncation. In a document an
   over-long insertion physically moves the page.
6. **Natural-language steering with a one-line confirmation of how it was read** — wanted by
   Koala's participants (P2.1), doubted by them (P2.3), and fixed by the paper's own suggestion.

Controls 1–3 are the A1 set and are each under an hour of UI. 4–6 are A2.

---

## F. Rubric fit

### F1. Is it still a CUI?

**Yes — and the assignment's own wording makes it easier, not harder.**

> "A CUI is not limited to a text chatbot. In this assignment, a CUI is an interactive system in
> which the learner and the system take turns communicating, and the system's next response or
> action is shaped by what the learner **says, does, or provides**."
> — `assignment1-brief.txt`

Two clauses do the work. *"Not limited to a text chatbot"* removes the chat window as a
requirement. *"Says, **does**, or **provides**"* makes **selecting a passage a turn**. An
integrated-document system where the learner selects, writes an explanation, receives an anchored
probe, answers it, and receives a follow-up is squarely inside the definition — arguably more
clearly inside it than a chat, because the learner's *doing* is visible.

### F2. What must remain conversational and multi-turn

Step 4 is the binding constraint and it is specific:

> "The interaction must involve **several connected exchanges**… Show what the learner thinks
> about or does, and **how the CUI's responses are shaped by the learner's input across the
> interaction**."

So the pivot is rubric-safe **only if at least one anchored thread carries a real, visible,
multi-turn exchange**. (This is also the empirical finding, not only the rubric: §C17's
single-agent condition produced *more reflective annotations*, while the **multi-agent** condition
produced *more active engagement and more comparing of perspectives* — the second is what the
ledger's ● state measures, and it requires turns.) Concretely, the prototype and the video must show:

1. **≥ 4–6 alternating turns in one place**, on one anchor, on one page. Not four one-shot
   insertions on four different pages — that is four single-turn interactions, and it fails Step 4
   however good it looks.
2. **Each agent turn visibly shaped by the previous learner turn** — quoting or naming the
   learner's own words, which the ledger already requires (`progress-tracking.md` §4.4: an element
   may only advance when the system can quote the learner's own words as evidence). Make that
   quoting visible in the note itself; it is the cheapest possible demonstration of "shaped by".
3. **State changing as a consequence** — the gutter glyph moving ○ → ◐ → ● in shot. This is
   Step 2's "clear mechanism for tracking student progress" and Step 4's "shaped by" in a single
   animation.
4. **The learner closing.** P1 and turn rule 5 already require it; on camera it is also what stops
   the demo looking like an AI writing a document.

### F3. The specific rubric risk the pivot introduces

**Item (1) is single-turn, and it is the item Lucas wrote down.** "Select a portion, ask *What is
a Hermitian operator?*, the result is inserted" is: one learner turn, one system turn, no
connected exchange, and the system supplying the understanding. It is a **retrieval feature, not a
CUI**, and under the report's own Step 1 it is a demonstration of the difficulty the project
exists to treat (*uncritical use of AI output*). If it leads the video, the grader sees an AI
writing into a PDF.

**Mitigation, one line in the design:** the inserted answer always ends by handing the work back
("now say it back in your own words and I'll tell you what's missing"), and the ledger row stays
at ○ until the learner does. That converts item (1) from the disease into the hook, and it costs
nothing to build because the ledger gate already refuses to advance without learner evidence.

### F4. Risks for the 2,000-word report

| Risk | Size | Handling |
|---|---|---|
| **The pivot re-opens Step 3, not Steps 1–2.** The difficulty (*uncritical use of AI output*), the learning goal, the division of labour and the design goals DG1–DG5 are all unchanged by where the conversation is drawn. | Low, if said plainly | Say it explicitly in Step 3: "the interaction model is unchanged; the surface changed." That sentence protects four marks. |
| **Word budget.** `design-brief.md` §G2 already budgets 2,000 words across five design goals, three agents, eight safeguards and a four-layer ledger. A document-format argument is new material. | **High** | Cap the format argument at ~150 words in Step 3 and state the choice as a decision with one reason (fidelity on slides), not as the comparison in §D. The §D table is appendix material; appendices are excluded from the count. |
| **Evidence grounding.** The 4.0-mark criterion requires design goals "rooted in… empirical user needs" with "direct user quotes". The interviews were run about the *chat* workflow. | **High — and decisive.** | If the three interviews contain anything about copy-pasting between a PDF and a chat window, losing track of which answer went with which slide, or answers living somewhere other than the material, the pivot is **user-grounded** and it is the strongest part of the report. If they do not, the pivot is designer-led and must be presented as a Step-3 design decision rather than a Step-1 finding. §H Q1. |
| **Novelty claim.** `competitor-notes.md` says no shipping education product puts two personas in one learner conversation. The pivot gives a sharper and better-evidenced version (§C0): **every shipped system either keeps the conversation and inserts only a citation pointer, or inserts the artefact and lets the conversation evaporate at Accept.** Nobody makes the anchored thread the object. | Low | Keep the claim; retarget it to §C0, which is stronger. |
| **An unstated null result.** §C16 (Joshi & Vogel, CHI 2026) found AI margin notes were **preferred over chat** and produced **more ownership** — and had **no measurable effect on delayed reading comprehension**. A grader who knows the paper and reads a report claiming comprehension gains will mark it down. | Medium | State it, and answer it: ChatterED's outcome measure is not comprehension but **defended explanation** (the ledger's ● state, unreachable without a Challenger probe), which is a different construct. Naming a null result in the nearest prior work and explaining why your measure differs is worth more than the sentence costs. |
| **Scope honesty.** A report describing a document system while the ZIP contains a chat app is the fastest way to lose the ownership mark. | Medium | Whatever is real must be labelled real and whatever is storyboarded must be labelled storyboarded — the discipline `app/docs/STATUS.md` already applies. |

### F5. Risks for the 10-minute video

The video is **5 of 16 marks** — the largest single criterion, and more than the prototype (3).
It is also the deliverable the pivot most endangers, for a reason that has nothing to do with the
idea's quality:

1. **A margin conversation is harder to film than a chat.** A chat transcript is a vertical list
   in reading order: the camera does not move and the viewer always knows who spoke last. Turns
   scattered across a scrolling page in different columns lose the viewer within two exchanges.
   **Mitigation: film one passage, on one page, and do not scroll during a turn.** Keep the
   whole exchange inside one still frame.
2. **"Demonstrate one complete, multi-turn interaction from beginning to end"** is hard to satisfy
   if the demo is a tour of features. One anchor, one thread, start to finish.
3. **A half-built pivot on camera reads as a broken app**, and 1 mark is explicitly for
   "individual understanding and ownership". The existing app has a `ScriptedClient` that replays
   the eleven turns of `design-brief.md` §G **through the real actor, timer, gates and whisper
   scoping** — a scripted turn presented as scripted costs nothing, and STATUS.md already tells
   you to say so on camera. That asset is the video's insurance policy and it survives the pivot
   unchanged, because the script produces messages and messages do not care where they are drawn.
4. **The grader's first frame.** If the first thing on screen is an AI writing a paragraph into a
   PDF, the pedagogy has to be argued uphill for nine minutes. Open on the learner writing *their*
   explanation into the margin.

---

## G. Recommendation: A1 MVP, A2 build, and the no-pivot alternative

### G0. The recommendation in three sentences

**Pivot, but only the rendering.** Build one interaction — *select a passage, explain it in the
margin, get challenged there, answer, watch the gutter glyph move* — on technical approach (i-a)
(box anchor, no text layer, no conversion), reusing the room actor, orchestrator, timer, ledger,
whisper and the scripted transcript player untouched, and storyboard items (1), (5) and (6) rather
than building them. **If the margin thread is not rendering learner-visible turns by end of day 3,
fall back to Option N and present the pivot as the Step-3 plan for A2** — a decision that costs
nothing, because the report's Steps 1 and 2 are identical either way.

### G1. Option P — the A1 MVP (recommended)

**The one interaction, in full.** *"Defend this claim in the margin."*

1. The learner opens a lecture slide from their own vault. (Real, built.)
2. They **drag a box** over one claim on the page. A margin thread opens beside it, y-aligned.
   (New.)
3. The composer in that thread invites them to explain the claim in their own words. **The learner
   writes first** (P1). (New surface, existing composer component.)
4. **Ellie** replies in the thread — acknowledge, then one request for elaboration. Held 4–6 s
   behind a "writing…" placeholder in the slot the note will occupy. (Existing actor, existing
   latency floor, new placeholder.)
5. The learner answers. The **gutter glyph beside the boxed claim moves ○ → ◐**. (Existing ledger,
   new glyph.)
6. **Max** pins a single Socratic probe on that anchor, quoting the learner's own words back.
   Held 9–12 s. (Existing.)
7. The learner defends. **Glyph moves ◐ → ●** — and only here, because `defended` is unreachable
   without a Challenger probe (the fifth ledger gate). (Existing.)
8. The learner closes the thread. Nothing else has been written anywhere in the document.

That is **six to eight connected turns in a single still frame**, with visible state change,
learner-first and learner-last. It satisfies Step 4 line by line.

**Technical approach:** (i-a), on the road to (iv).

**What is reused, unchanged:**

| Reused | Why it survives |
|---|---|
| Room actor, mailbox, cancellation | Produces messages; does not care where they are drawn |
| Orchestrator (rules-then-model, anti-dog-pile, S2 quota, last word) | Same |
| Silence timer (45/90, typing-aware, Hold, Wait for me) | Same, with idle redefined to the open thread (§E1) |
| Latency floors and the 8 s floor-yield window | Same |
| Ledger, all five gates including `defended` | Same |
| Whisper scoping and the leak canary test | Same |
| **`ScriptedClient` / `script.psd-hessian.ts`** | **The video's insurance.** Eleven real turns through the real machinery, zero model calls, zero network risk on recording day |
| `PdfViewer.svelte`, lazy page render, page range | The page renders identically; the margin is a sibling column |
| SQLite, migrations, repository, FTS5 | Migration 007 adds `anchors` and `messages.anchor_id` |
| Personas, copy, the three-hue palette | Unchanged |

**What is new (the whole build):**

- Migration 007: `anchors` table + nullable `messages.anchor_id`.
- Box selection over the rendered page, stored in **PDF user-space units** (§D1).
- A margin column beside the page, threads y-aligned to their anchors, with the existing
  `Thread`/`Composer` pair dropped into it — the components the UX review already says need a
  slot rather than a rewrite (`ui-review-ux.md` B1: *"It is the same `Thread`/`Composer` pair
  already built — it needs a slot, not new components."*).
- Gutter glyph rendering the ledger row state next to its anchor.
- A per-thread "writing…" placeholder (§E1, latency legibility).
- **Reject this note** and a **quiet · normal · active** dial (§E3 controls 1–2).

**What is mocked or storyboarded, and labelled as such:**

- Item (1), *Ask question → insert*: storyboard only, with the hand-back line (§F3).
- Item (5), the private layer: the whisper pane as built, with a storyboard of the margin version.
- Item (6), teach-this-page: storyboard.
- Agent-initiated annotation elsewhere in the document: **not built, deliberately** (§B4d).
- Format conversion: **none**. The PDF stays a PDF.

**Seven-day plan.**

| Day | Work | Gate |
|---|---|---|
| **Tue 16** | Migration 007. Box selection on the page in user-space units. Anchors persisted and redrawn on reopen. | An anchor survives quit and relaunch |
| **Wed 17** | Margin column; `Thread`/`Composer` mounted into it; `messages WHERE anchor_id = ?`. | A learner message appears in the margin |
| **Thu 18** | Wire `ScriptedClient` into the thread; latency placeholder; gutter glyph from the live ledger. | **Hard gate: a full scripted exchange plays in the margin. If not, fall back to Option N tonight.** |
| **Fri 19** | Reject-a-note, the quiet/normal/active dial, the ⌘ shortcut, and the two content bugs from `ui-review-ux.md` fixes 1–2 (Fit, the hard-coded `MA3236`) so nothing embarrassing is on camera. | Demo runs end to end twice without a restart |
| **Sat 20** | Storyboards for items (1), (5), (6). Prototype ZIP + README. | ZIP complete |
| **Sun 21** | Record. One page, one anchor, camera still. Re-record once. | Video under 10 min, under 200 MB |
| **Mon 22** | Report, 2,000 words, Steps 1–4 order. Submit with hours to spare. | Submitted |

### G2. Option A2 — the build after the deadline

Approach **(iv)**, incrementally, in this order:

1. **pdf.js text layer** (i-b) — real text selection, quote anchors, ⌘F inside a document, and it
   closes `ui-review-ux.md` M8. Everything box-anchored keeps working; the two anchor kinds
   coexist.
2. **Block list** — the page renderer becomes a block renderer; `note`, `explanation`, `probe`
   and `thread` blocks interleave between pages. Item (2) and item (6) become native.
3. **Sidecar JSON mirror** on save, for OneDrive portability (§D6).
4. **Coverage view** — the whole document's ledger state as a spatial map; the recap card dies.
5. **The Koala control set 4–6** (§E3): region permission, length caps, natural-language steering
   with confirmation.
6. **Orphan handling** (§D5) before any participant study, because a study that loses a
   participant's own written explanations is a study you cannot analyse.
7. Only then, if ever, evaluate approach (ii) for *text* documents (papers, not slides), as a
   second document kind rather than a replacement.

### G3. Option N — no pivot, for comparison

Ship `ui-review-ux.md` §D fixes 1–5 and record the app as designed:

- **1** Fit fits (S), **2** round card from the live pack and the hard-coded `MA3236` removed (S),
  **3** short ledger labels (S/M), **4** recap honesty — gate the Theo block, real act profile,
  export button (M), **5** the third pane in the Library (L).
- Cost: roughly four of the seven days, all of it repair rather than new design.
- What you get: the reviewer's own verdict — *"fix items 5 and 6 and the first sidebar, the
  missing chat and the empty space all resolve together"* — a legible app, a safe video, and a
  differentiator (`competitor-notes.md`: nobody ships two personas in one learner conversation,
  nobody ships a whisper channel, nobody markets pacing as pedagogy) that is already unoccupied.
- What you lose: the revised idea appears only as future work, and the A1 video shows a chat
  window that looks, at a glance, like every other study tool.

**This is a genuinely defensible submission.** It is not a failure mode; it is the floor.

### G4. Decision matrix

Scored for the seven days remaining. **↑** better.

| Criterion | Weight | **P — pivot the rendering** | **N — no pivot, fix the UI** | **X — full pivot (convert + block editor)** |
|---|---|---|---|---|
| Fits in 7 days | ×3 | ↑↑ 3 build days + 1 slack | ↑↑↑ comfortable | ✗ not possible |
| Step 4: multi-turn interaction demonstrable | ×3 | ↑↑ one anchor, one thread, 6–8 turns | ↑↑↑ already works today | ✗ |
| Step 1–2 evidence still fits | ×3 | ↑↑ unchanged *if* interviews touch the workflow (§H Q1) | ↑↑↑ unchanged | ↑↑ |
| Video filmability (5 of 16 marks) | ×3 | ↑ needs a still frame and discipline | ↑↑↑ linear transcript, trivial | ✗ |
| Ownership / "do you understand it" | ×2 | ↑↑ you wrote the surface; the engine is yours already | ↑↑↑ | ↓ |
| Differentiation vs the market | ×2 | ↑↑↑ two disagreeing personas in the margin of your own slides | ↑↑ two personas in a chat | ↑↑↑ |
| Answers the reviewers' complaint | ×2 | ↑↑↑ the missing pane problem dissolves — the document *is* the surface | ↑↑ fixes it as specified | ↑↑↑ |
| Work thrown away | ×2 | ↑↑↑ none — (i) ⊂ (iv) | ↑↑ none, but no new ground | ↓↓ the pdf.js viewer |
| A2 runway | ×2 | ↑↑↑ a year of roadmap | ↑ incremental | ↑↑↑ if it ever lands |
| Risk of a broken demo on 21 Sep | ×3 | ↑ real, mitigated by the day-3 gate and `ScriptedClient` | ↑↑↑ low | ✗ certain |
| **Verdict** | | **Recommended, with the day-3 gate** | **The floor, and the fallback** | **Do not attempt** |

**The external support for P, in one line each, for the report's Step 2 and Step 3.**
§C16 (CHI 2026): integrated margin notes were **preferred over a chat sidebar**, learners
**preferred selecting the passage themselves**, and less AI involvement produced **more
ownership** — three findings that map onto the pivot, onto "no pre-annotation" (§B4d), and onto
DG1. §C17: **multi-agent** in-situ exchange beat single-agent on engagement and perspective
comparison, and beat no-agent on critical thinking — the only citation anywhere that answers
"why two agents in a margin?". §B (Houde et al., IUI '25): ship learner-operable participation
controls or the agents will dominate. §C0: nobody ships the anchored thread as an object.

**Why P over N despite N being safer.** Three of the reviewers' four complaints reduce to "the
pane that carries the product was never put back". Option N puts a chat pane back. Option P
removes the need for one: if the conversation lives in the document, there is no third pane to
miss, no split to balance, and no "which of these two things am I looking at". The pivot is the
cheaper fix to the UX problem as well as the more interesting product — and it is cheap **only**
because the conversation engine is already built and indifferent to where its output is drawn.

---

## H. Open questions for Lucas

Six, ordered by how much rides on the answer.

1. **Do the three interviews contain anything about the split-screen workflow itself?** Any quote
   about copy-pasting between a PDF and a chat window, losing track of which answer went with
   which slide, or the answer ending up somewhere other than the material. If yes, the pivot is
   user-grounded and becomes the strongest paragraph in Step 1. If no, it is a designer-led Step-3
   decision and must be written as one — the 4.0-mark criterion is explicit about "direct user
   quotes". **Four marks turn on this answer.** (§F4)

2. **Is item (1) — *ask → insert* — meant to be the graded interaction or the entry gesture?** As
   written it is a one-shot retrieval that supplies understanding to the learner, which is the
   difficulty the project exists to treat and the opposite of DG1. This document assumes it is the
   hook and that items (2)–(4) are the interaction. Confirm, because if item (1) leads the video
   the report argues against its own design goal. (§A3, §F3)

3. **What replaces "a round"?** A round is temporal; a document is spatial. The ≤2 silence fires
   per round, the S2 disagreement quota window, the ledger gate and the whisper-clearing rule all
   hang off it. Recommend: **a round is a page or a marked page range.** Needs your call, because
   it changes the timer, the ledger and the recap at once. (§E1)

4. **Does the whisper stay ephemeral?** `design-brief.md` §D5 clears it at the end of a round, on
   Dennis et al.'s ephemerality; a document that saves state saves everything. Either private
   notes are the one layer deliberately not persisted — which is defensible and worth a sentence
   in the report — or ephemerality is dropped and DG4's grounding weakens. Do not let this be
   decided by the schema. (§A0, §E1)

5. **Must the A1 video show the document, or is the chat acceptable for A1 with the pivot as the
   Step-3 plan?** This is the whole risk decision. If the answer is "the chat is acceptable",
   Option N is strictly safer and the pivot becomes a clean A2 story. If the answer is "the video
   must show the document", Option P with the Thursday gate is the plan. (§G)

6. **Does the annotated document need to leave ChatterED?** If a student must hand a marked-up PDF
   to a tutor, or open it in Preview or Zotero, that forces `pdf-lib` write-back into PDF
   `/Annot` objects and a lossy export path. If it only has to survive reopening in ChatterED and
   syncing through OneDrive, a SQLite source of truth plus a JSON sidecar is enough and is a day
   cheaper. (§D6)

---

## Appendix — what this document does not settle

- **The silence timer's new definition of idle** (§E1) is the one mechanic the pivot genuinely
  makes harder, and the proposal here — no keystrokes, no new selection, no scroll, scoped to the
  open thread — is an untested guess in the same way 45 s was. `interview-guide.md` §6b already
  asks participants for a tolerance number; ask it again about reading rather than chatting.
- **Whether a margin thread reads as a conversation to a first-time user at all**, or as a pile of
  comments. Koala's participants predicted threading would help and then found it hurt (§B1). This
  is the first thing to put in front of a person, and it needs no build — a printed page with
  sticky notes answers it in ten minutes.
- **Anchor durability across a real semester**, where lecturers re-upload slides with an extra
  page inserted at the front. §D5 is a policy, not yet a measurement.
