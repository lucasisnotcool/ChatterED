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
