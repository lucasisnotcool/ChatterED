#!/usr/bin/env bash
#
# Build the Assignment 1 submission ZIP — `flow-build-plan.md` §3.6, "Build the ZIP: source,
# this plan, pivot-spec.md, the beat script, the storyboards, the §F3 follow-up and its answers.
# Gate: … ZIP opens on another machine."
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
# deck, which is Lucas's own and is the deck the demo and the vault need. The rest of
# `docs/research/` — a marker gets the four briefs the prototype is built against, not the
# eighteen. `.claude/` in full: project policy is not submission material.
#
# Usage:  tools/make-submission-zip.sh
# Output: dist/ChatterED-A1-<short-sha>.zip  (dist/ is git-ignored)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── the tree must be clean ──────────────────────────────────────────────────
# The archive is named after a commit and is enumerated from the index, so a dirty tree would
# produce a ZIP that claims to be a commit it is not. Refuse rather than warn.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing: the working tree is dirty. Commit or stash first — the archive is named" >&2
  echo "after a commit and built from the index, so it must not claim a state that is not one." >&2
  git status --short >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
OUT="dist/ChatterED-A1-${SHA}.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chattered-zip.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

# ── the allowlist ───────────────────────────────────────────────────────────
PATHSPECS=(
  # The prototype, source only. `git ls-files` is what makes this "source only".
  'app'
  # The four briefs the build is against: the plan (with §2's storyboard in it), the pivot spec,
  # the fidelity/segmentation argument, and the flow-session research.
  'docs/research/flow-build-plan.md'
  'docs/research/pivot-spec.md'
  'docs/research/pdf-fidelity-segmentation.md'
  'docs/research/flow-session.md'
  # The report and its working drafts.
  'docs/report'
  # The demo deck, so the vault has something to open on another machine. Lucas's own work.
  'Academia/Sources/btw interaction'
)

echo "==> staging from ${SHA}"
COUNT=0
while IFS= read -r -d '' f; do
  mkdir -p "$STAGE/$(dirname "$f")"
  cp "$f" "$STAGE/$f"
  COUNT=$((COUNT + 1))
done < <(git ls-files -z -- "${PATHSPECS[@]}")
echo "    ${COUNT} files"

# ── the README a marker opens the ZIP to ────────────────────────────────────
# In place under app/ (where the paths in it resolve) *and* at the top of the archive, because
# the first thing anybody does with a submission ZIP is unzip it and look for a README.
cp app/README.md "$STAGE/README.md"

# ── the video storyboard, extracted verbatim from §2 of the plan ─────────────
# §2 is the storyboard; it lives inside the plan because the plan is what argues for it. The
# submission wants it as its own file, so it is *extracted*, never retyped: everything from the
# `## 2.` heading to the `## 3.` heading, less the trailing rule and blank lines. Regenerated on
# every build, so the copy in `docs/report/` can never drift from the brief that owns it.
STORY="$STAGE/docs/report/video-storyboard.md"
mkdir -p "$(dirname "$STORY")"
{
  echo "<!-- Extracted verbatim from docs/research/flow-build-plan.md §2 by tools/make-submission-zip.sh."
  echo "     The plan is the source of truth; edit it there, not here. -->"
  echo
  awk '/^## 2\. /{f=1} /^## 3\. /{f=0} f' docs/research/flow-build-plan.md \
    | awk 'BEGIN{n=0} {lines[n++]=$0} END{while (n>0 && (lines[n-1]=="" || lines[n-1]=="---")) n--; for(i=0;i<n;i++) print lines[i]}'
} > "$STORY"
if [[ ! -s "$STORY" ]]; then
  echo "refusing: §2 of the plan extracted to nothing — the heading shape changed." >&2
  exit 1
fi
if [[ -f docs/report/video-storyboard.md ]] && ! diff -q docs/report/video-storyboard.md "$STORY" >/dev/null; then
  echo "    note: docs/report/video-storyboard.md differs from §2; the archive carries §2."
fi
echo "    storyboard: $(wc -l < "$STORY" | tr -d ' ') lines"

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
