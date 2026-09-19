"""raw/ -> processed/: one normalised, turn-level transcript per respondent.

    python3 scripts/process.py          (run from docs/research/ai-use-transcripts/)

Writes processed/<id>.json (list of turns) and processed/<id>.md (readable), plus
processed/survey.json (form rows keyed R1..Rn, Telegram column dropped). Turns are
numbered L1, A1, L2, A2 ... (L = learner, A = AI) so coding sheets can cite them.
Everything written here is gitignored: it is full transcript text.
"""
import csv
import datetime as dt
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "raw", ROOT / "processed"


def words(s):
    return len(s.split())


def turn(role, n, text, **meta):
    return {"id": f"{role}{n}", "role": "learner" if role == "L" else "ai",
            "text": text.strip(), "words": words(text), **meta}


# ---------- R1: Claude share page, rendered DOM ----------
def r1():
    h = (RAW / "r1-claude/share.dom.html").read_text()
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", h, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = re.sub(r"[-]", "", t)  # icon-font glyphs
    t = t.replace("Files hidden when shared", "[learner attached files; hidden in share]")
    lines = [l.strip() for l in t.split("\n") if l.strip()]
    lines = lines[next(i for i, l in enumerate(lines) if l.startswith("You said:")):]
    lines = [l for l in lines if l != "2 days ago" and l != "Ask Claude your own question"]
    turns, cur, role, n = [], [], None, 0

    def flush():
        if role is None:
            return
        body = cur[1:]  # first line repeats the UI's one-line preview
        if role == "A":
            body = strip_artifact(body)
            turns.append(turn("A", n, "\n".join(body)))
        else:
            turns.append(turn("L", n, "\n".join(body)))

    for l in lines:
        if l.startswith("You said:"):
            flush(); n += 1; role, cur = "L", [l]
        elif l.startswith("Claude responded:"):
            flush(); role, cur = "A", [l]
        else:
            cur.append(l)
    flush()
    return turns, {"tool": "Claude (claude.ai, personal notes vault via tools)",
                   "model": "not shown in share", "timestamps": "none (share shows '2 days ago')"}


def strip_artifact(body):
    """Replace the rendered quiz artifact (33 questions x options) with a placeholder."""
    if not any(l.startswith("Question 1 of") for l in body):
        return body
    start = next(i for i, l in enumerate(body) if l.startswith("Published artifact"))
    end = max(i for i, l in enumerate(body) if l == "Next")
    n_q = max(int(m.group(1)) for l in body if (m := re.match(r"Question \d+ of (\d+)", l)))
    return body[:start] + [f"[ARTIFACT: notes page + {n_q}-question MCQ quiz, rendered inline; omitted]"] + body[end + 1:]


# ---------- R2, R5, R6: ChatGPT share page, React Router turbo-stream ----------
def chatgpt(folder):
    h = (RAW / folder / "share.html").read_text()
    chunks = re.findall(r'streamController\.enqueue\((".*?")\);?\s*</script>', h, re.S)
    arr = json.loads("".join(json.loads(c) for c in chunks).split("\n")[0])
    memo = {}

    def val(i):
        if i < 0:
            return None
        if i in memo:
            return memo[i]
        v = arr[i]
        if isinstance(v, dict):
            o = memo[i] = {}
            for k, vi in v.items():
                o[arr[int(k[1:])]] = val(vi)
            return o
        if isinstance(v, list):
            l = memo[i] = []
            l.extend(val(x) if isinstance(x, int) else x for x in v)
            return l
        return v

    def find(o, key, d=0):
        if d > 12:
            return None
        if isinstance(o, dict):
            if key in o:
                return o[key]
            o = list(o.values())
        if isinstance(o, list):
            for v in o:
                r = find(v, key, d + 1)
                if r is not None:
                    return r

    root = val(0)
    mapping, cur = find(root, "mapping"), find(root, "current_node")
    path = []
    while cur:
        path.append(mapping[cur]); cur = mapping[cur].get("parent")
    turns, n, models = [], 0, set()
    for node in reversed(path):
        m = node.get("message")
        if not m or m["author"]["role"] not in ("user", "assistant"):
            continue
        parts = m["content"].get("parts") or []
        text = "\n".join(p for p in parts if isinstance(p, str))
        images = sum(1 for p in parts if isinstance(p, dict) and "image" in p.get("content_type", ""))
        files = [a.get("name") for a in (m.get("metadata") or {}).get("attachments") or []
                 if not str(a.get("mime_type", "")).startswith("image")
                 and not re.search(r"\.(png|jpe?g|gif|webp|heic)$", str(a.get("name")), re.I)]
        if files and m["author"]["role"] == "user":  # attachment-only turns are real turns
            text = (f"[attached files: {', '.join(files)}]\n" + text).strip()
        if not text.strip() and not images:
            continue
        ts = dt.datetime.fromtimestamp(m["create_time"], dt.timezone.utc).isoformat()
        if m["author"]["role"] == "user":
            n += 1
            turns.append(turn("L", n, text, time=ts, images=images))
        else:
            models.add((m.get("metadata") or {}).get("model_slug"))
            if turns and turns[-1]["id"] == f"A{n}":  # multi-message reply: one AI turn
                prev = turns.pop()
                text = prev["text"] + "\n\n" + text
                ts = prev["time"]
            turns.append(turn("A", n, text, time=ts))
    return turns, {"tool": "ChatGPT", "model": ", ".join(sorted(filter(None, models))),
                   "timestamps": "per message, UTC", "note": "slide images not exported by share"}


# ---------- R3/R4: Perplexity markdown export + sanitised thread metadata ----------
def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def perplexity(folder):
    md = (RAW / folder / "export.md").read_text().split("\n")
    meta = json.loads((RAW / folder / "thread-meta.json").read_text())["turns"]
    # locate each prompt's heading line
    starts, pos = [], 0
    for t in meta:
        first = norm(t["prompt"].split("\n")[0])[:40]
        pos = next(i for i in range(pos, len(md)) if md[i].startswith("# ") and norm(md[i][2:]).startswith(first))
        starts.append(pos); pos += 1
    turns = []
    for k, t in enumerate(meta):
        seg = md[starts[k]:(starts[k + 1] if k + 1 < len(starts) else len(md))]
        seg[0] = seg[0][2:]
        # consume lines belonging to the prompt
        target, i, acc = norm(t["prompt"]), 0, ""
        while i < len(seg) and len(norm(acc)) < len(target):
            acc += " " + seg[i]; i += 1
        answer = "\n".join(seg[i:])
        answer = answer.split('<div align="center">⁂</div>')[0].rstrip().rstrip("-").rstrip()
        n = k + 1
        turns.append(turn("L", n, t["prompt"], time=t["created"], model=t["model"],
                          attachments=t["attachments"]))
        turns.append(turn("A", n, answer, time=t["created"], model=t["model"], sources=t["sources"],
                          note="answer text as exported; generated files (docx/md/png) not included"))
    models = sorted({t["model"] for t in meta})
    return turns, {"tool": "Perplexity (Spaces, uploaded course files)", "model": ", ".join(models),
                   "timestamps": "per learner turn (query time), UTC"}


def survey():
    rows = list(csv.reader(open(RAW / "survey/form-responses-1.csv")))
    hdr = rows[0][:7]  # column 7 = Telegram handle: dropped
    return {f"R{i}": dict(zip(hdr, r[:7])) for i, r in enumerate(rows[1:], 1)}


def write_md(rid, turns, meta):
    out = [f"# {rid} — {meta['tool']}", "", "```", json.dumps(meta, indent=1), "```", ""]
    for t in turns:
        extra = " ".join(f"{k}={t[k]}" for k in ("time", "model", "images", "attachments") if t.get(k))
        out += [f"## {t['id']} · {t['role']} · {t['words']} words {extra}".rstrip(), "", t["text"], ""]
    (OUT / f"{rid}.md").write_text("\n".join(out))


def main():
    OUT.mkdir(exist_ok=True)
    sets = {"R1": r1(), "R2": chatgpt("r2-chatgpt"), "R3": perplexity("r3-perplexity"),
            "R4": perplexity("r4-perplexity"), "R5": chatgpt("r5-chatgpt"), "R6": chatgpt("r6-chatgpt")}
    for rid, (turns, meta) in sets.items():
        (OUT / f"{rid}.json").write_text(json.dumps({"id": rid, **meta, "turns": turns}, indent=1, ensure_ascii=False))
        write_md(rid, turns, meta)
        L = [t for t in turns if t["role"] == "learner"]
        print(rid, meta["tool"][:22], f"learner turns={len(L)}", f"ai turns={len(turns) - len(L)}")
    (OUT / "survey.json").write_text(json.dumps(survey(), indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
