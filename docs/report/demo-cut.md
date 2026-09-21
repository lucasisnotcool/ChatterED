# The demonstration: 60 seconds, Table 3 end to end

Written 2026-09-21. **This supersedes `shoot-plan.md` §4 for the interaction itself** — that file
still governs machine setup, app state and the shoot-day traps, which all still apply. The target
is the rubric's *"one complete, multi-turn CUI learning interaction from beginning to end"*, and
the source is Table 3 of `assignment1-draft.md`. Everything else in the ten minutes is yours to
talk over.

Dry-run evidence for everything below: `app/src/room/demo.table3.test.ts`, which walks the chain
through the real actor. Run it with the transcript showing:

```sh
cd app && DEMO_PRINT=1 npx vitest run src/room/demo.table3.test.ts --disable-console-intercept --reporter=verbose
```

---

## 1. What the dry run established

The rule chain Table 3 describes is the rule chain the app produces. Walked on the real actor,
real timer, real thread registry, real doc-edit call:

| Table 3 | Learner types | Rules that fire |
|---|---|---|
| 2 + 3 | *what is the side channel?* | `rule:ellie_answers` → `rule:max_followup` |
| 6 | *(nothing)* | `rule:ellie_cue` → `rule:max_prompt` |
| 4 | *the learner pays it, when they decide to forward* | `rule:quiz_feedback` → **Partly there** |
| 7 | *i don't know* | `rule:answer_released` |
| — | *what does forwarding cost?* | `rule:ellie_answers` → `rule:max_followup` (the loop reopens) |

**Pacing, asserted rather than quoted.** On *Tester pacing ▸ Demo*, Ellie's guess arrives **20 s**
into a silence and Max turns it back at **35 s**. On Study it is 120 s and 210 s. Step 6 is
therefore the only step whose real duration you cannot edit away without editing away the design
itself — see §3.

**One finding that changes the shoot.** `script.notes.ts` has exactly one chat verdict beat, and
it is *Partly there*. Its only *Well done* is `doctext:1`, which fires when the learner writes
into the **notes**. So Table 3 step 5 — *"answers again → Max says Well done"* — is filmable on a
**live model only**. On the scripted backend the *Well done* has to come from step 8 instead.
There is now a test that fails if anyone adds a `feedback:2` and forgets this.

**The lines are gate-checked.** The sentence you type into the notes has to clear `docTextGate`
— eight content words, a terminator, and a block mapped to exactly one objective — or the pause
produces nothing and the take is dead with no error on screen. The line below is asserted to pass,
and asserted to fail in a block with no objective, which is why the rule is *type under a `p. N`
chip, never into a heading*.

---

## 2. The line sheet

Type these. Do not improvise: three of the five have to clear a gate in code.

| # | Where | Exactly this |
|---|---|---|
| 1 | Chat, after ⌘E on a sentence | `what is the side channel?` |
| 2 | Chat, answering Max | `the learner pays it, when they decide to forward` |
| 3 | Chat, answering the follow-up | *(live take only — your own fuller sentence, naming **who** carries the cost)* |
| 4 | Chat, on the next question | `i don't know` |
| 5 | **In the notes**, in a paragraph with a `p. N` chip | `The forwarding decision belongs to the learner, so the privacy cost lands at the moment they choose to forward.` |

Line 3 is deliberately not scripted: it is the revision the learning goal is about, and it has to
be yours. Line 5 is verified to be assessed only once the full stop is typed, so let the sentence
finish before you stop typing.

---

## 3. The cut — 60 seconds

`[cut]` is where a wait is removed. Everything else is continuous.

| t | s | Table 3 | On screen | The wait removed |
|---|---|---|---|---|
| 0:00 | 4 | 1 | Deck in the file panel → notes render, `p. N` chips visible | — |
| 0:04 | 9 | 2 | Highlight a sentence, **⌘E**, type line 1, send `[cut]` Ellie answers in chat citing `p. 3`; her green cursor types the explanation into the notes | 16 s |
| 0:13 | 6 | 3 | Max's follow-up in chat, tagged `max followup`, and the same question as a **red block in the notes** | 28 s |
| 0:19 | 8 | 4 | Type line 2 (speed-ramped ×2) `[cut]` **Partly there**, `p. 5: "…"`, and a follow-up on the gap | 12 s |
| 0:27 | 8 | 5 | Type line 3 (ramped ×2) `[cut]` **Well done**; a bar segment fills; Max's version written under his question | 12 s |
| 0:35 | 9 | 6 | Next question. **Hold the real silence for 6 s**, then Ellie's guess chipped *"Ellie's guess — she might be wrong"*, then Max turns it back | 14 s of the 35 |
| 0:44 | 6 | 7 | Type line 4 `[cut]` Max releases the full answer, corrects Ellie — **hold on the bar not moving** | 12 s |
| 0:50 | 10 | 8 | Type line 5 into the notes `[cut]` Max's correction arrives as strikethrough + red with **Accept · Reject** → press **Reject** → your text is byte-identical | 25 s |
| 1:00 | | | | |

**Raw footage this needs:** about 3 m 40 s of continuous recording, of which 2 m 20 s is dead air
and typing you cut or ramp. Shoot it as **one take** and cut inside it — do not shoot eight
separate takes, or the app state drifts between them and the notes stop matching.

**Why step 6 keeps its silence.** Every other wait is incidental model speed and is worth nothing
on screen. The silence in step 6 *is* DG1 — the threshold is reading time, and Ellie only speaks
because the learner did not. Cutting it to zero would show a peer interrupting, which is the
opposite of the design. Six seconds reads as a pause; the full 20 does not survive a 60-second cut.
Say the number in your voiceover and the honesty is intact.

---

## 4. The doc-change modes — B-roll for the explanation

You asked for footage of the learner editing the document directly, asking the agents about it,
and the other ways the document changes. **All eight exist and are wired — nothing needs
building.** Shoot each as a 6–10 s clip on its own; they belong in the eight minutes where you
talk, not in the 60-second cut, which already carries five of them.

| # | Mode | How you trigger it on camera | Where it lives |
|---|---|---|---|
| 1 | **Ellie writes an explanation in** — green, with **Remove · Keep** | ⌘E on a sentence, ask something the notes do not already answer | `docstore.applyAgentEdit`, `removeAgentEdit` / `keepAgentEdit` |
| 2 | **Max's question block** — red, stays until it is dealt with | Let `rule:max_followup` fire | the actor's `doc.edit` batch |
| 3 | **Max's corrected answer, written under his question** | Any resolution: *Well done*, a release, or closure | the `resolve_q` op |
| 4 | **The learner types directly into the notes** | Type a sentence in a block with a `p. N` chip, then pause | `#reportDocText` → `docTextGate` |
| 5 | **That sentence assessed as an attempt** | The gate passes; Max marks it like a chat answer | outcome with `source: 'doc'` |
| 6 | **An agent tries to change your text → a suggestion** | Let Max correct line 5; strikethrough + **Accept · Reject** | the guard, `applyAgentEdit` → `rejected_guard`, `resolveSuggestion` |
| 7 | **Freeze** — every agent edit stops | Toggle **Freeze**, then ask something and show nothing lands | `docstore.setFrozen` |
| 8 | **Insert into the document** — a private turn becomes a shared card | Ask in Max's private tab, press **Insert into the document** | `PrivateThread.svelte` |

Modes 1, 2, 3, 4 and 6 are already in the 60-second cut. **7 and 8 are the two worth shooting
separately**, because they are the two the report argues for and the cut has no room for: Freeze
is the blunt version of DG4's guarantee, and Insert is the only way anything private reaches the
shared document.

Mode 6 is the one to hold longest on screen. Rejecting the suggestion leaving the learner's text
*byte-identical* is what `guard.test.ts` and `suggest.test.ts` assert, and it is DG4's whole claim.

---

## 5. The narration, timed to the cut

The cut is played while you speak, so this is written to be *said*, not read. **146 words, about
60 seconds at a comfortable pace.** Two pause points are marked `‖` — the footage holds fine
there, and they are where to breathe if you are running ahead.

Narrate the **rule**, never the wording: a live model writes different words every take, and the
rule is what you are demonstrating.

| t | Say |
|---|---|
| 0:00 | "The deck, ingested into notes. Every block still points back to its slide." |
| 0:04 | "I highlight a line and ask. Ellie answers short in the chat — and because the notes didn't already say it, she writes the explanation in. Green is hers." ‖ |
| 0:13 | "Then the part missing from five of the six sessions I coded: it asks *me*. One question, by rule — and it lands in the document, not just the chat." |
| 0:19 | "I answer. *Partly there* — with the slide it rests on, quoted. You can't say 'ok' to a quote you can read." ‖ |
| 0:27 | "I answer again. *Well done*, and the objective fills — because I wrote that sentence, not because Ellie explained it." |
| 0:35 | "Next question, I stall. After twenty seconds of reading time Ellie guesses — half right, sometimes wrong on purpose. Max turns it back to me." |
| 0:44 | "I give up. The answer is released at once, by a rule in code. The bar doesn't move." |
| 0:50 | "And what I write myself, they can't overwrite. Max's correction arrives as a suggestion — I reject it, and my sentence is exactly as I typed it." |

If you want the T6 number in: *"in the session I coded, the AI's verdict was wrong ten times in
twenty-one, and the learner said 'ok'"* goes at 0:19 and costs about four seconds — hold the
verdict frame that much longer when you cut.

---

## 6. Two things in the report that no longer match the code

Neither is in the demo's way, but both are in the submitted text.

- **"Nothing in the demonstration is scripted"** (Step 4, last line). True if you shoot live.
  If any part of the cut ends up on the scripted backend, that sentence has to change — and per
  §1, the scripted backend cannot produce step 5 at all, so this is a decision to make before the
  shoot rather than after it.
- **"1,628 tests"** (Step 4; `app/README.md` says ~1,630). The suite is at **1,658** as of today,
  including the eight added by the dry-run harness.
