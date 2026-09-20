# The video: 14 beats, under 10 minutes

**Re-cut 19 Sep 2026 for #48**, against `docs/research/collab-doc.md` §7. This file is now the
source of truth for the video; the version extracted from `flow-build-plan.md` §2 filmed the attempt
loop on slide crops, which #48 replaced. (`tools/make-submission-zip.sh` ships this file as it is.)

**Deck:** `Academia/Sources/CS3249+Lecture+4.pdf`, the module's own Week 4 lecture on prototyping
CUIs, 66 slides. **Backend:** live (the local Claude CLI, Sonnet 5). **Everything on screen is
real.** Ingest the deck **before** filming and film beat 4 on a second, short deck so the viewer
sees an ingest start without waiting through one.

**Filming rules.** (1) Face visible through every talking beat: 1 of the 5 video marks is
ownership, and the brief asks for it. (2) One window, three columns, no cuts inside a beat. (3) The
learner's lines are typed live, not pasted. (4) A live model will not say the same words twice: the
*rules* are what is being demonstrated, so narrate the rule tag under each turn, not the wording.
(5) Set **Settings ▸ Tester pacing** to **Demo** so Ellie's cue arrives about 20 s after Max's question (Study
keeps the design's 2 to 5 minutes), and say so once. (6) Ellie's own answers carry no rule tag by design (a
tag on every turn is a tag on nothing); Max's turns, Ellie's guess and a released answer do. (7) For beat 11,
type into a paragraph that has a `p. N` chip, not into a heading: only text in a section mapped to an
objective is assessed.

**What the rubric's 5 marks want:** one complete multi-turn interaction (2), project-specific
reasoning: the problem, how learner and CUI divide the work, one design decision, one limitation
(2), and evidence that it is yours (1). Beats 1–3 and 13–14 carry the reasoning and need no app:
record them first.

| # | t | Frame | What happens | What is said |
|---|---|---|---|---|
| 1 | 0:00 | Face | Name, module, the task in one sentence. | "One learning task: a student has a lecture deck, a test coming, and wants to understand it well enough to answer questions about it, in their own words." |
| 2 | 0:20 | Face + one slide of numbers | Step 1 in 50 s. | "I interviewed three students and coded six real AI study sessions turn by turn. In five of six, not one learner turn held the learner's own reasoning, and the AI never asked for any. **Whoever asks the question does the thinking, and by default that is the AI.** Two learners did want to be tested and had to build it by hand; one typed 'do not send the answer' and later 'I will attempt the question… increase or reduce the difficulty'. Before that, five of six questions ended in 'answer?', granted every time. The difficulty is **reduced persistence**: the chat gives your attempt no place, and no reason to keep going once it gets hard. **[LUCAS: one interview quote.]**" |
| 3 | 1:10 | Two screenshots | Old shape: deck left, chat right. New shape: file panel, notes, chats. | "Half of them opened by asking for lecture notes, so notes are the artefact. But notes you write *with* two collaborators, like a shared doc, where one of them keeps asking you things." |
| 4 | 1:30 | **App** — ingest, on a short deck | Drop a PDF in. "Ellie is reading the slides…", then the first section appears and keeps filling in. Cut to the Week 4 deck, already ingested. | "Two passes: all the slide text and geometry first, then a model refines it into notes you can read without the slides. It takes about six minutes on 66 slides, and I can ask questions while it writes, so here is one I made earlier." |
| 5 | 2:00 | **Provenance** | Click a `p. 23` chip: the slide opens in the modal. Scroll past an inline diagram. Open the collapsed carousel. | "Every block knows which slide it came from, or says why it was added. In one session I coded, 'all lectures' silently became lectures 7 to 13, and nobody could tell. Diagrams are crops of the real slide, not redrawn." |
| 6 | 2:35 | **Highlight, Ctrl+E, ask** | Highlight a sentence, Ctrl+E, type a question. Ellie answers in chat, citing `p. N`; her green cursor types the missing explanation into the notes. | "I ask at the sentence, not with a screenshot. Ellie answers, and because the notes did not already say it, she writes it in. Green is hers; one click removes it." |
| 7 | 3:20 | **Max asks** | Max's one follow-up appears in chat (tag: *max followup*) and as a red question block in the notes. | "Then the part no AI did in five of six sessions: it asks *me*. One question, by rule, never two open at once. And it lives in the notes until I deal with it." |
| 8 | 3:45 | **I try; feedback; the bar** | Type an attempt. Max: *Partly there*, a `p. N` quote, a follow-up on the gap. Answer again: *Well done*. A bar segment fills; Max's corrected answer is typed under his question. Open the lesson card: "You wrote: '…'". | "A verdict first, then the slide it rests on: in the session I coded the AI's verdict was wrong 11 times in 21 and the learner said 'ok'. You cannot say 'ok' to a quote you can read. The bar filled because *I* wrote that; the card shows my sentence." |
| 9 | 5:00 | **I stall; Ellie's guess** | Next question. Say nothing. Ellie offers a hedged, half-right take (tag: *Ellie's guess*); Max asks whether she is right. | "This is the design decision I most want judged. When I go quiet, I do not get the answer and I do not get nagged. I get a classmate who is half right. Xu and colleagues found people explain more to a peer than to a tutor. She may even be wrong on purpose, and it is never written into the notes." |
| 10 | 5:50 | **I give up** | Type "i don't know". Max gives the full answer, corrects Ellie, the bar does not move. (His next question on that objective is pitched easier; it may not come up on camera.) | "Any way of saying 'I give up' releases the answer, at once, by a rule in code, and earns nothing. And it tells Max the question was too hard. The learner who made AI practice work lowered the difficulty by hand in the same message that set attempt-first. No question is ever left hanging." |
| 11 | 6:40 | **I write in the notes** | Type a sentence of my own into the notes. After a pause Max assesses it; his correction arrives as strikethrough plus red, with Accept and Reject. Reject it: my text is exactly as it was. Toggle **Freeze**. | "Everything here started as AI text, so the agents may rewrite it freely. What I write, they cannot touch: a guard in code turns any change to my text into a suggestion. And what I write counts as an attempt, like a chat answer." |
| 12 | 7:30 | **Private thread + Start** | Open Max's private tab, ask something embarrassing, "insert into the document". Then click the bar, a lesson card, **Start**: Ellie announces the objective, the doc scrolls, she asks me to begin. | "Two quick ones. Private threads: the only way out of them is my own click. And the bar is a way in: each objective is a lesson I can start." |
| 13 | 8:10 | Face | Division of labour. | "I ask, I answer first, I decide when to give up, and I own my text. Ellie writes and explains and thinks aloud as a peer. Max asks, marks, releases, and keeps the notes correct. The rules decide who speaks and whether an answer is due; the model only writes the words. The lecture says the flow becomes the rails in your prompt. Mine are in code, because a prompt is not a contract." |
| 14 | 8:50 | Face | One limitation, and what A2 tests. | "The limitation: the notes are AI-written and re-typeset. Provenance makes them checkable, but nothing verifies them against the slide, and the same is true of Max's quotes. And releasing the answer on any give-up is a bet that an easier question teaches more than a refusal. My transcripts cannot settle that. It is the first thing A2 tests." |

Budget: **9:30**, 30 s under the cap.

**Rehearsed 20 Sep on the real app, live CLI, this deck:** every beat below ran, including 6 to 9
while the ingest was still writing. Ellie answered in 16 s, Max's follow-up came at 28 s, a verdict in
about 12 s, a suggestion on my own sentence in 25 s.

**Fallbacks, in the order they would be needed.** If the live model is slow on the day, beats 6–10
are filmed on the `scripted` backend (same rules, same actor, replayed words) and beat 13 says so
once. If Ellie's cue does not fire on camera, press **Pass** in beat 10 instead and describe beat 9
over the rule tag in the log. If suggestions misbehave, beat 11 shows the guard refusing an agent
edit to my text (the edit lands beside it instead), which demonstrates the same rule.
