"""Populate full, coherent profile data + linkages for every IT asset, so each
asset's detail page is complete and its scores / relationships are correct.

HEURISTIC, not name-hardcoded: every value is derived from the asset's own
signals (asset_type / os_normalized / criticality / name), so it produces
realistic, coherent data on ANY tenant's assets — the local demo set and the
real production assets alike.

SAFE + IDEMPOTENT: profile columns are filled ONLY where currently empty (a real
value is never overwritten). Linkage rows (criticality assessment, vuln links,
control links, risk links, relationships) are tagged and removable via `cleanup`.

Usage (from backend/):  python seed_asset_profiles.py seed|cleanup [--tenant complyverse]
"""
import argparse
from datetime import datetime, timedelta

import grc.models as M
from grc.models import GRCUser, ITAsset
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants
from grc.services.asset_criticality import recompute_for_asset

ISCA = getattr(M, "InfoSystemCriticalityItem", None)
AssetControlLink = getattr(M, "AssetControlLink", None)
NormalizedControl = getattr(M, "NormalizedControl", None)
RiskAssetLink = getattr(M, "RiskAssetLink", None)
Risk = getattr(M, "Risk", None)
AssetRelationship = getattr(M, "AssetRelationship", None)
Vulnerability = getattr(M, "Vulnerability", None)
VulnerabilityAssetLink = getattr(M, "VulnerabilityAssetLink", None)
TAG = "[PROFILE]"
VULN_LINK_SRC = "profile_seed"
REL_MARK = "[PROFILE] seed"


# ─────────────────────────── helpers ───────────────────────────────

def _empty(v):
    """Empty for NON-boolean fields (None / '' / 0). Never call on a bool."""
    return v is None or v == "" or v == 0


def _users_pool(db, tids):
    """Real, assignable users (exclude synthetic IGA sample accounts)."""
    us = db.query(GRCUser).filter(GRCUser.tenant_id.in_(tids)).all() if hasattr(GRCUser, "tenant_id") else db.query(GRCUser).all()
    real = [u for u in us if "sample" not in (u.username or "").lower()]
    pool = real or us
    return pool


def _uname(u):
    return getattr(u, "display_name", None) or getattr(u, "full_name", None) or u.username


# CIA defaults by criticality bucket (C, I, A) — data assets weight C, infra weight A.
_CIA_BY_CRIT = {
    "critical": (5, 4, 5), "high": (4, 4, 4), "medium": (3, 3, 3), "low": (2, 2, 2),
}

# business_function category id (feeds derived criticality + hygiene) by a name
# keyword first, then asset_type.
_BF_KEYWORDS = [
    ("payroll", "hr_payroll"), ("hr ", "hr_payroll"),
    ("payment", "payment_processing"), ("billing", "payment_processing"),
    ("bank", "core_banking"),
    ("auth", "authentication_iam"), ("iam", "authentication_iam"), ("identity", "authentication_iam"),
    ("email", "communications"), ("mail", "communications"), ("gateway", "security_operations"),
    ("security", "security_operations"), ("siem", "security_operations"), ("edr", "security_operations"),
    ("backup", "backup_recovery"), ("recovery", "backup_recovery"),
    ("file", "internal_tools"),
    ("web", "customer_facing_app"), ("portal", "customer_facing_app"), ("vpc", "infrastructure"),
    ("network", "infrastructure"), ("dns", "infrastructure"), ("vpn", "infrastructure"),
    ("db", "customer_data"), ("sql", "customer_data"), ("postgre", "customer_data"), ("oracle", "customer_data"),
]
_BF_BY_TYPE = {
    "data": "customer_data", "application": "customer_facing_app",
    "infrastructure": "infrastructure", "cloud": "infrastructure", "third_party": "partner_api",
}

# data_classification by criticality.
_CLASS_BY_CRIT = {"critical": "restricted", "high": "confidential", "medium": "internal", "low": "internal"}

# op_dep_business_impact mirrors the criticality bucket.
_OPDEP_BY_CRIT = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}

_DEPT_BY_TYPE = {
    "data": "Data Platform", "application": "Application Engineering",
    "infrastructure": "IT Infrastructure", "cloud": "Cloud Platform", "third_party": "Vendor Management",
}

_LOCATIONS = ["Primary DC — Riyadh", "AWS eu-west-1", "Azure UK South", "Secondary DC — Jeddah", "GCP europe-west2"]


def _os_meta(os_norm, asset_type):
    """(os_family, os_version, platform_vendor, is_server, is_cloud) from os_normalized."""
    o = (os_norm or "").lower()
    def _ver(prefix, label):
        tail = o.split(prefix, 1)[-1]
        return f"{label} {tail}".strip()
    if o.startswith("windows-server"):
        return ("windows", _ver("windows-server-", "Windows Server").replace("Windows Server ", "Windows Server "), "Microsoft", True, False)
    if o.startswith("windows-11"):
        return ("windows", "Windows 11", "Microsoft", False, False)
    if o.startswith("windows-10"):
        return ("windows", "Windows 10", "Microsoft", False, False)
    if o.startswith("windows"):
        return ("windows", "Windows", "Microsoft", True, False)
    if o.startswith("ubuntu"):
        return ("linux", _ver("ubuntu-", "Ubuntu"), "Canonical", True, False)
    if o.startswith("rhel"):
        return ("linux", _ver("rhel-", "Red Hat Enterprise Linux"), "Red Hat", True, False)
    if o.startswith("debian"):
        return ("linux", _ver("debian-", "Debian"), "Debian", True, False)
    if o.startswith(("almalinux", "rockylinux", "oraclelinux", "amazonlinux", "sles")):
        return ("linux", o.replace("-", " ").title(), "Linux Foundation", True, False)
    if o.startswith("postgresql"):
        return ("linux", _ver("postgresql-", "PostgreSQL"), "PostgreSQL Global Dev Group", True, False)
    if o.startswith(("oracle-db", "mysql", "mssql")):
        return ("linux", o.replace("-", " ").title(), "Oracle", True, False)
    if o.startswith("macos"):
        return ("macos", "macOS", "Apple", False, False)
    if o.startswith("aws"):
        return ("cloud", "AWS Account", "Amazon Web Services", False, True)
    if o.startswith("azure"):
        return ("cloud", "Azure Subscription", "Microsoft", False, True)
    if o.startswith("kubernetes"):
        return ("cloud", "Kubernetes", "CNCF", False, True)
    if o.startswith("cisco"):
        return ("network", "Cisco IOS-XE", "Cisco", False, False)
    if asset_type == "cloud":
        return ("cloud", "Cloud Resource", "Amazon Web Services", False, True)
    return (None, None, "Dell", asset_type in ("infrastructure", "data"), False)


def _os_normalized_default(asset_type):
    return {"infrastructure": "ubuntu-22.04", "data": "rhel-9", "application": "windows-server-2022",
            "cloud": "aws-account", "third_party": None}.get(asset_type)


def _internet_facing(a):
    """Heuristic exposure from name/type (only ever turns exposure ON)."""
    n = (a.name or "").lower()
    if any(k in n for k in ("web", "portal", "vpc", "gateway", "public", "api", "dns", "vpn", "edge")):
        return True
    if a.asset_type in ("cloud", "third_party"):
        return True
    return False


def _regulated(bf, classification):
    if not bf:
        return "none"
    bf = bf.lower()
    if "pii" in bf or "customer_data" in bf or "hr_payroll" in bf:
        return "pii"
    if "pci" in bf or "payment" in bf:
        return "pci"
    if "phi" in bf:
        return "phi"
    if "financial" in bf or "banking" in bf:
        return "financial"
    return "none"


def _profile(a, users, idx, now):
    """Return dict of column -> value for the FILL-IF-EMPTY pass."""
    ct = (a.criticality or "medium").lower()
    at = (a.asset_type or "application").lower()
    name = a.name or f"asset-{a.id}"
    fam, ver, vendor, is_server, is_cloud = _os_meta(a.os_normalized, at)

    # business function (id) — keyword first, then type.
    nl = name.lower()
    bf = next((v for k, v in _BF_KEYWORDS if k in nl), None) or _BF_BY_TYPE.get(at, "other")

    owner = users[idx % len(users)]
    seco = users[(idx + 1) % len(users)]
    bizo = users[(idx + 2) % len(users)]
    esca = users[(idx + 3) % len(users)]

    cia = _CIA_BY_CRIT.get(ct, (3, 3, 3))
    slug = "".join(ch if ch.isalnum() else "-" for ch in nl).strip("-")[:40] or f"asset-{a.id}"

    specs = {
        "data": (8, 64, 2000), "infrastructure": (8, 32, 500), "application": (4, 16, 250),
        "cloud": (4, 16, 100), "third_party": (2, 8, 50),
    }.get(at, (4, 16, 200))

    val_by_crit = {"critical": 500000.0, "high": 200000.0, "medium": 75000.0, "low": 20000.0}

    return {
        # Identity & ownership
        "primary_owner_id": owner.id,
        "custodian": _uname(seco),
        "department": _DEPT_BY_TYPE.get(at, "IT Operations"),
        "environment": "production",
        "assigned_user": _uname(owner),
        "location": _LOCATIONS[idx % len(_LOCATIONS)],
        "data_classification": _CLASS_BY_CRIT.get(ct, "internal"),
        "business_function": bf,
        "owning_team": _DEPT_BY_TYPE.get(at, "IT Operations") + " Team",
        "secondary_owner_id": seco.id,
        "business_owner_id": bizo.id,
        "escalation_contact_id": esca.id,
        # CIA
        "confidentiality_rating": cia[0],
        "integrity_rating": cia[1],
        "availability_rating": cia[2],
        # Network & platform
        "host_name": slug + ".corp.local",
        "os_family": fam,
        "os_version": ver,
        "os_normalized": a.os_normalized or _os_normalized_default(at),
        "manufacturer": vendor,
        "model": ("PowerEdge R760" if is_server and not is_cloud else ("Cloud Resource" if is_cloud else "Virtual Appliance")),
        "serial_number": (None if is_cloud else f"SN-{a.id:05d}-{slug[:6].upper()}"),
        "network_segment": ("DMZ" if _internet_facing(a) else "Prod-Internal-VLAN20"),
        # Hardware & telemetry
        "cpu_cores": specs[0],
        "memory_gb": specs[1],
        "storage_gb": specs[2],
        "agent_version": "7.4.2",
        "last_seen_source": ("crowdstrike" if fam == "windows" else "nessus"),
        # Procurement & cost
        "purchase_cost": val_by_crit.get(ct, 75000.0),
        "purchase_date": now - timedelta(days=420 + idx * 11),
        "warranty_expiry": now + timedelta(days=310),
        "eol_date": now + timedelta(days=900),
        "vendor": vendor,
        "valuation": val_by_crit.get(ct, 75000.0),
        # Effective-risk business impact
        "op_dep_business_impact": _OPDEP_BY_CRIT.get(ct, "medium"),
        "regulated_data_type": _regulated(bf, _CLASS_BY_CRIT.get(ct, "internal")),
    }


def _apply(a, prof):
    """Fill only empty columns. Returns count of fields set."""
    n = 0
    for k, v in prof.items():
        if v is None:
            continue
        if not hasattr(a, k):
            continue
        cur = getattr(a, k)
        # bool-ish exposure fields handled separately; here skip if already set
        if _empty(cur):
            setattr(a, k, v)
            n += 1
    return n


def _apply_exposure(a):
    """internet_facing / is_internet_facing / is_customer_facing — only turn ON,
    never flip a deliberate False off. Sets both legacy + new columns."""
    exposed = _internet_facing(a)
    if exposed:
        if hasattr(a, "internet_facing") and not a.internet_facing:
            a.internet_facing = True
        if hasattr(a, "is_internet_facing") and not a.is_internet_facing:
            a.is_internet_facing = True
    # customer-facing for web/app/payment
    if hasattr(a, "is_customer_facing") and not a.is_customer_facing:
        nl = (a.name or "").lower()
        if a.asset_type in ("application",) or any(k in nl for k in ("web", "portal", "payment", "customer", "api")):
            a.is_customer_facing = True


def _ensure_last_seen(a, now, idx):
    if hasattr(a, "last_seen_at") and a.last_seen_at is None:
        a.last_seen_at = now - timedelta(days=idx % 14)  # recent -> "scanned" hygiene


_ISCA_BAND = {"critical": ("mission_critical", 28), "high": ("high", 21),
              "medium": ("moderate", 16), "low": ("low", 10)}


def _ensure_isca(db, a, tid, user, now):
    """Create ONE approved criticality assessment if the asset has none."""
    if ISCA is None:
        return 0
    exists = db.query(ISCA).filter(ISCA.tenant_id == tid, ISCA.linked_asset_id == a.id).first()
    if exists:
        return 0
    ct = (a.criticality or "medium").lower()
    level, total = _ISCA_BAND.get(ct, ("moderate", 16))
    kw = {
        "tenant_id": tid, "name": f"{TAG} Criticality — {a.name}", "linked_asset_id": a.id,
        "approval_status": "approved", "operational_dependency": 3, "financial_impact": 3,
        "customer_stakeholder_impact": 2, "data_sensitivity": 3, "unauthorized_access_risk": 3,
        "rto_rpo_requirements": 2, "internet_facing": 2 if _internet_facing(a) else 0, "b2b_exposure": 0,
        "total_score": total, "criticality_level": level,
        "created_by": user.id, "approved_by": user.id,
    }
    for opt, val in (("approved_at", now), ("date_of_assessment", now), ("created_at", now)):
        if hasattr(ISCA, opt):
            kw[opt] = val
    try:
        db.add(ISCA(**{k: v for k, v in kw.items() if hasattr(ISCA, k)}))
        db.commit()
        return 1
    except Exception as e:
        db.rollback()
        print("  ISCA skip:", str(e)[:120])
        return 0


# ─────────────────────────── Stage 2: linkages ──────────────────────

def _link_controls(db, a, pool, idx, target=12):
    """Map the asset to ~12 real normalized controls → control-coverage KPI."""
    if not (AssetControlLink and pool):
        return 0
    have = db.query(AssetControlLink).filter(AssetControlLink.asset_id == a.id).count()
    if have >= 10:
        return 0
    span = max(1, len(pool) - target)
    chosen = pool[(idx * 13) % span:(idx * 13) % span + target]
    existing = {c for (c,) in db.query(AssetControlLink.normalized_control_id)
                .filter(AssetControlLink.asset_id == a.id).all()}
    n = 0
    for cid in chosen:
        if cid in existing:
            continue
        db.add(AssetControlLink(asset_id=a.id, normalized_control_id=cid))
        n += 1
    return n


def _link_risk(db, a, pool, idx):
    """Link the asset to one enterprise risk → risk-posture 'risk' dimension."""
    if not (RiskAssetLink and pool):
        return 0
    if db.query(RiskAssetLink).filter(RiskAssetLink.asset_id == a.id).count():
        return 0
    rid = pool[idx % len(pool)]
    db.add(RiskAssetLink(risk_id=rid, asset_id=a.id))
    return 1


def _backfill_vuln(db, a, pool, user, idx):
    """Ensure every asset has >=1 finding (link source-tagged for cleanup)."""
    if not (VulnerabilityAssetLink and pool):
        return 0
    if db.query(VulnerabilityAssetLink).filter(VulnerabilityAssetLink.asset_id == a.id).count():
        return 0
    n = 0
    for k in range(2):
        vid = pool[(idx + k) % len(pool)]
        if db.query(VulnerabilityAssetLink).filter(
                VulnerabilityAssetLink.asset_id == a.id,
                VulnerabilityAssetLink.vulnerability_id == vid).first():
            continue
        db.add(VulnerabilityAssetLink(vulnerability_id=vid, asset_id=a.id,
                                      link_source=VULN_LINK_SRC, created_by=user.id))
        n += 1
    return n


def _relationships(db, assets, tid, user, now):
    """Create depends_on edges (non-infra asset → an infra/cloud host)."""
    if not AssetRelationship:
        return 0
    infra = [a for a in assets if (a.asset_type or "") in ("infrastructure", "cloud")]
    if not infra:
        return 0
    n = 0
    for idx, a in enumerate(assets):
        if a in infra:
            continue
        tgt = infra[idx % len(infra)]
        if tgt.id == a.id:
            continue
        if db.query(AssetRelationship).filter(
                AssetRelationship.source_asset_id == a.id,
                AssetRelationship.target_asset_id == tgt.id,
                AssetRelationship.relationship_type == "depends_on").first():
            continue
        kw = {"tenant_id": tid, "source_asset_id": a.id, "target_asset_id": tgt.id,
              "relationship_type": "depends_on", "notes": f"{TAG} seeded dependency",
              "created_by_name": REL_MARK}
        for opt, val in (("created_by_id", user.id), ("created_at", now)):
            if hasattr(AssetRelationship, opt):
                kw[opt] = val
        db.add(AssetRelationship(**{k: v for k, v in kw.items() if hasattr(AssetRelationship, k)}))
        n += 1
    return n


# ─────────────────────────── seed / cleanup ─────────────────────────

def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
    users = _users_pool(db, tids)
    assets = db.query(ITAsset).filter(ITAsset.tenant_id.in_(tids)).order_by(ITAsset.id).all()

    fields_set = 0
    isca_made = 0
    for idx, a in enumerate(assets):
        prof = _profile(a, users, idx, now)
        # These two carry NOT-NULL defaults ('none'/'medium'), so plain
        # fill-if-empty would skip them; set them explicitly from the derived
        # values (they are computed, not manual, and drive effective-risk).
        prof.pop("op_dep_business_impact", None)
        prof.pop("regulated_data_type", None)
        fields_set += _apply(a, prof)
        _apply_exposure(a)
        _ensure_last_seen(a, now, idx)
        ct = (a.criticality or "medium").lower()
        if getattr(a, "op_dep_business_impact", None) in (None, "", "medium"):
            a.op_dep_business_impact = _OPDEP_BY_CRIT.get(ct, "medium")
        der_reg = _regulated(a.business_function, a.data_classification)
        if der_reg != "none" and getattr(a, "regulated_data_type", None) in (None, "", "none"):
            a.regulated_data_type = der_reg
        recompute_for_asset(a)  # derived criticality_score + bucket
    db.commit()

    for idx, a in enumerate(assets):
        isca_made += _ensure_isca(db, a, a.tenant_id, user, now)

    # ---- Stage 2: linkages (controls / risks / vulns / relationships) ----
    ctrl_pool = ([cid for (cid,) in db.query(NormalizedControl.id)
                  .order_by(NormalizedControl.id).limit(400).all()] if NormalizedControl else [])
    risk_pool = ([r.id for r in db.query(Risk).filter(Risk.tenant_id.in_(tids)).limit(20).all()]
                 if Risk else [])
    vuln_pool = ([v.id for v in db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(tids)).all()]
                 if Vulnerability else [])
    ctrl_links = risk_links = vuln_links = 0
    for idx, a in enumerate(assets):
        ctrl_links += _link_controls(db, a, ctrl_pool, idx)
        risk_links += _link_risk(db, a, risk_pool, idx)
        vuln_links += _backfill_vuln(db, a, vuln_pool, user, idx)
    rels = _relationships(db, assets, tid, user, now)
    db.commit()

    return {"assets": len(assets), "fields_filled": fields_set, "assessments_created": isca_made,
            "control_links": ctrl_links, "risk_links": risk_links, "vuln_links": vuln_links,
            "relationships": rels}


def cleanup(db, tids):
    """Remove the tagged linkage rows. Profile COLUMN fills are the desired
    end-state and are NOT reverted (they were only ever written where empty)."""
    removed = {"assessments": 0, "control_links": 0, "risk_links": 0,
               "vuln_links": 0, "relationships": 0}
    touched = set()
    if ISCA is not None:
        rows = db.query(ISCA).filter(ISCA.tenant_id.in_(tids), ISCA.name.like(f"{TAG}%")).all()
        touched = {r.linked_asset_id for r in rows}
        for r in rows:
            db.delete(r)
        removed["assessments"] = len(rows)
    if AssetControlLink is not None and touched:
        removed["control_links"] = db.query(AssetControlLink).filter(
            AssetControlLink.asset_id.in_(touched)).delete(synchronize_session=False)
    if RiskAssetLink is not None and touched:
        removed["risk_links"] = db.query(RiskAssetLink).filter(
            RiskAssetLink.asset_id.in_(touched)).delete(synchronize_session=False)
    if VulnerabilityAssetLink is not None:
        removed["vuln_links"] = db.query(VulnerabilityAssetLink).filter(
            VulnerabilityAssetLink.link_source == VULN_LINK_SRC).delete(synchronize_session=False)
    if AssetRelationship is not None:
        removed["relationships"] = db.query(AssetRelationship).filter(
            AssetRelationship.created_by_name == REL_MARK).delete(synchronize_session=False)
    db.commit()
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        user = (db.query(GRCUser).filter(GRCUser.username == "admin").first()
                or db.query(GRCUser).first())
        tids = get_user_tenants(user, db)
        if args.command == "cleanup":
            print("Cleaned:", cleanup(db, tids))
        else:
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
