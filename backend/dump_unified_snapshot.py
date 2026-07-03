"""Dump the current unified library (the live baseline run) to a JSON snapshot.

Read-only. Produces a complete, comparable record of the unified library BEFORE a
new framework is absorbed: totals, per-domain composition, every set (with member
count + normalized evidence), every standalone entry, and artifacts per framework.

Usage:  python dump_unified_snapshot.py [before|after]   (default tag: snapshot)
"""
import os, sys, json, datetime
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from grc.models import (NormalizationRun, NormalizedControl, NormalizedControlLink,
                        CommonControlGroup, CommonControlGroupMapping,
                        ParsedFrameworkControl, UploadedFramework)
from grc.models._37_artifact_catalog_tenant_artifacts import ArtifactCatalogItem

TAG = sys.argv[1] if len(sys.argv) > 1 else "snapshot"
STAMP = sys.argv[2] if len(sys.argv) > 2 else datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")

db = sessionmaker(bind=create_engine(os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0] + "/grc_complyverse"))()

base = db.query(NormalizationRun).filter(NormalizationRun.is_baseline.is_(True)).order_by(NormalizationRun.id.desc()).first()
RID = base.id

# framework id -> name
fw_name = {f.id: f.name for f in db.query(UploadedFramework).all()}

# member counts + frameworks per normalized set (nc)
ncs = db.query(NormalizedControl).filter(NormalizedControl.run_id == RID).all()
links = db.query(NormalizedControlLink.normalized_control_id, NormalizedControlLink.parsed_control_id)\
    .join(NormalizedControl, NormalizedControl.id == NormalizedControlLink.normalized_control_id)\
    .filter(NormalizedControl.run_id == RID).all()
# parsed_control_id -> framework id
pcf = {p.id: p.uploaded_framework_id for p in db.query(ParsedFrameworkControl.id, ParsedFrameworkControl.uploaded_framework_id).all()}
members_by_nc = {}
for nc_id, pcid in links:
    members_by_nc.setdefault(nc_id, []).append(pcid)

sets_list, standalone_list = [], []
per_domain = {}
for nc in ncs:
    mem = members_by_nc.get(nc.id, [])
    fws = sorted({fw_name.get(pcf.get(m), "?") for m in mem})
    ev = nc.recommended_evidence or []
    dom = nc.domain or "—"
    row = {"name": nc.name, "domain": dom, "members": len(mem),
           "frameworks": fws, "evidence_count": len(ev)}
    d = per_domain.setdefault(dom, {"domain": dom, "sets": 0, "standalone": 0, "unified": 0, "members": 0, "evidence": 0})
    d["unified"] += 1; d["members"] += len(mem); d["evidence"] += len(ev)
    if len(mem) > 1:
        sets_list.append(row); d["sets"] += 1
    else:
        standalone_list.append(row); d["standalone"] += 1

# artifacts per framework_key
art_by_fw = {}
for (fk, cnt) in db.query(ArtifactCatalogItem.framework_key, func.count()).group_by(ArtifactCatalogItem.framework_key).all():
    art_by_fw[fk] = cnt

snapshot = {
    "tag": TAG, "stamp": STAMP,
    "baseline_run_id": RID,
    "totals": {
        "unified_entries": len(ncs),
        "sets": len(sets_list),
        "standalone": len(standalone_list),
        "domains": db.query(CommonControlGroup).filter(CommonControlGroup.run_id == RID).count(),
        "raw_controls_linked": len(links),
        "active_frameworks": db.query(UploadedFramework).filter(UploadedFramework.is_active.is_(True)).count(),
        "normalized_evidence_items": sum(x["evidence_count"] for x in sets_list + standalone_list),
        "artifact_catalog_items": sum(art_by_fw.values()),
        "artifact_frameworks": len(art_by_fw),
    },
    "per_domain": sorted(per_domain.values(), key=lambda x: x["domain"]),
    "sets": sorted(sets_list, key=lambda x: (x["domain"], x["name"])),
    "standalone": sorted(standalone_list, key=lambda x: (x["domain"], x["name"])),
    "artifacts_by_framework": art_by_fw,
}

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline_snapshots")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, f"{TAG}_run{RID}_{STAMP}.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(snapshot, f, ensure_ascii=False, indent=2)

t = snapshot["totals"]
print("WROTE", out)
print(f"baseline run #{RID}")
print(f"  unified entries : {t['unified_entries']}  (sets {t['sets']} + standalone {t['standalone']})")
print(f"  domains         : {t['domains']}")
print(f"  raw controls    : {t['raw_controls_linked']}  across {t['active_frameworks']} frameworks")
print(f"  norm. evidence  : {t['normalized_evidence_items']} items")
print(f"  artifacts       : {t['artifact_catalog_items']} items across {t['artifact_frameworks']} frameworks")
print("\nPER-DOMAIN:")
print(f"  {'domain':38} {'sets':>5} {'standln':>8} {'unified':>8} {'members':>8} {'evid':>6}")
for d in snapshot["per_domain"]:
    print(f"  {d['domain'][:38]:38} {d['sets']:>5} {d['standalone']:>8} {d['unified']:>8} {d['members']:>8} {d['evidence']:>6}")
db.close()
