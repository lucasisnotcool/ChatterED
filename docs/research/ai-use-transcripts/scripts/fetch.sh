#!/bin/zsh
# Re-download the shared chats listed in raw/survey/form-responses-1.csv into raw/.
# Run from docs/research/ai-use-transcripts/. URLs are read from the CSV (column 2) so
# they never appear in committed files.
#
#   ChatGPT  share page is server-rendered: plain curl works; process.py decodes it.
#   Claude   share page sits behind a Cloudflare JS check: headless Chrome --dump-dom works.
#   Perplexity  blocks headless Chrome; use scripts/fetch_perplexity.cjs (headed Chrome,
#            sanitises the thread API JSON in memory) and obtain the thread's
#            "Export → Markdown" as raw/rN-perplexity/export.md.
set -eu
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
urls=("${(@f)$(python3 -c 'import csv;[print(r[1]) for r in list(csv.reader(open("raw/survey/form-responses-1.csv")))[1:]]')}")

# Row i of the CSV becomes R<i>; its folder is raw/r<i>-<tool>/.
i=0
for u in $urls; do
  i=$((i+1))
  case $u in
    *chatgpt.com/share/*) mkdir -p raw/r$i-chatgpt
                          curl -sL -A "$UA" -o raw/r$i-chatgpt/share.html "$u" && echo "R$i chatgpt ok" ;;
    *claude.ai/share/*)   mkdir -p raw/r$i-claude
                          "$CHROME" --headless=new --disable-gpu --user-data-dir="$(mktemp -d)" \
                            --virtual-time-budget=20000 --user-agent="$UA" --dump-dom "$u" \
                            > raw/r$i-claude/share.dom.html 2>/dev/null && echo "R$i claude ok" ;;
    *perplexity.ai/*)     echo "R$i perplexity: run node scripts/fetch_perplexity.cjs" ;;
  esac
done
