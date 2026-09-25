# ChatterED

*Working name.* A lecture deck opens as a **flow**: whole-page crops of the pdf.js-rendered
slide — the lecturer's own pixels, never re-typeset — with faint ticks marking where the
page's own geometry says a boundary could go; click a tick to split in place. **+ Ask here**
inserts a neutral **REFERENCE** card, under which **Ellie, the Teacher** explains from the
slide; once the learner has been in flow long enough, she hands off to **Max, the Tester**,
who asks one question and never answers it. Only the learner's own verbatim words move the
**Explanation Ledger** ○ → ◐ → ●. **⌘K** opens a private **whisper popover** with Ellie,
ephemeral unless "insert into the document" is used.

Built for **NUS CS3249 (Assignment 1, due 22 Sep 2026)**: a working macOS Electron app, run
from source, NUS-internal distribution.

## The pivot, briefly

The project began as a group-chat design (peer + challenger agents, `/whisper`, deliberate
latency). On 15 Sep 2026 Lucas made a **full pivot**: the conversation now lives *inside* the
document (#23), segmentation is geometry-only with no model call (#25), and the roster became
**Teacher + Tester** (#32), governed by a time-boxed **flow session** (#33). The evidence base
— peer-vs-tutee, agents-as-social-group, whisper/`/btw`, response latency — still motivates
the design; only its realisation changed. `app/README.md` has what exists today;
`docs/research/flow-build-plan.md` superseded the original spec.

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
| Assignment 1 report draft | `docs/report/` |
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
