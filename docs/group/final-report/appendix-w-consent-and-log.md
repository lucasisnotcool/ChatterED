<!-- Appendix W of the final group report: the consent notice and what the app logs (Section 5.4).
     Appendices do not count toward the word limit. The build script gives it its final letter.
     Sources: the notice is the text in app/src/shared/trial.ts (notice version 1), with the team's
     email address taken out; the events are those in app/src/shared/studylog.ts and the log calls
     in app/src/main/tutorial/ (check.ts, help.ts, textstart.ts), as listed in
     docs/group/field-study.md. -->

## Appendix W. The consent notice, and what the app records

### W.1 The notice shown on first launch

The app shows this notice before anything else, and the participant has to tick "I have read this
and agree to take part" to continue. It is reproduced as shown, except that the team's email
address is replaced by [the team's email address]. The notice was written for the whole app, so it
also mentions features that are outside the core task of this report.

> **ChatterED is an experimental trial**
>
> ChatterED is a research prototype from a CS3249 project at the National University of Singapore
> (NUS). This build is released as an experimental trial. By using it, you agree to share your
> anonymised usage data with the research team, so we can study how people learn with it.
>
> **What is shared.** Everything you do inside ChatterED: everything you type (questions, answers,
> chat messages, and your own writing in the notes); the AI's replies, and the lecture notes it
> writes for you; your progress (objectives, quiz questions and how they went); usage and cost
> (which model answered, token counts and timings); the app's event log and diagnostic logs, and
> your settings (never API keys).
>
> **What is not shared.** Your lecture PDFs, their text, and the slide images made from them (file
> names are kept); API keys or passwords; anything outside ChatterED (your other files, other
> apps, your browsing).
>
> **Nothing is sent automatically.** ChatterED has no server and never uploads your trial data. To
> take part, you export it yourself: File ▸ Export Research Data… (or Settings ▸ Research trial)
> saves one .zip file, and you email that file to [the team's email address].
>
> **How the export is anonymised.** Your Mac's username and folder paths are removed, and you are
> identified only by a random participant ID. What you type is included exactly as you typed it,
> so don't type personal details (your name, student ID, contact details) that you don't want
> shared. The export is a .zip of readable files (JSON, CSV, plain text and a SQLite database).
> You can open it and look through it before you send it.
>
> **Your AI provider sees what you send it.** Separately from this trial, using ChatterED sends
> the lecture content and what you type to the AI provider you choose (Claude Code / Anthropic,
> OpenAI, Google Gemini, or a custom OpenAI-compatible endpoint), where it is processed under that
> provider's terms. ChatterED itself has no server.
>
> **Where your data lives.** Only on this Mac, in ~/Library/Application Support/ChatterED and
> ~/Library/Logs/ChatterED. Deleting those two folders and the app removes all of it.
>
> **Your choices.** Taking part is voluntary. You can stop using the app at any time, and you
> never have to send an export. To have data you have already sent deleted, email [the team's
> email address] with your participant ID.

In the study copies the AI provider was fixed, as each copy carried a key that we supplied and all
requests went to Anthropic (Section 7.2, Table 17).

### W.2 What the log records

The measures of Section 5 are read from the events below. The log events carry identifiers and
sizes only; the participant's words are kept separately, in the stored threads, which the export
also contains.

| Event | When it is written | What it holds |
|---|---|---|
| `tutorial.text_started` | An empty answer slot first receives text | The part, and the number of characters |
| `tutorial.check` | Check answer is pressed | The part; the verdict; whether code or the model marked it; the length of the answer; the hint level reached; where the answer key came from and how confident it is |
| `tutorial.help` | Hint, Refresher or Show answer is pressed | The part; which control; whether the slot held an attempt, and its length |
| `tutorial.link_open` | A link from a part to the lecture notes or to a page is opened | The part, and the kind of link |
| `tutorial.main_view`, `tutorial.source_pdf` | The main view is switched, or the original PDF is opened or closed | The view, or whether the PDF is open |
| `app.active` | Every five minutes, and when the window is hidden | The number of minutes in which the participant typed, clicked, scrolled or moved the pointer |
| Stored threads | Each turn in a part's thread or in a private chat | The participant's typed turns and the agents' replies, word for word, with their times |
| Stored homework page | When the page is saved | The final text of each answer slot, and the one-line verdict under each part |

The text of an answer at the moment of each check is not kept, only its length, which is the limit
noted in Section 5.4.
