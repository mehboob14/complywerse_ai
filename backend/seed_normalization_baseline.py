"""Load the committed master-baseline seed (grc/seed_data/normalization_baseline.json)
into a fresh DB — NO AI required. Run AFTER the frameworks are seeded.

Maps each seeded member onto the target DB's parsed-control ids by
(framework_name, original_reference) with a (framework_name, title) fallback, so it
works regardless of primary-key differences. Idempotent: if a baseline already
exists it does nothing (pass --force to add anyway as a non-baseline run).

    python seed_normalization_baseline.py            # load as the live baseline
    python seed_normalization_baseline.py --force    # load even if a baseline exists
"""
import os, sys, json
from dotenv import load_dotenv; load_dotenv(".env")
from sqlalchemy import create_engine, text as sqltext
from sqlalchemy.orm import sessionmaker
base=os.environ["POSTGRES_ADMIN_URL"].rsplit("/",1)[0]
db=sessionmaker(bind=create_engine(base+"/grc_complyverse"))()
from grc.models import (NormalizationRun, NormalizedControl, NormalizedControlLink,
                        CommonControlGroup, CommonControlGroupMapping)

FORCE="--force" in sys.argv
SEED=os.path.join(os.path.dirname(__file__), "grc", "seed_data", "normalization_baseline.json")
seed=json.load(open(SEED, encoding="utf-8"))

existing=db.query(NormalizationRun).filter(NormalizationRun.is_baseline==True).first()
if existing and not FORCE:
    print(f"A baseline already exists (run #{existing.id}). Nothing to do (use --force to add).")
    sys.exit(0)

# build lookup from the seeded framework controls
fwn={r[1]:r[0] for r in db.execute(sqltext("SELECT id,name FROM grc_uploaded_frameworks")).fetchall()}
# Composite key (framework, ref, title) disambiguates controls that share a ref OR a
# title; (framework, ref) and (framework, title) are kept as fallbacks. Each lookup
# maps to a LIST so a still-ambiguous key can hand out distinct ids round-robin.
from collections import defaultdict
by_key=defaultdict(list); by_ref=defaultdict(list); by_title=defaultdict(list)
for pid,fwid,ref,title in db.execute(sqltext(
        "SELECT id,uploaded_framework_id,original_reference,title FROM grc_parsed_framework_controls ORDER BY id")).fetchall():
    t=(title or "")[:200]
    by_key[(fwid, ref or "", t)].append(pid)
    if ref: by_ref[(fwid, ref)].append(pid)
    if t: by_title[(fwid, t)].append(pid)
_used=set()
def _take(lst):
    for pid in lst:
        if pid not in _used:
            _used.add(pid); return pid
    return None
def resolve(m):
    fwid=fwn.get(m["framework"])
    if fwid is None: return None
    t=(m.get("title") or "")[:200]
    return (_take(by_key.get((fwid, m.get("ref") or "", t), []))
            or _take(by_ref.get((fwid, m.get("ref")), []))
            or _take(by_title.get((fwid, t), [])))

tid=db.execute(sqltext("SELECT id FROM grc_tenants ORDER BY id LIMIT 1")).scalar() or 1
run=NormalizationRun(tenant_id=tid, label=seed.get("label","Master baseline"), scope="full",
                     is_baseline=not bool(existing), status="completed")
db.add(run); db.flush(); RID=run.id
groups={}
# Clean FDOM-NN codes for the live baseline (fresh DB); run-scoped codes when this
# is loaded as a session alongside an existing baseline (--force), to avoid clashes.
_code = (lambda n: f"FDOM-{n:02d}") if run.is_baseline else (lambda n: f"S{RID}-FDOM-{n:02d}")
def group_for(dom):
    dom=dom or "Other / Uncategorized"
    if dom not in groups:
        g=CommonControlGroup(tenant_id=tid, run_id=RID, code=_code(len(groups)+1), name=dom, domain=dom, category=dom)
        db.add(g); db.flush(); groups[dom]=g.id
    return groups[dom]
for d in seed.get("domains",[]): group_for(d)   # preserve order

seq=0; n_uni=0; n_std=0; unresolved=0
claimed=set()   # a parsed control belongs to exactly one place in the library
for u in seed.get("unified",[]):
    pids=[]; seen=set()
    for m in u["members"]:
        pid=resolve(m)
        if not pid: unresolved+=1; continue
        if pid in claimed or pid in seen: continue   # dedupe within + across controls
        seen.add(pid); pids.append((pid, fwn.get(m["framework"])))
    if len({fw for _,fw in pids})<2: continue   # must still span >=2 frameworks
    gid=group_for(u["domain"]); seq+=1; n_uni+=1
    nc=NormalizedControl(code=f"NCF{seq:04d}", name=u["name"][:250], source="ai_normalized",
                         run_id=RID, domain=u["domain"], maturity_level=0, review_status="pending",
                         recommended_evidence=u.get("evidence"))
    db.add(nc); db.flush()
    db.add(CommonControlGroupMapping(group_id=gid, normalized_control_id=nc.id, mapping_source="domain", mapping_confidence=1.0))
    for pid,_fw in pids:
        db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=pid, mapping_type="direct"))
        db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=pid, mapping_source="domain", mapping_confidence=1.0))
        claimed.add(pid)
for s in seed.get("standalone",[]):
    pid=resolve(s)
    if not pid: unresolved+=1; continue
    if pid in claimed: continue   # already a unified member
    claimed.add(pid)
    gid=group_for(s["domain"])
    db.add(CommonControlGroupMapping(group_id=gid, parsed_control_id=pid, mapping_source="standalone", mapping_confidence=1.0)); n_std+=1
run.summary={"unified_controls":n_uni,"standalone":n_std,"domains":len(groups),"from_seed":True}
db.commit()
print(f"SEEDED baseline run #{RID}: {n_uni} unified · {n_std} standalone · {len(groups)} domains "
      f"({'LIVE baseline' if run.is_baseline else 'session, not baseline'}); unresolved members/controls: {unresolved}")
db.close()
