#!/usr/bin/env bash
# Build a release DMG of ChatterED from this checkout, prove it is sound, and (only when asked)
# publish it as a GitHub pre-release on the public releases repo.
#
#   tools/release.sh                      clean build → verify → out/ChatterED-<v>-arm64.dmg + SHA256SUMS.txt
#   tools/release.sh --publish v0.1.0     the same, then `gh release create` on $RELEASES_REPO
#   tools/release.sh --publish v0.1.0 --notes path/to/notes.md   use these notes instead of the default
#   tools/release.sh --study ~/data/chattered-study/keys.json   a study build: the sealed key bundle
#                                         ships in Resources/study → out/ChatterED-Study-<v>-arm64.dmg.
#                                         Never published: it goes to participants privately
#                                         (app/docs/STUDY-RELEASE.md).
#   tools/release.sh --study <keys.json> --preload 3   one participant's own copy: slot 3's code
#                                         (from codes.csv beside the bundle, or --codes <file>) ships
#                                         too and is entered on first launch, so there is nothing to
#                                         type → out/ChatterED-Study-<v>-S03-arm64.dmg.
#
# Uses the node_modules already installed (no `npm ci`). What it checks before it prints a hash:
#   - dist/ and out/ were rebuilt from scratch (no stale compiled file or old DMG can ship);
#   - the .app inside the DMG passes `codesign --verify --deep --strict` (ad-hoc signed by
#     build/after-pack.cjs — without it a downloaded copy opens as "damaged");
#   - Electron's fuses read back as flipped;
#   - the licence notices are in Contents/Resources;
#   - no matriculation number or home-directory path is in the shipped code.
# Publishing refuses a dirty app/ tree, so a release is always a commit someone can check out.
set -euo pipefail

RELEASES_REPO="lucasisnotcool/ChatterED-releases"
APP_NAME="ChatterED"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

TAG=""
NOTES_FILE=""
STUDY_BUNDLE=""
PRELOAD_SLOT=""
CODES_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) TAG="${2:?--publish needs a tag, e.g. v0.1.0}"; shift 2 ;;
    --notes) NOTES_FILE="${2:?--notes needs a file}"; shift 2 ;;
    --study) STUDY_BUNDLE="${2:?--study needs the keys.json from npm run study:keys}"; shift 2 ;;
    --preload) PRELOAD_SLOT="${2:?--preload needs a slot number}"; shift 2 ;;
    --codes) CODES_FILE="${2:?--codes needs the codes.csv from npm run study:keys}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "release.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m[release]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[release] %s\033[0m\n' "$*" >&2; exit 1; }

VERSION="$(node -p "require('./package.json').version")"
[ "$(uname -m)" = "arm64" ] || die "Build on Apple Silicon: the DMG is arm64-only."

# ── the study bundle: in a study build, and in no other ─────────────────────
# electron-builder copies study/keys.json into Resources/study whenever it exists, so an ordinary
# build refuses to start with one lying there, and a study build removes its copy when it ends.
STUDY_DEST="$APP_DIR/study/keys.json"
# A preloaded copy's code (src/main/study/service.ts, `unlockPreloaded`), under the same rule.
PRELOAD_DEST="$APP_DIR/study/preload.txt"
[ -z "$PRELOAD_SLOT" ] || [ -n "$STUDY_BUNDLE" ] || die "--preload is for a study build: pass --study too."
if [ -n "$STUDY_BUNDLE" ]; then
  [ -z "$TAG" ] || die "A study build carries participants' sealed keys: it is never published. Drop --publish."
  [ -f "$STUDY_BUNDLE" ] || die "No study bundle at $STUDY_BUNDLE."
  node -e "const b=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if (b.format!=='chattered-study-keys'||!b.slots||!Object.keys(b.slots).length) process.exit(1)" "$STUDY_BUNDLE" \
    || die "$STUDY_BUNDLE is not a study bundle (npm run study:keys makes one)."
  STUDY_SLOTS="$(node -p "Object.keys(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).slots).length" "$STUDY_BUNDLE")"
  PRELOAD_CODE=""
  if [ -n "$PRELOAD_SLOT" ]; then
    [[ "$PRELOAD_SLOT" =~ ^[0-9]{1,3}$ ]] || die "--preload takes a slot number, not $PRELOAD_SLOT."
    PRELOAD_SLOT="$(printf '%02d' "$((10#$PRELOAD_SLOT))")"
    CODES_FILE="${CODES_FILE:-$(dirname "$STUDY_BUNDLE")/codes.csv}"
    [ -f "$CODES_FILE" ] || die "No codes file at $CODES_FILE (pass --codes)."
    PRELOAD_CODE="$(awk -F, -v s="$PRELOAD_SLOT" '$1 == s { print $2 }' "$CODES_FILE" | tr -d '[:space:]')"
    [ -n "$PRELOAD_CODE" ] || die "Slot $PRELOAD_SLOT is not in $CODES_FILE."
  fi
  cp "$STUDY_BUNDLE" "$STUDY_DEST"
  trap 'rm -f "$STUDY_DEST" "$PRELOAD_DEST"' EXIT
  if [ -n "$PRELOAD_CODE" ]; then
    ( umask 022; printf '%s\n' "$PRELOAD_CODE" > "$PRELOAD_DEST" )
    say "Study build: $STUDY_SLOTS participant slot(s) sealed in; slot $PRELOAD_SLOT preloaded."
  else
    say "Study build: $STUDY_SLOTS participant slot(s) sealed in."
  fi
elif [ -e "$STUDY_DEST" ] || [ -e "$PRELOAD_DEST" ]; then
  die "$APP_DIR/study holds a key bundle or a preloaded code, and an ordinary build must not carry either. Remove it, or pass --study."
fi

if [ -n "$TAG" ]; then
  command -v gh >/dev/null || die "gh is not installed."
  [ -z "$(git status --porcelain -- .)" ] || die "app/ has uncommitted or untracked changes; commit them before publishing."
  [ "${TAG#v}" = "$VERSION" ] || die "Tag $TAG does not match package.json version $VERSION."
elif [ -n "$(git status --porcelain -- .)" ]; then
  say "warning: app/ has uncommitted changes — this build is not a commit anyone can reproduce."
fi

# ── build ─────────────────────────────────────────────────────────────────────
say "Building $APP_NAME $VERSION ($(git rev-parse --short HEAD))…"
rm -rf out
npm run build                       # cleans dist/, compiles, writes the licence notices
npx --no-install electron-builder --mac dmg

DMG="$APP_DIR/out/$APP_NAME-$VERSION-arm64.dmg"
[ -f "$DMG" ] || die "electron-builder produced no $DMG."
BUILT_APP="$APP_DIR/out/mac-arm64/$APP_NAME.app"
if [ -n "$STUDY_BUNDLE" ]; then
  rm -f "$STUDY_DEST" "$PRELOAD_DEST"
  STUDY_DMG="$APP_DIR/out/$APP_NAME-Study-$VERSION${PRELOAD_SLOT:+-S$PRELOAD_SLOT}-arm64.dmg"
  mv "$DMG" "$STUDY_DMG"
  DMG="$STUDY_DMG"
fi

# ── shipped-content checks (on dist/, which is what app.asar holds) ─────────
if grep -rIlE 'A0[0-9]{6}[A-Z]' --exclude='*.map' dist >/dev/null; then
  grep -rIlE 'A0[0-9]{6}[A-Z]' --exclude='*.map' dist >&2
  die "A matriculation number is in the shipped code (files above)."
fi
if grep -rIl "$HOME" --exclude='*.map' dist >/dev/null; then
  grep -rIl "$HOME" --exclude='*.map' dist >&2
  die "A path under $HOME is in the shipped code (files above)."
fi

# ── verify what a user actually gets: the app inside the DMG ────────────────
MNT="$(mktemp -d "${TMPDIR:-/tmp}/chattered-dmg.XXXXXX")"
cleanup() { hdiutil detach -quiet "$MNT" 2>/dev/null || true; rmdir "$MNT" 2>/dev/null || true; [ -z "$STUDY_BUNDLE" ] || rm -f "$STUDY_DEST" "$PRELOAD_DEST"; }
trap cleanup EXIT
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MNT" "$DMG"
DMG_APP="$MNT/$APP_NAME.app"
[ -d "$DMG_APP" ] || die "No $APP_NAME.app inside the DMG."

say "Signature (app inside the DMG):"
verify_out="$(codesign --verify --deep --strict --verbose=2 "$DMG_APP" 2>&1)" \
  || { printf '%s\n' "$verify_out" >&2; die "codesign --verify --deep --strict failed: a downloaded copy would open as \"damaged\"."; }
grep -vE '^--(prepared|validated):' <<<"$verify_out" | sed 's/^/    /'
codesign -dv "$DMG_APP" 2>&1 | grep -E '^(Identifier|Signature|Sealed Resources)' | sed 's/^/    /'

for f in THIRD_PARTY_NOTICES.txt LICENSE.electron.txt LICENSES.chromium.html; do
  [ -s "$DMG_APP/Contents/Resources/$f" ] || die "Missing Contents/Resources/$f in the app."
done

say "Fuses:"
npx --no-install @electron/fuses read --app "$DMG_APP" 2>&1 | sed 's/^/    /'
fuses="$(npx --no-install @electron/fuses read --app "$DMG_APP" 2>&1)"
for want in 'RunAsNode is Disabled' 'EnableNodeOptionsEnvironmentVariable is Disabled' \
            'EnableNodeCliInspectArguments is Disabled' 'OnlyLoadAppFromAsar is Enabled' \
            'EnableEmbeddedAsarIntegrityValidation is Enabled'; do
  grep -q "$want" <<<"$fuses" || die "Fuse check failed: expected \"$want\"."
done

SHIPPED_BUNDLE="$DMG_APP/Contents/Resources/study/keys.json"
if [ -n "$STUDY_BUNDLE" ]; then
  cmp -s "$STUDY_BUNDLE" "$SHIPPED_BUNDLE" || die "The study bundle inside the DMG is missing or differs from $STUDY_BUNDLE."
  say "Study bundle: in Contents/Resources/study, identical to $STUDY_BUNDLE."
elif [ -e "$SHIPPED_BUNDLE" ]; then
  die "An ordinary build carries a study bundle ($SHIPPED_BUNDLE)."
fi
SHIPPED_PRELOAD="$DMG_APP/Contents/Resources/study/preload.txt"
if [ -n "$PRELOAD_SLOT" ]; then
  [ "$(tr -d '[:space:]' < "$SHIPPED_PRELOAD" 2>/dev/null)" = "$PRELOAD_CODE" ] \
    || die "The preloaded code inside the DMG is missing or is not slot $PRELOAD_SLOT's."
  say "Preloaded: slot $PRELOAD_SLOT's code, entered on first launch."
elif [ -e "$SHIPPED_PRELOAD" ]; then
  die "This build carries a preloaded code it was not asked for ($SHIPPED_PRELOAD)."
fi

MIN_OS="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$DMG_APP/Contents/Info.plist")"
cleanup
trap - EXIT

# ── checksum ──────────────────────────────────────────────────────────────────
DMG_BASENAME="$(basename "$DMG")"
SUMS="$APP_DIR/out/SHA256SUMS.txt"
( cd "$APP_DIR/out" && shasum -a 256 "$DMG_BASENAME" > SHA256SUMS.txt )
SHA="$(cut -d' ' -f1 "$SUMS")"
BYTES="$(stat -f %z "$DMG")"

say "Done."
printf '    dmg:      %s\n' "$DMG"
printf '    size:     %s bytes (%s MB)\n' "$BYTES" "$(( (BYTES + 500000) / 1000000 ))"
printf '    sha256:   %s\n' "$SHA"
printf '    sums:     %s\n' "$SUMS"
printf '    macOS:    %s or later, Apple Silicon\n' "$MIN_OS"
printf '    local app (not the DMG copy): %s\n' "$BUILT_APP"

[ -n "$TAG" ] || exit 0

# ── publish (only with --publish <tag>) ─────────────────────────────────────
if [ -z "$NOTES_FILE" ]; then
  NOTES_FILE="$APP_DIR/out/RELEASE_NOTES.md"
  cat >"$NOTES_FILE" <<EOF
$APP_NAME $VERSION — a research prototype (NUS CS3249). Apple Silicon Macs, macOS $MIN_OS or later.

## Install

1. Download \`$DMG_BASENAME\`, open it, and drag **$APP_NAME** onto **Applications**.
2. Open $APP_NAME from Applications. macOS will say it cannot verify the developer: the app is
   not signed with an Apple Developer ID. Click **Done** (not Move to Trash).
3. Open **System Settings ▸ Privacy & Security**, scroll to Security, and click **Open Anyway**
   next to "$APP_NAME was blocked". Confirm with your password. You only do this once per version.

## Verify the download (optional)

\`\`\`
shasum -a 256 $DMG_BASENAME
\`\`\`

should print \`$SHA\`, which is also in \`SHA256SUMS.txt\`.
EOF
fi

say "Publishing $TAG to $RELEASES_REPO (pre-release)…"
gh release create "$TAG" "$DMG" "$SUMS" \
  --repo "$RELEASES_REPO" \
  --title "$APP_NAME $VERSION" \
  --notes-file "$NOTES_FILE" \
  --prerelease
say "Published: https://github.com/$RELEASES_REPO/releases/tag/$TAG"
