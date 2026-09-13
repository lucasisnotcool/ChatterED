# ChatterED — Progress Tracking: the Explanation Ledger (implementation spec)

**Status.** Draft v1, 13 Sep 2026.
**Why this document exists.** The A1 rubric, *Learning Design and Chosen Approach* (4.0 marks),
requires *"a well-defined learning objective alongside a clear mechanism for tracking student
progress"*. A group chat with two agents is not, by itself, such a mechanism — it is an activity.
This document specifies the mechanism, end to end: what it tracks, which LLM call computes it, the
exact JSON it emits, how the learner sees it, how it steers the Challenger's next question, and how
it exports for the study in `evaluation-plan.md`.
**Companions.** `design-brief.md` **§F is the authority on what the ledger *is* and how it is
pitched in the A1 report; this document is the implementation spec underneath it** — same
mechanism, same name, computational detail added. `evaluation-plan.md` (§7 log events, §8.5 ledger
validation, H4). `architecture-options.md` §C.2–C.3 (where the ledger state and the orchestrator
loop live). `interview-guide.md` already lists "progress ledger" as a mechanism to probe in §7 —
this is that ledger, specified.

**Agent names follow `design-brief.md` §D1:** Peer = **Mei**, Challenger = **Arun**, and the
opt-in closing Tutee = **Kai** (invited, never a standing third voice — §6.5).

---

## 1. The recommendation, in one paragraph

**Adopt the Explanation Ledger: a fixed checklist of 4–6 *claim slots* for the concept, each carried on
a 5-point mastery level (0–4) adapted from the Bloom ladder that Xu et al.'s Tutee agent walked
(remember → understand → apply → analyse). It is filled from the transcript by one dedicated
Sonnet call per student message, which emits strict JSON and may only advance an element when it can
quote the student's own words as evidence.** The learner sees it as a slim, non-punitive rail during
the session and as a recap card afterwards; the Challenger and Peer each read it to pick their next
target; the study exports every snapshot.

### Why not the two obvious alternatives on their own

| Option | What it gives | Why it is not enough alone |
|---|---|---|
| **Concept checklist only** (elements ticked/unticked) | Shows *what is missing* — precisely what a learner explaining a concept needs to see | Binary. "Mentioned the doubling" and "can defend why doubling and not +1" both tick the same box. It rewards name-dropping, which is exactly the uncritical-use failure mode ChatterED exists to attack. |
| **Bloom ladder only** (one level for the whole concept, as Xu et al.'s Tutee knowledge state) | Shows *depth*, and is directly reusable from the source paper | One scalar. It cannot tell the student *which part* is shallow, so it cannot drive a targeted probe, and a single number invites gamification and comparison pressure. |
| **Ledger = checklist × level** (recommended) | Both axes: an item-by-level matrix | Costs one extra LLM call per turn and needs validating as a measure (§8). Both costs are paid for below. |

The matrix is also the thing that makes the Challenger *good*. A Socratic question is only sharp
when it is aimed at a specific weak claim at a specific depth. `element × level` is exactly the
address a probe needs (§6.1).


### 1.1 Reconciliation with `design-brief.md` §F

The brief describes the same mechanism at report altitude, in four layers. Nothing below replaces
it; this is how the layers are computed.

| `design-brief.md` §F | Here | Relationship |
|---|---|---|
| **Layer 1 — claim rows, three states ○ Stated / ◐ Justified / ● Defended** | §3.1 levels 0–4 | The three states are the **learner-facing labels**; the 0–4 levels are the **computed values**. Mapping is fixed: 0 = blank row, **1 → ○ Stated**, **2 → ◐ Justified**, **3 and 4 → ● Defended**. The brief's rule that *"only the Challenger can unlock ●"* is enforced here as a handler condition: an element may only reach level ≥3 on a message that answers an Arun probe targeting that element (`in_reply_to` = Arun's `msg_id`, `target_element_id` matches). Levels 3 and 4 are kept apart internally because the probe selector needs the finer address (§6.1); the learner only ever sees ●. |
| **Layer 2 — global Bloom ladder** | §3.1, rolled up | Displayed rung = the **lowest level across all elements** (a ladder is only as high as its weakest claim). Computed per element; shown as one rung. |
| **Layer 3 — act profile** (live counters over Xu et al.'s Table 2 codes) | `evaluation-plan.md` §6 | Uses the *same* coding scheme as the study's transcript coding, so the live counters and the researcher's codes are the same construct. Live counters are LLM-assigned and provisional; the study numbers are the human-adjudicated ones (`evaluation-plan.md` §6.5). **Never report the live counters as study data.** |
| **Layer 4 — unaided-explanation seconds** | `evaluation-plan.md` §7.1 | Derived at analysis time from `task.start`, the first of {`whisper.open`, hint request, `silence.timer.fired`}. No new plumbing: the events already exist. |

Where the two documents could drift, this one yields on framing and the brief yields on mechanism.
Flag any real contradiction as a bug in one of them (`CLAUDE.md`), do not silently pick.

---

## 2. The learning objective it tracks

Written in the A1 Step-2 form, for the worked concept in §7:

> **Learning goal.** The student can explain, unaided and in their own words, *why* appending to a
> dynamic array is O(1) amortised — including what the growth policy has to do with it, what
> "amortised" does and does not guarantee, and what would break if the policy changed.

The ledger is the operationalisation of "show progress toward this goal": the goal decomposes into
5 claims, each of which the student can hold at one of 5 depths. Progress is the movement of that
matrix during one session, evidenced by quotes from the student.

**Division of labour (A1 Step 2, part 2).** The student produces the claims and the justifications.
The system decides nothing about the content — it only *notices* what has been established, shows
that back, and asks about what has not. The ledger never supplies a missing claim; the most it does
is name the gap ("nothing yet on what happens if the array grew by 1 each time").

---

## 3. The Concept Pack (authored ahead of time, per concept)

One JSON file per concept, committed under `concepts/<concept_id>.json`, versioned and hashed
(the hash goes into every log envelope — `evaluation-plan.md` §7). Authoring one takes ~45 minutes.

**Two authoring modes — this is a real fork, decide it explicitly.** `design-brief.md` §F1 has the
learner confirm 3–5 claims from **their own uploaded slide**. That is the right answer for
deployment: it makes ChatterED work on any lecture, which is the whole product. It is the *wrong*
answer inside Study A, where two participants must face the same rubric or the ledger is not a
comparable measure.

| Mode | Who authors the elements | Where used |
|---|---|---|
| **Fixed pack** | Researcher, ahead of time, versioned + hashed | Study A (both concepts), all pilots |
| **Elicited pack** | Learner confirms/edits 3–5 claims extracted from their slide by a Sonnet call, using the same schema and the same level criteria templates | Deployment, and Study B |

Same schema, same level scale, same ledger call. Only the provenance of `elements[]` differs, and
it is recorded per session as `pack_provenance: "fixed" | "elicited"`. Build the fixed path first —
it is a file loader — and the elicited path second.

```jsonc
{
  "concept_id": "amortised-append-v1",
  "title": "Why appending to a dynamic array is O(1) amortised",
  "source": "CS2040S-style; reading condensed to ~600 words",
  "target_level": 3,                  // level every element should reach for "goal met"
  "elements": [
    {
      "id": "E1",
      "label": "Cost of one append",
      "learner_label": "What one append actually costs",
      "criteria": {
        "1": "States that append is usually cheap but occasionally expensive because the array is full and must be copied.",
        "2": "Explains why the copy is needed: fixed-capacity block, must allocate a bigger one and move every element, so that append is O(n).",
        "3": "Applies it to a specific case: names the cost at a given size, or identifies which appends in a sequence are the expensive ones.",
        "4": "Distinguishes the per-operation worst case from the sequence behaviour, or handles a variant (e.g. what if copying were free)."
      },
      "misconceptions": [
        { "id": "M1a", "text": "Thinks every append copies the array." },
        { "id": "M1b", "text": "Thinks append is O(1) because the array 'has extra space', with no account of the resize." }
      ],
      "probe_seeds": {
        "clarification": "When you say append is cheap — cheap every time, or cheap most times?",
        "reasons_evidence": "What makes the occasional append expensive? Walk me through what the machine does.",
        "assumptions": "You're assuming the array can just grow. What's actually underneath it?",
        "implications": "So at what size does the next append hurt?",
        "alternatives": "If copying were free, would anything about your answer change?"
      }
    }
    // …E2–E5, same shape
  ]
}
```

**Authoring rules.**
- 4–6 elements. Fewer than 4 and the rail is not informative; more than 6 and it reads as a
  checklist of doom and cannot be scanned during a live chat.
- Elements must be **separable** — a student can hold E3 without E2. If two elements always move
  together, merge them.
- Every element needs ≥1 named misconception. The misconceptions are what the debrief correction
  sheet is built from (`evaluation-plan.md` §9.3).
- `probe_seeds` are seeds, not scripts. The Challenger rewrites them against what the student
  actually said; the seed guarantees the *type* is right even when the model is having a dull turn.
- The five probe-seed keys are exactly Xu et al.'s five Socratic question types (§4.1.3):
  clarification, probing assumptions, probing reasons and evidence, probing implications and
  consequences, probing alternative viewpoints.

### 3.1 The level scale (shared across all concepts)

| Level | Name | Meaning | Bloom anchor (Xu et al. §4.1.1) |
|---|---|---|---|
| 0 | Not yet | The student has not addressed this element | — |
| 1 | Stated | Says the fact, correctly, in some form | Remember |
| 2 | Explained | Gives the mechanism or the causal reason in their own words | Understand |
| 3 | Applied | Uses it on a specific instance, number, or new case | Apply |
| 4 | Examined | Compares, handles a counterfactual, states a limit, or catches their own error | Analyse |

Xu et al.'s Tutee agent *"advanced sequentially from remember to understand, apply, and analyze"* as
a single hidden state. The ledger keeps their ladder and makes it (a) per-element and (b) visible.

---

## 4. Computation: the Ledger call

### 4.1 Where it sits

One dedicated LLM call, `ledger.update`, fired **after every student message in the main channel**
(not on whisper messages — see §4.5). It is not the agent turn; it does not write chat.

```
student message
      ├──────────────► ledger.update      (Sonnet 5, JSON out, ~1–3 s)  ─┐
      └──────────────► agent turn plan/gen (Haiku 4.5, ~1–3 s)          │
                                                                        ▼
                        deliberate delay window (8–12 s TTFT)   ── both results in hand
                                                                        │
                        orchestrator picks speaker + target element ◄───┘
                        agent reply released;  ledger rail animates
```

**The delay pays for the ledger.** ChatterED already withholds the reply for 8–12 s (Tan et al.
2026: 9–20 s reads as more thoughtful than 2 s). That window is more than enough for a ledger call,
so assessment is free in wall-clock terms and the delay stops being dead time. This is the
strongest argument the design has for the latency mechanic beyond the borrowed perception finding —
say it in the A1 video.

**Model choice** follows repo policy (`CLAUDE.md`): **Sonnet 5** for the ledger (it is orchestration
and summarisation, it must be reliable at structured output, and it runs once per student message,
not once per agent turn); **Haiku 4.5** for the agent turns. Load the `claude-api` skill before
writing the call.

### 4.2 Input to the call

- The Concept Pack (elements, criteria, misconceptions) — cacheable prefix, identical every turn.
- The **current ledger** (levels + the evidence quote that earned each).
- The **last N=6 messages** of the main channel, with speakers, and the new student message marked.
- Nothing else. No survey data, no identity, no whisper content.

### 4.3 Output: strict JSON

```jsonc
{
  "schema": "ledger.v1",
  "concept_id": "amortised-append-v1",
  "message_id": "m_0f31",
  "elements": [
    {
      "id": "E1",
      "level": 2,                    // proposed level after this message
      "prev_level": 1,
      "evidence": "it only has to copy when it runs out of room, then it grabs a bigger block and moves everything over",
      "evidence_msg_id": "m_0f31",
      "confidence": 0.86,            // 0–1; below 0.6 the advance is held (§4.4)
      "rationale": "Gives the mechanism (fixed block, allocate bigger, move all) not just the fact.",
      "misconceptions_present": [],
      "misconceptions_resolved": ["M1a"]
    },
    { "id": "E2", "level": 0, "prev_level": 0, "evidence": null, "confidence": 0.95,
      "rationale": "Growth policy not addressed.", "misconceptions_present": [], "misconceptions_resolved": [] }
    // …E3–E5
  ],
  "coverage": 0.30,                  // mean(level)/target_level, clamped to [0,1]
  "open_misconceptions": ["M3b"],
  "suggested_target_element": "E2",
  "suggested_probe_type": "clarification",
  "notes_for_agents": "Student is fluent on the copy mechanism but has not mentioned how much the array grows by."
}
```

### 4.4 The four hard rules — enforced in code, not in the prompt

A prompt asking nicely for these will be violated. Enforce them in the handler.

1. **Evidence must be a verbatim substring of a student message.** Normalise whitespace and case,
   then check `evidence` against the transcript. If it is not found, **reject that element's
   advance**, keep `prev_level`, and log `evidence_check_failed`. This is a deterministic,
   nearly-free guard against the ledger hallucinating progress, and it is the single most important
   line of code in this feature.
2. **Monotonic, with one exception.** Levels only go up. The sole downgrade path is an explicit
   `self_contradiction` flag where the student states something incompatible with the earned
   evidence — and a downgrade is capped at one level per message, logged loudly, and shown to the
   learner as "let's revisit this" rather than as a demotion.
3. **Confidence gate.** `confidence < 0.6` holds the advance until a later message re-earns it. The
   held proposal is logged (`level_proposed` vs `level_after`) so §8 can measure how often the gate
   fires.
4. **Agreement is not evidence.** A student message coded `FBK-AGREE` or `CONCEDE-NJ`
   (`evaluation-plan.md` §6) may not advance any element. The prompt states it, and the handler
   re-checks: if the message contains no student-generated claim (heuristic: < 8 content words, or
   no proposition), skip the update entirely. This is the ledger's part of the MASG social-pressure
   mitigation — **the system must never reward capitulating to the agents.**

### 4.5 Whisper messages

Whisper turns do **not** advance the ledger. Two reasons, and both should be in the report:
- **Construct validity.** The learning goal is to explain *to the group*. A claim made privately to
  one agent is not the target behaviour.
- **Design honesty.** If whispering advanced the ledger, the private channel would become the
  efficient path to progress, and the public explanation — the entire intervention — would hollow
  out. This is the `WSP-ANS` cannibalisation risk in `evaluation-plan.md` §6.4, closed off in the
  mechanism rather than trusted to student restraint.

Whisper *is* logged and coded; it simply does not move the matrix. The whispered agent may say
"good — say that in the chat and it'll land", which is the intended nudge from private rehearsal to
public claim (`WSP-REH`).

### 4.6 Failure handling

| Failure | Behaviour |
|---|---|
| Malformed JSON | One repair retry with the parse error appended. On second failure: keep the previous ledger, emit `progress.update {parse_ok:false}`, chat continues uninterrupted. |
| Call times out (>6 s) | Abandon this update; the next student message re-evaluates from the same transcript, so nothing is permanently lost. |
| Evidence check fails on every element | Keep previous ledger, log it. A run of these is a prompt regression — alert in the dev dashboard. |
| Concept pack hash changed mid-study | Refuse to start a research session. A changed rubric is a changed instrument. |

**The chat never blocks on the ledger.** If the ledger is down the group chat still works; the rail
shows "updating…" and stops animating. A progress display that can stall the conversation is worse
than no progress display.

---

## 5. What the learner sees

Two surfaces. Both are deliberately quiet: Xu et al. found the *Tutee* role's felt responsibility
produced the highest pressure of any condition, and Song et al. found a group of agents adds
normative pressure on top. A loud, scoring, gamified progress meter would stack a third pressure
source onto a design that is already managing two.

### 5.1 During the session — the rail

A slim right-hand rail (collapses to a bar on mobile), one row per element:

```
 Your explanation so far                        3 of 5 claims covered
 ─────────────────────────────────────────────────────────────────
 What one append actually costs          ◐  justified
 How much the array grows by             ·  not yet
 Adding up the copies                    ○  stated
 What "amortised" promises               ·  not yet
 Where it stops being true               ·  not yet
 ─────────────────────────────────────────────────────────────────
 ladder:  remember ▸ understand ▸ apply ▸ analyse
 ⓘ these are your words, not a score                        [hide]
```

Marks are the three states from `design-brief.md` §F1 — **· not yet / ○ Stated / ◐ Justified /
● Defended** — driven by the computed levels via the fixed mapping in §1.1. The single ladder line
underneath is Layer 2, at the lowest element's rung.

Rules:
- **Language is "not yet", never "wrong" or "missing".** The rail reports what the student has
  *said*, and silence is not error.
- **Evidence on demand.** Hovering or tapping a filled row shows the student's own quote that earned
  it — "you said: *'it only has to copy when it runs out of room…'*". This is the honesty mechanism:
  the learner can audit the ledger, and it makes their own good reasoning visible to them, which is
  the metacognitive payoff.
- **Advances animate once, gently, and never interrupt.** No sound, no confetti, no streak, no
  points, no timer, no comparison to other students.
- **No global score, no percentage on screen.** "3 of 5 covered" is a count of elements at level ≥1,
  which is legible; `coverage` (a float) is for the log, not the learner.
- **A visible `[hide]` toggle.** Some students will find any progress display stressful. Hiding it
  is one click, is remembered, and — because `progress.view` is logged — hide rate becomes a finding
  rather than an unknown.
- Downgrades never flash red; the row shows a small "revisit" marker and the Challenger picks it up
  next turn.

### 5.2 After the session — the recap card

Shown on session end, exportable as text/PDF, and it is also the debrief artefact required by
`evaluation-plan.md` §9.3.

1. **What you established** — one line per element that reached ≥2, each with the student's own
   verbatim quote. (This is the deliverable students actually want: their own explanation, cleaned
   up, in their own words.)
2. **What stayed open** — elements below the target level, phrased as questions, not failures:
   "You never got to what happens if the array grew by one each time."
3. **One thing to try next** — the single lowest element plus its clarification seed.
4. **A correction block** — any misconception still flagged `open` at session end is corrected here
   **explicitly and factually**. Non-negotiable. A session that ends with a student more confidently
   wrong than they started is the primary learning harm this design can cause.
5. **The delta** — the ledger at start vs end, as the same five rows. This is the "shows progress"
   artefact for the A1 video: two screenshots side by side make the mechanism legible in ten
   seconds.

---

## 6. How the ledger drives the agents

The ledger is not decoration; it is the orchestrator's state. Without it the Challenger asks
whatever the last message suggests, which is how Socratic agents end up circling one point.

### 6.1 Target selection

Each turn, the orchestrator picks a **target element** and hands the agent a probe type:

```
candidates  = elements with level < target_level
if open misconceptions exist → target = the element carrying the oldest open misconception
else                          → target = lowest level among candidates,
                                tie-break by (a) touched-in-last-2-messages, (b) pack order
probe_type  = LEVEL_TO_PROBE[target.level]
```

`LEVEL_TO_PROBE`, mapping the level gap to Xu et al.'s five Socratic types (§4.1.3):

| Current level | Probe type | Because |
|---|---|---|
| 0 | **clarification** | Nothing to probe yet — open the door |
| 1 (Stated) | **probing reasons and evidence** | They have the fact; ask what it rests on |
| 2 (Explained) | **probing assumptions** | The mechanism is there; surface what it presumes |
| 3 (Applied) | **probing implications and consequences** | Push to consequences and limits |
| 4 (Examined) | **probing alternative viewpoints** | Consolidate by contrast |
| any, with an open misconception | **clarification**, aimed at the misconception | Never escalate on top of a misconception |

Xu et al.'s Challenger opens with a brief acknowledgment before challenging, and turns run ~80
words. Keep both — they are what kept its pressure "moderate" rather than adversarial.

### 6.2 The Peer (Mei) takes a *different* element

Mei targets the **second** candidate, never the same element as Arun in the same
window, and it works one level lower — asking for elaboration, suggesting a focus area, or offering
a tentative idea (Xu et al. §4.1.2).

This is a two-for-one: pedagogically it spreads coverage instead of grinding one gap; ethically it
is a structural guarantee that **the two agents are never pressing the same point at the same
time**, which is precisely the dogpile that produces the MASG normative-pressure effect
(`evaluation-plan.md` §9.3, mitigation 2). The rule lives in the orchestrator, so it cannot be
prompted away.

### 6.3 The silence timer uses the ledger too

When the 60 s silence alarm fires, Mei posts a **partial, correctable statement** about the
current target element — not a question, and never the answer:

> *Mei:* "I might be wrong, but I think the expensive appends are the ones where it's already
> full — so, like, every few appends? Is that the shape of it?"

Three properties, deliberate: it is *incomplete* (invites correction rather than agreement), it is
*hedged* (a confident agent statement into a silence is the highest-pressure move available), and it
is *on the target element* (so a re-entry after silence still advances the goal). A student
correcting the Peer here produces `MET-CORR` and `FBK-DIS` — the acts the design most wants and the
opposite of `CONCEDE-NJ`.

### 6.4 Session end condition

The block ends on the timer (12 min in Study A) or when every element reaches `target_level`,
whichever first. On early completion the agents shift to level-4 consolidation on the weakest
element rather than declaring victory — but the recap card is offered immediately.

### 6.5 The ledger gates the Kai teach-back round

`design-brief.md` §D1 resolves the third-agent question by making the Tutee (**Kai**) *invited, not
present*: a ~3-minute opt-in teach-back during which Mei and Arun go silent, so the live agent count
never exceeds two (the Song et al. group-size mitigation). **The ledger is the gate.**

- **Trigger:** every element at ● (level ≥3) and the rolled-up Bloom rung at *analyse*. Offered as
  an invitation, phrased as an option, declinable, and declinable *again* mid-round.
- **During the round:** Mei and Arun are muted. Kai climbs the same ladder as Xu et al.'s Tutee
  (§4.1.1) but over **the learner's own ledger elements** — it asks about E1 first, then upward.
- **Ledger behaviour during teach-back:** elements may reach **level 4** here, and only here, for
  the elements Kai actually probes. They may **not** advance from below 3 — teaching a novice is
  consolidation, not first acquisition, and letting it substitute for defending against Arun would
  undo the "only the Challenger unlocks ●" rule (§1.1).
- **Logging:** `teachback.offer` / `teachback.accept | decline` / `teachback.end`, with
  `elements_probed[]`. Accept/decline rate is a free finding, and the round is the natural
  within-subject contrast `design-brief.md` §D1 flags for A2 (recorded as RQ5 in
  `evaluation-plan.md` §2).

---

## 7. Worked example: *Why appending to a dynamic array is O(1) amortised*

> **Which concept to use.** `design-brief.md` §G scripts a full exchange on *convexity and the
> positive-semidefinite Hessian* (MA3236, matching `interview-guide.md` Variant A). This worked
> example deliberately uses a **Variant B** concept instead, so the two documents together
> demonstrate that the ledger is concept-agnostic and give the developer a ready pack for whichever
> cohort actually gets recruited. Use **one** variant throughout a study
> (`evaluation-plan.md` §4.1); do not mix.

Five elements: **E1** cost of one append · **E2** growth policy (doubling vs +1) · **E3** aggregate
accounting (1+2+4+…+n < 2n) · **E4** what "amortised" promises (worst case over a sequence, not
average, not probabilistic) · **E5** where it stops being true (a single append is still Θ(n);
+c growth gives Θ(n) amortised). `target_level = 3`.

**Opening ledger:** all five at 0. Rail: "0 of 5 covered".

---

**Turn 1 — Arun (Challenger) opens** (target E1, level 0 → clarification):

> "Before we get into the analysis — when you say appending to a dynamic array is fast, do you mean
> fast every single time, or fast on average?"

**Student:**
> "Fast most of the time. It's O(1) usually but when the array is full it has to resize, and that
> one is O(n)."

`ledger.update` → **E1: 0 → 1** (Stated). Evidence check: *"when the array is full it has to resize,
and that one is O(n)"* — found verbatim. Confidence 0.91. `M1a` (thinks every append copies) marked
resolved. E2–E5 unchanged.

Rail: E1 goes ○ *stated*. "1 of 5 claims covered."

---

**Turn 2 — Mei takes E2** (second candidate, elaboration), **Arun takes E1** (level 1 →
probing reasons and evidence). Both released after the 8–12 s delay; Mei first, Arun 4 s
later, so it reads as a conversation rather than a broadside.

> *Mei:* "Ooh — when it resizes, how much bigger does it get? I've always just assumed it, like,
> grows."
> *Arun:* "Right, so the resize is the expensive bit. What actually makes it O(n) — what is
> the machine doing during that resize?"

**Student:**
> "It doubles. And it's O(n) because the array is one contiguous block with a fixed capacity, so it
> can't just extend — it allocates a new block twice the size and copies every element across, which
> is n work."

`ledger.update` →
```jsonc
{ "elements": [
  { "id":"E1","level":2,"prev_level":1,
    "evidence":"it allocates a new block twice the size and copies every element across, which is n work",
    "confidence":0.89,"rationale":"Mechanism given, not just the fact.",
    "misconceptions_resolved":["M1b"] },
  { "id":"E2","level":1,"prev_level":0,"evidence":"It doubles.","confidence":0.72,
    "rationale":"States the policy; no account yet of why doubling matters." },
  { "id":"E3","level":0 }, { "id":"E4","level":0 }, { "id":"E5","level":0 }
], "coverage":0.20, "suggested_target_element":"E2", "suggested_probe_type":"reasons_evidence" }
```
Rail: E1 ◐ *justified*, E2 ○ *stated*. "2 of 5 claims covered."

---

**Turn 3 — whisper.** The student opens the private channel to the Peer:

> *(whisper)* "is it bad that i don't actually know why doubling and not like +10"

Whispered Mei reply — clarifies, does not answer, and pushes the claim back to the main channel:

> "Not bad at all, that's the actual question here. Try this: picture growing by 10 each time and
> count how many copies happen over a thousand appends. Then say what you find out loud — that's
> the bit worth putting in the chat."

**Ledger: unchanged** (§4.5). Logged as `whisper.send` + `WSP-CONF`.

*This turn is worth demonstrating in the A1 video.* It shows the whisper channel doing exactly the
job Dennis et al. describe — a question the student would not post to the group, asked without
derailing it — and shows the design refusing to let the private channel become the shortcut.

---

**Turn 4 — Arun targets E2** (level 1 → probing reasons and evidence):

> "You said it doubles. Suppose it grew by ten each time instead — you'd still get plenty of cheap
> appends between resizes. Would that also be O(1) amortised?"

**Student:**
> "No... if it grows by 10 then you resize every 10 appends, and each resize copies everything, so
> after n appends you've copied 10 + 20 + 30 + ... + n which is about n²/20. That's O(n) per append
> on average. With doubling you copy 1 + 2 + 4 + ... + n and that whole series is less than 2n, so
> it's O(1) each."

`ledger.update` →
```jsonc
{ "elements": [
  { "id":"E1","level":2 },
  { "id":"E2","level":3,"prev_level":1,
    "evidence":"if it grows by 10 then you resize every 10 appends ... about n²/20",
    "confidence":0.93,"rationale":"Applied the policy to a new growth rule and derived the cost." },
  { "id":"E3","level":3,"prev_level":0,
    "evidence":"you copy 1 + 2 + 4 + ... + n and that whole series is less than 2n",
    "confidence":0.90,"rationale":"States and uses the geometric sum, with the 2n bound." },
  { "id":"E4","level":0 }, { "id":"E5","level":0 }
], "coverage":0.53, "suggested_target_element":"E4", "suggested_probe_type":"clarification" }
```
Rail: E2 ● *defended*, E3 ● *defended*. "4 of 5 claims covered." One gentle animation, no
fanfare. (Both reached level 3 in reply to an Arun probe on that element, so the ● unlock rule in
§1.1 is satisfied.)

Note what the ledger just did that a checklist could not: **E2 jumped two levels in one message**,
because the student did not merely name the policy, they used it counterfactually. And note what a
Bloom scalar could not do: it correctly left **E4 at zero** despite an otherwise excellent message.

---

**Turn 5 — silence.** The student goes quiet. At 60 s the alarm fires; the Peer posts a partial
statement on E4 (§6.3):

> *Mei:* "I think I follow — so 'amortised' basically means it's fast on average, right? Like if
> you ran it lots of times it'd usually be quick?"

That is deliberately the **common misconception** `M4a` (amortised = average-case), voiced hedged
and by the *Peer*, which makes correcting it low-cost socially.

**Student:**
> "Not quite — average case is about the distribution of inputs, and this has nothing to do with
> randomness. Amortised means: take *any* sequence of n appends, worst case, and the total is O(n),
> so O(1) each. It's a guarantee over the sequence, not a probability."

`ledger.update` → **E4: 0 → 3**, evidence *"take any sequence of n appends, worst case, and the total
is O(n)"*, `M4a` resolved, `MET-CORR` + `FBK-DIS` coded. `after_timer_fire_ms` = 4,100.

Rail: "5 of 5 claims covered", E5 still ○ at level 1 (implied by "worst case" but not
established). Note E4 reached level 3 answering **Mei's** timer fill, not an Arun probe — under the
§1.1 unlock rule it displays as ◐ until Arun probes it; the internal level is 3 and the probe
selector treats it as such.

---

**Turn 6 — Arun targets E5** (level 1 → probing implications):

> "Good — a guarantee over the sequence. So if I'm writing something with a hard 5-millisecond
> deadline per operation, does your guarantee help me?"

**Student:**
> "...no, actually. One individual append can still be Θ(n) when it hits a resize, so if I need a
> per-operation bound I can't use this. I'd need something that spreads the copying out — like
> copying a few elements on every append instead of all at once."

`ledger.update` → **E5: 1 → 4** (Examined: states the limit *and* offers the incremental-resize
alternative). `coverage` = 0.90.

**Recap card:**

```
What you established
  ✓ What one append actually costs — "it allocates a new block twice the size and
    copies every element across, which is n work"
  ✓ How much the array grows by — you worked out that +10 growth gives ~n²/20 copies
  ✓ Adding up the copies — "1 + 2 + 4 + ... + n ... less than 2n"
  ✓ What "amortised" promises — "a guarantee over the sequence, not a probability"
  ✓ Where it stops being true — you caught that a single append is still Θ(n),
    and reached for incremental resizing on your own

Still open
  Nothing at the goal level. If you want to push further: what does the
  amortised cost become if the array also *shrinks* when it empties?

Corrections
  None outstanding. Earlier you framed amortised as "on average" — you corrected
  that yourself in the chat, which is the version to keep.
```

Session duration: ~11 min. Four ledger advances driven by four differently-typed Socratic probes,
one whisper, one timer fill, zero instances of the system telling the student the answer.

---

## 8. Export, and validating the ledger as a measure

### 8.1 What is exported

Per `evaluation-plan.md` §7, every recomputation emits `progress.update`. For analysis, flatten to
two tables in the Singapore-resident research store (§9.5 of that document):

**`ledger_snapshots`** — one row per element per update:
`session_id, subject_code, study, block, concept_id, concept_hash, msg_id, seq, ts, element_id,
level_before, level_proposed, level_after, confidence, evidence_msg_id, evidence_hash,
gate_applied (none|confidence|evidence_check|agreement), misconceptions_present,
misconceptions_resolved, ledger_latency_ms, parse_ok`

`evidence_hash`, not the evidence text — the quote is the student's words and lives in the
access-controlled transcript table only.

**`ledger_final`** — one row per block:
`… , coverage_final, elements_at_target, time_to_first_advance_ms, time_to_coverage_50_ms,
downgrade_count, gate_counts{}, rail_hidden (bool), rail_views, ledger_calls, ledger_errors`

### 8.2 Derived measures it feeds into the study

| Measure | Definition | Used for |
|---|---|---|
| **Coverage at end** | `mean(level)/target_level` | H4 (`evaluation-plan.md` §8.5); descriptive per condition |
| **Elements at target** | count of `level ≥ target_level` | Legible headline number for the report |
| **Coverage curve** | coverage vs turn index | Compares Group vs Single trajectories, the analogue of Xu et al.'s Figure 5 turn-by-turn plots |
| **Time-to-level-2 per element** | first `ts` at level ≥2 | Whether the Challenger's targeting actually accelerates depth |
| **Advance-per-message rate** | advances ÷ student messages | Efficiency; guards against "more words = more progress" |
| **Gate counts** | how often each §4.4 rule fired | Instrument health; `agreement` gate firing often is itself MASG evidence |
| **Rail hidden rate** | fraction hiding the rail, and when | Whether the progress display is felt as pressure |

### 8.3 The ledger must be validated before it is believed

It is an LLM scoring an LLM-mediated conversation. Treat it as a new instrument, not as ground
truth:

1. **Blind hand-scoring.** The researcher scores 20% of blocks against the same Concept Pack
   criteria, **without** seeing the ledger output, from the transcript alone.
2. **Agreement statistic.** Quadratic-weighted κ on the ordinal levels (and exact-agreement %) per
   element. Pre-set threshold **κ ≥ .60**. Below that, the ledger is reported as a user-interface
   feature only, and every ledger-derived number in §8.2 is struck from the analysis.
3. **Convergent validity.** Spearman ρ between end-of-block coverage and post-test score,
   partialling pre-test — H4, target ρ ≥ .5. Post-test items are mapped 1:1 to elements
   (`evaluation-plan.md` §5.1), so element-level agreement can be checked too.
4. **Face validity.** Exit-interview question 4 shows the student their own final ledger and asks
   whether it matches what they think they got across (`evaluation-plan.md` §7.3). Disagreements are
   the most useful qualitative data this feature will produce.
5. **Report the failure modes** whatever the numbers: gate-firing rates, downgrade count, parse
   failures. An instrument section that admits its error rate is stronger than one that does not
   mention it.

### 8.4 Known limitations to state, not hide

- Rewards articulacy. A student who understands E3 but expresses it badly stays at level 1. This is
  partly *defensible* — the learning goal is explanation, not silent understanding — but it is a
  real construct-validity limit and interacts with language background. Measure it: report coverage
  against a self-rated English-fluency item.
- Five elements are the researcher's decomposition of the concept, not a canonical one. A different
  author would draw different slots. Version the pack and publish it.
- The ledger sees the main channel only, by design (§4.5), so it systematically under-counts
  understanding for heavy whisper users. Report whisper volume alongside coverage.
- Xu et al. found **no** objective learning-outcome differences between agent roles at n=96. Do not
  let a pretty coverage curve smuggle in a learning claim the test scores do not support.

---

## 9. Build order (for the 9 days to A1, and after)

**For A1 (design only — build nothing):**
1. Write **one** Concept Pack, fully, for the §7 concept. It is the most persuasive artefact in the
   prototype package: it makes the learning goal concrete, shows the progress mechanism the rubric
   asks for, and doubles as the prototype script.
2. Draw the rail (§5.1) and the recap card (§5.2) as static mockups — before / mid / after. Two
   screenshots side by side are the whole "tracking progress" argument in the video.
3. Storyboard the §7 transcript as the multi-turn prototype interaction. It already satisfies A1
   Step 4's three requirements: multiple connected turns, agent responses visibly shaped by the
   student's input, and a direct line from the interaction to the learning goal.
4. One report paragraph: ledger = checklist × Bloom level, computed per message with quoted
   evidence, drives the Challenger's probe type, exports for A2. Cite Xu et al. §4.1.1 for the
   ladder and §4.1.3 for the probe types.

**For A2 (implementation), in this order:**
5. Concept Pack loader + the ledger data model + `progress.update` logging — *before* any UI. If the
   logging is retrofitted, the pilot sessions are wasted.
6. The `ledger.update` call with all four §4.4 guards. Write the evidence-substring check first; it
   is ten lines and it is what makes the feature trustworthy.
7. The orchestrator's target selection (§6.1) and the Peer's different-element rule (§6.2).
8. The rail and the recap card.
9. Validation harness for §8.3: a script that dumps transcript + blind-scoring sheet, and computes
   weighted κ against the logged ledger.

---

## References

- Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who you explain to matters: Learning by
  explaining to conversational agents with different pedagogical roles. *CHI '26*.
  https://doi.org/10.1145/3772318.3790298 — §4.1.1: the Tutee agent's hidden knowledge state
  advancing *"sequentially from remember to understand, apply, and analyze"*, which the level scale
  (§3.1) adapts and makes per-element and visible; §4.1.2: the Peer's three actions; §4.1.3: the
  five Socratic question types that `LEVEL_TO_PROBE` (§6.1) maps onto, and the acknowledge-then-
  challenge turn shape; §5.2.1: the null result on objective learning outcomes that §8.4 warns
  against overriding.
- Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Investigating social influence of
  multiple agents in human-agent interactions. *Proc. ACM Hum.-Comput. Interact.*, 9(7), CSCW452.
  — the normative-pressure finding behind the anti-dogpile rule (§6.2), the hedged silence-filler
  (§6.3), and the rule that agreement never advances the ledger (§4.4, rule 4).
- Tan et al. (2026). The impact of response latency and task type on human-LLM interaction and
  perception. *CHI '26*. https://doi.org/10.1145/3772318.3790716 — the 9–20 s thoughtfulness window
  that the ledger call runs inside (§4.1).
- Dennis, A. R., Rennecker, J. A., & Hansen, S. (2010). Invisible whispering. *Decision Sciences*,
  41(4), 845–886 — the side-channel rationale for §4.5 and the §7 turn-3 whisper.
