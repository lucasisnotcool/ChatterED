# ChatterED

*Working name.* A learning CUI built on collaborative editing. A lecture deck is **ingested into
lecture notes**: an editable document where every block carries provenance back to its slide. The
window is **files · notes · chats**. **Ellie** (green) answers from the slide and writes what the
notes were missing into them; **Max** (red) asks one question back, which is the learner's to
answer first. Both edit the notes live, each with a cursor. The learner's own text is never
overwritten: an agent's change to it becomes an accept/reject suggestion. If the learner goes
quiet, Ellie offers a peer's partial take. A give-up releases the answer and pitches the next
question lower, and the progress bar fills only on the learner's own words.

Built for **NUS CS3249**: a working macOS Electron app, NUS-internal distribution. **Assignment 1
was submitted on 22 Sep 2026** (tag `a1-submitted`). **Assignment 2 is individual and in
progress**, and a group project will later combine this with a teammate's A1. **`SCOPE.md` says
which work belongs to which, and where A2 deliverables live (not here).**

## How the design got here

The project began as a group-chat design (peer + challenger agents, `/whisper`, deliberate
latency), became a flow of slide crops with the conversation inside the document (#23, #25, #32,
#33), and on 19 Sep 2026 made a **full pivot to the collaborative notes doc** (#48). The source of
truth is `docs/research/collab-doc.md`; its §9 lists the briefs it superseded, which stay in the
repo as the record. `app/README.md` has what exists today.

## The three idea threads

Each lives in its own folder with the source paper(s) and a README that opens with the
owner's own framing:

| Thread | Folder | Core claim |
|---|---|---|
| Multi-agent AI in education | [`Academia/Sources/Multi Agent AI ED/`](Academia/Sources/Multi%20Agent%20AI%20ED/README.md) | Peer/challenger agents beat a tutee |
| Whisper / side-channel interaction | [`Academia/Sources/btw interaction/`](Academia/Sources/btw%20interaction/README.md) | A `/btw`-style private aside avoids interrupting the thread |
| Response timing | [`Academia/Sources/timing messages/`](Academia/Sources/timing%20messages/README.md) | Deliberate latency raises perceived quality |

> **`Developer's Original Intent (DO NOT EDIT)`** — every `Academia/Sources/*/README.md`
> opens with that section, frozen in the owner's own words: never edited, reworded or
> "cleaned up", not even to fix a typo. Agents append only under
> `## AI may edit and add here:`.

## Repo map

| What | Where |
|---|---|
| The app: what it is, how to run it, real vs scripted | `app/README.md` |
| App source, tests; real vs stubbed, day by day | `app/`, `app/docs/STATUS.md` |
| Assignment brief, source papers, extracted text | `Academia/` |
| Design briefs, research plans, evaluation plan | `docs/research/` |
| Assignment 1 report as submitted, with its claims register | `docs/report/assignment1-final.md` |
| What belongs to A2, the shared core, the group project, product | `SCOPE.md` |
| The code shared with the group project | `app/src/core/` |
| Assignment 2 deliverables | **not here**: the private repo `~/ChatterED-A2` |
| Agent conventions | `CLAUDE.md` |
| Subagent model policy | `.claude/settings.json`, `.claude/hooks/guard-agent-model.sh` |

`docs/research/` is the source of truth for design decisions. If the code and a brief
disagree, that is a bug in one of the two — say which before changing either.

## Run it

```sh
cd app && npm install && npm run dev
```

`app/README.md` §1–2 has prerequisites and the fixture deck to open.

## Research trial & your data

The public build is an **experimental trial**. On first launch — before anything else, first-run
setup included — ChatterED shows a notice and asks you to agree to take part; if the notice changes,
it asks again. Taking part means agreeing to share your anonymised usage data with the research
team, but **nothing leaves your Mac on its own**: ChatterED has no server.

- **What is shared, if you send it:** everything you do in the app — everything you type, the AI's
  replies, the notes, your progress and quiz outcomes, usage and cost, the event log, the app's
  diagnostic logs, and your settings (never API keys).
- **What is not:** your lecture PDFs, their text and the slide images made from them (file names are
  kept), API keys, and anything outside the app.
- **How:** File ▸ **Export Research Data…** (or Settings ▸ Research trial) saves one `.zip` —
  `ChatterED-research-<participant id>-<date>.zip`, on the Desktop by default — and **Email to the
  team** opens a message to `lucasloh@u.nus.edu` (attach the file yourself). The zip is readable
  JSON, CSV, text and a SQLite database, with a `README.txt` and a `manifest.json`: look through it
  before you send it.
- **Anonymisation:** your home folder becomes `~` and your macOS username `<user>`, everywhere;
  key-shaped strings are redacted; you are identified only by a random participant ID (`P-xxxxxxxx`,
  shown in Settings). What you type is included as typed.
- **Separately,** using the app sends lecture content and what you type to the AI provider you pick,
  under that provider's terms.
- **Where it lives / deleting it:** `~/Library/Application Support/ChatterED` and
  `~/Library/Logs/ChatterED`; delete both and the app to remove everything. To have data you have
  sent deleted, email `lucasloh@u.nus.edu` with your participant ID.

The notice's wording is in one place, `app/src/shared/trial.ts` (bump `CONSENT_VERSION` after any
material change); the export is `app/src/main/research/`.

## Where decisions live

Product decisions are argued on GitHub issues (`product`, `research`, milestoned to
Assignment 1/2), then written up under `docs/research/`. Issues are the only backlog: read
`gh issue list --state open` first each session, work labelled ones in priority order,
comment with what was done, and close with the commit reference — partial work stays open,
never a silent close.

## Two things a contributor must know

- **Scoped commits.** `git add` the exact paths touched — never bare `-A` or `.`.
- **No participant PII.** Participant codes P1…P5 and programme/year/gender only — never
  names, student IDs, NUSNET IDs, recordings, or raw transcripts.
