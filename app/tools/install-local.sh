#!/bin/bash
#
# Build ChatterED from this checkout and install it as ~/Applications/ChatterED.app (issue #20).
#
# The shape is Scribe's (ScribeBar/build.sh): build into a scratch directory, and replace the
# installed app **only after** the build has succeeded. An unattended job that runs every six
# hours will eventually run during a broken commit, and the cost of that has to be "yesterday's
# app and a line in the log", never "no app at all".
#
# Unsigned by decision #17 — no Developer ID, no notarisation. The bundle is ad-hoc signed
# (`codesign --force -s -`) only so macOS sees a coherent signature instead of a broken one;
# that is not distribution security and is not claimed to be.
#
# Usage:
#   install-local.sh                 update, then install the LaunchAgent   (npm run install:local)
#   install-local.sh update          pull, build, install                   (what launchd runs)
#   install-local.sh install-launchd render and load the LaunchAgent
#   install-local.sh uninstall-launchd  unload and remove it, leaving the app
#
# Flags: --force rebuilds even when HEAD has not moved since the last successful install.
#
# Log: ~/Library/Logs/chattered-install.log (this script), ~/Library/Logs/chattered-updater.log
# (launchd's capture of it).

set -u

LABEL=com.chattered.updater
APP_NAME=ChatterED.app
# The explicit PATH: a GUI LaunchAgent inherits launchd's PATH, not the login shell's, so
# node/npm (Homebrew) and claude (~/.local/bin) are otherwise simply missing.
EXPLICIT_PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH="$EXPLICIT_PATH"

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)          # …/ChatterED/app
REPO_DIR=$(cd "$APP_DIR/.." && pwd)                # …/ChatterED
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/$APP_NAME"
STATE_DIR="$HOME/Library/Caches/chattered-install"
LOG="$HOME/Library/Logs/chattered-install.log"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$APP_DIR/tools/$LABEL.plist"

mkdir -p "$(dirname "$LOG")" "$STATE_DIR" "$DEST_DIR"

# Set by update(); read by the EXIT trap, which outlives the function that fills them in.
LOCK=""
STAGE=""
cleanup() {
  [ -n "$LOCK" ] && rm -rf "$LOCK"
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  return 0
}
trap cleanup EXIT

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "FAILED: $*"; log "The installed app at $DEST was not touched."; exit 1; }

FORCE=0
CMD=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    update|install-launchd|uninstall-launchd|install) CMD="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ -n "$CMD" ] || CMD=install

# ── the LaunchAgent ──────────────────────────────────────────────────────────

install_launchd() {
  [ -f "$TEMPLATE" ] || die "No plist template at $TEMPLATE."
  mkdir -p "$(dirname "$PLIST")"
  local rendered="$STATE_DIR/rendered.plist"
  sed -e "s|{{LABEL}}|$LABEL|g" \
      -e "s|{{SCRIPT}}|$APP_DIR/tools/install-local.sh|g" \
      -e "s|{{PATH}}|$EXPLICIT_PATH|g" \
      -e "s|{{HOME}}|$HOME|g" \
      -e "s|{{WORKDIR}}|$REPO_DIR|g" \
      -e "s|{{LOG_OUT}}|$HOME/Library/Logs/chattered-updater.log|g" \
      -e "s|{{LOG_ERR}}|$HOME/Library/Logs/chattered-updater.log|g" \
      "$TEMPLATE" > "$rendered" || die "Could not render the plist."

  if grep -q '{{[A-Z_][A-Z_]*}}' "$rendered"; then
    die "The plist template has a placeholder this script does not know: $(grep -o '{{[A-Z_]*}}' "$rendered" | sort -u | tr '\n' ' ')"
  fi
  /usr/bin/plutil -lint -s "$rendered" >/dev/null 2>&1 || die "The rendered plist is not valid (plutil -lint)."

  cp "$rendered" "$PLIST" || die "Could not write $PLIST."
  local uid; uid=$(id -u)
  # bootout first so a changed plist actually takes effect; it fails harmlessly when not loaded.
  /bin/launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1
  /bin/launchctl bootstrap "gui/$uid" "$PLIST" >>"$LOG" 2>&1 || die "launchctl could not load $LABEL."
  log "LaunchAgent $LABEL loaded — runs at login and every 6 hours."
  log "  plist: $PLIST"
  log "  log:   $HOME/Library/Logs/chattered-updater.log"
}

uninstall_launchd() {
  local uid; uid=$(id -u)
  /bin/launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1
  if [ -f "$PLIST" ]; then
    rm -f "$PLIST" || die "Could not remove $PLIST."
    log "Removed $PLIST and unloaded $LABEL."
  else
    log "No LaunchAgent at $PLIST — nothing to remove."
  fi
  log "The app at $DEST was left in place. Drag it to the Trash to remove it."
}

# ── the build ────────────────────────────────────────────────────────────────

update() {
  # One build at a time: the login run and a six-hourly run can otherwise collide, and two
  # `npm run build` processes writing dist/ interleave into an app that is neither version.
  # A lock left behind by a killed run must not block the updater for ever, so one older than
  # an hour is treated as stale — no build here has ever come close to that.
  if [ -d "$STATE_DIR/lock" ] && [ -z "$(find "$STATE_DIR/lock" -maxdepth 0 -mmin -60)" ]; then
    log "Clearing a stale lock older than an hour ($STATE_DIR/lock)."
    rm -rf "$STATE_DIR/lock"
  fi
  if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then
    log "Another install is already running ($STATE_DIR/lock) — skipping this one."
    exit 0
  fi
  LOCK="$STATE_DIR/lock"

  cd "$REPO_DIR" || die "No repo at $REPO_DIR."

  # A dirty tree means someone is working in here. Pulling over that is the one thing this
  # script must never do unattended, so it builds what is there and says so.
  if [ -n "$(git status --porcelain)" ]; then
    log "WARNING: the working tree at $REPO_DIR has uncommitted changes — skipping the pull."
    log "         Building the tree exactly as it stands."
  else
    log "Pulling origin/main…"
    git pull --ff-only origin main >>"$LOG" 2>&1 || die "git pull --ff-only failed (diverged from origin/main?)."
  fi

  local commit count version
  commit=$(git rev-parse --short HEAD) || die "Could not read HEAD."
  count=$(git rev-list --count HEAD) || die "Could not count commits."
  cd "$APP_DIR" || die "No app directory at $APP_DIR."
  version=$(node -p "require('./package.json').version") || die "Could not read the version from package.json."

  local stamp="$STATE_DIR/installed-commit"
  if [ "$FORCE" -eq 0 ] && [ -d "$DEST" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$commit" ]; then
    log "Already at $commit and $DEST exists — nothing to do. (--force to rebuild anyway.)"
    return 0
  fi

  command -v node >/dev/null || die "node is not on the PATH ($PATH)."
  command -v npm  >/dev/null || die "npm is not on the PATH ($PATH)."

  # `npm ci` is slow and wipes node_modules, so it runs only when the lockfile actually moved.
  local lock_hash lock_stamp="$STATE_DIR/package-lock.sha256"
  lock_hash=$(/usr/bin/shasum -a 256 package-lock.json | cut -d' ' -f1)
  if [ ! -d node_modules ] || [ ! -f "$lock_stamp" ] || [ "$(cat "$lock_stamp")" != "$lock_hash" ]; then
    log "package-lock.json changed (or node_modules is missing) — running npm ci…"
    npm ci >>"$LOG" 2>&1 || die "npm ci failed."
    printf '%s' "$lock_hash" > "$lock_stamp"
  else
    log "package-lock.json unchanged — skipping npm ci."
  fi

  log "Building $version ($commit, build $count)…"
  npm run build >>"$LOG" 2>&1 || die "npm run build failed."

  # Into a scratch directory: electron-builder's own output dir (out/) is also where the DMG
  # lands, and a half-written bundle there must never be mistaken for a good one.
  STAGE=$(mktemp -d "${TMPDIR:-/tmp}/chattered-build.XXXXXX") || die "Could not make a staging directory."

  log "Packaging (unsigned, --mac dir)…"
  npx --no-install electron-builder --mac dir \
      -c.directories.output="$STAGE" \
      -c.mac.identity=null >>"$LOG" 2>&1 || die "electron-builder failed."

  local built; built=$(find "$STAGE" -maxdepth 2 -name "$APP_NAME" -type d | head -1)
  [ -n "$built" ] || die "electron-builder produced no $APP_NAME under $STAGE."
  [ -x "$built/Contents/MacOS/ChatterED" ] || die "The built bundle has no executable at Contents/MacOS/ChatterED."

  # Version and provenance, before signing — editing Info.plist afterwards would break the
  # signature we are about to make. CFBundleVersion is the commit count so it increases
  # monotonically, which is what macOS expects of it.
  local plist="$built/Contents/Info.plist"
  /usr/bin/plutil -replace CFBundleVersion -string "$count" "$plist" || die "Could not set CFBundleVersion."
  /usr/bin/plutil -replace CFBundleShortVersionString -string "$version" "$plist" || die "Could not set CFBundleShortVersionString."
  /usr/bin/plutil -replace ChatterEDGitCommit -string "$commit" "$plist" || die "Could not set ChatterEDGitCommit."
  /usr/bin/plutil -replace ChatterEDBuiltAt -string "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$plist" || die "Could not set ChatterEDBuiltAt."

  # Ad-hoc only (#17). Enough that macOS does not see a *broken* signature after the plist
  # edits above; not a Developer ID, not notarised, and not offered as either.
  codesign --force --deep -s - "$built" >>"$LOG" 2>&1 || die "Ad-hoc codesign failed."
  codesign --verify --deep "$built" >>"$LOG" 2>&1 || die "The ad-hoc signature did not verify."

  # Only now is the installed app replaced.
  rm -rf "$DEST" || die "Could not remove the old $DEST."
  cp -R "$built" "$DEST_DIR/" || die "Could not copy the new bundle into $DEST_DIR."
  printf '%s' "$commit" > "$stamp"

  log "Installed: $DEST"
  log "  version:   $version (CFBundleShortVersionString)"
  log "  build:     $count (CFBundleVersion)"
  log "  commit:    $commit"
  log "  signature: ad-hoc, unsigned for distribution (#17)"
}

case "$CMD" in
  update)            update ;;
  install-launchd)   install_launchd ;;
  uninstall-launchd) uninstall_launchd ;;
  install)           update && install_launchd ;;
esac
