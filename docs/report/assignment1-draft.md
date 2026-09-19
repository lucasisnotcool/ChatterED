# Assignment 1: ChatterED, lecture notes you write with two AI collaborators

*Draft for Lucas to edit, rewritten 19 Sep 2026 against `docs/research/collab-doc.md` (#48). The
previous draft (the attempt loop on slide crops) is in git history at `30f39e8`.*

**Two kinds of bracket, neither is submission text.** `[LUCAS: …]` is yours alone: participant
details and what your interviews found. I have not seen the interviews and have written nothing
that depends on them, so you can check the transcript reading against them. `[BUILD: …]` is a fact
the finished build has to supply; I fill those in after the end-to-end run.

**Body word count: 1,822 / 2,000**, counted over Steps 1 to 4 and Limitations, with the brackets and
the architecture figure excluded (Step 1 = 588, Step 2 = 668, Step 3 = 261, Step 4 = 213, Limitations
= 92). That leaves about 180 words for your interview material. If you need more room, the easiest
cuts are DG5 and the last row of the roles table.

---

## Step 1: What remains difficult after AI assistance

### 1.1 Learner and task

I studied how NUS undergraduates revise lecture material with generative AI. I combined two
methods, as the Week 4 lecture recommends: interviews for what people *say*, and observation for
what they *do* (Lee, 2026). **[LUCAS: n interviewed; programme, year, gender per participant
P1…Pn; consent; one sentence on the interview protocol.]** For observation, six students shared a
real study session with ChatGPT, Claude or Perplexity (R1 to R6). I coded all 152 turns with a
codebook built on ICAP (Chi & Wylie, 2014) and tutorial dialogue moves (Graesser et al., 1995); a
second, independent coder agreed at κ = 0.90 to 1.00 on the dimensions used here.

The task: *a student has a lecture deck, a test coming, and wants to understand the deck well
enough to answer questions about it.* Today that is the deck in one window and a chat in another,
with slides carried across as screenshots. Three of six sessions opened by asking the AI for
lecture notes.

### 1.2 The difficulty: reduced persistence

**In an AI study chat, whoever asks the question does the thinking, and by default that is the
AI.** In five of six sessions, none of 31 learner turns contained the learner's own reasoning, and
no AI turn asked for any. One learner typed 41 words against the AI's 3,829; four of their turns
were a bare slide image. The hard questions were handed over whole: "Why is C not independent of
F?", never with a guess attached.

Two learners did ask to be tested, and had to engineer it. One wrote "do not send the answer with
the question", and later "I will attempt the question, and based on my attempt, you can either
increase or reduce the difficulty." Before that message, five of six practice questions ended in
"answer?" or "please solve the question", and every request was granted in full, at once. After
it: 17 attempts and two requests, both after more than 100 minutes, one with "this query seems too
complex".

So the brief's **reduced persistence** fits, in a specific form: *the conversation gives the
learner's attempt no place, and no reason to be sustained once the question gets hard.* The same
message set two things, attempt-first and lower difficulty, so persistence here tracks difficulty
at least as much as it tracks a withheld answer.

**[LUCAS: what the interviews say about this. Did they try before asking? Why do they ask for the
answer: too hard, no time, habit? One or two verbatim quotes. If the interviews disagree with the
transcripts anywhere, say so here; a discrepancy is a finding.]**

### 1.3 User needs

- **N1, a place for my own attempt.** The chat never asks, so nothing can respond to what I think.
- **N2, questions I can actually answer.** A question pitched too hard is handed back; the learner
  who succeeded lowered the difficulty by hand.
- **N3, feedback I can check, worked through before the next question.** Once that learner
  attempted, 11 of 21 AI verdicts were wrong, each refuted by running the query, nine calling a
  correct answer wrong; the learner replied "ok". 17 of 21 feedback turns also carried the next
  question, and no later attempt was ever a second try.
- **N4, notes I can trust.** One session's "all lectures" silently became lectures 7 to 13;
  another claimed "97% concept coverage" after its own check failed.
- **N5, answers sized for reading.** Seven of eight follow-up questions repaired the AI's previous
  answer ("What does it mean to marginalise a probability?"); replies ran 159 to 1,190 words.
- **[LUCAS: any need the interviews add, or drop one the interviews contradict.]**

### 1.4 Potential CUI support

A conversation can hold the shape those two learners built by hand: ask first, wait, offer
something to improve on instead of the answer, lower the question when it was too hard, and keep
the result somewhere it can be checked. That is what ChatterED makes the default.

## Step 2: The learning goal and the CUI's role

### 2.1 Learning goal and progress

**The learner can answer a question about the lecture in their own words, and revise that answer
after feedback.**

Progress is a bar of learning objectives derived from the slides. An objective fills only on the
learner's own words: Max's verdict *Well done* completes it and *Partly there* half-fills it,
whether the words were typed in the chat or written into the notes. A released answer, a peer's
help and "ok, makes sense" fill nothing. Each objective opens as a lesson card with its evidence:
the learner's own sentence.

### 2.2 Roles

| The learner | The CUI |
|---|---|
| Asks; answers Max's question first, in their own words | **Ellie** writes the notes from the slides and answers the learner's questions; **Max** asks one follow-up |
| Improves on a peer's half-right answer | On silence, Ellie offers an unsure, partial take; Max turns it back to the learner |
| Decides when to give up | Max then gives the full answer, and asks an easier question next |
| Edits the notes freely | Both agents edit the notes live; the learner's text is never overwritten, only *suggested* against |

I stop at two agents: Song et al. (2025) found that normative pressure rises with agent count while
informational influence does not.

### 2.3 Why conversational

A static set of notes, or a quiz app, could hold the same content. Neither can judge a free-text
answer, choose the next question from what it revealed, offer a half-right answer to improve on, or
notice that a learner has given up. Xu et al. (2026) measured the difference responsiveness makes:
121 to 141 cognitive acts per session when explaining to a responsive agent, against 61.

### 2.4 Design goals

**DG1, the learner goes first, and what comes before the answer is a peer.** *Theory:* retrieval
practice with feedback (Rowland, 2014: g = 0.73 against 0.39 without); self-explanation (Chi et
al., 1989); explaining to a peer who is *less* sure than you elicits more than explaining to a
tutor (Xu et al., 2026). *Need:* N1. *Realisation:* Max's question is the learner's to answer;
after a reading-time silence Ellie gives a hedged, partial take, which may hold one plausible
mistake, and Max aims it back at the learner. Users prefer being offered options over being asked
again (Ashktorab et al., 2019).

**DG2, a give-up lowers the question, never the learner.** *Theory:* contingent tutoring: more
help after failure, less after success (Wood, Bruner & Ross, 1976); a global escape must be
reachable from every node of a dialogue (Moore & Arar, 2019). *Need:* N2. *Realisation:* "I don't
know", in any phrasing, releases Max's full answer at once, fills no progress, and makes the next
question easier. No question is ever left unanswered.

**DG3, feedback shows its grounds and is finished before the next question.** *Theory:* trust is
calibrated only when the basis of a judgement is visible (Lee & See, 2004). *Need:* N3.
*Realisation:* a verdict first, each point quoted from the slide as `p. N: "…"`, a follow-up on the
*same* question, and one open question at a time. Max's corrected answer is written into the notes
under his question.

**DG4, notes with provenance, and the learner's text is sovereign.** *Theory:* appropriate
reliance again (Lee & See, 2004); Joshi & Vogel (2026) found lower AI involvement gives stronger
ownership, which an AI-written document cuts against, so the counterweight is a hard rule.
*Need:* N4. *Realisation:* every block links to its slides or states why it was added; agents
address blocks, and a code-side guard turns any change to learner-written text into an
accept-or-reject suggestion.

**DG5, replies sized for reading; length lives in the document.** *Theory:* Grice's maxim of
quantity; Xu et al. held replies near 80 words; adults read about 238 wpm (Brysbaert, 2019);
two-second replies read as less thoughtful (Tan et al., 2026). *Need:* N5. *Realisation:* chat
turns aim at 120 words, feedback under 100; silence thresholds scale to the last turn's reading
time.

Each goal names what would falsify it (Lee, 2026); Appendix F lists the A2 tests.

## Step 3: Implementation plan

**Form.** A hybrid CUI+GUI desktop app, *file panel · document · chats*: Electron, Svelte 5,
TypeScript, ProseMirror, SQLite, local on macOS.

```
 PDF ─► ingest: extract text + geometry ─► LLM refine (with slide images) ─► notes doc (blocks + provenance)
 learner ─► chat ─► RULES (who speaks, is an answer due, is it a give-up) ─► LLM writes the turn
                          └─► doc-edit call: outline of nearby blocks ─► block-addressed ops
 renderer: GUARD (learner text?) ─► apply as typing, or as a suggestion ─► save ─► progress bar
```

**The rails are code.** The lecture's advice for LLM prototypes is that "the flow becomes the rails
in your system prompt; the model fills in the language" (Lee, 2026). I go one step further: the
rails are rules in an orchestrator, checked before any model is called, because the evidence asks
for a contract and a prompt is not one. Houde et al. (2025) reached the same conclusion for
multi-agent chat: "we resorted to using external decision logic."

**What I build**, each carrying a design decision: (1) the turn classifier, including the give-up
phrases taken from the observed sessions; (2) the rules: who answers, Max's follow-up, Ellie's cue
once per question, release, closure; (3) pitch inputs from recent verdicts; (4) the document model:
blocks with provenance, a per-span author mark, the learner-text guard and suggestions; (5) the
two-pass ingest and its validation, which rejects any block with no provenance; (6) progress as a
pure function of recorded verdicts.

**LLMs at runtime** (Claude Sonnet 5 through the local Claude CLI, or an API key): the notes, the
words of each turn, Ellie's cue as a structured reply that declares whether it contains a mistake,
the doc-edit plan, and the coding of learner evidence. **LLMs to build:** scaffolding, tests and
research synthesis, under my decisions; every rule and threshold is mine and dated in the issues.
Against the lecture's fourth trap, the model is pinned and every transcript logged.

## Step 4: The prototype

A running app, on CS3249's own Week 4 deck (66 slides). **[BUILD: ingest time and block count.]**

1. **Open.** The deck becomes lecture notes that read without the slides; each block carries a
   `p. N` chip that opens its slide, and diagrams appear inline as crops of the original.
2. **Ask.** I highlight a sentence, press Ctrl+E and ask. Ellie answers in the chat, and her cursor
   types the missing explanation into the notes in green.
3. **Max asks.** One follow-up appears in the chat and, in red, as a question block in the notes.
4. **I try.** Max answers *Partly there*, quotes `p. N`, and asks a follow-up on the gap. I answer
   again: *Well done*. The objective fills, with my sentence as its evidence, and Max's corrected
   version is written under his question.
5. **I stall.** On the next question I say nothing. Ellie offers a half-right guess; Max asks
   whether she is right. I type "I don't know": Max gives the answer, corrects Ellie, fills
   nothing, and his next question is easier.
6. **I write.** I add my own sentence to the notes. Max assesses it as an attempt, and his
   correction arrives as a strikethrough suggestion I accept or reject. Nothing of mine is
   overwritten; *Freeze* stops all agent edits.

**[BUILD: what is live in the filmed build, and anything that is not.]**

## Limitations

Six observed sessions, one contributing 59% of turns; the second coder is a model. **[LUCAS: limits
of the interviews.]** The notes are AI-written and re-typeset: provenance makes them checkable, but
nothing verifies them against the slide in code, and the same holds for feedback quotes. Releasing
the answer on any give-up is a bet that a lowered question teaches more than a refused answer; no
evidence here settles it, and it is A2's first test. Ellie's deliberate mistake risks a learner who
reads it and leaves; a closure rule corrects it, but only inside the app.

---

## References

Ashktorab, Z., Jain, M., Liao, Q. V., & Weisz, J. D. (2019). Resilient chatbots: Repair strategy
preferences for conversational breakdowns. *CHI '19*.

Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading
rate. *Journal of Memory and Language*, 109, 104047.

Chi, M. T. H., et al. (1989). Self-explanations: How students study and use examples in learning to
solve problems. *Cognitive Science*, 13(2).

Chi, M. T. H., & Wylie, R. (2014). The ICAP framework: Linking cognitive engagement to active
learning outcomes. *Educational Psychologist*, 49(4), 219–243.

Graesser, A. C., Person, N. K., & Magliano, J. P. (1995). Collaborative dialogue patterns in
naturalistic one-to-one tutoring. *Applied Cognitive Psychology*, 9(6).

Grice, H. P. (1975). Logic and conversation. In *Syntax and Semantics 3: Speech Acts*.

Houde, S., et al. (2025). Controlling AI agent participation in group conversations. *IUI '25*.
arXiv:2501.17258.

Joshi, A., & Vogel, D. (2026). Designing and evaluating AI margin notes in document reader
software. *CHI '26*. arXiv:2509.09840.

Lee, J. D., & See, K. A. (2004). Trust in automation: Designing for appropriate reliance. *Human
Factors*, 46(1), 50–80.

Lee, Y.-C. (2026). *CS3249 Lecture 4: Prototyping conversational user interfaces.* National
University of Singapore.

Moore, R. J., & Arar, R. (2019). *Conversational UX Design.* ACM Books.

Rowland, C. A. (2014). The effect of testing versus restudy on retention: A meta-analytic review of
the testing effect. *Psychological Bulletin*, 140(6), 1432–1463.

Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Multi-agents are social groups. *Proc.
ACM Hum.-Comput. Interact.*, 9(7), CSCW452.

Tan, F. F.-Y., Messerschmidt, M. A., Yin, W., & Nov, O. (2026). The impact of response latency and
task type on human-LLM interaction and perception. *CHI '26*.

Wood, D., Bruner, J. S., & Ross, G. (1976). The role of tutoring in problem solving. *Journal of
Child Psychology and Psychiatry*, 17(2), 89–100.

Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who you explain to matters: Learning by explaining
to conversational agents with different pedagogical roles. *CHI '26*.

**Appendices (excluded from the count):** A, the demonstration script; B, the document schema and
the guard's test cases; C, the rules table (`collab-doc.md` §4.2); D, consent text and interview
guide; E, the transcript study: codebook v1.3, coded turns, agreement, metrics, the SQL execution
checks, and the transcript-only convergence note; F, what would falsify each design goal, and the
A2 test for it.

---

## Notes for Lucas

*Not part of the submission.*

**What only you can supply:** the participant line in 1.1, the interview paragraph in 1.2, any
interview-derived need in 1.3, and the interview limitation. The rubric's 4-mark criterion names
programme, gender or year of study explicitly.

**Check before you trust a citation.** These I took from the repo's own briefs and source texts
(verified there): Xu et al., Song et al., Tan et al., Houde et al., Joshi & Vogel, Rowland, Lee &
See, Brysbaert, Chi, Graesser, and the Week 4 deck itself (rails, global escapes, the four traps,
"combine two" methods, goals that name what would falsify them). **These four I cited from
memory and you should open before submitting:** Wood, Bruner & Ross (1976), Ashktorab et al.
(2019, quoted on the lecture's repair slide), Moore & Arar (2019, cited on the lecture's flow
slide), Grice (1975, named on the lecture's dialogue slide). The claim attached to Xu et al. in
DG1 (a less-sure peer elicits more than a tutor) should be checked against
`Academia/Sources/_text/who-you-explain-to-matters.txt` for the exact comparison before it goes in.

**Claims corrected from the previous draft**, per `convergence.md` §5: "every offer to quiz was
declined" is gone (quiz offers appear twice, in boilerplate); the 4→17 / 5→2 contrast now states
its difficulty confound; "no attempt visible" is no longer read as "no attempt"; N2 is difficulty
calibration (observed), not progress tracking (self-report).

**Where the design departs from the evidence**, stated in Limitations because a grader will see
it anyway: the answer is no longer locked behind an attempt; the document is AI-written.
