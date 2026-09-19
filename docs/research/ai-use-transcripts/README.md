# AI-use transcripts: dataset and CUI study

This folder holds the shared AI study chats collected by the form *"CS3249: AI for Student
Learning and Revision"*, and a coded conversation analysis of them. It serves Assignment 1,
Step 1 (what remains difficult after AI assistance), and it prefers **observed behaviour
over self-report**.

**Start with [`analysis/findings.md`](analysis/findings.md).**

## Status (2026-09-19)

- 6 form responses, R1–R6. All 6 transcripts have been retrieved and processed:
  76 learner turns and 76 AI turns.
- All 152 turns were coded by two independent coders against `analysis/codebook.md`
  (v1.3). Agreement is in `analysis/agreement.json`. Reconciled codes are in
  `analysis/coding-final.jsonl`.
- R6 (SQL practice): the AI's disputed claims were executed against PostgreSQL. Results
  are in `analysis/r6-sql-checks.json`.
- Every transcript is analysed as an **independent session**. Nothing in this folder
  records or infers who owns an account.

## Layout

```
ai-use-transcripts/
├── README.md                 this file (committed)
├── analysis/                 committed: derived, no raw transcript text
│   ├── findings.md           the write-up: method, results, implications
│   ├── codebook.md           coding scheme with frameworks and decision rules
│   ├── coding-final.jsonl    reconciled per-turn codes (short notes, no transcripts)
│   ├── agreement.json        percent agreement + Cohen's kappa per dimension
│   ├── metrics.json          computed measures: volume, pacing, uptake, reuse, format
│   └── r6-sql-checks.json    R6 AI claims executed on PostgreSQL 17 (turn ids + verdicts)
├── scripts/                  committed
│   ├── fetch.sh              re-download ChatGPT (curl) and Claude (headless Chrome)
│   ├── fetch_perplexity.cjs  Perplexity metadata via headed Chrome, sanitised in memory
│   ├── sanitise_perplexity.py  reduce a captured thread JSON to the field allowlist
│   ├── process.py            raw/ -> processed/ (turn-level JSON + readable .md)
│   ├── metrics.py            processed/ -> analysis/metrics.json
│   ├── agreement.py          two coding sheets -> analysis/agreement.json
│   └── verify_r6_sql.py      run R6's disputed SQL on a scratch Postgres
├── raw/                      GITIGNORED: sources exactly as obtained
│   ├── survey/form-responses-1.csv     form export (has a Telegram column; all empty)
│   ├── r1-claude/share.dom.html        Claude share, rendered DOM (page chrome stripped by process.py)
│   ├── r2-chatgpt/share.html           ChatGPT share page (turbo-stream payload inside)
│   ├── r3-perplexity/export.md         Perplexity "Export → Markdown" of the shared thread
│   ├── r3-perplexity/thread-meta.json  sanitised per-turn metadata
│   ├── r4-perplexity/…                 same as r3
│   └── r5-chatgpt/, r6-chatgpt/        same as r2 (folder = CSV row + tool)
└── processed/                GITIGNORED: full transcript text
    ├── R1..R6.json / .md     turn-level transcripts, turns numbered L1/A1, L2/A2 …
    ├── survey.json           form rows keyed R1..R6, Telegram column dropped
    └── coding/               coder-A*.jsonl, coder-B*.jsonl (+ -all merges), coder-B notes
```

**Why `raw/` and `processed/` are gitignored:** CLAUDE.md forbids committing raw
transcripts or participant PII. The rule is in `/.gitignore`. These folders exist only
on this machine. If they are lost, rebuild them as below.

**What must never be stored anywhere:**
- the raw Perplexity `/rest/thread` JSON (it holds account fields and pre-signed S3 URLs
  with temporary AWS tokens);
- participant names, handles or IDs;
- the share URLs in any committed file (they live only in the raw CSV).

## Rebuild

From this folder:

```sh
zsh scripts/fetch.sh                         # Claude + ChatGPT rows -> raw/r<row>-<tool>/ (URLs from the CSV)
node scripts/fetch_perplexity.cjs            # R3/R4 metadata; needs playwright-core, opens Chrome
# plus: raw/r{3,4}-perplexity/export.md from Perplexity's "Export → Markdown" (supplied separately)
python3 scripts/process.py                   # -> processed/
python3 scripts/metrics.py                   # -> analysis/metrics.json
python3 scripts/agreement.py processed/coding/coder-A-all.jsonl processed/coding/coder-B-all.jsonl

# R6 execution checks: a throwaway Postgres (EDB PostgreSQL 17 is at /Library/PostgreSQL/17)
PG=/Library/PostgreSQL/17/bin; D=$TMPDIR/r6pg
$PG/initdb -D $D -U tester -A trust
$PG/pg_ctl -D $D -o "-p 55432 -c listen_addresses=localhost -c unix_socket_directories=''" -w start
PGPORT=55432 python3 scripts/verify_r6_sql.py  # -> analysis/r6-sql-checks.json
$PG/pg_ctl -D $D stop
```

(The Unix socket is disabled because paths over 103 bytes are rejected.)

Retrieval notes:
- ChatGPT: the share HTML embeds the whole conversation as React Router turbo-stream.
  `process.py` decodes it and gets per-message timestamps and the model slug.
  - Slide images and attached files are **not** included in shares.
  - Attachment-only learner messages are kept as `[attached files: …]` turns.
  - Multi-message AI replies are merged into one turn.
- Claude: the Cloudflare JS check passes in headless Chrome. There are no timestamps
  ("2 days ago") and markdown is lost in the rendered DOM. The inline quiz artifact is
  replaced by a placeholder.
- Perplexity: 403 without a real browser. The Markdown export has the text but no
  times or models. `thread-meta.json` supplies per-turn query time, model, attachment
  names and source file names. Generated files (docx/png) are not retrievable.

## Adding respondents

1. Replace `raw/survey/form-responses-1.csv` with the new export. Earlier rows must be
   unchanged: the R-codes follow CSV row order. Run `fetch.sh`, then add the new row's
   folder to `main()` in `process.py`.
2. Code the new turns into **both** coding sheets independently, rerun `agreement.py`,
   reconcile, and append to `analysis/coding-final.jsonl`.
3. Treat every transcript as an independent session. Never record, infer or mention
   who owns an account or a transcript. Platform metadata (share headers, usernames,
   author fields) is stripped in processing and must not appear in any output.
