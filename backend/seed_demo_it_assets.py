"""Reversible DEMO for the IT Assets / Inventory module so the formula-driven
inventory dashboard is alive: ~12 assets with realistic (partial) hygiene, ~15
vulnerabilities linked to them, and a few approved criticality assessments.
Everything is [DEMO]-tagged; cleanup deletes only the demo rows.

Usage (from backend/):  python seed_demo_it_assets.py seed|cleanup [--tenant complyverse]
"""
import argparse
from datetime import datetime, timedelta
import grc.models as M
from grc.models import GRCUser, ITAsset, Vulnerability, VulnerabilityAssetLink
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

ISCA = getattr(M, "InfoSystemCriticalityItem", None)
VReport = getattr(M, "VulnerabilityReport", None)
TAG = "[DEMO]"
TYPES = ["application", "infrastructure", "data", "cloud", "third_party"]
CRITS = ["critical", "high", "medium", "low"]
CLASS = ["restricted", "confidential", "internal", "public"]
BFUNC = ["Payments", "HR Operations", "Customer Web", "Data Platform", "Corp IT"]
OS = [("windows", "windows-11-23H2"), ("linux", "ubuntu-22.04"), ("windows", "windows-server-2022"), ("linux", "rhel-9")]


def _demo_asset_ids(db, tids):
    return [a.id for a in db.query(ITAsset).filter(
        ITAsset.tenant_id.in_(tids), ITAsset.name.like(f"{TAG}%")).all()]


def cleanup(db, tids):
    ids = _demo_asset_ids(db, tids)
    removed = {"links": 0, "vulns": 0, "reports": 0, "isca": 0, "assets": len(ids)}
    demo_vulns = db.query(Vulnerability).filter(
        Vulnerability.tenant_id.in_(tids), Vulnerability.title.like(f"{TAG}%")).all()
    vids = [v.id for v in demo_vulns]
    if vids or ids:
        removed["links"] = db.query(VulnerabilityAssetLink).filter(
            (VulnerabilityAssetLink.vulnerability_id.in_(vids or [-1])) |
            (VulnerabilityAssetLink.asset_id.in_(ids or [-1]))).delete(synchronize_session=False)
    for v in demo_vulns:
        db.delete(v)
    removed["vulns"] = len(demo_vulns)
    if ISCA is not None and ids:
        removed["isca"] = db.query(ISCA).filter(
            ISCA.tenant_id.in_(tids), ISCA.linked_asset_id.in_(ids)).delete(synchronize_session=False)
    if VReport is not None:
        reps = db.query(VReport).filter(VReport.tenant_id.in_(tids), VReport.name.like(f"{TAG}%")).all()
        for r in reps:
            db.delete(r)
        removed["reports"] = len(reps)
    for a in db.query(ITAsset).filter(ITAsset.id.in_(ids or [-1])).all():
        db.delete(a)
    db.commit()
    return removed


def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
    cleanup(db, tids)

    # ---- 12 assets with realistic, partial hygiene ----
    assets = []
    for i in range(12):
        crit = CRITS[i % len(CRITS)]
        osf, osn = OS[i % len(OS)]
        recent = i % 12 < 7  # ~58% recently scanned
        a = ITAsset(
            tenant_id=tid, name=f"{TAG} Asset {i+1:02d}", asset_type=TYPES[i % len(TYPES)],
            description=f"{TAG} demo asset {i+1}", criticality=crit,
            status="active", lifecycle_state="active",
            os_family=osf, os_normalized=osn, created_at=now - timedelta(days=60),
        )
        if i % 4 != 0:  # 75% have an owner
            a.primary_owner_id = user.id
            a.owner_name = "Demo Owner"
        if i % 3 != 2:  # ~66% CIA rated + score
            a.confidentiality_rating = 3 + (i % 3)
            a.integrity_rating = 2 + (i % 3)
            a.availability_rating = 3 + (i % 2)
            a.criticality_score = round(4.0 + (i % 6), 1)
        if i % 5 != 4:  # ~80% classified — vary
            a.data_classification = CLASS[i % len(CLASS)]
        if i % 2 == 0:  # 50% business function
            a.business_function = BFUNC[i % len(BFUNC)]
        if i % 3 == 0:  # ~33% internet facing
            a.internet_facing = True
            a.is_internet_facing = True
        if i % 6 == 0:  # ~17% CDE
            a.cde_environment = True
        if recent:
            a.last_seen_at = now - timedelta(days=(i % 20))
            a.last_seen_source = "nessus" if i % 2 else "azure_defender"
        db.add(a)
        assets.append(a)
    db.commit()  # commit assets first so their ids are solid for vuln links
    assets = db.query(ITAsset).filter(
        ITAsset.tenant_id.in_(tids), ITAsset.name.like(f"{TAG}%")).order_by(ITAsset.id).all()
    aids = [a.id for a in assets]

    # ---- vulnerabilities linked to assets ----
    report = None
    if VReport is not None:
        try:
            report = VReport(tenant_id=tid, name=f"{TAG} Scan Report",
                             created_at=now - timedelta(days=20))
            db.add(report)
            db.commit()
        except Exception:
            db.rollback()
            report = None
    # (severity, cvss, status, due_offset, kev)
    VULNS = [
        ("critical", 9.8, "open", -12, True), ("critical", 9.1, "in_progress", 20, True),
        ("high", 8.2, "open", -8, False), ("high", 7.5, "resolved", None, False),
        ("high", 7.1, "open", 15, False), ("medium", 6.4, "open", 30, False),
        ("medium", 5.5, "resolved", None, False), ("medium", 5.0, "in_progress", 10, False),
        ("high", 8.8, "open", -5, True), ("low", 3.2, "open", 40, False),
        ("critical", 9.5, "resolved", None, True), ("high", 7.9, "open", -3, False),
        ("medium", 6.0, "open", 25, False), ("low", 2.4, "resolved", None, False),
        ("high", 7.7, "in_progress", 12, False),
    ]
    v_added = 0
    last_err = None
    for j, (sev, cvss, status, due_off, kev) in enumerate(VULNS, 1):
        try:
            v = Vulnerability(
                tenant_id=tid, vuln_id=f"{TAG}-V{j:03d}", title=f"{TAG} {sev} finding {j}",
                severity=sev, status=status, cvss_score=cvss, cve_id=f"CVE-2024-{2000+j}",
                kev_flag=kev, discovered_at=now - timedelta(days=30),
                due_date=(now + timedelta(days=due_off)) if due_off is not None else None,
                resolved_at=(now - timedelta(days=5)) if status == "resolved" else None,
                created_at=now - timedelta(days=30),
            )
            if report is not None:
                v.report_id = report.id
            db.add(v)
            db.flush()
            db.add(VulnerabilityAssetLink(
                vulnerability_id=v.id, asset_id=aids[j % len(aids)],
                link_source="scanner", created_by=user.id))
            db.commit()
            v_added += 1
        except Exception as e:
            last_err = str(e)[:160]
            db.rollback()
            continue

    # ---- criticality assessments (approved) linked to some assets ----
    isca_added = 0
    isca_err = None
    if ISCA is not None:
        crit_map = {"critical": "mission_critical", "high": "high", "medium": "moderate", "low": "low"}
        for k, a in enumerate(assets[:6]):
            try:
                item = ISCA(
                    tenant_id=tid, name=f"{TAG} Criticality - {a.name}", linked_asset_id=a.id, approval_status="approved",
                    operational_dependency=3, financial_impact=3, customer_stakeholder_impact=2,
                    data_sensitivity=3, unauthorized_access_risk=3, rto_rpo_requirements=2,
                    internet_facing=2 if getattr(a, "internet_facing", None) else 0, b2b_exposure=0,
                    total_score=18, criticality_level=crit_map.get(a.criticality, "moderate"),
                    created_by=user.id, approved_by=user.id, approved_at=now - timedelta(days=3),
                )
                db.add(item)
                db.commit()
                isca_added += 1
            except Exception as e:
                isca_err = str(e)[:200]
                db.rollback()
                continue
    return {"assets": len(aids), "vulnerabilities": v_added, "criticality_assessments": isca_added,
            "report": bool(report), "last_vuln_err": last_err, "isca_err": isca_err}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
        tids = get_user_tenants(user, db)
        if args.command == "cleanup":
            print("Reset:", cleanup(db, tids))
        else:
            print("Cleared prior:", cleanup(db, tids))
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
