#!/usr/bin/env python3
"""Field-study measures from one ChatterED research export (docs/group/field-study.md).

Usage:  python3 -I tools/field-metrics.py <unzipped export folder> [--json]

Reads only the export; writes nothing. The output holds counts, sizes, part ids and times, and no
text a participant typed, so it can be pasted into the committed results. The export itself is raw
research data: keep it outside the repo and never commit it.

What it counts, and the traps (checked against the S04 export, 22 Nov 2026):
  - The study events are JSON lines in logs/main.log, selected by "event". Do not read "level":
    tutorial.help writes the hint rung into that field.
  - A help request is one tutorial.help line (Hint, Refresher, Show answer). A typed thread reply
    is tutorial.reply and a Check is tutorial.check: neither is a help request.
  - RQ1 Attempt = share of hint and refresher requests with attempt_present. Show answer is left
    out of that share, because the interface only offers it after a check.
  - RQ2 Recovery = for each part with a "not yet" check, what happened after the first one:
    repaired (a later check came back correct), revealed, or left.
"""
import csv
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

NOT_YET = {"not_yet", "partial", "incorrect"}


def log_lines(root):
    out = []
    for f in sorted((root / "logs").glob("*.log*")):
        for line in f.read_text(errors="replace").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return sorted(out, key=lambda e: e.get("ts", ""))


def minutes(a, b):
    from datetime import datetime
    p = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
    return round((p(b) - p(a)).total_seconds() / 60, 1)


def measure(root):
    man = json.loads((root / "manifest.json").read_text())
    ev = log_lines(root)
    by = defaultdict(list)
    for e in ev:
        by[e.get("event")].append(e)

    helps = [dict(ts=e["ts"], part=e["part_id"], kind=e["kind"], rung=e.get("level") if e["kind"] == "hint" else None,
                  attempt=bool(e["attempt_present"]), chars=e["attempt_chars"], picked=e.get("attempt_picked", 0),
                  links=e.get("linked_notes", 0) + e.get("linked_pages", 0)) for e in by["tutorial.help"]]
    checks = [dict(ts=e["ts"], part=e["part_id"], verdict=e["verdict"], by=e["checked_by"], n=e["attempts"],
                   chars=e["attempt_chars"], key_confidence=e.get("key_confidence"), key_from=e.get("key_from"))
              for e in by["tutorial.check"]]
    replies = [dict(ts=e["ts"], part=e["part_id"], chars=e["chars"]) for e in by["tutorial.reply"]]
    started = {e["part_id"]: e["ts"] for e in reversed(by["tutorial.text_started"])}

    # Per part: what came first, and where a "not yet" ended.
    parts = defaultdict(lambda: dict(first=None, max_rung=0, checks=0, verdicts=[],
                                     refreshers=0, revealed=False, replies=0, after_not_yet=None))
    timeline = sorted([(h["ts"], "help", h) for h in helps] + [(c["ts"], "check", c) for c in checks] +
                      [(r["ts"], "reply", r) for r in replies] + [(t, "text", dict(part=p)) for p, t in started.items()])
    for ts, what, x in timeline:
        p = parts[x["part"]]
        label = what if what != "help" else x["kind"]
        p["first"] = p["first"] or label
        if what == "help":
            if x["kind"] == "hint":
                p["max_rung"] = max(p["max_rung"], x["rung"] or 0)
            if x["kind"] == "refresher":
                p["refreshers"] += 1
            if x["kind"] == "reveal":
                p["revealed"] = True
        if what == "check":
            p["checks"] += 1
            p["verdicts"].append(x["verdict"])
        if what == "reply":
            p["replies"] += 1
    for p in parts.values():
        v = p["verdicts"]
        first_bad = next((i for i, x in enumerate(v) if x in NOT_YET), None)
        if first_bad is not None:
            p["after_not_yet"] = ("repaired" if "correct" in v[first_bad + 1:] else
                                  "revealed" if p["revealed"] else "left")

    # Final status and slot size per part, from the database snapshot.
    status = {}
    db = root / "database" / "chattered.db"
    if db.exists():
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        for part_id, st, hint, attempts, revealed_at in con.execute(
                "select part_id, status, hint_level, attempts, revealed_at from tutorial_parts"):
            status[part_id] = dict(status=st, hint_level=hint, attempts=attempts, revealed=bool(revealed_at))
        con.close()

    # AI replies: length only.
    words = defaultdict(list)
    learner_turns = 0
    for f in (root / "readable" / "transcripts").glob("*.json"):
        t = json.loads(f.read_text())
        for th in t.get("threads", []):
            for m in th.get("turns", []):
                if m.get("authorKind") == "agent":
                    words[m.get("author")].append(len(m["text"].split()))
        for th in t.get("privateThreads", []):
            for m in th.get("turns", []):
                if m.get("sender") == "agent":
                    words["private:" + str(th.get("agentKey"))].append(len(m["text"].split()))
                else:
                    learner_turns += 1
    all_words = [w for ws in words.values() for w in ws]

    cost = 0.0
    usage = root / "readable" / "usage.csv"
    if usage.exists():
        cost = sum(float(r["estimated_cost_usd"] or 0) for r in csv.DictReader(usage.open()))

    asks = [h for h in helps if h["kind"] in ("hint", "refresher")]
    first_ts = ev[0]["ts"] if ev else None
    return {
        "participant": man["participantId"], "slot": man.get("study", {}).get("slot"),
        "app_version": man["app"]["version"], "models": man["backend"]["models"],
        "first_log_line": first_ts, "consented": man["consent"]["consentedAt"], "exported": man["exportedAt"],
        "span_minutes_first_line_to_export": minutes(first_ts, man["exportedAt"]) if first_ts else None,
        "active_minutes": sum(e.get("minutes", 0) for e in by["app.active"]),
        "app_starts": len(by["app.start"]),
        "spend_usd": round(cost, 2),
        "sheets": [dict(parts=e["parts"], low_confidence_keys=e["low_confidence"], disagreed=e["disagreed"],
                        formal=e["formal"], linked_notes=e["linked_notes"]) for e in by["tutorial.ingest"]],
        "solution_reads": len(by["tutorial.solutions"]),
        "help_requests": helps,
        "rq1_asks": len(asks), "rq1_asks_with_attempt": sum(h["attempt"] for h in asks),
        "checks": checks, "thread_replies": replies, "private_chat_learner_turns": learner_turns,
        "reveals": sum(h["kind"] == "reveal" for h in helps),
        "parts_touched": {k: {**v, **status.get(k, {})} for k, v in sorted(parts.items())},
        "parts_total": len(status), "parts_untouched": len(status) - len(parts),
        "link_opens": len(by["tutorial.link_open"]),
        "source_pdf_opens": sum(1 for e in by["tutorial.source_pdf"] if e.get("open")),
        "ai_replies": len(all_words), "ai_reply_words_max": max(all_words, default=0),
        "ai_replies_over_400_words": sum(w > 400 for w in all_words),
        "ai_reply_words_by_author": {k: v for k, v in words.items()},
        "over_length_warnings": len(by["turn.over_length"]),
        "errors": sorted({e.get("event") for e in ev if e.get("level") == "error"}),
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    m = measure(Path(args[0]).expanduser())
    if "--json" in sys.argv:
        print(json.dumps(m, indent=2))
        return
    for k, v in m.items():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            print(f"{k}:")
            for row in v:
                print("   ", row)
        elif isinstance(v, dict) and k == "parts_touched":
            print(f"{k}:")
            for part, row in v.items():
                print("   ", part, row)
        else:
            print(f"{k}: {v}")


if __name__ == "__main__":
    main()
