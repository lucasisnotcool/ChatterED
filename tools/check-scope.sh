#!/bin/sh
# Refuses what must never enter this repo (AGENTS.md, "What is shared and what is private"):
# each person's private A2 material, and raw research data. Plain shell and git, so it works with
# any editor or coding agent. CI runs it on every push and PR; .githooks/pre-commit runs it on what
# is staged.
#
#   tools/check-scope.sh           check every tracked file (what CI does)
#   tools/check-scope.sh --staged  check only the staged files (the pre-commit hook)
#
# Three checks:
#   1. a reserved path: a2/, a2-private/ or docs/a2/ anywhere in the tree
#   2. raw research data: interview records and AI-use transcripts, Lucas's and Valerie's, which
#      stay local even when someone forces them past .gitignore
#   3. a line that is only the A2 marker (A2-PRIVATE, optionally inside a comment). Each of us
#      opens every text file of our own private A2 material with that line, so a stray copy is
#      caught here.
# Binary files are skipped by the content check. This is a tripwire, not a scanner: it cannot see
# private text pasted somewhere without the marker. The rule in AGENTS.md is the policy.

marker='^[[:space:]]*(<!--|#|//|%|;)?[[:space:]]*A2-PRIVATE[[:space:]]*(-->)?[[:space:]]*$'

if [ "${1:-}" = "--staged" ]; then
  list() { git -c core.quotepath=off diff --cached --name-only --diff-filter=ACMR; }
  show() { git show ":$1" 2>/dev/null; }
else
  list() { git -c core.quotepath=off ls-files; }
  show() { cat "$1" 2>/dev/null; }
fi

bad=$(list | while IFS= read -r p; do
  case "/$p" in
    (*/a2/*|*/a2-private/*|/docs/a2/*) echo "  $p  (reserved path)"; continue ;;
    (/Academia/Interviews/*|"/Academia/valerie research/"*|/docs/research/ai-use-transcripts/raw/*|/docs/research/ai-use-transcripts/processed/*)
      echo "  $p  (raw research data stays local)"; continue ;;
  esac
  if show "$p" | grep -I -q -E "$marker"; then
    echo "  $p  (carries the A2-PRIVATE marker)"
  fi
done)

if [ -n "$bad" ]; then
  echo "check-scope: refused. Private A2 material and raw research data never enter this repo (AGENTS.md):
$bad" >&2
  echo "Unstage with: git restore --staged <path>" >&2
  exit 1
fi
echo "check-scope: ok"
