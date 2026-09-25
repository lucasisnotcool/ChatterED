# CLAUDE.md

**ChatterED** — a learning CUI built on collaborative editing. A lecture deck is ingested into
AI-written **lecture notes** with per-block provenance back to the slides; the layout is file
panel · doc · chats; Ellie (green) and Max (red) edit the doc live beside the learner, whose own
text is never overwritten; Max's questions are the learner's to answer first, Ellie offers a
peer's partial take on silence, a give-up releases the answer and lowers the next question; a
progress bar fills only on the learner's own words. NUS CS3249 research prototype, headed for
real student use. **Source of truth: `docs/research/collab-doc.md` (#48, the 2026-09-19 pivot).**
Orientation and the repo map: `README.md`. **Assignment 1 is due 22 Sep 2026.**

## Start every session here

```
gh issue list --state open
```

Issues are the owner's only channel to you. Read them **before** planning, work them in
milestone/label order, comment on each with what you did, and close it with the commit
reference. Partially done ⟹ stays open with a comment; never a silent close.

`gh issue view` dies on the Projects-classic GraphQL deprecation in this account —
use `gh api repos/:owner/:repo/issues/N --jq '.title, .body'`.

## Hard invariants (IMPORTANT — must never drift)

- **`Developer's Original Intent (DO NOT EDIT)` is frozen.** Every
  `Academia/Sources/*/README.md` opens with that section, in the owner's own words and
  spelling. Never edit, reword, tidy, reflow, spell-check or "summarise" it — not even
  to fix an obvious typo. Append only under `## AI may edit and add here:`.
- **Subagents run on Opus or lower, never Fable.** Nested spawning IS permitted (a
  subagent may spawn its own subagents) — the only rule is the model:
  1. Every `Agent` call, at any depth, passes `model` explicitly — `"opus"` (the ceiling),
     `"sonnet"` or `"haiku"`. Never rely on inheritance. (A 2026-09-13 scare about nested
     agents running on Fable turned out to be a false positive — a transcript audit showed
     every nested turn on `claude-opus-5` — but explicit is auditable, inheritance is not.)
  Audit: `grep -o '"model":"[^"]*"' <scratchpad>/tasks/a*.output | sort | uniq -c`.
  2. Every subagent prompt must relay the rule: "If you use the Agent tool, pass
     model: \"opus\" (or sonnet/haiku) explicitly — never omit it."
  Enforced by `.claude/settings.json` (`CLAUDE_CODE_SUBAGENT_MODEL: opus` + a `PreToolUse`
  matcher on `Agent`) calling `.claude/hooks/guard-agent-model.sh`, which denies an
  omitted or non-allowed model. If a spawn is refused, fix the call — do not edit the
  hook or the settings to get around it. Hooks added mid-session go live only after
  `/hooks` or a restart.
- **Mind the 20-concurrent-agent harness cap.** Fan-out is fine when each agent is on
  Opus or lower; check `ListAgents` before a large batch so a nested fan-out doesn't
  block the next launch.
- **Scope adjustments of 2026-09-13 (issues #11–#13).** ChatterED is a **macOS desktop app**
  (DMG drag-and-drop install) with local file access and local SQLite storage (Firebase/Firestore
  dropped 2026-09-25, #10; `mirror.ts` stays a stub); distribution is **NUS-internal under an authorisation Lucas holds** — build to
  industry-grade quality, but do no go-to-market/business-model work. **Compliance, ethics and
  PDPA are handled by Lucas with the prof and TAs** (IRB exemption obtained) — do not spend
  research or design effort on them. Research focus: features and product design.
- **`docs/research/` is the source of truth for design decisions.** Code that contradicts
  a brief is a bug in one of the two; say which, and say so in the commit or the issue,
  before changing either.
- **No participant PII, ever.** Participant codes P1…P5 and programme/year/gender only, plus a
  **GPA band** for the A1 interviewees (Lucas, 2026-09-21, reversing the 19 Sep call; bands only,
  never an exact grade, and nothing is conditioned on them). Study A/B participant records stay
  programme/year/gender: the band is an A1-sample description, not a variable to collect.
  Never commit names, student IDs, NUSNET IDs, recordings, or raw transcripts.
- **Scoped commits.** `git add <the exact paths you edited>` — never bare `-A` or `.`.

## Commit messages

Follow the owner's other repos: a plain descriptive subject (no `feat:`/`fix:` prefixes),
then a body that says *why*, what was verified, and what is deliberately left. Reference
issues as `#N`. Every message ends with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

## Before touching X, read Y

| Area | Read first |
|---|---|
| Anything about the product concept | `README.md`, then the three `Academia/Sources/*/README.md` |
| Assignment scope, marks, deadlines | `Academia/Assignment 1_ ...pdf` and `Academia/Sources/_text/assignment1-brief.txt` |
| Interviews, recruitment, consent, observation | `docs/research/interview-guide.md` |
| Student AI-chat transcripts, form responses, the coded CUI study | `docs/research/ai-use-transcripts/README.md` (raw/ and processed/ are gitignored, local only) |
| The interaction model (start here) | `docs/research/collab-doc.md`, then `ai-use-transcripts/analysis/convergence.md` |
| Any design decision | `docs/research/` — and if the brief is missing, that is the `research` issue about the halted first pass |
| Multi-agent / peer-vs-challenger evidence | `Academia/Sources/_text/who-you-explain-to-matters.txt`, `MASG_multi-agents-are-social-groups.txt` |
| Whisper / side-channel rationale | `Academia/Sources/_text/critique1-btw.txt` |
| Latency rationale | `Academia/Sources/_text/response-latency-task-type.txt` |

The `_text/` extractions exist so you do not have to burn tokens on the PDFs. Read the
text first; open the PDF only for figures and layout.

## Working decisions (recorded as `product` issues, argue there)

- **The collaborative notes doc (#48, 2026-09-19) supersedes the crop flow (#23, #25), the attempt
  lock (#47 point 3), the whisper popover (#16) and the objectives panel (#38) as UI.** Two-pass
  ingest (extract, then an LLM refine with the slides); ProseMirror doc with `blockId`, block
  provenance and a per-span author mark; agents address blocks, never offsets; a code-side guard
  turns any agent change to learner text into an accept/reject suggestion; rules `ellie_answers`,
  `max_followup`, `mention`, `ellie_cue`, `max_prompt`, `answer_released`, `closure`. "Never
  re-typeset" is retired. Superseded briefs stay as the record; `collab-doc.md` §9 lists them.
- **Roster (#32):** Ellie = Teacher (explains from the slide), Max = Tester (one quiz question when
  the hand-off rule in `src/room/flow.ts` fires). No group framing, no disagreement quota, no Theo.
  On-page AI summaries are the neutral REFERENCE voice; the Q&A thread is the Teacher's.
- **Flow session (#33):** the unit between a snippet and a file — inactivity gap, taught set,
  freshness as a ranking weight, mandatory feedback after a quiz answer; constants in `flow.ts`,
  argued in `docs/research/flow-session.md`. Study vs Demo pacing profile is a Settings choice.
- Whisper: a popover on a segment, ephemeral, Ellie-only for now, with "insert into the document"
  producing a new shared card (#16 and its 2026-09-16 comment).
- Platform (#11, #14, #17, #20): macOS Electron app, unsigned, installed by `app/tools/install-local.sh`.
- LLM (#19): the local Claude CLI by default (per-role haiku/sonnet/opus, default sonnet), an API
  key file as fallback, `scripted` for the video. Load the `claude-api` skill before writing API
  code; do not answer model/pricing questions from memory.
- Demo deck: `Academia/Sources/CS3249+Lecture+4.pdf` (#48; a lecturer's deck, not committed). The
  Critique 1 slides in `Academia/Sources/btw interaction/` (#32) remain the small test fixture.

## Environment traps

- Shell is **zsh**: quote glob args — `grep -rn x --include='*.md'` unquoted aborts with
  `no matches found`. A trailing `grep` with no match marks the whole call failed; end
  inspection chains with `; :`.
- Paths under `Academia/Sources/` **contain spaces and parentheses**. Quote every path.
- Foreground `sleep N && cmd` is blocked. Poll with a background until-loop.
- macOS has no `timeout`.
- `git config user.email` is intentionally empty in this account; commits land as
  `lucasisnotcool <>` (older commits show the previous handle `aekyr`). Do not "fix" it, and
  never touch global git config.

## Repo hygiene

- `.claude/settings.json` and `.claude/hooks/` are **committed project policy**.
  `.claude/settings.local.json` is personal and gitignored.
- `Academia/` (~30 MB of PDFs) is committed as plain git objects. No Git LFS in this
  account's repos — do not introduce it without asking.
