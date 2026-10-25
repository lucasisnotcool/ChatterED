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

```sh
cd app
tools/release.sh --study ~/.config/chattered-study/keys.json
```

**Preloaded copies, one per participant** (each build wipes `out/`, so move each DMG away):

```sh
cd app
for s in 1 2 3 4; do
  tools/release.sh --study ~/.config/chattered-study/keys.json --preload "$s" &&
    mv out/ChatterED-Study-*-S0"$s"-arm64.dmg ~/.config/chattered-study/
done
```

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

## 6. Participant install guide (paste this into the message with the link)

> 1. Download `ChatterED-Study-….dmg`, open it, and drag **ChatterED** onto **Applications**.
>    It needs an Apple Silicon Mac (M1 or later) on macOS 13 or newer.
> 2. Open ChatterED from Applications. macOS says it cannot verify the developer. Click **Done**
>    (not Move to Trash).
> 3. Open **System Settings ▸ Privacy & Security**, scroll down, and click **Open Anyway** next to
>    "ChatterED was blocked". Confirm with your password. You do this once.
> 4. Read and agree to the trial notice. Your copy already has its credit: the amount left is
>    always at the top right. (A shared DMG asks for your study code here: `S..-....-....-....`.)
>    When it runs out, you can keep going with Claude Code or your own API key in Settings.
> 5. Drop in this week's tutorial sheet, and the lecture slides it goes with if you have them,
>    and press **Open the tutorial**. Max reads the sheet (a minute or two), then every part has
>    an answer slot: write your attempt there, and use Hint or Check beside it.
> 6. At the end of the study, choose **File ▸ Export Research Data…** and email us the zip.

## 7. End of the study

1. Collect the exports. Each manifest's `study` block gives the slot, budget, spend and whether
   the cap was hit; the participant ID is the random `P-…`, not the slot.
2. **Revoke every study key** in the Console (or archive the workspaces). Until then, every DMG
   you sent still works.
3. Delete `codes.csv` and the preloaded DMGs.

## Not built

- **No update check.** A fix during the study means sending a new DMG; the bundle and codes carry
  over (rebuild with the same `keys.json`), and participants keep their data.
- **No signing.** An Apple Developer ID and notarisation would remove step 3 of the install guide
  (decision #17 kept the app unsigned).
- **No refusal fallback.** A Sonnet 5.5 safety refusal shows "Claude declined to answer this one"
  rather than retrying on another model.
