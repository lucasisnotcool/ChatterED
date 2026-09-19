"""Execute R6's disputed SQL against real PostgreSQL to settle FIDELITY codes.

R6 is a SQL practice session in which the AI repeatedly judges the learner's queries. Each
check below takes a query **verbatim from the transcript** and runs it against the schema
the learner supplied (R6 L3) plus a tiny synthetic dataset. It records whether the AI's
claim about that query holds. Output: analysis/r6-sql-checks.json (turn ids, claim,
verdict, and the Postgres message if any; no transcript text beyond the claim).

    PGPORT=55432 python3 scripts/verify_r6_sql.py     (needs a scratch Postgres; see README)
"""
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PSQL = os.environ.get("PSQL", "/Library/PostgreSQL/17/bin/psql")
CONN = ["-h", "localhost", "-p", os.environ.get("PGPORT", "55432"), "-U", os.environ.get("PGUSER", "tester")]

T = {t["id"]: t["text"] for t in json.loads((ROOT / "processed/R6.json").read_text())["turns"]}

SEED = """
INSERT INTO region VALUES ('Asia'),('Europe');
INSERT INTO site VALUES ('Jakarta','Asia'),('Hanoi','Asia'),('Porto','Europe');
INSERT INTO contest VALUES ('Jakarta',2023,'J23','2023-10-01'),('Hanoi',2023,'H23','2023-11-01'),
  ('Porto',2023,'P23','2023-12-01'),
  ('Jakarta',2024,'J24','2024-10-01'),('Porto',2024,'P24','2024-11-01');
INSERT INTO question VALUES ('A','Jakarta',2024),('B','Jakarta',2024),('C','Jakarta',2024);
INSERT INTO university VALUES ('U1','Asia'),('U2','Asia'),('U3','Europe'),('U4','Asia');
INSERT INTO team VALUES ('t1','U1'),('t2','U1'),('t3','U2'),('t4','U3'),('t6','U4');
INSERT INTO participate VALUES
  ('t1','Jakarta',2023,2,500,200),('t3','Jakarta',2023,1,100,90),('t2','Jakarta',2023,1,300,250),
  ('t1','Hanoi',2023,3,400,300),('t4','Jakarta',2024,2,200,150),('t1','Jakarta',2024,1,50,40),
  ('t3','Porto',2024,2,300,250),('t2','Porto',2024,2,100,80),
  ('t6','Porto',2023,1,90,60);  -- U4 crosses region in 2023 only
"""


def sql_blocks(s):
    return re.findall(r"```sql\s*(.*?)```", s, re.S)


def learner_sql(tid):
    s = T[tid]
    i = s.lower().find("select") if "with " not in s.lower()[:40] else s.lower().find("with ")
    return s[i:]


def run(sql):
    p = subprocess.run([PSQL, *CONN, "-d", "r6check", "-v", "ON_ERROR_STOP=1", "-Atc", sql],
                       capture_output=True, text=True)
    return p.returncode == 0, (p.stdout if p.returncode == 0 else p.stderr).strip()


def rows(res):
    """Order-insensitive result for comparing two queries."""
    return res[0], sorted(res[1].splitlines())


def setup():
    subprocess.run([PSQL, *CONN, "-d", "postgres", "-qc", "DROP DATABASE IF EXISTS r6check"], capture_output=True)
    subprocess.run([PSQL, *CONN, "-d", "postgres", "-qc", "CREATE DATABASE r6check"], check=True, capture_output=True)
    schema = T["L3"][T["L3"].index("CREATE TABLE"):]
    ok, msg = run(schema)
    assert ok, msg
    ok, msg = run(SEED)
    assert ok, msg


def check(turn, claim, sql, expect_ok, note=""):
    ok, out = run(sql)
    holds = ok == expect_ok
    return {"ai_turn": turn, "ai_claim": claim, "ran_ok": ok, "claim_holds": holds,
            "postgres": out.splitlines()[0][:160] if out else "", "note": note}


def main():
    setup()
    R = []
    # A2: practice answers written against tables that do not exist in the supplied files
    R.append(check("A2", "the queries use the uploaded schema (they reference contest_results)",
                   sql_blocks(T["A2"])[0], True))
    # A7: 'COUNT(*) needs an alias; without it cannot be accessed' -> learner query L7 uses ucc.count
    R.append(check("A7", "learner's query fails because COUNT(*) has no alias",
                   learner_sql("L7"), False))
    # A12: the no-CTE 'last place' query takes MIN(solve) and MAX(time) independently
    q = sql_blocks(T["A12"])[0]
    ok, out = run(q)
    worst = run("SELECT site, team FROM participate p WHERE year=2023 AND NOT EXISTS (SELECT 1 FROM participate q "
                "WHERE q.site=p.site AND q.year=p.year AND (q.solve<p.solve OR (q.solve=p.solve AND q.time>p.time))) "
                "ORDER BY 1")[1]
    R.append({"ai_turn": "A12", "ai_claim": "query returns the last-placed team(s) per 2023 contest",
              "ran_ok": ok, "claim_holds": ok and sorted(out.splitlines()) != [] and
              {l.split('|')[0] + '|' + l.split('|')[2] for l in out.splitlines()} == set(worst.splitlines()),
              "postgres": f"returned {len(out.splitlines()) if ok else 0} rows; true last places: {worst.replace(chr(10), '; ')}",
              "note": "learner L13 flags this; AI concedes in A13"})
    # A17: the model answer to its own question
    R.append(check("A17", "solution query runs on the schema", sql_blocks(T["A17"])[0], True,
                   "HAVING references the output alias; the prose says 'p2.date > p1.date' but the query "
                   "never orders contests in time, so 'improved/declined' is undefined"))
    # A23: 'COUNT(*) double-counts if a team took part in the same contest twice'
    dup = run("INSERT INTO participate VALUES ('t4','Jakarta',2024,1,1,1)")
    R.append({"ai_turn": "A23", "ai_claim": "a team can appear twice for the same contest, so COUNT(*) over-counts",
              "ran_ok": dup[0], "claim_holds": dup[0], "postgres": dup[1].splitlines()[0][:160],
              "note": "PRIMARY KEY (team, site, year) forbids it; with year fixed, COUNT(*) = COUNT(DISTINCT site)"})
    # A26: 'you forgot to count them in the outer query'
    R.append({"ai_turn": "A26", "ai_claim": "learner's query (L26) does not count the EXCEPT result",
              "ran_ok": None, "claim_holds": "count(distinct k.team)" not in T["L26"].lower(),
              "postgres": "", "note": "textual check of L26"})
    # A27: 'PostgreSQL does not support COUNT(DISTINCT (col1, col2))'
    R.append(check("A27", "COUNT(DISTINCT (p.site, p.year)) is unsupported", learner_sql("L27"), False))
    # A28: 'alias issue: p.site = f.site references the wrong scope'
    R.append(check("A28", "learner's correlated reference p.site = f.site is invalid", learner_sql("L28"), False))
    # A30/A31: 'ORDER BY ... LIMIT inside IN is invalid in PostgreSQL' (A32 concedes)
    R.append(check("A30", "ORDER BY ... LIMIT inside IN is invalid", learner_sql("L30"), False))
    R.append(check("A31", "ORDER BY ... LIMIT inside IN is invalid (repeated)", learner_sql("L31"), False))
    # A43: '= ALL (subquery) does not work for multiple rows'
    R.append(check("A43", "s.region = ALL (subquery) cannot be used", learner_sql("L43"), False))
    # A15: 'PostgreSQL does not support RANK() without CTEs/subqueries'
    R.append(check("A15", "RANK() cannot be used without a CTE or subquery",
                   "SELECT team, RANK() OVER (PARTITION BY site, year ORDER BY solve DESC, time) FROM participate",
                   False))
    # A36: 'completely correct' -> the question (A35) asks for 2024; L36 has no year filter
    q = learner_sql("L36").rstrip().rstrip(";")
    a, b = rows(run(q)), rows(run(q + " and p.year = 2024"))
    R.append({"ai_turn": "A36", "ai_claim": "learner's query is completely correct",
              "ran_ok": a[0], "claim_holds": a == b,
              "postgres": f"{len(a[1])} rows vs {len(b[1])} with the 2024 filter",
              "note": "question specifies 2024; query has no year filter (false positive)"})
    # A33: 'alias reuse / wrong GROUP BY' -> compare learner's query with the AI's fix
    a, b = rows(run(learner_sql("L33"))), rows(run(sql_blocks(T["A33"])[0]))
    R.append({"ai_turn": "A33", "ai_claim": "learner's query has issues that the fixed query corrects",
              "ran_ok": a[0], "claim_holds": a != b, "postgres": "identical output" if a == b else "outputs differ",
              "note": "same rows on the test data: the 'fix' changes nothing observable"})
    # A41: 'completely correct' -> learner's outer query has no year filter
    q = learner_sql("L41").rstrip().rstrip(";")
    a, b = rows(run(q)), rows(run(q + " and p.year = 2024"))
    R.append({"ai_turn": "A41", "ai_claim": "learner's query is completely correct",
              "ran_ok": a[0], "claim_holds": a == b,
              "postgres": f"{len(a[1])} rows vs {len(b[1])} with the 2024 filter",
              "note": "outer query also returns 2023 participations (false positive)"})
    out = ROOT / "analysis" / "r6-sql-checks.json"
    out.write_text(json.dumps(R, indent=1))
    for r in R:
        print(f"{r['ai_turn']:4s} holds={str(r['claim_holds']):5s} ran={str(r['ran_ok']):5s} {r['postgres'][:90]}")


if __name__ == "__main__":
    main()
