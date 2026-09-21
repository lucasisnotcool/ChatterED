# Shoot plan — one clip bank, two videos

> **Amended 2026-09-21, same day.** The **trailer is dropped** (Lucas) — Pass B, §5 and §6 below
> are on hold, and Deliverable B is not being made. The **interaction is now one 60-second cut**,
> modelled on Table 3 of the report and specified in **`demo-cut.md`**, which supersedes §4's
> per-clip timing for the interaction itself. What still stands in this file, and still matters on
> the day: §2 pre-flight, the shoot-day traps, §3 the pacing budget, and §8 files and hygiene.

Written 2026-09-21 against the app as it stands. Companion to `video-storyboard.md`, which owns
*what is said*; this file owns *what is recorded*. Two deliverables come out of one shooting day:

| | **A — the A1 video** | **B — the trailer** |
|---|---|---|
| Audience | Module marker | Your friends |
| Length | 9:30 (cap 10:00) | 20–25 s |
| Voice | Your VO + face on camera | No VO, music + on-screen text |
| Deck on screen | `CS3249+Lecture+4.pdf` (66 slides) | **`Academia/Sources/btw interaction/`** — see the rule below |
| Backend | Live CLI (honesty beat 13) | Live preferred, scripted as insurance |
| Built by | You, in a normal editor | Me, as a HyperFrames composition |

**Hard rule on decks.** The Week 4 deck is the lecturer's and is not yours to redistribute
(`CLAUDE.md`, and it is deliberately untracked in git). It is fine in coursework submitted to the
module. It is **not** fine in a trailer you send to friends. Pass B is shot entirely on the
7-slide `btw interaction` deck, which is your own and is already the designated A1 fixture (#32).

---

## 1. What `/brag` actually does, and what it does not

`/brag` is a HyperFrames workflow. It reads the project's code, invents a 15–25 s launch video
from it — kinetic typography, motion graphics, a *recreated* impression of the UI — picks music
from its bundled library, adds SFX, renders an MP4, picks a poster frame and writes share copy.
It has seven tone presets (`default`, `polished`, `yc-parody`, `chaotic`, `deadpan`, `cinematic`,
`app-store`) and takes freeform direction. `--voice` adds Kokoro TTS narration.

**It does not record your app.** Nothing in the skill drives Electron or captures a screen. Left
to itself it would render a stylised *idea* of ChatterED, and the one thing that sells this app is
a red question block landing in a document while a green cursor is still typing. That has to be
real footage.

What the underlying framework *can* do, and is good at, is composite footage you supply: `<video>`
clips with trim and volume, seek-safe punch-ins and Ken Burns moves over them, text and callout
overlays timed to the frame, transitions, a music bed with a voiceover carve, captions. So:

- **Deliverable B** = `/brag`'s angle, tone, pacing and share copy, driven by your real clips
  instead of invented visuals. That is a deviation from the skill's default and a good one.
- **Deliverable A** is not a HyperFrames job. A 9:30 narrated piece with your face in it is a
  normal edit. I can add lower-thirds and rule-tag callouts to it afterwards if you want them.

You lose nothing by shooting first: footage is the one input `/brag` cannot generate, and every
other decision it makes is cheap to redo.

---

## 2. Pre-flight

### The night before

1. **Pre-ingest three rooms.** 66 slides is ~6 minutes each, and you do not want to burn that on
   the day. Put three copies of the Week 4 deck in the vault folder under *different filenames* —
   `CS3249 Lecture 4.pdf`, `… take 2.pdf`, `… take 3.pdf`. Different filename ⇒ different
   material ⇒ a separate room with a virgin progress bar. Open each once, let it finish, quit.
   Do the same with one copy of the `btw interaction` deck for Pass B, plus one spare.
   Reopening never re-ingests, so shoot day starts instant.
2. **Leave one deck un-ingested** — a second short deck, 5–10 slides — purely for the ingest shot
   (C02). That is the only clip that needs an ingest to start on camera.
3. **Check the file panel for PII.** It shows real paths. No names, no student IDs, no NUSNET ID
   anywhere in a folder or filename that will be on screen. Same for Settings: no API key visible
   when you film C15 — switch to the CLI backend row and leave the key field blank/masked.
4. `npm run build` and install, so you are filming the app, not the dev server with its overlay.

### Machine, on the day

| Setting | Value | Why |
|---|---|---|
| Focus / Do Not Disturb | On | One banner ruins a 28-second take |
| Desktop | Empty; hide icons | `defaults write com.apple.finder CreateDesktop false; killall Finder` |
| Dock | Auto-hide (⌥⌘D) | And keep the pointer away from the screen edge |
| Menu bar | Cleared of anything personal | Battery %, Wi-Fi name, calendar alerts |
| Window size | **1520 × 855** | Native 16:9 (min is 1040×680, so this is safe); fills frame with no letterbox |
| Capture | ⇧⌘5 → **Record Entire Screen**, 60 fps | Full Retina pixels; crop in the edit. Window-only capture dies if the window nudges |
| Keystroke display | KeyCastr, bottom-left | Needed for ⌘E in A1 beat 6; turn it **off** for the trailer |
| Cursor | Steady, deliberate. No hunting | The edit cannot fix a wandering pointer |

Capturing the whole screen at Retina gives roughly a 2× crop budget, which is what makes the
trailer's punch-ins sharp. Do not "helpfully" record at 1080p.

### App state, in this order

1. Open **Settings first**, before any document.
   - Backend: **Claude Code CLI**, confirm it reports logged in.
   - **Tester pacing → Demo.**
2. *Only then* open the deck.

> **This ordering is not optional.** `rebindActor` ([`src/main/ipc.ts:480`](../../app/src/main/ipc.ts#L480))
> re-binds the LLM client, models, roster and reply speed on an open room — and drops
> `flowProfile` on the floor. The Settings copy says so out loud: *"A change applies to the next
> document you open."* Issue #40 is still open and still true. If you change pacing mid-shoot,
> close the document and reopen it, or Ellie's cue (C09) will not fire and you will sit there for
> minutes wondering why.

### The other traps, all verified open

| # | Trap | Shoot rule |
|---|---|---|
| 40 | Pacing does not reach an open room | Set it before opening. See above |
| 39 | A vault rescan re-mints file ids → a second room, material unextractable | **Never rescan, re-add, move or rename the deck folder during the shoot** |
| 35 | The first Ask waits ~37 s while an ingest is running | Never ask a question on a room that is still ingesting, except deliberately in C02 |
| 43 | Main window is scrollable | A stray two-finger scroll shifts the chrome. Reset before every take |
| 44 | Summary artefact interrupts flow | If it fires mid-take, kill the take and go again |
| 34 | Live backend gives no feedback on send | Do not re-press send. Wait |

---

## 3. Pacing budget — what the dead air actually is

From the 20 Sep rehearsal on this deck, live CLI:

| Event | Time to first words |
|---|---|
| Ellie answers a ⌘E question | ~16 s |
| Max's follow-up after Ellie | ~28 s |
| A verdict on an attempt | ~12 s |
| A suggestion on your own sentence | ~25 s |
| Ellie's cue after silence (Demo) | ~20 s |
| Ingest, 7 slides / 66 slides | ~85 s / ~6 min |

Plan every take as **action + latency + 3 s dwell**. The dwell is not padding: it is the frame the
edit holds on while your VO lands, and it is where a trailer punch-in gets its still moment. In
the A1 cut the latency is narrated over (it is a real property of the system and worth owning);
in the trailer it is cut to zero.

---

## 4. Pass A — the clip bank (Week 4 deck, live backend)

Shoot in this order. It is the storyboard's order, and it is also least-destructive-first: the
progress bar and Max's question history only accumulate, so anything that fills the bar has to
come after everything that wants an empty one.

One file per take. Rename immediately after stopping — `A-C07-take2.mov` — before you shoot the
next one. You will not remember later.

| ID | On screen | The action | Record | Usable | Feeds |
|---|---|---|---|---|---|
| **C00** | Notes, idle, nothing moving | Hands off the keyboard. Do nothing | 20 s | 20 s | Clean plate: runs under VO anywhere, and is the trailer's background layer |
| **C15** | Settings | Scroll to Backend, then Tester pacing, hold on the disclosure paragraph | 25 s | 8 s | A1 disclosure (filming rule 5) |
| **C01** | File panel → notes | Launch; click the deck; notes appear | 20 s | 6 s | A1 b4, trailer reveal |
| **C02** | Ingest, **short deck** | Open the un-ingested deck. "Ellie is reading the slides…", first section appears, keeps filling | 120 s | 8 s | A1 b4. The only clip needing a live ingest |
| **C03** | Notes body | Slow scroll through three headings, past an inline slide-crop figure | 30 s | 10 s | A1 b5, trailer reveal, b-roll |
| **C04** | Provenance | Click a `p. 23` chip → slide modal opens → hold 2 s → close | 15 s | 8 s | A1 b5, trailer 1 s flash |
| **C05** | Carousel | Expand the collapsed slide carousel, scrub it | 15 s | 6 s | A1 b5 |
| **C06** | ⌘E ask | Highlight a sentence → ⌘E → type a question → send. Ellie answers in chat citing `p. N`; her green cursor types the addition into the notes; hold on **Remove · Keep** | 60 s | 15 s | A1 b6, **trailer HL1** |
| **C07** | Max arrives | Wait. Max's follow-up lands in chat with the `max followup` tag, and as a red question block in the notes. Hold on both | 45 s | 10 s | A1 b7, **trailer HL2a** |
| **C08** | The loop | Type an attempt → *Partly there* + a `p. N` quote + a follow-up → answer again → *Well done* → a bar segment fills → open the lesson card, "You wrote: …" → Max's version under his question | 150 s | 25 s | A1 b8, **trailer HL2b**. Fills the bar — needs a virgin room to redo |
| **C09** | Ellie's guess | Next question arrives. **Say nothing.** Ellie's hedged half-right take appears, chipped *"Ellie's guess — she might be wrong"*; Max turns it back to you | 60 s | 12 s | A1 b9, **trailer HL3 (the punchline)** |
| **C10** | Give up | Type `i don't know` → Max releases the full answer, corrects Ellie, the bar does not move. Hold on the unmoved bar | 45 s | 12 s | A1 b10 |
| **C11** | The guard | Type your own sentence into a paragraph **that has a `p. N` chip** (not a heading) → pause → Max assesses it → his correction arrives as strikethrough + red with **Accept · Reject** → press **Reject** → hold on your untouched text → toggle **Freeze** | 90 s | 18 s | A1 b11 |
| **C12** | Private + insert | Open Max's private tab → ask something → **Insert into the document** → the card appears in the notes | 60 s | 12 s | A1 b12 |
| **C13** | Objectives | Click the progress bar → the lesson path → the card marked **Next up** → **Start** → Ellie announces the objective, the doc scrolls | 60 s | 14 s | A1 b12, possible trailer outro |
| **C14** | Usage | The Usage page: per message, per thread, per document, the ingest as its own line | 30 s | 8 s | A1 optional; strong differentiator |
| **C16** | B-roll | Slow scroll with both agent cursors parked in the doc; the two coloured rails; hairline chrome | 30 s | 30 s | Texture under VO, trailer backgrounds |

**Takes.** Shoot C06–C11 **twice live**. Then flip Settings → Backend → **Scripted demo** and shoot
each one **once more**. Scripted replays a fixed transcript through the same actor, the same
rules, the same streaming rate — it looks like the live one rather than merely behaving like it —
so it is your insurance against a model wobble on the one beat you cannot re-stage. Decide in the
edit. If a scripted take makes the A1 cut, beat 13 says so once; that fallback is already written
into the storyboard.

**When a room is spent.** C08 onward permanently fills the bar. If you need C08 again with an
empty bar, close the document and open `… take 2.pdf`. That is what the pre-ingested copies are
for. Do not rescan the vault to get a fresh room (#39).

---

## 5. Pass B — the trailer bank (btw deck, ~25 min of shooting)

Same actions, your own deck, and shot for a different edit: tighter framing discipline, no
KeyCastr, no menu bar, and a beat of stillness at the head and tail of every take so I have
something to cut on.

| ID | Shot | Note |
|---|---|---|
| **T01** | File panel → click deck → notes render | The reveal. Let the notes settle fully before you stop |
| **T02** | ⌘E → question → Ellie's green cursor writing into the notes | Frame so the green cursor is in the middle third — it gets punched into |
| **T03** | Max's red question block landing in the notes | The single most sellable frame in the app. Shoot it three times |
| **T04** | Attempt typed → *Well done* → a bar segment fills | Type at a steady pace; I will speed-ramp it |
| **T05** | Silence → *"Ellie's guess — she might be wrong"* | The punchline. Demo pacing, so ~20 s |
| **T06** | Notes at rest, slow scroll, both cursors visible | Background plate for the title and outro cards |

Shoot T02–T05 on the **scripted** backend if the live model gives you anything mealy-mouthed. A
trailer is a trailer; what matters is that the rules and the UI are real, and they are.

---

## 6. The trailer cut — 24 s

Tone: `/brag`'s `default` preset, with the direction *"the study partner who actually does the
reading."* Music from the bundled library, one keyboard SFX on the type-in, one soft impact on
the red block. Palette straight from the app: ground `#f7f7fa`, ink `#1b1b22`, Ellie `#0f7b6c`,
Max `#b91c1c`, indigo `#4f46e5`. Type in SF Pro, because that is what the app is in.

| t | Beat | Footage | On screen |
|---|---|---|---|
| 0.0–3.0 | **Hook** | None — brand ground | "You ask. It answers. **You learn nothing.**" Last two words land hard |
| 3.0–6.5 | **Reveal** | T01 | Window scales up into frame. "ChatterED — lecture notes that argue back" |
| 6.5–10.5 | **HL1** | T02, punched in on the green cursor | "Ask at the sentence. Ellie writes it into your notes." |
| 10.5–16.0 | **HL2** | T03 → T04 | "Then Max asks *you* one." → bar fills → "The bar only moves on words you wrote." |
| 16.0–20.5 | **HL3** | T05, punch-in on the guess chip | "Go quiet and your classmate guesses — badly, on purpose." |
| 20.5–24.0 | **Outro** | T06 under a card | "ChatterED" · "Open a deck. Argue with it." · how to get the build |

The hook is the research finding stated flat, not a swipe at a competitor: in five of six real
study sessions you coded, not one learner turn held the learner's own reasoning. It is true, it is
yours, and it is the reason the app exists. `/brag`'s creative laws apply — every line holds long
enough to read, and at least one beat is real UI. Four of the six are.

**Format: 16:9 only** (Lucas, 2026-09-21). No vertical recut, so frame for the full window and let
the three-column layout read — it is part of what is being sold. Still capture at full Retina: the
crop budget is what keeps the punch-ins sharp.

**Tone: `default`** (Lucas, 2026-09-21) — playful and clean, direction *"the study partner who
actually does the reading."* Friendly enough not to oversell a prototype to people who know you.

---

## 7. Mapping back to the A1 storyboard

Beats 1–3 and 13–14 are face-to-camera and need no app — **record them first**, while you are
fresh and before the app state complicates anything. Then:

| Beat | Clips |
|---|---|
| 4 ingest | C02 → C01 |
| 5 provenance | C04, C03, C05 |
| 6 ask | C06 |
| 7 Max asks | C07 |
| 8 attempt & bar | C08 |
| 9 Ellie's guess | C09 |
| 10 give up | C10 |
| 11 my own words | C11 |
| 12 private + Start | C12, C13 |
| anywhere under VO | C00, C16, C14 |

Budget check: the usable seconds above total ~3:30 of app footage against ~4:40 of app beats in
the storyboard, which is right — you will hold on frames while narrating, and C00/C16 cover the
rest.

---

## 8. Files and hygiene

- Everything to `~/ChatterED-shoot/2026-09-21/raw/`. **Not in the repo** — there is no LFS in this
  account and `Academia/` is already ~30 MB of plain objects. Nothing from the shoot gets
  committed except this plan and, later, the finished trailer's *link*.
- `A-C07-take2.mov`, `B-T03-take1.mov`. Rename after every take.
- ProRes or HEVC, 60 fps, full Retina resolution. Do not pre-crop, do not pre-compress.
- If a take contains a name, a real student ID, or anything from the transcript corpus on screen —
  delete it on the spot rather than planning to crop it.

---

## 9. Hand-off

When you are done, tell me the folder and I will:

1. Cut the trailer as a HyperFrames composition in `brag-output-<timestamp>/composition/`,
   using your clips with punch-ins, overlays, music and SFX.
2. Run `npx hyperframes check` — zero errors is the gate before render — then render to
   `brag.mp4`, pick a real best frame as the poster and bake it as frame 0.
3. Write `share-copy.txt`: one line you can paste when you send it.
4. If you want it for the A1 cut too, a caption or lower-third pass over your narrated edit.

What I need from you at that point: just the folder, and a yes/no on whether the build
instructions in the outro card should name you. Format and tone are settled above.
