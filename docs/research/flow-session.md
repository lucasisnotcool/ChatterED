# The flow session — the unit between a snippet and a file

**Status.** Draft v1, 15 Sep 2026. Research brief for issue **#33** ("Flow session: the unit
between a snippet and a file — time-based, with decay — and when the Tester is invoked").
**Decides nothing on its own** — it supplies citable constants for the mechanism #33 already
sketched, so the numbers in `src/room/flow.ts` are defended rather than guessed.

**Companions.** `design-brief.md` §D3 (silence timer), §D5 (whisper ephemerality), §F (ledger);
`progress-tracking.md` (ledger schema, per-element evidence + timestamps); `pivot-spec.md` §G Q3
(what replaces "a round"); issue **#32** (Teacher + Tester roster); `app/src/room/timer.ts` (the
existing keystroke-aware clock and its fake-clock test pattern).

**Lucas's framing, verbatim (issue #33):** *"we need some way that is larger than per-snippet
convo, but smaller than whole file, to break up and segment our sessions. the focus should be
time based management and decay; a user is not expected to remember a convo more than 6 hours
old, so the focus is session should match 'flow state'. how we define this flow period and state
is a more impt decision."*

---

## 0. The recommendation in one box

<!-- FILL: constants table -->

---

## 1. Session boundaries: where the 20-minute gap comes from

<!-- FILL: web analytics 30 min, Catledge & Pitkow, GA4, learning platforms, DataShop -->

## 2. The attention-span and Pomodoro claims — what survives scrutiny

<!-- FILL -->

## 3. Retrieval-practice timing: when is a concept ready to be quizzed?

### 3.1 The testing effect and why the quiz must not be immediate
### 3.2 Is there a defensible *minimum* age?
### 3.3 Spacing and the lag effect

## 4. Decay: the half-life and the horizon

<!-- FILL: Ebbinghaus/Murre & Dros, Rubin & Wenzel, half-life regression -->

## 5. Flow state and its proxies in interaction logs

<!-- FILL: Csikszentmihalyi, Baker, D'Mello, wheel-spinning, N-in-M rules -->

## 6. Hand-off prior art — who else decides when to quiz

<!-- FILL: Khanmigo, Duolingo, Anki, Quizlet, BKT 0.95 -->

## 7. Learner control over the Tester (Koala §7)

<!-- FILL -->

## 8. The recommended definition

### 8.1 A flow session — open and close rules
### 8.2 "Ready to be quizzed"
### 8.3 The constants, with a citation each

## 9. Alternatives rejected

## 10. How the round-based rules map on

## 11. What to log in A1 so A2 can tune the constants

## 12. Open questions for Lucas
