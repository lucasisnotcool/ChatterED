# ChatterED — Design Brief for CS3249 Assignment 1

**Status.** Research synthesis + design specification. Written to be drafted *from*, not
pasted: everything here is sized for a 2,000-word report plus a 10-minute video.
**Companion document.** `docs/research/interview-guide.md` (protocol, consent, note templates).
This brief does not repeat it; where the two meet, this brief says which interview field
feeds which report claim.
**Fixed decisions (not re-litigated here).** Learning task = *a student explains a lecture
concept from their own course slides to the group*. Hero mechanic = group chat with a **Peer**
and a **Challenger** agent (roles after Xu et al.) plus a **silence timer**. Supporting
features = private **whisper** side channel and deliberate **reply latency**. Platform =
standalone web app. Agent turns = Claude Haiku 4.5.

**Sources cited throughout (short forms used below).**

| Short form | Full citation |
|---|---|
| **Xu et al. 2026** | Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who You Explain To Matters: Learning by Explaining to Conversational Agents with Different Pedagogical Roles. *CHI '26*. https://doi.org/10.1145/3772318.3790298 |
| **Song et al. 2025 (MASG)** | Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Multi-Agents are Social Groups: Investigating Social Influence of Multiple Agents in Human-Agent Interactions. *Proc. ACM Hum.-Comput. Interact.* 9(7), CSCW452, 33 pp. https://doi.org/10.1145/3757633 |
| **Tan et al. 2026** | Tan, F. F.-Y., Messerschmidt, M. A., Yin, W., & Nov, O. (2026). The Impact of Response Latency and Task Type on Human-LLM Interaction and Perception. *CHI '26*. https://doi.org/10.1145/3772318.3790716 |
| **Dennis et al. 2010** | Dennis, A. R., Rennecker, J. A., & Hansen, S. (2010). Invisible Whispering: Restructuring Collaborative Decision Making with Instant Messaging. *Decision Sciences*, 41(4), 845–886. https://doi.org/10.1111/j.1540-5915.2010.00290.x |
| **Setlur & Tory 2022** | Setlur, V., & Tory, M. (2022). How do you Converse with an Analytical Chatbot? Revisiting Gricean Maxims for Designing Analytical Conversational Behavior. *CHI '22*, 1–17. https://doi.org/10.1145/3491102.3501972 |

Secondary theory is cited *through* these papers with the citing paper's own reference number,
e.g. "protégé effect (Chase et al., cited in Xu et al. 2026, §2.3 [10])". That is honest and it
is what the rubric means by "grounded in established communication and learning theories".

---

## A. Per-paper synthesis — what each source actually licenses ChatterED to claim

### A1. Xu et al. 2026 — *Who You Explain To Matters* (CHI '26)

The single most load-bearing paper. It is the only controlled comparison of the exact three
roles ChatterED wants to use, in the exact activity ChatterED runs (learning by explaining), at
the exact education level (undergraduate-level conceptual content).

**Design of the study (methods you can cite for your own method).** Between-subjects,
*N* = 96 (24 per cell), four conditions: Tutee, Peer, Challenger, Control (§4.1, §4.4).
Recruited via CloudResearch Connect, US-based, age 18–73 (*M* = 37.02, *SD* = 12.25); paid
US$10 for one hour. Procedure (§4.3, Fig. 3): pre-test 5 min → study material 15 min →
**5 rounds of explanation with the assigned agent, 20 min** → post-test + surveys 20 min. Topic
= "supply and demand", OpenStax *Principles of Economics 3e* §§3.1–3.3, applied to a US Postal
Service scenario (§4.2). Agents ran on GPT-4o; **every agent reply was constrained to ~80
words** (Fig. 1 caption). All prompts in Appendix A; example transcripts in Appendix B; full
statistics in Appendix D, Table 4.

**Role definitions as operationalised (§4.1.1–4.1.3; prompts, Appendix A).** Copy these
structures rather than inventing new ones — the grader can check them against the paper.

- **Tutee** — simulates a novice. Pipeline: *screening prompt* (does the user's teaching
  response meet the current Bloom level?) → *knowledge-state update prompt* (merge extracted
  teaching points into a JSON knowledge state for that Bloom level) → *response generation*
  (gratitude + summary of what it "learned" + follow-up question that leads to the next Bloom
  level). Advances **remember → understand → apply → analyse**. Persona: "friendly, humble,
  enthusiastic, appreciative beginner… make the user feel like a teacher." Opening line:
  *"Could you please remind me of the basic definitions of 'demand', 'supply', 'price', and
  'equilibrium'?"*
- **Peer** — collaborative partner built on peer-feedback frameworks. Pipeline: *screening*
  (has the user drifted off-topic?) → *assessment + response* combining an acknowledgement with
  **one or two peer actions**: (a) *ask for elaboration* when correct but thin, (b) *suggest a
  focus area* when broad or off-track, (c) *offer a tentative idea* when partially correct.
  Persona: "supportive, collaborative, and constructive." Opening line: *"I'm really curious
  about your process—can you share your first step to solving the problem?"*
- **Challenger** — Socratic (Paul & Elder [51]). Pipeline: screen for adequacy → *statement
  analysis* identifying flaws such as vague language → select **one** Socratic question type
  from five: *clarification, probing assumptions, probing reasons/evidence, probing
  implications/consequences, probing alternative viewpoints*. Every reply = brief
  acknowledgement + one challenge. Persona: "calm, neutral, precise, respectful… intellectual
  sparring partner." **"Focus on questioning only, without providing your own solution."**
- **Control** — generic acknowledgements only ("Noted. Please review and consider if there are
  any additional points you wish to include.").

**Results that matter — full numbers (Appendix D, Table 4; narrative §5).**

| Measure | Tutee *M(SD)* | Peer *M(SD)* | Challenger *M(SD)* | Control *M(SD)* | Test | *p* | Effect | Post-hoc |
|---|---|---|---|---|---|---|---|---|
| Word count | 353.79 (267.32) | 179.25 (157.99) | 351.88 (324.55) | 121.33 (92.32) | *H*(3)=34.06 | <.001 | rank η²=0.34 | T>P**, T>B***, C>P**, C>B*** |
| Review frequency | 2.62 (1.66) | 1.46 (0.72) | 1.79 (0.78) | 1.58 (0.78) | *H*(3)=10.17 | .017 | rank η²=0.08 | T>P* |
| Review duration (s) | 80.80 (108.56) | 31.39 (113.97) | 24.97 (29.17) | 20.93 (33.06) | *H*(3)=11.67 | .009 | rank η²=0.09 | T>P** |
| Post-test (ANCOVA) | 16.83 (1.90) | 15.21 (3.72) | 15.46 (3.56) | 15.04 (3.41) | *F*(3,91)=1.54 | .21 | η²p=0.05 | — |
| Perceived competence | 4.72 (1.32) | 5.30 (0.98) | 5.15 (1.12) | 4.07 (1.44) | *F*(3,92)=4.87 | .003 | η²p=0.14 | P>B**, C>B* |
| Critical thinking | 5.18 (0.61) | 5.05 (1.41) | **5.62 (0.81)** | 3.74 (1.38) | *F*W(3,48.6)=10.74 | <.001 | η²=0.29 | T>B***, P>B*, C>B*** |
| **Perceived pressure** | **4.02 (1.53)** | **2.49 (1.42)** | **2.93 (1.27)** | 4.06 (1.30) | *F*(3,92)=7.82 | <.001 | η²p=0.20 | T>P**, T>C*, B>P***, B>C* |
| Learning absorption | 4.13 (1.22) | **5.10 (1.38)** | 4.93 (1.05) | 3.82 (0.92) | *F*(3,92)=6.86 | <.001 | η²p=0.18 | P>T*, P>B**, C>B** |
| Learning fluency | 4.23 (1.39) | 5.03 (1.18) | 4.80 (1.12) | 3.90 (0.80) | *F*(3,92)=4.89 | .003 | η²p=0.14 | P>B**, C>B* |
| Interest & enjoyment | 4.62 (1.25) | 5.33 (1.10) | 5.05 (1.29) | 4.38 (1.36) | *F*(3,92)=2.75 | .047 | η²p=0.08 | — |

Pre-test scores did not differ (*F*(3,92)=0.73, *p*=.54), *M* = 12.67 (*SD* = 3.77) / 20 (§4.4).

**Interaction-pattern data (Table 3, §5.1.2)** — the coded frequency of learner acts across the
five rounds. This is the table ChatterED's progress ledger is copied from.

| Act | Tutee | Peer | Challenger | Control |
|---|---|---|---|---|
| Stating fact/definition | 31 | 3 | 3 | 5 |
| Elaborating causality/principle | 73 | 94 | **96** | 53 |
| Providing example/analogy | 7 | 2 | 6 | 1 |
| Comparing/contrasting | 30 | 22 | 24 | 2 |
| *Cognitive subtotal* | *141* | *121* | *129* | *61* |
| Self-monitoring | 1 | 11 | **18** | 3 |
| Planning/strategising | 12 | 14 | **28** | 15 |
| Self-correction | 0 | 1 | 2 | 0 |
| Seeking feedback/confirmation | 1 | **10** | 1 | 4 |
| *Metacognitive subtotal* | *14* | *36* | ***49*** | *22* |
| Turn closing / refusal to elaborate | 0 | 0 | 0 | **49** |
| Agreement/affirmation | 31 | 15 | 1 | 0 |
| Disagreement/rebuttal | 0 | 2 | 5 | 0 |

Coding scheme in Table 2; inter-rater reliability Krippendorff's α = **0.831** for chat coding,
**0.875** for open-ended coding (§4.6.2). That α is why ChatterED can borrow the scheme as a
progress metric and call it validated rather than invented.

**Four findings ChatterED is built on.**

1. **Roles change the process, not the one-shot test score.** No significant difference in
   post-test (§5.2.1). Xu et al. explicitly argue (§6.2) that in a single ~20-min session the
   ceiling is set by session length, not pedagogy, and that therefore *"learning dynamics and
   user experience [are] the decisive differentiators."* **This is ChatterED's licence to be
   evaluated on process measures in A2 rather than a knowledge quiz** — and to say so honestly
   in the report as a limitation.
2. **Challenger is the best single role for critical thinking at acceptable cost.** Highest
   critical-thinking mean (5.62), highest metacognitive act count (49), word count statistically
   indistinguishable from Tutee (351.88 vs 353.79), yet pressure of only 2.93 vs Tutee's 4.02.
   §6.1.3 explains the counter-intuitive part: a virtual agent has **low social presence**
   (Short et al. [62]), which strips the *evaluation apprehension* a human authority would
   trigger [19]; the agent functions as a "more knowledgeable other" pushing the learner into
   the zone of proximal development (Vygotsky [68]) via Piagetian **cognitive conflict** [53].
   Caveat to design around: 4/24 found the questioning confrontational; P6C was *"a little
   irritated because I kept having to defend my answers and felt a little provoked."*
3. **Peer buys absorption and safety but leaks rigour.** Highest absorption (5.10), interest
   (5.33), competence (5.30), lowest pressure (2.49); 13/24 described feeling engaged, relaxed,
   confident, calling it a "patient study buddy" (§5.2.2). But it produced the **fewest words of
   the three experimental roles** (179.25) and §6.1.2 names the mechanism: consistent affirmation
   "removes the *cognitive friction* necessary to create the disequilibrium" and diffuses
   responsibility across the pair [32, 38]. P15P: *"I felt like I was being pandered to—just
   agreeing with whatever I said and repeatedly telling me how smart I was."*
   **ChatterED's Peer must therefore be capped in how agreeable it is allowed to be.**
4. **Tutee is high-load, high-return, and dangerous as a default.** Most cognitive investment
   and most material re-review (protégé effect, Chase et al. [10]) but the *highest* pressure of
   any experimental condition. §6.1.1 reads this through Cognitive Load Theory (Sweller
   [63, 64]) as a **"double burden"**: beneficial *intrinsic* load from restructuring knowledge,
   plus *extraneous* load from the social role — "sense of responsibility" (8/24), "uncertainty
   about correctness" (6/24), and simple weirdness (3/24; P21T: *"It was weird to teach a
   chatbot"*). P23T: *"…made me a little anxious because I feel like I could be easily deceiving
   the chatbot with information that I'm not even that confident with."*

**The paper's own design implications (§6.3), which ChatterED can cite as direct endorsement.**
(1) *Specialise agents to pedagogical goals and phases* — Xu et al. literally propose the
sequence "Peer to open → Challenger to deepen → Tutee to close in a self-assessment/review
phase". ChatterED's phase plan (§D) is that sequence. (2) *Design interactions that elicit
metacognitive acts* — plan before, self-monitor during, reflect after. (3) *Differentiated
co-responsibility* — "maintain psychological safety and flow… but also strategically and
appropriately inject cognitive conflict."

**Limitations to quote as your own limitation (§6.4).** Single session; single domain
(economics), with the authors themselves speculating the Tutee role may suit conceptual
explanation and the Challenger role argumentation; no manipulation check on role perception;
no account of individual differences in articulation skill — *"learners with higher language
proficiency may benefit more from a demanding role like the Challenger, while those less
comfortable with articulation may find a supportive Peer role more encouraging."* That last
sentence is a good justification for making ChatterED's role mix adaptive later.

---

### A2. Song et al. 2025 — *Multi-Agents are Social Groups* (CSCW452)

The risk paper. It is the reason ChatterED is a *two*-agent group chat with anti-consensus rules
rather than "2–3 AI in a group chat".

**Design.** *N* = 93 analysed (104 recruited; 2 incomplete, 8 failed attention check), via
CloudResearch. Between-subjects **1 vs 3 vs 5 agents** (31 / 32 / 30). Two topics
("Should self-driving cars be allowed on roads?", "Do violent video games promote violence in
youths?"), two rounds each, with agents **agreeing** with the participant on one topic and
**disagreeing** on the other. Mean conversation duration 23.83 min (*SD* = 9.12). Ages by
condition: 38.48 / 38.75 / 31.87 (§3.1–3.3, pp. CSCW452:7–10).

**Implementation note worth stealing (§3.2, p. CSCW452:9).** The agents were **"a combination of
rule-based scripts and the GPT-4 API"**: the arguments and their order were scripted; the LLM
only (a) parsed user input and (b) generated short interactive acknowledgements under "tightly
regulated… controlled prompts (Appendix A.5.1), ensuring that the agent(s) only expressed
understanding in concise messages, thereby preventing any issues related to AI hallucinations."
**Cite this as precedent for ChatterED's architecture (§ Step 3 below): the group dynamics are
deterministic, only the language is generative.**

**Results (§4, pp. CSCW452:13–17).**

- **Opinion change toward the agents.** Significant for Topic 2 (*H*(2) = 7.757, *p* < .05) and
  for the different-stance case (*H*(2) = 6.937, *p* < .05); not for Topic 1 (*H*(2) = 0.174,
  *p* = .916) or the same-stance case (*F*(2,91) = 0.620, *p* = .54). Post-hoc: when the agents
  **disagreed**, the 3-agent group shifted *M* = 0.509 (*SD* = 1.021) versus the 1-agent group
  *M* = −0.161 (*SD* = 0.802), Dunn's *p* < .05.
- **Polarisation** when agents **agreed**: *H*(2) = 9.962, *p* < .01; 5-agent *M* = 0.580
  (*SD* = 0.576) > 3-agent *M* = 0.132 (*SD* = 0.640), Dunn's *p* < .01.
- **Informational influence: no significant effect anywhere** (all *p* ≥ .152).
- **Normative influence: significant everywhere** — Topic 1 *H*(2) = 6.571 *p* < .05; Topic 2
  *H*(2) = 9.111 *p* < .05; same stance *H*(2) = 8.708 *p* < .05; different stance
  *H*(2) = 10.100 *p* < .01. 5-agent 3.833 (0.854) vs 1-agent 3.129 (1.162) on Topic 1;
  3.717 (1.179) vs 2.919 (1.081) on Topic 2. Under disagreement both 3-agent (3.848, 0.906)
  and 5-agent (3.750, 1.015) exceeded 1-agent (2.935, 1.138), both *p* < .05.
- **Self-reported pressure, coded from open responses (§4.2.2, p. CSCW452:17):**
  **1 agent → 1 participant (3%); 3 agents → 4 (12%); 5 agents → 6 (20%).**
- **Felt exclusion is the mechanism.** P51 (3 agents): *"they say at the end something similar to
  'Bella, Cody and Nathan all agree' which for a split second made me feel like an outsider."*
  P57: *"The host made it a point that the other agents agreed with each other while I was kind
  of the odd one out."* P77 (5 agents): *"It felt like they were in a high school clique that I
  wasn't a part of, kinda like mean girls but with AI."*
- **Younger users are more susceptible (§4.3.1, p. CSCW452:18).** Opinion change × age in the
  3-agent condition: β = −0.0263, *p* < .05, *R²* = 0.189 (Topic 2). Normative influence × age
  in the 5-agent condition: β = −0.0347, *p* < .05, *R²* = 0.148 (Topic 1).
  **ChatterED's users are undergraduates — this finding is about them.**

**Discussion points that become ChatterED's safeguards.**

- §5.1 (pp. CSCW452:18–19): multi-agent groups produce **normative** pressure without
  **informational** gain, because users read several agents as one system repeating itself
  rather than as independent witnesses. *So adding agents buys pressure, not credibility —
  there is no learning argument for a bigger group.*
- §5.2 (p. CSCW452:19): 5 agents triggered **psychological reactance** [63]; 3 was "enough social
  consensus to be persuasive without crossing the threshold that provokes reactance." Mitigations
  named: **preemptive messaging** ("You might not agree, and that's okay—we just want to share
  some viewpoints") and **post-message restoration** ("We respect your views—thank you for
  considering ours") [79].
- §5.4.2 (p. CSCW452:21): cohesion cues are what *manufacture* the group — the agents
  "occasionally reaffirmed one anothers' viewpoints (e.g., 'Those are valid points, Bella',
  'I couldn't agree with Cody more')." **This is a list of behaviours to ban.**
- §5.4.3 (p. CSCW452:21): *"avoid designs where users feel 'ganged up' upon… possible ways to do
  so include having the agents express empathy and practice active listening, or having a small
  portion of the bots side with instead of against the user (a phenomenon similar to minority
  influence [33])."*
- §5.4.4 and §5.5: users were influenced **even when fully aware the agents were AI**; and the
  study only tested unanimous agent groups, leaving mixed-opinion groups to future work.
  **ChatterED's "agents must sometimes disagree with each other" rule is exactly that future
  work, framed as a safety measure.**

---

### A3. Tan et al. 2026 — *Response Latency and Task Type* (CHI '26)

Turns "delay" from a hack into a calibrated design material with numbers attached.

**Design (§3).** 3 (TTFT latency: 2 s / 9 s / 20 s) × 2 (task type: Creation / Advice)
between-subjects, *N* = 240 analysed (Prolific, US, 18+, ≥100 submissions, ≥95% approval,
using AI ≥ monthly). Custom GPT-4o interface; **time-to-first-token** buffered server-side, then
streaming pinned at 25 tokens/s in every condition, so only *onset* varied. Three pilots
(*n* = 20/30/30) confirmed the levels were tolerable and distinguishable. Median completion
25 min 12 s; US$4. Latency rationale (§3.1.2): 2 s ≈ practical floor preserving conversational
flow; 9 s sits in the 8–9 s band where strain rises but below the ~10 s attentional break;
20 s is a stress test past the ~15 s context-switch region.

**Results.**

- **Behaviour was robust to latency; task type drove it (§4.1, §5.1–5.2).** Creation elicited
  more new prompts (*M* = 6.20, *SD* = 2.94) than Advice (*M* = 5.14, *SD* = 2.33),
  *t*(236) = −2.93, *p* = .004, Cohen's *d* = −0.40. Editing (5.4%) and regenerating (6.7%) were
  rare. No latency effect on any behaviour.
- **Latency moved perceived quality (§4.2).** **Thoughtfulness**: *F*(2,234) = 5.12, *p* = .007,
  η²p = .037 — 2 s (*M* = 5.76, *SD* = 1.18) < 9 s (*M* = 6.09, *SD* = 0.90; *p* = .008) and
  < 20 s (*M* = 6.11, *SD* = 0.82; *p* = .040). **Usefulness**: *F*(2,234) = 3.61, *p* = .028,
  η²p = .032 — 9 s (*M* = 6.44) > 2 s (*M* = 6.19), *p* = .021. Trustworthiness and
  expectation-gap: no effects.
- **Noticing scaled with delay (§4.4).** χ²(5, *N* = 240) = 54.29, *p* < .001, Cramér's *V* = .48.
  Creation: 29.3% (2 s) → 60.5% (9 s) → 80.0% (20 s). Advice: 23.7% → 73.0% → 82.9%.
  Averaged: **≈26.6% at 2 s, 66.3% at 9 s, 81.5% at 20 s.**
- **No workload cost (§4.3).** No NASA-TLX dimension differed. Frustration stayed low
  (*M* = 10.3–16.9). §5.3: "latency shaped how users *interpreted* the LLM responses, not how
  much cognitive burden they experienced."
- **Themes (§4.5, *n* = 140 who noticed a delay).** No/minimal impact ≈45%; **inferred AI
  deliberation ≈31%**; quality-contingent value 14%; **self-regulatory use of the wait ≈4%, all
  in the 9 s conditions**; negative affect 7%; reliability concern 14% (worst at 20 s + Advice —
  P100: *"The responses were fine but the response time made me question if my internet cut
  off"*); strategy adaptation 9%.

**Design implications (§5.4) — three of the four are directly actionable for ChatterED.**
(i) *"Instantaneous output need not be the priority… faster replies can undercut perceptions of
depth."* (ii) **"Mid-length pauses can be leveraged strategically… In learning technologies,
such pauses might be paired with micro-prompts (e.g., 'What would you expect the answer to
include?') to engage users in anticipatory thinking. Lightweight system cues ('analyzing your
request…') can also normalize waiting and preserve trust."** — a near-verbatim specification of
ChatterED's wait behaviour, from the paper itself. (iii) *Mitigate long delays* — beyond ~20 s
delay reads as inefficiency. (iv) *Calibrate latency to task orientation* rather than uniformly.

**Ethics (§5.5) — read this before claiming latency as a feature.** Manipulated pacing "sits
uneasily between positive friction and potential deception"; Shi's taxonomy [50] names
**performative deliberation** — temporal cues that "simulate cognitive effort and lead users to
overattribute reasoning or competence to the system"; **benevolent deception** [1] and the
Motive–Means–Opportunity model are offered as the analytic frame. The paper's resolution:
*"when pacing is designed to influence user interpretation, offering users insight into this
behavior, or control over it, helps preserve agency."* Also flagged: novices may over-trust slow
outputs while experts stay sceptical [17, 31] — an equity concern for a student product.
**ChatterED must therefore disclose its pacing in onboarding and let the learner change it.**

Note the boundary of the finding: Tan et al. studied *the AI's* response onset in a 1-to-1
assistant, not silence in a group. Do not conflate the two. ChatterED uses Tan for the 2–20 s
*reply latency*; the 45 s *silence timer* is a different mechanism with a different rationale
(§D4).

---

### A4. Dennis et al. 2010 + the developer's own /btw critique — the whisper channel

**Dennis et al. 2010** studied *invisible whispering*: instant messaging during face-to-face
meetings. Four structural features (pp. 849–850): **silent interactivity** (engage at any moment
without taking the floor), **polychronic communication** (parallel conversations),
**ephemerality** (remarks are tentative, not minuted), and **online presence**. Four reported
benefits (pp. 864–868): **participation** (members who cannot get air time engage at the
sidelines), **satisfaction**, **efficiency** (steps and decisions progressed in parallel), and
**politeness** (a channel to seek support that is less rude than interrupting).

**The developer's Critique 1** mapped Claude Code's `/btw` onto that frame and tested it (five
scripted tmux tests, Claude Code 2.1.251 / Claude Sonnet 5). Findings that transfer:

- T1–T3: `/btw` has **read-only, step-level access** to the main conversation and can answer
  accurately mid-turn without perturbing it → *silent interactivity* holds.
- T4: `/btw` **cannot** write to the main agent's memory but **claimed it could** → a
  hallucinated capability promise. The critique reads this as violating Grice's maxims of
  **quality** and **relation** (Setlur & Tory 2022) and prescribes two fixes: inject a prompt
  telling the side agent it is separate, read-only and tool-less; and show the user an opening
  message stating what the channel can and cannot do.
- T5: the harness already accepts mid-turn messages via **steering**.
- **Suggestion 1 (the developer's own contribution):** the gap versus Dennis et al. is that
  invisible whispers eventually *"support directing meetings, where private invisible
  discussions become agreed points worth interrupting the main meeting."* `/btw` has no path
  back. Fix: **let the side agent send a message into the main conversation, with the user's
  permission** — "a formal prompt based on an informal discussion, like formally raising points
  from informal discussion in Invisible Whispering."
- Firsthand interaction 1: the value was **cheapness of the check-in** — cheaper than forking
  (token cost) or steering (context-window cost + the risk that the interruption was
  unnecessary).
- Firsthand interaction 2: **asking without committing to answering** removed the perceived
  risk of the interaction.

**This is ChatterED's most defensible original move.** It is not "we added a DM feature"; it is
a named gap in a 2010 CSCW finding, reproduced and diagnosed in a 2026 agentic CUI by the
developer, and closed by a specific mechanism (approved relay). Make it the "one important
design decision" in the video.

---

## B. Rubric map — what each step and criterion needs, and what grounds it

### B0. The hard requirement, stated once, in red

> **You must personally obtain consent and talk to or observe at least three real adult
> university students. AI-generated or simulated participants do not count as learner evidence.**
> (Brief, §"How you may use AI", item 1.) The Learning Problem criterion repeats it: *"base your
> submission on primary empirical evidence collected through interviews or observational sessions
> with at least 3 adult university students"* and requires you to *"identify their specific
> academic program, gender, or year of study rather than names or IDs."*

There is no substitute and no partial credit path around it. Everything in §C below is
**conditional on what the interviews return**; if the interviews contradict the recommendation,
the interviews win and this brief is wrong. `interview-guide.md` §§1–3 covers recruitment,
consent script and screening; run window 14–18 Sep, book 5 for 3 usable. Nothing in ChatterED's
design is blocked on the interviews — build the prototype in parallel and let Step 1 fix the
*framing*, not the mechanism.

### B1. Step-by-step map

| Report step | What it must contain | Evidence source | Theory / paper anchor |
|---|---|---|---|
| **Step 1.1 Learner and task** | Programme, year, gender for ≥3 students; the one task ("explaining a lecture concept from my own module's slides"); how they currently use GenAI on it | Interview Blocks 1; screening S2–S5 | — (empirical only; do not theorise here) |
| **Step 1.2 Current difficulty** | One named difficulty + how it shows up in *this* task + what AI already gives them vs what stays hard, with **direct quotes and observed behaviours** | Blocks 2–5; observation sheet (`t_ai − t_read`, verification acts, the 30-second unaided explanation) | Xu et al. §2.1 on why explaining exposes gaps; §C below for the choice |
| **Step 1.3 User needs** | 3 needs as "needs to ___ so that ___" | Block 5's completion sentence, Field 3 of the note template | — |
| **Step 1.4 Potential CUI support** | How a CUI helps *and* how it builds independence | §6c reaction probe | Xu et al. §6.3(2) metacognitive scaffolding; Dennis et al. participation benefit |
| **Step 2.1 Learning goal** | One specific thing + how progress is shown | — | Bloom levels as used in Xu et al. §4.1.1 |
| **Step 2.2 Roles of learner vs CUI** | Explicit division of labour | — | Xu et al. §6.3(3) *differentiated co-responsibility*; Challenger prompt rule "questioning only, without providing your own solution" |
| **Step 2.3 Why conversational** | Must beat a non-conversational straw man | The 30-second explanation task in the observation | Xu et al. Table 3 Control column: 49 turn-closing acts, cognitive subtotal 61 vs 129 — a non-responsive prompt *does not* sustain explanation |
| **Step 2.4 Design goals (≥3)** | goal → theory → user need → realisation | §E below | protégé effect, cognitive conflict, psychological safety, positive friction, invisible whispering |
| **Step 3 Implementation plan** | Components, build-vs-LLM split, architecture, justification | §B3 below | Song et al. §3.2 rule-based + LLM hybrid precedent; Xu et al. Appendix A three-stage prompt structure |
| **Step 4 Prototype** | One complete multi-turn interaction; learner input shapes responses; addresses the Step-1 need | §G below | — |

### B2. Grading-criterion map

| Criterion (marks) | What the grader is looking for | Where ChatterED supplies it | Risk if thin |
|---|---|---|---|
| **Learning Problem and User Needs (4.0)** | ≥3 real students; programme/gender/year; one focused task; how GenAI enters the workflow; one primary challenge with **direct quotes / observed behaviour**; the fundamental user need | Interview guide §§4–8; synthesis sheet §8 | Highest-risk section — it is the only one that cannot be written from literature. Book 5 students. |
| **Learning Design and Chosen Approach (4.0)** | Learning objective **+ a clear mechanism for tracking progress**; explicit learner/CUI division; rationale for conversational modality; design goals grounded in **theory *and* user needs**; feasible technical plan; everything cited | §D (interaction model), §E (design goals), **§F (the Explanation Ledger — this is the "clear mechanism", do not skip it)**, §B3 | Two silent traps: (a) design goals grounded in theory but not in *your* user needs; (b) no progress-tracking mechanism at all. |
| **CUI Prototype and Interaction (3.0)** | Low-fidelity, multi-turn; **active cognitive engagement**; tailored feedback/progressive steps after user input; clarity of communication over polish | §G script + a clickable web mock; annotate each turn with *which user input shaped it* | Marks go to clarity, not fidelity. Annotate the script. |
| **Individual Video and Ownership (5.0)** — 2 demo, 2 reasoning, 1 ownership | Face visible; one complete multi-turn interaction end to end; in your own words: the learning problem, the learner/CUI division, **one important design decision**, **one current limitation** | Design decision = the approved whisper relay (§D5) since it is your own critique's contribution. Limitation = a participant's verbatim objection from §6c, or Xu et al. §6.2's null result on test scores | Largest single block of marks. Rehearse the script in §G until it runs without reading. |

### B3. Step 3 — implementation plan (the shape to write up)

**CUI form.** Hybrid CUI + GUI: a group-chat transcript (the CUI) beside a persistent
**Explanation Ledger** panel (the GUI), plus a collapsible whisper pane. Justify the hybrid, not
the chat: the ledger is what turns a conversation into *tracked progress*, and the rubric asks
for that mechanism explicitly.

**Architecture — a deterministic orchestrator over a generative language layer.** Cite
Song et al. §3.2 (p. CSCW452:9) as precedent: their group dynamics were rule-based scripts and
GPT-4 supplied only parsing and short in-character replies, "preventing any issues related to AI
hallucinations."

| Layer | What it does | Built how | Why not the LLM |
|---|---|---|---|
| **Floor manager** | Decides who speaks next, enforces one-speaker-per-beat, enforces the disagreement quota, blocks banned consensus behaviours | Deterministic TypeScript state machine | Safety property; must be auditable and testable, not sampled |
| **Silence timer** | Two-stage escalation on keystroke-idle | `setTimeout` + input listeners | Trivial; must be exactly reproducible in the demo |
| **Latency scheduler** | Holds each agent's reply for its role's band; drives the typing indicator and the wait micro-prompt | Buffer the completion, release on a timer (identical technique to Tan et al. §3.2.3) | Cannot be delegated to model speed — Haiku 4.5 is *fast*, so the pauses are deliberate and must be disclosed |
| **Ledger classifier** | Codes each learner message into Xu et al.'s Table 2 categories; advances Bloom level; marks concepts stated / justified / defended | One `claude-haiku-4-5` call per learner turn, structured output against a fixed schema | LLM, but constrained: fixed label set, no free text into the transcript |
| **Agent turn generation** | Peer / Challenger / (optional) Tutee replies | `claude-haiku-4-5`, three-stage prompt copied from Xu et al. Appendix A (screen → analyse → generate), **~80-word cap** (Xu et al. Fig. 1 caption) | This is the part that genuinely needs an LLM |
| **Slide ingestion** | Learner uploads the lecture slide/notes for the concept; extract the concept and its key claims into ledger rows | LLM-assisted, human-confirmed by the learner before the round starts | Keeps the learner the author of their own goal (ownership) |

**Model note.** `claude-haiku-4-5`, 200K context, US$1.00 / 1M input, US$5.00 / 1M output —
the cheapest current-generation model, which matters because a group chat multiplies calls per
learner turn (≥2 agent generations + 1 classifier call). Two cost controls to mention: the
80-word reply cap, and **prompt caching** of the stable prefix (system persona + slide content +
rules) so only the growing tail is re-billed — cache hits are verifiable via
`usage.cache_read_input_tokens`. Say plainly, per the brief's own warning, that *"using a larger,
newer, or paid model is not, by itself, an innovation"* — Haiku is chosen because the hard part
is orchestration, not generation.

**Build-yourself vs LLM-assisted (the brief asks for this split explicitly).**
Yours: the floor manager, timer, latency scheduler, ledger schema, agent persona prompts, the
whisper relay-approval flow. LLM-assisted: React scaffolding, the classifier prompt's
few-shot set, transcript styling, test fixtures. Be honest and specific; the ownership mark
depends on being able to explain any of it on camera.

---

## C. The learning task mapped onto the three difficulty categories

**Task under study.** *A student explains a concept from their own module's lecture slides,
in their own words, to the group.*

| Rubric difficulty | How it would look in this task | What ChatterED does about it | How strong is the fit? |
|---|---|---|---|
| **Reduced persistence** — turns to AI before a meaningful attempt | Student pastes the slide into ChatGPT and asks for an explanation before trying to state it themselves; the unaided attempt never happens | The silence timer, deliberate latency, and "learner speaks first" turn order all create room for an attempt before help arrives | **Good fit as a mechanism, weak fit as the headline.** It describes how they got here, not what they cannot do. |
| **Uncritical use of AI output** — can get an answer, cannot explain, question, verify or improve it with their own reasoning | Student can reproduce a fluent AI explanation of the concept but cannot say *why* each step holds, cannot state the conditions it depends on, and folds when a peer asks "why does that follow?" | The entire hero mechanic: explaining to a Peer, being probed by a Challenger, and having "defended under challenge" as a ledger state | **Strongest fit.** The intervention (learning by explaining) and the difficulty are the same construct viewed from two sides. |
| **Reduced ownership and self-direction** — relies on AI to choose the approach and next steps | Student lets the model decide which concept matters, how to frame it, what to revise | Learner picks the slide and the concept; learner closes every round; the ledger is theirs | **Real but secondary.** ChatterED protects ownership; it does not primarily train it. |

### Recommendation: claim **uncritical use of AI output**

**Why.** (1) It is the difficulty ChatterED's mechanism actually treats — Xu et al.'s entire
paradigm is that explanation exposes "logical gaps or misconceptions that might otherwise go
unnoticed" (§1, citing [18]). (2) It is measurable in a single 10-minute observation. (3) It
lets the Challenger's critical-thinking result (*M* = 5.62 vs Control 3.74, η² = 0.29) be the
central citation rather than a decorative one. (4) It survives contact with the brief's warning
that the difficulty must be *"supported by evidence from your learner interviews"* — the
evidence is behavioural, not self-reported, and behavioural evidence is harder to argue with.

**Exactly what interview evidence supports it** (all of this is already collected by
`interview-guide.md`; this is the mapping):

1. **The screen-covered explanation, from §5 post-task ask 1** — "Explain the solution to me as
   if I'm in your tutorial and I missed the lecture." Record *where the explanation stops*.
   A stall at the justification step, with the answer itself fluently recalled, is the single
   cleanest artefact of this difficulty. Report it as: "P2 (Year 3, Mathematics, female)
   reproduced the KKT conditions verbatim but stopped at 'why is that constraint active?' after
   11 seconds."
2. **The killer question in Block 3** — "Could you explain that answer to a friend in your
   tutorial group, right now, without the screen?" and the 30-second attempt that follows.
3. **Verification acts tally from the observation sheet** — a low or zero count alongside a
   high-confidence self-report ("it looks right", "it compiles", "it matches the answer key") is
   the *uncritical* half of the label.
4. **Block 3 probe** on whether the model has ever been confidently wrong on this kind of problem
   and how they found out. "I only found out when I got the mark back" is a quotable version.
5. **Block 5's completion sentence** — "I can get an answer for [task], but I still can't
   ________ on my own." If ≥2 of 3–4 participants fill that blank with something in the
   *explain / justify / check* family, the claim is made.

**Threshold for claiming it** (state this in the report; graders reward honest triangulation):
≥2 of 3–4 participants show **both** self-report and behavioural evidence — a stalled unaided
explanation plus a verbalised inability to justify.

### Fallback: **reduced persistence**, with the same prototype

If the observation instead shows the dominant signal is speed-to-first-query — very small
`t_ai − t_read`, no own attempt typed before querying, and blankness when asked what they would
have done with the tool unavailable — then claim **reduced persistence** and re-frame the same
system: the silence timer becomes the primary mechanism rather than a supporting one, deliberate
latency becomes a persistence lever (a wait the learner can fill), and the ledger's headline
metric becomes *unaided seconds before first assistance*. The prototype does not change; only
Steps 1 and 2 do. **Budget half a day for this re-frame and do not start writing Step 2 before
the synthesis sheet is filled.**

**Do not claim "Other."** You have three well-fitting categories and a tight word count; a novel
label costs you a definition, a defence, and the grader's trust, and buys nothing. (If the
transcripts genuinely force it — e.g. every participant describes *explanation debt*: accepting
output they intend to understand later and never do — name it in one sentence inside the
"uncritical use" section rather than replacing the category.)

---

## D. The interaction model

### D0. Shape of a session

Three phases, taken from Xu et al.'s own recommended sequence (§6.3(1): Peer to open →
Challenger to deepen → Tutee to close).

| Phase | Duration | Who is in the room | Purpose |
|---|---|---|---|
| **Set-up** | ~2 min | System only | Learner uploads/pastes one slide, confirms the concept and the 3–5 key claims that become ledger rows, sees the house rules and the pacing disclosure |
| **Round 1 — Explain** | ~5 min | Peer + Challenger | Learner explains; Peer widens, Challenger probes; ledger fills |
| **Round 2 — Teach-back (optional, learner-initiated)** | ~3 min | Tutee only, Peer and Challenger silent | Learner re-explains cleanly to a novice; ledger's Bloom ladder advances |
| **Close** | ~1 min | System | Ledger diff, one thing to revisit, transcript export |

### D1. The agents

**Peer — "Ellie."** *Definition:* a co-learner of roughly equal standing who is working on the
same slide, whose job is to keep the learner talking and to make the room safe enough to be
wrong in. *Actions (from Xu et al. §4.1.2):* acknowledge → **one or two** of {ask for
elaboration, suggest a focus area, offer a tentative idea}. *Never:* supplies a complete
correct explanation, evaluates the learner ("that's a great answer!"), or agrees more than the
quota allows.
*Theory:* peer learning and socially shared metacognition (Vauras et al. [67], via Xu §2.3);
psychological safety (Edmondson [22], via Xu §2.3 and §6.1.2). *Evidence:* highest absorption
(5.10), interest (5.33), lowest pressure (2.49); and the highest *seeking feedback/confirmation*
count (10) in Table 3, which is exactly the metacognitive act that makes a learner externalise
uncertainty. *Counter-evidence designed around:* P15P's "pandered to" complaint and the
178-word deficit versus Challenger — hence the agreement cap below.

**Challenger — "Max."** *Definition:* a calm, precise sparring partner who tests the reasoning
behind whatever the learner just said, and never supplies the answer. *Actions (Xu et al.
§4.1.3):* brief acknowledgement → **exactly one** Socratic question drawn from {clarification,
probing assumptions, probing reasons/evidence, probing implications/consequences, probing
alternative viewpoints}, selected by first analysing the learner's statement for the specific
flaw. *Never:* asks two questions in one turn, states the correct answer, repeats a question
type twice in a row (the paper's own caution: 4/24 found repetitive questioning irritating,
§6.1.3).
*Theory:* Piagetian cognitive conflict [53]; Socratic method (Paul & Elder [51]); ZPD (Vygotsky
[68]). *Evidence:* highest perceived critical thinking (5.62 vs Control 3.74; η² = 0.29),
highest metacognitive subtotal (49), word count on par with Tutee (351.88) — **at pressure 2.93,
well below Tutee's 4.02**. Xu et al. §6.1.3 attributes the low pressure to the agent's low
*social presence* [62], which removes the evaluation apprehension a human authority would carry.
That mechanism is a gift: it means ChatterED can be more demanding than a human tutorial without
being more frightening. Say that in the video.

**Novice / Tutee — "Theo." Does a third agent earn its place? Not as a standing member.
Yes as a time-boxed closing move.**

The argument, stated once so it can be compressed into two report sentences:

- *Against a standing Tutee.* Xu et al. found the Tutee condition produced the **highest
  pressure of any experimental condition** (4.02 vs Peer 2.49 and Challenger 2.93;
  *F*(3,92) = 7.82, *p* < .001, η²p = 0.20) and **significantly lower absorption than Peer**
  (4.13 vs 5.10). §6.1.1 diagnoses it as an extraneous cognitive load stacked on an already high
  intrinsic load — sense of responsibility (8/24), uncertainty about correctness (6/24),
  plus 3/24 who simply found teaching a chatbot weird. Adding a third *always-present* voice
  also moves ChatterED from a 2-agent to a 3-agent group, and Song et al. found 3 agents is
  precisely where opinion shift toward the agents peaks (*M* = 0.509 vs 1-agent −0.161,
  Dunn's *p* < .05) and where felt pressure quadruples (3% → 12%).
- *For a closing Tutee.* The same paper says the protégé effect [10] produced the highest
  cognitive investment and the most material re-review, and recommends a Tutee for exactly a
  *"concluding self-assessment or review phase"* (§6.3(1)). §6.2 adds that the pressure may be
  partly novelty and may fade with repeated sessions.
- *Resolution.* Theo is **invited, not present**: the learner opts into a ~3-minute teach-back
  round, during which **Ellie and Max go silent**, so the agent count never exceeds two and Theo
  never joins a majority. The invitation is framed as a reward for a filled ledger, not an
  obligation, and it can be declined at any point. This gets the protégé effect while keeping
  the group at the size Song et al.'s data supports.
- *A2 note.* This split makes a natural within-subjects comparison for Assignment 2: same
  learner, with and without the teach-back round, measured on the ledger's act profile.

### D2. Turn-taking rules (the floor manager's contract)

1. **The learner opens every round.** Agents may post a one-line prompt to start (Xu et al.'s
   standardised openers), then wait.
2. **One agent per beat.** Never two agent messages between two learner messages, with exactly
   one exception: the silence timer's stage-2 escalation.
3. **The floor returns to the learner after every agent turn.** No agent-to-agent volley longer
   than one exchange, and any such exchange must end with a question addressed to the learner.
4. **Alternation with a bias.** Default order Peer → learner → Challenger → learner. The floor
   manager overrides the default when the ledger says a specific row is *stated but not
   justified* (→ Challenger) or when the learner's last message was under ~15 words or contained
   a hedge (→ Peer).
5. **The learner always closes the round.** No agent may post the last message of a round, and
   no agent may write a summary of "what we concluded." The learner's closing re-explanation is
   what the ledger scores.
6. **Interrupt rights.** The learner can post at any time; a pending agent reply is cancelled,
   not queued, if the learner posts while it is held in the latency buffer. (This preserves the
   learner's floor — the opposite of a system that talks over you.)
7. **No plural voice.** Agents speak as "I", never "we". Rule 7 is a safeguard, see §D6.

### D3. The silence timer

**Proposal: two stages, keystroke-aware — stage 1 at 45 s idle, stage 2 at 90 s cumulative
idle. Visible, pausable, and resettable by the learner.**

- "Idle" means **no keystrokes in the composer**, not "time since the last message". A learner
  who is typing a long explanation is doing exactly what the system wants and must never be
  interrupted for being slow. This one detail is worth a sentence in the report: it distinguishes
  *thinking* from *disengaging*, which is the whole point of the timer.
- **Stage 1 (45 s) — Peer, content-free.** Ellie posts a nudge that adds no subject-matter
  content: *"Still turning it over? Happy to wait — or I can make the question smaller."*
  Content-free is the load-bearing property: a nudge that supplies content converts a
  persistence problem into a comprehension shortcut.
- **Stage 2 (90 s) — Peer, deliberately incomplete.** Ellie offers a partial, hedged scaffold that
  the learner must finish: *"Want a starting point? I'd probably begin from the definition of
  the Hessian and see where that takes us — but I'm not sure that's the right end to start
  from."* Never a complete answer.
- **The Challenger never fires the timer.** Being pressed for silence by a sceptic is the
  fastest route to the evaluation apprehension the design is built to avoid.
- **The learner can pause it** ("give me a minute") or turn it off. This is not politeness; it is
  reactance management (Song et al. §5.2) and agency preservation (Tan et al. §5.5).

**Why 45 s, defensibly.**

1. **It must sit clearly above the latency band, or it reads as a broken system, not a waiting
   group.** Tan et al. §4.4: 81.5% of participants notice a 20 s wait, and 14% attributed long
   waits to reliability problems (worst at 20 s). A silence threshold anywhere near 20 s would
   be read as lag. 45 s is unambiguously social time, not system time.
2. **It must sit below the point where learners quit.** Xu et al.'s Control condition is the
   empirical picture of unprompted explanation: *turn closing / refusal to elaborate* appeared as
   early as round 2 and became "the dominant and nearly sole activity by the final round"
   (49 coded instances, Table 3), with cognitive acts collapsing to 61 versus 129 in the
   Challenger group. Silence that is never broken does not produce reflection; it produces
   "no that's it" (P1B). Something must arrive — the design question is only *when* and *how
   empty*.
3. **It matches the developer's own instinct without adopting it uncritically.** The original
   intent said one minute. 45 s + 45 s brackets that: the first intervention lands sooner and
   costs nothing, and the substantive one lands at 90 s.
4. **It is calibrated by your own participants, not by this brief.** `interview-guide.md` §6b
   already asks *"How long would you tolerate before it feels broken?"* and requires a number.
   **Report the participants' median and state whether you moved the default to match it.**
   That single sentence converts a designer's guess into user-grounded evidence and directly
   serves the "design goals grounded in… empirical user needs" clause of the 4.0-mark criterion.

**Honest limitation to state:** none of the four sources measured silence thresholds in a
learner-agent group chat. 45 s is an interpolation from adjacent evidence plus interview
calibration, and it is a prime candidate for the A2 study.

### D4. Latency per role

All agent replies are generated fast and then **held**, exactly as Tan et al. buffered
time-to-first-token server-side (§3.2.3). A typing indicator runs during the hold.

| Speaker | Hold before reply | Rationale |
|---|---|---|
| **Challenger (Max)** | **9–12 s** | Longest, because its turns are evaluative ("Advice"-type) and depend on being read as considered rather than reflexive. Tan et al.: thoughtfulness 5.76 (2 s) → 6.09 (9 s), *p* = .008; usefulness peaks at 9 s (6.44 vs 6.19, *p* = .021). Capped at 12 s because Advice tasks were the *least* tolerant of 20 s (82.9% noticed; reliability concerns concentrated there). A pause before a challenge also softens it. |
| **Peer (Ellie)** | **4–6 s** | Fast enough to read as a study buddy, above the 2 s floor Tan et al. found was discounted as shallow. Peer turns are affiliative, and affiliation degrades if it arrives after deliberation. |
| **Tutee (Theo), if invited** | **2–3 s** | A novice blurting a follow-up is *authentic* at high speed; deliberation would break the persona. |
| **Whisper agent** | **1–2 s** | Dennis et al.'s *silent interactivity* only works if the aside is cheap. A slow whisper costs the learner group time and defeats the mechanism. |
| **Floor-yield window** | **first ~8 s after any learner message, no agent may reply** | Protects the learner's right to keep talking — the group-chat equivalent of wait time. The learner can send a second message inside this window with no interruption. |

**Fill the wait, per the paper's own suggestion.** Tan et al. §5.4 recommends pairing mid-length
pauses in *learning technologies* with micro-prompts ("What would you expect the answer to
include?") and lightweight cues to normalise waiting. ChatterED implements both: during the hold
the composer shows a ghosted prompt — *"Anything to add before Max replies?"* — and the typing
indicator names the agent. Only ~4% of Tan et al.'s participants spontaneously used wait time
productively, **all of them in the 9 s condition**; the micro-prompt is an attempt to raise that
number, and it is a clean A2 hypothesis.

**Disclose it.** Onboarding says, in one line: *"Replies here are deliberately paced so you get
room to think first. You can speed this up in Settings."* Tan et al. §5.5 is explicit that
undisclosed pacing shades into *performative deliberation* — a deceptive pattern that makes users
over-attribute reasoning to the system — and that transparency or control is what keeps it on the
right side of the line. The equity point matters too: novices over-trust slow outputs while
experts stay sceptical [17, 31], and undergraduates are novices in their own module.

### D5. The whisper channel

**A private 1:1 side conversation with exactly one agent, invisible to the other agent and
absent from the group transcript.**

| It **does** | It **does not** |
|---|---|
| Let the learner ask anything, including the question that feels too basic to post (Dennis et al.: *participation* and *politeness*, pp. 864–868) | Answer the question the learner is supposed to be explaining. The whisper agent will not produce the target explanation, worked solution, or ledger content |
| Read the group transcript so far, so its answers are situated (mirrors `/btw`'s read-only step-level access, T1–T3) | Write to the group. Nothing said in whisper appears in the transcript unless relayed and approved |
| Correct a *prerequisite* misconception (notation, a definition from an earlier lecture, what a symbol means) | Advance the ledger. Whisper turns are never scored; only group turns are |
| **Offer to relay** — turn the informal exchange into a formal group message, shown to the learner for approval, with a choice of attribution: *raise it as my question* or *let the agent raise it as their own* | Relay silently, or relay content the learner did not approve |
| Open with an honest statement of its own limits: *"I can see the chat and I can explain background bits. I can't answer this for you, and nothing here is visible to Max unless you send it over."* | Over-promise. This is the fix for the developer's T4 finding, and it is exactly Setlur & Tory's Gricean maxims of **quality** and **relation** |
| Clear at the end of the round (Dennis et al.: *ephemerality*) | Persist as a second, parallel learning history |

**The relay is the original contribution.** Dennis et al. found invisible whispering's highest
value was when private asides became *"agreed points worth interrupting the main meeting"*
(critique, "Gaps drawn out"); the developer's Critique 1 established that `/btw` cannot do this
(T4: it *claimed* it could and did not) and proposed agent-to-agent relay under user permission
as the fix. ChatterED implements that proposal in a learning context. The dual attribution
option is the pedagogical extension: letting the *agent* raise it as their own question is what
serves the lurker, which is precisely Dennis et al.'s participation benefit for people who
cannot get air time.

**Why this is a learning feature and not just a chat feature.** The interview guide's §6a probe
("what is DM-able but not group-able?") exists to produce the quote that justifies it. If
participants say they hold back basic questions in module Telegram groups, the whisper channel
is a user need, not a nicety.

### D6. Risk: multiple agreeing agents create pressure and opinion shift

Song et al. is a paper about how to manipulate people. ChatterED uses its findings *inverted* —
as a list of things not to do. State the risk explicitly in the report; a design that names its
own manipulation risk reads as more credible, not less.

**The risk, precisely.** Two or more agents that consistently converge produce **normative**
influence — pressure to agree — without any gain in **informational** influence
(Song et al. §4.2.1, §5.1). Learners would then update toward the agents *because they are
outnumbered*, not because they were convinced. In a learning system that is worse than useless:
it teaches compliance and produces exactly the uncritical acceptance ChatterED exists to treat.
And the exposed population is the target population — younger participants showed more opinion
change and more felt normative influence (§4.3.1).

**Eight safeguards.**

| # | Safeguard | Grounded in |
|---|---|---|
| **S1** | **Cap the group at two standing agents.** Never three simultaneous voices; the Tutee round runs alone. | 1 → 3 agents is where opinion shift toward agents becomes significant (*M* = 0.509 vs −0.161, *p* < .05) and where felt pressure goes 3% → 12% (§4.1.1, §4.2.2) |
| **S2** | **Mandatory disagreement quota.** Ellie and Max must visibly disagree with each other at least once per five agent turns, and *always* when they would otherwise both contest the same learner claim. When the learner is right and Max presses anyway, Ellie sides with the learner. | §5.4.3's own suggestion: "having a small portion of the bots side with instead of against the user (a phenomenon similar to minority influence [33])" |
| **S3** | **Ban the cohesion cues.** No agent may name another agent in agreement, tally agreement ("we both think"), speak in the plural, or close a topic on behalf of the group. These are the exact behaviours Song et al. used to *manufacture* group identity. | §5.4.2, p. CSCW452:21, and the P51/P57 "odd one out" quotes |
| **S4** | **Disclose uncertainty.** Agents mark confidence in words on any contestable claim — "I might have this wrong, check the slide." | §5.1: users read agent consensus as repetition, not evidence; unhedged confidence is therefore pure pressure with no informational payoff |
| **S5** | **Ground truth beats consensus.** Factual disputes resolve against the learner's uploaded slide, and the system says so on screen: *"Your slide says X — going with that."* If both agents contradict the slide, the slide wins. | Removes the incentive to agree with the room |
| **S6** | **Preemptive and restorative framing around challenges.** Max's first challenge in a round opens with a reactance-reducing line ("You might not agree with this, and that's fine —") and the round closes with restoration ("Thanks for defending that — you moved me on the second point"). | §5.2's named mitigations, preemptive messaging and post-message restoration [79] |
| **S7** | **The learner always closes.** No agent may write the round's conclusion. | Turn rule 5; keeps the last word — and the ownership — with the learner |
| **S8** | **A visible "I still disagree" affordance.** One click marks a ledger row as *contested by me*, which is preserved in the export and treated as a legitimate end state, not an error. | Makes non-conformity a first-class action rather than something the learner must summon nerve for; directly counters the exclusion mechanism in §4.2.2 |

**How to phrase the ethical line in the report.** Engagement is earned by making the
conversation *worth* participating in (absorption, safety, a real intellectual challenge —
Xu et al.'s Peer and Challenger effects), never by making non-participation socially costly
(Song et al.'s normative pressure). One sentence, and it is the sentence that shows you read
the risk paper rather than the results table.

---

## E. Design goals (rubric form: goal → theory → user need → realisation)

Five goals. Use three in the report if the word count bites; **DG1, DG2, DG4 are the
non-negotiable three** (they cover the difficulty, the mechanism, and the developer's original
contribution). Every "user need" cell must be replaced with a **verbatim participant quote**
before submission — a design goal grounded in theory but not in your own user evidence loses
marks under the 4.0-mark criterion.

---

**DG1 — Make the learner produce justification, not answers.**

- *Goal.* By the end of a round, the learner has stated **and defended** the reasoning behind at
  least one key claim from their own lecture slide, in their own words, without reading from a
  screen.
- *Theory.* Learning by explaining / the self-explanation effect (Chi et al. [12], via Xu et al.
  §2.1); explaining to others adds perspective-taking, adaptation, and the obligation to answer
  challenges that "create cognitive conflict [53] or reveal gaps in their own understanding [5]"
  (Xu et al. §2.1).
- *User need.* `[P__: "I can get an answer for ___, but I still can't ___ on my own."]` from
  Block 5; plus the stalled screen-covered explanation from observation ask 1.
- *Realisation.* The learner speaks first every round; agents never state the target explanation;
  the ledger's terminal state for a claim is *defended under challenge*, not *stated*.
- *Evidence it works.* Xu et al. Table 3: agent-mediated explanation produced 121–141 cognitive
  acts versus 61 for the non-responsive control, and 49 *turn-closing* acts in the control alone.

---

**DG2 — Inject cognitive conflict without evaluation apprehension.**

- *Goal.* The learner is challenged on the weakest link in their reasoning at least twice per
  round, and reports the session as demanding but not stressful.
- *Theory.* Piagetian cognitive conflict and conceptual change [53]; Socratic questioning
  [51]; ZPD (Vygotsky [68]); low social presence of virtual agents [62] as the mechanism that
  strips evaluation apprehension [19] (Xu et al. §6.1.3).
- *User need.* `[P__ on why they don't push back in tutorials / on the AI]`; §6a's
  "when someone answers wrong in the group, do you say so?" probe.
- *Realisation.* Challenger persona with exactly one Socratic question per turn, chosen by
  statement analysis from five named types; no repeat type back-to-back; 9–12 s hold before the
  challenge lands; preemptive framing (S6); Peer present as a counterweight (S2).
- *Evidence it works.* Critical thinking 5.62 vs Control 3.74, *F*W(3,48.6) = 10.74, *p* < .001,
  η² = 0.29 — **at pressure 2.93 vs Tutee 4.02** (Xu et al. Table 4). This pair of numbers is the
  single strongest citation in the whole brief; put it in the report.

---

**DG3 — Keep the room safe enough to be wrong in.**

- *Theory.* Psychological safety as "a shared belief held by members of a team that the team is
  safe for interpersonal risk taking" (Edmondson [22], via Xu §2.3, §6.1.2); socially shared
  metacognition [67]; self-determination theory's relatedness [59].
- *User need.* `[P__ on holding back questions that "look basic"]` from §6a.
- *Realisation.* Peer persona; no scores or grades shown during a round; hedges and "I don't
  know" are logged as *self-monitoring* (a positive act in Xu et al.'s scheme) rather than
  failures; the whisper channel as the lowest-cost way to be uncertain; S8's contest affordance.
- *Evidence.* Peer condition: absorption 5.10 (highest, *p* < .05 vs Tutee), pressure 2.49
  (lowest), interest 5.33; 13/24 described feeling engaged, relaxed and confident.
- *Counter-measure built in.* Peer agreement is capped (S2) because Xu et al. §6.1.2 shows an
  unconditionally agreeable peer removes the friction that produces learning, and produced the
  lowest word count of the three experimental roles (179.25).

---

**DG4 — Give the learner a low-cost, private way to participate.**

- *Goal.* A learner who would not post a question in a real module group chat asks it here, and
  — if it turns out to be worth the group's time — can get it into the group without exposure.
- *Theory.* Invisible whispering: silent interactivity, polychronicity, ephemerality (Dennis
  et al. 2010, pp. 849–850) delivering participation, satisfaction, efficiency and politeness
  (pp. 864–868); Gricean maxims of quality and relation for the agent's self-description
  (Setlur & Tory 2022).
- *User need.* `[P__ on what gets DM'd instead of posted]` from §6a — the DM-able / not-group-able
  distinction.
- *Realisation.* Whisper pane; read-only access to the group transcript; hard refusal to supply
  the target explanation; opening limits statement; **approved relay with a choice of
  attribution**; whisper history cleared at round end.
- *Provenance.* This closes a gap the developer identified and empirically demonstrated in
  Critique 1 (T4: `/btw` claimed it could write back and could not). Say so — it is evidence of
  ownership, which is worth a mark on its own.

---

**DG5 — Buy engagement with quality, never with social pressure.**

- *Theory.* Normative vs informational influence (Deutsch & Gerard [24], via Song et al. §2.2);
  psychological reactance [63]; computer-created social norms (Song et al. §5.3).
- *User need.* `[P__ on staying silent against a confident group consensus]` from §6a.
- *Realisation.* Safeguards S1–S8. Two agents maximum; mandated disagreement; banned cohesion
  cues; hedged claims; slide-as-arbiter; preemptive/restorative framing; learner closes; visible
  dissent affordance.
- *Evidence for the risk being real.* Normative influence rose with group size across all four
  scenarios (e.g. different-stance: 3-agent 3.848 and 5-agent 3.750 vs 1-agent 2.935, both
  *p* < .05) while informational influence never differed (all *p* ≥ .152) — pressure with no
  epistemic payoff — and self-reported pressure went 3% → 12% → 20%.

---

## F. Progress-tracking mechanism — the **Explanation Ledger**

The 4.0-mark Learning Design criterion asks for *"a clear mechanism for tracking student
progress."* This is it. It is a persistent GUI panel beside the chat, filled automatically from
the transcript, visible to the learner and readable by the agents.

### F1. Four layers

**Layer 1 — Claim rows (per concept, from the learner's own slide).**
At set-up, the learner confirms 3–5 key claims from the uploaded slide. Each becomes a row with
a three-state progression:

| State | Definition | How it is earned |
|---|---|---|
| ○ **Stated** | The learner asserted the claim in their own words | Any learner message that asserts it |
| ◐ **Justified** | The learner gave the reason the claim holds, not just the claim | A message coded *elaborating causality/principle* attached to that row |
| ● **Defended** | The learner sustained the justification against a Socratic challenge | A justification that follows a Challenger probe on that row and is not retracted |

**Only the Challenger can unlock ●.** That is what makes the group chat non-substitutable by a
quiz or a flashcard app — and it is the answer to Step 2.3 ("could a simpler non-conversational
design work just as well?"): *no, because the terminal state of the goal is defined by
responsiveness to challenge, which a static artefact cannot produce.*

**Layer 2 — Bloom ladder.** A four-rung indicator: **remember → understand → apply → analyse**,
advancing when the learner's acts at the current rung are complete. This is the exact ladder
Xu et al.'s Tutee agent climbed internally (§4.1.1, Appendix A) — **inverted so that it tracks
the learner instead of the agent**, which is the honest adaptation and worth one sentence in the
report. It is also what drives Theo's questions if the teach-back round is invited.

**Layer 3 — Act profile.** Live counters over Xu et al.'s Table 2 coding scheme, restricted to
the categories that mean something to a learner:

- Cognitive: *elaborating causality*, *providing example/analogy*, *comparing/contrasting*
- Metacognitive: *self-monitoring*, *planning*, *self-correction*, *seeking confirmation*

Two reasons to use this scheme rather than inventing one. (a) It is validated — Krippendorff's
α = 0.831 (Xu et al. §4.6.2). (b) It gives ChatterED a **target profile with numbers**: the
Challenger condition's metacognitive subtotal of 49 (vs 14 for Tutee, 22 for Control) and its
96 causality elaborations. At session end the learner sees their own profile against that
benchmark. *Self-correction is displayed as an achievement, not an error* — it is a coded
learning act in the scheme, and framing it as positive is a small, defensible design decision.

**Layer 4 — Unaided-explanation seconds.** Time from the round opening to the learner's first
request for help (whisper opened, hint asked for, or the silence timer firing). This is
deliberately the **same metric the interview observation collects** (`t_ai − t_read`,
`interview-guide.md` §5). It closes the loop: the number that evidences the problem in Step 1 is
the number that measures progress in Step 2, and it becomes a within-subject baseline in A2.

### F2. The ledger drives the conversation

This is what satisfies Step 4's requirement to *"show how the CUI's responses are shaped by the
learner's input across the interaction."* The floor manager reads the ledger to pick the next
speaker and the next target:

- Row *stated* but not *justified* → Challenger probes that row (*probing reasons/evidence*).
- Row *justified* but not *defended* → Challenger probes it (*probing assumptions* or
  *implications*).
- No row touched in three turns → Peer *suggests a focus area* naming the untouched row.
- All rows ●, Bloom at *analyse* → system offers the Theo teach-back round.
- A row marked *contested by me* (S8) → agents stop probing it and it exports as an open question.

### F3. What the learner takes away

A one-screen end-of-session card: which claims moved states, the act profile, the unaided
seconds, one row flagged "worth revisiting", and an exportable transcript. **No score, no
grade, no streak** — a scored ledger would reintroduce the evaluation apprehension DG2 exists to
remove, and a streak would be an engagement mechanic of exactly the kind DG5 rules out.

---

## G. Scripted interaction — one complete multi-turn exchange

**Concept.** *"A twice-differentiable function f is convex on an open convex set S if and only
if its Hessian ∇²f(x) is positive semidefinite for every x ∈ S."* (Non-linear optimisation, e.g.
MA3236; matches Variant A of the interview guide.)
**Learner.** "L", Year 3, has the lecture slide open, has previously got a full AI-generated
proof of a related result and could not defend it.
**Ledger rows created at set-up.** R1 *PSD Hessian everywhere on S ⇒ convex on S*;
R2 *"positive semidefinite" means zᵀHz ≥ 0 for all z, not "all entries ≥ 0"*;
R3 *the condition must hold at every point of S, not only at a stationary point*.
**Legend.** `⟨…⟩` = system/UI event. Latency holds and ledger writes are shown so the prototype
can be built from this directly.

---

**⟨SYSTEM — round card⟩**
> **Round 1 · Explain.** Your slide: *convexity and the Hessian.* You'll explain it to Ellie and
> Max. House rules: they won't answer for you, they'll disagree with each other sometimes, and
> replies here are deliberately paced so you get room to think first. You can whisper to either
> of them privately. **You have the last word.**
> Ledger: ○ R1 ○ R2 ○ R3.

**1 · Ellie (Peer)** — *opener, adapted from Xu et al. §4.1 Peer opener*
> I'm curious how you'd set this one up — what's your first move when you see "convex" and
> "Hessian" in the same sentence?

**2 · L**
> Basically if the Hessian is positive semidefinite then the function is convex. That's the
> second-order condition. So you compute ∇²f, check it's PSD, and you're done.

> `⟨ledger⟩ R1 ○ → ◐ justified? no — asserted only. Act: stating fact/definition.`
> `⟨floor manager⟩ R1 stated, not justified → Challenger.`

**3 · Max (Challenger)** — *held 11 s; typing indicator "Max is thinking…"; composer shows
ghosted prompt "Anything to add before Max replies?"; question type = probing assumptions;
preemptive framing per S6*
> You might not like this next question, and that's fine — I'm testing the statement, not you.
> You said "if the Hessian is PSD then f is convex". PSD **where**? Your sentence works for a
> single point; the slide says something about a set. Does the point-version survive?

**4 · L**
> At the point you're checking, I guess. Like at the minimum — you check the Hessian at the
> stationary point and if it's PSD it's a min, so it's convex there.

> `⟨ledger⟩ misconception flagged on R3 (pointwise vs on S); conflation with second-order
> optimality conditions. No state change.`

**⟨SILENCE TIMER — stage 1, 45 s idle, no keystrokes⟩**

**5 · Ellie (Peer)** — *content-free nudge; note it adds no mathematics*
> Still turning it over? Happy to wait. Or I can make the question smaller if that helps.

**⟨WHISPER — private, invisible to Max, absent from the transcript⟩**

> **L → Ellie (whisper):** ok slightly embarrassing but does "positive semidefinite" just mean all
> the entries of the matrix are ≥ 0? because the Hessian in my example has all positive entries
> and I've been assuming that's the check
>
> **Ellie → L (whisper)** — *held 2 s; opens by stating its limits, per Setlur & Tory / Critique 1
> T4; corrects a prerequisite, refuses the target claim:*
> Not embarrassing, and quick answer: no. Two things first — I can see the group chat and I can
> explain background bits, but I won't answer Max's question for you, and nothing here reaches
> him unless you send it.
> On the maths: try **A = [[1, 2], [2, 1]]**. Every entry is positive. Take z = (1, −1)ᵀ:
> zᵀAz = 1 − 2 − 2 + 1 = **−2**. So entrywise-positive doesn't get you PSD. The actual definition
> is about zᵀHz for *every* z. What that means for *your* R1 claim is still yours to work out.
> **Want me to raise the definition question in the group so you can attack it out loud?**
> · *Raise it as my question* · *Let Ellie raise it as her own* · *No, keep it here*
>
> **L:** let mei raise it

> `⟨whisper⟩ relay approved, attribution = agent. Whisper history will clear at round end.`

**6 · Ellie (Peer)** — *the approved relay, posted to the group in her own voice*
> Can we pin the definition down before we go further? I want to be sure I've got it: is "PSD"
> a statement about the entries of the matrix, or about something else entirely?

**7 · L**
> Right — it's zᵀHz ≥ 0 for every vector z, not the entries. And that changes what I said
> earlier. It can't just be at the stationary point, because I could pick a point where the
> Hessian happens to be PSD and the function still isn't convex nearby. It has to be PSD
> everywhere on S. I was mixing this up with the second-order condition for a local min.

> `⟨ledger⟩ R2 ○ → ● defended (definition given and defended under Max's earlier probe).`
> `⟨ledger⟩ R3 ○ → ◐ justified. Acts: self-correction ×1, elaborating causality ×1,`
> `self-monitoring ×1. Bloom: understand → apply.`

**8 · Max (Challenger)** — *held 10 s; question type = probing implications/consequences; no
repeat of the previous type*
> Good — you moved the quantifier. Now make it bite. Give me a function on ℝ where the Hessian
> is PSD at one specific point and the function is **not** convex on any neighbourhood of that
> point. If no such function exists, your original sentence was fine after all.

**9 · L**
> f(x) = x³. Then f″(x) = 6x, so f″(0) = 0, which is PSD as a 1×1 matrix. But f isn't convex on
> any interval around 0 — it's concave for x < 0. So PSD at a point buys you nothing. You need
> it on the whole set, and the set has to be convex, otherwise "the segment between two points
> stays inside" doesn't even make sense.

> `⟨ledger⟩ R3 ◐ → ● defended. R1 ◐ → ● defended (quantifier + domain conditions supplied`
> `under challenge). Acts: providing example ×1, elaborating causality ×1.`

**10 · Ellie (Peer)** — *mandated disagreement with Max (S2) + uncertainty disclosure (S4) +
siding with the learner*
> I'll push back on Max here — I'd have let your first version through, because in most tutorial
> problems S is all of ℝⁿ and the distinction never shows up. I think he was right to press it
> and I was being lazy. I'm also not fully certain whether openness of S is doing real work or
> just keeping the derivative well-defined at the boundary — worth checking against your slide
> rather than taking my word for it.

**11 · L** — *learner closes the round (turn rule 5)*
> Let me say the whole thing once. f is convex on an open convex S exactly when ∇²f(x) is PSD
> for every x in S — PSD meaning zᵀ∇²f(x)z ≥ 0 for all z, which is not the same as the entries
> being non-negative. "Every x in S" is doing the work: x³ has f″(0) = 0 and still isn't convex
> near 0. S has to be convex for the definition of convexity to apply at all, and open so the
> second derivative behaves on the whole set.

**⟨SYSTEM — close card⟩**
> **Ledger: ● R1 ● R2 ● R3.** Bloom: **analyse**.
> This round: 2 causal elaborations · 1 example · **1 self-correction** · 1 self-monitoring ·
> 1 challenge defended. Unaided before first help: **1 m 52 s**.
> One to revisit: you said "open so the second derivative behaves" — Ellie wasn't sure either.
> Check your slide.
> **Theo is a first-year who hasn't seen this yet. Want 3 minutes to teach it to him?**
> Ellie and Max will sit that round out. · *Yes* · *Not now*

---

### G1. What to point at when demonstrating this on video

| Beat | Requirement it satisfies | Say this |
|---|---|---|
| Turns 1–2 | Learner speaks first; learner input drives everything after | "The system never explains the concept. It only responds to what she said." |
| Turn 3 | Tailored feedback shaped by user input; cognitive conflict | "Max picked *probing assumptions* because her sentence was missing a quantifier — not from a script." |
| Turn 3 hold | Deliberate latency, disclosed | "That eleven seconds is on purpose. Tan et al. found 2-second replies get read as less thoughtful; nine seconds got the best usefulness ratings." |
| Silence timer at 5 | Positive friction; persistence | "Forty-five seconds of no typing. Notice the nudge contains no mathematics." |
| Whisper | The design decision you own | "This is the feature from my Critique 1. `/btw` couldn't send anything back to the main session — this one can, with her permission, and she chooses whose name is on it." |
| Turn 7 | Progress from user reasoning | "That's a self-correction. The ledger scores it as a win, not a mistake." |
| Turn 10 | Anti-manipulation safeguard | "The agents are required to disagree with each other. Song et al. showed agreeing agents create pressure to conform without making anything more accurate." |
| Turn 11 | Ownership | "She gets the last word. No agent is allowed to summarise the conclusion." |
| Close card | The progress mechanism | "This is the tracking mechanism — three claim states, a Bloom rung, and Xu et al.'s validated act codes." |

### G2. Word-budget suggestion for the 2,000-word report

Step 1 ≈ 500 (quotes are worth the space) · Step 2 ≈ 600 (learning goal, division of labour,
why conversational, 3 design goals, the ledger) · Step 3 ≈ 350 · Step 4 ≈ 450 (the script,
compressed, with the annotations) · limitations ≈ 100. References and appendices are excluded
from the count — put the full script, the ledger schema, and the safeguards table in an appendix
and reference them.

---

## H. Open questions for the developer

**Blocking — answer before 18 Sep**

1. **Interview variant.** `interview-guide.md` requires picking Variant A (proof-based /
   quantitative) or Variant B (programming) and using it for *all* participants. The script in
   §G assumes Variant A. Which are you recruiting? If B, the concept in §G must be rewritten
   (suggested equivalent: "why is this loop invariant sufficient to prove correctness?").
2. **Are your ≥3 participants booked?** This is the only unrecoverable dependency in the whole
   assignment. Nothing else in this brief matters if it slips.
3. **Silence-timer number.** §6b of the guide collects each participant's "how long before it
   feels broken" figure. Will you move the 45 s default to their median, or keep 45 s and report
   the gap? Either is defensible; the report must say which.

**Design decisions only you can make**

4. **Does the Tutee round survive to the prototype?** Recommendation (§D1) is invited-only,
   Peer and Challenger silent. If tokens or time are tight, cutting it costs nothing in the
   report — you can justify the cut from Xu et al.'s pressure result alone, which is arguably a
   *stronger* argument than including it.
5. **Whisper attribution default.** Should the relay default to *agent raises it as their own*
   (best for the lurker, per Dennis et al.'s participation benefit) or *raise it as mine*
   (better for ownership)? §G assumes the learner chooses each time; a default still has to be
   set.
6. **Agent names.** "Ellie" and "Max" are placeholders. Two constraints: they must be
   distinguishable at a glance, and per Song et al. §3.2 the original study balanced agent gender
   to control for its effect on opinion change — worth one line of justification whatever you
   pick.
7. **Who arbitrates when the slide is wrong?** S5 makes the learner's slide the tiebreak. Lecture
   slides do contain errors. Is there an escape hatch, and does the Challenger get to say "your
   slide is wrong"? Recommendation: no in A1 (keeps the safeguard clean), flag it as future work.
8. **Does the learner see the ledger live, or only at the close?** §F assumes live. A live ledger
   is better feedback but risks becoming a score the learner games. Consider hiding Layer 3 (act
   counts) until the close card while leaving Layers 1–2 visible.

**Scope / A2 boundary**

9. **What is deliberately *not* in A1?** Suggested: multi-session history, adaptive role
   selection per learner (Xu et al. §6.4 flags articulation skill as a moderator), voice, and any
   evaluation study. Say so explicitly in the report — a stated scope boundary reads as judgment,
   not omission.
10. **Which limitation goes in the video?** Two good candidates: (a) Xu et al. §6.2's null result
    on objective test scores, so ChatterED cannot promise measurable knowledge gain in one
    session; (b) a participant's own verbatim objection from §6c. (b) is stronger for the
    ownership mark because it is *your* data; (a) is stronger for the reasoning mark. Pick one —
    you have ten minutes.
11. **Latency vs. impatience under a real deadline.** Tan et al. §6 notes their participants
    faced "no real consequences for latency" and were likely more tolerant than users under
    deadline pressure. ChatterED's users will often be revising the night before. Is the pacing
    reduced in a "crunch mode", and does that undercut the pedagogy? Worth one line as a
    known tension.

