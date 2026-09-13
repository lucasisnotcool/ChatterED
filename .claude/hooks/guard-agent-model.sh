#!/bin/sh
# PreToolUse guard for the Agent tool: every subagent spawn must name an allowed model.
# Blocks omitted models (which would inherit the parent's model, e.g. Fable) and any Fable model.
input=$(cat)
model=$(printf '%s' "$input" | jq -r '.tool_input.model // ""')
case "$model" in
  opus|sonnet|haiku) exit 0 ;;
  "")
    reason="Agent call refused: model omitted. Nested spawns inherit the parent model (Fable). Pass model: \"opus\", \"sonnet\" or \"haiku\" explicitly. Project policy: subagents use at most Opus 5." ;;
  *)
    reason="Agent call refused: model \"$model\" is not allowed. Project policy: subagents use at most Opus 5 (opus|sonnet|haiku)." ;;
esac
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$(printf '%s' "$reason" | jq -Rs .)"
