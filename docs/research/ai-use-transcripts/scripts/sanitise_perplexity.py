"""Reduce a captured Perplexity /rest/thread JSON to an allowlist of fields.

The raw API response carries the author's account fields and pre-signed S3 URLs with
temporary AWS tokens. Neither may be stored. This keeps only what the analysis needs:
per-turn timestamps, the model used, the prompt, and attachment/source *file names*.

    python3 sanitise_perplexity.py <thread.json> <out thread-meta.json>
"""
import json
import sys
from urllib.parse import urlparse


def filename(url_or_name):
    return urlparse(url_or_name or "").path.rsplit("/", 1)[-1] or url_or_name


def main(src, dst):
    d = json.load(open(src))
    turns = []
    for e in d.get("entries", []):
        sources = []
        for b in e.get("blocks", []):
            for w in (b.get("web_result_block") or {}).get("web_results") or []:
                sources.append(w.get("name") or filename(w.get("url")))
        turns.append({
            "created": e.get("entry_created_datetime"),
            "model": e.get("display_model"),
            "user_selected_model": e.get("user_selected_model"),
            "mode": e.get("mode"),
            "prompt": e.get("query_str"),
            "attachments": [filename(a) for a in e.get("attachments") or []],
            "sources": sources,
        })
    json.dump({"turns": turns}, open(dst, "w"), indent=1, ensure_ascii=False)
    print(f"{dst}: {len(turns)} turns")


if __name__ == "__main__":
    main(*sys.argv[1:3])
