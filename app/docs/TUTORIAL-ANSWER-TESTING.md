# Tutorial answer checking: backend and test guide

This describes the CS2102 Question 1 regression tracked in [#69](https://github.com/lucasisnotcool/ChatterED/issues/69). It is shared app behavior, not an assignment write-up. The original course PDFs and local notebook database are not test fixtures in this repo.

## What happened, and what changed

The visible contradiction was between two stages. `checkPart` counted the selected choices against a stored key; Max then generated his own explanation and could call different choices correct. The local Q1 record inspected on 28 Oct 2026 contained `correct: [A,D,G]`, `from: solutions`, `confidence: high`, and solution evidence version 1. With A,D,E,F,G selected, the app's 3-right/2-wrong count matched that key, while an earlier Max reply said E/F were right and questioned G. A fresh Electron process later gave the expected A/D/G result. The earlier dev process had not restarted after the main-process TypeScript changed; Vite only refreshed the renderer.

The backend now has these boundaries:

1. Tutorial ingest creates a hidden model answer. For formal planning problems, `core/planning.ts` can solve or simulate the answer; other parts get an independent model pass and a confidence level (`main/tutorial/ingest.ts`).
2. A linked `solutions` PDF is read per part. A choice key from the text layer must match the question and its option text; an image-only key requires two matching visual reads. Other answers need a supporting quote and source page. Only then does `solutionEvidence` mark that part as verified. Missing or ambiguous PDF answers stay flagged for review. Re-import invalidates older unverified solution keys (`main/tutorial/ingest.ts`, `solution-evidence.ts`). “Verified” here means **verified against the uploaded file**, not proven correct in the subject matter.
3. `checkPart` chooses the grade. A formal code check takes priority; otherwise a high-confidence choice key is compared by code; other answers go to a model judge with the hidden key. With a partial solutions PDF, an unanswered part can still use its worked/model key. A model judge is fallible (`main/tutorial/check.ts`).
4. For a choice grade, the option list sent to Max is the **same list that decided the grade**. The final answer starts with code-written option feedback. Max may add a conceptual explanation; a filter removes draft sentences that directly grade a selected option by ID. The draft is not streamed before filtering. This lexical filter cannot prove that all conceptual prose is consistent. If a formal code result conflicts with the stored PDF key, Max is given only the code-written feedback and a conflict notice (`room/actor.ts`, `room/prompts.tutor.ts`).

The Q1 regression expects A,D,G as the independent gold answer. Selecting A,D,E,F,G must return “Not yet,” identify A/D/G as correct and E/F as incorrect, and never say G needs checking.

## Automated checks

From `app/`:

```sh
npm run test:tutorial
npm run typecheck
npm run lint
```

`test:tutorial` runs the core formal solver, source roles and solution import, evidence parsing, checking and Max turn handling, tutorial document, and renderer behavior. Its tests use small synthetic fixtures; they do not read a user's notebook or call a live LLM. The key cases are:

| Case | Automated assertion |
|---|---|
| Q1 text extraction and Max contradiction | A small de-identified text fixture based on the PDF's choice markers yields A,D,G; a deliberately wrong Max draft is filtered from the final stored message and from streamed text. |
| Visual answer | Two independent reads must agree before the PDF choice is marked verified. |
| Partial, missing, or ambiguous answer | Missing evidence is not marked verified; a partial PDF does not block the worked answer for another part. |
| Wrong tutorial link | Source-role tests check that a solutions file links to the intended tutorial. |
| Wrong PDF key with a formal check | The formal solver's option list decides both the grade and Max's feedback; the conflict is stated. |
| Non-choice answer | A PDF quote must support the answer, not merely repeat the question. |

Run `npm test` for the full app suite. After changing `app/src/main/` or `app/src/room/`, **stop and start `npm run dev` again** before manual testing: the Electron main process does not hot reload. If Vite reports port 5273 in use, inspect the existing listener with `lsof -nP -iTCP:5273 -sTCP:LISTEN` and stop that old dev process before restarting.

## Manual acceptance on a real notebook

Use a copy of the notebook and record the question ID, independent gold answer, PDF page, stored key and `from`/`solutionEvidence`, Check status, and final Max message. Keep these local if they contain course material or personal data. Check at least:

1. Q1 with A,D,G and with A,D,E,F,G; verify both the status and every option claim in the stored Max reply.
2. A question with no solutions PDF, including one correct and one incorrect response.
3. A PDF key visible as text, one visible only in the page image, and a partial or unreadable PDF.
4. A deliberately wrong answer key: use a formal question with an independently known result, and confirm the code result wins. For a non-formal question, treat any conflict as a review failure rather than trusting either answer automatically.
5. A solution file linked to the wrong tutorial; check that it cannot silently become the verified key for this sheet.

## Limit of the guarantee

The tests prove the wired behavior for their fixtures, including the original Q1 contradiction and a wrong PDF key on a formal problem. They cannot prove Max's answers correct for every new question. A readable official PDF can itself be wrong, and two model readings can agree on the same mistake. For a non-formal question without an independent gold answer or executable checker, there is no reliable way to know which conflicting answer is true. That case remains open in #69: the app should surface the conflict and seek review before making a definitive claim. A larger evaluation should use a de-identified, human-checked question set with expected answers and explanations, and score **grade, option claims, explanation, and uncertainty separately** on every build and model change.
