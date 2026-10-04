# Joint codebook v1: studying with general-purpose AI chat

Merged from two independent, blind open codings (coder A, line by line, C01–C40; coder B, episodes and
journeys, K01–K38) of the pooled corpus: 3 interviews by Lucas (L-P1…L-P3, paraphrased notes),
5 interviews by Valerie (N-P1…N-P5, edited transcripts), and 6 shared AI study sessions (L-T1…L-T6), each
with the sharer's short form answers and, separately, the full chat log.

**How to code.**
- **Interview or form unit:** for each code, mark `●` (clear), `◐` (partial, implied, or led by the
  interviewer), `○` (contrary: says the opposite, or manages it fine, a success condition), or leave it
  blank (not mentioned). Absent does not mean false.
- **Chat log unit:** code what is **observable in the log**, using each code's *Log* indicator. Record
  turn ids (L4 = learner turn 4, A4 = AI turn 4) and counts where the indicator is countable. Use `NO`
  when the code cannot be observed in a log at all.
- **Quotes:** L- interview material is paraphrase, so never quote it. N- material may be quoted briefly.

Mapping to the source codes is given in brackets, for audit.

---

## A. Fit: the help is pitched to the question, not to the learner

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J01 | Pitched above me | Can't follow the output: jargon, notation, abstraction, too technical. [C01, K06] | Learner reports not understanding the AI's wording or level. Exclude difficulty with the source material itself when the AI is not blamed. ○ = the AI unpacks things well for them. | Learner asks "what does X mean", "simpler", for an intuition, or re-asks about a term the AI just used. |
| J02 | Too thin or skips steps | The output glosses over steps, or notes and summaries lack the depth or detail wanted. [C02, C04, K07] | Explanation gaps or depth gaps in generated notes. | "More detail", "step by step", "you skipped", "you missed", re-feeding to extend. |
| J03 | Too long to use | The volume exceeds what the learner will read or needs; over-explains. [C03, K08] | | AI turns much longer than the request; the next learner turn arrives before a full read was possible; "shorter". |
| J04 | Hidden prerequisite gap | The answer assumes knowledge the learner lacks, and the learner has to discover the missing layer. [C06, K09] | Learner-side gap behind the question. | Follow-ups asking about a concept the answer used but never taught. |
| J05 | Pace or hint size off, both ways | Help moves too fast or gives too much, or is too slow, small or cryptic to use, unpredictably. [C07, K10] | Size and rate of the help, not its wording. | Alternating "too much / don't give it away" and "I don't get it / more", or difficulty steered up and down. |
| J06 | The AI doesn't know me | The learner puts the misfit down to the AI having no model of their level or prior knowledge. [C05, K15] | Must name the **learner's** knowledge or level, not missing course material (→ J16). ○ = states their level and it works. | Learner volunteers their level or what they already know mid-chat, as a correction. |

## B. Repair: the learner steers, and pays for it

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J07 | Follow-up loop | Two or more rounds of clarifying or extending turns to reach a usable answer or artefact. [C08, K18] | | A run of learner turns on the same point; turns per resolved question. |
| J08 | Re-pitch request | An explicit request to change level or register: simpler, intuitive, an example, harder, easier, a smaller hint. [C09, K19] | Exclude requests for more content (→ J07, J02). | Count of explicit level or register requests. |
| J09 | Up-front specification | Pre-specifying role, constraints, format, difficulty exemplars, syllabus limits or the learner's level. [C11, K20] | Note which kind: **learner-info** (level, what I know, don't give answers) or **format-only**. | A long first turn or protocol turn; pasted sample questions; "only use methods from…"; "don't send the answer". |
| J10 | Ferrying context by hand | Screenshots, copy-paste, uploading or re-feeding slides and notes. [C12, K21] | Code the act, even when it is benign. | Attached images or files; bare-image turns; re-uploads. |
| J11 | Supervising the AI | Ongoing monitoring, re-issuing instructions, fixing misplaced edits, "babysitting". [C13] | The overhead of minding the AI, not of learning. | "That's not where I meant", "you said earlier", re-issued constraints, model switches mid-thread. |
| J12 | Switching or building tools | Changes model or product, or builds their own tool or setup, to get a better fit. [K22; part of C10] | | Mid-thread model switches are visible. Other switches are `NO`. |
| J13 | Retreat | Gives up, falls back to the tutorial or textbook, abandons the artefact, stops using AI for this. [C10 part, K23] | | The thread ends with the question unresolved, or the task changes type abruptly. |
| J14 | Settling for partial understanding | Accepts incomplete understanding and moves on. [C40 part, K26] | ○ = can tell when they understand enough. | Moves on without confirming understanding; an "ok" after unresolved feedback. |
| J15 | Cost of managing the AI | Time and effort spent steering, or a wish for it to be seamless. [C14, K35] | ● = costly; ○ = efficient, low cost. | Steering turns against content turns; elapsed time per item. |

## C. Context: what the AI sees, and what it knows of me

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J16 | The AI doesn't see my material; split workspace | The AI lacks the slide or notes the learner is on, or the learner's own notes and annotations live outside it. [C23, C24, K14, K16] | ○ = context picked up well. | "This slide", pasted regions, images without words; the AI misreading the material. |
| J17 | Drift and decay over a session | The dialogue moves away from the course material, or quality falls as the session lengthens. [C15, C18, K13] | | Later turns stop referring to the material; quality against turn index. |
| J18 | Scope and examinability | Can't tell what matters or is tested, or the AI uses methods the course does not. [C16, K11] | ○ = manages scope well. | "Is this tested?", "we're not allowed to use X"; AI exam framing nobody asked for. |
| J19 | Rabbit hole and stopping | Going ever deeper, or deciding when enough is enough. [C17, K29] | ○ = stops well. | Long tangential threads; the stop decision itself is `NO`. |
| J20 | Progress and weakness tracking | Wants a record of mastery and weak spots to steer what comes next. [C26, K17] | | "Quiz me on what I got wrong", "what am I weak at". |
| J21 | Memory across sessions | Wants what was learned and written down to carry over into later sessions. [C25, K33] | ○ = actively discards history. | `NO` within one log, except re-explaining background. |

## D. Notes as an artefact

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J22 | Goal: condense into notes | Asks the AI to turn slides or readings into notes, summaries or a study artefact. [C20, K03] | | "Summarise", "make notes" with files attached. |
| J23 | Generated output goes unread | Notes or long output are produced but not read or used. [C21] | | Next turn arrives before a full read; the artefact is never referred to again. |
| J24 | Control over content and placement | Wants to decide what goes into the notes and where, edit them together, keep their own additions. [C22, K32] | | "Add this under section X", "don't change Y", "you put it in the wrong place". |

## E. Practice and knowing whether I understand

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J25 | Uses AI for practice | Quizzes, flashcards, practice questions. [C27, K04] | | "Quiz me", "give me a question", followed by answer turns. |
| J26 | Practice mispitched or decaying | Generated questions are too easy, obvious, MCQ only, copies of the examples, or worse late in a session. [C28, K12] | | "Harder", "different type"; quick correct answers in a row; answers given in the question. |
| J27 | Reading is not learning | Holds that reading explanations is not enough and they must do; felt versus real understanding. [C29, C30, K27] | Mark ◐ if interviewer-led. | A pivot from "explain" to "test me". |
| J28 | A check, and a signal that I've got it | Wants or uses checks after an explanation, and some way to know they understand or where it breaks. [C31, C34, K28] | | Quiz results in the thread; "so the bit I don't get is…"; AI-asked comprehension checks. |

## F. Initiative: who does the thinking

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J29 | Attempt first, then limited help | Works on the problem before asking, and limits help to hints. [C35, K25] | | The learner's own attempt, hypothesis or worked answer in a turn (ICAP Constructive); "just a hint"; long gaps before asking. |
| J30 | The AI produces the answer for me | Uses AI to produce answers to assessable items. [C37] | ○ = explicitly rejects this. | A pasted question plus "answer"/"solve" with no attempt; "what's the answer". |
| J31 | Ownership stance | The AI should help them learn, not do it for them; they value the struggle. [C36, K38] | | `NO` as a stance; proxy: attempts per AI answer. |
| J32 | Verify and challenge | Cross-checks, challenges contradictions, opens sources. [C38, K24] | ○ = accepts wrong output without comment. | Challenge turns ("that's wrong", "you said earlier"); external checks are `NO`. For logs, also count AI errors visible in the transcript that went unchallenged. |
| J33 | Wants the AI to lead: a path, a diagnosis | Wants the AI to sequence learning (easier first, layer by layer, a plan), and to ask purpose and prior knowledge before answering. [C32, C33, K30, K31] | ○ = runs their own structure. | Requests for a plan or "start with basics"; AI-initiated diagnostic questions. |

## G. Context and outcome

| Id | Code | Definition | Include / exclude | Log indicator |
|---|---|---|---|---|
| J34 | Filling a teaching or help gap | AI is used because teaching, materials, practice or human help is lacking or costly. [C19, K01] | | Rarely visible ("my lecturer didn't explain"). |
| J35 | Graded output as the driver | AI is used while producing assessed work, so learning and production are mixed. [K05] | | The task prompt is itself an assessment item. |
| J36 | It works | Success or satisfaction: unpacks, translates, saves time, replaces scarce help. [C39, K36, K37] | | Closure turns ("got it", "makes sense") followed by correct use. |

36 codes, in 7 groups (A–G). The groups are an organising device, not the final themes.
