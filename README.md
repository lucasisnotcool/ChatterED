# ChatterED

*Working name.* A group-chat multi-agent learning CUI: the student explains a lecture
concept to a small group of AI peers, one of whom pushes back, with a private whisper
side-channel for the questions you would not ask in front of the group.

Built for **NUS CS3249 (Assignment 1, due 22 Sep 2026)**, and intended to keep going
afterwards as something real NUS students actually use.

## The pitch in one paragraph

Learning-by-teaching works, but only when the audience is worth teaching. The evidence we
are building on says a **peer** and a **challenger** agent beat a dumb tutee, that
multi-agent conversations read as a *social group* rather than a tool, and that a response
that takes a beat is perceived as better than an instant one. ChatterED puts those three
findings in one room: a group chat where the student explains, agents interject on their
own timing, and a `/whisper` channel lets the student ask a side question without
derailing the thread.

## The three idea threads

Each lives in its own folder with the source paper(s) and a README that opens with the
owner's own framing:

| Thread | Folder | Core claim |
|---|---|---|
| Multi-agent AI in education | [`Academia/Sources/Multi Agent AI ED/`](Academia/Sources/Multi%20Agent%20AI%20ED/README.md) | Explaining to peer/challenger agents beats explaining to a tutee; MASG suggests running them as a group chat |
| Whisper / side-channel interaction | [`Academia/Sources/btw interaction/`](Academia/Sources/btw%20interaction/README.md) | A `/btw`-style private aside lets a user ask without interrupting the main thread — relieves group-chat pressure |
| Response timing | [`Academia/Sources/timing messages/`](Academia/Sources/timing%20messages/README.md) | Deliberate latency raises perceived response quality |

> **`Developer's Original Intent (DO NOT EDIT)`** — every `Academia/Sources/*/README.md`
> starts with that section. It is the owner's voice and it is frozen. Agents append under
> `## AI may edit and add here:` and nowhere else.

## Repo map

| What | Where |
|---|---|
| Assignment brief, source papers, extracted text | `Academia/` |
| Design briefs, research plans, evaluation plan | `docs/research/` |
| Interview + observation protocol (Assignment 1 evidence) | `docs/research/interview-guide.md` |
| Agent conventions for future sessions | `CLAUDE.md` |
| Subagent model policy (settings + PreToolUse guard) | `.claude/settings.json`, `.claude/hooks/guard-agent-model.sh` |

`docs/research/` is the source of truth for design decisions. If the code and a brief
disagree, the brief is what gets argued with first.

## Status (13 Sep 2026)

- Interview protocol written; **interviews not yet run** — a rubric hard requirement
  (≥3 real NUS students), tracked as a `blocked-on-user` issue.
- The other research briefs (design brief, architecture options, evaluation plan,
  progress tracking, market scan) were lost when a first pass was halted; only
  `interview-guide.md` survived. Redoing them is an open `research` issue.
- No application code yet.

## The issue-feedback loop

GitHub Issues are how Lucas talks to the *next* agent pass. There is no other backlog.

1. **You (Lucas) file an issue** whenever something is wrong, missing, or worth trying —
   plain language is fine, screenshots better. Templates live in
   [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/): *Feedback for next agent pass*,
   *Idea*, *Bug*.
2. **The agent reads open issues at the start of every session** —
   `gh issue list --state open` — before touching anything, and works the labelled and
   milestoned ones in priority order.
3. **The agent comments on the issue** saying what it actually did, what it chose not to
   do, and why.
4. **The agent closes the issue with the commit reference** that resolved it. Anything
   partially done stays open with a comment, never a silent close.

Labels: `feedback`, `bug`, `idea`, `research`, `assignment-1`, `assignment-2`, `product`,
`blocked-on-user`, `agent-pass`.
Milestones: **Assignment 1 (due 22 Sep 2026)**, **Assignment 2**.

## Working decisions

Recorded as `product` issues on the Assignment 1 milestone so they can be argued with in
public rather than buried in a doc:

- Learning task: explaining lecture concepts to the group.
- Hero mechanic: the group chat with Peer + Challenger. Whisper and latency support it.
- Platform: standalone web app; may later embed in NUSSync.
- LLM: Claude API — Haiku 4.5 for agent turns, Sonnet 5 for orchestration and summaries.

## Privacy

Interview data is pseudonymous by design: participant codes P1…P5, programme/year/gender
only. **Never** commit names, student IDs, NUSNET IDs, recordings, or raw transcripts that
carry them.
