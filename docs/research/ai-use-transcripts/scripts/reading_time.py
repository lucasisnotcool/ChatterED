"""processed/ -> analysis/reading-time.json: dwell on AI answers, reading-time demand, sessions.

    python3 scripts/reading_time.py            (run from docs/research/ai-use-transcripts/)
    python3 scripts/reading_time.py --report   (also print the markdown tables)

Output is numbers and turn ids only, so it is safe to commit.

THREE MEASURES
1. Dwell on an AI answer. t(next learner turn) - t(AI turn). It is an UPPER BOUND on
   reading time: it also contains the answer's own streaming time, the learner's
   thinking, and the typing of the next prompt. Every platform here stamps the AI turn
   at generation *start* (ChatGPT: 0.3-2.2 s after the learner's message; Perplexity:
   the query time itself), so the gap is really the inter-query interval. Any overhead
   left inside it makes the bound looser, which only strengthens a "could not have read
   it all" conclusion.
2. Reading-time demand. words / 238 wpm (Brysbaert 2019, mean silent reading rate for
   English non-fiction). Reported over prose words -- words inside fenced code blocks
   are excluded, because code is not read at prose rates. That lowers the demand, so it
   is the conservative direction for the same conclusion.
3. Uninterrupted session. A maximal run of turns with no dwell longer than GAP_MIN.
   Duration is last turn - first turn, so the reading of a session's final answer is
   not counted (a known downward bias, quantified as `tail_unobserved_min`).

Excluded: R1 (the Claude share carries no timestamps at all).
"""
import argparse
import datetime as dt
import json
import re
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P, OUT = ROOT / "processed", ROOT / "analysis" / "reading-time.json"

READ_WPM = 238.0   # Brysbaert (2019), silent reading, English non-fiction
TYPE_WPM = 51.6    # Dhakal et al. (CHI 2018), mean over 168k typists
GAP_SET = (15.0, 20.0, 30.0)   # away-threshold sensitivity, minutes
GAP_MIN = 20.0                 # headline: the empirical break in this corpus
FENCE = re.compile(r"```.*?(?:```|$)", re.S)


def ts(t):
    return dt.datetime.fromisoformat(t["time"]) if t.get("time") else None


def prose_words(text):
    """Words outside fenced code blocks."""
    return len(FENCE.sub(" ", text).split())


def demand_min(t):
    return prose_words(t["text"]) / READ_WPM


def load():
    out = {}
    for p in sorted(P.glob("R*.json")):
        d = json.loads(p.read_text())
        if all(ts(t) for t in d["turns"]):
            out[p.stem] = d
    return out


def dwells(T):
    """[(index of AI turn, dwell minutes)] for every AI turn with a learner turn after it."""
    return [(i, (ts(T[i + 1]) - ts(T[i])).total_seconds() / 60)
            for i in range(len(T) - 1) if T[i]["role"] == "ai" and T[i + 1]["role"] == "learner"]


def per_turn(T):
    rows = []
    for i, gap in dwells(T):
        a, nxt = T[i], T[i + 1]
        pw = prose_words(a["text"])
        need = pw / READ_WPM
        typing = nxt["words"] / TYPE_WPM
        rows.append({
            "ai_turn": a["id"], "next_learner_turn": nxt["id"],
            "ai_words": a["words"], "ai_prose_words": pw,
            "dwell_min": round(gap, 2),
            "demand_min": round(need, 2),
            "dwell_less_typing_min": round(max(gap - typing, 0.0), 2),
            "demand_all_words_min": round(a["words"] / READ_WPM, 2),
            "read_ratio": round(gap / need, 2) if need else None,
            "wpm_needed": round(pw / gap) if gap > 0 else None,
        })
    return rows


def sessions(T, gap_min):
    """Split the turn list wherever a dwell exceeds gap_min. Returns list of (start, end) idx."""
    cuts = {i + 1 for i, g in dwells(T) if g > gap_min}
    runs, start = [], 0
    for i in range(1, len(T)):
        if i in cuts:
            runs.append((start, i - 1)); start = i
    runs.append((start, len(T) - 1))
    return runs


def session_rows(T, gap_min):
    rows = []
    for s, e in sessions(T, gap_min):
        span = (ts(T[e]) - ts(T[s])).total_seconds() / 60
        tail = demand_min(T[e]) if T[e]["role"] == "ai" else 0.0
        rows.append({
            "first_turn": T[s]["id"], "last_turn": T[e]["id"],
            "turns": e - s + 1,
            "exchanges": sum(1 for t in T[s:e + 1] if t["role"] == "learner"),
            "duration_min": round(span, 2),
            "tail_unobserved_min": round(tail, 2),
            "duration_corrected_min": round(span + tail, 2),
            "ai_words": sum(t["words"] for t in T[s:e + 1] if t["role"] == "ai"),
        })
    return rows


def summarise(vals, nd=2):
    vals = list(vals)
    if not vals:
        return None
    return {"n": len(vals), "mean": round(st.mean(vals), nd), "median": round(st.median(vals), nd),
            "min": round(min(vals), nd), "max": round(max(vals), nd),
            "sd": round(st.stdev(vals), nd) if len(vals) > 1 else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    data = load()

    res = {"method": {
        "read_wpm": READ_WPM, "read_wpm_source": "Brysbaert (2019) J. Mem. Lang. 109:104047",
        "type_wpm": TYPE_WPM, "type_wpm_source": "Dhakal et al. (CHI 2018)",
        "headline_gap_min": GAP_MIN, "gap_sensitivity_min": list(GAP_SET),
        "dwell": "t(next learner turn) - t(AI turn); upper bound on reading time",
        "demand": "AI prose words (fenced code excluded) / read_wpm",
        "excluded_sessions": ["R1 (no timestamps in the Claude share)"],
        "ai_timestamp_is_generation_start": True,
    }, "per_session": {}, "away_gaps": [], "corpus": {}}

    all_rows, sess_med_dwell, sess_med_ratio, sess_durations = [], [], [], []
    for rid, d in data.items():
        T = d["turns"]
        rows = per_turn(T)
        kept = [r for r in rows if r["dwell_min"] <= GAP_MIN]
        away = [r for r in rows if r["dwell_min"] > GAP_MIN]
        res["away_gaps"] += [{"session": rid, **{k: r[k] for k in ("ai_turn", "dwell_min", "ai_words")}}
                             for r in away]
        A = [t for t in T if t["role"] == "ai"]
        entry = {
            "tool": d["tool"],
            "total_dwell_min": round(sum(r["dwell_min"] for r in kept), 1),
            "total_demand_min": round(sum(demand_min(t) for t in A), 1),
            "total_demand_all_words_min": round(sum(t["words"] for t in A) / READ_WPM, 1),
            "timestamps": d.get("timestamps"),
            "ai_turns_with_a_following_learner_turn": len(rows),
            "away_gaps_excluded": len(away),
            "dwell_min": summarise(r["dwell_min"] for r in kept),
            "dwell_less_typing_min": summarise(r["dwell_less_typing_min"] for r in kept),
            "demand_min": summarise(r["demand_min"] for r in kept),
            "read_ratio": summarise((r["read_ratio"] for r in kept if r["read_ratio"] is not None)),
            "turns_dwell_below_demand": [r["ai_turn"] for r in kept if r["read_ratio"] and r["read_ratio"] < 1],
            "turns": rows,
            "sessions": {},
        }
        for g in GAP_SET:
            sr = session_rows(T, g)
            entry["sessions"][f"gap_{g:g}min"] = {
                "count": len(sr),
                "singletons": sum(1 for s in sr if s["exchanges"] <= 1),
                "duration_min": summarise(s["duration_min"] for s in sr),
                "duration_corrected_min": summarise(s["duration_corrected_min"] for s in sr),
                "rows": sr,
            }
        res["per_session"][rid] = entry
        all_rows += kept
        if entry["dwell_min"]:
            sess_med_dwell.append(entry["dwell_min"]["median"])
        if entry["read_ratio"]:
            sess_med_ratio.append(entry["read_ratio"]["median"])

    # corpus level: pooled (turn-weighted) and session-weighted
    res["corpus"]["pooled_turns"] = {
        "dwell_min": summarise(r["dwell_min"] for r in all_rows),
        "dwell_less_typing_min": summarise(r["dwell_less_typing_min"] for r in all_rows),
        "demand_min": summarise(r["demand_min"] for r in all_rows),
        "read_ratio": summarise(r["read_ratio"] for r in all_rows if r["read_ratio"] is not None),
        "share_dwell_below_demand": round(
            sum(1 for r in all_rows if r["read_ratio"] and r["read_ratio"] < 1) / len(all_rows), 3),
    }
    res["corpus"]["session_weighted"] = {
        "median_dwell_min": summarise(sess_med_dwell),
        "median_read_ratio": summarise(sess_med_ratio),
    }
    for g in GAP_SET:
        rows = [s for rid in data for s in session_rows(data[rid]["turns"], g)]
        multi = [s for s in rows if s["exchanges"] > 1]
        res["corpus"][f"sessions_gap_{g:g}min"] = {
            "count": len(rows), "singletons": len(rows) - len(multi),
            "duration_min_all": summarise(s["duration_min"] for s in rows),
            "duration_min_excluding_singletons": summarise(s["duration_min"] for s in multi),
            "duration_corrected_min_all": summarise(s["duration_corrected_min"] for s in rows),
            "duration_corrected_min_excluding_singletons": summarise(s["duration_corrected_min"] for s in multi),
            "exchanges": summarise((s["exchanges"] for s in rows), 1),
        }
    OUT.write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(f"wrote {OUT.relative_to(ROOT)}")
    c = res["corpus"]
    print("pooled dwell:", c["pooled_turns"]["dwell_min"])
    print("pooled demand:", c["pooled_turns"]["demand_min"])
    print("pooled ratio:", c["pooled_turns"]["read_ratio"],
          "share<1 =", c["pooled_turns"]["share_dwell_below_demand"])
    for g in GAP_SET:
        print(f"sessions@{g:g}min:", c[f"sessions_gap_{g:g}min"])


if __name__ == "__main__":
    main()
