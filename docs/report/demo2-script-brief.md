# Brief: `demo2-modes.mp4`, for the consultant writing the slides and script

**For:** an outside consultant LLM with **no access to this repository, the app, or the video
file**. Everything needed to write a script is in this document. Companion to
`cui-prototype-brief.md` (why the design is shaped this way) and `cui-interaction-map-brief.md`
(the flow); this one is only about **the second demo clip**: how it was shot, and what is on
screen second by second.

Written 2026-09-22, from a frame-by-frame reading of the finished cut.

**Two constraints before anything else.**

1. **The clip has no audio track.** It is silent screen capture. Every word is voiceover written
   over it, so the script's timing is the only timing.
2. **The deck on screen is the lecturer's** (`CS3249+Lecture+4.pdf`, the module's own Week 4
   slides). It is fine inside coursework submitted to the module. It must not be redistributed —
   no public cut, no trailer, no frames in anything outside the submission.

---

## 0. The prompt to paste

> You are helping me write the narration script and the accompanying slides for a screen-capture
> clip in a university assignment video. The clip is called `demo2-modes.mp4`. It is **1 minute
> 51 seconds**, silent, and shows a desktop app called **ChatterED** running live against a real
> lecture deck.
>
> I am the student who built ChatterED. The video is for CS3249 (Conversational User Interface
> Design) at NUS. The assignment criterion this clip answers is: *demonstrate one complete,
> multi-turn CUI learning interaction, showing active cognitive engagement from the learner,
> tailored feedback, and progressive steps that follow the user's input.*
>
> You have not seen the clip and cannot watch it. The document below gives you: what ChatterED
> is, how the clip was shot, a second-by-second account of what appears on screen, the design
> arguments each moment is evidence for, and an explicit list of things the clip does **not**
> show. Treat that last list as binding — do not write a line of narration describing something
> that is not on screen.
>
> Produce:
> 1. **A narration script keyed to timestamps**, in the format `0:00 | "…"`, written to be
>    *spoken*, not read. Target a comfortable pace of roughly 145–155 words per minute, so about
>    270–290 words for the full 1:51. Mark two or three breathing points.
> 2. **A short slide plan** — no more than four slides — for anything that should appear
>    alongside or before the clip. Say for each slide what goes on it and when it is on screen.
> 3. **A one-line "what this clip proves" statement** I can use as the transition out of it.
>
> Rules for the script:
> - **Narrate the rule, never the wording.** The app runs on a live language model, so the exact
>   sentences differ every take. "Max quotes the slide his verdict rests on" is safe; "Max says
>   'That's precisely the gap'" is not.
> - Name the mechanism, not the vibe. This is assessed on interaction design, not on polish.
> - Be honest about what is not shown. Where the clip is missing something, either say so in one
>   clause or stay off the subject entirely — do not imply it.
> - British spelling. Plain first person. No marketing register.
>
> [paste the rest of this document here]

---

## 1. What ChatterED is, in one paragraph

A macOS desktop app for revising a lecture deck. The deck is ingested into **AI-written lecture
notes**, where every block keeps a link back to the slide it came from. The window is three
panels: **files ▸ the notes document ▸ the chats**. Two agents work in the document alongside the
learner: **Ellie**, a peer who explains (green), and **Max**, a tutor who asks and assesses (red).
Both can write into the notes while the learner watches. The learner's own text is protected by a
check in code: an agent can never overwrite it, only suggest. A progress bar over the deck's
learning objectives fills **only from what the learner wrote**, never from what an agent
explained.

The problem it is built against, from an observational study of six real AI study sessions (152
turns) and three interviews: students put their persistence into steering the AI towards a better
explanation rather than into attempting the material. In five of the six sessions, no learner
reasoning was visible at all.

---

## 2. How the clip was shot

| | |
|---|---|
| File | `demo2-modes.mp4` |
| Duration | **1 min 50.9 s** (3,326 frames at 30 fps) |
| Frame | 1760 × 1148, screen capture of the app window; no letterboxing, no camera |
| Audio | **none** — there is no audio stream in the file |
| Date | 22 September 2026, one afternoon session |
| Source take | `master2.mp4`, **5 min 07.8 s, one continuous unbroken recording** |
| Backend | **A live language model**, through the local Claude CLI. Nothing is scripted or faked: every sentence Ellie and Max produce was generated at capture time |
| Deck | The module's real Week 4 lecture deck, 63 slides, already ingested before rolling |

**What "one take" means here, and why it matters to the script.** The whole 5:07 was recorded in
a single pass with the app in one continuous state. Nothing was re-shot, re-staged or assembled
from separate attempts. The cut removes time; it never rearranges it. Everything the viewer sees
happened in that order, to that document, in that session.

**What was removed.** 3 min 17 s, about 64% of the take, essentially all of it **model
latency** — the app waiting for the live model to produce a reply or a document edit. There are
visible discontinuities (a jump cut or a scroll) at roughly **0:42, 0:45, 1:00, 1:38, 1:43 and
1:49**.

**Typing is speed-ramped.** Measured on the finished cut, on-screen typing runs at about **27
characters per second** (≈ 320 wpm), which is far beyond a human typist. Treat every typing
moment in the clip as faster than it happened. This is worth knowing so the script does not claim
the interaction is quick; it claims the interaction is *shaped*, which is a different point.

**Two deliberate shooting rules, both visible.**

- Every scroll leaves roughly 220 px of the preceding block above the target, so the viewer can
  always see what a block is part of. The first clip scrolled targets flush to the top and read
  as contextless.
- The file panel was collapsed to a tidy course-folder tree before rolling, so no filename
  carrying a person's name is on screen.

**What is deliberately *not* in this clip, because it is in the first one.** A companion clip,
`demo-cut.mp4` (60 s), carries the single-exchange arc: ask → Ellie explains → Max asks → attempt
→ *Partly there* → revise → *Well done* → stall → Ellie's guess → give up → answer released.
Clip 2 exists to show something different: **a loop of turns, and the many ways the document
itself changes.** Do not write clip 1's arc into clip 2's script.

---

## 3. The interface, so you can name things correctly

Get these names right in the narration; they are the vocabulary of the design.

**Layout.** Left: the file panel (course folders, file list). Centre: the **notes document**.
Right: the **chat panel** with three tabs — **Doc chat** (shared, both agents), **Ellie**
(private), **Max** (private).

**In the notes document:**

| What you see | What it is |
|---|---|
| A small grey **`p. 41`** chip beside a paragraph | Provenance. Which slide that block came from. Clicking it opens the slide |
| A **green** left rule on a block, with a gutter label **"Ellie wrote this"** and **Remove · Keep** | Ellie has written an explanation into the notes. The learner can drop it with one click |
| A **red dashed** left rule, header **`MAX ASKED`**, a chip reading **`open`**, a **Remove** control | Max's question, living in the document. It stays until dealt with |
| The chip turning **`open` → `partly yours`** | The state of that question after the learner's attempt was judged |
| An **amber/yellow highlight** on a run of text | The learner's own words. The span the guard protects |
| A small coloured flag mid-paragraph reading **`✎ Ellie`** (green) or **`? Max`** (red) | An agent's cursor, typing into the document **live**, while the learner watches |
| An inline slide image with a caption ending **"— slide 37"** | A real crop of the slide, not a redrawn diagram |

**In the chat panel:**

| What you see | What it is |
|---|---|
| **`by rule · follow-up`** tag on a Max message | The turn was decided by a rule in code, not by the model choosing to speak |
| **`p. 43: "…"`** inside a verdict | The slide the verdict rests on, quoted |
| A quoted-line chip above the composer with an **×** | The sentence the learner selected before pressing ⌘E |
| Composer placeholder **"Ask about this document…"** | Default state |
| Composer placeholder **"Your answer…"**, plus a **Pass** button and the line *"Say I don't know or press Pass and Max will give the answer."* | A question from Max is open. **This is a design goal stated in the interface** and it is on screen for most of the clip |
| Composer placeholder **"Your next attempt…"** with *"Max asked a follow-up on the same question. Answer it here."* | A verdict has landed and the same question is still open |
| **"Max is reading… 5s"** | A deliberate latency affordance, counting down |
| **`Freeze`** pill in the document header | Toggle. When on, every agent edit to the document stops |
| **`Insert into the document`** button under a private reply, becoming **`In the document ✓`** | The only route from a private thread into the shared notes — the learner's own click |

**Seven stills exist**, exported from this take, if the consultant would work better from images
than from prose: the first verdict; the question block with its `by rule` tag; the learner's text
being assessed; *Insert into the document*; the open section; *Partly there* resolved in the
document; and turn 1's verdict. They live beside the video and can be attached to the prompt.

**Telemetry on screen.** Top right shows `session 268k tok`; each message carries e.g.
`42k tok · ≈ $0.065 API-equivalent`. These are a developer readout of tokens and cost. They are
not part of the learning design. The script should ignore them unless it wants to make the point
that the prototype logs every call.

---

## 4. Second by second

Timestamps are from the start of `demo2-modes.mp4`. Where a moment spans a range, the range is
given. Bold marks the thing a viewer should be looking at.

| t | On screen |
|---|---|
| **0:00** | Cold open, mid-session. The notes fill the centre panel; the chat is scrolled to recent turns. Progress reads **`0 of 17`** objectives. In the visible chat scrollback: the learner had asked a *new* question instead of answering, and **Max replied "Not yet."** — *"a genuinely good question, but it's a new one — not an answer to what I asked."* Max holds the learner to the open question rather than taking the new one. |
| 0:04 | The learner is typing a reply in the composer. |
| 0:08 | Their answer is sent: *"the flow diagram was fine, testers just did not know what they were allowed to say."* |
| **0:10** | **The progress bar moves `0 of 17` → `1 of 17`.** This is the only time in the clip that it moves. |
| 0:12 | **Turn 1 verdict: Max says "Well done."** The verdict is followed by his reasoning, which quotes two slides by number — `p. 43` and `p. 47` — with the quoted text shown inline. |
| 0:19 | The learner sends a second, sharper answer, adding the part about latency: *"It was not the branching. They stalled because a paper card cannot show what the system will accept, or how long it takes to answer."* |
| **0:24** | **Turn 2 verdict: "Well done" again**, resting on the same two slides. Note for honesty: **the progress bar does not move.** Both turns answered the same objective. |
| 0:32 | The learner **selects a phrase inside the notes** — *"one repair per turn"* — in a paragraph carrying a **`p. 41`** provenance chip. |
| **0:33** | **⌘E.** The selected phrase appears as a quoted chip above the composer, and the placeholder changes to **"Ask about this line…"**. The question is asked *at the sentence*, not by pasting a screenshot. |
| 0:36 | Typing the question: *"why one repair per turn, and not just handle everything at the end?"* |
| 0:40 | Sent. The learner's message in the chat carries the header **"a line in the document"**, so the quoted context is visible in the thread. **Ellie is typing…** appears, with a **Stop** control. |
| **0:44** | **The payoff shot.** Four things are true in one frame: (a) Ellie has answered *and* **written a new explanatory paragraph into the notes** — green left rule, gutter card **"Ellie wrote this"**, **Remove · Keep**; (b) the source phrase she was asked about is now **highlighted in the document**; (c) **Max's follow-up question has already arrived in the chat, tagged `by rule · follow-up`**; and (d) the composer has switched to **"Your answer…"** with a **Pass** button and the line *"Say I don't know or press Pass and Max will give the answer."* |
| **0:48** | Scroll down. **Max's question is also a block in the document** — red dashed rule, header **`MAX ASKED`**, chip **`open`**. It sits in the notes, not only in the chat, and stays until it is dealt with. |
| 0:52–0:58 | The learner types an answer: *"Because if you wait until the end you cannot tell which turn went wrong, and neither can the user."* |
| **1:00** | Sent. **Max is reading… 5s** — a visible, counted pause before the reply. |
| **1:02** | **Max's verdict is typed into the document, live.** The red **`? Max`** cursor flag is visible mid-sentence as the text lands. The chip on his question block flips **`open` → `partly yours`**. |
| **1:04** | The result, settled: under Max's own question in the notes sits **"Partly there."** and his reasoning — *the general principle is right, but you did not walk through this case* — quoting **`p. 41`**. A second gutter card reads **"Max wrote this — part of this was the learner's."** The composer changes to **"Your next attempt…"**: *"Max asked a follow-up on the same question. Answer it here."* |
| **1:08–1:16** | **The learner types their own sentence directly into the notes** — not into the chat — extending a paragraph: *"Repair belongs on the turn that broke, because a user told only at the end cannot tell which of their answers the system misread."* |
| **1:16** | **The learner's sentence takes an amber highlight** — the app has marked it as the learner's own text. |
| **1:16** | **And it is assessed as an attempt.** Max's response in the chat marks it against the slides: the claim *"belongs with p. 41's 'one repair per turn', not p. 42, which lists repair strategy families instead."* Writing in the document counts exactly as answering in the chat. |
| **1:21–1:26** | **Freeze is switched on**, then off. While it is on, every agent edit to the document stops. |
| **1:27** | The learner switches to the **Ellie** tab — a private thread. The banner reads: *"**Private** — Max can't see this. Ellie can see the document and the shared chat, and won't answer Max's question for you. Nothing here reaches the document unless you put it there."* Placeholder: *"Ask Ellie anything. It stays here."* |
| 1:28 | Typing a question the learner would not ask in front of the tutor: *"in plain words, what is the difference…"* (between two repair strategies). |
| 1:31 | Ellie's private answer streams in. Under it: a button, **Insert into the document**. |
| **1:37** | **Insert into the document is pressed.** The button becomes **In the document ✓**. |
| **1:38** | **Ellie's green cursor flag `✎ Ellie` is visible in the notes**, typing the card in. The gutter reads **"Ellie wrote this — the learner inserted this from…"**, with **Remove · Keep**. The private answer has become a shared card, credited to the learner's own click. |
| **1:43** | Scroll: an **inline slide image** in the notes with the caption *"GUI pipeline (wireframes → mockups → interactive demos) versus CUI pipeline (scripts → dialogue maps → Wizard-of-Oz tests). — slide 37."* Provenance for a diagram: a crop of the real slide. |
| **1:49** | Closing frame: scrolled back to Max's question block, chip reading **`partly yours`**, with **two** *"Partly there"* resolutions stacked under his question and three **"Max wrote this"** gutter cards. The loop, accumulated in the document. |
| 1:50.9 | End. |

---

## 5. What the clip proves — the argument each moment supports

The design has five stated goals. Map narration to these, not to features.

| Goal | The claim | Where the clip is the evidence |
|---|---|---|
| **DG1** | **The learner goes first.** The question is theirs to answer. Whoever asks the question does the thinking, and in ordinary AI chat that is always the AI | Max's *"Not yet."* at 0:00; his follow-up arriving unasked at 0:44 tagged `by rule`; the question living in the document at 0:48; the composer reading **"Your answer…"** for most of the clip |
| **DG2** | **A give-up lowers the question, not the learner.** There is always a way out, and it is stated in the interface | The **Pass** button and its caption, on screen from 0:44 onwards. *(The learner never presses it in this clip — see §6.)* |
| **DG3** | **Feedback shows its grounds, and finishes before the next question.** Only one question is open at a time | Verdicts at 0:12, 0:24 and 1:04, each quoting a slide by number with the text shown; the `open → partly yours` chip; the composer's *"Max asked a follow-up on the same question"* |
| **DG4** | **The notes show their sources, and the learner's text is theirs.** A check in code, not a polite instruction to the model | `p. N` chips throughout; the amber highlight on the learner's own sentence at 1:16; the slide crop at 1:43; **Freeze** at 1:21 |
| **DG5** | **Chat turns are sized for reading; length lives in the document.** Short replies in the chat, long explanations written into the notes | Ellie's short chat answer versus the full paragraph she writes into the notes at 0:44; Max's verdict written into the notes at 1:02 |

**The three claims this clip carries better than any other footage:**

1. **The conversation and the document are the same object.** Answering in the chat and writing
   in the notes are the same act — 1:08 to 1:16 is the proof.
2. **The agents edit the shared artefact while you watch, and you keep control.** Every agent
   edit arrives with **Remove · Keep**; **Freeze** stops all of them; a private answer reaches
   the document only by the learner's own click.
3. **The loop keeps handing the question back.** Four learner turns, and after each one the
   question is still the learner's.

---

## 6. What the clip does **not** show

Binding. Do not write narration that describes, implies, or gestures at any of these.

- **No "Not yet → revise → Well done" recovery arc.** Max accepted turns 1 and 2 outright. The
  revision arc is in the *other* clip.
- **No silence beat, and no Ellie's guess.** The design says that after a reading-time silence
  Ellie offers a hedged, half-right take for the learner to improve on. **The learner never
  stalls in this clip, so this never fires.** It is the single most distinctive thing about the
  design and it is not here. It is in clip 1.
- **No give-up and no release.** The **Pass** button is visible the whole time and is never
  pressed. Nobody types "I don't know".
- **No Accept · Reject suggestion card.** The guard that turns an agent's edit to learner text
  into a suggestion did not fire. It was attempted twice in the session — once on a correct
  sentence, once on one written deliberately to contradict a slide — and both times Max corrected
  in the chat and under his own question rather than reaching into the learner's paragraph. The
  behaviour is right; the affordance is simply not on camera.
- **The progress bar moves exactly once**, at 0:10, from `0 of 17` to `1 of 17`. Do not say "the
  bar fills as I go".
- **No ingest.** The deck was already turned into notes before rolling.
- **No lesson cards, no objective `Start` flow, no `Max` private tab.**
- **Two verdicts are "Well done" and two are "Partly there".** There is no "Not yet" verdict on
  an attempt anywhere in the clip. (The "Not yet." at 0:00 is Max declining a *new question*, not
  grading an attempt — worth being precise about if the script uses it.)

---

## 7. Numbers and phrases that are safe to use

Verified, and phrased the way they should be said.

- **"Six real AI study sessions, 152 turns, coded turn by turn."**
- **"In five of the six, not one learner turn held the learner's own reasoning."**
- **"In one session the AI's judgement was wrong ten times out of twenty-one. The learner
  challenged one, accepted two that were wrong, and never addressed the other seven."**
- **"That one session was the only one with learner attempts — seventeen of them, and not one had
  a second try."**
- **"In another, the AI wrote ninety-three words for every word the learner sent."**
- **"A deck of sixty-three slides, seventeen learning objectives."**
- **"The whole clip is one continuous take on a live model. Nothing is scripted."** — true, and
  the strongest single line available.
- **"About three minutes of model waiting was cut out of a five-minute take."** — say this rather
  than let a viewer assume the app is instant.

Two research anchors, if the script wants one:

- Learners explain more to a **less-sure peer** than to a tutor (Xu et al., CHI 2026). This is
  why Ellie exists as a separate, unsure voice rather than Max doing both jobs.
- **Adding agents raises normative pressure without raising informational influence** (Song et
  al., CSCW 2025). This is why there are two agents and not five — a learner who feels outnumbered
  stops disagreeing, and disagreeing with Ellie is part of the task.

---

## 8. Where this clip sits in the finished video

The video is under ten minutes, narrated to camera, and runs: the learning task → the study
findings → the shape of the app → the interaction demonstration → the division of labour →
limitations and what the next assignment tests.

**Clip 2 is the interaction demonstration's second half.** Clip 1 (60 s) carries one complete
exchange from beginning to end, including the silence and the give-up. Clip 2 carries the loop
and the document. A script for clip 2 should therefore **not** re-explain what ChatterED is, and
should **not** repeat clip 1's beats. Its job is: *now watch it keep going, and watch what happens
to the document.*

A workable shape for the 1:51, which the consultant is free to improve on:

| Range | The job of the narration |
|---|---|
| 0:00–0:12 | The learner is answering, and Max held them to the question. Two turns, two verdicts, each resting on a quoted slide |
| 0:12–0:32 | Why a verdict quotes its slide at all — the ten-wrong-in-twenty-one finding |
| 0:32–0:48 | Asking at the sentence; Ellie writes the explanation *into* the notes; Max's question lands in the document, by rule |
| 0:48–1:08 | The answer, the counted pause, the verdict written under his own question, the chip changing state |
| 1:08–1:26 | The centrepiece: writing in the notes *is* answering. The learner's words are marked as theirs, and Freeze proves who is in control |
| 1:26–1:43 | The private thread, and the one door out of it: the learner's own click |
| 1:43–1:51 | Provenance closes it — the slide is still under everything |
