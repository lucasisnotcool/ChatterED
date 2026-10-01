#!/bin/sh
# PreToolUse guard for Write/Edit/MultiEdit/NotebookEdit: private A2 material and raw research
# data never enter this repo (AGENTS.md, SCOPE.md). Refuses a write into $CLAUDE_PROJECT_DIR that
# carries the A2-PRIVATE marker line or targets a reserved path. tools/check-scope.sh is the same
# rule at commit time and in CI. Writes outside this repo are not its business.
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
case "$path" in
  "$root"/*) rel=${path#"$root"/} ;;
  *) exit 0 ;;
esac

reason=''
case "/$rel" in
  */a2/*|*/a2-private/*|/docs/a2/*) reason="$rel is a reserved path." ;;
  /Academia/Interviews/*|"/Academia/valerie research/"*|/docs/research/ai-use-transcripts/raw/*|/docs/research/ai-use-transcripts/processed/*)
    reason="$rel is raw research data, which stays local." ;;
esac
if [ -z "$reason" ]; then
  body=$(printf '%s' "$input" | jq -r '[.tool_input.content, .tool_input.new_string, .tool_input.new_source, (.tool_input.edits // [] | .[].new_string)] | map(select(. != null)) | join("\n")')
  if printf '%s\n' "$body" | grep -q -E '^[[:space:]]*(<!--|#|//|%|;)?[[:space:]]*A2-PRIVATE[[:space:]]*(-->)?[[:space:]]*$'; then
    reason="the content carries the A2-PRIVATE marker."
  fi
fi
[ -z "$reason" ] && exit 0
reason="Write refused: $reason Each person's private A2 material (working documents, framing, presentation, report drafts) lives in their own private repo (Lucas: ~/ChatterED-A2), and raw research data stays local (AGENTS.md). Write it there instead, or leave the private content out."
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$(printf '%s' "$reason" | jq -Rs .)"
