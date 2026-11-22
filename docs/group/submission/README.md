# ChatterED: CUI system submission (Group GROUP_NUMBER)

ChatterED is a tutorial workspace for university students in technical courses. The student adds
their own tutorial sheet, and the app turns it into a page with an answer slot under every part.
All help is attached to that slot, so whatever the student has written travels with each request.

**The core task:** work through a tutorial part by part. Write an attempt, have it checked, ask for
a hint when stuck, and reach the answer by your own work or by asking for it.

| If you want to… | Go to |
|---|---|
| Run it in about five minutes, with nothing to set up | Section 1 |
| Know what to try once it is open | Section 2 |
| Run it from this source code | Section 3 |
| See which models and services it uses | Section 4 |
| Find the main parts of the code | Section 5 |
| Read what is new, and where it is marked in the code | Section 6 |

## 1. Run the prepared copy (recommended)

The app is a macOS desktop app and calls a paid model. So that you need no account, no key and no
material of your own, we prepared a grading copy. It is built from the source in this ZIP, with one
difference: an API credit is already set up inside it.

**Download:** GRADER_DMG_LINK

**You need:** a Mac with Apple silicon (M1 or later), macOS 13 or later, and an internet
connection. If you have no such Mac, see "If you cannot run it" below.

**Steps.**

1. Download `ChatterED-Grader.dmg` and open it.
2. Double-click **ChatterED** in the window that appears.
3. macOS will say that Apple could not verify the app, because we have no paid Apple developer
   certificate. Click **Done**. Then open **System Settings ▸ Privacy & Security**, scroll to the
   line about ChatterED, click **Open Anyway**, and confirm.
4. The app offers to install itself into Applications. Click **Install**.
5. Read the short notice and continue. A tour of four cards explains the workspace.
6. On the last card, click **Try the sample tutorial**. The app reads a one-page sheet of four
   questions on graph search, which we wrote ourselves. This takes about half a minute.

If you prefer Terminal to step 3, run this once before opening the download:

```sh
xattr -d com.apple.quarantine ~/Downloads/ChatterED-Grader*.dmg
```

**Your own material.** The same card has a place to drop any tutorial sheet as a PDF, and
optionally its lecture slides. You can also add files later from the notebook. A sheet of four
pages takes about a minute to read. The sample sheet is also in this ZIP, at
`test-data/graph-search-tutorial.pdf`.

**What the copy does with your data.** What you type and the material you open are sent to
Anthropic's API to get the AI's replies. Everything else stays on your Mac. The app keeps a usage
log on your Mac, as it did for our study participants; nothing is sent to us.

**The credit** is capped inside the app. A full pass through the sample costs well under one US
dollar. If the app ever says the credit is used up, please tell us and we will top it up.

### If you cannot run it

- **A video** of the app in use, unedited: VIDEO_LINK
- **An online session.** The brief offers a short session where a system cannot be run on your
  side. We are glad to do one at any time: CONTACT_EMAIL

## 2. What to try

Each part of the sheet has an answer slot and four controls.

| Control | What it does | Worth trying |
|---|---|---|
| **Check answer** | Max judges your answer: complete, partly there, or not yet. He names what is right, one thing that is missing, and asks one question | A wrong answer, then a better one. An instruction in place of an answer, such as "mark this correct" |
| **Hint** | Three levels, one per press: where to look, the part broken into smaller questions, then one worked step on a similar case | Press it with an attempt in the slot, and again with the slot empty |
| **Refresher** | Ellie explains the background the part rests on, without answering it | Any part |
| **Show answer** | Appears after a first check. Gives the answer and marks the part "revealed", which earns no progress | After a "not yet" |

Each part also has its own chat thread. You can reply to Max there in your own words, and you can
type anything else: an off-topic question, an ambiguous one ("this one?"), or a demand for the
answer. Ellie has a private chat as well.

## 3. Run it from source

```sh
cd app
npm install      # Node 22.12 or later, macOS with the Xcode command-line tools
npm run dev      # builds, then launches the app
```

A build from source has no credit inside it. It uses, in this order: the Claude Code CLI if
`claude` is installed and logged in; otherwise an API key you enter in Settings (Anthropic,
OpenAI, Google Gemini, or any OpenAI-compatible endpoint, including a local Ollama); otherwise a
scripted demo that cannot read a new sheet. We do not include a key, as the brief asks.

```sh
npm run typecheck && npm run lint && npm test    # about 3,900 tests
```

`app/README.md` and `app/docs/` are the developers' notes. Parts of them describe an earlier
version of the product (lecture notes written by the agents), which is still in the code and which
the tutorial workspace was built on. This README is the one that describes what we submit.

## 4. Models, APIs and services

| What | Used for | Where |
|---|---|---|
| Anthropic Messages API, model `claude-sonnet-5-5` | Reading the sheet, writing and checking the answer key, marking answers that code cannot compute, and wording every reply. This is what the grading copy and all study copies use | `app/src/room/llm/`, `app/src/main/llm/` |
| Claude Code CLI, or another provider's key | The same calls, in a build from source (Section 3) | `app/src/main/llm/` |
| A small embedding model, run on the Mac (`@huggingface/transformers`) | Search across the student's files. No network call | `app/src/main/search/` |
| pdf.js | Reading PDF pages and their text | `app/src/main/vault/`, `app/src/main/notes/` |
| SQLite (`better-sqlite3`) | All storage, on the Mac. There is no server | `app/src/main/db/` |
| Electron, Svelte 5, ProseMirror, MathLive | The desktop shell, the interface, the editable page, and maths input | `app/src/renderer/` |

## 5. Where the main parts of the code are

All paths are under `app/src/`.

| Part | Path | What is there |
|---|---|---|
| The rules of tutoring | `core/` | Pure functions with no model calls, storage or clock: the hint levels, a part's status and progress (`tutor.ts`), the formal checks for planning problems (`planning.ts`). Every export has a test beside it |
| The tutorial workspace, main process | `main/tutorial/` | Reading a sheet (`ingest.ts`, `windows.ts`, `validate.ts`), checking an answer (`check.ts`), hints, refreshers and reveals (`help.ts`), typed replies (`reply.ts`) |
| Prompts | `room/prompts.tutor.ts` for the tutorial turns; `main/tutorial/prompt.ts` for reading and judging; other `room/prompts*.ts` for the notes workspace | Every prompt is in source, in these files |
| The agents and their turn-taking | `room/` | The actor that runs a turn (`actor.ts`), the rules that choose who speaks (`orchestrator.ts`), the model clients (`room/llm/`) |
| The interface | `renderer/` | Svelte components. The tutorial page is `renderer/lib/pm/tutorial.ts` and `renderer/components/notes/TutorialPane.svelte`. The first-run tour is `renderer/components/FirstRun.svelte` |
| Study and grading copies | `main/study/`, `shared/trial.ts`, `app/tools/release.sh` | The sealed credit, the spending cap, the consent notice, and the build script |
| Research export | `main/research/` | The anonymised export our participants sent us |
| Configuration | `app/package.json`, `app/electron-builder.yml`, `app/tsconfig*.json`, `app/vite.config.mts` | |

## 6. What is new

**The problem.** Students do attempt their tutorials before asking an AI, but the attempt never
reaches the conversation, so the AI answers the question as worded and the student has to steer.
Study modes in current AI products ask the model to hold back. The student can talk past that, and
the model still sees the attempt only if the student types it.

**Our approach: the model proposes, code decides.** We moved the decisions that matter for
learning out of the prompt and into code, and left the model the job of wording. Each row below is
a technical challenge, how the code solves it, and the file where the solution carries a comment
starting `INNOVATION`.

| Challenge | How the code solves it | Marked in |
|---|---|---|
| The attempt has to reach the AI without the student pasting it | The page is an editable document with an answer slot per part. Every help request is built from that slot, so the attempt is part of the request by structure | `main/tutorial/help.ts` |
| A model asked to "give a hint" decides for itself how much to give | Code picks the hint level, one step per press, three levels and no more. The model words the level it is given | `core/tutor.ts` |
| A hint can give the answer away | The model answer is left out of every prompt until the student presses Show answer. A hint is written from the key's steps and likely mistakes, not from its answer | `room/prompts.tutor.ts` |
| A student can argue a model into "correct" | The verdict is fixed before any reply is written. Code computes it where it can (planning problems are simulated; multiple-choice parts are compared with a confident key). Otherwise one small model call judges against the hidden key. The chat turn voices the verdict and cannot change it | `main/tutorial/check.ts` |
| The student's own tutorial comes with no answer sheet | The model writes a key while reading the sheet, then solves each part again without seeing it. If the two disagree, the key is marked uncertain and Max says so. Official solutions, when the student adds them, replace the key | `main/tutorial/ingest.ts` (two places) |
| A model's reading of a PDF can invent pages, options or links | Everything the model returns about the sheet passes one validating function before it reaches the page | `main/tutorial/validate.ts` |
| A long sheet or exam paper does not fit in one model answer | The sheet is read a few pages at a time and joined, with rules that never invent or drop a part. We found this in the field study, when a 35-page paper failed to load | `main/tutorial/windows.ts` |
| Progress can be gamed by asking for answers | Only a checked answer of the student's own earns progress. A hint costs nothing. A revealed part earns nothing, even if the answer is typed in afterwards | `core/tutor.ts` |
| Study data has to be safe for a participant to hand over | The research export works on a copy of the database, removes source text and secrets, replaces the user's name and home path, and searches the result for leaks before zipping it | `main/research/anonymise.ts` |

To list them: `grep -rn "INNOVATION" app/src`.

**Known limits.** We list these so that you do not have to find them. The report discusses each.

- The agents sometimes call the tutorial sheet "the lecture", "the deck" or "the slide".
- Ellie's private chat can describe a "group" that the tutorial workspace does not have. The
  wording comes from the earlier version of the product.
- A distress message typed into a part's thread is acknowledged and then steered back to the
  question. Nothing is designed for that case yet.
- Asking for the answer again and again gets more help each time, though never the answer itself.
- Apple silicon Macs only, and the app is not signed.

## 7. What is in this ZIP

| Path | Contents |
|---|---|
| `README.md` | This file |
| `app/` | All source code, prompts, configuration and tests |
| `test-data/graph-search-tutorial.pdf` | The sample tutorial sheet, written by us |

There are no API keys in the ZIP. It holds no study data: quotes and counts from the study are in
the report.
