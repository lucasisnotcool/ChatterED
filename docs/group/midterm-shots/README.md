<!-- Group material: hi-fi prototype screenshots for the CS3249 mid-project presentation, taken 4 Oct 2026 on a scratch profile (no participant data). The slides and tutorial shown are CS3230 course material (Lecture 2, Tutorial 02), used only as study content. Also on the canvas: https://claude.ai/artifact/6wpHQkd2oaSxU2XeE8ra3J (Screenshots page). -->

# ChatterED hi-fi shots (CS3230 Lecture 2: Recurrences and Master Theorem + Tutorial 02)

Window 1440x900 CSS px at 2x (2880x1800 PNG). Real Claude CLI backend (Sonnet), dev build of main @ f856c6a.
DGs: DG1 learner tries first · DG2 gives up -> system recovers · DG3 every line traces to the slide · DG4 short, sized to the task · DG5 only your own words count.

| File | What it shows | DG | Caveat |
|---|---|---|---|
| 01-overview-sources-sheet-chat.png | Whole screen: Sources (Lecture + Tutorial roles), the learning overview (notes) with its 6 objectives, Tutorial 02 open beside it with Question 1-2 and their "From the notes: ... p. 12 · p. 14" links, Ellie's opening chat with suggested questions | DG1, DG3 | Token counters ("session 219k tok") are the app's visible-cost feature, not dev junk |
| 02a-attempt-typed.png | A student's own attempt typed into Question 5's answer slot (substitution proof with the classic flawed step), part status "working", Check enabled | DG1 | |
| 02b-check-partial-verdict-and-reply.png | After Check: "1/2 partial" badge on the part, Max's one-line verdict written under the answer (Remove · Keep), Max's reply in the part's thread citing p. 24 / p. 21 and ending in a question; objective 3 half-filled, top bar "1 half-answered" | DG1, DG4, DG5 | In the chat, KaTeX's square-root sign does not render ("c·n² +   n" should read "+ √n"): an app bug |
| 03a-help-menu-hint-ladder.png | Question 1 untouched; Help menu open: Hint · Point (1 of 3 from Max), Refresher (Ellie), Show answer… "Gives up this part. It won't count." | DG2, DG4 | Max's Q5 thread still shows in the chat |
| 03b-hint1-point-line-and-thread.png | After Hint 1: one short line under the part ("Hint 1: look at 'Telescoping method' in the notes and p. 12, p. 14, p. 16"), one hint dot filled, full hint in the part's thread ending in a question | DG2, DG3, DG4 | The "Max wrote this · Remove · Keep" tag sits over the section heading above the card |
| 03c-help-menu-rung2-break-it-down.png | Help menu again: the ladder has moved to rung 2, "Break it down", dot 1 filled | DG2, DG4 | |
| 03d-hint2-break-it-down-steps.png | Hint 2: the part split into 4 sub-questions in the chat; second hint line under the part; two dots | DG2, DG4 | The hint line reads "Hint 2: start from — What do you divide…" (awkward model wording) |
| 03e-show-answer-confirm.png | Show answer's inline confirm: "Show the answer? It won't count." Show it / Keep trying | DG2, DG5 | |
| 03f-show-answer-revealed-bar-unchanged.png | After Show it: part marked "revealed", the full telescoping derivation (Θ(n log log n)) in the chat ending "In one line of your own words, why…", progress bar unchanged (0 of 6, objective 2 empty) | DG2, DG5 | |
| 03g-after-reveal-why-line-and-max-reply.png | What follows: the learner's one-line "why" and Max confirming it and adding the missing detail, citing p. 14 / p. 16 / p. 12 | DG2, DG3 | |
| 04a-from-the-notes-link-opens-notes-section.png | Pressing Question 5's "From the notes: Substitution method" link scrolls the notes to that section; under it the notes carry a "Practise · Tutorial 02: Q5 ½" chip (the link back) and a recommended quiz card | DG3 | The block flash had faded by capture time |
| 04b-page-link-opens-slide-window-p23.png | Pressing "p. 23–24" opens the lecture slide itself (p. 23, the strengthened hypothesis) in a floating slide window over the notes | DG3 | Window covers part of the sheet; see 05a for it moved aside |
| 04c-slide-window-p24-common-mistake.png | Next in the window: p. 24 "A common mistake", the exact slide Max cited | DG3 | |
| 04d-progress-before-second-attempt-slide-open.png | BEFORE: second attempt typed in the learner's own words with the slide window beside the sheet; bar "0 of 6 · 1 half-answered" | DG1, DG3, DG5 | |
| 04e-progress-after-correct-own-answer.png | AFTER Check: Question 5 "✓ correct", sheet 1/6, bar "1 of 6 · 1 answered in your own words", objective 3 "✓ done"; Max's "Well done" names the step that worked, cites p. 24 / p. 21, flags the base-case gap and asks why | DG5, DG3, DG4 | √ again missing in the chat ("cn² +   n") |
| 05a-slide-window-beside-sheet.png | The slide window dragged beside the sheet so the slide and the part are read together | DG3 | |
| 05b-not-yet-verdict-bar-unchanged.png | Question 6 with a wrong recurrence (merge costed as n): "✕ not yet"; Max says what is right (a = b = 2, p. 9's shape) and asks about the merge cost on p. 7 without giving it; bar stays at 1 of 6 | DG1, DG4, DG5 | The one-line verdict under the part ends in "…" (line is truncated by design to stay short) |
| 05c-refresher-ellie-after-not-yet.png | Refresher on Question 6: Ellie (green, Teacher) re-teaches costing a merge from p. 5–7 and p. 9 on merge sort itself, never Q6's answer; her one line sits under Max's | DG2, DG3, DG4 | |
| 05d-second-try-after-refresher-correct-3of6.png | Second attempt in own words → "Well done", objectives 1, 3, 4 done, bar 3 of 6; Max cites p. 7 / p. 9 and asks a follow-up | DG1, DG5, DG3 | |
| 05e-notes-practise-chip-links-to-part.png | The lecture notes' "Merge sort recurrence" section with its "Practise · Tutorial 02: Q6 ✓" chip (notes → sheet link) | DG3, DG5 | |
| 05f-notes-section-slide-strip.png | Same section with its slide strip open: the five source slides (pp. 5–9) as thumbnails under the notes | DG3 | |
| 05g-tutorial-popped-out-window.png | The sheet popped out into a floating window over the notes ("Parts 2 / 6" bar, Dock), chat still visible | DG4 | Two pending-edit tags overlap under Q5 ("Keep · ep"): an app glitch when a part has several pending agent lines |
| 05h-multiple-choice-checked-by-app.png | Multiple-choice Question 3 ticked and checked: "Checked (run by the app): correct", Max explains Case 3 citing p. 41 / p. 39 and asks about the regularity condition; bar 4 of 6 | DG1, DG3, DG5 | |
| 05i-notebooks-home-progress.png | Notebooks home: the CS3230 notebook card with its progress bar | DG5 | Plain; filler only |

General caveats (batch 1): the √ sign is missing wherever Max's chat replies typeset √n (KaTeX radical not drawn in chat). Browser spell-check underlines were switched off in the DOM before 05d onward (cosmetic, not an app setting). The tutorial had to be removed and re-added once (see report) so its parts link to the notes.

## Batch 2 (tutorial as main view)

Branch lucas/tutorial-main @ a6be297, built from a copy of the worktree's app/ and run on the same profile. A fresh notebook "CS3230 Week 2: Recurrences and Master Theorem" (same two PDFs) with the header switch set to **Main view: Tutorial**. Real Claude CLI replies (Sonnet). The batch-1 notebook "CS3230 Week 2: Recurrences" is still there, untouched.

| File | What it shows | DG | Caveat |
|---|---|---|---|
| B-01a-tutorial-main-overview-with-sources.png | Whole screen in tutorial-main mode: Sources (Lecture / Tutorial roles), the sheet as the main document (Questions 1-3 with "From the notes" links and answer slots), switch "Lecture notes · Tutorial", Ellie's opening and three suggested questions, input "Ask about this tutorial…" | DG1, DG3 | Notes map collapsed on purpose (known wrong-highlight glitch) |
| B-01b-tutorial-main-sheet-top.png | Same mode, sources closed: the sheet's title, course line, folded "Course admin" and the lecture-review preamble | DG3, DG4 | |
| B-02a-attempt-typed-wide-card.png | Question 5 attempt typed; on the wide card Hint · Point and Refresher sit inline beside Check | DG1 | |
| B-02b-check-partial-verdict-and-reply.png | Check → "½ partial", Max's verdict line under the answer, Max's reply citing p. 24 and asking whether c·n² + √n ≤ c·n² | DG1, DG4, DG5 | √ missing in the chat reply (same KaTeX bug as batch 1) |
| B-03a-inline-hint-refresher-and-more-menu.png | Question 1 untouched; inline Hint · Point / Refresher, and the More menu holding only "Show answer… Gives up this part. It won't count." | DG2, DG4 | |
| B-03b-hint1-point.png | Hint 1 (Point): line under the part, one dot, Max's pointer to the notes section and p. 15/16 in the thread; ladder label now "Break it down" | DG2, DG3, DG4 | Max quotes p. 15 with doubled letters ("TT nn / nn"), garbled PDF text extraction of that slide |
| B-03c-hint2-break-it-down.png | Hint 2: four numbered sub-questions in the chat, second hint line, two dots, ladder label "A worked step" | DG2, DG4 | Hint line wording "start from — What divisor…" is awkward |
| B-03d-show-answer-confirm.png | Show answer's inline confirm on the header row: "Show the answer? It won't count." Show it / Keep trying | DG2, DG5 | |
| B-03e-show-answer-revealed.png | After Show it: "revealed", line "Answer shown in the chat.", full telescoping derivation to Θ(n log log n) ending with "In one line of your own words, why…"; bar unchanged | DG2, DG5 | I pressed Keep on the two hint lines first, because their margin tags overlapped (see report) |
| B-04a-from-the-notes-opens-notes-window.png | "From the notes: Substitution method" opens the LECTURE NOTES window ("behind the tutorial") over the sheet, at that section, with its "Practise · Q5 ½" chip and slides pp. 17–24 | DG3 | Took two clicks; the first opened the window at the wrong section (see report) |
| B-04b-slide-window-p24-over-sheet-and-notes.png | "p. 24" opens the slide window (A common mistake) over sheet + notes window | DG3 | |
| B-04c-answer-verdict-slide-and-notes-together.png | Slide window dragged down-left: the learner's answer, Max's partial verdict, the p. 24 slide and the notes window all in one frame | DG3, DG1 | Busy; good as a "everything traces back" slide |
| B-04e-before-second-attempt-half-answered.png | BEFORE: bar "0 of 6 · 1 half-answered", Question 5 "½ partial" | DG5 | |
| B-04d-correct-own-answer-progress-1of6.png | AFTER the second own-words attempt: "✓ correct", Parts 1/6, bar "1 of 6 · 1 answered in your own words"; Max's "Well done" names the fix (p. 24, p. 21) and asks why it works | DG5, DG3 | √ missing in chat |
| B-05a-doc-chat-asks-about-the-sheet.png | Doc chat question about the whole sheet; Ellie sorts Q2-4 (master theorem, p. 41/45/46) from Q1, Q5, Q6 (other methods, p. 15, p. 21/24, p. 8, p. 29/30) without solving any part | DG3, DG4, DG1 | |
| B-05b-doc-chat-answer-end.png | End of that reply: "For the part itself… Hint or Show answer on that question will help." and "Added one line under that paragraph in 'Master theorem'" | DG3 | Ellie wrote a line into the hidden lecture notes from a sheet question; check that is intended |
