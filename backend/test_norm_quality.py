"""Normalization quality harness.

Runs the real clustering+verification pipeline on a fixed set of multi-framework
domains, then scores every produced normalized control with an INDEPENDENT LLM
judge (deliberately worded differently from the verification prompt so it isn't
circular). Prints per-cluster verdicts + an aggregate score so we can iterate on
the prompts until quality is high.

Usage:  PYTHONIOENCODING=utf-8 python test_norm_quality.py
"""
import os, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

base = os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0]
db = sessionmaker(bind=create_engine(base + "/grc_complyverse"))()

from grc.models import CommonControlGroup
from grc.modules.control_library.services import normalization as N
from grc.modules.control_library.routers.groups import get_openai_client
from grc.config import get_openai_model

client = get_openai_client()

# Fixed test domains (group ids) — varied size + framework spread.
TEST_DOMAINS = [347, 332, 338, 348, 326, 331, 328]  # Physical, Awareness, Compliance, ThirdParty, Policies, BCM, Access(big)

JUDGE_SYS = (
    "You are an independent compliance auditor grading a control-harmonization "
    "result. You are shown a NORMALIZED control and the framework controls placed "
    "under it. A normalized control is correct only if EVERY member is, at its "
    "core, the SAME control requirement (wording/scope may differ). Flag any "
    "member whose actual subject is about something different."
)

def judge_prompt(clusters):
    blocks = []
    for ci, c in enumerate(clusters):
        lines = [f"    [{i}] ({m['framework'][:28]} {m['code']}) {m['name']}: {m['text'][:200]}"
                 for i, m in enumerate(c["refs"])]
        blocks.append(f"NORMALIZED {ci}: \"{c['name']}\" — {c.get('statement','')}\n  members:\n" + "\n".join(lines))
    return (
        "Grade each normalized control below. For each, return:\n"
        "  verdict: GOOD (all members same requirement) | MIXED (mostly right but list outlier indices) | BAD (incoherent)\n"
        "  outliers: indices of members that don't belong (empty if GOOD)\n"
        "  reason: one short sentence.\n\n"
        + "\n\n".join(blocks) +
        '\n\nRespond ONLY JSON: {"grades":[{"n":0,"verdict":"GOOD","outliers":[],"reason":"..."}]}'
    )

def judge(clusters):
    out = {}
    B = 5
    for s in range(0, len(clusters), B):
        batch = clusters[s:s+B]
        resp = client.chat.completions.create(
            model=get_openai_model(),
            messages=[{"role": "system", "content": JUDGE_SYS},
                      {"role": "user", "content": judge_prompt(batch)}],
            response_format={"type": "json_object"}, temperature=0.0)
        data = json.loads(resp.choices[0].message.content or "{}")
        for g in data.get("grades", []):
            try: out[s + int(g["n"])] = g
            except (KeyError, TypeError, ValueError): pass
    return out

def run():
    all_clusters = []
    for gid in TEST_DOMAINS:
        grp = db.query(CommonControlGroup).filter(CommonControlGroup.id == gid).first()
        if not grp:
            continue
        members = N._fetch_domain_members(db, grp)
        domain = grp.name or "General"
        clusters = N._normalize_one_domain(client, domain, members)
        for c in clusters:
            c["_domain"] = domain
        all_clusters.extend(clusters)
        print(f"  domain '{domain[:35]}': {len(members)} controls -> {len(clusters)} normalized")

    print(f"\nTotal normalized controls produced: {len(all_clusters)}")
    grades = judge(all_clusters)
    score = {"GOOD": 0, "MIXED": 0, "BAD": 0}
    member_total = member_bad = 0
    print("\n--- JUDGE VERDICTS ---")
    for i, c in enumerate(all_clusters):
        g = grades.get(i, {"verdict": "?", "outliers": [], "reason": "no grade"})
        v = (g.get("verdict") or "?").upper()
        score[v] = score.get(v, 0) + 1
        member_total += len(c["refs"])
        member_bad += len(g.get("outliers") or [])
        if v != "GOOD":
            outs = ", ".join(c["refs"][o]["code"] for o in (g.get("outliers") or []) if 0 <= o < len(c["refs"]))
            print(f"  [{v:5}] {c['name'][:42]:42} outliers: {outs or '-'} | {g.get('reason','')[:70]}")
    n = len(all_clusters) or 1
    quality = (score["GOOD"] + 0.5 * score["MIXED"]) / n
    member_precision = 1 - (member_bad / (member_total or 1))
    print(f"\n=== SCORE ===")
    print(f"  clusters: GOOD={score['GOOD']} MIXED={score['MIXED']} BAD={score['BAD']}")
    print(f"  cluster quality score: {quality:.2f}   member precision: {member_precision:.2f}")
    print(f"  avg members/cluster: {member_total/n:.1f}")

if __name__ == "__main__":
    run()
    db.close()
