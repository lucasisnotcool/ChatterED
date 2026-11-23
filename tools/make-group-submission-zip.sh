#!/usr/bin/env bash
#
# Build the final group project's system ZIP: `Group<N>_CUI_System.zip`.
#
# The system brief asks for "Your source code, prompts, and configuration files", a README.md,
# and "any test data or test accounts we need". It says "Do not include API keys". So the ZIP is:
#
#   README.md                              from docs/group/submission/README.md, placeholders filled
#   app/                                   every tracked file under app/ (source, prompts, config)
#   test-data/graph-traversal-tutorial.pdf    the sample tutorial the team wrote
#   test-data/graph-traversal-lecture.pdf     the sample lecture slides it is on, also the team's
#
# and nothing else. No study data, no transcripts, no report drafts, no course material, no team
# policy files, and no key bundle in the source.
#
# **The grading copy** (the DMG with its credit sealed inside) reaches the graders in one of two
# ways, and the caller chooses:
#
#   --dmg-link <url>   a download linked from the README; the DMG is not in this archive
#   --dmg <file>       the DMG itself at the top of the archive, named in the README as the
#                      preferred way to run the app (with --dmg-link too, the link is the spare)
#
# The second puts a working API credit inside the ZIP, where anyone holding the ZIP can use it.
# The brief says "Do not include API keys", and also that "Logins for test accounts you create for
# us are fine": which of the two a prepared, capped copy is, is the submitter's call, not this
# script's. Whichever is chosen, the README says plainly where the credit is.
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
#   tools/make-group-submission-zip.sh --group 5 (--dmg-link <url> | --dmg <file.dmg> | both) \
#       --contact <email> [--video <file.mp4> | --video-link <url>] [--out-suffix <text>]
# `--video` puts the file in the ZIP as ChatterED-demo.mp4 (the brief allows either).
# Output: dist/Group5_CUI_System.zip   (dist/ is git-ignored)
set -euo pipefail

GROUP="" DMG_LINK="" DMG_FILE="" VIDEO_LINK="" VIDEO_FILE="" CONTACT="" OUT_SUFFIX=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --group) GROUP="$2"; shift 2 ;;
    --dmg-link) DMG_LINK="$2"; shift 2 ;;
    --dmg) DMG_FILE="$2"; shift 2 ;;
    --out-suffix) OUT_SUFFIX="$2"; shift 2 ;;
    --video-link) VIDEO_LINK="$2"; shift 2 ;;
    --video) VIDEO_FILE="$2"; shift 2 ;;
    --contact) CONTACT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$GROUP" =~ ^[0-9A-Za-z]+$ ]] || { echo "refusing: --group <number> is required (the brief names the file GroupX_CUI_System.zip)." >&2; exit 2; }
[[ -n "$DMG_LINK" || -n "$DMG_FILE" ]] || { echo "refusing: --dmg-link <url> or --dmg <file> is required. Without the grading copy a grader cannot run the app, and the brief gives no credit then." >&2; exit 2; }
[[ -z "$DMG_FILE" || -s "$DMG_FILE" ]] || { echo "refusing: --dmg $DMG_FILE is missing or empty." >&2; exit 2; }
[[ -z "$DMG_FILE" || "$DMG_FILE" == *.dmg ]] || { echo "refusing: --dmg takes a .dmg file." >&2; exit 2; }
[[ "$OUT_SUFFIX" =~ ^[0-9A-Za-z._-]*$ ]] || { echo "refusing: --out-suffix takes letters, digits, dots, dashes and underscores." >&2; exit 2; }
[[ -n "$CONTACT" ]] || { echo "refusing: --contact <email> is required (for the online session the brief offers)." >&2; exit 2; }
[[ -z "$VIDEO_FILE" || -z "$VIDEO_LINK" ]] || { echo "refusing: give --video or --video-link, not both." >&2; exit 2; }
[[ -z "$VIDEO_FILE" || -s "$VIDEO_FILE" ]] || { echo "refusing: --video $VIDEO_FILE is missing or empty." >&2; exit 2; }
# Resolve the video's path now: the script changes directory below.
[[ -z "$VIDEO_FILE" ]] || VIDEO_FILE="$(cd "$(dirname "$VIDEO_FILE")" && pwd)/$(basename "$VIDEO_FILE")"
[[ -z "$DMG_FILE" ]] || DMG_FILE="$(cd "$(dirname "$DMG_FILE")" && pwd)/$(basename "$DMG_FILE")"
DMG_NAME="$([[ -z "$DMG_FILE" ]] || basename "$DMG_FILE")"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHA="$(git rev-parse --short HEAD)"
# The commit the app's code was last changed in: the grading copy must be built from it. The
# developers' notes in app/docs are not part of a build, so a later edit to them does not count.
APP_SHA="$(git log -1 --format=%h -- app ':(exclude)app/docs')"
NAME="Group${GROUP}_CUI_System"
# The archive inside is always Group<N>_CUI_System; a suffix only names the file kept in dist/.
OUT="dist/${NAME}${OUT_SUFFIX}.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/chattered-group-zip.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
TOP="$STAGE/$NAME"
mkdir -p "$TOP"

README_SRC='docs/group/submission/README.md'
SAMPLE_SRC='docs/group/submission/sample/graph-traversal-tutorial.pdf'
LECTURE_SRC='docs/group/submission/sample/graph-traversal-lecture.pdf'

# ── what goes in must match the commit ──────────────────────────────────────
DIRTY="$(git status --porcelain -- app "$README_SRC" "$SAMPLE_SRC" "$LECTURE_SRC")"
if [[ -n "$DIRTY" ]]; then
  echo "refusing: a path that goes into the archive is dirty. Commit it first: the graders mark" >&2
  echo "the version in the ZIP, and the grading copy must be built from the same commit." >&2
  echo "$DIRTY" >&2
  exit 1
fi
for f in "$README_SRC" "$SAMPLE_SRC" "$LECTURE_SRC"; do
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
cp "$SAMPLE_SRC" "$TOP/test-data/graph-traversal-tutorial.pdf"
cp "$LECTURE_SRC" "$TOP/test-data/graph-traversal-lecture.pdf"

# ── the README, with its placeholders filled ────────────────────────────────
if [[ -n "$VIDEO_FILE" ]]; then
  cp "$VIDEO_FILE" "$TOP/ChatterED-demo.mp4"
  VIDEO_TEXT='`ChatterED-demo.mp4`, at the top of this ZIP.'
else
  VIDEO_TEXT="${VIDEO_LINK:-we did not record one.}"
fi
# Where the grading copy is, and what the archive holds of it: three sentences of the README
# depend on whether the DMG is inside.
if [[ -n "$DMG_FILE" ]]; then
  cp "$DMG_FILE" "$TOP/$DMG_NAME"
  DMG_WHERE="\`$DMG_NAME\`, at the top of this ZIP."
  [[ -z "$DMG_LINK" ]] || DMG_WHERE="$DMG_WHERE The same file is also at $DMG_LINK"
  DMG_ROW="| \`$DMG_NAME\` | The prepared copy of the app, with its grading credit sealed inside (Section 1) |"
  KEYS_NOTE="The source code holds no API key. The prepared copy holds the one credit it runs on, sealed inside the app and made for grading only; we will withdraw it once grading is over."
  COPY_PLACE="in this ZIP"
else
  DMG_WHERE="$DMG_LINK"
  DMG_ROW=""
  KEYS_NOTE="There are no API keys in the ZIP: the credit is inside the prepared copy, which is the download in Section 1."
  COPY_PLACE="linked in Section 1"
fi
GROUP="$GROUP" DMG_WHERE="$DMG_WHERE" DMG_ROW="$DMG_ROW" KEYS_NOTE="$KEYS_NOTE" COPY_PLACE="$COPY_PLACE" VIDEO_TEXT="$VIDEO_TEXT" CONTACT="$CONTACT" SHA="$SHA" APP_SHA="$APP_SHA" \
python3 - "$README_SRC" "$TOP/README.md" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
for key, env in (('GROUP_NUMBER', 'GROUP'), ('GRADER_DMG_LINK', 'DMG_WHERE'), ('VIDEO_LINK', 'VIDEO_TEXT'), ('CONTACT_EMAIL', 'CONTACT'), ('API_KEYS_NOTE', 'KEYS_NOTE')):
    if key not in s:
        sys.exit(f'refusing: the README has no {key} placeholder to fill.')
    s = s.replace(key, os.environ[env])
# The DMG's row in the table of contents: its own line, there only when the DMG is inside.
if 'GRADER_DMG_ROW\n' not in s:
    sys.exit('refusing: the README has no GRADER_DMG_ROW line to fill.')
row = os.environ['DMG_ROW']
s = s.replace('GRADER_DMG_ROW\n', row + '\n' if row else '')
s += f"\n---\n\nBuilt from commit `{os.environ['SHA']}`. The code under `app/` (everything but the notes in `app/docs/`) was last changed in commit `{os.environ['APP_SHA']}`, and the grading copy {os.environ['COPY_PLACE']} is built from that code.\n"
open(dst, 'w', encoding='utf-8').write(s)
PY
if grep -nE 'GROUP_NUMBER|GRADER_DMG_LINK|GRADER_DMG_ROW|API_KEYS_NOTE|VIDEO_LINK|CONTACT_EMAIL' "$TOP/README.md"; then
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
  -o \( -name '*.dmg' ! -path "./$NAME/${DMG_NAME:-no-dmg-was-asked-for}" \) \
  -o \( -name '*.db' ! -path "./$NAME/app/samples/graph-traversal-seed/seed.db" \) \
  -o -name '*.sqlite' -o -name 'ChatterED-research-*' \
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
# Only the top-level entries the header names: the three always, the video and the DMG when asked for.
EXPECTED="$( { printf '%s\n' README.md app test-data; [[ -z "$VIDEO_FILE" ]] || echo ChatterED-demo.mp4; [[ -z "$DMG_FILE" ]] || echo "$DMG_NAME"; } | sort | tr '\n' ' ')"
TOPLEVEL="$(cd "$TOP" && ls -A | sort | tr '\n' ' ')"
if [[ "$TOPLEVEL" != "$EXPECTED" ]]; then
  echo "refusing: unexpected top-level entries: $TOPLEVEL (expected: $EXPECTED)" >&2; exit 1
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
if [[ -n "$DMG_FILE" ]]; then
  echo "    The grading DMG is inside (${DMG_NAME}). It must be the one built from app commit ${APP_SHA}."
  echo "    Check that the place you submit to accepts a file of this size."
else
  echo "    The grading DMG must be built from app commit ${APP_SHA}, and uploaded to the link in the README."
fi
