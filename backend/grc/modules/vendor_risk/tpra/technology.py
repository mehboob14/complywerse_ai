"""Which suppliers run what: the technology seen on their estates, counted and searched.

Read from each supplier's latest outside-in scan: web servers, platforms,
frameworks and libraries from what its sites send, mail and DNS providers from
its records, and software Shodan has seen where the tenant holds a key. "Who
runs X?" also answers from the fourth parties recorded against each supplier,
with names folded through the vendor graph's aliases, so asking for AWS finds
Amazon CloudFront seen on a site and "Amazon Web Services" typed as a
subprocessor alike. "Who shows CVE-…?" reads the scans' findings.
"""
from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ....models import GRCUser, TPRAFourthParty, Vendor, get_db
from ....routers.auth_router import require_auth
from . import graph
from .outside_in import latest_scans, live_waivers, seen_technologies, waiver_for, waivers_of

router = APIRouter(tags=["Vendor technology"])


def _in_use(db: Session, tenant_id: int) -> Dict[int, Vendor]:
    return {v.id: v for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None))
            if (v.status or "active").lower() not in graph._INACTIVE}


def _critical(v: Vendor) -> bool:
    return (v.tier or "").lower() == "critical"


@router.get("/technologies")
def catalogue(q: Optional[str] = Query(None, max_length=120), category: Optional[str] = Query(None, max_length=60),
              db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Every technology seen across suppliers in use, most widespread first."""
    tid = graph._tenant(db, user)
    vendors = _in_use(db, tid)
    scans = {vid: s for vid, s in latest_scans(db, tid).items() if vid in vendors}
    needle = (q or "").strip().lower()
    groups: Dict[str, dict] = {}
    categories = set()
    for vid, scan in scans.items():
        for t in seen_technologies(scan):
            categories.add(t["category"])
            if (needle and needle not in t["name"].lower() and needle not in t["category"].lower()) or \
                    (category and t["category"] != category):
                continue
            g = groups.setdefault(t["name"].lower(), {"name": t["name"], "category": t["category"], "vendors": set(),
                                                      "critical": set(), "versions": set()})
            g["vendors"].add(vid)
            if _critical(vendors[vid]):
                g["critical"].add(vid)
            g["versions"].update(t.get("versions") or [])
    items = [{"name": g["name"], "category": g["category"], "vendors": len(g["vendors"]), "critical": len(g["critical"]),
              "versions": sorted(g["versions"])[:12]} for g in groups.values()]
    items.sort(key=lambda i: (-i["vendors"], -i["critical"], i["name"].lower()))
    return {"items": items, "categories": sorted(categories), "scanned": len(scans), "suppliers": len(vendors)}


@router.get("/technologies/vendors")
def who_runs(name: str = Query(..., min_length=1, max_length=120), db: Session = Depends(get_db),
             user: GRCUser = Depends(require_auth)):
    """The suppliers that run a technology or rely on a platform, and how we know."""
    tid = graph._tenant(db, user)
    vendors = _in_use(db, tid)
    aliases = graph.tenant_aliases(db, tid)
    wanted = name.strip().lower()
    platform = graph.platform_for(name, aliases).lower()
    rows: Dict[int, dict] = {}

    def row(v: Vendor) -> dict:
        return rows.setdefault(v.id, {"vendor": {"id": v.id, "name": v.name, "tier": v.tier}, "seen": [],
                                      "fourth_parties": []})

    for vid, scan in latest_scans(db, tid).items():
        v = vendors.get(vid)
        for t in seen_technologies(scan) if v is not None else []:
            if t["name"].lower() == wanted or (platform and graph.platform_for(t["name"], aliases).lower() == platform):
                row(v)["seen"].append({"name": t["name"], "versions": t.get("versions") or [], "hosts": t.get("hosts") or [],
                                       "evidence": t.get("evidence"), "at": scan.finished_at or scan.started_at})
    if platform:
        for fp in db.query(TPRAFourthParty).filter(TPRAFourthParty.tenant_id == tid, TPRAFourthParty.deleted_at.is_(None)):
            v = vendors.get(fp.vendor_id)
            if v is not None and graph.platform_for(fp.platform or fp.name or "", aliases).lower() == platform:
                row(v)["fourth_parties"].append({"name": fp.name, "service": fp.service, "critical": bool(fp.critical)})
    items = sorted(rows.values(), key=lambda r: (not _critical(vendors[r["vendor"]["id"]]), r["vendor"]["name"].lower()))
    return {"name": name, "platform": graph.platform_for(name, aliases) or None, "items": items}


@router.get("/technologies/cve")
def who_shows(id: str = Query(..., pattern=r"^[Cc][Vv][Ee]-\d{4}-\d{4,7}$"), db: Session = Depends(get_db),
              user: GRCUser = Depends(require_auth)):
    """The suppliers whose latest scan shows a vulnerability, and on which hosts."""
    tid = graph._tenant(db, user)
    vendors = _in_use(db, tid)
    key = f"cve:{id.upper()}"
    scans = {vid: s for vid, s in latest_scans(db, tid).items() if vid in vendors}
    items = []
    for vid, scan in scans.items():
        found = [f for f in scan.findings or [] if f["key"] == key]
        if not found:
            continue
        v = vendors[vid]
        active = live_waivers(waivers_of(db, v), datetime.utcnow().date())
        items.append({"vendor": {"id": v.id, "name": v.name, "tier": v.tier}, "hosts": sorted({f["host"] for f in found}),
                      "severity": found[0]["severity"], "cvss": found[0].get("cvss"),
                      "waived": all(waiver_for(f, active) for f in found), "at": scan.finished_at or scan.started_at})
    items.sort(key=lambda r: (not _critical(vendors[r["vendor"]["id"]]), r["vendor"]["name"].lower()))
    return {"id": id.upper(), "items": items, "scanned": len(scans)}
