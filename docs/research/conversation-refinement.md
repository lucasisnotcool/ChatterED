# Conversation refinement: the Teacher answers first, and the thread becomes the artefact

Issue #41, three transcripts on the CS3263/CS4246 *Markov Decision Process* deck. Lucas's own
verdict: **"prompt to satisfaction: 3"**, and **"it seems like reference is getting in the way"**.
This brief says which step produced each useless turn, then specifies the five changes. It extends
the Teacher contract v0.3 (#36) and the silence policy (#37); it does not reopen either.

## 1. Diagnosis — one step, three times

All three chains open the same way: `flow:askHere` → `RoomActor.askHere()` →
`buildReferenceRequest()` → the REFERENCE card, with the thread then **locked** to Ellie and Max by
`rule:reference_locked` until *Explain it back*. Every wasted turn in #41 is downstream of that one
decision about **who answers the entry question**.

**T1 — "Can you give me some background on MDP", on the title slide.**
`guessScope()` sees an anchor and no deck verb, so the scope is `segment`;
`segmentContext()` supplies the title slide's dozen words; `referenceSystemBlock`'s segment rule
says *"Answer from the passage… you may not answer from a heading you have not been given the text
of"*. The only contract-honouring answer is the one he got: *the passage contains no further
content*. That is not a prompt bug — it is the prompt working. The bug is that a **concept**
question was routed to a **passage** voice. Turn 2 ("But what is the background of MDP?") bought
nothing except reaching Ellie, whose first turn was already good.

**T2 — "What are some examples of classical planning?"**
Same step. REFERENCE restated the slide's characterisation, correctly, because its contract says
*"State the definition, the distinction or the fact… in the terms the material itself uses. Prefer
the general statement to a worked example."* The learner's reply — *"you are justing reading the
slides back to me"* — is a verbatim description of that clause. Ellie then satisfied him on her
first turn, but had to open by repairing a failure that was not hers (*"Fair — let me actually give
you concrete examples"*). Lucas's question — could Ellie have been fine-tuned? — is answered by
(c): *"what are some examples of X"* should reach the example shape without a complaint first.

**T3 — "what is stochastic?"**
Same step again. REFERENCE is licensed to adopt the material's *"level of formality"*, and with no
model of the learner it adopted the slide's: the transition-model paragraph. The learner then had
to write the **explanation shape** himself — *"explain stochastic as a concept, what it means, then
the rigorous version, mathematical properties etc."* Owning that shape is the Teacher's job, not the
learner's. Two further faults visible here: nothing anywhere records that this learner asked for a
lower pitch twice on this file, and the raw `**` around **Non-negativity** reached the screen —
`HOUSE_RULES` 8 covers maths and says nothing about markdown, and the renderer prints `body` verbatim.

**The common cause.** REFERENCE was made the entry answer for a persona-contract reason
(`pivot-spec.md` §B1: *"Ellie may never supply a complete correct explanation"*). #32 retired that
Peer contract and #36 replaced it with **ANSWER FIRST, THEN TEACH**. The reason is gone; the routing
survived it.

## 2. (a) Teacher-first Ask

**"+ Ask here" and "Ask about this deck" open the thread and the Teacher answers it directly.**
`flow:askHere` / `flow:askDeck` write the learner's question and run an ordinary Teacher turn
(`rule:teacher_answers`, move `answer_then_teach`) on that anchor. Unchanged: the 3–8 s floor-yield
and the latency floor; the ledger's verbatim-evidence rule; the flow session; the hand-off; the
`objectiveId` chip tagging the whole thread. Deleted: the REFERENCE entry card, the per-anchor lock,
and with it `explainBack` — the gate it opened is now open by construction. `flow:explainBack` stays
as a logged no-op for one release so an older renderer does not throw.

The *scope* machinery survives whole: a deck question still answers from the whole deck, and
`scopeShown` still travels on the message.

## 3. (b) The learner model block

A new `learnerBlock()` in `prompts.ts`, emitted after the last cache breakpoint beside
`taughtBlock()` — volatile data, never in `system[0]`. It carries, for **this file**:

1. **Objective states** from `ObjectivesRepo.states()` — online (level ≥ 2) listed as *known*,
   stated (1) as *partly*, untouched (0) as *not yet seen*.
2. **Prerequisites marked `assumedByDeck` and untouched** — named as *assume they have not met this*.
   That is exactly the population #36's *Teach me this* exists for, and the Teacher should not wait
   for a click to teach around one.
3. **Evidence quotes** from the ledger — the learner's own words, verbatim, which is the only
   evidence that has ever moved a row.
4. **This thread's signals**, from `src/room/pitch.ts`: *"simpler"*, *"ELI5"*, *"no idea"*,
   *"too complicated"*, *"you're reading the slides back"* lower the pitch for this file **and it is
   remembered**; *"rigorous"*, *"formally"*, *"prove"* raise it.
5. **A default of "assume less"** when there is no evidence at all — which is the state every deck
   starts in, and the state all three #41 transcripts were in.

Pitch is a small per-file level (`-1 plain` / `0 default` / `+1 rigorous`), persisted with the flow
state and **cleared by `objectives:reset`**, since it is a claim about the same learner-on-this-deck
the tree is.

## 4. (c) The default explanation shape

Added to the Teacher's role block (`PROMPT_VERSION` → `prompts.v0.4`, snapshot tests updated
deliberately). When the turn teaches a concept, the shape is:

> **name it → plain-language meaning → one concrete example or analogy → the rigorous version and
> its properties → how the slide uses it.**

And the prohibition that #41 T1/T3 needed: **never open with a summary of the slide when the
question is "what is X"** — the slide is where the answer *lands*, not where it starts. The learner
may compress or reorder the shape by asking; nothing else may.

## 5. (d) The artefact

**"Summarise into the document"** on any thread → `flow:summarise(threadId)` → one **summary card**:
`kind: 'summary'`, REFERENCE register, **≤ 150 words capped in code** (the same argument as §B1's
120: a cap a model is asked for is a cap exceeded on camera), KaTeX maths, written **from the
thread** and not from the slide, inserted under the segment, carrying `sourceThreadId`.

- **Retrievable** — `flow:threadOf(summaryId)` returns the source thread; clicking the card expands
  it beneath.
- **Continuable** — the card's composer posts into that same thread.
- **Regenerable** — summarise again, replacing the card.
- **Offered, never inserted.** After a thread reaches ≥ 2 Teacher turns with a taught objective,
  `rule:offer_summary` posts one line offering it, at most once per thread. R1 holds: nothing
  enters the learner's document without the learner.

This is Lucas's item 2 and 3 exactly: *"these artifacts help the user review and recall, without
having to go through the conversation again"*, and the conversation behind one stays reachable.

## 6. (e) What happens to the old answers, and to §B1

**Migration.** Existing REFERENCE `answer` messages become `summary` cards with `sourceThreadId` =
their own anchor, and the now-meaningless hand-back line is dropped from the body. The `answer` kind
stays in the union and stays readable, so nothing in an old transcript disappears.

**`pivot-spec.md` §B1, claim by claim:**

| §B1 claim | Status |
|---|---|
| The entry answer to "+ Ask here" is a system-voiced REFERENCE card | **Superseded.** The Teacher answers. |
| *"Why the answer is system-voiced"* — the persona contract | **Retired**, with the Peer contract it rests on (#32, #36). |
| The thread is locked until *Explain it back* | **Superseded.** No lock; `explainBack` is a no-op. |
| An answer block can never move a ledger row (R5) | **Unchanged.** Evidence is still a verbatim substring of a learner message. |
| A REFERENCE-register block is a durable artefact in the document, capped in code | **Survives**, as the summary card — the one idea of §B1 that was always right. |
| R1: nothing is inserted without the learner | **Unchanged**, and is why the summary is offered, not auto-inserted. |

`pdf-fidelity-segmentation.md` §C4 (AI segments are typeset and visually distinct from crops) is
**unchanged** and is what the summary card renders as.

## 7. Markdown in AI turns

The model emits `**bold**` and numbered lists; the renderer prints them raw. Two options: forbid
markdown in the prompt, or render a safe subset. **Render it** — the lists and emphasis are load-
bearing in every good reply in #36, #37 and #41, and a prompt-side ban would be a fifth rule
competing with four that ask for structure. The prompt names the allowed subset: **bold, italics,
numbered and bulleted lists, inline `$…$` and display `$$…$$` maths — no headings, tables, links,
images, code fences or raw HTML.** The renderer implements exactly that subset (`aitext.ts`),
escaping everything else.
