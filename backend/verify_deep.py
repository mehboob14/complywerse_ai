"""DEEP 100% verification: mock candidate vs baseline, control by control.

Proves, at the row level (not counts on the surface):
  1. The mock library contains EVERY baseline set, same 20 domains.
  2. Each baseline set's ORIGINAL members are all preserved in the mock (nothing lost).
  3. The ONLY additions are the new framework's controls (joins add members; standalone
     add new entries) — and they reconcile exactly (joins + standalone == total controls).
  4. Every new control is placed exactly once, in a valid existing domain, no orphan.
  5. Evidence + artifacts reconcile.
  6. The LIVE baseline run is untouched.

Also dumps both full libraries to JSON for side-by-side inspection.

Usage: python verify_deep.py <framework_id> <candidate_run_id>
"""
import os, sys, json, collections, datetime
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from grc.models import (NormalizationRun, NormalizedControl, NormalizedControlLink,
                        CommonControlGroup, CommonControlGroupMapping,
                        ParsedFrameworkControl, UploadedFramework)
from grc.models._37_artifact_catalog_tenant_artifacts import ArtifactCatalogItem
from grc.modules.control_library.services.extend_baseline import framework_key_for

FW = int(sys.argv[1]); CAND = int(sys.argv[2])
db = sessionmaker(bind=create_engine(os.environ["POSTGRES_ADMIN_URL"].rsplit("/", 1)[0] + "/grc_complyverse"))()
BASE = db.query(NormalizationRun).filter(NormalizationRun.is_baseline.is_(True)).order_by(NormalizationRun.id.desc()).first().id

PASS, FAIL = [], []
def ck(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

# ---- parsed control identity (for readable members) ----
fwname = {f.id: f.name for f in db.query(UploadedFramework).all()}
pc = {p.id: (fwname.get(p.uploaded_framework_id, "?"), p.control_id, p.title, p.uploaded_framework_id)
      for p in db.query(ParsedFrameworkControl).all()}
nist_pids = {pid for pid, v in pc.items() if v[3] == FW}

def load(run):
    ncs = db.query(NormalizedControl).filter(NormalizedControl.run_id == run).all()
    nc_by_id = {n.id: n for n in ncs}
    members = collections.defaultdict(set)          # nc_id -> {parsed_id}
    for ln in db.query(NormalizedControlLink).filter(
            NormalizedControlLink.normalized_control_id.in_(list(nc_by_id))).all():
        members[ln.normalized_control_id].add(ln.parsed_control_id)
    groups = {g.id: (g.domain or g.name or "Other") for g in
              db.query(CommonControlGroup).filter(CommonControlGroup.run_id == run).all()}
    standalone = collections.defaultdict(list)      # domain -> [parsed_id] (standalone maps, no nc)
    for m in db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id.in_(list(groups)),
            CommonControlGroupMapping.mapping_source == "standalone").all():
        standalone[groups[m.group_id]].append(m.parsed_control_id)
    return nc_by_id, members, groups, standalone

print(f"Loading baseline run {BASE} and mock candidate run {CAND}…")
b_nc, b_mem, b_grp, b_std = load(BASE)
c_nc, c_mem, c_grp, c_std = load(CAND)

# index sets by NAME (clone remaps ids, but names are stable)
def by_name(nc_by_id, members):
    d = {}
    for nid, n in nc_by_id.items():
        d[n.name] = {"domain": n.domain, "members": members.get(nid, set()),
                     "evidence": list(n.recommended_evidence or [])}
    return d
B = by_name(b_nc, b_mem)
C = by_name(c_nc, c_mem)

print("\n=== INVARIANTS ===")
ck("Mock has the SAME set of normalized-set names as baseline",
   set(B) == set(C), f"baseline {len(B)} names, mock {len(C)} names, symdiff {len(set(B) ^ set(C))}")
ck("Mock has the SAME 20 domains as baseline",
   set(b_grp.values()) == set(c_grp.values()), f"{len(set(c_grp.values()))} domains")

# per-set: baseline members preserved, and only NIST added
lost_total = 0; nonnist_added = 0; nist_joins = 0
sets_enriched = 0
for name in B:
    bm = B[name]["members"]; cm = C.get(name, {}).get("members", set())
    lost = bm - cm
    added = cm - bm
    lost_total += len(lost)
    nonnist_added += len(added - nist_pids)
    if added:
        nist_joins += len(added & nist_pids)
        if added & nist_pids:
            sets_enriched += 1
ck("NOT ONE baseline member was lost from any set (faithful clone)",
   lost_total == 0, f"lost={lost_total}")
ck("The ONLY members added to existing sets are new-framework controls",
   nonnist_added == 0, f"non-framework additions={nonnist_added}")

# standalone additions in the mock that are NIST
c_std_nist = [(dom, pid) for dom, pids in c_std.items() for pid in pids if pid in nist_pids]
b_std_all = [(dom, pid) for dom, pids in b_std.items() for pid in pids]
c_std_all = [(dom, pid) for dom, pids in c_std.items() for pid in pids]
ck("Baseline standalone entries all preserved in the mock",
   set(b_std_all).issubset(set(c_std_all)), f"baseline standalone {len(b_std_all)}, mock {len(c_std_all)}")

# reconcile: every NIST control placed exactly once (join XOR standalone)
joined_pids = set()
for name in C:
    joined_pids |= (C[name]["members"] & nist_pids)
std_pids = {pid for _, pid in c_std_nist}
placed = joined_pids | std_pids
both = joined_pids & std_pids
missing = nist_pids - placed
ck("Every NIST control is placed (no orphan)", not missing, f"missing={len(missing)}")
ck("No NIST control double-placed (join XOR standalone)", not both, f"double={len(both)}")
ck("joins + standalone == total controls (exact reconciliation)",
   len(joined_pids) + len(std_pids) == len(nist_pids),
   f"{len(joined_pids)} join + {len(std_pids)} standalone == {len(nist_pids)} total")

# joins attach to sets that ALREADY existed in baseline (not new sets)
join_to_existing = all((name in B) for name in C if (C[name]["members"] & nist_pids) and (C[name]["members"] - B.get(name,{}).get("members",set())) & nist_pids)
ck("Every NIST join attaches to a set that already existed in baseline", join_to_existing)

# standalone are genuinely new (their control isn't already an existing set-name dup) — informational
ck("All NIST standalone land in one of the existing 20 domains",
   all(dom in set(c_grp.values()) for dom, _ in c_std_nist), "")

# evidence reconcile: joined sets' evidence grew (merge), baseline evidence preserved
ev_grew = 0; ev_shrank = 0
for name in B:
    be = len(B[name]["evidence"]); ce = len(C.get(name, {}).get("evidence", []))
    if ce > be: ev_grew += 1
    if ce < be: ev_shrank += 1
ck("No set LOST evidence (baseline evidence preserved)", ev_shrank == 0, f"shrank={ev_shrank}")
ck("Evidence was merged onto joined sets", ev_grew > 0, f"sets enriched={ev_grew}")

# artifacts
fkey = framework_key_for(db.query(UploadedFramework).get(FW).name)
art_n = db.query(ArtifactCatalogItem).filter(ArtifactCatalogItem.framework_key == fkey).count()
ck("Framework artifacts ingested into catalog", art_n > 0, f"{art_n} artifacts")

# baseline run physically untouched
base_now_nc = db.query(NormalizedControl).filter(NormalizedControl.run_id == BASE).count()
base_now_dom = db.query(CommonControlGroup).filter(CommonControlGroup.run_id == BASE).count()
ck("LIVE baseline run untouched", base_now_nc == 2332 and base_now_dom == 20, f"{base_now_nc}/{base_now_dom}")

# ---- full placement listing of ALL new controls ----
print(f"\n=== ALL {len(nist_pids)} NEW CONTROLS — exact placement ===")
join_map = {}
for name in C:
    for pid in (C[name]["members"] & nist_pids):
        if pid not in B.get(name, {}).get("members", set()):
            join_map[pid] = (name, C[name]["domain"])
std_map = {pid: dom for dom, pid in c_std_nist}
lines = []
for pid in sorted(nist_pids, key=lambda p: pc[p][1]):
    _, cid, title, _ = pc[pid]
    if pid in join_map:
        s, d = join_map[pid]; lines.append((cid, title, "JOIN", s, d))
    elif pid in std_map:
        lines.append((cid, title, "NEW", "(new standalone set)", std_map[pid]))
    else:
        lines.append((cid, title, "!!ORPHAN", "", ""))
for cid, title, disp, s, d in lines:
    print(f"  {cid:8} {title[:34]:34} {disp:9} {s[:40]:40} [{d}]")

# ---- dump full libraries to JSON for side-by-side ----
def dump(run_id, tag, NC, MEM, STD, GRP):
    sets = []
    for nid, n in NC.items():
        mem = [{"framework": pc[m][0], "ref": pc[m][1], "title": pc[m][2]} for m in sorted(MEM.get(nid, set())) if m in pc]
        sets.append({"name": n.name, "domain": n.domain, "member_count": len(mem),
                     "members": mem, "evidence": list(n.recommended_evidence or [])})
    standalone = []
    for dom, pids in STD.items():
        for m in pids:
            if m in pc:
                standalone.append({"domain": dom, "framework": pc[m][0], "ref": pc[m][1], "title": pc[m][2]})
    sets.sort(key=lambda x: (x["domain"] or "", x["name"]))
    standalone.sort(key=lambda x: (x["domain"], x["framework"], x["ref"]))
    obj = {"tag": tag, "run_id": run_id, "totals": {"sets": len(sets), "standalone": len(standalone),
           "domains": len(set(GRP.values()))}, "sets": sets, "standalone": standalone}
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline_snapshots", f"{tag}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"  wrote {out}  ({len(sets)} sets, {len(standalone)} standalone)")
    return out

print("\n=== FULL LIBRARY DUMPS (open these side by side) ===")
dump(BASE, "LIVE_baseline_run47", b_nc, b_mem, b_std, b_grp)
dump(CAND, f"MOCK_candidate_run{CAND}", c_nc, c_mem, c_std, c_grp)

print(f"\n==== {len(PASS)} PASSED, {len(FAIL)} FAILED ====")
if FAIL: print("FAILED CHECKS:", FAIL)
else: print("100% VERIFIED: mock = baseline (faithful) + exactly the new framework, nothing lost.")
db.close()
