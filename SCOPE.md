# Scope: Assignment 1, Assignment 2, and the group project

For the developers and for every agent working here. Decided 2026-09-26.

Assignment 2 is **individual**. Some code may be shared between teammates, but **A2 deliverables
are never shared**: not with the teammate, not in the group repo, and not after submission
either. The group project later combines this A1 with a teammate's A1 (Nudge, on help selection
and response planning). This file says which work belongs to which of the three, and where each
piece lives.

## The zones

| Zone | What | Where | Who may see it |
|---|---|---|---|
| **1 · A1, frozen** | The Assignment 1 submission | tag `a1-submitted` (`9655c39`); `docs/report/assignment1-final.md` | The teammate, for the group project. The group project builds on both A1s. |
| **2 · Core** | Pure TypeScript learner-turn logic that both A1 designs share | `app/src/core/` | The teammate, at any time. This is the declared shared code. |
| **3 · The ChatterED app** | Lucas's A2 implementation: all other code, and the design briefs | the rest of `app/`, `docs/research/` | Lucas. It enters the group repo from tag `a2-submitted`. |
| **4 · A2 deliverables** | Report, video script and storyboard, Study A data, analysis and results, the submission package | `~/ChatterED-A2/`, a **separate private repo** | **Lucas only. Never shared.** |
| **5 · Group project** | Integration of both A1s, the teammate's planner, joint docs | `lucasisnotcool/cs3249-group` (private, Lucas owns it; cloned at `~/cs3249-group`). Today it holds a mirror of zone 2 in `core/`, and zone 1 in `docs/evidence/`. Its rules are in its `AGENTS.md`. | Both, once Lucas invites the teammate. |
| **6 · Product** | ChatterED work outside A2 | here, issues labelled `scope:product` (#27–#31, #50) | Lucas. It is not A2 scope and not A2 evidence. |

## The one-way rule

Zone 4 may read and cite zones 1–3. **Nothing flows back from zone 4**, whether into this repo,
the group repo, an issue, a commit message, a PR, a code comment, or a message to the teammate.

- A design change prompted by Study A is recorded here as a decision with its design rationale,
  **without** participant results, numbers or quotes. "Max's feedback skips the case asked" is
  fine. "3 of 5 Study A participants said…" belongs in zone 4.
- The same holds in reverse: the teammate's A2 deliverables are never stored, pasted or
  summarised anywhere here. Her **A1** report can be brought in for the group project.
- The A2 brief is course material, not a deliverable. It goes in `Academia/`, next to the A1
  brief.

## Your working directory is your zone

| Session opened in | May do | Must not |
|---|---|---|
| `~/ChatterED` | zones 1, 2, 3, 6 | write zone-4 content here |
| `~/ChatterED-A2` | zone 4; read `~/ChatterED` | edit `~/ChatterED` (its settings deny it: open a ChatterED session to change code) |
| `~/cs3249-group` | zone 5; refresh its `core/` from here with its `tools/sync-core.sh` | read `~/ChatterED-A2` at all (its local settings deny it) |

Claude Code keeps memory per checkout path, so each of these gets its own memory. Anything the
other developer needs has to be in a repo, not in memory.

## Guards

1. **Physical.** Zone 4 is a different repository, so a fork, subtree or copy of this repo can
   never carry it.
2. **Marker.** Every text file in zone 4 opens with a line that says `A2-PRIVATE` and nothing
   else, in the file's comment syntax (`<!-- … -->`, `#`, `//`). Two hooks here refuse any
   content carrying that line:
   - `.githooks/pre-commit`, for people and agents. It is enabled per clone:
     `git config core.hooksPath .githooks`.
   - `.claude/hooks/guard-a2-private.sh`, which refuses a Write or Edit before it happens.

   Both also refuse the reserved paths `a2-private/` and `docs/a2/`.
3. **Settings.** `~/ChatterED-A2/.claude/settings.json` denies file edits into this repo.
4. **Lint.** `app/src/core/` may import nothing outside itself (`eslint.config.mjs`), so the
   shared zone cannot quietly grow a dependency on zone 3.

The hooks catch accidents, not intent. The rule above is the policy.

## Group-project conventions (agreed in advance)

- **Evidence ids carry an owner prefix** once both A1s are in one place: `L-T1…T6` and
  `L-P1…P3` (ChatterED A1), `N-P1…P5` (Nudge A1). Both A1s use P1…, and they are different
  people. Inside this repo, unprefixed ids are ChatterED's.
- **Attribution.** Anyone using zone-2 code in an individual assignment says so in that
  assignment. The group repo keeps a `docs/provenance.md` recording which part came from which
  A1 or A2.
- **Labels.** Issues carry one of `scope:a2`, `scope:core`, `scope:group`, `scope:product`.

## Tags

- `a1-submitted`: the last commit before the A1 deadline (22 Sep 2026 23:59), which the
  prototype ZIP was cut from.
- `a2-submitted`: create at A2 submission, on the commit the A2 code ZIP is cut from. The group
  repo starts from it.
