"""Inter-rater agreement between two coding sheets, and the list of disagreements.

    python3 scripts/agreement.py processed/coding/coder-A.jsonl processed/coding/coder-B.jsonl

Prints percent agreement and Cohen's kappa per codebook dimension, and writes
analysis/agreement.json (numbers + turn ids only). With n = 27 turns per scheme, kappa
is unstable. Read it together with the disagreement list, not on its own.
"""
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
L_DIMS = ["L-ACT", "Q-DEPTH", "ICAP", "OWN", "UPTAKE", "VERIFY"]
A_DIMS = ["A-MOVE", "ENDQ", "OFFER", "SCOPE", "EXAMFRAME", "FIDELITY", "ANSWERS-TASK"]


def load(p):
    rows = (json.loads(l) for l in Path(p).read_text().splitlines() if l.strip())
    return {(r["rid"], r["id"]): r for r in rows}


def kappa(a, b):
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = collections.Counter(a), collections.Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / n ** 2
    return po, (1.0 if pe == 1 else (po - pe) / (1 - pe))


def main(pa, pb):
    A, B = load(pa), load(pb)
    keys = sorted(set(A) & set(B))
    missing = sorted(set(A) ^ set(B))
    res = {"n_common": len(keys), "missing_in_one": [f"{r}:{i}" for r, i in missing], "dims": {}, "disagreements": []}
    for dims, prefix in ((L_DIMS, "L"), (A_DIMS, "A")):
        ks = [k for k in keys if k[1].startswith(prefix)]
        for d in dims:
            a = [str(A[k].get(d)).upper() for k in ks]
            b = [str(B[k].get(d)).upper() for k in ks]
            po, k = kappa(a, b)
            res["dims"][d] = {"n": len(ks), "agreement": round(po, 2), "kappa": round(k, 2)}
            res["disagreements"] += [{"turn": f"{kk[0]}:{kk[1]}", "dim": d, "A": x, "B": y}
                                     for kk, x, y in zip(ks, a, b) if x != y]
    (ROOT / "analysis" / "agreement.json").write_text(json.dumps(res, indent=1))
    for d, v in res["dims"].items():
        print(f"{d:13s} n={v['n']:2d} agree={v['agreement']:.2f} kappa={v['kappa']:.2f}")
    print(len(res["disagreements"]), "disagreements;", "missing:", res["missing_in_one"])


if __name__ == "__main__":
    main(*sys.argv[1:3])
