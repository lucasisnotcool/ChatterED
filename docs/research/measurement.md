# Measuring the outcome: what the bar cannot tell you, and what to measure instead

**Status.** Decision brief, 21 Sep 2026. Written after Lucas read Step 2 of the report draft and
said the outcome measurement was not precise enough to carry the build into A2. It is. This file
says why, defines the measures that replace it, and sets the gates each one has to pass before a
number from it is reported.

**Decisions taken here** (Lucas, 21 Sep): the A2 **primary outcome is persistence behaviour, not
the progress bar**; the bar is validated before it is believed; the A1 transcript corpus becomes
the comparison baseline, recoded with the same codebook.

**Read alongside.** `collab-doc.md` §6 (the bar as designed), `progress-tracking.md` §8 (the
validation protocol this brief revives and rescopes), `ai-use-transcripts/analysis/convergence.md`
and `codebook.md` (the baseline and the instrument), `interviews/findings.md`,
`evaluation-plan.md` (rewritten against this brief).

---

## 1. The problem in one line

**Step 1 names a difficulty about persistence. Step 2 measured correctness.** Those are different
constructs, so nothing in the design as it stood could tell whether the thing that got built fixed
the thing that got found. Everything below follows from closing that gap.

## 2. Five faults in the measurement as it stood

### F1. The learning goal has two clauses and the measure had one

The goal is *"answer a question about the lecture in their own words, **and revise that answer
after feedback**."* `progressFill` in `src/shared/doc/progress.ts` returns the **best** verdict, by
design and with a comment defending it. So a learner who is right first try and a learner who goes
*Partly there*, revises, and earns *Well done* produce an identical bar.

The second learner is the whole point. In the six baseline sessions, **0 of 17 attempts was a
second try at the same question**, and **17 of 21 feedback turns carried the next question in the
same message**. Revision is the behaviour the data says is missing, the behaviour `rule:quiz_feedback`
and the one-open-question rule exist to create, and it was invisible to the only outcome measure
the design had.

### F2. The instrument is the failure mode

The bar is computed from Max's verdicts. Max is a model judging learner work. In the one baseline
session where a learner produced work to judge, **the AI's verdict was wrong 11 times in 21, 9 of
them marking a correct answer wrong** (`analysis/findings.md`; every one refuted by execution in
`scripts/verify_r6_sql.py`, and all 15 executed checks in `r6-sql-checks.json` refuted the AI's
claim). The report names this as N3 and then built its outcome measure on the same class of
judgement.

It is worse here than in a chat. A wrong verdict in ChatGPT scrolls away. A wrong verdict in
ChatterED writes to a persistent bar **and** into the document under the Q block.

`progress-tracking.md` §8.3 already had the right protocol. It was written for the retired concept
pack, so nothing carried it forward. §4 below revives it against the current object.

### F3. "In their own words" was never operationalised, and the pivot made it cheaper to fake

The notes are AI-written and sit on screen, directly above the Q block. Ellie's cue is *designed*
to be improved on. Nothing in the design distinguished a learner's own formulation from a
paraphrase of the paragraph two inches up, or from Ellie's words. If an answer is mostly Ellie's,
DG1 produced echo and the bar filled anyway.

The baseline already measures this: `metrics.json` carries `lexical_uptake.share_in_prev_ai` per
turn, computed by `scripts/metrics.py`. The same measure applies here against a richer set of
sources.

### F4. The denominator was unvalidated

The bar reads `completed / total`, where total is a Sonnet ingest producing 6 to 20 objectives per
deck (`learning-objectives.md` §3), minus `assumedByDeck` nodes. Nobody has checked that two
ingests of the same deck agree, or that a lecturer would recognise the objectives as the deck's.
`progress-tracking.md` §8.4 already concedes the general form of this: *"five elements are the
researcher's decomposition of the concept, not a canonical one."* A percentage over an unstable
denominator is not a measure.

### F5. `evaluation-plan.md` was testing features that no longer exist

v1 of that plan (13 Sep) is built on three manipulations: Group vs Single, Whisper on/off, and
latency. The whisper popover was superseded by private threads (#48 §9), Theo was dropped (#32),
latency became the reading-time silence threshold, and the roster argument changed. H2a to H2d and
H5a to H5b test surfaces that are gone. So after the pivot the **only live outcome measure in the
repo was the progress bar**, carrying F1 to F4. That is the real answer to Lucas's worry, and it
is why §6 rewrites that file rather than patching it.

## 3. The baseline, recomputed

All 152 turns of `coding-final.jsonl`, recomputed 21 Sep. Reliability from `agreement.json`:
κ = .90 to 1.00 on every dimension used below, except FIDELITY (.68) and SCOPE (.57). Nothing here
leans on SCOPE.

| | Count | Share |
|---|---|---|
| Learner turns | 76 | |
| AI turns | 76 | |
| **Directing production** (`PRODUCE` + `REVISE` + `CONTROL` + `BARE`) | **32** | **42%** |
| Asking (`EXPLAIN` + `DEFINE`) | 23 | 30% |
| Own work (`ATTEMPT`) | 21 | 28%, all in R6 |
| ICAP `CONSTRUCTIVE` + `INTERACTIVE` | 24 | 32%, all in R6 |
| `OWN` = Y | 24 | 32%, all in R6 |
| `VERIFY` = `CONTENT` | 5 | 7% of learner turns |
| AI turns with a fidelity problem | 29 | 38% (ERROR 17, CONTRADICT 6, UNVERIFIABLE 4, OMIT 2) |
| `A-MOVE` = `ELICIT` | 10 | 13%, all in R6 |
| `ENDQ` = Y | 29 | 38%, all in R6 |
| `ANSWERS-TASK` = Y | 33 | 43% |
| `EXAMFRAME` = Y | 10 | 13%, 9 of them in R2 |

Four readings that matter for measurement, and are not yet used in the report:

1. **In five of six sessions the AI never once asked a question the learner had to think to
   answer.** `ELICIT` 0 and `ENDQ` 0 across 31 AI turns in R1 to R5. Cleaner than the ICAP phrasing
   because it locates the cause in the AI's move, not the learner's disposition.
2. **Persistence is redirected, not reduced.** 42% of learner turns manage the production of an
   artefact; 28% contain the learner's own work, and all of those are one session. R4 is the pure
   case: **10 of 10 learner turns are production management, no domain question, no own content.**
   This is the quantitative form of the abstract's claim, and it is a better framing than "reduced
   persistence" because it is measurable in both settings.
3. **One content check per six visible problems.** 5 `VERIFY=CONTENT` turns against 29 AI turns
   with a fidelity problem. Stronger than the per-session counts currently in the report, and it
   is the number that justifies both DG3 and §5.3's dispute control.
4. **The whole attempt-and-feedback evidence base is one person.** Every `ATTEMPT`, every
   `CONSTRUCTIVE` turn, every `ELICIT`, and the 11-of-21 verdict error rate come from R6. Every
   rule about attempts, releases, verdicts and bundling generalises from a single session. This is
   the single strongest argument for the participant round in §6.

## 4. The measures

Five, each with its definition, its source, and the gate it must pass. All are computed from
recorded turns. None asks a model how the session went.

### M1. Fill (kept, unchanged)

`progressFill`: *Well done* completes an objective, *Partly there* half-fills it, best verdict
wins, releases and agreement fill nothing. Unchanged from `collab-doc.md` §6. It answers the
first clause of the goal and it is the learner-facing number.

*Gate:* M4. Below the κ threshold it is a display and no number derived from it is reported.

### M2. Revision rate (new)

Of the Max questions that received a *Partly there* or *Not yet* verdict, the share where the
learner answered **the same question again** before any new Max question opened. Computed from
`quiz_outcomes` plus message order; needs a `revised` outcome kind so the second attempt is
recorded as a revision rather than as another verdict.

*Baseline:* 0 of 17 (R6). *Why it is the headline:* it is the second clause of the learning goal,
it is the behaviour the baseline never produced, and unlike fill it cannot be satisfied by getting
it right the first time.

*Gate:* M4 for the verdicts it counts; the rate itself is arithmetic on logged events.

### M3. Own-words index (new)

For each learner answer, the share of its content words (stopworded, lemmatised) that also appear
in:

- **a.** the anchored note block and its immediate neighbours,
- **b.** Ellie's cue on that question, if one fired,
- **c.** Max's question.

Reuses `scripts/metrics.py`'s `lexical_uptake`. Reported as three numbers, not one, because they
mean different things: (a) is reading the notes back, (b) is echoing the peer, (c) is restating
the prompt.

*Why:* the design's own counterweight for an AI-written document is that the bar moves only on the
learner's words. That guarantee is empty unless "their words" is checked.

*Limits, stated wherever it is reported:* it is lexical, not semantic. A good paraphrase reads as
the learner's own, and correct technical vocabulary will always overlap. So it is **a flag, not a
gate**: high (b) on a question is a signal to look at the turn, not grounds to withhold a fill.
A semantic version (embedding similarity) is a later refinement and is not needed for A2.

### M4. Verdict agreement (the gate on M1 and M2)

The researcher blind hand-scores **20% of verdicts** from the transcript and the objective's
criteria, without seeing Max's verdict. Report exact agreement and **quadratic weighted κ** over
the ordinal {not yet, partly there, well done}.

**Pre-set threshold κ ≥ .60.** Below it, the bar is reported as a user-interface feature only and
every bar-derived number is struck from the analysis. This is `progress-tracking.md` §8.3 rule 2,
rescoped from ledger levels to verdicts.

Report the failure modes whatever the number says: false-negative rate (the R6 failure, 9 of 11),
parse failures, and the rate at which a verdict is later contradicted by the learner's dispute
(§5.3).

### M5. Objective-set stability (the gate on the denominator)

Re-ingest the same deck k = 5 times at the same prompt version. Report:

- **Set stability:** mean pairwise Jaccard over normalised objective titles.
- **Count spread:** min, median, max objective count.
- **Faithfulness:** one human (a coursemate, or the lecturer if willing) rates 20 sampled
  objectives against the deck on "is this taught by these slides" and "would you set a question on
  it". Report the agreement rate.

*Pre-set:* below Jaccard .70, the bar is reported as *objectives completed*, an absolute count,
never as a percentage, because the denominator is not reproducible.

### Carried over from Step 1, unchanged

`ATTEMPT` share, ICAP mix, `OWN` rate, `VERIFY=CONTENT` rate and the AI-to-learner word ratio, all
under codebook v1.3. These are the A2 primary outcomes (§6). Their value is that they were
measured on general-purpose chat first, at κ .90 to 1.00, so the comparison is within one
instrument rather than across two.

### Sustained-attempt rate

`ATTEMPT` turns ÷ (`ATTEMPT` + `give_up`) on open Max questions. The direct operationalisation of
the named difficulty, computable in both settings: in the baseline from the codes, in ChatterED
from `classifyLearnerTurn`'s output. **This is the A2 primary outcome.**

## 5. What the build has to change

Small, and all of it is needed before any round-2 session can be measured.

### 5.1 An attempt index on every verdict  ·  **landed 21 Sep**

`QuizOutcome` gains `attemptIndex`: which attempt at that question the verdict marked, 1-based
(migration 022). **A verdict with `attemptIndex ≥ 2` is a revision**, and `revisionStats` in
`shared/doc/progress.ts` is the pure function over it.

This is a column rather than a new `kind`, which is what an earlier draft of this brief proposed.
A new kind would have to be skipped by `progressFill` (it reads `kind !== 'verdict'` and moves on),
and then a revision that earned *Well done* would fill nothing — the design would punish exactly
the behaviour it is trying to produce. `progressFill` is therefore untouched: fill stays
best-verdict, revision is reported beside it, never folded into it.

Counted per question, not per verdict, so four attempts at one question is one recovery.
`eligible` counts only verdicts that left something to revise (*Partly there*, *Not yet*), and the
rate is `null` when nothing was eligible: a learner who was right every time has no revision rate,
and 0 would read as a failure.

### 5.2 Own-words logging at verdict time  ·  **landed 21 Sep**

`shared/doc/ownwords.ts`, pure and model-free: content words, a crude stem, and the share of an
answer's words that also appear in each source. The three shares are computed when the verdict is
recorded and stored on the row (migration 022). `null` means *not measured here* — no cue fired,
no anchored block, an answer with no content words — which is not the same as 0.0, and the
distinction matters because 0 reads as "entirely the learner's own".

### 5.3 A dispute control on a verdict  ·  **not landed, and not cheap**

Listed here with the other two, but it is a feature, not a column: it needs a turn class, a rule,
a prompt directive, an outcome correction path and a UI affordance. It is specified below and left
for the A2 build rather than half-landed, because a dispute the learner can type but that no rule
answers would be worse than none.

`analysis/findings.md` already recommends it: *"Letting the learner challenge an answer is a useful
move to support in the product."* It was dropped in the pivot. Restore it, because it is three
things at once:

- a **DG3 feature**: trust is calibrated only when a judgement can be contested (Lee & See, 2004);
- an answer to the convergence §4.4 discrepancy, that learners do not notice AI errors, by making
  noticing cost one click instead of a rebuttal;
- **free validation data for M4**: every dispute is a labelled verdict.

The rule on a dispute mirrors `rule:quiz_clarify`: Max re-grounds the verdict against the slide and
either holds or reverses it, and a reversal is logged as a verdict error. It never lowers a fill
that was already earned.

## 6. Round 2

Four phases. A, B and D need no participants.

**Phase A. Instrument validation, self-run.** M4 on replayed sessions over the Week 4 deck; M5 over
five re-ingests; M3 computed retrospectively on those sessions. Output: three numbers and their
gates, reportable on their own. This is the phase that decides whether the bar is allowed into the
A2 analysis at all.

**Phase B. Pipeline dry run.** The app exports session transcripts in the shape of
`processed/R*.json`. Lucas codes two self-run sessions under codebook v1.3 and records where it
breaks. It will break: `BARE` is meaningless with no screenshots, and there is no code for
*the learner wrote a sentence into the document*, which is a first-class act in this design and has
no analogue in a chat. Output: **codebook v2.0** with a doc-side act set, and the v1.3 codes
carried unchanged so the baseline stays comparable.

**Phase C. Participant round.** 6 to 8 students, one deck, about 40 minutes, think-aloud, within
subjects on rails-on / rails-off (a config flag: the rules are code, the model writes the words,
so the control condition is the same model with the orchestrator bypassed). Primary:
sustained-attempt rate and revision rate. Secondary: M3. Exploratory: mistake inheritance (§8.3)
and dispute rate. This round exists mainly to stop the design generalising from R6 alone.

**Phase D. Rewrite `evaluation-plan.md`** against this brief. The three dead manipulations are
replaced by three live ones:

| Contrast | What it tests | Why it is the right three |
|---|---|---|
| Rails on / off | The whole orchestrator claim: that a contract beats a prompt | Cheap (a flag), and it is Step 3's central assertion |
| Ellie's cue on / off | DG1, the one genuinely novel mechanic | Nothing in the literature covers a peer whose partial take may be wrong on purpose |
| Release on give-up / withhold | The brief's own named open question (`collab-doc.md` §1) | Already called "A2's first test" with no measure attached; §4 now gives it one |

## 7. What this does not fix

Stated so the next reader does not mistake the list in §4 for completeness.

1. **Process measures are not learning.** Xu et al. found **no** objective learning-outcome
   differences across four agent roles at n = 96. This project optimises process and should say so
   plainly rather than letting a filling bar imply a retention claim. If a learning claim is ever
   wanted, it needs a delayed test, not a better bar.
2. **M3 rewards articulacy, and so does M1.** `progress-tracking.md` §8.4 already flagged it; the
   interviews make it sharper, because 3 of 3 participants report help pitched above them. The
   learner the project exists for is the one most likely to understand and express it badly. Report
   coverage against a self-rated fluency item, and treat "say it again, shorter" as a design answer
   rather than a scoring one.
3. **n is still small and the corpus is still one-sided.** Six sessions, 59% of turns from one;
   three interviews, all final-year, two from computing.

## 8. Assumptions this brief puts on the record

Not to resolve today. To stop them being invisible.

1. **The AI-written doc is treated as a limitation. It may be the central risk.** Three of six
   sessions opened by asking for notes, and the interviewee whose whole workflow that is reports
   notes so long she knows in advance she will not finish them. ChatterED ships a better version of
   the artefact she already abandons. The counterweight, that the bar fills only on her words, is a
   scoreboard, not a mechanism: it does not make the attempt feel necessary while a complete,
   fluent answer sits on the page. **Testable cheaply:** an ingest variant that leaves each
   objective's key claim as an open blank with provenance, compared on attempt rate.
2. **Release-on-give-up is unevidenced in both directions.** The interview question that would bear
   on it was not asked (`interviews/findings.md` §4, row 6). The baseline failure is that all 7
   answer requests were granted in full; the design keeps "always grant" and bets the lowered next
   question does the work. **Give it a measure:** does a give-up at *t* predict a give-up at *t+1*
   on the same objective, or a recovery?
3. **Song et al. does not cover Ellie's deliberate mistake.** That citation is about agent count and
   normative pressure. A peer who is wrong on purpose, inside a tool whose other job is to be
   trusted for notes, is a different risk, and the interviews say none of the three participants
   ever checks the AI. The learner most likely to be helped by a peer's wrong guess is the least
   likely to catch it. **Mistake inheritance** is therefore a required instrument, and nearly free:
   the cue already records `hasMistake` and the claim, so the check is whether the claim appears in
   the learner's next answer. If it does, the closure rule repaired the transcript and not the
   learner.
4. **Layered disclosure is still missing.** `interviews/findings.md` §5 rated it "new, and worth
   having"; it is the only direct answer to "too long" (3 of 3) for the **notes**, since only chat
   turns are sized. Its usage log is also a better pitch input than verdicts alone, because it is
   revealed preference rather than inferred level.
5. **Ownership is measurable and is not being measured.** The ProseMirror schema already carries a
   per-span author mark. "What share of this document is the learner's words" is therefore free,
   needs no model, and speaks directly to the departure §1 of `collab-doc.md` admits. It is the
   most robust number this app can produce about itself.

## 9. What this supersedes

| Older text | Status |
|---|---|
| `progress-tracking.md` §8.2 derived measures (coverage curve, time-to-level-2, gate counts) | **Superseded as the study's measure set** by §4. The ledger export stays; it is no longer the outcome. |
| `progress-tracking.md` §8.3 | **Revived and rescoped**, from ledger levels to Max's verdicts (§4, M4). |
| `evaluation-plan.md` §1 to §3 and §6.2 (Group/Single, Whisper, latency, Theo, the whisper and group codes) | **Superseded** by §6 Phase D. The instruments in §5 of that file and the coding procedure in §6.5 survive. |
| `collab-doc.md` §6 as the complete account of progress | **Extended**, not replaced: fill is unchanged, and M2, M3 join it. |
| `docs/report/assignment1-draft.md` §2.1 | Rewritten 21 Sep against this brief. |
