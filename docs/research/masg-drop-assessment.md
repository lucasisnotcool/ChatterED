# Should the multi-agent social-group concept be dropped?

**Status.** Assessment for Lucas, written 15 Sep 2026, seven days before the A1 deadline
(22 Sep 2026, 23:59). **Recommendation only — the decision is Lucas's.** No code, no docs other
than this file, and nothing in `app/` was changed in producing it.

**The question, as asked.** Three parts: *is it too late; what does it cost; and is the
multi-agent social-group idea incompatible with the new-idea mandate?*

**The one-paragraph answer, stated first.** The thing Lucas is calling "the multi-agent social
group" is actually five separable things, and the pivot touches exactly one of them. *Multiple
agents* in a document is the one configuration with direct 2026 empirical support (Fang et al.
2025, the only study anywhere of multi- vs single-agent in a reading surface). *Pedagogical
roles* (Peer / Challenger) are from Xu et al. and are per-role effects that never required two
agents at once. *The social-group framing* — MASG's normative pressure, the disagreement quota,
anti-dog-pile, gender-balanced pairing — is the part the pivot genuinely strains, because it was
written against one linear floor and a room. *Room-dependent mechanics* (whisper-as-side-channel,
silence-fill by the other agent, "Show the room") are already being rewritten or deleted by
`pivot-spec.md` regardless of this decision. *One-agent-survivable mechanics* (ledger, timer,
latency, teach-back, Ask-in-place) are untouched either way. So: it is not too late, dropping is
cheap in code and expensive in report, and the honest answer to "incompatible?" is **no for two
agents, partly yes for the social-group rhetoric**. Recommendation: **Option 2** — keep two
role-distinct annotators, drop the social-group framing. Reasons in §D.

## Contents

- [A. Disentangling the concept — five things, not one](#a-disentangling-the-concept--five-things-not-one)
- [B. Compatibility with the mandate](#b-compatibility-with-the-mandate)
- [C. The cost of dropping — and of keeping](#c-the-cost-of-dropping--and-of-keeping)
- [D. Three options and a decision matrix](#d-three-options-and-a-decision-matrix)
- [E. Questions for Lucas](#e-questions-for-lucas)

---

## A. Disentangling the concept — five things, not one

"The multi-agent social group" is being treated as a single decision. It is five, and they have
different owners, different evidence, and different exposure to the pivot. Separating them is most
of the work of answering the question.

| # | Layer | Where it came from | What it actually is | Does the mandate touch it? |
|---|---|---|---|---|
| **(i)** | **Multiple agents** — two voices at all | Lucas's own note: *"simulated discussion / grp chat between 2-3 AI and 1 user"* (`Academia/Sources/Multi Agent AI ED/README.md`) | A count. Nothing more. | **No.** |
| **(ii)** | **Pedagogical roles** — Peer builds, Challenger probes | Xu et al. 2026 (`design-brief.md` §A1) | Two *behaviour contracts*, measured **one at a time** | **No.** |
| **(iii)** | **The social-group framing (MASG)** | Song et al. 2025 (`design-brief.md` §A2, §D6) | A *risk model* plus eight safeguards (S1–S8), used inverted | **Indirectly — and this is where the strain is.** |
| **(iv)** | **Mechanics that depend on there being a group** | `design-brief.md` §D3, §D5; `product-design.md` §A P2, §C4 | Whisper-as-side-channel, silence-fill by *the other* agent, "Show the room", the disagreement quota | **Yes, partly — but the pivot spec is already rewriting or deleting most of them regardless.** |
| **(v)** | **Mechanics that survive with one agent** | `design-brief.md` §D3, §D4, §F; `pivot-spec.md` §B1, §B6, §B7 | Ledger, timer, latency, teach-back, Ask-in-place, coverage map | **No.** |

### A1. (i) Multiple agents — the count, on its own

This is the only layer with **direct empirical support in the new surface**, and it comes from
exactly one source: Fang, Xu, Yang, Lin, Malacria & Yatani, *LLM-based In-situ Thought Exchanges
for Critical Paper Reading* (arXiv 2510.15234), summarised at `pivot-integrated-document.md`
§C17. A custom PDF viewer, *N* = 46, two weeks, three conditions — **no agent vs single agent vs
multi-agent**. Agent-mediated exchange significantly improved critical-thinking scores;
**multi-agent produced more active engagement and more comparing of multiple perspectives**;
single-agent produced **more reflective annotations**.

Three things follow and all three belong in the report:

1. It is the **only** citation anywhere in the project that answers "why two agents in a
   margin?" (`pivot-integrated-document.md` §C21 point 3, stated in those words).
2. It is **not a clean win**. Single-agent beat multi-agent on *reflective annotations*. The
   honest reading is a trade: engagement and perspective comparison against depth of reflection.
   ChatterED's own outcome construct is the ledger's `defended` state, which is nearer
   "perspective comparison under challenge" than "reflective annotation" — so the trade points
   the project's way, but say it as a trade, not as a result.
3. **It appears to be a preprint.** `pivot-integrated-document.md` §C17 lists no venue, unlike
   C16 (CHI 2026) and C18–C20. A design goal whose only in-surface evidence is an unrefereed
   arXiv entry is a different kind of claim from one resting on Xu et al. (CHI '26) and
   Song et al. (CSCW). See §E Q3.

### A2. (ii) Pedagogical roles — and the fact that they were never a two-agent finding

This is the layer most often confused with (i), and the confusion is doing real damage to the
decision. **Xu et al. 2026 is a between-subjects study with one agent per participant.**
*N* = 96, 24 per cell, four conditions: Tutee, Peer, Challenger, Control (`design-brief.md` §A1,
citing §4.1/§4.4). Every number the project leans on is a *single-agent* number:

- Challenger: critical thinking **5.62** vs Control 3.74, *F*W(3,48.6) = 10.74, *p* < .001,
  η² = 0.29 — at perceived pressure **2.93**, against Tutee's 4.02.
- Peer: absorption **5.10**, interest 5.33, competence 5.30, pressure **2.49** (lowest), and the
  highest *seeking feedback/confirmation* count (10) in Table 3.
- Challenger: metacognitive subtotal **49** vs Peer 36, Tutee 14, Control 22.

None of that requires two agents to be present at once, and none of it was measured that way.
Worse for the group case: Xu et al.'s own §6.3(1) design implication is a **sequence** —
*"Peer to open → Challenger to deepen → Tutee to close in a self-assessment/review phase"* — which
`design-brief.md` §D0 already adopts as the three-phase session. A sequence of roles is a
**mode switch**, not a roster. On the evidence as cited, a single agent that changes mode is
*more* faithful to Xu et al. than two agents speaking in the same beat.

The two counter-measures the brief builds around Xu et al. also survive a drop: the Peer's
agreement cap (P15P's *"I felt like I was being pandered to"*, §6.1.2's *cognitive friction*
argument) is a constraint on the Peer *contract*, and the Challenger's no-repeat-question-type
rule (4/24 found the questioning confrontational) is a constraint on the Challenger *contract*.
Both are already implemented as contracts, not as agents: `prompts.ts#roleBlock` and
`orchestrator.ts#nextProbeType`.

### A3. (iii) The social-group framing — what MASG actually contributes

Song et al. 2025 is, in `design-brief.md` §A2's own words, *"the risk paper"*. It is used
**inverted**: §D6 opens *"Song et al. is a paper about how to manipulate people. ChatterED uses
its findings as a list of things not to do."* The concrete contributions are:

- **The reason the group is capped at two.** 1 → 3 agents is where opinion shift toward the
  agents becomes significant (*M* = 0.509 vs 1-agent −0.161, Dunn's *p* < .05) and where felt
  pressure goes 3% → 12% → 20% (§4.1.1, §4.2.2). Safeguard **S1**.
- **The disagreement quota (S2)** — Ellie and Max must visibly disagree at least once per five
  agent turns; when the learner is right and Max presses anyway, Ellie sides with the learner.
  Grounded in Song's own §5.4.3 minority-influence suggestion. Implemented:
  `orchestrator.ts` `DISAGREEMENT_QUOTA = 5`, `agreementRun`, `mustDisagree`, and the
  `disagreement` field on `TurnDecision`; `actor.ts` writes `agreement_run` and the disagreement
  envelope (`targetAgentKey`, `targetMessageId`).
- **Banned cohesion cues (S3)** — no naming another agent in agreement, no "we", no collective
  close. `prompts.ts` HOUSE RULES 4 and SAFEGUARDS S3.
- **Anti-dog-pile** — `orchestrator.ts` `MAX_CONSECUTIVE_AGENT_TURNS = 2`.
- **Gender-balanced pairing** — Ellie (she) / Max (he), **role–name pairing randomised at
  install** so role cannot be confounded with gender (`agents.ts#randomPairing`,
  `product-design.md` §E: *"if a participant finds Max's challenges harsher than a peer's, we
  cannot say whether that is the Challenger persona or the male name doing it"*).
- **DG5** — "Buy engagement with quality, never with social pressure" (`design-brief.md` §E).

**The important observation:** every one of these is a *constraint on a group*, not a *benefit
of* one. Song et al. found **normative influence significant everywhere and informational
influence significant nowhere** (all *p* ≥ .152, §4.2.1). `design-brief.md` §A2 states the
consequence plainly: *"adding agents buys pressure, not credibility — there is no learning
argument for a bigger group."* MASG has never been a reason to have two agents. It has only ever
been the reason not to have three, and the source of the rules that make two safe.

That matters for the decision in a way that is easy to miss: **dropping the group does not lose
the MASG citation.** It changes what the citation does. "We use one agent because adding agents
buys normative pressure without informational gain (Song et al. §5.1, §4.2.1)" is a legitimate —
arguably crisper — use of the same paper.

### A4. (iv) Mechanics that depend on a group

| Mechanic | Why it needs a group | Status under the pivot, *before* this decision |
|---|---|---|
| **Whisper as a private side channel** | Dennis et al. 2010's *invisible whispering* is defined against a **meeting with other participants**: silent interactivity (engage without taking the floor), polychronicity (parallel conversations), and the benefits of *participation* and *politeness* (a channel less rude than interrupting). The product line is literally *"Private with Ellie · Max can't see this"* (`product-design.md` §C6). | **Kept**, relocated to a private *layer* (`pivot-spec.md` §B5). Its referent is now ambiguous: private from *Max*, or private from *the document*? Flagged in `pivot-integrated-document.md` §H Q4 as an unresolved ephemerality question. |
| **The relay** — the developer's own contribution | Critique 1 Suggestion 1 closes a named gap in Dennis et al.: private asides becoming *"agreed points worth interrupting the main meeting"*. The attribution choice (*raise it as my question* / *let Ellie raise it as her own*) serves the lurker — someone who cannot get air time **in a group**. | **Kept** as "promote into the shared margin" (`pivot-spec.md` §B5). |
| **Silence-fill by *the other* agent** | `design-brief.md` §D3: *"The Challenger never fires the timer. Being pressed for silence by a sceptic is the fastest route to the evaluation apprehension the design is built to avoid."* Implemented as `orchestrator.ts` `rule:silence_peer`. With one voice there is no other agent to fire it. | **Kept**, idle redefined (`pivot-spec.md` §B8). |
| **The disagreement quota's visibility (S2)** | Two voices, adjacent, visibly differing. | **Weakened and patched**: `pivot-spec.md` §B10 requires disagreement to be **co-located** — same thread, adjacent — or it does not count toward the quota. New accounting, new tests. |
| **"Two voices, never a chorus" (P2, S1)** | A cap on a count. | **Weakened and patched**: `pivot-spec.md` §B10 adds a *spatial* cap, because three notes stacked beside one paragraph read as a chorus even though they arrived minutes apart. |
| **"Show the room · p. N"** | Posts the page *to the group*. | **Already deleted** by `pivot-spec.md` §D7 — *"it is what the whole app now does"*. |
| **The round card** ("You'll explain it to the group… they'll disagree with each other sometimes") | Introduces a cast. | **Already deleted** by `pivot-spec.md` §D7; its copy becomes a first-open strip. |

### A5. (v) Mechanics that survive with one agent, untouched

- **The Explanation Ledger and all five gates** (`ledger.ts`, 228 lines). The `defended` gate is
  the one people assume needs two agents. It does not: it gates on *the Challenger having probed
  that element* — `ledger.ts` reads `challenges[]` off the turn decision, and `actor.ts` writes
  `challenged_element_ids` only `if (decision.role === 'challenger')`. A single agent in
  Challenger **mode** supplies exactly that. The only casualty is the label string
  `"defended against Max's probe"` (`actor.ts` ~l.865–878).
- **The silence timer** (`timer.ts`, 249 lines, 13 unit tests): 45 s / 90 s, typing-aware,
  `HOLD_MS`, `LATE_FIRE_CUTOFF_MS`, ≤2 fires per round, Hold, Wait for me.
- **Reply latency** — and note that Tan et al. 2026 studied **a 1-to-1 assistant**, not a group
  (`design-brief.md` §A3 says so explicitly: *"Do not conflate the two"*). The latency evidence is
  a *single-agent* result.
- **Theo's teach-back** — by design Theo **never co-occurs** with the other two
  (`design-brief.md` §D1: *"invited, not present"*; `product-design.md` §A P2). It is already a
  one-agent interaction.
- **Ask-in-place** (`pivot-spec.md` §B1) — the inserted answer is authored by a neutral
  `REFERENCE` voice, *"deliberately not one of the three personas"*.
- **The coverage map / gutter glyphs** (`pivot-spec.md` §B7), the learner-first/learner-last rules
  (P1, R3), the vault/FTS/pdf.js stack, the whisper-scoping leak-canary test, the room actor's
  mailbox, cancellation and recovery, and the `ScriptedClient`.

### A6. What the mandate actually touches — stated plainly

`Academia/New Idea/CS3249 Revised Idea.md` is twelve lines. It says: integrate the AI conversation
with the PDF rather than putting them side by side; (0) the PDF must become modifiable, high
fidelity, with state saving; (1) select a portion and ask, with the result **inserted into the
document**; (2) — the list stops there, unfinished.

**The mandate names no agents, no roles, no roster, and no group.** Read literally, it touches
none of (i)–(v). It is a statement about *where the conversation is drawn*.

What actually strains the group idea is not the mandate but what follows from it once it is
specified — and that is already written down in this repo, by the exploration that preceded this
one: `pivot-integrated-document.md` §E1 marks five mechanics **Weaker** (silence timer, latency
legibility, turn-taking across parallel threads, the disagreement quota's visibility, the
anti-chorus safeguard) and four of those five are group mechanics. So the honest framing for
Lucas is:

> The new idea does not forbid the study group. The *document* makes four of the group's five
> supporting rules harder to enforce and one of its two rhetorical claims harder to defend.

---

## B. Compatibility with the mandate

### B0. The honest answer, in one sentence

**"Conversation inside the document" is not incompatible with two agents. It is incompatible with
a *room*.** Two anchored annotators with distinct jobs is a coherent, evidenced design. A study
group with a membership list, a floor, a round, a cast introduction and a social-pressure
narrative is a chat-shaped object that the document dissolves.

### B1. The four pieces of evidence, and what each does and does not say

**Joshi & Vogel, CHI 2026 — *Designing and Evaluating AI Margin Notes in Document Reader
Software*** (arXiv 2509.09840; `pivot-integrated-document.md` §C16). Three controlled experiments.
Findings: participants **preferred integrated margin notes over chat**; participants **preferred
selecting the text themselves** over AI-chosen selection; **lower AI involvement produced stronger
psychological ownership**; and — the null that must be reported — **degree of AI involvement had
no measurable effect on reading comprehension at a 2 h delay**.

*What it says about the roster:* **nothing.** It is a single-agent system. It is evidence for the
pivot (integrated beats chat), against pre-annotation, and for DG1 (the learner writes first). It
is often read in this project as an argument for one agent. It is not. It is an absence of
evidence, and the report must not treat it as opposition.

**Fang et al. (arXiv 2510.15234; §C17).** Covered in §A1. *N* = 46, two weeks, no-agent vs single
vs multi-agent, in a PDF viewer. **Multi-agent → more active engagement and more comparing of
perspectives.** Single-agent → more reflective annotations. This is the only direct evidence, it
points toward two agents in a document, and it is a preprint.

**Houde et al., IUI '25 (Koala)** (`pivot-integrated-document.md` §B). Two studies, 18 IBM
employees in six pre-existing groups of three. **13 of 18 (72.2%) preferred the *reactive*
variant.** The proactive one "jumped in at the wrong times, wrote too much, responded too
frequently"; P6.2: *"Koala dominated the conversation. It felt like a pedantic student who
wouldn't create space for others to participate."* And the result that transfers hardest:
participants who **predicted threading would reduce distraction found, having tried it, that it
detracted from their ability to collaborate** — and *margin notes are threads*
(`pivot-integrated-document.md` §B4(a)).

*What it says about the roster:* **it is the strongest argument against the full group in a
document, and it is an argument about rate, not about count.** One agent that speaks too often
already produced "pedantic student". Two agents double the rate at which that failure can occur
per learner turn, and in a document the failure is durable — a chat message scrolls away, a badly
placed note sits in the learner's own file until removed (`pivot-spec.md` §B11). Houde's answer is
not "fewer agents"; it is **learner-operable participation controls**, which
`pivot-spec.md` §B11 already specifies (reject, per-agent mute, quiet/normal/more, write-scope,
length caps).

**Song et al. 2025 (MASG).** Pressure rises with agent count: 3% → 12% → 20%. In a chat that is
*temporal* co-presence. In a document it becomes **spatial**: `pivot-integrated-document.md` §E1
and `pivot-spec.md` §B10 both name the new failure — *"three notes stacked beside one paragraph
look like a chorus even though they arrived minutes apart. Spatial adjacency manufactures the
group identity S3 bans."*

*What it says about the roster:* the MASG risk **does not go away in a document; it changes
medium and becomes permanent.** A chorus you can scroll past is not a chorus you have to delete.
This cuts against Option 3 and is the reason the spatial cap in §B10 is non-optional if two agents
are kept.

### B2. The version of the group idea that fits a document

**Two role-distinct annotators.** Concretely, and each item is already specified somewhere in this
repo:

1. **Two contracts, not two members.** A Peer voice and a Challenger voice, each with its Xu et
   al. contract (`prompts.ts#roleBlock`), writing into **one anchored margin thread**
   (`pivot-spec.md` §B4). No roster screen, no presence chips, no cast introduction.
2. **One floor, document-wide.** `pivot-spec.md` §B0 R2 / §D4 G1: at most one agent turn in
   flight anywhere in the document, taken as a token before generation, released on post or
   cancel, and a refused turn is **dropped, not queued**.
3. **Disagreement only when co-located.** `pivot-spec.md` §B10: a disagreement counts toward the
   quota only if it is two notes in the *same* thread, adjacent. A disagreement twelve pages apart
   is never seen.
4. **A spatial anti-chorus cap.** ≤1 un-replied agent note per anchor, ≤2 per page, never two
   agent notes adjacent without a learner turn between them (`pivot-spec.md` §B3, §B10).
5. **Houde's controls, shipped.** Reject a note (mandatory), per-agent mute per document,
   quiet/normal/more, write-scope defaulting to *only on regions I select* (`pivot-spec.md` §B11).
6. **No pre-annotation, ever.** R1. Joshi & Vogel's "learners preferred selecting the passage
   themselves" plus Houde's proactive-variant result plus `pivot-integrated-document.md` §B4(d)
   (*"Do not ship pre-annotation"* — Scholarcy's Robo-Highlighter is the anti-pattern).
7. **The rhetoric changes.** In the report they are *two annotators with different jobs*, not *a
   study group*. Song et al. appears as the reason the count stops at two and the cohesion cues
   are banned — a safeguard, not a mechanism.

### B3. The version that does not fit

- **"The room."** The status-bar roster (`Ellie ● Max ● (Theo —)`, `product-design.md` §B), the
  round card that introduces the cast, "Show the room · p. N" (already deleted), and the framing
  of a session as *a conversation you are in* rather than *a document you are working*.
- **The temporal round.** `pivot-integrated-document.md` §E1 and §H Q3: a round is temporal, a
  document is spatial, and four rules hang off it (≤2 silence fires, the S2 quota window, the
  ledger gate, whisper clearing). `pivot-spec.md` §B8 resolves it by reading "round" as "page" —
  which works, but it is a re-definition, not a survival.
- **The social-pressure claim as a *feature*.** Any sentence of the form "the group creates
  productive pressure" is unsupportable: Song et al. found no informational gain at any group
  size, and in a document the pressure is permanent. DG5 already forbids this
  (`design-brief.md` §E: *"Engagement is earned by making the conversation worth participating
  in… never by making non-participation socially costly"*). Keep the prohibition; drop the
  vocabulary.
- **Whisper framed primarily as *being invisible from the other agent*.** In a room that is the
  point. In a document the more defensible framing is the **layer**: private from the shared
  document — the artefact you would show a tutor (`pivot-spec.md` §B5). Both framings can be
  true; only the second survives a drop to one agent.
- **A third voice, ever.** Unchanged. Theo stays invited-only and mutes the others
  (`pivot-spec.md` §B6).

### B4. The one thing that decides the marks case

The assignment brief is explicit, and it is the sentence most likely to be overlooked:

> *"Voice, video, multimodal, or agent-based systems do not receive automatic bonus marks compared
> to a text-only chatbot."* (`assignment1-brief.txt`, "What counts as a CUI?", note 1.)

So the second agent earns nothing for existing. It earns marks only through the 4.0-mark *Learning
Design* criterion — *"design goals must be rooted in established communication and learning
theories as well as empirical user needs"* — i.e. **only if the two voices carry a theory that one
voice cannot.**

Xu et al. cannot supply that theory: its role effects are single-agent, and its own design
implication is a *sequence*. Song et al. cannot supply it: it is a risk paper with no
informational benefit at any group size. Dennis et al. supplies it *for the whisper channel*, and
only while there is another agent to be invisible from. That leaves **Fang et al.** as the sole
load-bearing citation for two-in-a-document.

**One preprint is the entire marks case for the second agent.** That is the fact the decision
should turn on, and it is stated here so it cannot be discovered in the middle of writing Step 2.

---

## C. The cost of dropping — and of keeping

Throughout: **"dropping"** means going to one agent with switchable modes (Option 1 in §D).
Option 2 — keeping two agents but dropping the social-group framing — costs a strict subset, and
is marked where it differs.

### C1. Report and research cost

#### C1a. Which design goals lose their theory

`design-brief.md` §E has five goals. §E itself says **DG1, DG2, DG4 are the non-negotiable three**
and that three is what fits the 2,000 words. That is the first mercy in this whole assessment: the
report was never going to carry all five.

| Goal | Theory it rests on | Effect of dropping to one agent |
|---|---|---|
| **DG1** — produce justification, not answers | Self-explanation effect (Chi et al. via Xu §2.1); cognitive conflict | **Untouched.** Single-agent evidence throughout. |
| **DG2** — cognitive conflict without evaluation apprehension | Piaget; Socratic method (Paul & Elder); ZPD; low social presence (Short et al.) stripping evaluation apprehension | **Untouched**, and it *strengthens*: the 5.62 / 2.93 pair is a Challenger-alone result. Only its realisation clause *"Peer present as a counterweight (S2)"* is lost. |
| **DG3** — safe enough to be wrong in | Edmondson's psychological safety; socially shared metacognition; SDT relatedness | **Mostly survives as a mode.** Peer's numbers (absorption 5.10, pressure 2.49) are single-agent. What is lost is the *simultaneity* argument — the idea that a supportive voice is present while the demanding one presses. With modes the learner gets safety and challenge in sequence, not at once. One sentence of the report changes; the theory does not. |
| **DG4** — a low-cost, private way to participate | **Dennis et al. 2010 invisible whispering** — silent interactivity, polychronicity, ephemerality, online presence; delivering participation, satisfaction, efficiency, politeness. Plus Critique 1 T4 and Suggestion 1. | **This is the casualty.** See below. |
| **DG5** — buy engagement with quality, never social pressure | **Song et al.**: normative vs informational influence (Deutsch & Gerard); reactance; computer-created social norms. Realised as S1–S8. | **Loses its paper as a design goal.** S1 (cap at two), S2 (quota), S3 (cohesion cues) become vacuous with one agent; S4–S8 survive (hedge uncertainty, slide-as-arbiter, preemptive/restorative framing, learner closes, "I still disagree" affordance). What is left is a goal about *not scoring and not gamifying* — real, but grounded in P5 and Xu et al. §6.1.3 rather than MASG. |

**DG4 in detail, because it is the expensive one.** Dennis et al.'s two strongest reported benefits
are **participation** ("members who cannot get air time engage at the sidelines") and
**politeness** ("a channel to seek support that is less rude than interrupting"). Both are defined
relative to *other participants*. With one agent:

- *Silent interactivity* survives (ask without taking the floor of the shared document).
- *Ephemerality* survives — and is already in tension with a document that saves everything
  (`pivot-integrated-document.md` §A0, §H Q4).
- *Polychronicity* survives thinly (a private layer parallel to the shared one).
- *Participation* and *politeness* **do not survive intact.** There is no one to be polite to.
- **The relay loses half its meaning.** Its attribution choice — *raise it as my question* vs
  *let Ellie raise it as her own* — exists because the second option lets the lurker get a question
  into the group without exposure. With one agent, "let the agent raise it as its own" is the agent
  raising it with itself. `pivot-spec.md` §B5 keeps the relay as promote-to-shared-margin, which is
  a real gesture (private → the artefact you would show a tutor), but it is a **weaker** version of
  Critique 1 Suggestion 1, which was explicitly about *"formally raising points from informal
  discussion in Invisible Whispering"*.

And DG4 is not just a goal. `design-brief.md` §B2 nominates **the approved whisper relay as the
"one important design decision" for the video**, on the grounds that it is the developer's own
contribution — *"it is evidence of ownership, which is worth a mark on its own"* (§E DG4,
*Provenance*). §G1's video table says the same. So the drop puts pressure on **2 of the 5 video
marks** (project-specific explanation and reasoning) plus the 1 ownership mark.

*Under Option 2 this cost is zero.* Two agents keeps "nothing here reaches Max unless you send it
over" literally true (`prompts.whisper.ts`, `script.psd-hessian.ts` whisper:1, `product-design.md`
§C6).

#### C1b. Which interview probes become irrelevant

`interview-guide.md` §6a and `instruments/question-bank.md` block G:

| Probe | Code | Status if the group is dropped |
|---|---|---|
| "Have you been in a group chat where several people agreed on something and you weren't sure, but you let it go?" (§6a; G6) | `GRP-CONFORM` | **Dead.** It exists only to evidence Song et al.'s pressure risk. Its synthesis-sheet row ("Ever stayed silent against a confident group consensus") and its note-template line go with it. |
| "When someone answers wrong in the group and you think they're wrong — do you say so?" (§6a; I-G5) | — | **Dead** as stated; salvageable as evidence for DG2 (why they don't push back on the *AI*). |
| "Do you ever DM one person instead of asking the group? What kind of thing gets DM'd?" (§6a; G4, G5) | `GRP-DM`, `GRP-DM-CONTENT` | **Survives only as far as whisper survives.** Under Option 1 it grounds a private *layer* but the inference is longer and weaker. |
| "how often do you ask a question versus just read?" / "what fraction of the questions you have do you actually post?" (§6a; G2) | `GRP-LURK` | **Survives.** It evidences a disposition (holding back questions that look basic), which grounds the private layer and DG3 regardless of roster. |
| §6c concept description: *"group chat, you explain to 2–3 AI study-mates with different personalities… one pushes back, one is a peer… you can whisper to one privately"* | first-objection quote | **Must be re-described.** This is the probe that produces the verbatim objection `design-brief.md` §B2 nominates as the video's "one current limitation". If the interviews have already run with this description, the objection was collected about a product that no longer exists. |
| §6a direct probe: *"a chat with three AI study-mates… a private side channel to just one of them that the others can't see"* | `CONC-WHISPER` | **Dead as worded** under Option 1. |

**The timing problem, stated as a risk.** The interview window is 14–18 Sep
(`design-brief.md` §B0). If the sessions are already run, dropping the group afterwards means
(a) one whole probe block returns data for a discarded feature, and (b) §6c's objection quote —
the intended video limitation — is about the wrong product. Recoverable: `pivot-spec.md` §F3
already defines a **3-question async follow-up for 1–2 participants**. But it must be run, and it
must be disclosed in the report. See §E Q1.

#### C1c. What the novelty claim becomes

`competitor-notes.md` headline: *"No shipping education product puts two or more distinct AI
personas into one conversation with a learner."* Plus three unoccupied gaps: two personas in one
learner chat; a whisper side channel ("**likely ChatterED's most novel component**"); deliberately
delayed replies as pedagogy.

Dropping to one agent forfeits the first. What remains — and it is more than it looks:

1. **`pivot-integrated-document.md` §C0's claim, which is already stronger and better evidenced:**
   every shipped system either **keeps the conversation and inserts only a citation pointer**
   (Acrobat AI Assistant, NotebookLM, SciSpace, Explainpaper, Humata, ChatDOC) or **inserts the
   artefact and lets the conversation evaporate at Accept** (Notion AI, Copilot in Word, Gemini in
   Docs, Lex). *Nobody makes the anchored thread the object.* §C21 point 1 already recommends
   retargeting the novelty claim here. **This claim does not depend on the roster.**
2. **The whisper / private layer** — still unoccupied, weakened but not gone.
3. **Pacing as pedagogy** — unoccupied; nobody markets it (Character.AI's paid tier sells
   *faster* replies).
4. **The ledger's `defended` state** — a terminal state unreachable without a challenge. No
   product has this.

**How a single-agent in-document CUI still differs from Joshi & Vogel.** This is the sentence the
report needs, so it is spelled out:

- **Direction of authorship is inverted.** Their margin notes are *AI-authored annotations on the
  reader's document*: the AI explains, the reader reads. ChatterED's rule R1/P1 is that **the
  learner writes the first note** and no agent may write on a region the learner has not selected.
  Their own finding — lower AI involvement produced more ownership — is an argument *for*
  ChatterED's direction, made by them.
- **The note is a thread, not a note.** They evaluate single AI annotations; ChatterED requires
  **≥4–6 alternating turns on one anchor** (`pivot-integrated-document.md` §F2), which is also what
  makes it rubric-legal as a CUI.
- **A different outcome construct.** They measured **reading comprehension at a 2 h delay and
  found no effect of AI involvement**. ChatterED's construct is *defended explanation* — the
  ledger's `●`, unreachable without a Challenger probe. `pivot-integrated-document.md` §C21 point 4
  is right that stating their null and explaining the difference is worth more than the words it
  costs.
- **A progress mechanism and a private layer**, neither of which they have.

So: the novelty claim narrows from "two personas + anchored thread" to "anchored thread with a
state, learner-first". That is still a claim nobody else occupies.

#### C1d. What the evaluation plan loses

`evaluation-plan.md` §2 has five RQs. Dropping the group **deletes RQ1 entirely** — one of the two
factors in Study A:

- **H1a** (primary, process) — Group produces more metacognitive acts per message than Single.
- **H1b** (primary, experience) — Group yields higher Learning Absorption and Interest/Enjoyment.
- **H1c** (primary, risk) — Group yields higher perceived normative influence and more
  *Concession-without-justification*. The plan calls this *"the hypothesis this project most wants
  to be false"* and makes it primary **so that a null cannot be quietly claimed as safety**.
- **H1d** (secondary) — no pre→post gain difference.
- **H1e** (secondary) — higher perceived critical thinking and competence.

Also lost: the `CONCEDE-NJ` **social-pressure alarm** and its pre-set decision rule (§6.4: *"if it
exceeds DEFEND in the Group condition, report H1c as supported and recommend the MASG mitigation of
a dissenting agent"*). And §4.2's *Single condition = Max (Challenger) only* stops being a
comparator and becomes the product.

Two honest counterweights:

1. **Dropping to one agent *answers* H1c by construction rather than testing it.** Song et al.'s
   own data puts 1 agent at 3% felt pressure. Choosing one agent is choosing the safe arm. That is
   a defensible A2 story, not a hole — but it does mean the project stops being able to say
   anything about the risk it spent a page describing.
2. **RQ1's apparatus is replaceable at low cost** by a within-subjects **mode** question: does a
   learner-switchable Peer/Challenger mode produce a different act profile than a fixed Challenger?
   Same instruments (Xu et al.'s coding scheme, IMI, FSS), same *n*, cheaper (within-subjects, one
   agent), and it tests Xu et al. §6.3(1)'s sequence recommendation directly — which nobody has
   done. Under Option 2, RQ1 survives unchanged.

#### C1e. What must be rewritten, document by document

| Document | Sections affected | Size |
|---|---|---|
| `design-brief.md` | §D1 (three agent specs → two mode contracts; the Theo argument survives). §D2 turn rules 2, 3, 4, 7 become vacuous or change (4 of 7). §D3 — *"the Challenger never fires the timer"* needs re-stating as *"the timer always fires in Peer mode"*, which is arguably cleaner. §D5 whisper table ("invisible to the other agent"). **§D6 in full — the risk section and all eight safeguards, ~1 page.** §E DG5 deleted or re-grounded; DG4 re-grounded. §G script turns 3, 8, 10 (turn 10 *is* the mandated disagreement). §G1 loses the "anti-manipulation safeguard" row. §H Q4, Q6. | **Largest.** ~2–3 h |
| `product-design.md` | §A **P2 "Two voices, never a chorus"** deleted or rewritten. §B status bar roster. §C2 roster + name/gender pairing. **§C4 — the whole disagreement-rendering spec (~1 page: the marker, the three variants, the connector rule, "there is deliberately no way to render agreement")**. §C6 whisper presence copy. §E the four-channel voice table. Settings' pairing radio. | ~2 h |
| `pivot-spec.md` | §B2's canonical 6–8 turn shape (turns 2/4/6/7). §B3 (Max's probe → a Challenge mode). §B5 (addressee segmented control). **§B10 — two of three amendments (S2 co-location, S1 spatial cap) delete outright.** §B11 per-agent mute → one switch. §D4 gate G2 simplifies. §D6 script-beat mapping. | ~1.5 h |
| `evaluation-plan.md` | §1 table row 1; §2 RQ1 (H1a–H1e); §4.2 agents; §6.4 `CONCEDE-NJ`. | ~1 h |
| `competitor-notes.md` | Headline claim and "Feature implications" items 1 and 5. | ~0.5 h |
| `interview-guide.md` / `question-bank.md` | §6a probes, §6c description, note template, synthesis sheet rows, codes `GRP-CONFORM`, `CONC-WHISPER`. | ~1 h |

**Report-rewrite total: ~8–10 h of writing.** But note what actually reaches the 2,000-word
submission: three design goals, one safeguard table in an *appendix* (excluded from the count), the
§G script and its annotations. **Of the 8–10 h, perhaps 2 h is load-bearing for the graded
artefact.** The rest is repo hygiene, and repo hygiene does not earn marks.

### C2. Code cost

Counted against `app/src/room/` (3,990 lines across 20 files) and the renderer. Hours are for
Lucas working with an agent, including keeping the 267-test suite green.

| Area | Files | What goes / simplifies | Hours |
|---|---|---|---|
| **Roster** | `agents.ts` (107) | `rosterFor` returns one profile; `randomPairing`, `RolePairing`, the install-time pairing setting and its IPC, and the gender-balance justification all go. `ROLE_COLOUR` / `LATENCY` / `VERB` / `ROLE_LABEL` survive as **mode** tables. | **1** |
| **Orchestrator rules** | `orchestrator.ts` (189) | `DISAGREEMENT_QUOTA = 5`, `agreementRun`, `mustDisagree`, `TurnDecision.disagreement` all go. `MAX_CONSECUTIVE_AGENT_TURNS = 2` **stays** in weaker form (one agent must still not post twice in a row). `DECISION_SCHEMA.role` (`peer`/`challenger`) becomes `mode`, which changes the JSON schema, the parse path and `rule:opener` / `rule:silence_peer`. | **2** |
| **Actor** | `actor.ts` (1,061) | ~12 `agentByRole(roster, …)` call sites; the disagreement envelope (`targetAgentKey`, `targetMessageId`, `#lastMessageIdByRole`); `agreement_run` bookkeeping (~l.609); the `"defended against Max's probe"` label (~l.865–878). **Highest-risk file — it is the room's only writer, and recovery/cancellation paths run through it.** | **2–3** |
| **Prompts** | `prompts.ts` (198), `prompts.whisper.ts` (39) | HOUSE RULES 2 and 4 and SAFEGUARDS S1, S2, S3 are all about *the other agent* — delete or rewrite (~½ page of prompt text). `roleBlock`'s `other` parameter and the Peer's closing clause (*"When Max presses too hard…"*) go. The whisper limits line loses its referent. **Changing `sharedBlock` changes the frozen prefix hash — existing sessions keep their old prefix, so no migration, but say so.** | **1.5** |
| **Context** | `context.group.ts` (95) | The `other` lookup and the roster cast rendering. The `GroupStore` / whisper separation is untouched — **do not open `context.whisper.ts` beyond the limits string.** | **0.5** |
| **Round card** | `roundcard.ts` (57), `roundcard.test.ts` (75) | `roomMates()` ("Ellie and Max"), the "disagree with each other" assertion. **`pivot-spec.md` §D7 already deletes this file** — under the pivot this cost is **0**. | **0** |
| **Scripted demo** | `llm/script.psd-hessian.ts` (223), `llm/scripted.ts` (122) | 8 beats (`open`, `student:1…5`, `silence:1`, `silence:2`) + 2 whispers + the round card. `open`/`silence:*` are Peer; `student:1` and `student:4` are Challenger. Under one agent the machinery still runs — only labels change — **but design-brief §G turn 10 (Ellie pushing back on Max) must be rewritten or cut**, and the round card's "they'll disagree with each other sometimes" goes. This is the **video's insurance policy**, so budget a full end-to-end re-verification. | **1–2 (+1 verify)** |
| **Tests** | `actor.test.ts` (407), `context.test.ts` (250), `roundcard.test.ts` (75), `ledger.test.ts` (149), `timer.test.ts` (153) | Roster fixtures in `context.test.ts` (l.76–214) are mechanical. `actor.test.ts` carries the disagreement and Theo assertions. `ledger.test.ts` and `timer.test.ts` should not need touching. Orchestrator has **no dedicated test file** — its rules are exercised through `actor.test.ts`, which is a latent risk when editing them. | **1–2** |
| **Renderer** | `Message.svelte`, `StatusBar.svelte`, `Settings.svelte`, `FirstRun.svelte`, `Room.svelte`, `WhisperPane.svelte` | The `replying to Max` chip, the `↔ pushes back on` marker and its connector rule (`product-design.md` §C4); the roster presence chips; the Settings pairing radio; the first-run "who you'll be talking to" screen. `RoundCard.svelte` and `RecapCard.svelte` are already slated for deletion. | **2–3** |

**Code total: ~11–15 h ≈ 1.5–2 working days.**

**The asymmetry that decides this.** *Keeping* the two agents costs **zero hours of code** — it is
built, tested, and the pivot spec's §D8 explicitly lists `prompts.ts`, `agents.ts` and the personas
under **"what is kept untouched"**. Dropping is a **net cost inside the seven days**, not a saving.
Whatever else is true, "drop it to save time" is false.

### C3. Asset cost

- **Agent names.** Ellie / Max / Theo appear in prompts, the script, the round card, the whisper
  copy, the recap, the first-run screen, `product-design.md` §E's justification, and every
  research doc. Under Option 1 one name survives and the gender-balance argument
  (`agents.ts` header, `product-design.md` §E) is deleted.
- **The icon.** `app/assets/AppIcon.svg` is **literally two speech bubbles** — the source comments
  read `<!-- Challenger bubble (back, indigo-tinted) -->` and `<!-- Peer bubble (front, white) -->`.
  One agent means a redraw plus regenerating `AppIcon.png` and `AppIcon.icns`. Not on the marks
  critical path; it *is* on camera.
- **Copy.** The round card, the first-run "who you'll be talking to" screen, the whisper limits
  line (*"nothing here reaches Max unless you send it over"*), the status bar, the `pushes back on
  Max` marker, the Theo invitation (*"Ellie and Max will sit it out"*), and `product-design.md`
  §E's four-channel voice table.

**Assets total: ~2–3 h** including the icon. **Under Option 2: ~0.5 h** (only the round card's
group language and the "room" vocabulary).

### C4. The cost of KEEPING it under the pivot

This is the number that has not been priced anywhere, and it is the fair comparison.

| Work item | Why two agents causes it | Where specified | Hours |
|---|---|---|---|
| **Parallel-thread turn-taking** | `design-brief.md` §D2 was written against *one ordered stream*. A document has N threads and therefore N floors, and the rules stop binding. Needs a document-wide in-flight token (R2 / gate G1), taken before generation and released on post **or** cancel, with refused turns **dropped, not queued**; plus "exactly one thread is active at a time". New orchestrator state: `inFlight`, `unrepliedOnAnchor`, `unrepliedOnPage`. **This is a concurrency invariant, so it is the highest-risk new logic in the pivot.** | `pivot-spec.md` §B4, §B10, §D4 | **4–6** |
| **Spatial chorus safeguard** | Three notes beside one paragraph read as a chorus though they arrived minutes apart. Needs ≤1 un-replied note per anchor, ≤2 per page, never two agent notes adjacent without a learner turn between — in code *and* in layout. | `pivot-integrated-document.md` §E1; `pivot-spec.md` §B3, §B10 | **2–3** |
| **S2 co-location accounting** | A disagreement twelve pages apart is never seen, so the quota counter must accept only same-thread, adjacent disagreements — new accounting plus `disagreementOnAnchor` plus orchestrator tests. | `pivot-spec.md` §B10, §D4 | **1–2** |
| **Latency legibility, doubled** | Two hues, two verbs (*Max reads/thinks*, *Ellie types*), two possible reserved slots and two possible off-screen breadcrumbs — though R2 guarantees only one at a time. §B9 needs three devices (anchor ring, reserved slot, breadcrumb) regardless; the second agent adds the per-agent chrome. | `pivot-spec.md` §B9 | **~2 extra** |
| **Per-agent Houde controls** | Per-agent mute and the `Ellie ▢ / Max ▢` popover exist *because* there are two. With one agent this is a single on/off. | `pivot-spec.md` §B11 | **1–2** |
| **Video filmability** | `pivot-integrated-document.md` §F5: *"A margin conversation is harder to film than a chat… Turns scattered across a scrolling page in different columns lose the viewer within two exchanges."* Two speakers is precisely what makes that hard. The mitigation (one passage, one page, do not scroll during a turn) is discipline, not code. | §F5 | **risk, not hours** |

**Keeping-cost under the pivot: ~10–15 h of *new* work a single agent would not need** — the same
order as the cost of dropping, but spent on **Wed 17 / Thu 18**, i.e. straddling the Thursday
fallback gate, which is the worst possible place to put the riskiest code.

Set against that, the benefit of keeping: Fang et al.'s engagement-and-perspective-comparison
result, and the fact that `pivot-integrated-document.md` §C21 point 3 says without it *"'why two
agents in a margin?' is an unanswered question in the report."*

### C5. "Is it too late?"

#### What is sunk

The two-persona roster and its install-time gender-balanced pairing; the disagreement machinery
end to end (orchestrator quota → actor envelope → renderer marker → `product-design.md` §C4's
one-page rendering spec); the S1–S8 safeguard table and `design-brief.md` §D6's ~1 page of
argument; DG5; the §6a group-consensus probe block and §6c's concept description; the second
bubble in the icon; and `evaluation-plan.md`'s RQ1 apparatus (H1a–H1e, `CONCEDE-NJ`, §4.2's
comparator design).

Sunk is not the same as wasted. Two of these convert rather than vanish:

- **Song et al. converts.** "We use one agent because adding agents buys normative pressure without
  informational gain (§4.2.1: normative significant everywhere, informational nowhere; §4.2.2:
  3% → 12% → 20%)" is a *stronger* use of the paper than a safeguard list, because it is a
  design decision justified by evidence rather than a mitigation of a decision already made.
- **The §D6 risk analysis converts** into a one-paragraph *rationale* for the roster choice, which
  the 4.0-mark criterion rewards (*"ensuring every design choice and architectural decision is
  thoroughly justified"*).

#### What is reusable whatever is decided

Everything in §A5. Specifically: `timer.ts` (249 lines, 13 unit tests, sleep/quit/relaunch
recovery), `ledger.ts` (228 lines, five gates including `defended`), `actor.ts`'s mailbox,
cancellation and recovery, `context.whisper.ts` + the leak-canary import-graph test, the latency
floors and the 8 s floor-yield window, the vault / FTS5 / pdf.js stack, `ScriptedClient`, and the
SQLite migration+repository layer. Plus, on the research side, **all of Xu et al.** (never a
two-agent result) and **all of Tan et al.** (a 1-to-1 assistant study).

#### The 22 Sep deadline — 7 days

`pivot-spec.md` §E is a day-by-day plan with a **hard Thursday gate**: if a full scripted exchange
is not playing in the margin by end of **Thu 18**, fall back to Option N tonight.

- Tue 16 — migration, anchors, box-select
- Wed 17 — block canvas / margin column
- **Thu 18 — threads through the real actor ⟵ FALLBACK GATE**
- Fri 19 — coverage, pacing, privacy controls
- Sat 20 — demo path + sidecar
- Sun 21 — record
- Mon 22 — report

A roster change is **1.5–2 days of code**. It fits before Tue 16. It does **not** fit after Thu 18,
and dropping it into Wed/Thu would consume the gate itself. **So the answer to "is it too late?" is
precise: not today; effectively yes from Thursday.** The decision has a deadline of roughly
**Monday night / Tuesday morning**, and this document exists so that it can be made then.

#### What the video must still show — and why it is indifferent to the roster

The video is **5 of 16 marks** (2 demonstration, 2 project-specific reasoning, 1 ownership) — more
than the prototype's 3. `pivot-integrated-document.md` §F2 and `pivot-spec.md` §F list what it must
contain:

1. **≥ 4–6 alternating turns in one place**, on one anchor, on one page — *"Not four one-shot
   insertions on four different pages — that is four single-turn interactions, and it fails Step 4
   however good it looks."*
2. **Each agent turn visibly shaped by the previous learner turn**, quoting the learner's own
   words (the ledger already requires verbatim learner evidence).
3. **State changing as a consequence** — the gutter glyph moving ○ → ◐ → ● in shot.
4. **The learner closing.**
5. Face visible; the learner's own explanation as the first thing on screen, not an AI writing a
   paragraph into a PDF (§F5 point 4).

**Not one of those five requires two agents.** One anchor and six turns satisfies all of them. The
marked deliverable is roster-indifferent — which is the single most decision-relevant fact in this
document, and it cuts both ways: the group buys no marks, and dropping it loses none, *except*
through the theory-grounding clause discussed in §B4 and the whisper's ownership story in §C1a.

---

## D. Three options and a decision matrix

### D0. The options, precisely

**Option 1 — One agent, switchable Peer / Challenger modes.**
One voice, one name, one hue. The learner (or the orchestrator) switches its contract: Peer mode
acknowledges and asks for elaboration; Challenger mode acknowledges and lands exactly one Socratic
probe. `DECISION_SCHEMA.role` becomes `mode`. The timer always fires **in Peer mode** — which is a
cleaner statement of `design-brief.md` §D3's rule than "the Challenger never fires the timer". Theo
survives unchanged (he was always alone). Whisper becomes a private *layer* vs the shared document.
S1–S3 and DG5 go; S4–S8 stay. Xu et al. §6.3(1)'s *sequence* becomes the literal mechanic.

**Option 2 — Two role-distinct annotators; drop the social-group framing, the room, the quotas and
the pairing.**
Both voices stay and both contracts stay. What goes is the *rhetoric and the ceremony*: no roster
presence chips, no cast introduction, no "room", no temporal round, no "the group creates
pressure" claim anywhere in the report, and no gender-balanced pairing randomisation as a *study*
control (it can stay in the code as a one-line note, or go). MASG is cited once, as the reason the
count stops at two and cohesion cues are banned. S2 survives **only in its co-located form**
(`pivot-spec.md` §B10) and S1 survives **as the spatial cap**. Everything else in §B2's list ships.

**Option 3 — Keep the full group.**
The design as written: two standing agents, the social-group framing, S1–S8 intact, DG5 as a
design goal, the disagreement quota as a visible mechanic, the round card introducing the cast,
and the report arguing the group dynamic as a pedagogical feature.

### D1. Decision matrix

Scored for the seven days remaining and for 16 marks. **↑** better; **↓** worse.

| Criterion | Weight | **1 — one agent, two modes** | **2 — two annotators, no group framing** | **3 — the full group** |
|---|---|---|---|---|
| **Rubric fit** — *Learning Design 4.0: goals rooted in theory AND user needs; every choice justified* | ×3 | ↑↑↑ Every goal rests on refereed, single-agent evidence (Xu, Tan, Dennis-partial). Roster choice justified by Song et al. inverted. **No preprint in the load-bearing path.** | ↑↑ Same, plus one goal (perspective comparison) resting on Fang et al., a preprint. Two annotators are *defensible*, not automatic. | ↑ The social-group claim has to be argued against Song's own "no informational gain" and Houde's dominance finding. Most work per mark. |
| **Rubric fit** — *Prototype 3.0 + Video 5.0: one multi-turn exchange, tailored, progressive* | ×3 | ↑↑↑ One voice in a margin is the easiest thing in the world to film. | ↑↑ Filmable with discipline (one page, one anchor, camera still — §F5). | ↑↑ Same as 2; the extra voice adds no marks (brief: *"agent-based systems do not receive automatic bonus marks"*). |
| **Novelty** | ×2 | ↑↑ §C0's claim survives intact ("nobody makes the anchored thread the object"); loses "two personas"; whisper weakened. | ↑↑↑ §C0 **plus** two disagreeing personas in the margin of your own slides — the strongest combination available, and the whisper keeps its referent. | ↑↑↑ Same as 2; the extra framing adds rhetoric, not novelty. |
| **Risk to 22 Sep** | ×3 | ↓ A 1.5–2 day refactor of `actor.ts` / `orchestrator.ts` / prompts / tests **inside the build week**, plus re-verifying the ScriptedClient. | ↑↑ Zero roster work; the ~6–9 h of §B10/§B11 patches are already in `pivot-spec.md`'s Wed–Fri budget. | ↑ Same build as 2, but the report must also carry an argument that the pivot weakens. |
| **Code cost** | ×2 | ↓↓ **~11–15 h** (§C2), on the critical path. | ↑↑↑ **~0 h** for the roster; ~10–15 h of parallel-thread/chorus work that §C4 says is needed anyway once there are two voices. | ↑↑↑ Same as 2. |
| **Report rewrite** | ×2 | ↓↓ ~8–10 h across six documents, of which ~2 h reaches the graded 2,000 words. Loses DG5 outright, halves DG4, deletes RQ1. | ↑↑ ~2–3 h: delete the "room"/"study group" vocabulary, re-frame DG5 as a safeguard set, restate S1/S2 in co-located form. Nothing is deleted. | ↑↑↑ ~0 h — but the §D6 argument now has to survive a grader who knows Houde et al. |
| **Evidence strength** | ×3 | ↑↑↑ Everything refereed: Xu (CHI '26), Song (CSCW), Tan (CHI '26), Dennis (2010), Joshi & Vogel (CHI 2026, *supports* learner-first). | ↑↑ Same, plus Fang et al. — the only in-surface multi-agent evidence, and a preprint. Houde is a live counter-argument that must be answered with controls. | ↑ The social-group *benefit* claim has **no supporting evidence anywhere**; Song found normative influence with no informational gain. |
| **Answers the whisper/ownership story (video's "one design decision")** | ×2 | ↓↓ Dennis et al.'s *participation* and *politeness* lose their referent; the relay's dual attribution collapses. | ↑↑↑ Untouched — *"nothing here reaches Max unless you send it over"* stays literally true. | ↑↑↑ Untouched. |
| **Work thrown away** | ×1 | ↓↓ Roster, disagreement machinery, §C4 rendering spec, S1–S3, DG5, RQ1, half the icon. | ↑↑↑ Almost none — only the framing. | ↑↑↑ None. |
| **Verdict** | | Cheapest *report*, most expensive *week*. The fallback if the interviews came back empty on group behaviour. | **Recommended.** | Not recommended: pays the same build cost as 2 and buys an argument it cannot win. |

### D2. Recommendation — **Option 2**

Six reasons, in the order that should decide it.

1. **Dropping does not save time; it spends it.** The two agents are built, tested, and listed
   under `pivot-spec.md` §D8 *"what is kept untouched"*. Option 1 costs ~11–15 h of refactoring
   inside a seven-day week whose critical path (migration 009 → box-select → block canvas → margin
   threads → Thursday gate) has nothing to do with the roster. Any argument for dropping has to be
   a *quality* argument, because the efficiency argument runs the wrong way.

2. **The pivot breaks the framing, not the roster.** Of the five mechanics
   `pivot-integrated-document.md` §E1 marks **Weaker**, four are group mechanics — and
   `pivot-spec.md` §B4, §B8, §B9, §B10 already contain the fixes, written before this question was
   asked. What the pivot genuinely dissolves is the *room*: the presence chips, the cast
   introduction, the temporal round, "Show the room". `pivot-spec.md` §D7 already deletes three of
   those four. Option 2 is therefore mostly **a decision to stop writing sentences the code has
   already stopped supporting.**

3. **It keeps the whisper's referent, and the whisper is the ownership mark.**
   `design-brief.md` §B2 nominates the approved relay as the video's "one important design
   decision" because it is the developer's own contribution — a named gap in Dennis et al. 2010,
   reproduced and diagnosed in `/btw` (Critique 1 T4), and closed by a specific mechanism. That
   story needs a second agent to be invisible from. Option 1 asks Lucas to give up the one thing in
   the project that is unambiguously his, seven days out.

4. **The MASG citation gets better, not worse.** `design-brief.md` §D6 already says the paper is
   used *inverted*. Option 2 finishes the job: Song et al. becomes the justification for the cap
   ("adding agents buys normative pressure without informational gain — §4.2.1, §5.1") and for the
   two surviving safeguards (banned cohesion cues; co-located disagreement). A grader reading
   *"we read the risk paper and it told us to stop at two and to ban these five behaviours"* sees
   judgement. A grader reading *"a group of agents creates productive social pressure"* sees a
   paper misread.

5. **It answers Houde et al. the way Houde et al. asks to be answered.** Their finding is about
   **dominance and rate**, and their contribution is a **taxonomy of controls**. The reply is not
   "one agent"; it is R1 (no pre-annotation), R2 (one turn in flight document-wide), the density
   cap, reject-a-note, per-agent mute, and quiet/normal/more — all already specified in
   `pivot-spec.md` §B11. Shipping controls 1–3 is *"each under an hour of UI"*
   (`pivot-integrated-document.md` §E3) and converts the strongest counter-argument into a cited
   design decision.

6. **It is the honest description of what is actually built.** `app/docs/STATUS.md`'s rule is that
   *"a mechanic that carries a design decision is real"* and everything else is labelled. Two
   role-distinct annotators in an anchored margin thread is exactly what will be on camera on
   21 Sep. Calling it a study group is the claim that would need defending; calling it two
   annotators needs no defence at all.

### D3. The conditions under which Option 1 wins instead

State these now so the decision is not re-litigated on Thursday.

- **If the three interviews contain nothing about group behaviour** — no lurking fraction, no
  DM-vs-post distinction, no "stayed silent against a consensus" episode — then two voices is
  designer-led, the 4.0-mark criterion's *"empirical user needs"* clause is unmet for that goal,
  and Option 1's tighter evidence base is worth more than Option 2's richer one. **§E Q1.**
- **If Lucas will not cite a preprint as load-bearing** (§B4), the second agent has no theory of
  its own and should go. **§E Q3.**
- **If the Thursday gate is missed**, the fallback is `pivot-integrated-document.md` §G3 Option N
  (no pivot, fix the UI) — and under Option N the group survives untouched, because Option N *is*
  the chat app. Note the shape of that: **a failed pivot argues for keeping the group, not for
  dropping it.**

Option 1 also has one genuine pedagogical advantage that should be recorded rather than dismissed:
**a mode switch is literally Xu et al. §6.3(1)'s recommended sequence** (*Peer to open →
Challenger to deepen → Tutee to close*), and Xu et al. never tested two roles simultaneously. If
Lucas wants the single cleanest theory-to-mechanism line in the whole project, Option 1 has it.

---

## E. Questions for Lucas

1. **Have the three interviews run, and do they contain §6a material — a lurking fraction, a
   DM-vs-post distinction, a "stayed silent against a group consensus" episode?** This decides
   whether two voices and the whisper are user-grounded or designer-led, and it is the same answer
   that decides four marks on the pivot (`pivot-integrated-document.md` §H Q1). If §6c's concept
   description has already been read to participants as *"2–3 AI study-mates"*, the objection quote
   earmarked for the video's "one current limitation" is about a product you may not be building —
   run `pivot-spec.md` §F3's three-question follow-up this week.

2. **Is the approved whisper relay still the video's "one important design decision"?** If yes,
   Option 1 is effectively off the table: Dennis et al.'s *participation* and *politeness* benefits
   and the relay's dual attribution all need a second agent to be private from. If you would rather
   make **the anchored thread with a state** the design decision instead, Option 1 becomes live —
   but say so now, because it changes the video script, not just the roster.

3. **Are you willing to cite a preprint (Fang et al., arXiv 2510.15234) as the load-bearing
   citation for "why two agents in a document"?** It is the only one that exists. Everything else
   in the project's evidence base is single-agent or is a risk paper. If the answer is no, the
   second agent has no theory and Option 1 is the honest choice.

4. **Decide by Monday night.** A roster change is ~1.5–2 days of code (§C2) and does not fit after
   `pivot-spec.md` §E's **Thursday 18 Sep fallback gate**. Which is it — and if it is Option 2,
   will you also commit to the three cheap Houde controls (reject a note, per-agent mute,
   quiet/normal/more), which are what make two voices defensible in a document rather than merely
   inherited?
