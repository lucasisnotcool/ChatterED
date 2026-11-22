#!/usr/bin/env bash
#
# Build the final group project's system ZIP: `Group<N>_CUI_System.zip`.
#
# The system brief asks for "Your source code, prompts, and configuration files", a README.md,
# and "any test data or test accounts we need". It says "Do not include API keys". So the ZIP is:
#
#   README.md                              from docs/group/submission/README.md, placeholders filled
#   app/                                   every tracked file under app/ (source, prompts, config)
#   test-data/graph-search-tutorial.pdf    the sample sheet the team wrote (red-team sheet A)
#
# and nothing else. No study data, no transcripts, no report drafts, no course material, no team
# policy files, and no key bundle: the grading copy with its credit is a download linked from the
# README, never a file in this archive.
#
# **The file list is an allowlist enumerated through `git ls-files`**, as in the Assignment 1
# builder (`tools/make-submission-zip.sh`): nothing untracked and nothing git-ignored can be swept
# in, and `.git` is never walked. A scan at the end refuses secret-shaped paths and key-shaped
# strings anyway.
#
# The archive is built from the commit, so it refuses when an allowlisted path is dirty. Dirt
# elsewhere in the repo is ignored (other sessions work here).
#
# Usage:
#   tools/make-group-submission-zip.sh --group 7 --dmg-link <url> --contact <email> [--video-link <url>]
# Output: dist/Group7_CUI_System.zip   (dist/ is git-ignored)
set -euo pipefail

GROUP="" DMG_LINK="" VIDEO_LINK="" CONTACT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --group) GROUP="$2"; shift 2 ;;
    --dmg-link) DMG_LINK="$2"; shift 2 ;;
    --video-link) VIDEO_LINK="$2"; shift 2 ;;
    --contact) CONTACT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$GROUP" =~ ^[0-9A-Za-z]+$ ]] || { echo "refusing: --group <number> is required (the brief names the file GroupX_CUI_System.zip)." >&2; exit 2; }
[[ -n "$DMG_LINK" ]] || { echo "refusing: --dmg-link <url> is required. Without it a grader cannot run the app, and the brief gives no credit then." >&2; exit 2; }
[[ -n "$CONTACT" ]] || { echo "refusing: --contact <email> is required (for the online session the brief offers)." >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHA="$(git rev-parse --short HEAD)"
NAME="Group${GROUP}_CUI_System"
OUT="dist/${NAME}.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chattered-group-zip.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
TOP="$STAGE/$NAME"
mkdir -p "$TOP"

README_SRC='docs/group/submission/README.md'
SAMPLE_SRC='docs/group/red-team/sheets/sheetA.pdf'

# ── what goes in must match the commit ──────────────────────────────────────
DIRTY="$(git status --porcelain -- app "$README_SRC" "$SAMPLE_SRC")"
if [[ -n "$DIRTY" ]]; then
  echo "refusing: a path that goes into the archive is dirty. Commit it first: the graders mark" >&2
  echo "the version in the ZIP, and the grading copy must be built from the same commit." >&2
  echo "$DIRTY" >&2
  exit 1
fi
for f in "$README_SRC" "$SAMPLE_SRC"; do
  git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 || { echo "refusing: $f is not tracked." >&2; exit 1; }
done

echo "==> staging from ${SHA}"
COUNT=0
while IFS= read -r -d '' f; do
  mkdir -p "$TOP/$(dirname "$f")"
  cp "$f" "$TOP/$f"
  COUNT=$((COUNT + 1))
done < <(git ls-files -z -- app)
echo "    ${COUNT} files under app/"

mkdir -p "$TOP/test-data"
cp "$SAMPLE_SRC" "$TOP/test-data/graph-search-tutorial.pdf"

# ── the README, with its placeholders filled ────────────────────────────────
VIDEO_TEXT="${VIDEO_LINK:-We did not record one. Please ask for the online session below.}"
GROUP="$GROUP" DMG_LINK="$DMG_LINK" VIDEO_TEXT="$VIDEO_TEXT" CONTACT="$CONTACT" SHA="$SHA" \
python3 - "$README_SRC" "$TOP/README.md" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
for key, env in (('GROUP_NUMBER', 'GROUP'), ('GRADER_DMG_LINK', 'DMG_LINK'), ('VIDEO_LINK', 'VIDEO_TEXT'), ('CONTACT_EMAIL', 'CONTACT')):
    if key not in s:
        sys.exit(f'refusing: the README has no {key} placeholder to fill.')
    s = s.replace(key, os.environ[env])
s += f"\n---\n\nBuilt from commit `{os.environ['SHA']}`. The grading copy linked in Section 1 is built from the same commit.\n"
open(dst, 'w', encoding='utf-8').write(s)
PY
if grep -nE 'GROUP_NUMBER|GRADER_DMG_LINK|VIDEO_LINK|CONTACT_EMAIL' "$TOP/README.md"; then
  echo "refusing: a placeholder is still in the README." >&2; exit 1
fi

# ── belt and braces ─────────────────────────────────────────────────────────
# Public keys for the updater (`app/build/update-keys/*.pub.pem`) are meant to ship; any other
# key-shaped path is refused.
BAD="$(cd "$STAGE" && find . \( \
     -name '*.key' -o -name '*.p12' -o -name '*.env' -o -name '.env*' \
  -o \( -name '*.pem' ! -name '*.pub.pem' \) \
  -o -name '*anthropic*key*' -o -name 'credentials.json' -o -name 'service-account*' \
  -o -name 'keys.json' -o -name 'codes.csv' -o -name 'slots.csv' -o -name 'preload.txt' -o -name 'grader.txt' \
  -o -name '*.local.json' -o -name '*.local.md' -o -name 'settings.local.*' -o -name '.DS_Store' \
  -o -name '*.dmg' -o -name '*.db' -o -name '*.sqlite' -o -name 'ChatterED-research-*' \
  -o -name '.git' -o -name 'node_modules' -o -name '.vite' -o -name 'dist' -o -name 'out' \) -print)"
if [[ -n "$BAD" ]]; then
  echo "refusing: secret-, data- or build-shaped paths reached the staging tree:" >&2
  echo "$BAD" >&2
  exit 1
fi
# A live Anthropic key is `sk-ant-` followed by a long token. Test fixtures use short fakes.
if grep -rIlE 'sk-ant-[A-Za-z0-9_-]{60,}' "$STAGE" >/dev/null 2>&1; then
  echo "refusing: a string shaped like a live API key is in the staging tree:" >&2
  grep -rIlE 'sk-ant-[A-Za-z0-9_-]{60,}' "$STAGE" >&2
  exit 1
fi
# Only the three top-level entries the header names.
TOPLEVEL="$(cd "$TOP" && ls -A | sort | tr '\n' ' ')"
if [[ "$TOPLEVEL" != "README.md app test-data " ]]; then
  echo "refusing: unexpected top-level entries: $TOPLEVEL" >&2; exit 1
fi
N_INNOVATION="$(grep -rn 'INNOVATION' "$TOP/app/src" | wc -l | tr -d ' ')"
if [[ "$N_INNOVATION" -lt 1 ]]; then
  echo "refusing: no INNOVATION comment in app/src. The brief marks Innovation from them." >&2; exit 1
fi

# ── zip ─────────────────────────────────────────────────────────────────────
mkdir -p dist
rm -f "$OUT"
(cd "$STAGE" && zip -q -r -X "$ROOT/$OUT" "$NAME")

echo
echo "==> $OUT   (commit ${SHA})"
echo "    $(du -h "$OUT" | cut -f1), $(unzip -l "$OUT" | tail -1 | awk '{print $2}') files, ${N_INNOVATION} INNOVATION comments"
echo "    Build the grading DMG from this same commit, then upload the DMG to the link in the README."
