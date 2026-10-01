# AGENTS.md: ChatterED

For both developers, **Lucas** (`lucasisnotcool`) and **Valerie** (`valeriexylim`), and for any
coding agent working here (Claude Code, Codex, Cursor, Copilot, or anything else). This file is the
single source of instructions. `CLAUDE.md` imports it and adds only what is specific to Claude Code.
Personal preferences go in your own tool's local file (`CLAUDE.local.md`,
`.claude/settings.local.json`, or your tool's equivalent; `*.local.*` is gitignored), never here.

## What this is

**ChatterED** is a learning CUI built on collaborative editing. A lecture deck is ingested into
AI-written **lecture notes** with per-block provenance back to the slides; the layout is file
panel · doc · chats; Ellie (green) and Max (red) edit the doc live beside the learner, whose own
text is never overwritten; Max's questions are the learner's to answer first, Ellie offers a
peer's partial take on silence, a give-up releases the answer and lowers the next question; a
progress bar fills only on the learner's own words. It is an NUS CS3249 research prototype, headed
for real student use. **Source of truth for the design: `docs/research/collab-doc.md`** (#48, the
2026-09-19 pivot). Orientation and the repo map: `README.md`.

**One repo, one app, for everything (decided 2026-10-01, after consulting the prof).** Both of us
build our individual Assignment 2 on this app, and the group project is the same app. There is no
separate group repo any more: `lucasisnotcool/cs3249-group` was folded in here and archived. What
stays individual is each person's A2 *write-up and thinking*, not the code (next section).

The two Assignment 1 designs this combines:

- **ChatterED** (Lucas). Students put their effort into steering the AI towards a better
  explanation instead of attempting the material themselves ("misdirected persistence").
  Submitted 22 Sep 2026 (tag `a1-submitted`); the report is `docs/report/assignment1-final.md`.
- **Nudge** (Valerie). Learners must detect when AI help does not match their reasoning, then
  steer its level and pace themselves ("scaffolding-calibration burden"). The design uses an LLM
  that only *labels* the learner's reasoning, and a rule-based controller that picks the least
  explicit vetted move (pump, hint, example, repair). It shows a correctable "I think you're stuck
  on" guess, and a proof route whose claims are Done only when the learner states them. Evidence:
  `docs/evidence/N-…` (added by its author). *This summary is Lucas's, and Valerie should correct
  it.*

Both findings describe the same thing from two ends: learner effort spent managing the AI instead
of reasoning. The two designs already share one architecture: **the model proposes, code decides**.

## What is shared and what is private

| | What | Where |
|---|---|---|
| **Shared** | All code (`app/`, `app/src/core/`, `tools/`), app docs, product design briefs in `docs/research/`, decisions in issues, both A1s as submitted, course material that `.gitignore` allows | this repo; both of us, and anyone the repo is later shared with |
| **Private to each person** | Each person's **A2 intellectual work**: working documents, how they frame and position their A2, the reasoning written for the write-up, presentation and video, report drafts | Lucas: his private repo `~/ChatterED-A2`. Valerie: her own private place. **Never this repo, and not shared with each other.** |
| **Never committed, by anyone** | **Raw research data**: interview sheets, notes, recordings and transcripts (`Academia/Interviews/`, `Academia/valerie research/`), raw and processed AI-use transcripts, and any name, student ID or NUSNET ID | local only, gitignored. The repo may be shared further, so it holds only de-identified analysis. |

**Classify before you add.** Before staging a new file or a substantial new document, decide which
row it belongs to:

- Code, tests, tooling, and app-level writing (what the app does, and why a product decision was
  made) are **shared**.
- Anything written to argue, frame or present one person's A2 is **private**: a draft section, a
  slide, a note on which design choices to claim, a comparison written for the report.
- Personal material unrelated to the course (for example a career or FYP note) is not this repo's
  either. Keep it out.
- **If you cannot tell, ask your human and do not commit it until they answer.**

Each of us opens every text file of our own private A2 material with a line that is only
`A2-PRIVATE` in the file's comment syntax (`<!-- … -->`, `#`, `//`). `tools/check-scope.sh`
refuses that line, the reserved paths `a2/`, `a2-private/` and `docs/a2/`, and the raw-research
paths above, in the pre-commit hook and in CI. It is a tripwire, not a scanner: it cannot see
private text pasted somewhere without the marker. The rule above and the checklist under "Before
every commit" are what actually keep private material out.

## Hard rules

1. **The boundary above.** Agents never open the other person's private A2 material, and nothing
   moves from anyone's private material into this repo, whether as a file, excerpt, number, quote
   or summary, in code, docs, issues, commits or PRs. A design change prompted by private work is
   recorded here as a product decision with its design rationale only.
2. **No participant PII, ever.** Use participant codes and programme, year and gender only. GPA
   bands exist only for L-P1…L-P3, exactly as in the submitted A1 report; never an exact grade, and
   nothing is conditioned on them. Never commit names, student IDs, NUSNET IDs, recordings or raw
   transcripts.
3. **Evidence ids carry an owner prefix** outside a verbatim report: `L-T1…L-T6` and `L-P1…L-P3`
   for ChatterED's A1, `N-P1…N-P5` for Nudge's. Both A1s use "P1" for different people. Docs
   written before 2026-10-01 use unprefixed ids, and those are ChatterED's.
4. **`Developer's Original Intent (DO NOT EDIT)` is frozen.** Every `Academia/Sources/*/README.md`
   opens with that section, in Lucas's own words and spelling. Never edit, reword, tidy, reflow,
   spell-check or summarise it, not even to fix an obvious typo. Append only under
   `## AI may edit and add here:`. The same holds for any such section Valerie adds.
5. **`docs/research/` is the source of truth for design decisions.** Code that contradicts a brief
   is a bug in one of the two. Say which, in the commit or the issue, before changing either.
   Superseded briefs stay as the record; `collab-doc.md` §9 lists them.
6. **`app/src/core/` imports nothing outside itself** (lint-enforced in `app/eslint.config.mjs`).
   It is pure: no clock, I/O, model calls or storage, and every export is tested beside it. See
   `app/src/core/README.md`.
7. **Attribution.** Both of us submit an individual A2 built on this app, so it has to be clear
   who built what. Git history is the record; `docs/provenance.md` adds a row for each significant
   contribution and for anything brought in from an individual assignment. Anyone using code they
   did not write in an individual assignment says so there.
8. **Commits.** Stage exact paths, never a bare `git add -A` or `git add .`. See "Commit messages".

## Working together: two people, many agents

- **Issues are the team's channel.** At the start of every session, read the open issues
  (`gh issue list --state open`). Work only issues **assigned to your human**, or ones your human
  names. Ask before taking an unassigned one. Comment on each with what you did, and close it with
  the commit reference. Partially done ⟹ it stays open with a comment; never a silent close.
- **Labels.** Every open issue carries one `scope:` label: `scope:a2` (part of someone's A2 build;
  the code is shared, the write-up is not; the assignee says whose), `scope:core`,
  `scope:group`, `scope:product`. `decision` marks a call to argue in the issue.
- **Main and branches.** Pull before you start and rebase before you push. Small, focused commits
  may go straight to `main`. Larger or cross-cutting work goes on a branch named
  `<name>/<topic>` (for example `val/planner-seam`) and merges by PR. Never force-push `main`,
  never rewrite pushed history, and never revert or rewrite the other person's work without first
  raising it in an issue or PR comment.
- **Policy files change only by a PR the other person approves:** `AGENTS.md`, `SCOPE.md`,
  `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/`, `.githooks/`, `tools/check-scope.sh`,
  `.github/workflows/`. If a guard refuses something, move the content; never edit or bypass the
  guard to get it through.
- **Several agents may share one clone.** Before committing, read `git status`, stage only the
  paths you edited, and leave other uncommitted changes alone; they belong to another session.
- **Memory is per person and per checkout.** Anything the other person or their agents need has to
  be in the repo or an issue.

## Layout, and what to read first

| What | Where | Read first |
|---|---|---|
| The app: what it is, how to run it, real vs scripted | `app/`, `app/README.md`, `app/docs/STATUS.md` | `app/README.md` |
| The shared learner-turn core | `app/src/core/` | `app/src/core/README.md` |
| Design decisions | `docs/research/` | `collab-doc.md`, then `ai-use-transcripts/analysis/convergence.md` |
| Interviews, recruitment, consent, observation | `docs/research/interview-guide.md`, `docs/research/interviews/findings.md` | |
| Student AI-chat transcripts, the coded CUI study | `docs/research/ai-use-transcripts/` | its `README.md` (`raw/` and `processed/` are local only) |
| Each A1 as submitted | `docs/report/assignment1-final.md` (L-), `docs/evidence/` (N-) | `docs/evidence/README.md` |
| Who built what | `docs/provenance.md` | |
| Assignment briefs, rubrics, source papers, extracted text | `Academia/` | `Academia/Sources/_text/` before any PDF |
| Product concept and its idea threads | `README.md`, the three `Academia/Sources/*/README.md` | |
| What belongs to which assignment, and the tags | `SCOPE.md` | |
| Multi-agent / peer-vs-challenger evidence | `Academia/Sources/_text/who-you-explain-to-matters.txt`, `MASG_multi-agents-are-social-groups.txt` | |
| Whisper / side-channel rationale | `Academia/Sources/_text/critique1-btw.txt` | |
| Latency rationale | `Academia/Sources/_text/response-latency-task-type.txt` | |

The `_text/` extractions exist so you do not have to burn tokens on the PDFs. Read the text
first, and open the PDF only for figures and layout.

## Working decisions (recorded as issues; argue there)

- **The collaborative notes doc (#48, 2026-09-19) supersedes the crop flow (#23, #25), the attempt
  lock (#47 point 3), the whisper popover (#16) and the objectives panel (#38) as UI.** Two-pass
  ingest (extract, then an LLM refine with the slides); ProseMirror doc with `blockId`, block
  provenance and a per-span author mark; agents address blocks, never offsets; a code-side guard
  turns any agent change to learner text into an accept/reject suggestion; rules `ellie_answers`,
  `max_followup`, `mention`, `ellie_cue`, `max_prompt`, `answer_released`, `closure`. "Never
  re-typeset" is retired.
- **Roster (#32):** Ellie = Teacher (explains from the slide), Max = Tester (one quiz question when
  the hand-off rule in `app/src/room/flow.ts` fires). No group framing, no disagreement quota.
  On-page AI summaries are the neutral REFERENCE voice; the Q&A thread is the Teacher's.
- **Flow session (#33):** the unit between a snippet and a file: inactivity gap, taught set,
  freshness as a ranking weight, mandatory feedback after a quiz answer; constants in `flow.ts`,
  argued in `docs/research/flow-session.md`. Study vs Demo pacing is a Settings choice.
- **Platform (#11, #14, #17, #20):** a macOS Electron app, unsigned, installed by
  `app/tools/install-local.sh`, with local SQLite storage (Firebase dropped 2026-09-25, #10).
  Distribution is NUS-internal under an authorisation Lucas holds: build to industry-grade quality,
  but do no go-to-market or business-model work. Compliance, ethics and PDPA are handled by Lucas
  with the prof and TAs; do not spend research or design effort on them.
- **LLM (#19):** the local Claude CLI by default (per-role haiku/sonnet/opus, default sonnet), an
  API key file as fallback, `scripted` for the video.
- **Demo deck:** `Academia/Sources/CS3249+Lecture+4.pdf` (a lecturer's deck, never committed). The
  Critique 1 slides in `Academia/Sources/btw interaction/` are the small committed test fixture.
- **Group decisions still open** (issues labelled `scope:group` + `decision`, moved from the group
  repo): the platform for the combined product, the give-up policy, the content (any deck or
  authored problems), the planner seam where Nudge's controller plugs into the orchestrator, and
  the product name.

## Commands

```sh
cd app && npm ci && npm run dev               # run the app (Node >= 22.12; app/README.md §1–2)
cd app && npm run typecheck && npm run lint && npm test
sh tools/check-scope.sh                       # the private-material check; CI runs the same
git config core.hooksPath .githooks           # once per clone: the scope check before each commit
```

`gh issue view` fails on the Projects-classic GraphQL deprecation in this repo; use
`gh api repos/lucasisnotcool/ChatterED/issues/N --jq '.title, .body'` instead.

## Onboarding: "onboard yourself"

When a person or agent is new to a clone, do these in order and report back to your human:

1. **Read**, in full: this file, `README.md`, `SCOPE.md`, `app/README.md`,
   `app/src/core/README.md`, `docs/evidence/README.md`, `docs/provenance.md`, then
   `docs/research/collab-doc.md`. Read every open issue assigned to your human, and every open
   `scope:group` issue.
2. **Set up and verify.** Run `git config core.hooksPath .githooks` and confirm that
   `git config --get core.hooksPath` prints `.githooks` (Claude Code does this at every session
   start). Run `sh tools/check-scope.sh`, which must print `ok`. Then, in `app/`, run `npm ci`,
   `npm run typecheck` and `npm test`, which must pass. Claude Code's write guard needs `jq` on the
   PATH.
3. **Say back** the hard rules in your own words, what counts as private, and what you will not
   touch: anyone's private A2 material, raw research data, and the frozen
   `Developer's Original Intent` sections.
4. **If you work for Valerie:**
   - If `docs/evidence/N-nudge-a1-report.md` is missing, ask her for her A1 report as submitted.
     Add it word for word, with a top comment mapping its P1…P5 to N-P1…N-P5, plus a row in
     `docs/provenance.md`. Leave out raw interview data; her local research folder
     `Academia/valerie research/` is gitignored for that reason.
   - Show her the Nudge summary under "What this is" and correct it with her.
   - Remind her that her A2 write-up and thinking stay in her own private place, with the
     `A2-PRIVATE` marker line at the top of each text file, so a stray copy is refused here.
5. **Keep personal preferences out of this repo.** Put them in your tool's gitignored local file.

## Before every commit

- You classified everything you are adding (see "Classify before you add"), and nothing staged
  comes from anyone's private A2 material or from raw research data. If it might, stop and ask.
- You staged exact paths and read `git status`. No local or personal files are included, and no
  other session's changes either.
- Evidence ids are prefixed (`L-`, `N-`) in new writing, and no personal data is included.
- Anything that came in from an individual assignment, or a significant contribution, has a row
  in `docs/provenance.md`.
- `sh tools/check-scope.sh` passes (the pre-commit hook runs it on what is staged). For a code
  change, the app's typecheck and tests pass.

## Commit messages

A plain descriptive subject (no `feat:`/`fix:` prefixes), then a body that says *why*, what was
verified, and what is deliberately left. Reference issues as `#N`. If an agent wrote the commit,
end it with a `Co-Authored-By` line naming the model that actually wrote it, for example:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

## Environment traps

- On macOS the shell is **zsh**: quote glob args (`grep -rn x --include='*.md'` unquoted aborts
  with `no matches found`). A trailing `grep` with no match marks the whole command failed; end
  inspection chains with `; :`. macOS has no `timeout`.
- Paths under `Academia/Sources/` **contain spaces and parentheses**. Quote every path.
- Never touch global git config.

## Repo hygiene

- `.claude/settings.json`, `.claude/hooks/`, `.githooks/` and `tools/check-scope.sh` are
  **committed team policy**. `.claude/settings.local.json` and `CLAUDE.local.md` are personal and
  gitignored.
- `Academia/` (about 30 MB of PDFs) is committed as plain git objects. No Git LFS; do not
  introduce it without asking Lucas.
