# The study release: a DMG with a fixed API credit per participant

For the 1–2 week field phase of the group study (added 2026-10-15; the group decision is
Valerie's to confirm, see the issue). Participants install a DMG, and the app runs on a
study-paid Anthropic key until their credit is used up. After that they can switch to Claude Code
or their own API key in Settings, or stop.

**Two ways to hand out keys.** A **preloaded copy** (2026-10-25, the way the first four friends get
it) is one DMG per participant that unlocks their key on first launch: nothing to type. A **shared
DMG** carries every slot sealed and each participant types their own code. The shared DMG is safer,
because a forwarded DMG is useless without a code. A preloaded DMG *is* the key, so treat each file
like the key itself.

Code: `src/main/study/` (sealing, the service, the channels), `src/shared/study.ts` (the
contract), `src/renderer/components/study/` (code field, credit bar, used-up sheet),
`tools/study-keys.mjs` (makes the bundle), `tools/release.sh --study` (builds it in).

## 1. How the cap works, and why

- **Each participant has their own API key.** Where the key's Console workspace has a monthly
  **spend limit**, that is the real cap: nothing on their Mac can change it. **The Oct 2026 keys
  have no per-key limit**, so the app's own count (below) is the only cap. It stops ordinary use
  at the budget, but it is not secure: deleting the app's data resets it, and the key sits in the
  app's key file where anyone using that Mac can read it. Revoking the key in the Console is the
  backstop. Watch each key's usage in the Console during the study.
- The DMG carries a **bundle** with every key sealed separately (scrypt + AES-256-GCM). A
  participant's **code** (`S07-K3QX-9MZT-4HRA`, 60 random bits) opens their own key and no other.
  Anyone holding a code holds that key, so a leaked code costs at most one budget, and you revoke
  it alone by archiving that one workspace.
- The **credit bar** is the app's own estimate: Anthropic calls since the code was entered, priced
  by the rate card. At the budget, the app stops calling and shows the "credit used up" sheet. If
  Anthropic refuses a call over the workspace limit first, that is also treated as used up.
- **Reinstalling keeps the count** (the data in `~/Library/Application Support/ChatterED` stays).
  Deleting that folder resets the count to zero; with no Console limit, nothing else stops it.
- **After the credit**, Settings ▸ Where the study partners run offers every backend: Claude
  Code on this Mac, the participant's own Anthropic, OpenAI or Gemini key, or an OpenAI-compatible
  endpoint. None of them is counted or stopped. Entering their own Anthropic key ends the study
  count for good, and a preloaded copy never re-enters its code after that.

## 2. Console setup (you, once per participant)

If the keys already exist and cannot have a spend limit (the Oct 2026 case), skip to step 4.

1. Create a workspace per participant slot: `chattered-study-01`, `-02`, … (up to 100 per org).
2. In each workspace, under **Spend limits**, set a monthly limit equal to the budget ($50), plus
   an alert at 80%.
3. Create one API key in each workspace.
4. Put them in a CSV **outside every repo and every synced folder**: `~/.config/chattered-study/`
   (mode 700), not `~/data/…`, which the Mac copies to gram-server. The easy way: make the file
   with placeholder lines, open it in TextEdit, paste each key over its placeholder, save, then
   `chmod 600` it (TextEdit can loosen the mode on save):

   ```
   slot,key
   1,sk-ant-...
   2,sk-ant-...
   ```

**The limit is monthly.** A study that runs across 1 November gets a fresh limit on that day. On
1 November, lower each workspace's limit to what it has left, or archive the workspaces when the
study ends (§6).

## 3. Make the bundle and the codes

```sh
cd app
npm run study:keys -- --keys ~/.config/chattered-study/slots.csv --out ~/.config/chattered-study \
  --budget 50 --model claude-sonnet-5-5 --study "CS3249 field phase, Oct 2026"
```

This writes `keys.json`, the bundle (it ships in the DMG), and `codes.csv` (mode 0600, secret: one
line per participant). To recruit more participants later, add their slots with `--add`; existing
codes keep working. Then delete `slots.csv`: the keys are in the Console and in the bundle.

## 4. Build

A study build is on the **study update channel** (§8): it carries the compiled update keys and a
build number, and updates itself from then on. So the keys must exist first (§8.1, once), and the
build number is allocated for you (last published + 1). Give all the DMGs of one round the same
number with `--build`, so every participant starts on the same build:

```sh
cd app
tools/release.sh --study ~/.config/chattered-study/keys.json            # allocates N, prints it
```

**Preloaded copies, one per participant** (each build wipes `out/`, so move each DMG away):

```sh
cd app
N=<the build number the first run printed, or one above the published one>
for s in 1 2 3 4; do
  tools/release.sh --study ~/.config/chattered-study/keys.json --preload "$s" --build "$N" &&
    mv out/ChatterED-Study-*-S0"$s"-arm64.dmg ~/.config/chattered-study/
done
```

A study DMG does not need `--update`: `--study` already puts it on the study channel. `--update`
makes the *payload* that updates it, which is an ordinary build with no keys in it (§8.3).

`--preload` reads that slot's code from `codes.csv` beside the bundle (or `--codes <file>`), ships
it as `Resources/study/preload.txt`, and checks that the copy inside the DMG is that slot's code.

This gives `out/ChatterED-Study-<version>-arm64.dmg` (about 330 MB, Apple Silicon only). The
script checks that the bundle inside the DMG matches yours byte for byte, and removes its working
copy afterwards. An ordinary build refuses to start while `app/study/keys.json` exists, and a study
build refuses `--publish`.

**Do not post the study DMG on the public releases repo.** It is not secret on its own (every key
in it is sealed), but it gives anyone a bundle they can try codes against offline. Share it by an
NUS OneDrive or Google Drive link, and send each code privately, separately from the link.

## 5. Pilot before sending (one slot, your own Mac or a spare account)

The Anthropic API path had never run on Sonnet 5.5 before this build: the dogfood ran on the
Claude CLI. `room/llm/anthropic.ts` now gives Claude 5 models thinking headroom and runs schema
calls at low effort, but this was tested against a fake SDK only. Check it live:

1. Make a bundle with one real slot and build. Install it under a fresh macOS user account, or
   launch the built app with its own profile:
   `CFFIXED_USER_HOME=/tmp/s HOME=/tmp/s out/mac-arm64/ChatterED.app/Contents/MacOS/ChatterED --user-data-dir=/tmp/s/ud`.
2. Agree to the notice, enter the code, add a small deck, wait for the overview, ask Ellie two
   questions, press Quiz me and answer.
3. Check: replies are complete (not cut off), the bar moves, and Settings ▸ Usage shows
   `claude-sonnet-5-5` rows with non-zero cost.
4. **Test the cap.** Build the pilot bundle with `--budget 0.5`, keep using the app until it
   stops, and confirm the "credit used up" sheet appears. Then choose Claude Code in Settings and
   confirm the next turn runs. Where a key does have a Console spend limit, also set it to $0.50
   and check the refusal. Note the error wording in
   `~/Library/Logs/ChatterED/main.log`; if the sheet did not appear, add that wording to
   `looksLikeSpendLimit` in `src/shared/study.ts`. Then set the limit back.
5. Measure: $ per hour of use, from Settings ▸ Usage. At about $8–9 for a heavy day (the dogfood
   rate on Sonnet), $50 lasts about 6 heavy days.

**Pilot run, 2026-10-25** (packaged preloaded DMG, Sonnet 5.5 on the API, $0.50 budget). It found
that the API refuses three of the app's schemas as `output_config.format` (the tutorial reader's
is too large; the ledger's and the pack draft's use unsupported keywords), which the CLI dogfood
never met; fixed in `3d16a2b` and `97d36f9` by stating such a schema in the prompt. After the fix:

| What | Measured |
|---|---|
| Reading a tutorial sheet (8 parts) | 56 s, about $0.12 |
| The overview of a 58-page deck | about $0.09 |
| One question to Ellie (with its doc edit and ledger) | about $0.03–0.04, replies complete |
| The cap | stopped at $0.5064 of $0.50 (one call over); the used-up sheet appeared |
| After the cap | Settings ▸ Claude Code on this Mac: the next turn ran on `claude-cli` |

So $50 is roughly 1,000 questions, or a sheet plus its deck about 200 times over: heavy use for
two weeks stays well inside it.

## 6. Participant install guide (paste this into the message with the link)

For the new DMG (build with the updater, 2026-11-19). It replaces the copy they have, which has no
updater; after this one, updates arrive by themselves.

> 1. If ChatterED is open, quit it (**ChatterED ▸ Quit**, or ⌘Q). It needs an Apple Silicon Mac
>    (M1 or later) on macOS 13 or newer.
> 2. Download `ChatterED-Study-….dmg` and open it. **Drag ChatterED onto Applications** and choose
>    **Replace**. Your notes, progress and study credit are kept: they live outside the app.
> 3. Open ChatterED from **Applications**. macOS says it cannot verify the developer. Click
>    **Done** (not Move to Trash). Open **System Settings ▸ Privacy & Security**, scroll down, and
>    click **Open Anyway** next to "ChatterED was blocked". Confirm with your password. You do
>    this once.
> 4. (If you double-clicked ChatterED inside the disk image instead, it asks **"Install ChatterED
>    into Applications?"**. Click **Install**: it replaces the older copy, reopens from
>    Applications and ejects the disk image. If it says it could not install itself, do step 2.)
> 5. From now on ChatterED updates itself: it downloads a new build in the background and switches
>    to it the next time you open it, or while your Mac is locked or idle. A small note says
>    "Updated to build N". You do not need to do anything.
> 6. Read and agree to the trial notice. Your copy already has its credit: the amount left is
>    always at the top right. (A shared DMG asks for your study code here: `S..-....-....-....`.)
>    When it runs out, you can keep going with Claude Code or your own API key in Settings.
> 7. Drop in this week's tutorial sheet, and the lecture slides it goes with if you have them,
>    and press **Open the tutorial**. Max reads the sheet (about a minute per five pages; past
>    papers and long sheets work too, up to 60 pages), then every part has an answer slot: write your attempt there, and use Hint or Check beside it.
> 8. At the end of the study, choose **File ▸ Export Research Data…** and email us the zip.
> 9. **If something goes wrong**, press **⇧⌘D** (Shift-Command-D) in ChatterED, or choose
>    **Help ▸ Copy Debug Info for the Team**. A short report appears and is already copied: paste
>    it into your Telegram chat with us. It holds no API key, study code, names, file names or
>    anything you wrote, and you can read all of it before you send it.

**Reading a pasted report** (you): copy the participant's message, then `cd app && pbpaste | npm
run -s debug:read` (add `--published <build>` to compare with the newest build). It checks the
paste is whole (`sum:` line), summarises the install (its install id, build, where it runs from,
admin and write access, disk, study credit, database, updater state, the last errors) and lists
what to do, with the command to roll a build out to that install. Code: `src/main/debug/`.

## 7. End of the study

1. Collect the exports. Each manifest's `study` block gives the slot, budget, spend and whether
   the cap was hit; the participant ID is the random `P-…`, not the slot.
2. **Revoke every study key** in the Console (or archive the workspaces). Until then, every DMG
   you sent still works.
3. Delete `codes.csv` and the preloaded DMGs.

## 8. Updates (the study channel)

Code: `src/main/bootstrap.ts` and `src/main/update/` (each file's header says what it decides);
tools: `tools/release.sh`, `tools/update-tool.mjs`, `tools/update-gate.mjs`. Windows is not
supported: the updater is macOS only, and so is the app.

### 8.1 How it works

- **Stage 0.** `package.json` `main` is `dist/main/bootstrap.js`, which imports only Electron,
  Node and `src/main/update/` (a contract test holds it to that). It runs before any of the app's
  own code, so a later build that breaks the database, a migration, the renderer or a native
  module cannot stop the updater. Leave `bootstrap.ts` and `update/` alone during the study.
- **The channel.** A signed manifest at a fixed URL:
  `https://github.com/lucasisnotcool/ChatterED-releases/releases/download/study-channel/study-manifest-v1.json`
  (and `….json.sig`). The `study-channel` release is a pre-release whose two assets are replaced on
  each publish, so GitHub's "latest" pointer, which skips pre-releases, plays no part. Each build's
  zip and `build-N.json` live on their own release, `study-build-N`.
- **Integrity.** The `.sig` is an ECDSA P-256 signature over the manifest's exact bytes, checked
  before they are parsed, with one of the two public keys compiled into the app (`active`, and
  the offline `cold` backup). The manifest names the zip's size and sha256 and the main executable's
  CDHash; the app checks all three, and the bundle id, the build number and `codesign --verify
  --deep --strict`, before it runs anything. No setting or environment variable can change the
  keys, the URL or the checks in a release build. The payload is an ordinary build with no
  `Resources/study/`; the app never modifies or re-signs it (a study build copies its sealed
  `keys.json` into `<userData>/study/` on first launch and reads it from there).
- **Staging, while the app runs** (a utilityProcess, so a hung window does not stop it): check 30 s
  after launch, every ~4 h after (with jitter) and on wake; download into
  `<userData>/updates.noindex/` (Spotlight skips it) only with ~5x the zip free plus 2 GB; extract
  with `ditto` into a fresh 0700 folder; then a **smoke launch**: the staged build runs with its own
  profile on a `VACUUM INTO` copy of the database, the scripted backend and a hidden window, and
  must write an explicit ok file. Only then is it staged.
- **The swap**, never at logout or shutdown: at the next launch (the app exits, swaps, reopens:
  about 2 s), or when the Mac has been locked for 5 minutes or idle for 30 and nothing is in flight
  (no model call, no request such as a tutorial read). One atomic
  `renamex_np(RENAME_SWAP)` (`Resources/chattered-swap`), journaled, with the build and signature
  checked again right before and after; any failure swaps back. The build it replaces is kept as
  N-1 if it was ever healthy here. **Once the app has exited for a swap, the helper reopens it
  whatever happens.**
- **Nothing can keep the app closed.** Each swap (a build and apply or rollback) is tried at most
  twice, counted before the helper starts; after two launches in a row that exit for a swap or a
  running helper, the next one always opens the app; a swap lock counts only if its process really
  is the helper and is under 10 minutes old; a rollback that failed is not tried again. A build the
  swap could not install (App Management refused it, or two tries failed) is recorded on that Mac
  and not downloaded again until a newer build is published, and the participant sees **one**
  dialog: "ChatterED could not update itself", with the App Management setting (its button lets
  the build be tried again) and the manual route (the team sends the DMG). A property test fuzzes
  every update file (missing, corrupt, stale, contradictory, read-only) and checks the app opens
  within two launches.
- **Health and rollback.** A launch is healthy 30 s after the window's bridge is up; a build that
  was healthy once is remembered as known-good, so it is kept as N-1 even after a rollback cycle.
  A new build that twice ends in neither a healthy mark nor a clean quit is rolled back to N-1 at
  the **third** launch (so a participant whose new build crashes opens the app three times before
  it is back on N-1), and never reinstalled on that Mac.
- **Repair mode.** If the app cannot start (`failBoot`, or `index.js` will not load), a build that
  has already failed once is rolled back at once; otherwise a separate process
  (`--chattered-repair`, no window) checks for a fix at once and then every minute for up to 20
  minutes, stages it and swaps it in, closing the failed app itself (the app's own worker stands
  aside meanwhile, so only one of them downloads). The startup-failure message, a sheet on a small
  window so the app can still be quit, says this is happening and offers **Copy debug info**;
  neither the dialog nor Quit stops the search.
- **Never down, except by you.** A copy never installs an older build, unless a signed manifest
  says so (`pin`, `blocked`, or a per-install `targets` entry) and the old build knows the
  database's schema (`dbSchema`).
- **The newest manifest wins.** Every publish signs in a higher `seq` (at least the publish time in
  seconds, so a publish from a stale base still lands above everything before it; `release.sh`
  refuses one that would not); a copy refuses a manifest
  with a lower `seq` than it has seen (a replay), and before swapping in a staged build it checks
  that the newest manifest it verified still offers that build, so a rollback, pin, block or pause
  published after staging is obeyed.
- **Retries.** A failed check or download is retried after 15 minutes, then 30, 60 and so on, up to
  the normal ~4 h. A build whose payload fails verification or its smoke launch is recorded and not
  downloaded again (a newer build is).
- **What is logged** (every line also carries `build` and `sha`): `update.launch`, `update.check`
  (`result`: `current`, `available`, `unavailable` with a `cause`, `known_bad`, `paused`,
  `os_too_old`, `location_dmg`/`_translocated`/`_unwritable`, …), `update.downloaded`,
  `update.staged`, `update.applying`, `update.applied`, `update.failed` (`stage` + `cause`),
  `update.crash_loop`, `update.rollback`, `update.rolled_back`, `update.repair`,
  `update.journal_recovered`, `update.discarded`, `update.healthy`, `update.idle_apply`,
  `update.idle_deferred`, `update.gave_up`, `update.exit_streak`, `update.stale_lock`,
  `update.swept`, `update.handover`, `update.manual_notice`, `update.retry_allowed`,
  `update.note_shown`, `update.env` (MDM and Gatekeeper status), `selfinstall.*`, `install.oneoff`.
  A smoke launch that fails its own updater check reports `stage=smoke` with
  `cause=updater:<why>` (its keys do not verify the manifest, wrong channel, updates off, no swap
  tool).
  The research export's manifest has `app.build`, `app.sha` and `app.builds` (every build the
  install ran, with when it first launched), so a session's build is known after log rotation too.
- **Kill switches** (they stop updates; none relaxes a check): `CHATTERED_UPDATES=off` in the
  environment, or a file named `updates-disabled` in `~/Library/Application Support/ChatterED/`;
  from your side, a manifest with `"paused": true`.

### 8.2 The keys (you, once)

```sh
cd app
node tools/update-tool.mjs keygen                 # → ~/.config/chattered-release/ (0700; keys 0600)
mkdir -p build/update-keys
cp ~/.config/chattered-release/{active,cold}.pub.pem build/update-keys/
git add build/update-keys/active.pub.pem build/update-keys/cold.pub.pem   # public; commit them
```

Then copy **both** private keys to the Passport drive, and delete `cold.key.pem` from the Mac: it is
only for replacing a lost or leaked active key (a manifest the cold key signs may carry
`keys.add` / `keys.revoke`). Never put a private key on gram-server, in GitHub secrets or under
`~/data`. Losing both keys means one more manual DMG for everyone.

### 8.3 Publish an update

Migrations stay **expand-only** while the study runs (add tables and columns; never rebuild a
table, narrow a CHECK or write enum values old code switches on), so a rolled-back build still
reads the database. Ship only fixes mid-study, and note for each build whether it changes what a
participant sees.

```sh
cd app                                   # on main, clean, pulled
node tools/update-gate.mjs               # the release gate (~10 min): see below
tools/release.sh --update                # dry run: builds, zips, signs, verifies; uploads nothing
tools/release.sh --update --publish-update --notes-text "Fixes the hint button"
```

- **The gate** builds the test variant of this commit and, in a temp folder (`--work` to choose), installs it as a study
  copy, serves N+1 and a failing N+2 from a local server, and checks that N stages, swaps to N+1
  (keeping N-1, the study bundle and the note) and that N+2 is rolled back and marked bad. It
  writes `~/.config/chattered-release/gate/pass-<sha>`; `--publish-update` refuses without it, off
  `main`, or on a dirty tree. It proves this commit's code, not the production binary's bytes.
- **Publishing** allocates the build (published + 1, never reused: `~/.config/chattered-release/
  builds-study.txt`), refuses one not above the published build, checks the zip has no
  `Contents/Resources/study/`, no `$HOME` path and nothing shaped like a study code, extracts it with
  `ditto` and re-verifies it, uploads the zip and `build-N.json` to `study-build-N`, then the
  manifest and its `.sig` to `study-channel`, and finally downloads all of it back from GitHub and
  verifies it as a participant's Mac would.
- **One participant first** (a canary): `--update --target <install id>` (comma-separated ids; the
  install id is in their pasted debug report). Everyone else stays on the default. Then
  `tools/release.sh --promote N --publish-update` makes build N the default for all.
- **Take a build back**: `tools/release.sh --rollback-to N --publish-update` pins the channel to
  published build N (with `--target <id>` for one install). Or `--update --block 512` with a fix:
  copies on 512 leave it even if the fix is numbered lower. A rollback only reaches Macs whose
  database build N can read: if a migration shipped after N, `--rollback-to` warns and those Macs
  skip it (`schema_too_new`); publish a fix as a new build instead.
- **Pins do not expire.** A `--rollback-to N --target <id>` pin stays through every later publish
  (each publish lists the targets still in force) until `tools/release.sh --untarget <id>
  --publish-update`. A build cannot be blocked while an install is targeted at it; a target at a
  build blocked later is ignored by the app, which falls back to the channel default.
- **Edit the manifest without a build**: `--untarget <id>[,<id>]`, `--block N[,N]`,
  `--unblock N[,N]`, `--paused` / `--resume` (stop or restart installs everywhere), each with
  `--publish-update`. **Key rotation**: `--key-add <new active.pub.pem>` and/or `--key-revoke <key
  id>`, signed with the cold key (copy `cold.key.pem` from the offline drive, `--sign-key <it>`);
  then commit the new public key to `build/update-keys/active.pub.pem` and sign later releases with
  the new private key. Every publish starts from the published
  manifest; if it cannot be read the publish is refused, except the very first with `--no-base`.

### 8.4 Watch it (there is no heartbeat)

- **Downloads per build**: `gh api repos/lucasisnotcool/ChatterED-releases/releases --jq '.[] |
  select(.tag_name | startswith("study-build-")) | {tag: .tag_name, downloads: [.assets[] |
  {name, download_count}]}'`. A build's zip count rises as Macs stage it (smoke-test failures and
  retries count too, and anyone can download, so it is a rough sign, not a census).
- **Use per participant**: each slot's workspace in the Anthropic Console shows when it was last
  used, so a participant who stopped (or is stuck on a build that cannot start) shows as flat.
- **A pasted debug report** (⇧⌘D, §6) has an `update` section: build, channel, install id, where
  it runs from, staged build, N-1, bad builds, builds it could not install (`cannot_apply`), a
  rollback given up, the swap being tried and its last result, the exit streak, the swap lock and
  journal, the last check and result, the last failure, free space and the space it lacked
  (`space_short`: updates stop below about 5x the zip plus 2 GB; macOS's purgeable space is not
  counted), leftover work folders, quarantine and the kill switches.
- **Each update changes the app's CDHash**, so macOS may ask again for folder access it had
  granted (the cost export writes to `~/Documents/ChatterED`). Tell participants before a release
  that it may ask once.

### 8.5 What it cannot do

- Reach a Mac that never opens ChatterED, stays offline, or had the app or its data deleted.
- Undo what a bad build did before it was rolled back (spent credit, data a bug changed without
  failing). Database backups exist (`backups/`), but restoring one is by hand and loses later work.
- Get past macOS itself: App Management may refuse to let an ad-hoc app replace its own bundle on
  some Macs (logged as `update.failed` `app_management`; the participant then drags the new DMG
  in by hand), an MDM or antivirus policy, or a "Move to Trash" click on the first Gatekeeper prompt.
- Survive the loss of both signing keys.
- The one-off move to the new DMG: until a participant installs it, their copy has no updater.
  The install copies the app (from the real DMG path when macOS translocated it) to a hidden
  sibling in `/Applications`, swaps it with the old copy in one step and only then trashes the old
  one; Electron's own mover, which trashes first, is only the fallback. It writes to the real
  `/Applications`, so it is checked by hand (8.6) and by the E2E campaign, not by the gate.

### 8.6 Checking the one-off install by hand (before sending the DMG)

On a spare macOS account (it writes to `/Applications`): install the *old* study DMG the usual way
and run it once; then download the new DMG through a browser (so it is quarantined), open it,
double-click ChatterED, Open Anyway, **Install**. Check: `/Applications/ChatterED.app` has the new
`CFBundleVersion` (`plutil -extract CFBundleVersion raw /Applications/ChatterED.app/Contents/Info.plist`),
the disk image is gone from Finder, `xattr /Applications/ChatterED.app` shows no
`com.apple.quarantine`, the notes and credit are still there, and `main.log` has `install.oneoff`.
Repeat with the old copy left **running** (it must be closed for you, not hand over silently).

## 9. A grader copy for the teaching team (`--grader`)

A preloaded study copy, made for the prof and the TAs to grade with:

```sh
cd app && tools/release.sh --study ~/.config/chattered-study/keys.json --preload N --grader
```

This gives `out/ChatterED-Grader-<version>-S<NN>-arm64.dmg`. `--grader` is refused without
`--study … --preload N`, and with `--update`. The script stages `app/study/grader.txt` beside
`preload.txt`, checks that it and `Contents/Resources/samples/graph-traversal-tutorial.pdf` are inside
the mounted DMG, and removes its working copy afterwards. An ordinary build refuses to start while
`app/study/grader.txt` exists, and refuses a DMG that carries one.

**What differs from a study copy** (all of it gated on that marker, read once by
`src/main/study/grader.ts` and told to the renderer on `trial:status` as `grader: true`; the wording
is in `src/shared/grader.ts`):

- The consent gate shows grader wording and one **Continue** button instead of the participant
  notice and its checkbox. Consent is still recorded the same way (a participant id is minted), so
  nothing behind the gate changes. The title bar says "Grading copy".
- First run opens on a four-card tour (Back, Next, Skip tour), then "Start with a tutorial", which
  has **Try the sample tutorial** above the drop slots. The sample is
  `docs/group/red-team/sheets/sheetA.pdf` (four graph-search questions), shipped as
  `app/samples/graph-traversal-tutorial.pdf`; main copies it to
  `<userData>/grader/Graph traversal tutorial.pdf` and the renderer opens it through the same
  `startFromTutorial` as a dropped sheet.
- Help ▸ **Show the Grader Tour** shows the tour again.

Everything else is a preloaded study copy: the slot's credit and cap, logging, and the export.

**Trying it in dev:** `CHATTERED_GRADER=1 npm run dev` (honoured only unpackaged), or put any
`app/study/grader.txt` beside a dev bundle. The renderer's mock bridge takes `?grader=1`.

**Check on a fresh profile before sending** (the launch line in section 5, step 1): the gate shows the grader
wording; Continue leads to the tour, not to "Start with a tutorial"; Skip tour and Back work; Try
the sample tutorial opens a notebook called "Graph traversal tutorial" with nine parts (six questions, three of them in two parts); dropping your
own sheet still works; Help ▸ Show the Grader Tour opens the tour; `main.log` has `grader.copy`,
`study.unlock {preloaded:true}`, `trial.consent {grader:true}` and `grader.sample {ok:true}`.

**Known limits.** The marker lives in the app bundle, so an update to an ordinary study-channel
build drops it: the Help item goes, and nothing else changes once first run is done. An export
from a grader copy still carries the participant notice as `consent-notice.txt`.

## Not built

- **No signing.** An Apple Developer ID and notarisation would remove step 3 of the install guide
  (decision #17 kept the app unsigned).
- **No refusal fallback.** A Sonnet 5.5 safety refusal shows "Claude declined to answer this one"
  rather than retrying on another model.
