"""processed/ -> analysis/metrics.json: behavioural measures that need no human coding.

    python3 scripts/metrics.py          (run from docs/research/ai-use-transcripts/)

Output is numbers and turn ids only (no transcript text), so it is safe to commit.

Measures
- volume: learner vs AI words, the ratio, and share of learner words that are typed
  (not pasted material or a repeated template)
- pacing: minutes from an AI answer to the next learner turn, and the reading rate
  (AI words / minute) that reading the whole answer in that gap would require. R2 has
  message times. R4 has query times only, so its gap also includes generation time and
  the rate is a lower bound on what full reading would need.
- lexical uptake: share of a learner turn's content words that occur in the previous
  AI turn (a computable proxy for building on the partner's turn)
- prompt reuse: similarity of each learner prompt to the previous one (template reuse)
- formatting density of AI turns: headings, bold spans and emoji per 100 words
- model switching (R4): model per turn
"""
import datetime as dt
import difflib
import json
import re
import statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P, OUT = ROOT / "processed", ROOT / "analysis" / "metrics.json"

STOP = set("""a an the of to in on for and or but is are was were be been it its this that these those
what which who why how does do did can could would should will i you me my your we our please with by
from as at into about than then so if not no yes also just like only very more most all any each some
there here their they them he she his her explain mean means give example""".split())
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐✅]")
READ_WPM = 238  # Brysbaert (2019): mean silent reading rate, English non-fiction


def content_words(s):
    """Content words, crudely stemmed to a 6-letter prefix (marginalise ~ marginalised)."""
    return {w[:6] for w in re.findall(r"[a-z][a-z\-]+", s.lower()) if w not in STOP and len(w) > 2}


def ts(t):
    return dt.datetime.fromisoformat(t["time"]) if t.get("time") else None


def typed_words(rid, t, prev_learner):
    """Learner words that are the learner's own typing, not pasted/templated."""
    text = t["text"]
    if rid == "R1" and text.startswith("Explain:"):
        return 1  # the rest is a pasted quiz item
    text = re.sub(r"CREATE TABLE.*?\);", "", text, flags=re.S | re.I)  # pasted schema
    text = re.sub(r"\[attached files:[^\]]*\]", "", text)
    if text.startswith("You said:"):  # quoted AI text, then the learner's reply
        text = text.rsplit("\n\n", 1)[-1]
    if text != t["text"]:
        return len(text.split())
    if prev_learner and difflib.SequenceMatcher(None, prev_learner["text"], text).ratio() > 0.8:
        a, b = prev_learner["text"].split(), text.split()
        sm = difflib.SequenceMatcher(None, a, b)
        return sum(j2 - j1 for op, i1, i2, j1, j2 in sm.get_opcodes() if op in ("replace", "insert"))
    return t["words"]


def session(rid):
    d = json.loads((P / f"{rid}.json").read_text())
    T = d["turns"]
    L = [t for t in T if t["role"] == "learner"]
    A = [t for t in T if t["role"] == "ai"]
    out = {"tool": d["tool"], "model": d["model"], "learner_turns": len(L), "ai_turns": len(A)}
    lw, aw = sum(t["words"] for t in L), sum(t["words"] for t in A)
    typed = [typed_words(rid, t, L[i - 1] if i else None) for i, t in enumerate(L)]
    out |= {"learner_words": lw, "learner_words_typed": sum(typed), "ai_words": aw,
            "ai_to_learner_ratio": round(aw / max(lw, 1), 1),
            "ai_to_typed_ratio": round(aw / max(sum(typed), 1), 1),
            "image_turns": sum(1 for t in L if t.get("images")),
            "image_only_turns": [t["id"] for t in L if t.get("images") and t["words"] == 0]}
    if all(ts(t) for t in T):
        out["duration_min"] = round((ts(T[-1]) - ts(T[0])).total_seconds() / 60, 1)
    # pacing
    pace = []
    for i, t in enumerate(T):
        if t["role"] != "learner" or i == 0 or not ts(t):
            continue
        prev_ai = T[i - 1]
        # R4 has query times only: the previous answer "starts" at the previous query
        gap = (ts(t) - ts(prev_ai)).total_seconds() / 60
        if gap <= 0:
            continue
        pace.append({"turn": t["id"], "prev_ai": prev_ai["id"], "prev_ai_words": prev_ai["words"],
                     "gap_min": round(gap, 1), "wpm_needed": round(prev_ai["words"] / gap),
                     "gap_includes_generation": rid.startswith("R4") or rid.startswith("R3")})
    if pace:
        out["pacing"] = pace
        full = [p for p in pace if p["gap_min"] < 60]
        out["pacing_summary"] = {
            "median_gap_min": st.median(p["gap_min"] for p in full),
            "turns_where_full_read_exceeds_238wpm": [p["turn"] for p in full if p["wpm_needed"] > READ_WPM]}
    # lexical uptake
    up = []
    for i, t in enumerate(T):
        if t["role"] == "learner" and i > 0 and t["words"]:
            cw = content_words(t["text"])
            if cw:
                up.append({"turn": t["id"], "share_in_prev_ai": round(len(cw & content_words(T[i - 1]["text"])) / len(cw), 2)})
    out["lexical_uptake"] = up
    # prompt reuse
    out["prompt_reuse"] = [{"turn": L[i]["id"], "similarity_to_prev_prompt":
                            round(difflib.SequenceMatcher(None, L[i - 1]["text"], L[i]["text"]).ratio(), 2)}
                           for i in range(1, len(L)) if L[i]["words"] and L[i - 1]["words"]]
    # AI formatting density
    fmt = []
    for t in (A if rid != "R1" else []):  # R1 is rendered text: markdown is not recoverable
        w = max(t["words"], 1)
        fmt.append({"turn": t["id"], "words": t["words"],
                    "headings_per100": round(100 * len(re.findall(r"^#+ ", t["text"], re.M)) / w, 1),
                    "bold_per100": round(100 * (len(re.findall(r"\*\*", t["text"])) // 2) / w, 1),
                    "emoji": len(EMOJI.findall(t["text"]))})
    out["ai_format"] = fmt or "not measurable (rendered share, markdown lost)"
    models = [t.get("model") for t in L if t.get("model")]
    if models:
        out["model_by_turn"] = models
        out["model_switches"] = sum(1 for a, b in zip(models, models[1:]) if a != b)
    return out


def main():
    res = {rid: session(rid) for rid in sorted(p.stem for p in P.glob("R*.json"))}
    OUT.write_text(json.dumps(res, indent=1, ensure_ascii=False))
    for rid, s in res.items():
        print(rid, {k: s[k] for k in ("learner_turns", "learner_words", "learner_words_typed", "ai_words",
                                      "ai_to_typed_ratio") }, s.get("pacing_summary"), s.get("model_switches"))


if __name__ == "__main__":
    main()
