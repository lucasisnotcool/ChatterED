#!/usr/bin/env bash
#
# Build the Assignment 1 prototype package ZIP: **the app and its code, and nothing else** —
# plus the two figures that carry the user story and one small deck of Lucas's own so the app has
# something to open. Gate: the ZIP opens on another machine.
#
# Re-pointed 22 Sep 2026 (Lucas's call) to the assignment's actual B.1 scope. The submission is
# three artefacts; this is the *prototype* one, so the research briefs, the interview and
# transcript analysis and the report drafts came out — they are the *report's* material and go in
# the PDF. The brief's "storyboards" is read as the **user story**, which is told by
# `docs/report/figures/` and §1 of the package README, not by `docs/report/video-storyboard.md`
# (a shot list for the video, and the video is its own artefact).
#
# **No session or participant data of any kind goes in.** The one recorded sitting stays in the
# report; the app's own database is 148 MB and caches the extracted text of thousands of files,
# including other people's papers, so it is not shippable even in principle.
#
# **The file list is an allowlist, never an exclude list.** Every path that goes in is named
# below and enumerated through `git ls-files`, so three things are true by construction rather
# than by a `-x` pattern somebody has to remember: nothing untracked can be swept in (no
# `node_modules`, no `dist`, no `out`, no `.vite`, no build output, no scratch file), nothing
# **git-ignored** can be swept in (no `.env`, no `*.key`/`*.pem`/`*.p12`, no `*.local.*`, no
# `.claude/settings.local.json`), and `.git` itself is never walked. The belt-and-braces scan at
# the end then refuses to produce an archive that contains a secret-shaped path anyway.
#
# **What is deliberately *not* in it.** The rest of `Academia/` — the source papers are other
# people's work and are not ours to redistribute, so exactly one folder goes in: the Critique 1
# deck, which is Lucas's own and gives the vault something to open. **The filmed demo deck, the
# CS3249 Week 4 lecture, is the lecturer's and is NOT in the ZIP** (it is not committed either);
# the README says to open any slide deck. All of `docs/research/` and all of `docs/report/` bar
# the figures: report material, not prototype material. `.claude/` in full: project policy is not
# submission material. `Academia/Interviews/` and the raw transcripts are git-ignored and so are
# unreachable by construction.
#
# **Why the clean-tree gate is scoped.** Other agents work in this repo concurrently, so the whole
# tree is almost never clean. The archive is still named after a commit and still built from
# tracked files, so the guarantee that matters — that the ZIP's contents match the commit it
# claims — is kept by refusing only when an **allowlisted** path is dirty. A modified report draft
# elsewhere cannot make this archive lie, because it is not in this archive.
#
# Usage:  tools/make-submission-zip.sh
# Output: dist/ChatterED-A1-<short-sha>.zip  (dist/ is git-ignored)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHA="$(git rev-parse --short HEAD)"
OUT="dist/ChatterED-A1-${SHA}.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chattered-zip.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

# ── the allowlist ───────────────────────────────────────────────────────────
PATHSPECS=(
  # The prototype, source only. `git ls-files` is what makes this "source only". The prompts and
  # the configuration the criterion asks for are inside it, not in a folder of their own.
  'app'
  # The demo deck, so the vault has something to open on another machine. Lucas's own work.
  'Academia/Sources/btw interaction'
)
# The figures ride in separately: they are staged at `figures/` at the top of the archive, which
# is the path the package README references, not at their repo path under `docs/report/`.
FIGURES='docs/report/figures'

# ── the allowlisted paths must be clean ─────────────────────────────────────
# Scoped, not whole-tree: see the header. Anything that actually goes in must match the commit.
DIRTY="$(git status --porcelain -- "${PATHSPECS[@]}" "$FIGURES" tools/submission-README.md)"
if [[ -n "$DIRTY" ]]; then
  echo "refusing: a path that goes into the archive is dirty. Commit or stash these first —" >&2
  echo "the archive is named after a commit and built from tracked files, so it must not claim" >&2
  echo "a state that is not one. (Dirt elsewhere in the repo is fine and is ignored.)" >&2
  echo "$DIRTY" >&2
  exit 1
fi

echo "==> staging from ${SHA}"
COUNT=0
while IFS= read -r -d '' f; do
  mkdir -p "$STAGE/$(dirname "$f")"
  cp "$f" "$STAGE/$f"
  COUNT=$((COUNT + 1))
done < <(git ls-files -z -- "${PATHSPECS[@]}")
echo "    ${COUNT} files"

# ── the figures that carry the user story ───────────────────────────────────
# Staged at `figures/` at the top of the archive: that is the path the package README's image
# links use. Tracked-only, enumerated the same way as everything else. Refuse if either is
# missing — the user story is what B.1's "storyboards" is being answered with, so a package
# without them is incomplete.
mkdir -p "$STAGE/figures"
FIGCOUNT=0
while IFS= read -r -d '' f; do
  cp "$f" "$STAGE/figures/$(basename "$f")"
  FIGCOUNT=$((FIGCOUNT + 1))
done < <(git ls-files -z -- "$FIGURES")
for want in interaction-map.png division-of-labour.png; do
  if [[ ! -s "$STAGE/figures/$want" ]]; then
    echo "refusing: figures/$want is missing, empty or untracked. The package README links it." >&2
    exit 1
  fi
done
echo "    ${FIGCOUNT} figures"

# ── the README a marker opens the ZIP to ────────────────────────────────────
# Two different documents, on purpose. At the top of the archive: the *package* README, which
# answers B.1.2 — the prototyping method, the user story with the figures, and what is and is not
# in here. Under `app/`: the developer README, which is how to actually run it, and where the
# paths it cites resolve.
if [[ ! -s tools/submission-README.md ]]; then
  echo "refusing: tools/submission-README.md is missing or empty." >&2
  exit 1
fi
cp tools/submission-README.md "$STAGE/README.md"

# `app/README.md` cites files under `docs/` that are the report's material and are deliberately
# not in this package. Say so in the staged copy rather than editing the repo's own README, which
# is correct as it stands in the repo.
cat >> "$STAGE/app/README.md" <<'FOOTER'

---

**Note for the submitted package.** This file is the repo's developer README, copied unchanged.
The paths it cites under `docs/research/` and `docs/report/` are the *report's* material and are
deliberately not in this ZIP — see §3 of the package README at the top of the archive. Everything
it says about running the app, and every path it cites under `app/`, is correct here.
FOOTER

# ── belt and braces ─────────────────────────────────────────────────────────
# The allowlist already makes these unreachable. This is the check that fails loudly if somebody
# later adds a pathspec without thinking, which is the only way they *become* reachable.
BAD="$(cd "$STAGE" && find . \( \
     -name '*.key' -o -name '*.pem' -o -name '*.p12' -o -name '*.env' -o -name '.env*' \
  -o -name '*anthropic*key*' -o -name 'credentials.json' -o -name 'service-account*' \
  -o -name '*.local.json' -o -name 'settings.local.*' -o -name '.DS_Store' \
  -o -name '.git' -o -name 'node_modules' -o -name '.vite' \) -print)"
if [[ -n "$BAD" ]]; then
  echo "refusing: secret- or build-shaped paths reached the staging tree:" >&2
  echo "$BAD" >&2
  exit 1
fi
# `Academia/` is the one tree where "everything tracked" would be wrong: the papers are not ours
# to redistribute. Assert that the only thing from it is the deck folder.
if (cd "$STAGE" && [[ -d Academia ]]) && \
   [[ "$(cd "$STAGE/Academia" && find . -mindepth 2 -maxdepth 2 -type d)" != "./Sources/btw interaction" ]]; then
  echo "refusing: Academia/ carries something other than the Critique 1 deck folder." >&2
  (cd "$STAGE/Academia" && find . -maxdepth 3 -type d) >&2
  exit 1
fi

# ── zip ─────────────────────────────────────────────────────────────────────
mkdir -p dist
rm -f "$OUT"
(cd "$STAGE" && zip -q -r -X "$ROOT/$OUT" .)

echo
echo "==> $OUT"
echo "    $(du -h "$OUT" | cut -f1)  ($(unzip -l "$OUT" | tail -1 | awk '{print $2}') files)"
echo
unzip -l "$OUT" | head
