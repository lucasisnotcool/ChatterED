#!/usr/bin/env bash
# Build a release DMG of ChatterED from this checkout, prove it is sound, and (only when asked)
# publish it as a GitHub pre-release on the public releases repo.
#
#   tools/release.sh                      clean build → verify → out/ChatterED-<v>-arm64.dmg + SHA256SUMS.txt
#   tools/release.sh --publish v0.1.0     the same, then `gh release create` on $RELEASES_REPO
#   tools/release.sh --publish v0.1.0 --notes path/to/notes.md   use these notes instead of the default
#   tools/release.sh --study ~/.config/chattered-study/keys.json   a study build: the sealed key bundle
#                                         ships in Resources/study → out/ChatterED-Study-<v>-arm64.dmg.
#                                         Never published: it goes to participants privately
#                                         (app/docs/STUDY-RELEASE.md).
#   tools/release.sh --study <keys.json> --preload 3   one participant's own copy: slot 3's code
#                                         (from codes.csv beside the bundle, or --codes <file>) ships
#                                         too and is entered on first launch, so there is nothing to
#                                         type → out/ChatterED-Study-<v>-S03-arm64.dmg.
#
# The update channel (app/docs/STUDY-RELEASE.md §8). Study and update builds are on the `study`
# channel: they get a build number (last published + 1, or --build N) as CFBundleVersion, the
# compiled public keys (build/update-keys/) and the channel's manifest URL.
#   tools/release.sh --update             also an update payload in out/update/: <app>-<build>-arm64.zip
#                                         (ditto, no Resources/study), build-<N>.json and the signed
#                                         study-manifest-v1.json(.sig). A dry run: nothing is uploaded.
#   tools/release.sh --update --publish-update   upload it (main branch, clean tree, gate passed).
#   ... --target <install id>[,<id>]      publish this build to those installs only (canary).
#   ... --block N[,N]                     copies on build N leave it for this build, even if older.
#   ... --notes-text TEXT                 a short note in the manifest.
#   tools/release.sh --rollback-to N [--target <id>] [--publish-update]   no build: pin the channel
#                                         (or those installs) to published build N.
#   tools/release.sh --promote N [--publish-update]   no build: make published build N the default.
#   tools/release.sh --untarget <id>[,<id>] | --unblock N[,N] | --block N[,N] [--publish-update]
#                                         no build: edit the published manifest only (a pin set with
#                                         --rollback-to --target stays until --untarget).
#   tools/release.sh --paused | --resume [--publish-update]   no build: stop or restart installs.
#   tools/release.sh --key-add <pub.pem> | --key-revoke <key id> [--publish-update]   no build: rotate
#                                         keys; signed with the cold key (--sign-key, default
#                                         ~/.config/chattered-release/cold.key.pem from the offline drive).
#   --no-base                             publish without a fetched published manifest (the very first
#                                         publish, or when it cannot be read); otherwise refused.
#   --variant test --keys-dir <dir> [--test-endpoint URL] [--fault NAME] [--serve-dir <dir>]
#                                         the test variant: "ChatterED Test" (sg.nus.chattered.test,
#                                         its own userData), channel `test`, a local http manifest,
#                                         throwaway keys, an optional fault; --serve-dir is its "publish".
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
UPDATE=0; PUBLISH_UPDATE=0; BUILD=""; VARIANT=production; KEYS_DIR=""; SIGN_KEY=""; TEST_ENDPOINT=""
FAULT=""; SERVE_DIR=""; TARGETS=""; BLOCK=""; ROLLBACK_TO=""; PROMOTE=""; NOTES_TEXT=""
UNTARGET=""; UNBLOCK=""; NO_BASE=0; PAUSED=0; RESUME=0; KEY_ADD=""; KEY_REVOKE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) TAG="${2:?--publish needs a tag, e.g. v0.1.0}"; shift 2 ;;
    --notes) NOTES_FILE="${2:?--notes needs a file}"; shift 2 ;;
    --study) STUDY_BUNDLE="${2:?--study needs the keys.json from npm run study:keys}"; shift 2 ;;
    --preload) PRELOAD_SLOT="${2:?--preload needs a slot number}"; shift 2 ;;
    --codes) CODES_FILE="${2:?--codes needs the codes.csv from npm run study:keys}"; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --publish-update) PUBLISH_UPDATE=1; shift ;;
    --build) BUILD="${2:?--build needs a number}"; shift 2 ;;
    --variant) VARIANT="${2:?--variant is production or test}"; shift 2 ;;
    --keys-dir) KEYS_DIR="${2:?--keys-dir needs a folder}"; shift 2 ;;
    --sign-key) SIGN_KEY="${2:?--sign-key needs a private key file}"; shift 2 ;;
    --test-endpoint) TEST_ENDPOINT="${2:?--test-endpoint needs a URL}"; shift 2 ;;
    --fault) FAULT="${2:?--fault needs a name}"; shift 2 ;;
    --serve-dir) SERVE_DIR="${2:?--serve-dir needs a folder}"; shift 2 ;;
    --target) TARGETS="${2:?--target needs install ids}"; shift 2 ;;
    --block) BLOCK="${2:?--block needs build numbers}"; shift 2 ;;
    --rollback-to) ROLLBACK_TO="${2:?--rollback-to needs a build number}"; shift 2 ;;
    --promote) PROMOTE="${2:?--promote needs a build number}"; shift 2 ;;
    --notes-text) NOTES_TEXT="${2?--notes-text needs text}"; shift 2 ;;
    --untarget) UNTARGET="${2:?--untarget needs install ids}"; shift 2 ;;
    --unblock) UNBLOCK="${2:?--unblock needs build numbers}"; shift 2 ;;
    --no-base) NO_BASE=1; shift ;;
    --paused) PAUSED=1; shift ;;
    --resume) RESUME=1; shift ;;
    --key-add) KEY_ADD="${2:?--key-add needs a public key file}"; shift 2 ;;
    --key-revoke) KEY_REVOKE="${2:?--key-revoke needs a key id}"; shift 2 ;;
    -h|--help) sed -n '2,53p' "$0"; exit 0 ;;
    *) echo "release.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m[release]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[release] %s\033[0m\n' "$*" >&2; exit 1; }

VERSION="$(node -p "require('./package.json').version")"
[ "$(uname -m)" = "arm64" ] || die "Build on Apple Silicon: the DMG is arm64-only."

# ── variant, channel, build number (the update channel) ──────────────────────
RELEASE_HOME="$HOME/.config/chattered-release"
# A manifest edit with no build: --rollback-to, --promote, or --untarget/--unblock/--block alone.
EDIT_ONLY=0
if [ -n "$ROLLBACK_TO$PROMOTE" ]; then EDIT_ONLY=1
elif [ "$UPDATE" = 0 ] && [ -z "$STUDY_BUNDLE$TAG" ] && { [ -n "$UNTARGET$UNBLOCK$BLOCK$KEY_ADD$KEY_REVOKE" ] || [ "$PAUSED$RESUME" != 00 ]; }; then EDIT_ONLY=1; fi
if [ -n "$KEY_ADD$KEY_REVOKE" ]; then
  [ "$EDIT_ONLY" = 1 ] || die "--key-add / --key-revoke are a manifest edit on their own (no --update)."
  [ -z "$KEY_ADD" ] || [ -f "$KEY_ADD" ] || die "No public key at $KEY_ADD."
  SIGN_KEY="${SIGN_KEY:-$HOME/.config/chattered-release/cold.key.pem}"
  [ -f "$SIGN_KEY" ] || die "Key rotation is signed with the cold key: copy cold.key.pem from the offline drive and pass --sign-key <it>."
fi
case "$VARIANT" in
  production)
    PRODUCT="ChatterED"; APP_ID="sg.nus.chattered"
    [ -z "$FAULT$TEST_ENDPOINT$SERVE_DIR" ] || die "--fault, --test-endpoint and --serve-dir are for --variant test only."
    CHANNEL=""
    if [ "$UPDATE" = 1 ] || [ -n "$STUDY_BUNDLE" ] || [ "$EDIT_ONLY" = 1 ]; then CHANNEL="study"; fi
    KEYS_DIR="${KEYS_DIR:-$APP_DIR/build/update-keys}"
    SIGN_KEY="${SIGN_KEY:-$RELEASE_HOME/active.key.pem}"
    MANIFEST_URL="https://github.com/$RELEASES_REPO/releases/download/$CHANNEL-channel/$CHANNEL-manifest-v1.json"
    LEDGER="$RELEASE_HOME/builds-$CHANNEL.txt"
    ;;
  test)
    PRODUCT="ChatterED Test"; APP_ID="sg.nus.chattered.test"; CHANNEL="test"
    [ -n "$KEYS_DIR" ] || die "--variant test needs --keys-dir (a scratch folder made by: node tools/update-tool.mjs keygen --dir <it>)."
    [ "$PUBLISH_UPDATE" = 0 ] || die "The test variant is never published: use --serve-dir."
    [ -z "$STUDY_BUNDLE" ] || die "The test variant carries no study keys."
    [ -z "$TAG" ] || die "The test variant is never published."
    SIGN_KEY="${SIGN_KEY:-$KEYS_DIR/active.key.pem}"
    TEST_ENDPOINT="${TEST_ENDPOINT:-http://127.0.0.1:8765/test-manifest-v1.json}"
    MANIFEST_URL="$TEST_ENDPOINT"
    LEDGER="$KEYS_DIR/builds-$CHANNEL.txt"
    ;;
  *) die "--variant is production or test, not $VARIANT." ;;
esac
APP_NAME="$PRODUCT"
ASSET_SLUG="${PRODUCT// /-}"
[ -z "$TARGETS" ] || [[ "$TARGETS" =~ ^[A-Za-z0-9_-]{6,64}(,[A-Za-z0-9_-]{6,64})*$ ]] || die "--target takes install ids (from a pasted debug report), comma-separated."
[ -z "$BLOCK" ] || [[ "$BLOCK" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "--block takes build numbers, comma-separated."
[ -z "$UNBLOCK" ] || [[ "$UNBLOCK" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "--unblock takes build numbers, comma-separated."
[ -z "$UNTARGET" ] || [[ "$UNTARGET" =~ ^[A-Za-z0-9_-]{6,64}(,[A-Za-z0-9_-]{6,64})*$ ]] || die "--untarget takes install ids, comma-separated."
[ "$PUBLISH_UPDATE" = 0 ] || [ "$UPDATE" = 1 ] || [ "$EDIT_ONLY" = 1 ] || die "--publish-update goes with --update, --rollback-to, --promote, --untarget, --unblock or --block."
[ -z "$ROLLBACK_TO" ] || [ -z "$PROMOTE" ] || die "--rollback-to or --promote, not both."
[ "$UPDATE" = 0 ] || [ -z "$STUDY_BUNDLE" ] || die "An update payload is an ordinary build: drop --study."
if [ -n "$CHANNEL" ]; then
  [ -f "$KEYS_DIR/active.pub.pem" ] && [ -f "$KEYS_DIR/cold.pub.pem" ] \
    || die "No update keys in $KEYS_DIR (active.pub.pem, cold.pub.pem). The owner runs, once: node tools/update-tool.mjs keygen, then copies the two .pub.pem files there (STUDY-RELEASE.md §8)."
fi

UPD="$APP_DIR/out/update"
UPD_KEEP="$(mktemp -d "${TMPDIR:-/tmp}/chattered-upd.XXXXXX")"
PUBLISHED="$UPD_KEEP/published.json"
# What the channel says now: the base every new manifest keeps, and the floor for a new build.
fetch_published() {
  rm -f "$PUBLISHED"
  if [ "$VARIANT" = test ]; then
    if [ -n "$SERVE_DIR" ] && [ -f "$SERVE_DIR/$CHANNEL-manifest-v1.json" ]; then cp "$SERVE_DIR/$CHANNEL-manifest-v1.json" "$PUBLISHED"; fi
    return 0
  fi
  local code
  code="$(curl -sSL -o "$PUBLISHED" -w '%{http_code}' "$MANIFEST_URL" || true)"
  case "$code" in
    200) ;;
    404) rm -f "$PUBLISHED" ;;   # nothing published on this channel yet
    *) rm -f "$PUBLISHED"; [ -n "$BUILD" ] && [ "$EDIT_ONLY" = 0 ] || die "Could not read the published manifest ($MANIFEST_URL, HTTP $code); pass --build N (and --no-base to publish without it)." ;;
  esac
}
published_max() { if [ -f "$PUBLISHED" ]; then node tools/update-tool.mjs builds --in "$PUBLISHED"; else echo 0; fi; }
ledger_max() { if [ -f "$LEDGER" ]; then sort -n "$LEDGER" | tail -1; else echo 0; fi; }
# Where build N's entry is (each publish uploads build-N.json next to its zip).
entry_url() {
  if [ "$VARIANT" = test ]; then echo "$SERVE_DIR/build-$1.json"
  else echo "https://github.com/$RELEASES_REPO/releases/download/$CHANNEL-build-$1/build-$1.json"; fi
}
asset_url() {
  if [ "$VARIANT" = test ]; then echo "${TEST_ENDPOINT%/*}/$2"
  else echo "https://github.com/$RELEASES_REPO/releases/download/$CHANNEL-build-$1/$2"; fi
}

if [ -n "$CHANNEL" ]; then
  fetch_published
  PUB_MAX="$(published_max)"
  if [ "$EDIT_ONLY" = 0 ]; then
    LED_MAX="$(ledger_max)"
    FLOOR=$(( PUB_MAX > LED_MAX ? PUB_MAX : LED_MAX ))
    BUILD="${BUILD:-$(( FLOOR + 1 ))}"
    [[ "$BUILD" =~ ^[0-9]+$ ]] || die "--build takes a number."
    [ "$BUILD" -gt "$PUB_MAX" ] || die "Build $BUILD is not above the published $PUB_MAX: every copy would ignore it (never downgrade)."
    say "Channel $CHANNEL: build $BUILD (published up to $PUB_MAX, allocated up to $LED_MAX)."
  fi
else
  BUILD="${BUILD:-$(git rev-list --count HEAD)}"
fi
GIT_SHA="$(git rev-parse --short=12 HEAD)"
DB_SCHEMA="$(ls "$APP_DIR/src/main/db/migrations" | sed -n 's/^\([0-9][0-9][0-9]\)_.*\.sql$/\1/p' | sort -n | tail -1 | sed 's/^0*//')"

# Sign, then check with the keys in KEYS_DIR through the app's own verifier (dist/main/update/).
sign_and_check() {
  local manifest="$1"
  [ -f "$SIGN_KEY" ] || die "No signing key at $SIGN_KEY."
  node tools/update-tool.mjs sign --key "$SIGN_KEY" --in "$manifest"
  local check="$UPD_KEEP/check-baked.json"
  node -e '
    const fs=require("fs"),c=require("crypto"),p=require("path");const [dir,variant,out]=process.argv.slice(1);
    const keys=["active","cold"].filter(r=>fs.existsSync(p.join(dir,r+".pub.pem"))).map(r=>{const pem=fs.readFileSync(p.join(dir,r+".pub.pem"),"utf8");
      const id=c.createHash("sha256").update(c.createPublicKey(pem).export({type:"spki",format:"der"})).digest("hex").slice(0,16);return {id,role:r,pem};});
    fs.writeFileSync(out,JSON.stringify({variant,test:variant==="test",keys,channel:"x"}));' "$KEYS_DIR" "$VARIANT" "$check"
  [ -f dist/main/update/manifest.js ] || npm run -s build:main >/dev/null
  node tools/update-tool.mjs verify --baked "$check" --in "$manifest" | sed 's/^/    default: /' || die "The signed manifest does not verify with the keys in $KEYS_DIR."
  local id
  for id in ${TARGETS//,/ }; do
    node tools/update-tool.mjs verify --baked "$check" --in "$manifest" --install-id "$id" | sed "s/^/    target $id: /"
  done
}

# Upload (production) or copy into the served folder (test). The zip goes before the manifest,
# and the manifest's .sig right after it: a client that reads a mismatched pair just tries later.
deliver() {
  local manifest="$1"; shift
  # Every client refuses a manifest whose seq is not above the newest it has seen (stale_seq).
  if [ -f "$PUBLISHED" ]; then
    node -e 'const [a,b]=process.argv.slice(1).map(f=>Number(require(f).seq)||0); if(!(a>b)){console.error(`seq ${a} is not above the published ${b}`);process.exit(1)}' "$manifest" "$PUBLISHED" \
      || die "The new manifest's seq is not above the published one: every install would refuse it."
  fi
  if [ "$VARIANT" = test ]; then
    if [ -z "$SERVE_DIR" ]; then say "Dry run: nothing served (pass --serve-dir)."; return 0; fi
    mkdir -p "$SERVE_DIR"
    local f; for f in "$@"; do cp "$f" "$SERVE_DIR/"; done
    cp "$manifest" "$SERVE_DIR/$CHANNEL-manifest-v1.json.tmp" && mv "$SERVE_DIR/$CHANNEL-manifest-v1.json.tmp" "$SERVE_DIR/$CHANNEL-manifest-v1.json"
    cp "$manifest.sig" "$SERVE_DIR/$CHANNEL-manifest-v1.json.sig"
    say "Served from $SERVE_DIR: the manifest and $# file(s)."
    return 0
  fi
  if [ "$PUBLISH_UPDATE" != 1 ]; then say "Dry run: nothing uploaded (pass --publish-update)."; return 0; fi
  command -v gh >/dev/null || die "gh is not installed."
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "The study channel is published from main only (this is $(git rev-parse --abbrev-ref HEAD))."
  [ -z "$(git status --porcelain -- .)" ] || die "app/ has uncommitted or untracked changes; commit them before publishing."
  [ -f "$RELEASE_HOME/gate/pass-$GIT_SHA" ] || die "No release-gate pass for $GIT_SHA: run tools/update-gate.mjs first (STUDY-RELEASE.md §8)."
  # Without the published manifest as its base, a publish would drop every block and target.
  [ -f "$PUBLISHED" ] || [ "$NO_BASE" = 1 ] || die "No published manifest was read, so its blocks and targets would be lost. Pass --no-base only for the first publish."
  if [ "$#" -gt 0 ]; then
    gh release create "$CHANNEL-build-$BUILD" "$@" --repo "$RELEASES_REPO" --prerelease \
      --title "$PRODUCT build $BUILD ($CHANNEL channel)" --notes "Update payload for the $CHANNEL channel, build $BUILD ($GIT_SHA). Installed by the app itself; not for download by hand."
  fi
  gh release view "$CHANNEL-channel" --repo "$RELEASES_REPO" >/dev/null 2>&1 \
    || gh release create "$CHANNEL-channel" --repo "$RELEASES_REPO" --prerelease --title "$PRODUCT $CHANNEL update channel" \
         --notes "The $CHANNEL channel's signed manifest. Its assets are replaced on each publish."
  gh release upload "$CHANNEL-channel" "$manifest#$CHANNEL-manifest-v1.json" --repo "$RELEASES_REPO" --clobber
  gh release upload "$CHANNEL-channel" "$manifest.sig#$CHANNEL-manifest-v1.json.sig" --repo "$RELEASES_REPO" --clobber
  say "Published. Checking what a participant's Mac will fetch…"
  local back; back="$(mktemp -d "${TMPDIR:-/tmp}/chattered-check.XXXXXX")"
  curl -fsSL -o "$back/m.json" "$MANIFEST_URL" && curl -fsSL -o "$back/m.json.sig" "$MANIFEST_URL.sig" \
    || die "Could not fetch the manifest back from $MANIFEST_URL."
  cmp -s "$back/m.json" "$manifest" || die "The manifest at $MANIFEST_URL is not the one just signed (a CDN delay? check again in a minute)."
  local url sha
  url="$(node -p 'require(process.argv[1]).url' "$back/m.json")"; sha="$(node -p 'require(process.argv[1]).sha256' "$back/m.json")"
  curl -fsSL -o "$back/p.zip" "$url" || die "Could not download $url."
  [ "$(shasum -a 256 "$back/p.zip" | cut -d' ' -f1)" = "$sha" ] || die "The published zip's sha256 is not the manifest's."
  mkdir "$back/x" && ditto -x -k "$back/p.zip" "$back/x" && codesign --verify --deep --strict "$back/x/"*.app \
    || die "The published zip does not extract to a bundle that verifies."
  rm -rf "$back"
  say "Verified from GitHub: manifest, signature, zip sha256 and the extracted bundle's signature."
}

# ── manifest-only operations: no build ──────────────────────────────────────
if [ "$EDIT_ONLY" = 1 ]; then
  [ -f "$PUBLISHED" ] || die "Nothing is published on the $CHANNEL channel yet (or it could not be read)."
  mkdir -p "$UPD"
  ARGS=(manifest --app-id "$APP_ID" --channel "$CHANNEL" --out "$UPD/$CHANNEL-manifest-v1.json" --base "$PUBLISHED")
  N="$ROLLBACK_TO$PROMOTE"
  if [ -n "$N" ]; then
    ENTRY="$UPD/build-$N.json"
    if [ "$VARIANT" = test ]; then cp "$(entry_url "$N")" "$ENTRY" || die "No build-$N.json in $SERVE_DIR."
    else curl -fsSL -o "$ENTRY" "$(entry_url "$N")" || die "Build $N has no published entry ($(entry_url "$N"))."; fi
    if [ -n "$ROLLBACK_TO" ]; then
      # A copy whose database is newer than build N knows skips the rollback (schema_too_new).
      OLD_SCHEMA="$(node -p 'require(process.argv[1]).dbSchema ?? 0' "$ENTRY")"
      NOW_SCHEMA="$(node -p 'require(process.argv[1]).dbSchema ?? 0' "$PUBLISHED")"
      if [ "$OLD_SCHEMA" -lt "$NOW_SCHEMA" ]; then
        say "WARNING: build $N knows migrations up to $OLD_SCHEMA, the published build up to $NOW_SCHEMA."
        say "         Every Mac that ran a build with a newer migration will skip this rollback (schema_too_new)."
        say "         Publish a fix as a new build instead, or --block the bad build with that fix."
      fi
    fi
    if [ -n "$TARGETS" ]; then
      for id in ${TARGETS//,/ }; do
        if [ -n "$ROLLBACK_TO" ]; then ARGS+=(--target-pin "$id=$ENTRY"); else ARGS+=(--target "$id=$ENTRY"); fi
      done
    else
      ARGS+=(--default "$ENTRY"); if [ -n "$ROLLBACK_TO" ]; then ARGS+=(--pin); fi
    fi
    BUILD="$N"
  fi
  if [ -n "$UNTARGET" ]; then ARGS+=(--untarget "$UNTARGET"); fi
  if [ -n "$BLOCK" ]; then ARGS+=(--block "$BLOCK"); fi
  if [ -n "$UNBLOCK" ]; then ARGS+=(--unblock "$UNBLOCK"); fi
  if [ "$PAUSED" = 1 ]; then ARGS+=(--paused); fi
  if [ "$RESUME" = 1 ]; then ARGS+=(--resume); fi
  if [ -n "$KEY_ADD" ]; then ARGS+=(--key-add "$KEY_ADD"); fi
  if [ -n "$KEY_REVOKE" ]; then ARGS+=(--key-revoke "$KEY_REVOKE"); fi
  if [ -n "$NOTES_TEXT" ]; then ARGS+=(--notes "$NOTES_TEXT"); fi
  node tools/update-tool.mjs "${ARGS[@]}"
  sign_and_check "$UPD/$CHANNEL-manifest-v1.json"
  deliver "$UPD/$CHANNEL-manifest-v1.json"
  rm -rf "$UPD_KEEP"
  exit 0
fi

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
say "Building $APP_NAME $VERSION build $BUILD ($GIT_SHA, channel ${CHANNEL:-none}, variant $VARIANT)…"
rm -rf out
# What the build carries about itself (scripts/copy-assets.mjs → dist/main/update/baked.json).
unset CHATTERED_BUILD CHATTERED_SHA CHATTERED_UPDATE_CHANNEL CHATTERED_VARIANT CHATTERED_UPDATE_KEYS_DIR CHATTERED_UPDATE_TEST_URL CHATTERED_TEST_FAULT
export CHATTERED_BUILD="$BUILD" CHATTERED_SHA="$GIT_SHA" CHATTERED_VARIANT="$VARIANT"
if [ -n "$CHANNEL" ]; then export CHATTERED_UPDATE_CHANNEL="$CHANNEL" CHATTERED_UPDATE_KEYS_DIR="$KEYS_DIR"; fi
if [ "$VARIANT" = test ]; then
  export CHATTERED_UPDATE_TEST_URL="$TEST_ENDPOINT"
  if [ -n "$FAULT" ]; then export CHATTERED_TEST_FAULT="$FAULT"; fi
fi
npm run build                       # cleans dist/, compiles, writes the licence notices
EB_ARGS=(--mac dmg "-c.buildVersion=$BUILD")
if [ "$VARIANT" = test ]; then
  EB_ARGS+=("-c.appId=$APP_ID" "-c.productName=$PRODUCT" "-c.extraMetadata.productName=$PRODUCT")
fi
npx --no-install electron-builder "${EB_ARGS[@]}"
if [ -n "$CHANNEL" ]; then
  # The build number is spent once built, published or not, so the next one is always higher.
  mkdir -p "$(dirname "$LEDGER")"
  grep -qx "$BUILD" "$LEDGER" 2>/dev/null || echo "$BUILD" >> "$LEDGER"
fi

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

# What the build says about itself: a production build can never point anywhere but GitHub over
# https, relax verification, or carry a fault.
node -e '
  const b=JSON.parse(require("fs").readFileSync("dist/main/update/baked.json","utf8"));const [variant,channel,build]=process.argv.slice(1);
  const bad=[];
  if(b.variant!==variant)bad.push("variant "+b.variant);
  if(String(b.build)!==build)bad.push("build "+b.build);
  if((b.channel||"")!==channel)bad.push("channel "+b.channel);
  if(variant==="production"&&(b.test||b.fault||b.manifestUrls.length))bad.push("test settings in a production build");
  if(channel&&b.keys.length<2)bad.push("fewer than two keys");
  if(bad.length){console.error(bad.join("; "));process.exit(1);}' "$VARIANT" "$CHANNEL" "$BUILD" \
  || die "dist/main/update/baked.json is not what this release asked for."

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
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$DMG_APP/Contents/Info.plist")" = "$BUILD" ] || die "CFBundleVersion in the DMG is not $BUILD."
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DMG_APP/Contents/Info.plist")" = "$APP_ID" ] || die "CFBundleIdentifier in the DMG is not $APP_ID."
[ -x "$DMG_APP/Contents/Resources/chattered-swap" ] || die "Contents/Resources/chattered-swap (the atomic swap) is missing."
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


# ── the update payload (only with --update) ─────────────────────────────────
if [ "$UPDATE" = 1 ]; then
  [ ! -e "$APP_DIR/study/keys.json" ] && [ ! -e "$APP_DIR/study/preload.txt" ] || die "app/study holds a key bundle or a code: an update must never carry either."
  [ ! -e "$BUILT_APP/Contents/Resources/study" ] || die "$BUILT_APP carries Contents/Resources/study: never in an update."
  mkdir -p "$UPD"
  ZIP_NAME="$ASSET_SLUG-$BUILD-arm64.zip"
  ZIP="$UPD/$ZIP_NAME"
  rm -f "$ZIP"
  # ditto, never zip: a zip that drops symlinks breaks the Electron framework's signature.
  ditto -c -k --keepParent "$BUILT_APP" "$ZIP"
  if zipinfo -1 "$ZIP" | grep -q 'Contents/Resources/study/'; then die "The zip has a Contents/Resources/study/ entry."; fi
  if unzip -p "$ZIP" 2>/dev/null | LC_ALL=C grep -a -q -F "$HOME/"; then die "A path under $HOME is inside the zip."; fi
  if unzip -p "$ZIP" 2>/dev/null | LC_ALL=C grep -a -q -E 'S[0-9]{2,3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}'; then die "Something shaped like a study code is inside the zip."; fi
  # Extract it exactly as the app will, and check what comes out.
  RT="$UPD_KEEP/roundtrip"
  mkdir -p "$RT"
  ditto -x -k "$ZIP" "$RT"
  codesign --verify --deep --strict "$RT/$APP_NAME.app" || die "The zip does not extract to a bundle that verifies."
  CD1="$(codesign -dv --verbose=4 "$BUILT_APP" 2>&1 | sed -n 's/^CDHash=//p')"
  CD2="$(codesign -dv --verbose=4 "$RT/$APP_NAME.app" 2>&1 | sed -n 's/^CDHash=//p')"
  [ -n "$CD1" ] && [ "$CD1" = "$CD2" ] || die "The extracted bundle's CDHash differs from the built one."
  rm -rf "$RT"
  ENTRY="$UPD/build-$BUILD.json"
  node tools/update-tool.mjs entry --app "$BUILT_APP" --zip "$ZIP" --url "$(asset_url "$BUILD" "$ZIP_NAME")" --build "$BUILD" --commit "$GIT_SHA" --db-schema "$DB_SCHEMA" > "$ENTRY"
  ARGS=(manifest --app-id "$APP_ID" --channel "$CHANNEL" --out "$UPD/$CHANNEL-manifest-v1.json")
  if [ -f "$PUBLISHED" ]; then ARGS+=(--base "$PUBLISHED"); fi
  if [ -n "$TARGETS" ]; then
    [ -f "$PUBLISHED" ] || die "--target needs a published channel default to keep for everyone else."
    for id in ${TARGETS//,/ }; do ARGS+=(--target "$id=$ENTRY"); done
  else
    ARGS+=(--default "$ENTRY")
  fi
  if [ -n "$BLOCK" ]; then ARGS+=(--block "$BLOCK"); fi
  if [ -n "$UNBLOCK" ]; then ARGS+=(--unblock "$UNBLOCK"); fi
  if [ -n "$UNTARGET" ]; then ARGS+=(--untarget "$UNTARGET"); fi
  if [ -n "$NOTES_TEXT" ]; then ARGS+=(--notes "$NOTES_TEXT"); fi
  node tools/update-tool.mjs "${ARGS[@]}"
  sign_and_check "$UPD/$CHANNEL-manifest-v1.json"
  say "Update payload:"
  printf '    zip:      %s (%s bytes)\n' "$ZIP" "$(stat -f %z "$ZIP")"
  printf '    entry:    %s\n' "$ENTRY"
  printf '    manifest: %s (+ .sig)\n' "$UPD/$CHANNEL-manifest-v1.json"
  printf '    fetched from: %s\n' "$MANIFEST_URL"
  deliver "$UPD/$CHANNEL-manifest-v1.json" "$ZIP" "$ENTRY"
fi
rm -rf "$UPD_KEEP"

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
