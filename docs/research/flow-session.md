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

**The 30-minute convention is real, ubiquitous, and much weaker than its ubiquity suggests.**
GA4's own documentation states *"A session ends after a period of inactivity… The default timeout
is 30 minutes but can be adjusted here"* ([Google, GA4 Help: data-stream tag
settings](https://support.google.com/analytics/answer/12131703), fetched 15 Sep 2026 —
**VERIFIED**; the documented adjustable range, widely reported as 5 min – 7 h 55 min, is
**SECONDARY**). Adobe Analytics uses the same 30-minute visit timeout by default ([Adobe
Experience League, *Visits*](https://experienceleague.adobe.com/en/docs/analytics/components/metrics/visits)
— SECONDARY).

**Its provenance is a 1995 arithmetic convenience, not a finding about people.** Catledge &
Pitkow instrumented NCSA XMosaic at Georgia Tech, measured a **mean inter-event gap of 9.3 min**,
added **1.5 standard deviations** to get **25.5 min**, and proposed that as the session boundary;
the number was later *"gradually smoothed out to 30 minutes"* (Catledge & Pitkow, 1995,
*Characterizing Browsing Strategies in the World-Wide Web*, **Computer Networks and ISDN Systems**
27(6), 1065–1073, [abstract](https://www.sciencedirect.com/science/article/abs/pii/0169755295000437)).
**The primary text was paywalled and not read; the 9.3 / 1.5 SD / 25.5 chain is corroborated by two
independent secondary sources but is UNVERIFIED against the paper — cite it as "widely reported".**
Nothing in it is about learning, about attention, or about memory. It is a cut through a
long-tailed distribution of clicks on a dial-up browser.

**The one piece of modern evidence points *below* 30, and it lands on our number.** A 2025
industry analysis re-ran the exercise over a year of live traffic and reports that the **antimode
— the quietest point in the gap distribution, i.e. the natural boundary between "still here" and
"came back" — sits between 15 and 20 minutes in every segment examined**; re-running Catledge &
Pitkow's own method on their data produced *"six different answers"*
([Ringside, *The 30-minute session rule is 30 years old*](https://www.ringside.ai/articles/30-minute-sessions/)
— **SECONDARY**, vendor-authored, not peer-reviewed, and on web traffic rather than study
behaviour). Treat it as suggestive, not as proof. It is nonetheless the only dataset anyone has
published that asks the right question.

**Learning platforms and ITS logs have no convention at all.** Published session-splitting
thresholds in educational data mining range across **7.5 min, 15 min, 25 min, 30 min and 40 min**,
usually chosen per study and sometimes with a sensitivity analysis; MOOC clickstream work commonly
takes 30 min or 1 h. PSLC DataShop's own stated gap definition could not be retrieved —
**UNVERIFIED**. Duolingo's published scheduling work (Settles & Meeder, 2016, *A Trainable Spaced
Repetition Model for Language Learning*, ACL,
[PDF](https://research.duolingo.com/papers/settles.acl16.pdf) — **VERIFIED** the paper and its
12 % engagement A/B result) defines its unit as a *lesson*, not an inactivity gap, so it offers no
number here. **The honest statement for the report: there is no learning-specific empirical basis
for any inactivity gap, and ChatterED must say so.**

**Adjacent sanity check from tooling that measures work sessions.** WakaTime buckets coding
activity into one session while consecutive heartbeats are ≤ **15 min** apart (default, adjustable
5–240 min) ([WakaTime FAQ](https://wakatime.com/faq) — SECONDARY, vendor docs). Slack flips
presence to away after ~10 min and Discord after ~5 (both **UNVERIFIED**, third-party blogs only —
do not cite these in the report).

**Conclusion for §8: 20 min.** It sits inside the only measured antimode band (15–20), below the
unexamined 30-minute convention, and above the longest plausible single think-pause on a hard
slide. It is defensible as *"the low end of the industry convention, moved down to the antimode
that the only published re-examination of it reports"*, and it is explicitly a candidate for A2
calibration (§11), exactly as `design-brief.md` §D3 treats the 45 s silence threshold.

## 2. The attention-span and Pomodoro claims — what survives scrutiny

Lucas's framing reaches for "flow state", and the obvious temptation is to import a study-timing
number — 25/5, or "attention drops after 10–15 minutes" — as the session length. **Do not.** Both
claims are weaker than their circulation.

- **The "attention span is 10–15 minutes in a lecture" claim is not supported.** Wilson & Korn
  reviewed the note-taking, observational, self-report and physiological literature and found the
  evidence for a universal 10–15 min decline weak, with individual differences dominating (Wilson
  & Korn, 2007, *Attention During Lectures: Beyond Ten Minutes*, **Teaching of Psychology** 34(2),
  [DOI](https://journals.sagepub.com/doi/10.1080/00986280701291291) — VERIFIED source located).
  Bradbury went further: the most-cited origin for the claim *barely discusses attention at all*,
  the available data do not support a 10–15 min limit, and variance between teachers dwarfs any
  effect of lecture segment (Bradbury, 2016, *Attention span during lectures: 8 seconds, 10
  minutes, or more?*, **Advances in Physiology Education** 40(4), 509–513,
  [DOI](https://journals.physiology.org/doi/abs/10.1152/advan.00109.2016) — VERIFIED source
  located). **Nothing in ChatterED should be timed to 10–15 minutes on this basis.**
- **Pomodoro's 25/5 is a popular method with thin causal evidence for those specific numbers.** A
  2026 scoping review found 32 studies (N ≈ 5,270) of which only **3 were RCTs**
  ([PubMed 41107936](https://pubmed.ncbi.nlm.nih.gov/41107936/) — SECONDARY summary of a primary
  review). The *general* case for short breaks is better: brief diversions restore vigilance
  (Ariga & Lleras, 2011, *Brief and rare mental "breaks" keep you focused*, **Cognition** 118(3),
  439–443, [DOI](https://www.sciencedirect.com/science/article/abs/pii/S0010027710002994) —
  VERIFIED), and a meta-analysis of 22 studies finds micro-breaks (≤ 10 min) reliably reduce
  fatigue and raise vigour while **performance** benefits are weaker and high-demand tasks need
  longer than 10 min to recover from (Albulescu et al., 2022, *Give me a break!*, **PLOS ONE**,
  [open access](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0272460) —
  VERIFIED).

**What this buys the design.** Two things, both negative and both worth a sentence in the report:
(1) **do not impose a session length** — no 25-minute cap, no "time for a break" nudge on a fixed
clock, because the evidence for a specific duration does not exist; (2) the flow session must be
bounded by **observed behaviour** (an inactivity gap) rather than by a duration, which is exactly
what #33 proposed. The one positive implication: because micro-breaks are restorative and cheap, a
session that closes after 20 min of genuine absence costs the learner nothing — the resume path
(§8.1) is what carries the continuity.

## 2. The attention-span and Pomodoro claims — what survives scrutiny

<!-- FILL -->

## 3. Retrieval-practice timing: when is a concept ready to be quizzed?

### 3.1 The testing effect and why the quiz must not be immediate
### 3.2 Is there a defensible *minimum* age?
### 3.3 Spacing and the lag effect

## 4. Decay: the half-life and the horizon

<!-- FILL: Ebbinghaus/Murre & Dros, Rubin & Wenzel, half-life regression -->

## 5. Flow state and its proxies in interaction logs

**Say plainly in the report: ChatterED does not measure flow.** Csikszentmihalyi's conditions —
clear goals, immediate and unambiguous feedback, challenge–skill balance, merging of action and
awareness, loss of self-consciousness, a distorted sense of time, a sense of control, and an
autotelic quality — are defined phenomenologically and are canonically measured by **self-report**
via the Experience Sampling Method or the Flow State Scale (Csikszentmihalyi, 1990, *Flow: The
Psychology of Optimal Experience*, Harper & Row; Nakamura & Csikszentmihalyi, 2002, *The Concept of
Flow*, in **Handbook of Positive Psychology**, OUP, 89–105 —
[chapter PDF](https://nuovoeutile.it/wp-content/uploads/2015/12/2002-Flow.pdf); the condition list
is textbook-standard but was **not** read from the primary chapter in this pass — SECONDARY).
**There is no Csikszentmihalyi-validated behavioural-log proxy for flow.** A rule of the form
"k turns in m minutes" is an **engagement heuristic borrowed from a different research tradition**.
Calling it "flow detection" in an A1 report would be the kind of unearned claim the rubric
punishes; calling it *"a behavioural proxy for sustained engagement, named 'flow' after the
developer's framing and explicitly not validated as such"* is honest and costs nothing.

**What the log-based tradition actually supports.** Ryan Baker's line of work builds *sensor-free*
detectors of affective states — boredom, confusion, frustration and **"engaged concentration"** —
from interaction-log features alone (response times, error rates, hint use) inside Cognitive Tutor
Algebra, alongside a validated "gaming the system" detector that halves subsequent gaming when the
tutor intervenes ([overview](https://www.globallearningcouncil.org/posts/gaming-the-system-affect-detectors-and-student-persistence-and-learning-in-computer-based-learning-environments/);
[detector paper PDF](https://learninganalytics.upenn.edu/ryanbaker/AIED-D-13-00017_Revised%20v2.pdf)
— SECONDARY, not read in full). **The important precedent is not a number, it is the move:
an engagement state inferred from timing features, used to trigger an intervention.** That is
exactly what §8.2 proposes, and it is the citation that licenses it.

**Impasse is not disengagement — and the Tester must not confuse them.** D'Mello & Graesser's
model of affect dynamics during complex learning has engagement/flow → **confusion** on impasse →
back to flow if resolved, or → frustration → boredom if not (D'Mello & Graesser, 2012, *Dynamics
of Affective States During Complex Learning*, **Learning and Instruction** 22(2), 145–157,
[DOI](https://www.sciencedirect.com/science/article/abs/pii/S0959475211000806) — SECONDARY,
abstract only). The design consequence is sharp: **a long pause is ambiguous** — it is confusion
that may be productive, or it is departure. The silence timer already encodes exactly this
distinction by treating *keystrokes*, not *messages*, as activity (`design-brief.md` §D3:
*"it distinguishes thinking from disengaging, which is the whole point of the timer"*). The flow
rule must inherit that same treatment, or it will quiz a learner who is mid-sentence.

**Thresholds anyone has actually shipped.** The clearest is **wheel-spinning**: a learner who has
practised one skill more than ~10 times without mastering it is unproductively persisting (Beck &
Gong, 2013, *Wheel-Spinning: Students Who Fail to Master a Skill*, **AIED 2013**, LNCS 7926,
[DOI](https://link.springer.com/chapter/10.1007/978-3-642-39112-5_44) — the exact ">10" figure is
**SECONDARY** and should be checked against the primary text before being quoted as a number). For
**pause length specifically**, inter-action interval is a standard *feature* in these detectors but
**no published threshold was found** — **UNVERIFIED**, and therefore ChatterED's own gap number
must be argued from §1 and calibrated from §11, not borrowed.

**Implication for k and m.** No source gives a k-in-m rule for learning. WakaTime's 15-minute
heartbeat window is the nearest shipped analogue and is a *gap*, not a count. So **k = 3 learner
turns in m = 10 min is a designer's choice, and the brief says so** — its defence is structural,
not empirical: it must be (a) short enough that the Tester's question still concerns what the
learner was just doing, (b) long enough to survive one long thinking pause, and (c) strictly
inside the 20 min gap, or the flow window could outlive the session that contains it. m = 10 is
half the gap; k = 3 is the smallest count that distinguishes a conversation from a single question.

## 6. Hand-off prior art — who else decides when to quiz

| System | Who decides to quiz | Detail, where verifiable |
|---|---|---|
| **Anki** | The scheduler, on a fixed within-session ladder | **Learning steps default `1m 10m`** — short repetitions *inside* the sitting before a card graduates to day-scale review intervals; relearning steps apply the same shape to lapses. Official manual, [Deck Options](https://docs.ankiweb.net/deck-options.html) — **VERIFIED primary**. This is the single best precedent for #33's "minimum age": a shipped system with tens of millions of users puts the **second** look at ~10 minutes, not at 3. |
| **Duolingo** | Mostly the learner | Practice Hub / "Mistakes" resurfaces missed items; targeted practice **refreshes daily**, not on a rolling in-session window ([Duolingo blog](https://blog.duolingo.com/guide-to-duolingo-practice-hub/) — SECONDARY). No published in-session quiz trigger. |
| **Quizlet Learn** | The system, but on *answer format*, not engagement | Defaults to typed recall, falls back to self-graded flashcards when the answer cannot be typed; every term must be answered correctly before the round closes ([Quizlet Help](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn) — SECONDARY, snippet only). |
| **Khanmigo** | The learner, via the conversation | Designed never to hand over answers; Socratic prompting pushes questions back at the student. **No published quiz-trigger logic found** ([Freethink overview](https://www.freethink.com/consumer-tech/khanmigo-ai-tutor) — SECONDARY, journalistic). **UNVERIFIED** as a technical description. |
| **Cognitive Tutor / ASSISTments (BKT)** | The model, on a mastery probability | Bayesian Knowledge Tracing estimates per-skill mastery from a four-parameter HMM (Corbett & Anderson, 1995, *Knowledge Tracing*, **UMUAI** 4(4), 253–278, [DOI](https://link.springer.com/article/10.1007/BF01099821) — VERIFIED as the model's source). The conventional advance-the-learner cut is **p(mastery) > 0.95**; recent EDM work questions whether 0.95 is right ([EDM 2025, *How Much Mastery is Enough Mastery?*](https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.short-papers.4/index.html)). The **0.95 figure is SECONDARY** — it is convention in the citing literature, not a quotation from the 1995 paper. |

**Two things this table settles.** (1) **Nobody ships an engagement-triggered quiz.** Every
verifiable precedent triggers on *scheduling* (Anki, Duolingo) or on a *knowledge estimate* (BKT),
not on interaction rate. ChatterED's flow rule is therefore **novel, and must be presented as a
design proposal with a logging plan (§11), not as established practice** — which is a better
position for an A1 report than a false claim of precedent. (2) **The nearest analogue to the
"ready" predicate is BKT's mastery threshold, and ChatterED already has its equivalent**: the
Explanation Ledger's per-element level and `confidence` (`progress-tracking.md` §4.3–4.4). §8.2
uses it rather than inventing a second estimate.

## 6. Hand-off prior art — who else decides when to quiz

<!-- FILL: Khanmigo, Duolingo, Anki, Quizlet, BKT 0.95 -->

## 7. Learner control over the Tester (Koala §7)

Houde et al.'s taxonomy splits control over a group agent into *what* is controlled (**when**,
**what**, **where** to contribute) and *how* it is controlled (**specification**, **access**,
**implementation**) (§7.2, Fig. 7). Three of their findings bear directly on the Tester.

**"When to contribute" is explicitly a controllable trigger, and activity/inactivity is named as
the trigger type.** *"The events that trigger a contribution from the AI agent should be
controllable… The agent can also be triggered by the activity or inactivity of the group, such as
rapid contributions or a long pause"* (§7.2.1). That is precisely the flow rule and the silence
timer, and Koala says the learner should be able to move both.

**Koala II's actual shipped control was a three-level threshold on a self-rated value score, not a
"quiet / normal / eager" slider.** Koala scored each candidate reply 0–100 for how valuable a
contribution it would be and posted only above a threshold; the exposed settings were *high = 90,
medium = 75, low = 50* (§5, Fig. 5b), plus a proactive/reactive toggle where reactive *"only
replied to users when directly addressed"* (Fig. 5a). The issue's "quiet / normal / eager" is the
right shape but should be named for what it is: **reactive** (Tester speaks only when the learner
invokes it) / **normal** / **eager**, implemented as the flow threshold, not as three prompts.
Koala II was perceived as *"quieter and less invasive"* and better paced than Koala I (§6.2.1).

**Rate should track the group's rate.** Koala's own system prompt says it *"attempts to contribute
at approximately the frequency of other users"* (Appendix prompt, l. 18), and P2.1 asked for the
agent to *"automatically adjust the rate of its messages to match those of the group"* (§7.2.1).
The *k*-turns-in-*m*-minutes rule is exactly a rate-matching rule: a learner who is writing a lot
gets quizzed sooner; a learner who is reading gets left alone.

**Consequence for the taught set: show it.** Koala's control complaints were overwhelmingly about
*unpredictability* — P6.2 wanted the agent to *"ask for permission"* rather than jump in (§7.2.1).
A Tester that fires on an invisible rule is unpredictable by construction; a visible "what Max can
ask you about" list (the taught set, with a freshness cue) turns the rule into an affordance and
makes the decline meaningful. **Recommendation: yes, show it** — answering #33's open question (c)
in the affirmative. It costs one collapsed strip in the top bar.

*Source: `Academia/Sources/_text/koala-2501.17258.txt` (Houde et al., "Controlling AI Agent
Participation in Group Conversations: A Human-Centered Approach", arXiv:2501.17258), §5, §6.2.1,
§7.2.1, Figs. 5 and 7.*

## 8. The recommended definition

### 8.1 A flow session — open and close rules
### 8.2 "Ready to be quizzed"
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
page**. The flow session does not replace that: the two units are orthogonal and each rule picks
the one it actually needs.

| Rule | Today | Under the flow session | Why that unit |
|---|---|---|---|
| **≤ 2 silence-timer fires per round** (`timer.ts`, `MAX_FIRES_PER_ROUND = 2`) | per round | **per page (anchor-page), reset on page change** — unchanged from §G Q3 | The nudge is about *this* explanation attempt. A session-wide cap of 2 would silence the timer for an hour; a per-anchor cap gives 48 nudges on a 24-page deck (§G Q3's own arithmetic). |
| **The S2 window** (disagreement quota) | per round | **gone** — retired with the social-group framing (#32, `masg-drop-assessment.md` Option 2) | No longer two standing peers to disagree. |
| **The Theo / teach-back gate** | ledger rung + round end | **replaced by the flow rule (§8.2)**; Theo folded into the Tester (#32) | A teach-back *is* a quiz; the gate becomes "ready to be quizzed". |
| **Whisper clearing** (`design-brief.md` §D5, Dennis et al.'s *ephemerality*) | at round end | **at flow-session close** | Ephemerality is a *temporal* property, not a spatial one: an aside that survives the sitting is a parallel learning history, which is what §D5 forbids. The page is the wrong unit here — the learner scrolls back. The popover is already ephemeral by construction (`pivot-spec.md` §D); the session close is what clears the *stored* whisper turns. |
| **Ledger keying** (`progress-tracking.md`) | per element, per concept | **unchanged — per element**; the session adds a *window*, not a key | The ledger is cumulative by design (monotonic levels, §4.4 rule 2). Decay must never lower a ledger level; it only decides **what the Tester may ask about now**. Keep the two apart or the ledger stops being a progress record. |
| **Latency** (`design-brief.md` §D4, 8–12 s TTFT) | per turn | unchanged | Independent of the unit. |

**The one new relationship.** The ledger stores `evidence_msg_id` per element (§4.3 JSON); message
rows carry timestamps. `taught_at` is therefore **derivable, not a new column**: the most recent
timestamp at which an element was either explained by the Teacher or evidenced by the learner. The
freshness window is a query over existing data plus a `flow_sessions` row.

## 11. What to log in A1 so A2 can tune the constants

The point of A1 logging is not to measure learning — `evaluation-plan.md` §7 does that. It is to
make every constant in §8.3 **re-derivable from data** so A2 can replace a cited default with a
participant-calibrated number, which is exactly the "grounded in empirical user needs" clause the
4.0-mark rubric rewards.

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

**Two rules for the logging itself.** (1) Log **raw times and raw counts, never the derived
boolean alone** — a log that records "ready = true" without the inputs cannot retune anything.
(2) Log the **constants in force** on `flow.session.open` (a `config_hash`), so a mid-study change
does not silently pool two conditions. Both are cheap and both are the difference between A2
tuning the numbers and A2 re-running the study.

**No PII.** All of the above is timestamps, ids and counts. Participant codes P1–P5 only, per
`CLAUDE.md`.

## 12. Open questions for Lucas

The issue asked four; this brief answers two of them and adds three.

1. **(#33a) Is 20 min the right gap for a study sitting?** *Brief's answer: yes as a default, but
   for a reason the issue did not give* — see §1. The number is not load-bearing for A1 (nothing
   irreversible happens at a session close except whisper clearing), so ship 20 and tune from
   `flow.idle.tick`. **Decide: do you want the gap surfaced as a setting, or fixed?**
2. **(#33b) Should the Tester ever fire without the Teacher's hand-off — purely on time?**
   *Brief's answer: no for A1*, and §5 says why: a pure timer is the mechanism the literature
   associates with interruption, not with retrieval practice, and it makes the Tester
   unpredictable, which is Koala's central complaint. **But this is a genuine design call and it
   is yours** — the counter-argument is that a Teacher-gated Tester can never fire if the Teacher
   is stingy, and spacing evidence (§3.3) mildly favours a clock.
3. **(#33c) Does the learner see the taught set and freshness?** *Brief's answer: yes* (§7).
   **Decide: how prominent** — a collapsed chip in the top bar, or a visible rail like the ledger?
4. **(#33d) Sessions per document or per topic folder?** *Brief's answer: per document for A1*,
   because the session's stored payload is "segments touched" and segments are document-scoped;
   but §8.1 keeps a `scope` field so a folder-level session is a one-line change. **Confirm.**
5. **New: may the Tester quiz across documents inside one session?** If the learner opens slide
   deck A, then paper B, the taught set spans two files. Cross-document retrieval is *better*
   practice (interleaving) but a worse fit for the in-document surface, which has nowhere to put
   a question about a page the learner is not looking at.
6. **New: what happens to an unanswered Tester question at session close?** Options: it expires
   silently; it survives as an open item and is the *first* thing on resume; or the ledger records
   an explicit `declined`. The brief recommends **expires, logged** — an unanswered quiz that
   greets you next session is a debt, and `design-brief.md` §E's psychological-safety goal argues
   against debts.
7. **New: does a "re-teach" reset `taught_at`, or add a second one?** Resetting makes the freshness
   window a recency window; keeping both lets a later A2 analysis fit a real spacing curve. The
   brief recommends **append, and use the most recent for the window** — the cost is one row.
