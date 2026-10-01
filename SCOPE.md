# Scope: Assignment 1, Assignment 2, and the group project

For both developers and every agent working here. Revised 2026-10-01; this replaces the zones of
2026-09-26.

## What changed, and why

On 26 Sep the work was split three ways: Lucas's A2 app here, a separate group repo
(`lucasisnotcool/cs3249-group`) holding a mirror of `app/src/core`, and a private A2 repo. After
consulting the prof, codebases and ideas need not be separated that strictly. So from
2026-10-01:

- **One repo and one app** serve both people's individual Assignment 2 and the group project.
  Valerie works here too.
- The group repo was folded in (its A1 evidence index, provenance record and decision issues) and
  archived. `core/` there was only a mirror; `app/src/core/` here is the one copy.
- **Assignment 2 is design-only** (no user study).
- **What stays individual is each person's A2 intellectual work, not the code.** Valerie gets the
  latest app, but not Lucas's A2 reasoning or draft report, and the same holds the other way.

## The three kinds of material

| Kind | What | Where | Who sees it |
|---|---|---|---|
| **Shared** | All code (the app, `app/src/core/`, tools), app docs, product design briefs (`docs/research/`), decisions (issues), both A1s as submitted, course material `.gitignore` allows | this repo | both of us, and anyone the repo is later shared with |
| **Private A2 work** | Each person's working documents, framing and positioning of their A2, reasoning written for the write-up, presentation and video, report drafts | Lucas: `~/ChatterED-A2` (private repo). Valerie: her own private place. | its author only, never the other person |
| **Raw research data** | Interview sheets, notes, recordings and transcripts (both people's), raw and processed AI-use transcripts, any name or ID | local only, gitignored (`Academia/Interviews/`, `Academia/valerie research/`, `docs/research/ai-use-transcripts/{raw,processed}/`) | nobody through the repo, ever; only de-identified analysis is committed |

Everything committed before 2026-10-01 is shared; Lucas cleared it for sharing on that date.
**From now on, classify before adding** (AGENTS.md, "Classify before you add"): code and
app-level writing are shared; anything written to argue, frame or present one person's A2 is
private; if it is unclear, the agent asks its human and commits nothing until they answer.

## The one-way rule

Private A2 work may read and cite this repo. **Nothing flows back from it**, whether into this
repo, an issue, a commit message, a PR, a code comment, or a message to the other person. A design
change prompted by private work is recorded here as a product decision with its design rationale,
without the private argument behind it.

## Guards

1. **Physical.** Private A2 work lives in a different repository, so a fork or copy of this repo
   can never carry it.
2. **Marker.** Every text file of private A2 work opens with a line that says `A2-PRIVATE` and
   nothing else, in the file's comment syntax (`<!-- … -->`, `#`, `//`). `tools/check-scope.sh`
   refuses that line, the reserved paths `a2/`, `a2-private/` and `docs/a2/`, and the raw-research
   paths above. It runs in `.githooks/pre-commit` (enabled per clone with
   `git config core.hooksPath .githooks`) and in CI (`.github/workflows/scope.yml`).
   `.claude/hooks/guard-a2-private.sh` refuses the same before a Claude Code Write or Edit.
3. **Settings.** `~/ChatterED-A2/.claude/settings.json` denies file edits into this repo.
4. **Lint.** `app/src/core/` may import nothing outside itself (`app/eslint.config.mjs`).

The hooks catch accidents, not intent. The rule above is the policy.

## Conventions

- **Evidence ids carry an owner prefix** in new writing: `L-T1…T6` and `L-P1…P3` (ChatterED A1),
  `N-P1…P5` (Nudge A1). Docs written before 2026-10-01 use unprefixed ids, and those are
  ChatterED's.
- **Attribution.** Both of us submit an individual A2 on the same app, so git history and
  `docs/provenance.md` show who built what.
- **Labels.** Every open issue carries one of `scope:a2` (part of someone's A2 build; the
  assignee says whose), `scope:core`, `scope:group`, `scope:product`.

## Tags

- `a1-submitted`: the last commit before the A1 deadline (22 Sep 2026 23:59), which the
  prototype ZIP was cut from.
- `a2-submitted-lucas`, `a2-submitted-valerie`: create at each person's A2 submission, on the
  commit that person's A2 code ZIP is cut from.
