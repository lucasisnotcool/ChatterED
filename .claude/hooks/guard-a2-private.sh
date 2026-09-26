#!/bin/sh
# PreToolUse guard for Write/Edit/MultiEdit/NotebookEdit: Assignment 2 deliverables never enter
# this repo (SCOPE.md, "Guards"). Refuses a write into $CLAUDE_PROJECT_DIR that carries the
# zone-4 marker line or targets a reserved path. Writes outside this repo are not its business.
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
case "$path" in
  "$root"/*) rel=${path#"$root"/} ;;
  *) exit 0 ;;
esac

reason=''
case "$rel" in
  a2-private/*|docs/a2/*) reason="$rel is a reserved path." ;;
esac
if [ -z "$reason" ]; then
  body=$(printf '%s' "$input" | jq -r '[.tool_input.content, .tool_input.new_string, .tool_input.new_source, (.tool_input.edits // [] | .[].new_string)] | map(select(. != null)) | join("\n")')
  if printf '%s\n' "$body" | grep -q -E '^[[:space:]]*(<!--|#|//|%|;)?[[:space:]]*A2-PRIVATE[[:space:]]*(-->)?[[:space:]]*$'; then
    reason="the content carries the A2-PRIVATE marker."
  fi
fi
[ -z "$reason" ] && exit 0
reason="Write refused: $reason Assignment 2 deliverables live in ~/ChatterED-A2 and never enter this repo (SCOPE.md). Write it there instead, or leave the zone-4 content out."
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$(printf '%s' "$reason" | jq -Rs .)"
