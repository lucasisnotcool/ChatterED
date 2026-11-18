/**
 * **The updater's decisions, with no I/O**: where this copy runs from, whether it may update
 * itself, what a launch during probation means, and the shell script that swaps the bundle.
 *
 * Kept apart from `updater.ts` so each rule has a test that needs no disk, no network and no
 * Electron. Nothing here imports anything of the app's own (`bootstrap.ts` explains why).
 */
import { isAbsolute } from 'node:path';

/** Where a packaged copy is running from. Only `ok` may replace itself. */
export type LocationKind = 'ok' | 'dmg' | 'translocated' | 'unwritable' | 'not_bundle';

export function classifyLocation(bundlePath: string, writable: (path: string) => boolean): LocationKind {
  if (!isAbsolute(bundlePath) || !bundlePath.endsWith('.app')) return 'not_bundle';
  if (bundlePath.startsWith('/Volumes/')) return 'dmg';
  if (bundlePath.includes('/AppTranslocation/')) return 'translocated';
  const parent = bundlePath.slice(0, bundlePath.lastIndexOf('/')) || '/';
  // The swap renames the bundle inside its parent, so both have to be writable by this user.
  if (!writable(parent) || !writable(bundlePath)) return 'unwritable';
  return 'ok';
}

/** The `.app` bundle an executable at `…/X.app/Contents/MacOS/X` belongs to, or null. */
export function bundleOfExecutable(exePath: string): string | null {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  return m ? (m[1] ?? null) : null;
}

/** A CFBundleVersion as a build number: the commit count, or 0 for anything that is not one. */
export function buildNumber(raw: string | null | undefined): number {
  const s = (raw ?? '').trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : 0;
}

export interface ModeInput {
  packaged: boolean;
  platform: string;
  /** `ChatterEDUpdateChannel` from Info.plist: set only by `tools/release.sh`. */
  channel: string | null;
  hasPublicKey: boolean;
  /** `CHATTERED_UPDATES` in the environment. */
  envSwitch: string | undefined;
  /** `disabled` in `updates/config.json` (the owner's per-Mac switch). */
  disabledByFile: boolean;
}

export type Mode = { enabled: true } | { enabled: false; reason: string };

/**
 * Whether this copy looks for updates at all. A dev run, a copy `install-local.sh` made (no
 * channel), a build without a baked key, and either kill switch all say no, each with a reason
 * for the log.
 */
export function updaterMode(i: ModeInput): Mode {
  if (i.platform !== 'darwin') return { enabled: false, reason: 'platform' };
  if (!i.packaged) return { enabled: false, reason: 'dev' };
  const env = (i.envSwitch ?? '').trim().toLowerCase();
  if (env === 'off' || env === '0' || env === 'false') return { enabled: false, reason: 'env_off' };
  if (i.disabledByFile) return { enabled: false, reason: 'config_off' };
  if (!i.channel) return { enabled: false, reason: 'no_channel' };
  if (!i.hasPublicKey) return { enabled: false, reason: 'no_key' };
  return { enabled: true };
}

// ── probation: a new build has to prove it starts ───────────────────────────

/** Launches of a new build that may end in neither "healthy" nor a clean quit before rollback. */
export const MAX_CRASHED_LAUNCHES = 2;

/** One launch, as `bootstrap.ts` records it at start and `markHealthy` / `markCleanExit` finish it. */
export interface LaunchRecord {
  build: number;
  healthy: boolean;
  clean: boolean;
}

/** A build's standing on this Mac. `everHealthy` ends its probation for good. */
export interface BuildHealth {
  build: number;
  everHealthy: boolean;
  crashes: number;
}

export type ProbationStep =
  | { action: 'none'; health: BuildHealth }
  | { action: 'rollback'; health: BuildHealth; bad: number };

/**
 * At each launch, from the last launch's record. A launch of the same build that reached neither
 * the healthy mark (DB open, renderer up, still alive a little later) nor a clean quit was a crash
 * or a hang. After `MAX_CRASHED_LAUNCHES` of those, a build that was never healthy here is rolled
 * back to the kept previous bundle, if there is one. A build that was healthy once is out of
 * probation: a later fault is the manifest's `blocked` lever.
 */
export function probationStep(last: LaunchRecord | null, health: BuildHealth | null, currentBuild: number, previousBuild: number | null): ProbationStep {
  const h: BuildHealth = health && health.build === currentBuild ? { ...health } : { build: currentBuild, everHealthy: false, crashes: 0 };
  if (last && last.build === currentBuild && !last.healthy && !last.clean) h.crashes += 1;
  if (!h.everHealthy && h.crashes >= MAX_CRASHED_LAUNCHES && previousBuild !== null && previousBuild > 0 && previousBuild !== currentBuild) {
    return { action: 'rollback', health: h, bad: currentBuild };
  }
  return { action: 'none', health: h };
}

/**
 * The real bundle a hidden half-swap bundle stands in for: `/A/.ChatterED-replaced.app` and
 * `/A/.ChatterED-incoming.app` → `/A/<productName>.app`; null for any other path (review D-5).
 */
export function realTargetOf(bundlePath: string, productName: string): string | null {
  const slash = bundlePath.lastIndexOf('/');
  const base = bundlePath.slice(slash + 1);
  if (base !== '.ChatterED-replaced.app' && base !== '.ChatterED-incoming.app') return null;
  return `${bundlePath.slice(0, slash)}/${productName}.app`;
}

// ── the one-off install ─────────────────────────────────────────────────────

/** Mount points of attached disk images, from `hdiutil info` (tab, then the `/Volumes/…` path). */
export function dmgVolumes(hdiutilInfo: string): string[] {
  const out = new Set<string>();
  for (const line of hdiutilInfo.split('\n')) {
    const m = /\t(\/Volumes\/[^\t]+)$/.exec(line);
    if (m?.[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * Where the one-off install copies from, and which disk image to eject afterwards. From a mounted
 * DMG: the running bundle, and its volume. Translocated (opened from the DMG after Open Anyway):
 * the same build on a mounted ChatterED DMG if there is one (the real path, not the read-only
 * translocation mount), and that volume; else the running bundle and nothing to eject.
 */
export function installSource(o: {
  running: string;
  location: LocationKind;
  productName: string;
  volumes: readonly string[];
  /** The bundle is this app and this build (bundle id and CFBundleVersion). */
  matches(app: string): boolean;
}): { source: string; eject: string | null } {
  if (o.location === 'dmg') {
    const m = /^(\/Volumes\/[^/]+)\//.exec(o.running);
    return { source: o.running, eject: m?.[1] ?? null };
  }
  if (o.location === 'translocated') {
    for (const v of o.volumes) {
      const app = `${v}/${o.productName}.app`;
      if (o.matches(app)) return { source: app, eject: v };
    }
  }
  return { source: o.running, eject: null };
}

/** `…/<name>.app/Contents/MacOS/<name>` (its main process), not one of its helpers or anything else. */
export function isAppMain(command: string, productName: string): boolean {
  const exe = `/${productName}.app/Contents/MacOS/${productName}`;
  const line = command.trim();
  const at = line.indexOf(exe);
  if (at < 0) return false;
  const after = line.slice(at + exe.length);
  return after === '' || after.startsWith(' -');
}

// ── the swap helper ─────────────────────────────────────────────────────────

export interface SwapParams {
  /** The app's main process: the helper waits for it to exit. */
  pid: number;
  /** The installed bundle, e.g. /Applications/ChatterED.app. */
  target: string;
  /** The bundle to put there: a staged update, or the kept previous one (rollback). */
  incoming: string;
  /** Where the replaced bundle is kept for a rollback (N-1). */
  keep: string;
  /** Keep the replaced bundle (it was healthy here), or delete it (it never was, or this is a rollback). */
  keepOld: boolean;
  /** The CFBundleVersion `incoming` must have, checked before and after the swap. */
  toBuild: number;
  fromBuild: number;
  /** `apply` refuses unless `incoming` is newer than what is installed, unless `allowDowngrade`. */
  mode: 'apply' | 'rollback';
  /** A signed `pin` or `blocked`: `apply` may install an older build. */
  allowDowngrade: boolean;
  /** After the swap: nothing, open in front (a launch), or open in the background (idle). */
  relaunch: 'no' | 'front' | 'background';
  /** The main executable's CDHash the signed manifest names, or null (a rollback to the kept copy). */
  cdhash: string | null;
  /** The updates folder: result.json, the journal and the lock live here. */
  updatesDir: string;
  /** `chattered-swap` (renamex_np RENAME_SWAP), copied into the updates folder; null: two renames. */
  swapTool: string | null;
  waitSeconds?: number;
}

/** The paths a swap uses besides its inputs, all derived from the target and the updates folder. */
export function swapPaths(p: Pick<SwapParams, 'target' | 'updatesDir'>): { near: string; aside: string; journal: string; result: string; lock: string } {
  const dir = p.target.slice(0, p.target.lastIndexOf('/'));
  return {
    near: `${dir}/.ChatterED-incoming.app`,
    aside: `${dir}/.ChatterED-replaced.app`,
    journal: `${p.updatesDir}/swap-journal`,
    result: `${p.updatesDir}/result.json`,
    lock: `${p.updatesDir}/swap.lock`,
  };
}

function safeBundlePath(p: string): boolean {
  return isAbsolute(p) && p.endsWith('.app') && p.split('/').filter(Boolean).length >= 2 && !/[\n\r\0]/.test(p);
}

/**
 * The helper's arguments, in order. Every value is one argv word: nothing is ever put into a
 * shell string, so a path with a space ("Application Support"), a quote or `$(…)` is just a path.
 */
export function swapArgs(p: SwapParams): string[] {
  for (const path of [p.target, p.incoming, p.keep]) {
    if (!safeBundlePath(path)) throw new Error(`unsafe bundle path: ${path}`);
  }
  for (const path of [p.updatesDir, ...(p.swapTool ? [p.swapTool] : [])]) {
    if (!isAbsolute(path) || /[\n\r\0]/.test(path)) throw new Error(`unsafe path: ${path}`);
  }
  // A copy running from the kept or staged bundle must never swap itself: the keep step would
  // delete what it just swapped in (review R7). The bootstrap hands such a copy over instead.
  if (p.target === p.keep || p.target === p.incoming || p.target.startsWith(`${p.updatesDir}/`)) throw new Error('target is inside the updates folder');
  // The target is the app's own name, never a hidden half-swap bundle (review D-5).
  if (p.target.slice(p.target.lastIndexOf('/') + 1).startsWith('.')) throw new Error('target is a hidden bundle');
  if (!Number.isInteger(p.pid) || p.pid <= 1) throw new Error('bad pid');
  if (!Number.isInteger(p.toBuild) || !Number.isInteger(p.fromBuild) || p.toBuild < 1) throw new Error('bad build');
  if (p.cdhash !== null && !/^[0-9a-f]{40,64}$/.test(p.cdhash)) throw new Error('bad cdhash');
  const x = swapPaths(p);
  return [
    String(p.pid),
    p.target,
    p.incoming,
    p.keep,
    p.keepOld ? '1' : '0',
    String(p.toBuild),
    String(p.fromBuild),
    p.mode,
    p.allowDowngrade ? '1' : '0',
    p.relaunch,
    p.cdhash ?? '-',
    x.result,
    x.lock,
    String(Math.max(1, Math.round(p.waitSeconds ?? 300))),
    x.near,
    x.aside,
    x.journal,
    p.swapTool ?? '-',
  ];
}

/**
 * **The script that swaps the bundle once the app has exited.** A constant: `engine.ts` writes it
 * to the updates folder and runs `/bin/bash <file> <swapArgs…>`, never `sh -c`. The heavy work
 * (download, verify, smoke launch) was done at stage time; this is checks and one swap.
 *
 *  1. ignore TERM/HUP/INT (a logout must not stop it half way); one helper at a time (lock dir);
 *  2. wait for the app's PID to exit (give up, untouched, after the wait);
 *  3. check `incoming`: its CFBundleVersion, `codesign --verify --deep --strict`, the CDHash the
 *     manifest signed, and (apply) that it is newer than the build installed right now;
 *  4. if it is on another volume, copy it beside the target first (target untouched) and recheck;
 *  5. **swap**: `chattered-swap` exchanges the two directories atomically (renamex_np), so there is
 *     never a moment without a ChatterED.app. Without the tool (or on a volume that cannot), two
 *     renames back to back, journaled. EPERM/EACCES is reported as `app_management`;
 *  6. check the target; on failure swap back;
 *  7. strip quarantine, keep the old bundle as N-1 (or delete it), clear the journal, release the
 *     lock, and reopen the app on the launch and idle paths.
 *
 * **Once the app has exited, the helper reopens it whatever happens** (unless `relaunch` is `no`):
 * a failure on the launch path must never leave the participant with an app that vanished. Every
 * tool call has a time limit, and a lock is honoured only if its holder really is a helper and is
 * younger than ten minutes.
 *
 * An interrupted run leaves the journal, and the next launch finishes or reverts it
 * (`recoverJournal`). The tools can be pointed elsewhere by `CHATTERED_HELPER_*`, which only a
 * test build passes (`engine.ts`).
 */
export const SWAP_SCRIPT = `#!/bin/bash
# ChatterED update helper (src/main/update/plan.ts, SWAP_SCRIPT). Safe to delete.
set -u
trap '' TERM HUP INT
PID="$1"; TARGET="$2"; INCOMING="$3"; KEEP="$4"; KEEP_OLD="$5"; TO="$6"; FROM="$7"; MODE="$8"
ALLOW_DOWN="$9"; RELAUNCH="\${10}"; CDHASH="\${11}"; RESULT="\${12}"; LOCK="\${13}"; WAIT_SECS="\${14}"
NEAR="\${15}"; ASIDE="\${16}"; JOURNAL="\${17}"; SWAP="\${18}"
WAITED=0
CODESIGN="\${CHATTERED_HELPER_CODESIGN:-/usr/bin/codesign}"
PLUTIL="\${CHATTERED_HELPER_PLUTIL:-/usr/bin/plutil}"
XATTR="\${CHATTERED_HELPER_XATTR:-/usr/bin/xattr}"
OPEN="\${CHATTERED_HELPER_OPEN:-/usr/bin/open}"
LSREGISTER="\${CHATTERED_HELPER_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"

result() {
  printf '{"mode":"%s","status":"%s","cause":"%s","from":%s,"to":%s,"via":"%s","at":"%s"}\\n' \\
    "$MODE" "$1" "$2" "$FROM" "$TO" "\${VIA:-none}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RESULT.tmp" && mv -f -- "$RESULT.tmp" "$RESULT"
}
# A time limit for every external tool: perl's alarm survives the exec, so a wedged codesign,
# LaunchServices or open is killed instead of holding the lock (and the app) forever.
tmo() { local s="$1"; shift; if [ -x /usr/bin/perl ]; then /usr/bin/perl -e 'alarm shift @ARGV; exec @ARGV' "$s" "$@"; else "$@"; fi; }
reopen() {
  [ -e "$TARGET" ] || return 0
  case "$RELAUNCH" in
    front) tmo 30 "$OPEN" -- "$TARGET" >/dev/null 2>&1 ;;
    background) tmo 30 "$OPEN" -g -- "$TARGET" >/dev/null 2>&1 ;;
  esac
  return 0
}
# The lock goes first, so the reopened app never sees a helper still holding it.
finish() { rm -rf -- "$LOCK"; if [ "$WAITED" = 1 ]; then reopen; fi; exit "$1"; }
build_of() { tmo 20 "$PLUTIL" -extract CFBundleVersion raw -o - -- "$1/Contents/Info.plist" 2>/dev/null; }
cdhash_of() { tmo 120 "$CODESIGN" -dv --verbose=4 -- "$1" 2>&1 | sed -n 's/^CDHash=//p' | head -n 1; }
sound() {
  [ "$(build_of "$1")" = "$TO" ] || return 1
  tmo 300 "$CODESIGN" --verify --deep --strict -- "$1" >/dev/null 2>&1 || return 1
  if [ "$CDHASH" != "-" ] && [ "$(cdhash_of "$1")" != "$CDHASH" ]; then return 1; fi
  return 0
}
denied() { case "$1" in *"not permitted"*|*"ermission denied"*) return 0 ;; esac; return 1; }
device() { stat -f %d -- "$1" 2>/dev/null; }
# A lock is another helper's only if that PID is alive, runs swap-helper.sh, and is recent.
helper_alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -q 'swap-helper[.]sh' || return 1
  [ -z "$(find "$LOCK/pid" -mmin +10 2>/dev/null)" ] || return 1
  return 0
}

if ! mkdir -- "$LOCK" 2>/dev/null; then
  # Another helper really is on it: it reopens the app when it is done.
  if helper_alive "$(cat -- "$LOCK/pid" 2>/dev/null)"; then exit 0; fi
  rm -rf -- "$LOCK"
  if ! mkdir -- "$LOCK" 2>/dev/null; then
    while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
    WAITED=1; reopen; exit 1
  fi
fi
echo "$$" > "$LOCK/pid"
if [ "$TARGET" = "$KEEP" ] || [ "$TARGET" = "$INCOMING" ]; then result failed target_is_keep; finish 1; fi
case "$TARGET" in "$(dirname -- "$RESULT")"/*) result failed target_is_keep; finish 1 ;; esac
case "$(basename -- "$TARGET")" in .*) result failed target_hidden; finish 1 ;; esac

ticks=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.2
  ticks=$((ticks + 1))
  if [ "$ticks" -ge $((WAIT_SECS * 5)) ]; then result failed app_still_running; finish 1; fi
done
WAITED=1

[ -d "$INCOMING" ] || { result failed incoming_missing; finish 1; }
sound "$INCOMING" || { result failed incoming_unsound; finish 1; }
if [ "$MODE" = apply ] && [ "$ALLOW_DOWN" != 1 ] && [ -e "$TARGET" ]; then
  installed="$(build_of "$TARGET")"
  case "$installed" in ''|*[!0-9]*) installed=0 ;; esac
  if [ "$installed" -ge "$TO" ]; then result failed not_newer; finish 1; fi
fi

# Same volume as the target: swap straight from where it is. Otherwise copy it beside the target.
SRC="$INCOMING"
if [ "$(device "$(dirname -- "$INCOMING")")" != "$(device "$(dirname -- "$TARGET")")" ]; then
  rm -rf -- "$NEAR"
  if ! out="$(tmo 900 /usr/bin/ditto -- "$INCOMING" "$NEAR" 2>&1)"; then
    rm -rf -- "$NEAR"
    if denied "$out"; then result failed app_management; else result failed stage_near; fi
    finish 1
  fi
  sound "$NEAR" || { rm -rf -- "$NEAR"; result failed near_unsound; finish 1; }
  SRC="$NEAR"
fi

OLD=""
if [ -e "$TARGET" ] && [ "$SWAP" != "-" ] && [ -x "$SWAP" ]; then
  echo "swap $SRC" > "$JOURNAL"
  out="$(tmo 60 "$SWAP" "$SRC" "$TARGET" 2>&1)"; rc=$?
  if [ "$rc" = 0 ]; then
    VIA=swap; OLD="$SRC"
  elif [ "$rc" = 3 ]; then
    rm -f -- "$JOURNAL"; result failed app_management; finish 1
  fi
fi
if [ -z "$OLD" ]; then
  VIA=rename
  rm -rf -- "$ASIDE"
  echo "aside $SRC" > "$JOURNAL"
  if [ -e "$TARGET" ]; then
    if ! out="$(mv -- "$TARGET" "$ASIDE" 2>&1)"; then
      rm -f -- "$JOURNAL"
      if denied "$out"; then result failed app_management; else result failed move_old; fi
      finish 1
    fi
  fi
  if ! out="$(mv -- "$SRC" "$TARGET" 2>&1)"; then
    [ -e "$ASIDE" ] && mv -- "$ASIDE" "$TARGET"
    rm -f -- "$JOURNAL"
    if denied "$out"; then result rolled_back app_management; else result rolled_back move_new; fi
    finish 1
  fi
  [ -e "$ASIDE" ] && OLD="$ASIDE"
  echo "swapped $OLD" > "$JOURNAL"
fi

if ! sound "$TARGET"; then
  if [ "$VIA" = swap ]; then
    tmo 60 "$SWAP" "$OLD" "$TARGET" >/dev/null 2>&1
  else
    rm -rf -- "$TARGET"
    [ -n "$OLD" ] && mv -- "$OLD" "$TARGET"
  fi
  rm -f -- "$JOURNAL"; result rolled_back verify_after; finish 1
fi

tmo 60 "$XATTR" -dr com.apple.quarantine "$TARGET" 2>/dev/null
tmo 30 "$LSREGISTER" -f "$TARGET" >/dev/null 2>&1
if [ -n "$OLD" ] && [ -e "$OLD" ]; then
  if [ "$KEEP_OLD" = 1 ]; then
    rm -rf -- "$KEEP"
    mkdir -p -- "$(dirname -- "$KEEP")"
    mv -- "$OLD" "$KEEP" 2>/dev/null || rm -rf -- "$OLD"
  else
    rm -rf -- "$OLD"
  fi
fi
rm -rf -- "$NEAR"
rm -f -- "$JOURNAL"
result ok ""
finish 0
`;

/**
 * **A swap the helper did not finish** (killed, power cut), seen at the next launch with no
 * helper alive. The journal's first word is the step, the rest the path the old bundle is at or
 * was coming from. The target's build says which side of the swap it stopped on: if it is the new
 * build, finish (keep or delete the old one); if the target is missing, put back whatever bundle
 * can be found; otherwise nothing happened. Returns what was done, for the log.
 */
export function recoverJournal(
  journal: string,
  fs: { exists(p: string): boolean; rename(from: string, to: string): void; remove(p: string): void; buildOf(p: string): number },
  p: { target: string; keep: string; keepOld: boolean; aside: string; near: string; toBuild: number },
): 'none' | 'completed' | 'reverted' | 'untouched' | 'stuck' {
  const line = journal.trim();
  const space = line.indexOf(' ');
  const step = space < 0 ? line : line.slice(0, space);
  const path = space < 0 ? '' : line.slice(space + 1);
  if (step !== 'swap' && step !== 'aside' && step !== 'swapped') return 'none';
  if (!fs.exists(p.target)) {
    for (const candidate of [p.aside, path, p.near]) {
      if (candidate && fs.exists(candidate)) {
        fs.rename(candidate, p.target);
        return 'reverted';
      }
    }
    return 'stuck';
  }
  if (fs.buildOf(p.target) !== p.toBuild) {
    if (fs.exists(p.near)) fs.remove(p.near);
    return 'untouched';
  }
  // The new build is in. The old one is at the journal's path (a swap) or aside (renames).
  const old = step === 'aside' ? p.aside : path;
  if (old && old !== p.target && fs.exists(old) && fs.buildOf(old) !== p.toBuild) {
    if (p.keepOld) {
      fs.remove(p.keep);
      fs.rename(old, p.keep);
    } else {
      fs.remove(old);
    }
  }
  if (fs.exists(p.near)) fs.remove(p.near);
  return 'completed';
}

/** What a helper left for the next launch to log. */
export interface SwapResult {
  mode: 'apply' | 'rollback';
  status: 'ok' | 'failed' | 'rolled_back';
  cause: string;
  /** `swap` (atomic), `rename` (two renames) or `none`. */
  via: string;
  from: number;
  to: number;
  at: string;
}

export function parseSwapResult(text: string): SwapResult | null {
  try {
    const r = JSON.parse(text) as Partial<SwapResult>;
    if ((r.mode !== 'apply' && r.mode !== 'rollback') || !['ok', 'failed', 'rolled_back'].includes(String(r.status))) return null;
    return {
      mode: r.mode,
      status: r.status as SwapResult['status'],
      cause: typeof r.cause === 'string' ? r.cause.slice(0, 60) : '',
      via: typeof r.via === 'string' ? r.via.slice(0, 10) : 'none',
      from: Number(r.from) || 0,
      to: Number(r.to) || 0,
      at: typeof r.at === 'string' ? r.at : '',
    };
  } catch {
    return null;
  }
}

// ── when to check, when to apply ────────────────────────────────────────────

export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
export const FIRST_CHECK_MS = 30 * 1000;
/** Idle long enough that a relaunch costs nobody anything: the swap happens and the app reopens. */
export const IDLE_RELAUNCH_SECONDS = 30 * 60;

/** `base` ± `spread`, from a uniform `r` in [0, 1). Spreads four Macs' checks apart. */
export function jitter(base: number, spread: number, r: number): number {
  return Math.max(0, Math.round(base + (r * 2 - 1) * spread));
}

// ── self-install from the DMG ───────────────────────────────────────────────

/**
 * Old copies to offer to the Trash, from `mdfind` hits: every other ChatterED bundle except the
 * one running, the one the move replaces anyway, ones on a disk image or translocated, ones
 * inside another bundle or the Trash, and the updater's own kept copies.
 */
export function oldCopies(hits: readonly string[], o: { running: string; destination: string; home: string; updatesDir: string }): string[] {
  const out = new Set<string>();
  for (const raw of hits) {
    const p = raw.trim();
    if (!safeBundlePath(p)) continue;
    if (p === o.running || p === o.destination) continue;
    if (p.startsWith('/Volumes/') || p.includes('/AppTranslocation/')) continue;
    if (p.startsWith(`${o.updatesDir}/`) || p.startsWith(`${o.home}/.Trash/`)) continue;
    if (p.slice(0, -4).includes('.app/')) continue;
    out.add(p);
  }
  return [...out].sort();
}
