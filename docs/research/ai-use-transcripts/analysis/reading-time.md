# Reading time and session length in the six AI-use sessions

Companion to [`findings.md`](findings.md) §RQ5. Numbers are produced by
`scripts/reading_time.py` into [`reading-time.json`](reading-time.json); nothing here is
hand-entered. Session ids R1–R6 are T1–T6 in the report draft.

**One-line answer.** Across the four timestamped multi-turn sessions the learner left an
AI answer on screen for a mean of **5.6 min** (median 4.6) against a **1.25 min** mean
reading demand at 238 wpm — about **4.8× more time than a full read needs**. But the
headroom is spent on short answers: it falls from 10.1× for answers under 200 words to
**1.1× for answers over 400 words**, and **16% of answers (9 of 56) were left before a
full read was physically possible**. A single uninterrupted session, cut at a **20-minute**
idle threshold, runs **31.5 min mean / 36.3 min median** over 5 exchanges.

---

## 1. What is actually measured

Reading is not observable in a share export. Three quantities are:

| Term | Definition | What it is |
|---|---|---|
| **Dwell** | `t(next learner turn) − t(AI turn)` | **Upper bound** on reading time |
| **Demand** | AI prose words ÷ 238 wpm | **Lower bound** on the time a full read needs |
| **Session** | maximal run of turns with no dwell > 20 min | one sitting |

Both bounds lean the same way, which matters for the conclusion below:

- **Dwell overstates reading.** It also holds the answer's own streaming time, the
  learner's thinking, and the typing of the next prompt. Every platform here stamps the
  AI turn at generation *start* — ChatGPT 0.3–2.2 s after the learner's message (median
  0.9 s), Perplexity at the query time itself — so the dwell is really the inter-query
  interval, and the whole of generation sits inside it.
- **Demand understates the work.** 238 wpm is Brysbaert's (2019) mean *silent* rate for
  English non-fiction, i.e. reading-for-gist by a fluent adult, not study reading of
  unfamiliar technical material. Words inside fenced code blocks are excluded entirely
  (26% of R6's AI words, ≤1% elsewhere), although code is the substance of those answers.

So wherever dwell < demand, the learner **cannot** have read the answer in full — the
finding survives every assumption being pushed against it. The converse is weaker:
dwell > demand means time was *available*, not that it was used to read.

**Excluded:** R1 (the Claude share carries no timestamps), and R3 (one exchange, so no
dwell exists). R3 still contributes one session to §4.

## 2. Excluding the logged-off gaps

Nine dwells exceed 20 minutes and are read as the learner leaving, not reading:

| Session | After | Gap | Session | After | Gap |
|---|---|---:|---|---|---:|
| R4 | A4 | 52.0 h | R6 | A32 | 21.2 h |
| R6 | A43 | 10.9 h | R6 | A44 | 2.9 h |
| R6 | A33 | 1.8 h | R6 | A2 | 1.4 h |
| R6 | A21 | 52 min | R6 | A4 | 32 min |
| R6 | A15 | 31 min | | | |

The remaining **56** dwells are the reading sample. Dropping a gap whole also drops the
reading that began at the start of it, so the mean below is, again, conservative.

## 3. Dwell against reading demand

Per session, away-gaps removed:

| | tool | n turns | dwell mean | dwell median | demand mean | dwell ÷ demand (median) | left before a full read |
|---|---|---:|---:|---:|---:|---:|---|
| R2 | ChatGPT | 9 | 5.4 min | 3.4 | 1.6 min | 1.9× | A4, A8 |
| R4 | Perplexity | 8 | 4.6 min | 5.7 | 2.4 min | 7.3× | A2, A3 |
| R5 | ChatGPT | 3 | 2.1 min | 2.8 | 1.0 min | 2.4× | A3 |
| R6 | ChatGPT | 36 | 6.2 min | 5.5 | 0.9 min | 6.1× | A10, A17, A23, A34 |
| **pooled (56 turns)** | | 56 | **5.6 min** | 4.6 | **1.25 min** | **4.8×** | 9 turns = **16%** |
| **session-weighted (4)** | | 4 | 4.4 min | — | — | 4.4× | — |

R6 is 36 of 56 turns, so the session-weighted row is the safer headline for prose; the
pooled row is the one to quote for per-answer behaviour. Counting code words as readable
raises the miss rate to 11 of 56 (20%) and lowers the median ratio to 4.5×. Subtracting
the time to type the next prompt (51.6 wpm, Dhakal et al. 2018) takes the pooled mean
dwell from 5.6 to 5.0 min and the median from 4.6 to 3.8, and raises the miss count to
10 of 56 — typing is not what is eating the reading window.

**The headroom is inversely proportional to the answer's length** (Spearman ρ = −0.62,
n = 56; Pearson r = −0.65 on logs):

| AI answer length | n | dwell median | demand median | ratio median | left before a full read |
|---|---:|---:|---:|---:|---:|
| < 200 prose words | 21 | 6.1 min | 0.6 min | **10.1×** | 0 |
| 200–400 | 27 | 3.7 min | 1.1 min | 2.5× | 5 |
| > 400 | 8 | 2.0 min | 1.9 min | **1.1×** | 4 (half) |

The nine turns that cannot have been read in full:

| Session | Answer | Prose words | Dwell | Demand | wpm a full read would need |
|---|---|---:|---:|---:|---:|
| R4 | A3 | 1,863 | 1.0 min | 7.8 min | 1,836 |
| R4 | A2 | 1,830 | 1.0 min | 7.7 min | 1,805 |
| R6 | A10 | 211 | 0.3 min | 0.9 min | 759 |
| R2 | A8 | 442 | 0.7 min | 1.9 min | 678 |
| R5 | A3 | 238 | 0.5 min | 1.0 min | 525 |
| R6 | A23 | 252 | 0.6 min | 1.1 min | 453 |
| R6 | A17 | 274 | 0.8 min | 1.2 min | 330 |
| R2 | A4 | 436 | 1.5 min | 1.8 min | 287 |
| R6 | A34 | 318 | 1.2 min | 1.3 min | 274 |

R4's two are the clearest: a ~1,850-word debrief, and the next query 61 seconds later —
and Perplexity's timestamp is the *query* time, so most of that minute was the answer
still being written. The learner's actual reading window there is near zero.

Per session, over every AI turn including the last:

| | total dwell | total reading demand | |
|---|---:|---:|---|
| R2 | 48.9 min | 16.0 min | |
| R3 | — (single exchange) | 5.0 min | the one answer is 1,190 words |
| R4 | 37.1 min | 21.3 min | |
| R5 | 6.4 min | 4.1 min | |
| R6 | 221.6 min | 42.2 min | 57.0 min with code words |

## 4. Uninterrupted session length

**Recommended threshold: 20 minutes**, not 15. Two reasons, both from this corpus:

1. **The distribution breaks there.** Sorted, the 65 inter-turn gaps run continuously to
   19.0 min and then jump to 30.5 min. Nothing lands in between. A 15-minute cut falls
   *inside* the continuous run and splits two ordinary within-session pauses (R6 A12→L13 at
   16.0 min, R6 A18→L19 at 19.0 min) into separate sessions.
2. **The result is stable across the break.** Any threshold from 20 to 30 min produces
   the identical 14-session segmentation, so the number is not an artefact of the cut.
   The web-analytics convention (25.5 min, Catledge & Pitkow 1995; 30 min in most
   analytics tools) sits in the same window.

At 20 minutes, R2–R6 contain **14 sessions**:

| | all 14 | excluding the 4 single-exchange sessions |
|---|---:|---:|
| Mean duration | 22.5 min | **31.5 min** |
| Median duration | 4.8 min | **36.3 min** |
| SD | 27.2 | 27.4 |
| Range | 0 – 78.8 min | 0.6 – 78.8 min |
| Exchanges (mean / median) | 5.0 / 4 | — |

The four single-exchange sessions (R3 L1, and R6 L33, L44, L45 — the learner returning
after 21 h, 11 h and 2.9 h to ask one thing) have a measured duration of 0 by
construction. They are real sessions, so both rows are given; the second is the one to
quote as "a working sitting".

**Censoring.** Duration is last-turn minus first-turn, so the reading of each session's
*final* answer is never counted — every figure is a floor. Adding the final answer's
reading demand as a minimum correction moves the mean to 32.5 min and the median to
37.8 min (23.8 / 6.3 including singletons).

Longest sittings, all in R6: 78.8 min (L5–A15, 11 exchanges), 61.3 min (L22–A32, 11),
40.0 min (L16–A21, 6), 38.6 min (L34–A43, 10). R2 is a single 49.1-min sitting.

Sensitivity at other thresholds:

| Threshold | Sessions | Mean (excl. singletons) | Median (excl. singletons) |
|---:|---:|---:|---:|
| 15 min | 16 | 23.3 min | 13.25 min |
| **20 min** | **14** | **31.5 min** | **36.3 min** |
| 30 min | 14 | 31.5 min | 36.3 min |

## 5. What this supports in the report

- **DG5 (chat turns sized for reading).** The 238 wpm budget the design guideline already
  uses is exactly the one that fails here: past ~400 words the learner stops giving the
  answer enough time, and half of those answers get less than a full read. A 100–120 word
  chat turn is ~30 s of reading — inside the observed dwell for every turn in the corpus.
- **Long answers are not read, they are collected.** This is the behavioural counterpart
  to P2's self-report that her notes were "usually [not] read [fully]" (T4 = R4, whose two
  1,850-word debriefs got 61 seconds each). Self-report and timestamps agree.
- **The unit to design for is ~30 min and 4–5 exchanges.** Not a 5-minute lookup, and not
  an hour. Flow-session constants in `src/room/flow.ts` should be read against that.

## 6. Limitations

- **n = 4 sessions for dwell** (R1 no timestamps, R3 single exchange), and R6 is 64% of
  the dwell sample. Per-session figures are given for this reason.
- **Dwell is not attention.** A 6-minute dwell may be six minutes of reading or one minute
  of reading and five in another window. The 20-minute cut removes obvious absences, not
  short ones. Only dwell < demand is a *proof* of something; dwell > demand is permission.
- **238 wpm is a population mean**, applied to individuals. Brysbaert's own range for
  non-fiction is roughly 175–300 wpm. Across that range the miss count moves from 7 of 56
  (300 wpm, median ratio 6.1×) to 11 of 56 (175 wpm, 3.5×); at 200 wpm it is 10 of 56.
  The direction of the finding does not depend on the rate chosen.
- **`metrics.json`'s `gap_includes_generation` flag is wrong for R2/R5/R6.** It marks them
  `false`, but their AI timestamps are ≤2.2 s after the learner's message, i.e. generation
  start — so generation is inside those gaps too. `findings.md` §6 repeats this as if only
  R4 were affected. It does not change the direction of any claim (it makes every dwell an
  even looser upper bound), but the limitation should be restated for all sessions.

## References

- Brysbaert, M. (2019). How many words do we read per minute? *Journal of Memory and
  Language*, 109, 104047.
- Catledge, L. D., & Pitkow, J. E. (1995). Characterizing browsing strategies in the
  World-Wide Web. *Computer Networks and ISDN Systems*, 27(6), 1065–1073.
- Dhakal, V., Feit, A. M., Kristensson, P. O., & Oulasvirta, A. (2018). Observations on
  typing from 136 million keystrokes. *CHI '18*.
