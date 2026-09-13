# Competitor and adjacent-product notes (salvaged from the 2026-09-13 market scan)

Two nested research passes completed before the parent market-scan agent was killed by the
usage limit. Their findings are preserved here, trimmed to what matters for **feature and
product design**. Business-model, funding and compliance material is deliberately omitted
(out of scope per issues #12, #13). Every claim carries the URL it was verified against;
"not verified" means the primary source blocked automated fetching.

## Headline

**No shipping education product puts two or more distinct AI personas into one conversation
with a learner.** Every education product below is one agent per conversation, including the
four that offer a *menu* of personas. Multi-persona learning conversations exist only as
research prototypes (SimClass, EduVerse, OnlineMate, DialogLab). The only shipping
multi-persona group chats are companion/entertainment products (Character.AI rooms, LM Mini).

Separately unoccupied in the learning category, as of Sept 2026:
- **Two personas in one learner chat** — shipping only in companion apps.
- **Silence timer / proactive nudge into a quiet chat** — nearest analogues are Praxis AI's
  "proactive trigger APIs" (https://claude.com/customers/praxis) and Mainstay's behavioural
  nudging for enrolment/retention (https://mainstay.com/), neither in subject learning.
- **Whisper side channel to one agent inside a group** — no product, education or companion,
  documents this. Explicitly absent from the most detailed 2026 Character.AI group-chat guide
  (https://aitechatlas.com/character-ai-group-chat/). **Likely ChatterED's most novel component.**
- **Deliberately delayed replies as pedagogy** — no product markets it; one design-critique blog
  argues tutors should wait longer before prompting
  (https://neuralveda.com/2026/06/04/your-ai-language-tutor-has-no-idea-when-to-shut-up/).

Caveats: ~a third of target sites (chegg.com, studyfetch.com, quizlet.com, openai.com,
character.ai/plans, support.character.ai) return 403 to fetchers; the WebSearch budget ran out
mid-scan. Praxis AI is the one unresolved risk: it has multi-agent workflows, proactive
triggers, Claude on Bedrock and Canvas distribution, and its pages do not say whether two
"digital twins" can share one conversation (https://praxis-ai.com/digital-twin/).

## Ranked shortlist — closest to ChatterED

1. **Character.AI Character Rooms / Group Chat** — closest on mechanics, furthest on pedagogy.
   Launched 11 Oct 2023 (https://blog.character.ai/new-feature-announcement-character-group-chat/;
   https://techcrunch.com/2023/10/11/character-ai-introduces-group-chats-where-people-and-multiple-ais-can-talk-to-each-other/).
   Up to 10 AI characters + 10 humans per room (Group Chat FAQ, via search index;
   https://aitechatlas.com/character-ai-group-chat/). Turn-taking is user-directed: tap an
   avatar to address a character (https://aiinsightsnews.net/how-to-make-a-group-chat-on-character-ai/);
   users hand-write pinned rules like "only speak when tagged" to get order (5 pinned messages
   per chat). Whether characters autonomously address each other in 2026 is contested
   (https://www.roborhythms.com/multi-bot-rooms-on-character-ai/) — not verified. No timing,
   pacing or silence mechanic; no whisper; c.ai+ is sold on *faster* replies. No learning
   features anywhere first-party (https://character.ai/about); community "Study Buddy" bots
   are explainer-to-student, e.g. 106.5k interactions
   (https://character.ai/character/adY_-n5N/personalized-studying-study-buddy). Group chat is
   absent from current marketing (App Store listing, /about); 2026 blog is microdramas/Comics.
   Under-18 open-ended chat removed 25 Nov 2025 (https://blog.character.ai/u18-chat-announcement/).
   **Design lesson:** the group-chat format is proven with 16–30-year-olds; orderly turn-taking
   and role complementarity are what users currently have to hack in themselves.

2. **Classmates AI (myclassmates.ai)** — closest on pedagogy: the student *teaches* an AI
   classmate from uploaded PDFs/videos; explicit protégé-effect framing (https://myclassmates.ai/).
   Eight persona types are a menu, one agent per conversation. Free tier: 5 agents,
   25 interactions/day; Pro $20/mo (https://myclassmates.ai/pricing). No group, no adversarial
   second voice, no timer, no whisper, no pacing. Web only.

3. **Praxis AI** — closest on infrastructure: professor "digital twins" native in Canvas, with
   multi-agent workflows, real-time voice and **proactive trigger APIs**, on Claude via Bedrock
   (https://praxis-ai.com/education/; https://claude.com/customers/praxis;
   https://aws.amazon.com/solutions/case-studies/praxis-ai-bedrock/). Persona is the *authority*,
   the inverse of a confused peer. Named twins (Clarkey, Coach JenAI, Digital Dr. Cantu) presented
   singly (https://praxis-ai.com/digital-twin/). Deployed at Clemson, Alabama State, AIHEC;
   claims 75% engagement vs 14% generic chatbots (vendor-reported).

4. **Microsoft Study and Learn Agent** — "the learner does the thinking, and the agent coaches
   them" (https://support.microsoft.com/en-us/education/copilot/study-learn-agent). Single agent;
   scaffolded chat + flashcards/quizzes grounded in the student's uploads; **free with any
   M365 Education A1/A3/A5 licence, ages 13+**; web + Windows, mobile planned
   (https://www.microsoft.com/en-us/education/blog/2026/07/study-and-learn-ai-built-for-learning-in-microsoft-365-copilot/).
   **This is the free baseline most NUS students already have.**

5. **Cognii** — the "student produces the explanation, AI evaluates it" loop since before LLMs;
   open-response formative assessment, claims 96% agreement with human graders
   (https://www.cognii.com/technology; http://www.cognii.com/virtual-learning-assistant).
   One assessor agent, B2B, no pricing, low visible momentum (https://www.cognii.com/news).

Honourable mention: **Khanmigo's debate activity** — the only mainstream adversarial-AI
learning feature; one opponent, one persona; $4/mo or $44/yr, US-only for learners
(https://www.khanmigo.ai/learners).

## Other products checked

- **Quizlet Q-Chat** — ChatGPT-based tutor launched Mar 2023 (https://quizlet.com/blog/meet-q-chat);
  widely reported discontinued June 2025, **not verified** (Quizlet pages 403;
  https://thetoolsverse.com/tools/quizlet-ai-flashcards-study-games). Quizlet moved to content
  generation: Coconote acquisition Feb 2026, ChatGPT integration Mar 2026
  (https://en.wikipedia.org/wiki/Quizlet). Signal: the biggest study brand retreated from
  conversational tutoring.
- **Coursera Coach** — single Socratic assistant, 34M+ messages, 2.4M+ learners; instructor-
  configured "interactive instruction" on Gemini; explicitly no role-play characters
  (https://blog.coursera.org/announcing-ai-powered-capabilities-enabling-educators-to-use-coursera-coach-to-deliver-interactive-personalized-instruction/;
  https://blog.coursera.org/coach-wins-newsweek-ai-impact-award/).
- **Chegg** — Q2 2026 revenue $51.8M, −51% YoY; pivoting to employability
  (https://www.sec.gov/Archives/edgar/data/1364954/000136495426000085/a9901-financialresultsq220.htm).
  Not a feature competitor.
- **StudyFetch / Spark.E** — single "Sparky" tutor incl. voice; iOS Premium $19.99/mo, voice
  metered $7.49/hr (https://apps.apple.com/us/app/studyfetch-make-learning-easy/id6663574866).
  Web pricing not verified. Precedent: metering long real-time sessions by the hour.
- **Google Socratic** — dead 2024 (https://killedbygoogle.com/); replaced by Gemini **Guided
  Learning**, 6 Aug 2025, single companion on LearnLM
  (https://blog.google/outreach-initiatives/education/guided-learning/).
- **Sana** — acquired by Workday 4 Nov 2025, enterprise LMS, not a competitor
  (https://investor.workday.com/news-and-events/press-releases/news-details/2025/Workday-Completes-Acquisition-of-Sana-11-04-2025/default.aspx).
- **Mainstay** — proactive nudge bots for retention; became a nonprofit division 24 Mar 2026
  (https://mainstay.com/press/public-charity-acquires-pioneering-developer-of-ai-for-higher-education/).
  External validation that timed nudges into a silent conversation work.
- **ChatGPT Study Mode** — single-agent Socratic mode; details not verified (openai.com 403).
- **Ametros Learning** — pivoted from multi-character simulations to "Yuta" grading
  (https://ametroslearning.com/). **Mindgrasp** — single study buddy (https://mindgrasp.ai/study-aids/ai-study-buddy).
- **LM Mini group chat** — multi-model rooms with turn modes and parallel replies
  (https://lmmini.com/blog/group-chat.html); companion/dev tool, not learning. Product Hunt
  "multiple AI agents group chat" returns only dev/companion tools
  (https://www.producthunt.com/search?q=multiple+AI+agents+group+chat).

## Research prototypes with multiple personas in one conversation

| System | Human joins the multi-agent chat? | Notes |
|---|---|---|
| SimClass (NAACL 2025) | Yes — class-role agents, teacher–student and student–student talk, validated in two real courses | https://aclanthology.org/2025.naacl-long.520/ ; code https://github.com/THU-MAIC/SimClass |
| EduVerse (arXiv 2510.05650, Oct 2025) | Yes — human-in-the-loop classroom of simulated agents | https://arxiv.org/abs/2510.05650 |
| OnlineMate (arXiv 2509.14803) | Yes — peer-like companions with Theory-of-Mind inference of learner confusion | https://arxiv.org/abs/2509.14803 |
| DialogLab (Google Research, Feb 2026) | Yes — framework for multi-party human–AI groups: personas, fluid turn-taking, interruptions | https://research.google/blog/beyond-one-on-one-authoring-simulating-and-testing-dynamic-human-ai-group-conversations/ |
| AgentSchool (arXiv 2605.30144) | No — simulator only | https://arxiv.org/abs/2605.30144 |
| Chrysalis (arXiv 2510.05271) | Single teachable agent; compares AI-tutor vs learning-by-teaching, n=36 | https://arxiv.org/abs/2510.05271 |
| Betty's Brain (Vanderbilt) | Single teachable agent; mentor agent not confirmed | https://en.wikipedia.org/wiki/Betty%27s_Brain |

Design warning from the LLM-teachable-agent literature: teaching ChatGPT improved knowledge
gains and self-regulation, but the agent's tendency to be *correct* limited error-correction
practice (https://arxiv.org/pdf/2412.15226). **A Peer that is too competent destroys the
protégé mechanism** — Mei must be allowed to be wrong. Foundational protégé-effect evidence:
Chase et al. 2009 (https://link.springer.com/article/10.1007/s10956-009-9180-4).

## Feature implications for ChatterED (for product-design.md)

1. Engineer turn-taking and role complementarity in the product — users of the only shipping
   group chat have to hack both with pinned rules.
2. Make the whisper channel a first-class, discoverable UI element; nobody else has it.
3. Show the pacing: a visible "Arun is thinking…" beats an unexplained pause, and the
   ledger update running inside the delay makes the wait do real work.
4. Let the Peer be wrong on purpose and let the student catch it; log when they do.
5. The free baseline is Microsoft's single coach — differentiate on the *social* mechanics
   (two voices, disagreement, whisper), not on "AI study help".
6. Local-first fits the segment: students already upload their own PDFs everywhere
   (Classmates AI, StudyFetch, Microsoft); a Mac app that reads slides from disk removes the
   upload step entirely.
