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

**The 30-minute convention is real, ubiquitous, and much weaker than its ubiquity suggests.** GA4:
*"A session ends after a period of inactivity… The default timeout is 30 minutes but can be
adjusted here"* ([Google, GA4 Help](https://support.google.com/analytics/answer/12131703) —
VERIFIED). Adobe Analytics defaults to the same 30-minute visit timeout
([Adobe](https://experienceleague.adobe.com/en/docs/analytics/components/metrics/visits) —
SECONDARY).

**Its provenance is a 1995 arithmetic convenience, not a finding about people.** Catledge & Pitkow
instrumented NCSA XMosaic at Georgia Tech, measured a **mean inter-event gap of 9.3 min**, added
**1.5 standard deviations** to get **25.5 min**, and proposed that as the boundary; it was later
*"gradually smoothed out to 30 minutes"* (Catledge & Pitkow, 1995, *Characterizing Browsing
Strategies in the World-Wide Web*, **Computer Networks and ISDN Systems** 27(6), 1065–1073,
[abstract](https://www.sciencedirect.com/science/article/abs/pii/0169755295000437)). **The primary
text is paywalled and was not read; the 9.3 / 1.5 SD / 25.5 chain is corroborated by two
independent secondaries but is UNVERIFIED — cite it as "widely reported".** Nothing in it concerns
learning, attention or memory.

**The one piece of modern evidence points below 30, and lands on our number.** A 2025 industry
analysis re-ran the exercise over a year of live traffic and reports the **antimode — the quietest
point in the gap distribution, the natural boundary between "still here" and "came back" — at
15–20 minutes in every segment**; re-running the 1995 method on their own data gave *"six different
answers"* ([Ringside](https://www.ringside.ai/articles/30-minute-sessions/) — **SECONDARY**,
vendor-authored, not peer-reviewed, web traffic not study behaviour). Suggestive, not proof, but it
is the only published dataset that asks the right question.

**Learning platforms and ITS logs have no convention at all.** Published session-splitting
thresholds in educational data mining range across **7.5, 15, 25, 30 and 40 min**, chosen per study;
MOOC clickstream work commonly takes 30 min or 1 h. PSLC DataShop's own stated gap could not be
retrieved — **UNVERIFIED**. Duolingo's scheduling work defines its unit as a *lesson*, not a gap
(Settles & Meeder, 2016, ACL, [PDF](https://research.duolingo.com/papers/settles.acl16.pdf) —
VERIFIED for the paper and its 12 % engagement A/B result), so it offers no number here. **There is
no learning-specific empirical basis for any inactivity gap, and the report must say so.**

**Adjacent tooling that measures work sessions.** WakaTime buckets coding activity into one session
while consecutive heartbeats are ≤ **15 min** apart (default; 5–240 min configurable)
([WakaTime FAQ](https://wakatime.com/faq) — SECONDARY). Slack (~10 min) and Discord (~5 min) idle
timers are **UNVERIFIED** third-party figures — do not cite them in the report.

**Conclusion: `GAP = 20 min`.** Inside the only measured antimode band (15–20), below the
unexamined convention, above the longest plausible think-pause. Defensible as *"the low end of the
industry convention, moved to the antimode the one published re-examination reports"*, and an
explicit A2 calibration target (§11) — exactly how `design-brief.md` §D3 treats the 45 s threshold.

## 2. The attention-span and Pomodoro claims — what survives scrutiny

Lucas's framing reaches for "flow state", and the temptation is to import a study-timing number —
25/5, or "attention drops after 10–15 minutes" — as the session length. **Do not.**

- **The "10–15 minute attention span" claim is not supported.** Wilson & Korn reviewed the
  note-taking, observational, self-report and physiological literature and found the evidence weak,
  with individual differences dominating (2007, *Attention During Lectures: Beyond Ten Minutes*,
  **Teaching of Psychology** 34(2),
  [DOI](https://journals.sagepub.com/doi/10.1080/00986280701291291) — VERIFIED). Bradbury went
  further: the most-cited origin *barely discusses attention at all*, and teacher variance dwarfs
  any segment effect (2016, **Advances in Physiology Education** 40(4), 509–513,
  [DOI](https://journals.physiology.org/doi/abs/10.1152/advan.00109.2016) — VERIFIED).
- **Pomodoro's 25/5 is popular with thin causal evidence for those numbers.** A 2026 scoping review
  found 32 studies (N ≈ 5,270), only **3 of them RCTs**
  ([PubMed 41107936](https://pubmed.ncbi.nlm.nih.gov/41107936/) — SECONDARY). The *general* case for
  short breaks is better: brief diversions restore vigilance (Ariga & Lleras, 2011, **Cognition**
  118(3), 439–443, [DOI](https://www.sciencedirect.com/science/article/abs/pii/S0010027710002994) —
  VERIFIED), and 22-study meta-analysis finds micro-breaks (≤ 10 min) reliably cut fatigue and raise
  vigour, with weaker performance effects (Albulescu et al., 2022, **PLOS ONE**,
  [open access](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0272460) —
  VERIFIED).

**Two consequences, both worth a sentence in the report.** (1) **Impose no session length** — no
25-minute cap, no break nudge on a fixed clock. (2) Bound the session by **observed behaviour** (an
inactivity gap), which is what #33 proposed. The one positive implication: because micro-breaks are
restorative and cheap, closing after 20 min of genuine absence costs the learner nothing — the
resume path (§8.1) carries the continuity.

## 3. Retrieval-practice timing: when is a concept ready to be quizzed?

### 3.1 The testing effect and why the quiz must not be immediate
### 3.2 Is there a defensible *minimum* age?
### 3.3 Spacing and the lag effect

## 4. Decay: the half-life and the horizon

<!-- FILL: Ebbinghaus/Murre & Dros, Rubin & Wenzel, half-life regression -->

## 5. Flow state and its proxies in interaction logs

**Say plainly in the report: ChatterED does not measure flow.** Csikszentmihalyi's conditions —
clear goals, immediate feedback, challenge–skill balance, merged action and awareness, lost
self-consciousness, distorted time, control, autotelic quality — are phenomenological and
canonically measured by **self-report**, via ESM or the Flow State Scale (Csikszentmihalyi, 1990,
*Flow*, Harper & Row; Nakamura & Csikszentmihalyi, 2002, *The Concept of Flow*, in **Handbook of
Positive Psychology**, OUP, 89–105 —
[PDF](https://nuovoeutile.it/wp-content/uploads/2015/12/2002-Flow.pdf); the list is
textbook-standard but was not read from the primary chapter — SECONDARY). **There is no validated
behavioural-log proxy for flow.** A "k turns in m minutes" rule is an **engagement heuristic from a
different tradition**. Calling it flow detection in an A1 report is an unearned claim; calling it
*"a behavioural proxy for sustained engagement, named 'flow' after the developer's framing and
explicitly not validated as such"* is honest and costs nothing.

**What the log tradition does support.** Baker's line of work builds *sensor-free* detectors of
boredom, confusion, frustration and **"engaged concentration"** from log features alone (response
times, error rates, hint use) in Cognitive Tutor Algebra, plus a gaming-the-system detector whose
intervention roughly halves subsequent gaming
([overview](https://www.globallearningcouncil.org/posts/gaming-the-system-affect-detectors-and-student-persistence-and-learning-in-computer-based-learning-environments/);
[detector PDF](https://learninganalytics.upenn.edu/ryanbaker/AIED-D-13-00017_Revised%20v2.pdf) —
SECONDARY, not read in full). **The precedent is the move, not a number:** an engagement state
inferred from timing features and used to trigger an intervention. That licenses §8.2.

**Impasse is not disengagement.** D'Mello & Graesser model engagement → **confusion** on impasse →
back to flow if resolved, or → frustration → boredom if not (2012, **Learning and Instruction**
22(2), 145–157, [DOI](https://www.sciencedirect.com/science/article/abs/pii/S0959475211000806) —
SECONDARY, abstract only). So **a long pause is ambiguous**. The silence timer already encodes this
by treating *keystrokes*, not messages, as activity (`design-brief.md` §D3: *"it distinguishes
thinking from disengaging, which is the whole point of the timer"*). The flow rule must inherit
that, or it will quiz a learner mid-sentence.

**Thresholds anyone shipped.** The clearest is **wheel-spinning** — practising one skill more than
~10 times without mastering it (Beck & Gong, 2013, **AIED 2013**, LNCS 7926,
[DOI](https://link.springer.com/chapter/10.1007/978-3-642-39112-5_44); the ">10" figure is
**SECONDARY**, check the primary before quoting). For **pause length** specifically, inter-action
interval is a standard *feature* but **no published threshold was found — UNVERIFIED**. ChatterED's
gap must therefore be argued from §1 and calibrated from §11, not borrowed.

**So k and m are a designer's choice, and the brief says so.** No source gives a k-in-m rule for
learning; WakaTime's 15-minute window is the nearest shipped analogue and is a gap, not a count.
The defence is structural: the window must be (a) short enough that the question still concerns
what the learner was just doing, (b) long enough to survive one long thinking pause, (c) strictly
inside the 20 min gap, or the flow window could outlive its session. **m = 10** is half the gap;
**k = 3** is the smallest count that distinguishes a conversation from a single question.

## 6. Hand-off prior art — who else decides when to quiz

| System | Who decides to quiz | Detail, where verifiable |
|---|---|---|
| **Anki** | The scheduler, on a fixed within-session ladder | **Learning steps default `1m 10m`** — short repetitions *inside* the sitting before a card graduates to day-scale review intervals; relearning steps apply the same shape to lapses. Official manual, [Deck Options](https://docs.ankiweb.net/deck-options.html) — **VERIFIED primary**. This is the single best precedent for #33's "minimum age": a shipped system with tens of millions of users puts the **second** look at ~10 minutes, not at 3. |
| **Duolingo** | Mostly the learner | Practice Hub / "Mistakes" resurfaces missed items; targeted practice **refreshes daily**, not on a rolling in-session window ([Duolingo blog](https://blog.duolingo.com/guide-to-duolingo-practice-hub/) — SECONDARY). No published in-session quiz trigger. |
| **Quizlet Learn** | The system, but on *answer format*, not engagement | Defaults to typed recall, falls back to self-graded flashcards when the answer cannot be typed; every term must be answered correctly before the round closes ([Quizlet Help](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn) — SECONDARY, snippet only). |
| **Khanmigo** | The learner, via the conversation | Designed never to hand over answers; Socratic prompting pushes questions back at the student. **No published quiz-trigger logic found** ([Freethink overview](https://www.freethink.com/consumer-tech/khanmigo-ai-tutor) — SECONDARY, journalistic). **UNVERIFIED** as a technical description. |
| **Cognitive Tutor / ASSISTments (BKT)** | The model, on a mastery probability | Bayesian Knowledge Tracing estimates per-skill mastery from a four-parameter HMM (Corbett & Anderson, 1995, *Knowledge Tracing*, **UMUAI** 4(4), 253–278, [DOI](https://link.springer.com/article/10.1007/BF01099821) — VERIFIED as the model's source). The conventional advance-the-learner cut is **p(mastery) > 0.95**; recent EDM work questions whether 0.95 is right ([EDM 2025, *How Much Mastery is Enough Mastery?*](https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.short-papers.4/index.html)). The **0.95 figure is SECONDARY** — it is convention in the citing literature, not a quotation from the 1995 paper. |

**Two things this settles.** (1) **Nobody ships an engagement-triggered quiz.** Every verifiable
precedent triggers on *scheduling* (Anki, Duolingo) or a *knowledge estimate* (BKT), never on
interaction rate — so ChatterED's flow rule must be presented as a **design proposal with a logging
plan (§11)**, not as established practice. That is a better position for an A1 report than a false
claim of precedent. (2) The nearest analogue to "ready" is BKT's mastery threshold, and ChatterED
already has its equivalent: the ledger's per-element level and `confidence`
(`progress-tracking.md` §4.3–4.4). §8.2 uses it rather than inventing a second estimate.

## 7. Learner control over the Tester (Koala §7)

Houde et al. split control over a group agent into *what* is controlled (**when**, **what**,
**where** to contribute) and *how* (**specification**, **access**, **implementation**) (§7.2,
Fig. 7). Three findings bear on the Tester.

**"When to contribute" is explicitly a controllable trigger, and activity/inactivity is the named
trigger type.** *"The events that trigger a contribution from the AI agent should be controllable…
The agent can also be triggered by the activity or inactivity of the group, such as rapid
contributions or a long pause"* (§7.2.1). That is the flow rule and the silence timer, and Koala
says the learner should be able to move both.

**Koala II's shipped control was a three-level threshold on a self-rated value score, not a
"quiet / normal / eager" slider — correct this in #33.** Koala scored each candidate reply 0–100
for how valuable a contribution it would be and posted only above a threshold; the exposed settings
were **high = 90, medium = 75, low = 50** (§5, Fig. 5b), plus a proactive/reactive toggle where
reactive *"only replied to users when directly addressed"* (Fig. 5a). So ChatterED's three levels
should be **reactive** (Tester speaks only when invoked) / **normal** / **eager**, implemented as
the R1–R3 thresholds, not as three prompts. Koala II was then perceived as *"quieter and less
invasive"* and better paced (§6.2.1).

**Rate should track the group's rate.** Koala's own prompt says it *"attempts to contribute at
approximately the frequency of other users"*, and P2.1 asked it to *"automatically adjust the rate
of its messages to match those of the group"* (§7.2.1). k-in-m **is** a rate-matching rule: a
learner writing a lot is quizzed sooner; a learner reading is left alone.

**Therefore show the taught set — answering #33's open question (c) yes.** Koala's control
complaints were about *unpredictability*; P6.2 wanted the agent to *"ask for permission"* rather
than jump in (§7.2.1). A Tester firing on an invisible rule is unpredictable by construction. A
visible "what Max can ask you about" list, with a freshness cue, turns the rule into an affordance
and makes declining meaningful. Cost: one collapsible strip in the top bar.

*Source: `Academia/Sources/_text/koala-2501.17258.txt` (Houde et al., arXiv:2501.17258), §5,
§6.2.1, §7.2.1, Figs. 5 and 7.*

## 8. The recommended definition

### 8.1 A flow session — open and close rules

> **A flow session is a contiguous span of engaged work in one document, opened by the learner's
> first meaningful action and closed by absence, not by duration.**

**Opens** on the first *learner-authored* action in a document — a turn, a split, an Ask, a whisper.
**Opening the document is not enough**: a session that opens on `document.open` fills the §11 gap
distribution with one-action sessions.

**Closes** on the first of: (1) **`GAP = 20 min` with no learner activity**, where activity means
keystrokes in any composer as well as turns, splits and page changes — the `timer.ts` definition
inherited verbatim (§5), so typing pauses the clock; (2) **explicit "End session"**, always
available, the learner-controlled edge of an otherwise automatic mechanism (§7); (3) **sleep, quit
or crash past the gap** — reuse `timer.ts`'s pattern exactly, an absolute deadline persisted before
anything is armed and compared against wall-clock on a 1 s tick (*"the row is the timer"*), because
a session must not depend on a `setTimeout` that never fired; (4) **switching documents**, if
sessions stay document-scoped (§12 q. 4), with `close_reason = 'document_switch'`.

**Stored** as a `flow_sessions` row: `id`, `document_id`, `scope` ('document' for A1), `opened_at`,
`closed_at`, `close_reason`, `config_hash`, and the ordered anchors touched.

**Resume vs. reopen.** Returning **inside** the gap re-enters the open session — no greeting, no
recap. Returning **after** it opens a new one, and the Teacher offers a retrieval prompt on the
previous session's still-fresh items *only* if any survive the horizon (§8.3); otherwise one line on
what was covered, then move on. The asymmetry is the point: a 90-second coffee break must cost
nothing.

**Closing does exactly three things** — clears stored whisper turns (§10), expires any unanswered
Tester question (§12 q. 6), stops the flow window. **It never touches the ledger**, which is
cumulative and monotonic (`progress-tracking.md` §4.4). Decay governs what may be *asked*, never
what has been *achieved*.

### 8.2 "Ready to be quizzed"

All four conditions must hold on a learner turn, and the Tester's rate setting (§7) must permit,
before the Teacher hands off.

| # | Condition | Default | Rationale |
|---|---|---|---|
| **R1 — engagement** | ≥ `k` learner turns in the last `m` minutes | **k = 3, m = 10 min** | §5. A behavioural proxy for sustained engagement, not validated flow. m is half the gap so the window cannot outlive its session; k = 3 is the smallest count that distinguishes a conversation from a single question. **Designer's choice — say so.** |
| **R2 — coverage** | ≥ 2 elements in the taught set with freshness above the floor | **2** | A one-element quiz is a comprehension check (§9); two is the minimum at which the Tester can ask the learner to *relate* things, which is what the ledger's levels 2–4 score (`progress-tracking.md` §3.1). |
| **R3 — maturity** | the youngest quizzable element is older than `MIN_AGE` | **10 min** (was 3 min) | §3.2 and §6. Raised from #33's proposal on Anki's shipped `1m 10m` learning steps and on the desirable-difficulties argument that an immediate test can be passed out of working memory. |
| **R4 — clear floor** | no unanswered Teacher question pending, no silence-timer window open, no whisper popover open, composer idle ≥ 3 s | — | §5's ambiguity finding. Quizzing into an impasse is the D'Mello path from confusion to frustration; quizzing mid-keystroke is the failure `design-brief.md` §D3 built the keystroke rule to prevent. |

**Which element the Tester picks.** Among elements passing R3 and inside the horizon, prefer
**highest freshness × lowest ledger level** — the thing most recently taught that the learner has
least demonstrated. This reuses the existing level → probe-type policy (`progress-tracking.md` §5)
rather than adding a second one.

**The hand-off is an offer, not an event.** *"You've covered X and Y — Max, want to take it?"* A
decline sets a **cool-down of one full `m` window** before R1 can hold again, and is logged (§11).
Three declines in a session drop the Tester to *reactive* for the rest of it, said once. This is the
Koala control expressed as behaviour rather than as a settings panel (§7.2.1: *"ask for
permission"*).

### 8.3 The constants, with a citation each

## 9. Alternatives rejected

| Alternative | Why it was rejected |
|---|---|
| **The unit is the segment / anchor** (one crop + its thread) | #33's own objection stands: a quiz on one snippet is a comprehension check, not retrieval practice, and the Tester would fire on every crop. It also fails the spacing evidence (§3.3) — the gap between study and test collapses to seconds. Kept for the *silence-timer cap* only (§10), where locality is the point. |
| **The unit is the document / file** | A 60-slide deck is several sittings. A quiz over the whole file ignores decay entirely, and the ledger already covers the file-level view. |
| **The unit is a fixed duration (25 min, Pomodoro; 45 min, a lecture slot)** | §2: the evidence for any specific duration is thin (3 RCTs) and the 10–15 min attention claim is actively debunked. A duration also cannot tell an absent learner from an absorbed one, which is the only distinction that matters here. |
| **A 30-minute inactivity gap (the analytics default)** | §1: the number is a 1995 statistical convenience, later rounded, and the one modern re-examination places the antimode at 15–20 min. 30 min would also keep whisper content alive far past the aside that produced it (§10). |
| **A 5- or 10-minute gap** | Below a plausible single think-pause on a hard slide, and below the m = 10 min flow window — the session could close inside its own flow window. It would also close a session every time the learner reads the slide properly. |
| **Ask the learner "are you in flow?"** | The only *validated* way to measure flow is self-report (§5), so this is the methodologically correct option — and it is wrong for the product. ESM interrupts the state it measures, and Lucas's framing is explicit that the state should be inferred, not asked. Mentioned in the report as the road not taken. |
| **Infer flow from an affect detector (Baker-style)** | Genuinely the state of the art (§5), and out of scope for A1: those detectors are trained per-system on labelled log corpora ChatterED does not have. The §11 logging is the first step toward it, and that is the honest A2 sentence. |
| **Trigger the Tester on a BKT-style mastery probability instead of engagement** | ChatterED's ledger *is* its knowledge estimate, and §8.2 uses it — but as a **gate**, not as the trigger. Mastery answers *what* is worth asking; it cannot answer *when*, because a learner at level 1 on four elements is equally "ready" at 2 a.m. and mid-conversation. |
| **A pure clock: quiz every N minutes regardless** | Predictable and trivially implementable, and it is #33's open question (b). Rejected for A1: §5's ambiguity finding (a pause is confusion or departure) means a blind clock will interrupt an impasse, which is the D'Mello path from confusion to frustration. Revisit if the hand-off proves too rare in the A1 pilot. |
| **Decay by count (last N concepts) rather than by time** | Simpler and needs no half-life. Rejected because it contradicts the framing directly — Lucas's unit is *time-based with decay*, and a learner who covered three concepts yesterday would be quizzed on them today as if they were fresh. |
| **A hard expiry with no half-life — "quizzable for exactly 6 h, then not"** | This is nearly what §8.3 recommends, and the difference matters: a **continuous freshness score** lets the Tester *prefer* the item at the sweet spot instead of picking arbitrarily among everything inside the window, and it degrades gracefully if the horizon is wrong. The cost is one `exp()`. |
| **Sessions scoped to the topic folder rather than the document** | Deferred, not rejected — §12 q. 4. The stored payload is "segments touched" and segments are document-scoped, so per-document is the smaller A1 change; a `scope` field keeps the door open. |

## 10. How the round-based rules map on

`pivot-spec.md` §G Q3 listed four rules keyed on "a round" and recommended reading a round as **a
page**. The flow session does not replace that: the units are orthogonal, and each rule takes the
one it actually needs.

| Rule | Today | Under the flow session | Why that unit |
|---|---|---|---|
| **≤ 2 silence-timer fires per round** (`timer.ts`, `MAX_FIRES_PER_ROUND = 2`) | per round | **per page (anchor-page), reset on page change** — unchanged from §G Q3 | The nudge is about *this* explanation attempt. A session-wide cap of 2 would silence the timer for an hour; a per-anchor cap gives 48 nudges on a 24-page deck (§G Q3's own arithmetic). |
| **The S2 window** (disagreement quota) | per round | **gone** — retired with the social-group framing (#32, `masg-drop-assessment.md` Option 2) | No longer two standing peers to disagree. |
| **The Theo / teach-back gate** | ledger rung + round end | **replaced by the flow rule (§8.2)**; Theo folded into the Tester (#32) | A teach-back *is* a quiz; the gate becomes "ready to be quizzed". |
| **Whisper clearing** (`design-brief.md` §D5, Dennis et al.'s *ephemerality*) | at round end | **at flow-session close** | Ephemerality is a *temporal* property, not a spatial one: an aside that survives the sitting is a parallel learning history, which is what §D5 forbids. The page is the wrong unit here — the learner scrolls back. The popover is already ephemeral by construction (`pivot-spec.md` §D); the session close is what clears the *stored* whisper turns. |
| **Ledger keying** (`progress-tracking.md`) | per element, per concept | **unchanged — per element**; the session adds a *window*, not a key | The ledger is cumulative by design (monotonic levels, §4.4 rule 2). Decay must never lower a ledger level; it only decides **what the Tester may ask about now**. Keep the two apart or the ledger stops being a progress record. |
| **Latency** (`design-brief.md` §D4, 8–12 s TTFT) | per turn | unchanged | Independent of the unit. |

**The one new relationship.** The ledger stores `evidence_msg_id` per element
(`progress-tracking.md` §4.3) and message rows carry timestamps, so **`taught_at` is derivable, not
a new column**: the most recent time an element was explained by the Teacher or evidenced by the
learner. Freshness is a query over existing data plus a `flow_sessions` row.

## 11. What to log in A1 so A2 can tune the constants

The point of A1 logging is not to measure learning — `evaluation-plan.md` §7 does that. It is to
make every constant in §8.3 **re-derivable from data**, so A2 can replace a cited default with a
participant-calibrated number: exactly the "grounded in empirical user needs" clause the 4.0-mark
rubric rewards.

| Event | Fields | Which constant it tunes |
|---|---|---|
| `flow.session.open` | `session_id`, `document_id`, `ts`, `trigger` (open+turn / split / ask / resume) | — |
| `flow.session.close` | `session_id`, `ts`, `reason` (gap / explicit / sleep / app quit), `gap_ms` if gap | **GAP**. The distribution of *observed* inter-action intervals is the whole tuning set: plot it, find the antimode, compare to 20 min. This is the same method Catledge & Pitkow used to get 25.5 min. |
| `flow.idle.tick` | `session_id`, `idle_ms` at each 60 s of continuous inactivity that did **not** end the session | **GAP**, from the other side: how often does a learner come back after 10, 15, 25 min? Log it even when no session closes, or the data is censored at 20 min and can never justify a larger gap. |
| `flow.turn` | `session_id`, `anchor_id`, `speaker`, `ts`, `chars`, `composer_active_ms` | **k, m**. Recompute any (k, m) pair offline from the raw turn stream; never hard-code the rolling count into the log. |
| `flow.state.changed` | `session_id`, `ts`, `ready` (bool), `reasons[]` (which of the four conditions held/failed), `taught_count`, `min_age_ms`, `threshold` | Everything. `reasons[]` is what tells you *which* condition is the binding constraint — if `taught_count < 2` blocks 80 % of would-be fires, the flow rule is really a coverage rule and k/m are decoration. |
| `tester.handoff.offered` | `session_id`, `element_ids[]`, each with `taught_at`, `age_ms`, `freshness` | **HALF_LIFE, HORIZON, MIN_AGE**. Pair `age_ms` with the answer's ledger outcome and you have a small forgetting curve of your own. |
| `tester.handoff.response` | `accepted` / `declined` / `ignored`, `latency_ms` | **Acceptance rate is the primary tuning signal.** Decline rate rising with session length ⟹ the eager threshold is wrong. Koala's §6.2 usefulness rating is the model. |
| `tester.answer.scored` | `element_id`, `age_ms`, `level_before`, `level_after`, `confidence` | **HALF_LIFE and MIN_AGE, empirically.** Success rate as a function of `age_ms` *is* the retention function for this material and this learner. With five participants it is anecdote, but it is the right anecdote and it is free. |
| `tester.rate.changed` | `from`, `to`, `ts`, `session_id` | Whether the Koala control is used at all, and in which direction (Koala found learners pushed *both* ways, §7.1). |
| `flow.resume.offered` | `prev_session_id`, `gap_ms`, `fresh_element_ids[]`, `accepted` | **HORIZON**. The 6 h number is the least defensible constant (§4) and this is the only event that tests it. |

**Two rules for the logging itself.** (1) Log **raw times and counts, never the derived boolean
alone** — a log recording `ready = true` without its inputs cannot retune anything. (2) Log the
**constants in force** on `flow.session.open` (a `config_hash`), so a mid-study change does not
silently pool two conditions. Both are cheap and both are the difference between A2 tuning the
numbers and A2 re-running the study.

**No PII** — timestamps, ids and counts only; participant codes P1–P5, per `CLAUDE.md`.

## 12. Open questions for Lucas

The issue asked four. This brief answers three and adds three.

1. **(#33a) Is 20 min right for a study sitting?** *Yes as a default, for a reason the issue did not
   have* (§1: the 15–20 min antimode). Nothing irreversible happens at a close except whisper
   clearing, so ship 20 and tune from `flow.idle.tick`. **Decide: is the gap a visible setting?**
2. **(#33b) May the Tester ever fire without the Teacher's hand-off — purely on time?** *Brief says
   no for A1* (§5: a blind clock will interrupt an impasse, the D'Mello path to frustration; and it
   is Koala's unpredictability complaint). **But this is your call** — the counter is that a stingy
   Teacher means the Tester never fires, and spacing evidence mildly favours a clock.
3. **(#33c) Does the learner see the taught set and freshness?** *Yes* (§7). **Decide how prominent:
   a collapsed chip in the top bar, or a visible rail like the ledger?**
4. **(#33d) Sessions per document or per topic folder?** *Per document for A1* — the payload is
   "segments touched" and segments are document-scoped — with a `scope` field so folder scope is a
   one-line change. **Confirm.**
5. **New: may the Tester quiz across documents in one session?** Cross-document retrieval is better
   practice (interleaving) but a worse fit for an in-document surface, which has nowhere to put a
   question about a page the learner is not looking at.
6. **New: what happens to an unanswered Tester question at close?** Brief recommends **expires,
   logged**. A quiz that greets you next session is a debt, and `design-brief.md` §E's
   psychological-safety goal argues against debts.
7. **New: does re-teaching reset `taught_at` or append a second one?** Brief recommends **append,
   and use the most recent for the window** — one extra row, and it lets A2 fit a real spacing
   curve instead of a recency window.
