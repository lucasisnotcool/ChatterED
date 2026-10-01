# CLAUDE.md

Everything shared is in AGENTS.md, which every tool reads; this file imports it and adds only what
is specific to Claude Code. Personal rules go in `CLAUDE.local.md` and `.claude/settings.local.json`
(both gitignored).

@AGENTS.md

## Claude Code specifics

- **Start every session** with `gh issue list --state open` (AGENTS.md, "Working together"), and
  read the issues assigned to your human before planning.
- **Hooks** (`.claude/settings.json`, committed team policy): at session start, `core.hooksPath`
  is set to `.githooks`; before every Write or Edit, `.claude/hooks/guard-a2-private.sh` refuses
  private A2 material and raw research data. If it refuses, move the content. Do not edit the
  hook or the settings to get around it. Hooks added mid-session go live only after `/hooks` or a
  restart.
- Foreground `sleep N && cmd` is blocked. Poll with a background until-loop.
- Load the `claude-api` skill before writing API code. Do not answer model or pricing questions
  from memory.
