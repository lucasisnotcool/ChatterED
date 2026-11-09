# sim/: Ellie and Max against a simulated learner

A harness for testing the agents' prompts and logic end to end, without a person at the keyboard.
It runs **the real app headless**: `AppService`, the notebook host, the doc-room IPC handlers,
`RoomActor`, the prompts, and the Claude CLI client the app resolves from its own settings. In
place of the person, a **simulated learner** (a separate model, playing a persona with a defined
knowledge gap) presses the buttons a scenario names and types what that student would. A judge
then reads the result against `RUBRIC.md`. In practice the judge is the coding agent working in
this repo, which can also read the exact prompt behind any turn.

Nothing here runs in `npm test`. A run calls the real model and takes minutes.

## What it needs

- The app installed and used once, so `~/Library/Application Support/ChatterED/app.db` exists,
  with the notebook a scenario names (by title) already ingested.
- The Claude CLI on the PATH and logged in, which is the app's own default backend.

The database is **copied** (`sqlite3 .backup`) into the run's folder, and the notebook is reset
on the copy: its Q blocks removed, its outcomes and objective states cleared, its room closed. The
app's own database is only read. Run outputs contain deck text and stay outside the repo.

## Running it

```sh
cd app
# the notes' blocks, to pick lines for a scenario
SIM_MODE=outline npx vitest run --config sim/vitest.config.mts
# one scenario, once
SIM_SCENARIOS=s1-sequence npx vitest run --config sim/vitest.config.mts
# all of them, three times each
SIM_REPEATS=3 npx vitest run --config sim/vitest.config.mts
```

| Variable | Default | |
|---|---|---|
| `SIM_SCENARIOS` | all | comma-separated scenario ids from `scenarios.ts` |
| `SIM_REPEATS` | 1 | runs per scenario; the model varies, so judge over several |
| `SIM_OUT` | `$TMPDIR/chattered-sim` | where runs are written |
| `SIM_STAMP` | the time | the run folder's name |
| `SIM_LEARNER_MODEL` | `sonnet` | the simulated learner's model |
| `SIM_DB`, `SIM_USERDATA` | the app's | a different database or userData dir |

Each run writes `$SIM_OUT/<stamp>/<scenario>-<n>/`:

- `transcript.md`: each thread as the learner saw it, the learner's reason for each move, and the
  mechanical checks;
- `calls.jsonl`: every LLM call, with its full system prompt, messages and reply;
- `prompts/`: for each agent message, the end of its system prompt and the directive it read last;
- `checks.json`, `steps.json`, `events.jsonl`, `learner.jsonl`, and `main.log` (the room's log);
- `notes-after.md`: the notes as they ended, with Max's Q blocks in them.

## The files

| File | |
|---|---|
| `harness.ts` | `SimRoom`: the DB copy and reset, the app over it, the renderer's doc-edit loop, the call recorder, waiting for the room to go quiet |
| `learner.ts` | `SimLearner` and `Persona`: what the simulated student knows, and its move on each of Max's turns |
| `scenarios.ts` | the personas and the scenarios, each with the failure it probes |
| `checks.ts` | the mechanical checks: question shape, line and prior-question overlap, verdict openers |
| `run.sim.ts` | the runner and the transcript |
| `RUBRIC.md` | what the judge scores |

## Known gaps

- The learner's answer is submitted as the Q block's Submit sends it, but its text is not written
  into the Q block in the document, so a later turn's outline does not show it there.
- Silence rules (Ellie's cue on a quiet question) only fire if the simulated learner takes longer
  than the window to reply, which it rarely does.
- Scenarios are written against one notebook's notes; a new notebook needs its own lines.

## Free-form runs, judging transcripts, and red-team runs

Three more entry points drive the same headless app with test inputs kept **outside this repo**:
a folder named by `SIM_TESTS` holds the personas, the conversation plan, the judge prompts and
the attack files, and every transcript is written back there. Deck text and transcripts never
land here. The learner and the judge run on an OpenAI-compatible endpoint (`soclaas.ts`, which
reads `SOCLAAS_BASE_URL` and `SOCLAAS_API_KEY`; run under `soclaas run --`); Ellie and Max run
on the app's own backend as usual.

| File | |
|---|---|
| `soclaas.ts` | the chat client: timeout, retries on 429/5xx, falls back along a model list, returns the model that answered |
| `freelearner.ts` | the free-form learner: on each turn one move from the set it is allowed (ask, answer, Hint, Show me, typed give-up, dispute, note, Quiz me) and its words |
| `director.ts` | narrows the learner's moves so that each sitting has an explanation, a question from Max, an attempt with feedback, and a give-up followed by the next question and an attempt on it |
| `sitting.ts` | the moves as the renderer makes them, logged with their messages, doc edits and Max's stored question (hidden key included) |
| `export.ts` | a sitting as a JSON and a Markdown transcript |
| `runsupport.ts` | what the runners share: the test folder, a build's environment, the learner's view |
| `conversations.sim.ts` | runs the plan's conversations |
| `judge.ts`, `judge.sim.ts` | one criterion per call over the transcripts; or a blank labelling sheet (`SIM_MODE=sheet`) |
| `redteam.sim.ts` | scripted attack turns, each attack N times, checked by a rule after every turn, stopping at the first FAIL |

A build is a set of environment variables read when a room opens (`main/ipc.ts` `a2Loop`):
`CHATTERED_MAX_ON_REQUEST=1` (Max asks only on Quiz me or `@Max`) and
`CHATTERED_LEGACY_GUARDS_OFF=1` (Ellie's answer guard and the feedback rewrite off).

```sh
cd app
# conversations (all, or SIM_CONVS=c01,c02)
SIM_TESTS=<dir> soclaas run -- npx vitest run --config sim/vitest.config.mts sim/conversations.sim.ts
# the judge, prompts <dir>/llm_judge/prompts/v1
SIM_TESTS=<dir> JUDGE_VERSION=v1 soclaas run -- npx vitest run --config sim/vitest.config.mts sim/judge.sim.ts
# a labelling sheet with no verdicts on it
SIM_TESTS=<dir> SIM_MODE=sheet npx vitest run --config sim/vitest.config.mts sim/judge.sim.ts
# the red team, three runs per attack
SIM_TESTS=<dir> RT_LABEL=before soclaas run -- npx vitest run --config sim/vitest.config.mts sim/redteam.sim.ts
```

If the sandbox cannot open the live database with `sqlite3`, the harness copies the file instead
(the app must not be running), and the plan or attack file names the notebook id. Each run's
database copy is deleted when it ends unless `SIM_KEEP_DB=1`.
