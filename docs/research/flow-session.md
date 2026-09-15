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

**A flow session is a contiguous span of engaged work in one document, opened by the learner's
first meaningful action and closed by 20 minutes of inactivity, an explicit end, or a document
switch. A concept is quizzable when it is at least 3 minutes old, inside the horizon (this session,
or the previous one if it closed under 6 h ago), and the learner has taken ≥ 3 turns in the last
10 minutes with ≥ 2 covered concepts and a clear floor.** Constants and citations: §8.3.

**Four things this brief changes about #33's proposal.**

1. **The 2 h half-life goes** — no evidence supports it for conceptual material; even nonsense
   syllables decay slower (§4). It survives demoted to a 60-minute *ranking* weight.
2. **The 6 h horizon stays, re-justified** as a **conversational-context** bound, not a decay
   constant, with the limitation stated: memory would permit far longer (§4).
3. **The 3-minute minimum age stays and must not be raised.** For *prose* the only direct evidence
   found immediate testing **better** than a 10-minute delay, so `MIN_AGE` is a UI guard, not a
   pedagogical delay (§3).
4. **Feedback after every quiz answer becomes mandatory** — g = 0.73 with it versus 0.39 without
   (§3). The best-evidenced constraint in the brief, and #33 does not mention it.

**And one that is honest rather than flattering:** "flow" here is a **behavioural proxy for
sustained engagement**, not flow in Csikszentmihalyi's sense, which is self-reported and has no
validated log proxy (§5). Nobody ships an engagement-triggered quiz (§6), so this is a design
proposal with a logging plan (§11), not established practice.

## 1. Session boundaries: where the 20-minute gap comes from

The 30-minute convention is ubiquitous and much weaker than its ubiquity suggests; the only modern
re-examination puts the natural boundary lower, and **no learning-specific number exists at all** —
which the report must say.

| Finding | Source | Confidence |
|---|---|---|
| *"A session ends after a period of inactivity… The default timeout is 30 minutes but can be adjusted here."* Adobe Analytics defaults to the same 30-min visit timeout. | [Google, GA4 Help](https://support.google.com/analytics/answer/12131703); [Adobe](https://experienceleague.adobe.com/en/docs/analytics/components/metrics/visits) | VERIFIED / SECONDARY |
| **The provenance is 1995 arithmetic, not a fact about people.** Catledge & Pitkow instrumented NCSA XMosaic at Georgia Tech, measured a **mean inter-event gap of 9.3 min**, added **1.5 SD** to get **25.5 min**, and proposed that as the boundary; later *"smoothed out to 30 minutes"*. Nothing in it concerns learning, attention or memory. | Catledge & Pitkow, 1995, *Characterizing Browsing Strategies in the WWW*, **Computer Networks and ISDN Systems** 27(6), 1065–1073 ([abstract](https://www.sciencedirect.com/science/article/abs/pii/0169755295000437)) | **UNVERIFIED primary** (paywalled; the 9.3/1.5 SD/25.5 chain is corroborated by two secondaries — cite as "widely reported") |
| **The antimode — the quietest point in the gap distribution, the real boundary between "still here" and "came back" — sits at 15–20 min in every segment**, over a year of live traffic. Re-running the 1995 method on their own data gave *"six different answers"*. | [Ringside, 2025](https://www.ringside.ai/articles/30-minute-sessions/) | SECONDARY (vendor, not peer-reviewed; web traffic, not study behaviour) |
| **Learning platforms have no convention.** Published EDM session thresholds span **7.5, 15, 25, 30 and 40 min**, chosen per study; MOOC clickstream work takes 30 min or 1 h. PSLC DataShop's own definition could not be retrieved. Duolingo's unit is a *lesson*, not a gap. | Survey of EDM/MOOC methods sections; [Settles & Meeder, 2016, ACL](https://research.duolingo.com/papers/settles.acl16.pdf) | SECONDARY / **UNVERIFIED** (DataShop) |
| Nearest shipped analogue that measures *work* sessions: WakaTime buckets activity into one session while heartbeats are ≤ **15 min** apart (5–240 configurable). Slack (~10 min) and Discord (~5 min) idle timers are third-party figures only — **do not cite in the report**. | [WakaTime FAQ](https://wakatime.com/faq) | SECONDARY / UNVERIFIED |

**Conclusion — `GAP = 20 min`:** inside the only measured antimode band, below the unexamined
convention, above the longest plausible think-pause. Defensible as *"the low end of the industry
convention, moved to the antimode the one published re-examination reports"*, and an explicit A2
calibration target (§11) — exactly how `design-brief.md` §D3 treats the 45 s silence threshold.

## 2. The attention-span and Pomodoro claims — what survives scrutiny

The temptation is to set the session *length* from a study-timing number. **Don't.**

| Claim | What the evidence says | Source | Confidence |
|---|---|---|---|
| "Attention drops after 10–15 min of a lecture" | **Not supported.** The note-taking, observational, self-report and physiological evidence is weak; individual differences dominate. | Wilson & Korn, 2007, **Teaching of Psychology** 34(2) ([DOI](https://journals.sagepub.com/doi/10.1080/00986280701291291)) | VERIFIED |
| same | The most-cited origin *barely discusses attention at all*; teacher variance dwarfs any segment effect. | Bradbury, 2016, **Adv. Physiol. Educ.** 40(4), 509–513 ([DOI](https://journals.physiology.org/doi/abs/10.1152/advan.00109.2016)) | VERIFIED |
| Pomodoro 25/5 | Popular, thinly evidenced *for those numbers*: 32 studies (N ≈ 5,270), only **3 RCTs**. | 2026 scoping review ([PubMed 41107936](https://pubmed.ncbi.nlm.nih.gov/41107936/)) | SECONDARY |
| Short breaks generally | Brief diversions restore vigilance; micro-breaks (≤ 10 min) reliably cut fatigue and raise vigour, with weaker performance effects. | Ariga & Lleras, 2011, **Cognition** 118(3), 439–443 ([DOI](https://www.sciencedirect.com/science/article/abs/pii/S0010027710002994)); Albulescu et al., 2022, **PLOS ONE** ([OA](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0272460)) | VERIFIED |

**Two consequences, both worth a report sentence.** (1) **Impose no session length** — no 25-minute
cap, no break nudge on a fixed clock. (2) Bound the session by **observed behaviour**, which is
what #33 proposed. And because micro-breaks are restorative and cheap, closing after 20 min of
genuine absence costs the learner nothing — the resume path (§8.1) carries the continuity.

## 3. Retrieval-practice timing: when is a concept ready to be quizzed?

| Finding | Numbers | Source | Confidence |
|---|---|---|---|
| **The testing effect crosses over.** Prose passages; restudy 7 min vs a 7-min free-recall test **without feedback**; final recall at 5 min / 2 days / 1 week. | **5 min: restudy wins, 81 % vs 75 %** (d = 0.52). **2 days: testing wins, 68 % vs 54 %** (d = 0.95). **1 week: 56 % vs 42 %** (d = 0.83). Interaction F(2,117) = 32.10, ηp² = .35. Exp. 2 week-long forgetting: **SSSS 52 %, SSST 28 %, STTT 14 %**. | Roediger & Karpicke, 2006, **Psychological Science** 17(3), 249–255 ([PDF](https://colinallen.dnsalias.org/Readings/2006_Roediger_Karpicke_PsychSci.pdf)) | **VERIFIED primary** |
| **Feedback roughly doubles the effect.** 159 effects, 61 studies. | Overall **g = 0.50** [0.42, 0.58]; **with feedback g = 0.73** [0.61, 0.86] vs **0.39 without**; retention interval ≥ 1 day **g = 0.69** vs 0.41 below; **prose g = 0.58** [0.34, 0.82]. | Rowland, 2014, **Psychological Bulletin** 140(6), 1432–1463 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/25150680/)) | **VERIFIED primary** |
| **Delaying the first retrieval helps — for word pairs.** First test after 0 vs 5 intervening items (~42 s). | Initial accuracy fell 97 % → 72 % and slowed 2,521 → 3,247 ms, but **at 2 days delayed won, 52 % vs 44 %** (d = 0.35; single-test 39 % vs 21 %). | Karpicke & Roediger, 2007, **JEP:LMC** 33(4), 704–719 ([PDF](https://learninglab.psych.purdue.edu/downloads/2007/2007_Karpicke_Roediger_JEPLMC.pdf)) | **VERIFIED primary** |
| **…and hurts for prose — the closer analogue to ChatterED's task.** Same paper, pp. 717–718. | A free-recall test taken **relatively immediately** after studying a passage promoted long-term retention **more** than a first test delayed by 10 min; prose recall does not draw on primary memory and is *"inherently difficult enough… and need not be delayed."* Optimal delay *"awaits future research."* | *ibid.* | **VERIFIED primary** |
| **No lag effect across the literature.** Initial-test-lag meta-regression. | Slope 0.00015, CI [−0.00017, 0.00046], **Z = 0.91, n.s.** | Rowland, 2014 (above) | **VERIFIED primary** |
| **No applied minimum exists.** | Only that tests *"in immediate succession within a session"* show minimal effects; the one quantitative rule (10–20 % of the retention interval) governs the gap *between* sessions. | Dunlosky, Rawson, Marsh, Nathan & Willingham, 2013, **PSPI** 14(1), 4–58 ([PDF](https://acs.ist.psu.edu/ist521/dunloskyRMNW13.pdf)) | **VERIFIED primary** |
| **Spacing prefers a day, not an hour.** 839 assessments / 317 experiments; and the ridgeline study (> 1,350 participants). | Spaced **47.3 %** vs massed **36.7 %**; *"learning within a single day impaired learning, compared with a 1-day interval."* Optimal gaps **1, 11, 21, 21 days** for retention intervals of **7, 35, 70, 350 days**; at a 7-day interval the optimal gap bought only **10 %**. | Cepeda et al., 2006, **Psych. Bulletin** 132(3), 354–380 ([PDF](https://augmentingcognition.com/assets/Cepeda2006.pdf)); Cepeda et al., 2008, **Psych. Science** 19(11), 1095–1102 ([PDF](https://files.eric.ed.gov/fulltext/ED505660.pdf)) | **VERIFIED primary** |

**Four things this settles.**

1. **The payoff is delayed.** The Tester will feel less useful than the Teacher in the moment —
   at 5 min restudy actually wins. Say so in the copy and in the report rather than promising an
   immediate gain the evidence denies.
2. **Feedback after every answer is mandatory, not optional** (g = 0.73 vs 0.39). This is the
   best-evidenced constraint in the brief and #33 does not mention it. The ledger already produces
   the material; the Tester must voice it.
3. **`MIN_AGE` cannot be justified by retrieval evidence and must not be raised.** For prose the
   only direct result runs the other way. Keep #33's **3 min**, but re-label it: a **UI guard**
   against quizzing the sentence still being read, in the same family as `timer.ts`'s keystroke
   rule. Do **not** raise it to 10 min on Anki's learning steps — Anki schedules repeat exposures
   of the same card, a different operation from a first explain-back. Carrying no theoretical load,
   it is safe to tune from A1 data (§11) and cheap to set to zero if R4 does the whole job.
4. **The reopen quiz is the stronger half of the mechanism** — and ChatterED's horizon caps it at
   hours, below the one-day spacing the literature prefers. **Report this as a limitation:** the
   within-session hand-off is defensible as *the first retrieval attempt*, not as spaced practice.

## 4. Decay: the half-life and the horizon

**The 2 h half-life does not survive and should be dropped as a memory claim.**

| Finding | Numbers | Source | Confidence |
|---|---|---|---|
| Ebbinghaus replication, 70 lists × 104 CVC **nonsense syllables**, savings method. Power fit R² = 98.7 %. The curve is **non-monotonic** — 1-day savings exceed 9-hour savings in three of four datasets, plausibly a sleep effect. | Savings **0.472 @ 20 min, 0.373 @ 1 h, 0.276 @ 9 h, 0.317 @ 1 day, 0.230 @ 2 days, 0.041 @ 31 days**. | Murre & Dros, 2015, **PLOS ONE** 10(7), e0120644 ([OA](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644)) | **VERIFIED primary** |
| **Meaningful prose decays far more slowly**; the anchor is R&K 2006's own restudy arm. | **81 % @ 5 min → 54 % @ 2 days → 42 % @ 1 week** — a half-life of **days**, and longer once retrieval practice is added (STTT lost 14 % in a week). | Roediger & Karpicke, 2006 (§3) | **VERIFIED primary** |
| Course knowledge slower still. | ~70 % retained at one year is the modal figure across studies. | Custers, 2010, **Adv Health Sci Educ** 15, 109–128 | SECONDARY |
| Shipped exponential decay with a fitted half-life. | `p̂ = 2^(−Δ/ĥ)`; half-life **clamped to [15 min, 9 months]**; 12.9 M traces; MAE 0.128 vs Leitner 0.235; **+12 % daily engagement**. The 15-min floor is a model clamp, **not** a scheduler rule and **not** evidence for a minimum quiz age. | Settles & Meeder, 2016, **ACL** ([paper](https://aclanthology.org/P16-1174/)) | **VERIFIED primary** |

**Even nonsense syllables decay slower than a 2 h half-life.** The popular "70 % lost in 24 hours"
figure traces only to vendor blogs and nonsense-syllable data — **do not cite it**.

**So what is the 6 h horizon actually about?** Re-read the framing: *"a user is not expected to
remember a **convo** more than 6 hours old."* That is **episodic memory of the exchange** — who
said what, where on the page, what was being argued — not retention of the concept. It is the right
constraint for this product and it has nothing to do with forgetting curves. **Keep 6 h and
re-justify it as a conversational-context bound.** State the trade openly: memory would permit
quizzing days later, and ChatterED deliberately under-quizzes, because a question about a
conversation the learner cannot reconstruct is worse than no question.

**The half-life survives demoted.** Keep an exponential freshness score used **only to rank**
candidate elements (§8.2), never to exclude one, at `RECENCY_HALF_LIFE = 60 min`. As a ranking
weight it needs no memory evidence; as a retention estimate it would need evidence that does not
exist.

## 5. Flow state and its proxies in interaction logs

**Say plainly in the report: ChatterED does not measure flow.**

| Finding | Source | Confidence |
|---|---|---|
| Flow's conditions — clear goals, immediate feedback, challenge–skill balance, merged action and awareness, lost self-consciousness, distorted time, control, autotelic quality — are phenomenological and canonically measured by **self-report** (ESM, Flow State Scale). **There is no validated behavioural-log proxy for flow.** | Csikszentmihalyi, 1990, *Flow*, Harper & Row; Nakamura & Csikszentmihalyi, 2002, in **Handbook of Positive Psychology**, OUP, 89–105 ([PDF](https://nuovoeutile.it/wp-content/uploads/2015/12/2002-Flow.pdf)) | SECONDARY (list is textbook-standard; primary chapter not read) |
| **Sensor-free** detectors of boredom, confusion, frustration and **"engaged concentration"** built from log features alone (response times, error rates, hint use) in Cognitive Tutor Algebra; a gaming-the-system detector's intervention roughly halves subsequent gaming. | Baker et al. ([overview](https://www.globallearningcouncil.org/posts/gaming-the-system-affect-detectors-and-student-persistence-and-learning-in-computer-based-learning-environments/); [detector PDF](https://learninganalytics.upenn.edu/ryanbaker/AIED-D-13-00017_Revised%20v2.pdf)) | SECONDARY |
| **Impasse is not disengagement:** engagement → **confusion** on impasse → back to flow if resolved, or → frustration → boredom if not. | D'Mello & Graesser, 2012, **Learning and Instruction** 22(2), 145–157 ([DOI](https://www.sciencedirect.com/science/article/abs/pii/S0959475211000806)) | SECONDARY (abstract only) |
| The clearest shipped threshold in this space: **wheel-spinning**, practising one skill > ~10 times without mastering it. | Beck & Gong, 2013, **AIED 2013**, LNCS 7926 ([DOI](https://link.springer.com/chapter/10.1007/978-3-642-39112-5_44)) | SECONDARY — check the ">10" against the primary before quoting it |
| **Pause length**: inter-action interval is a standard detector *feature*, but **no published threshold was found**. | — | **UNVERIFIED** |

**What this licenses, and what it does not.** A "k turns in m minutes" rule is an **engagement
heuristic from a different tradition**. Calling it flow detection in an A1 report is an unearned
claim; calling it *"a behavioural proxy for sustained engagement, named 'flow' after the developer's
framing and explicitly not validated as such"* is honest and costs nothing. What Baker's line **does**
license is the *move* — an engagement state inferred from timing features and used to trigger an
intervention. That is §8.2's warrant.

**And a hard constraint: a long pause is ambiguous.** The silence timer already encodes this by
treating *keystrokes*, not messages, as activity (`design-brief.md` §D3: *"it distinguishes thinking
from disengaging, which is the whole point of the timer"*). The flow rule must inherit it, or it
will quiz a learner mid-sentence — and quizzing into an impasse is D'Mello's path to frustration.

**So k and m are a designer's choice, and the brief says so.** No source gives a k-in-m rule for
learning; WakaTime's 15-minute window is the nearest analogue and is a gap, not a count. The
defence is structural: the window must be short enough that the question still concerns what the
learner was just doing, long enough to survive one long thinking pause, and strictly inside the
20 min gap or it could outlive its session. **m = GAP/2 = 10**; **k = 3** is the smallest count that
distinguishes a conversation from a single question.

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
trigger type:** *"The events that trigger a contribution from the AI agent should be controllable…
The agent can also be triggered by the activity or inactivity of the group, such as rapid
contributions or a long pause"* (§7.2.1). That is the flow rule and the silence timer, and Koala
says the learner should be able to move both.

**Correct #33 on what Koala actually shipped.** Not a "quiet / normal / eager" slider: Koala scored
each candidate reply **0–100** for its value as a contribution and posted only above a threshold,
exposed as **high = 90, medium = 75, low = 50** (§5, Fig. 5b), plus a proactive/reactive toggle
where reactive *"only replied to users when directly addressed"* (Fig. 5a). ChatterED's three
levels should therefore be **reactive** (Tester speaks only when invoked) / **normal** / **eager**,
implemented as the R1–R3 thresholds, not as three prompts. Koala II was then perceived as *"quieter
and less invasive"* and better paced (§6.2.1).

**Rate should track the learner's rate.** Koala's own prompt has it *"contribute at approximately
the frequency of other users"*, and P2.1 asked it to *"automatically adjust the rate of its
messages to match those of the group"* (§7.2.1). k-in-m **is** a rate-matching rule.

**Therefore show the taught set — #33's question (c) is yes.** Koala's complaints were about
*unpredictability*; P6.2 wanted the agent to *"ask for permission"* rather than jump in (§7.2.1). A
Tester firing on an invisible rule is unpredictable by construction; a visible "what Max can ask
you about" list with a freshness cue turns the rule into an affordance and makes declining
meaningful. Cost: one collapsible strip in the top bar.

*Source: `Academia/Sources/_text/koala-2501.17258.txt` (Houde et al., arXiv:2501.17258), §5,
§6.2.1, §7.2.1, Figs. 5 and 7.*

## 8. The recommended definition

### 8.1 A flow session — open and close rules

> **A flow session is a contiguous span of engaged work in one document, opened by the learner's
> first meaningful action and closed by absence, not by duration.**

**Opens** on the first *learner-authored* action in a document — a turn, a split, an Ask, a whisper.
**Opening the document is not enough**: a session opening on `document.open` fills the §11 gap
distribution with one-action sessions.

**Closes** on the first of: (1) **`GAP = 20 min` with no learner activity**, where activity means
keystrokes in any composer as well as turns, splits and page changes — the `timer.ts` definition
inherited verbatim, so typing pauses the clock; (2) **explicit "End session"**, always available —
the learner-controlled edge of an otherwise automatic mechanism (§7); (3) **sleep, quit or crash
past the gap**, using `timer.ts`'s pattern exactly: an absolute deadline persisted *before* anything
is armed and compared against wall-clock on a 1 s tick (*"the row is the timer"*), because a session
must not depend on a `setTimeout` that never fired; (4) **switching documents**, if sessions stay
document-scoped (§12 q. 4).

**Stored** as a `flow_sessions` row: `id`, `document_id`, `scope`, `opened_at`, `closed_at`,
`close_reason`, `config_hash`, and the ordered anchors touched.

**Resume vs. reopen.** Returning **inside** the gap re-enters the open session — no greeting, no
recap. Returning **after** it opens a new one, and the Teacher offers a retrieval prompt on the
previous session's still-fresh items *only* if any survive the horizon; otherwise one line on what
was covered. A 90-second coffee break must cost nothing.

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
| **R3 — maturity** | the youngest quizzable element is older than `MIN_AGE` | **3 min** (as #33 proposed) | §3.2, **with a new justification**: a UI guard against quizzing the sentence still being read, *not* a retrieval-practice delay. Karpicke & Roediger found immediate testing better than a 10-min delay for **prose**, so do not raise it. |
| **R4 — clear floor** | no unanswered Teacher question pending, no silence-timer window open, no whisper popover open, composer idle ≥ 3 s | — | §5's ambiguity finding. Quizzing into an impasse is the D'Mello path from confusion to frustration; quizzing mid-keystroke is the failure `design-brief.md` §D3 built the keystroke rule to prevent. |

**Which element the Tester picks.** Among elements passing R3 and inside the horizon, prefer
**highest freshness × lowest ledger level** — most recently taught, least demonstrated. Reuses the
existing level → probe-type policy (`progress-tracking.md` §5) rather than adding a second one.

**The hand-off is an offer.** *"You've covered X and Y — Max, want to take it?"* A decline sets a
**cool-down of one full `m` window** and is logged (§11); three declines in a session drop the
Tester to *reactive* for the rest of it, said once. That is the Koala control expressed as
behaviour rather than as a settings panel (§7.2.1: *"ask for permission"*). **Every answer gets
feedback** (§3, constraint 2).

### 8.3 The constants, with a citation each

All live in one file, `src/room/flow.ts`, unit-tested on a fake clock like `timer.ts`.

| Constant | Value | Status | Basis |
|---|---|---|---|
| `GAP` — inactivity that closes a session | **20 min** | **Evidence-informed** | The only published re-examination of the 30-min convention puts the natural antimode at **15–20 min** ([Ringside 2025](https://www.ringside.ai/articles/30-minute-sessions/), SECONDARY); the convention itself is Catledge & Pitkow's 9.3 min + 1.5 SD = 25.5 min, later rounded (1995, *Comp. Networks & ISDN Systems* 27(6), UNVERIFIED primary). GA4 default 30 min ([Google](https://support.google.com/analytics/answer/12131703), VERIFIED); WakaTime 15 min ([FAQ](https://wakatime.com/faq), SECONDARY). No learning-specific number exists (§1). |
| `MIN_AGE` — youngest quizzable element | **3 min** | **Designer's choice — no evidence supports any number** | §3.2. Karpicke & Roediger 2007 pp. 717–718: for **prose**, immediate testing beat a 10-min delayed first test ([PDF](https://learninglab.psych.purdue.edu/downloads/2007/2007_Karpicke_Roediger_JEPLMC.pdf), VERIFIED). Rowland 2014's lag meta-regression: n.s. ([PubMed](https://pubmed.ncbi.nlm.nih.gov/25150680/), VERIFIED). Justified as a UI guard only. |
| `RECENCY_HALF_LIFE` — freshness **ranking** weight | **60 min** | **Ranking weight, not a memory estimate** | §4. Exponential-in-time recall with a fitted half-life is shipped practice (Settles & Meeder 2016, [ACL](https://aclanthology.org/P16-1174/), VERIFIED), but **a 2 h half-life for conceptual material has no support**: even nonsense syllables retain 0.276 savings at 9 h (Murre & Dros 2015, [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644), VERIFIED), and meaningful prose has a half-life in **days** (R&K 2006 restudy arm: 81 % → 54 % → 42 %). Used only to order candidates; **never to exclude one**. |
| `HORIZON` — quizzable window | **the open session, plus the immediately preceding session if it closed < 6 h ago** | **Product constraint, re-justified** | §4. **Not** a decay constant. It encodes Lucas's framing — *"a user is not expected to remember a **convo** more than 6 hours old"* — which is about episodic memory of the exchange, not retention of the concept. Memory would permit days (Custers 2010; Cepeda et al. 2006 prefers ≥ 1 day between episodes, [PDF](https://augmentingcognition.com/assets/Cepeda2006.pdf), VERIFIED). ChatterED deliberately under-quizzes; the report should say so as a limitation. |
| `k`, `m` — engagement window | **3 turns / 10 min** | **Designer's choice** | §5. No source gives a k-in-m rule for learning; flow has no validated log proxy. Structural defence only: m = GAP/2 so the window cannot outlive its session; k = 3 is the smallest count distinguishing a conversation from a question. |
| `MIN_TAUGHT` — coverage floor | **2 elements** | **Design argument** | §8.2 R2. One element is a comprehension check, not retrieval practice (#33's own objection). |
| `DECLINE_COOLDOWN` / `DECLINES_TO_REACTIVE` | **1 × m** / **3** | **Designer's choice, Koala-shaped** | §7.2.1: triggers and rate must be learner-controllable; P6.2 wanted the agent to *"ask for permission"*. |
| **Feedback after every quiz answer** | **required, not optional** | **Strongest cited constraint in the brief** | Rowland 2014: **g = 0.73 with feedback vs 0.39 without** ([PubMed](https://pubmed.ncbi.nlm.nih.gov/25150680/), VERIFIED). A Tester that asks and moves on discards roughly half the effect. The ledger already produces the material; the Tester must voice it. |

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

1. **(#33a) Is 20 min right?** *Yes as a default, for a reason the issue did not have* (§1: the
   15–20 min antimode). Nothing irreversible happens at a close except whisper clearing, so ship 20
   and tune from `flow.idle.tick`. **Decide: is the gap a visible setting?**
2. **(#33b) May the Tester fire without the Teacher's hand-off, purely on time?** *No for A1* (§5:
   a blind clock interrupts impasses; it is also Koala's unpredictability complaint). **But this is
   your call** — the counter is that a stingy Teacher means the Tester never fires.
3. **(#33c) Does the learner see the taught set and freshness?** *Yes* (§7). **Decide how
   prominent: a collapsed chip in the top bar, or a rail like the ledger?**
4. **(#33d) Per document or per topic folder?** *Per document for A1* — the payload is "segments
   touched" and segments are document-scoped — with a `scope` field so folder scope is a one-line
   change. **Confirm.**
5. **New: may the Tester quiz across documents in one session?** Cross-document retrieval is better
   practice (interleaving) but a worse fit for an in-document surface, which has nowhere to put a
   question about a page the learner is not looking at.
6. **New: what happens to an unanswered Tester question at close?** Recommend **expires, logged**.
   A quiz that greets you next session is a debt, and `design-brief.md` §E's psychological-safety
   goal argues against debts.
7. **New: does re-teaching reset `taught_at` or append?** Recommend **append, use the most recent
   for the window** — one extra row, and it lets A2 fit a real spacing curve rather than a recency
   window.
