"""The vendor graph: who our vendors depend on, and how many of them share a platform.

A fourth party is a supplier one of our vendors relies on — a hosting provider,
a payment processor, a subprocessor — with the service it provides and the data
of ours it sees. Entered by hand, declared by the vendor, or taken from a
questionnaire.

Concentration counts how many of our vendors sit on the same platform. Names are
folded through an alias map first ("Amazon Web Services", "AWS" and "amazon aws"
are one platform), generic names that say nothing ("Linux", "various") are left
out, and a tenant can add aliases and exclusions of its own. A platform that is
also one of our vendors counts as a direct dependency.

What breaks if a vendor fails is read from the rest of the platform without
changing any of it: the assets linked to the vendor (and those whose free-text
vendor names it, offered as suggestions), where its software runs on our
estate, the controls linked to it or that it provides, and the continuity
processes that depend on it with their recovery times. A shared vulnerability
lists every vendor whose watched products it affects.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from ....models import (
    BcmBiaDependency, BcmBiaRecord, BcmPlan, ControlRecordLink, GRCUser, ITAsset, NormalizedControl,
    SCFControlState, SoftwareIdentifier, TPRAFourthParty, TPRAMonitoringSignal, TPRAPlatformAlias,
    TPRAVendorLink, TPRAVendorProduct, Vendor, get_db,
)
from ....routers.auth_router import get_user_tenants, require_auth
from . import rbac
from .service import write_audit

# Common spellings of common platforms. A tenant's own aliases take precedence.
BUILT_IN_ALIASES: Dict[str, str] = {
    "amazon web services": "AWS", "aws": "AWS", "amazon aws": "AWS",
    "microsoft azure": "Azure", "azure": "Azure", "windows azure": "Azure",
    "google cloud": "Google Cloud", "google cloud platform": "Google Cloud", "gcp": "Google Cloud",
    "microsoft 365": "Microsoft 365", "office 365": "Microsoft 365", "o365": "Microsoft 365", "m365": "Microsoft 365",
    "google workspace": "Google Workspace", "g suite": "Google Workspace", "gsuite": "Google Workspace",
    "salesforce": "Salesforce", "salesforce.com": "Salesforce",
    "cloudflare": "Cloudflare", "akamai": "Akamai", "fastly": "Fastly", "stripe": "Stripe",
    "twilio": "Twilio", "sendgrid": "Twilio SendGrid", "twilio sendgrid": "Twilio SendGrid",
    "okta": "Okta", "auth0": "Auth0", "mongodb": "MongoDB", "mongodb atlas": "MongoDB",
    "snowflake": "Snowflake", "datadog": "Datadog", "github": "GitHub", "atlassian": "Atlassian",
    "slack": "Slack", "zendesk": "Zendesk", "hubspot": "HubSpot", "digitalocean": "DigitalOcean",
    "digital ocean": "DigitalOcean", "oracle cloud": "Oracle Cloud", "ibm cloud": "IBM Cloud", "heroku": "Heroku",
}
# Names that describe nothing in particular; never counted towards concentration.
GENERIC = {"linux", "windows", "microsoft windows", "internal", "in house", "in-house", "n/a", "na", "none",
           "various", "multiple", "tbc", "tbd", "unknown", "other"}
_SUFFIXES = {"inc", "ltd", "llc", "limited", "corp", "corporation", "plc", "gmbh", "co", "company", "sa", "ag", "bv"}
_INACTIVE = ("retired", "offboarded", "inactive", "terminated")


def normalise(name: str) -> str:
    text = re.sub(r"\(.*?\)", " ", (name or "").lower())
    words = [w for w in re.split(r"[^a-z0-9.]+", text) if w and w.strip(".")]
    words = [w.strip(".") if w.strip(".") in _SUFFIXES else w for w in words]
    return " ".join(w for w in words if w not in _SUFFIXES)


def tenant_aliases(db: Session, tenant_id: int) -> Dict[str, TPRAPlatformAlias]:
    return {a.alias: a for a in db.query(TPRAPlatformAlias).filter(TPRAPlatformAlias.tenant_id == tenant_id)}


def platform_for(name: str, aliases: Dict[str, TPRAPlatformAlias]) -> str:
    """The platform a name means, or "" when it means nothing countable."""
    key = normalise(name)
    if not key:
        return ""
    own = aliases.get(key)
    if own is not None:
        return "" if own.excluded else (own.platform or "")
    if key in GENERIC:
        return ""
    if key in BUILT_IN_ALIASES:
        return BUILT_IN_ALIASES[key]
    cleaned = re.sub(r"\s+", " ", re.sub(r"\(.*?\)", " ", name or "")).strip()
    return cleaned[:120]


def concentration(db: Session, tenant_id: int, min_vendors: int = 2) -> List[dict]:
    """Platforms that several of our vendors depend on, most shared first."""
    aliases = tenant_aliases(db, tenant_id)
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id, Vendor.deleted_at.is_(None))
               if (v.status or "").lower() not in _INACTIVE}
    groups: Dict[str, dict] = {}

    def note(platform: str, vendor: Vendor, via: str, critical: bool):
        group = groups.setdefault(platform.lower(), {"platform": platform, "vendors": {}, "direct_vendor_id": None})
        entry = group["vendors"].setdefault(vendor.id, {"id": vendor.id, "name": vendor.name, "tier": vendor.tier,
                                                        "via": [], "critical_dependency": False})
        entry["via"].append(via)
        entry["critical_dependency"] = entry["critical_dependency"] or critical

    for fp in db.query(TPRAFourthParty).filter(TPRAFourthParty.tenant_id == tenant_id,
                                               TPRAFourthParty.deleted_at.is_(None),
                                               TPRAFourthParty.platform != ""):
        vendor = vendors.get(fp.vendor_id)
        if vendor is not None:
            note(fp.platform, vendor, f"fourth party: {fp.service or fp.name}", bool(fp.critical))
    for vendor in vendors.values():                  # a platform we contract with directly
        platform = platform_for(vendor.name, aliases)
        if platform and platform.lower() in groups:
            groups[platform.lower()]["direct_vendor_id"] = vendor.id

    out = []
    for group in groups.values():
        listed = sorted(group["vendors"].values(), key=lambda e: (not e["critical_dependency"], e["name"] or ""))
        if len(listed) < min_vendors:
            continue
        out.append({
            "platform": group["platform"], "vendor_count": len(listed),
            "critical_count": sum(1 for e in listed if e["critical_dependency"] or (e["tier"] or "").lower() == "critical"),
            "direct_vendor_id": group["direct_vendor_id"], "vendors": listed,
        })
    return sorted(out, key=lambda g: (-g["vendor_count"], -g["critical_count"], g["platform"].lower()))


TARGET_TYPES = ("asset", "bia_process")


def _same(name: Optional[str], key: str, platform: str, aliases: Dict[str, TPRAPlatformAlias]) -> bool:
    n = normalise(name or "")
    return bool(n) and (n == key or (bool(platform) and platform_for(name or "", aliases).lower() == platform))


def impact(db: Session, tenant_id: int, vendor: Vendor) -> dict:
    """What depends on this vendor, gathered from the rest of the platform."""
    from .adverse_media import core_name

    aliases = tenant_aliases(db, tenant_id)
    key, platform = normalise(vendor.name), platform_for(vendor.name, aliases).lower()
    core = core_name(vendor.name)
    links = db.query(TPRAVendorLink).filter(TPRAVendorLink.vendor_id == vendor.id,
                                            TPRAVendorLink.tenant_id == tenant_id).all()
    linked = {(ln.target_type, ln.target_id): ln for ln in links}

    # Assets: linked, and those whose free-text vendor or manufacturer names this vendor.
    asset_ids = [tid for (t, tid) in linked if t == "asset"]
    candidates = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id, or_(
        ITAsset.id.in_(asset_ids or [-1]),
        ITAsset.vendor.ilike(f"%{core}%") if core else False,
        ITAsset.manufacturer.ilike(f"%{core}%") if core else False)).limit(500).all()
    assets = []
    for a in candidates:
        link = linked.get(("asset", a.id))
        if link is None and not (_same(a.vendor, key, platform, aliases) or _same(a.manufacturer, key, platform, aliases)):
            continue
        assets.append({"id": a.id, "name": a.name, "type": a.asset_type, "criticality": a.criticality,
                       "business_function": a.business_function, "linked": link is not None,
                       "link_id": link.id if link else None, "relation": link.relation if link else None})

    # Where its software runs on our estate: CPE vendors from its watched products or its own name.
    products = db.query(TPRAVendorProduct).filter(TPRAVendorProduct.vendor_id == vendor.id).all()
    cpe_vendors = {(p.cpe_vendor or "").lower() for p in products if p.cpe_vendor} | {core.replace(" ", "_")}
    software = (db.query(SoftwareIdentifier.asset_id, SoftwareIdentifier.product, SoftwareIdentifier.version)
                .filter(SoftwareIdentifier.tenant_id == tenant_id,
                        func.lower(SoftwareIdentifier.vendor).in_(list(cpe_vendors - {""}) or ["-"])).all())
    detected = db.query(ITAsset.id, ITAsset.detected_software_json).filter(
        ITAsset.tenant_id == tenant_id, cast(ITAsset.detected_software_json, String).ilike(f"%{core}%") if core else False
    ).limit(2000).all()
    running = {aid for aid, _, _ in software}
    for aid, items in detected:
        if any(_same((i or {}).get("publisher"), key, platform, aliases) for i in (items or []) if isinstance(i, dict)):
            running.add(aid)

    # Controls linked to it, and controls it provides under shared responsibility.
    controls = {}
    nc_ids = [ln.normalized_control_id for ln in db.query(ControlRecordLink).filter(
        ControlRecordLink.record_type == "vendor", ControlRecordLink.record_id == vendor.id)]
    for nc in db.query(NormalizedControl).filter(NormalizedControl.id.in_(nc_ids or [-1])):
        if nc.tenant_id in (None, tenant_id):
            controls[nc.scf_id or nc.code] = {"code": nc.scf_id or nc.code, "title": nc.name, "how": "linked to this vendor"}
    for state in db.query(SCFControlState).filter(SCFControlState.tenant_id == tenant_id,
                                                  SCFControlState.provider_vendor_id == vendor.id):
        controls.setdefault(state.scf_id, {"code": state.scf_id, "title": None,
                                           "how": f"provided by this vendor ({state.inheritance_type or 'shared'})"})
    missing_titles = [c["code"] for c in controls.values() if not c["title"]]
    if missing_titles:
        for nc in db.query(NormalizedControl).filter(NormalizedControl.scf_id.in_(missing_titles)):
            if controls.get(nc.scf_id) and not controls[nc.scf_id]["title"]:
                controls[nc.scf_id]["title"] = nc.name

    # Continuity: processes linked to it, or with a vendor dependency that names it.
    bia_ids = {tid for (t, tid) in linked if t == "bia_process"}
    named = {}
    for dep in db.query(BcmBiaDependency).filter(BcmBiaDependency.tenant_id == tenant_id,
                                                 BcmBiaDependency.dependency_type == "vendor"):
        if _same(dep.name, key, platform, aliases):
            named[dep.bia_id] = dep
    processes = []
    for bia, plan in (db.query(BcmBiaRecord, BcmPlan).outerjoin(BcmPlan, BcmPlan.id == BcmBiaRecord.plan_id)
                      .filter(BcmBiaRecord.tenant_id == tenant_id,
                              BcmBiaRecord.id.in_(list(bia_ids | set(named)) or [-1]))):
        dep = named.get(bia.id)
        processes.append({
            "id": bia.id, "process": bia.process_name, "plan": plan.title if plan else None,
            "plan_id": plan.id if plan else None, "criticality": bia.criticality_rating,
            "rto_hours": bia.rto_hours, "rpo_hours": bia.rpo_hours, "mtpd_hours": bia.mtpd_hours,
            "linked": bia.id in bia_ids, "named_as_dependency": dep is not None,
            "vendor_bcp": dep.external_bcp_status if dep else None,
            "link_id": linked[("bia_process", bia.id)].id if bia.id in bia_ids else None,
        })
    processes.sort(key=lambda p: (p["rto_hours"] is None, p["rto_hours"] or 0))

    fourth = db.query(TPRAFourthParty).filter(TPRAFourthParty.vendor_id == vendor.id,
                                              TPRAFourthParty.tenant_id == tenant_id,
                                              TPRAFourthParty.deleted_at.is_(None)).order_by(TPRAFourthParty.name)
    shared = [{"platform": g["platform"], "vendor_count": g["vendor_count"]}
              for g in concentration(db, tenant_id, 2) if any(v["id"] == vendor.id for v in g["vendors"])]
    rtos = [p["rto_hours"] for p in processes if p["rto_hours"] is not None]
    return {
        "vendor_id": vendor.id,
        "assets": assets, "assets_running_its_software": len(running),
        "controls": sorted(controls.values(), key=lambda c: c["code"] or ""),
        "processes": processes, "shortest_rto_hours": min(rtos) if rtos else None,
        "fourth_parties": [s_fourth_party(fp) for fp in fourth],
        "shared_platforms": shared,
        "products": [s_product(p) for p in products],
    }


def s_product(p: TPRAVendorProduct) -> dict:
    return {"id": p.id, "vendor_id": p.vendor_id, "name": p.name, "cpe_vendor": p.cpe_vendor,
            "cpe_product": p.cpe_product}


def shared_vulnerabilities(db: Session, tenant_id: int, days: int = 90) -> List[dict]:
    """Known-exploited vulnerabilities in watched products, each with every vendor it affects."""
    from datetime import datetime, timedelta

    since = datetime.utcnow() - timedelta(days=days)
    groups: Dict[str, dict] = {}
    for sig, vendor in (db.query(TPRAMonitoringSignal, Vendor).join(Vendor, Vendor.id == TPRAMonitoringSignal.vendor_id)
                        .filter(TPRAMonitoringSignal.tenant_id == tenant_id,
                                TPRAMonitoringSignal.deleted_at.is_(None),
                                TPRAMonitoringSignal.signal_type == "vulnerability",
                                TPRAMonitoringSignal.external_id.like("kev:%"),
                                TPRAMonitoringSignal.occurred_at >= since)):
        cve = sig.external_id.split(":", 1)[1]
        group = groups.setdefault(cve, {"cve": cve, "title": sig.title, "severity": sig.severity,
                                        "occurred_at": sig.occurred_at.isoformat() if sig.occurred_at else None,
                                        "vendors": []})
        group["vendors"].append({"id": vendor.id, "name": vendor.name, "tier": vendor.tier, "signal_id": sig.id,
                                 "acknowledged": bool(sig.acknowledged)})
    return sorted(groups.values(), key=lambda g: (-len(g["vendors"]), g["occurred_at"] or ""), reverse=False)


# ── REST ─────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/tpra", tags=["TPRA Vendor Graph"])


def _tenant(db: Session, user: GRCUser) -> int:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(403, "No tenant context")
    return tids[0]


def _vendor(db: Session, tenant_id: int, vendor_id: int) -> Vendor:
    v = db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id == tenant_id,
                                Vendor.deleted_at.is_(None)).first()
    if v is None:
        raise HTTPException(404, "Vendor not found")
    return v


class FourthPartyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    service: Optional[str] = Field(None, max_length=2000)
    data_shared: List[str] = Field(default_factory=list, max_length=30)
    location: Optional[str] = Field(None, max_length=120)
    critical: bool = False
    source: str = Field("manual", pattern="^(manual|declared|questionnaire)$")
    notes: Optional[str] = Field(None, max_length=4000)


def s_fourth_party(fp: TPRAFourthParty) -> dict:
    return {"id": fp.id, "vendor_id": fp.vendor_id, "name": fp.name, "platform": fp.platform or None,
            "service": fp.service, "data_shared": fp.data_shared or [], "location": fp.location,
            "critical": bool(fp.critical), "source": fp.source, "also_vendor_id": fp.also_vendor_id,
            "notes": fp.notes, "created_at": fp.created_at.isoformat() if fp.created_at else None}


def _fill(db: Session, fp: TPRAFourthParty, body: FourthPartyIn, tenant_id: int) -> None:
    aliases = tenant_aliases(db, tenant_id)
    fp.name = " ".join(body.name.split())
    fp.platform = platform_for(fp.name, aliases)
    fp.service, fp.location, fp.notes = body.service, body.location, body.notes
    fp.data_shared = [" ".join(str(d).split())[:80] for d in body.data_shared if str(d).strip()]
    fp.critical, fp.source = body.critical, body.source
    # When the fourth party is one of our own vendors too, say so.
    key = normalise(fp.name)
    fp.also_vendor_id = next((v.id for v in db.query(Vendor).filter(Vendor.tenant_id == tenant_id,
                                                                     Vendor.deleted_at.is_(None))
                              if v.id != fp.vendor_id and normalise(v.name) == key), None)


@router.get("/vendors/{vendor_id}/fourth-parties")
def list_fourth_parties(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    _vendor(db, tenant_id, vendor_id)
    rows = db.query(TPRAFourthParty).filter(TPRAFourthParty.vendor_id == vendor_id,
                                            TPRAFourthParty.tenant_id == tenant_id,
                                            TPRAFourthParty.deleted_at.is_(None)).order_by(TPRAFourthParty.name)
    return {"items": [s_fourth_party(fp) for fp in rows]}


@router.post("/vendors/{vendor_id}/fourth-parties", status_code=201)
def add_fourth_party(vendor_id: int, body: FourthPartyIn, db: Session = Depends(get_db),
                     user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    vendor = _vendor(db, tenant_id, vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    fp = TPRAFourthParty(tenant_id=tenant_id, vendor_id=vendor.id, created_by=user.id)
    _fill(db, fp, body, tenant_id)
    db.add(fp)
    db.flush()
    write_audit(db, tenant_id, entity="fourth_party", action="create", vendor_id=vendor.id, entity_id=fp.id,
                actor_id=user.id, to_value=fp.name)
    db.commit()
    return s_fourth_party(fp)


def _fourth_party(db: Session, tenant_id: int, fp_id: int) -> TPRAFourthParty:
    fp = db.query(TPRAFourthParty).filter(TPRAFourthParty.id == fp_id, TPRAFourthParty.tenant_id == tenant_id,
                                          TPRAFourthParty.deleted_at.is_(None)).first()
    if fp is None:
        raise HTTPException(404, "Fourth party not found")
    return fp


@router.put("/fourth-parties/{fp_id}")
def update_fourth_party(fp_id: int, body: FourthPartyIn, db: Session = Depends(get_db),
                        user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    fp = _fourth_party(db, tenant_id, fp_id)
    rbac.require_write(db, user, "vendors", "edit")
    _fill(db, fp, body, tenant_id)
    write_audit(db, tenant_id, entity="fourth_party", action="update", vendor_id=fp.vendor_id, entity_id=fp.id,
                actor_id=user.id, to_value=fp.name)
    db.commit()
    return s_fourth_party(fp)


@router.delete("/fourth-parties/{fp_id}")
def remove_fourth_party(fp_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    from datetime import datetime

    tenant_id = _tenant(db, user)
    fp = _fourth_party(db, tenant_id, fp_id)
    rbac.require_write(db, user, "vendors", "edit")
    fp.deleted_at = datetime.utcnow()
    write_audit(db, tenant_id, entity="fourth_party", action="delete", vendor_id=fp.vendor_id, entity_id=fp.id,
                actor_id=user.id, from_value=fp.name)
    db.commit()
    return {"deleted": True, "id": fp.id}


@router.get("/concentration")
def platform_concentration(min_vendors: int = Query(2, ge=1, le=50), db: Session = Depends(get_db),
                           user: GRCUser = Depends(require_auth)):
    return {"platforms": concentration(db, _tenant(db, user), min_vendors)}


@router.get("/vendors/{vendor_id}/impact")
def vendor_impact(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """What breaks if this vendor fails."""
    tenant_id = _tenant(db, user)
    return impact(db, tenant_id, _vendor(db, tenant_id, vendor_id))


class LinkIn(BaseModel):
    target_type: str = Field(..., pattern="^(asset|bia_process)$")
    target_ids: List[int] = Field(..., min_length=1, max_length=200)
    relation: Optional[str] = Field(None, max_length=60)


@router.post("/vendors/{vendor_id}/links", status_code=201)
def link_targets(vendor_id: int, body: LinkIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Tie the vendor to assets or continuity processes by their own ids; linking twice does nothing."""
    tenant_id = _tenant(db, user)
    vendor = _vendor(db, tenant_id, vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    model = ITAsset if body.target_type == "asset" else BcmBiaRecord
    found = {i for (i,) in db.query(model.id).filter(model.tenant_id == tenant_id, model.id.in_(body.target_ids))}
    missing = sorted(set(body.target_ids) - found)
    if missing:
        raise HTTPException(404, f"Not found: {body.target_type} {', '.join(map(str, missing[:10]))}")
    have = {ln.target_id for ln in db.query(TPRAVendorLink).filter(
        TPRAVendorLink.vendor_id == vendor.id, TPRAVendorLink.target_type == body.target_type,
        TPRAVendorLink.target_id.in_(body.target_ids))}
    added = 0
    for target_id in sorted(found - have):
        db.add(TPRAVendorLink(tenant_id=tenant_id, vendor_id=vendor.id, target_type=body.target_type,
                              target_id=target_id, relation=(body.relation or None), created_by=user.id))
        added += 1
    write_audit(db, tenant_id, entity="vendor_link", action="create", vendor_id=vendor.id, actor_id=user.id,
                to_value=body.target_type, extra={"target_ids": sorted(found - have)})
    db.commit()
    return {"added": added}


@router.delete("/vendor-links/{link_id}")
def unlink_target(link_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    link = db.query(TPRAVendorLink).filter(TPRAVendorLink.id == link_id, TPRAVendorLink.tenant_id == tenant_id).first()
    if link is None:
        raise HTTPException(404, "Link not found")
    rbac.require_write(db, user, "vendors", "edit")
    write_audit(db, tenant_id, entity="vendor_link", action="delete", vendor_id=link.vendor_id, actor_id=user.id,
                from_value=f"{link.target_type}:{link.target_id}")
    db.delete(link)
    db.commit()
    return {"deleted": True, "id": link_id}


@router.get("/link-targets")
def search_link_targets(type: str = Query(..., pattern="^(asset|bia_process)$"), search: str = Query("", max_length=100),
                        db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Assets or continuity processes to link a vendor to, by name."""
    tenant_id = _tenant(db, user)
    term = f"%{search.strip()}%"
    if type == "asset":
        rows = (db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id, ITAsset.name.ilike(term))
                .order_by(ITAsset.name).limit(25))
        return {"items": [{"id": a.id, "label": a.name, "detail": a.asset_type} for a in rows]}
    rows = (db.query(BcmBiaRecord, BcmPlan).outerjoin(BcmPlan, BcmPlan.id == BcmBiaRecord.plan_id)
            .filter(BcmBiaRecord.tenant_id == tenant_id, BcmBiaRecord.process_name.ilike(term))
            .order_by(BcmBiaRecord.process_name).limit(25))
    return {"items": [{"id": b.id, "label": b.process_name,
                       "detail": f"{plan.title if plan else 'no plan'} · RTO {b.rto_hours if b.rto_hours is not None else '?'}h"}
                      for b, plan in rows]}


class ProductIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    cpe_vendor: Optional[str] = Field(None, max_length=120)
    cpe_product: Optional[str] = Field(None, max_length=120)


@router.get("/vendors/{vendor_id}/products")
def list_products(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    _vendor(db, tenant_id, vendor_id)
    return {"items": [s_product(p) for p in db.query(TPRAVendorProduct).filter(
        TPRAVendorProduct.vendor_id == vendor_id).order_by(TPRAVendorProduct.name)]}


@router.post("/vendors/{vendor_id}/products", status_code=201)
def watch_product(vendor_id: int, body: ProductIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Watch one of the vendor's products for known-exploited vulnerabilities."""
    tenant_id = _tenant(db, user)
    vendor = _vendor(db, tenant_id, vendor_id)
    rbac.require_write(db, user, "vendors", "edit")
    clean = lambda v: re.sub(r"[^a-z0-9_.\-]", "_", (v or "").strip().lower())[:120] or None  # noqa: E731
    product = TPRAVendorProduct(tenant_id=tenant_id, vendor_id=vendor.id, name=" ".join(body.name.split()),
                                cpe_vendor=clean(body.cpe_vendor), cpe_product=clean(body.cpe_product),
                                created_by=user.id)
    if db.query(TPRAVendorProduct.id).filter(TPRAVendorProduct.vendor_id == vendor.id,
                                             TPRAVendorProduct.cpe_vendor == product.cpe_vendor,
                                             TPRAVendorProduct.cpe_product == product.cpe_product,
                                             TPRAVendorProduct.name == product.name).first():
        raise HTTPException(409, "That product is already watched")
    db.add(product)
    db.flush()
    write_audit(db, tenant_id, entity="vendor_product", action="create", vendor_id=vendor.id, entity_id=product.id,
                actor_id=user.id, to_value=product.name)
    db.commit()
    return s_product(product)


@router.delete("/vendor-products/{product_id}")
def unwatch_product(product_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    product = db.query(TPRAVendorProduct).filter(TPRAVendorProduct.id == product_id,
                                                 TPRAVendorProduct.tenant_id == tenant_id).first()
    if product is None:
        raise HTTPException(404, "Product not found")
    rbac.require_write(db, user, "vendors", "edit")
    write_audit(db, tenant_id, entity="vendor_product", action="delete", vendor_id=product.vendor_id,
                entity_id=product.id, actor_id=user.id, from_value=product.name)
    db.delete(product)
    db.commit()
    return {"deleted": True, "id": product_id}


@router.get("/concentration/vulnerabilities")
def vulnerabilities_across_vendors(days: int = Query(90, ge=1, le=365), db: Session = Depends(get_db),
                                   user: GRCUser = Depends(require_auth)):
    """Each known-exploited vulnerability in watched products, with every vendor it affects."""
    return {"vulnerabilities": shared_vulnerabilities(db, _tenant(db, user), days)}


class AliasIn(BaseModel):
    alias: str = Field(..., min_length=1, max_length=200)
    platform: Optional[str] = Field(None, max_length=120)
    excluded: bool = False


@router.get("/platform-aliases")
def list_aliases(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    rows = tenant_aliases(db, _tenant(db, user)).values()
    return {"items": [{"id": a.id, "alias": a.alias, "platform": a.platform, "excluded": bool(a.excluded)}
                      for a in sorted(rows, key=lambda a: a.alias)],
            "built_in": BUILT_IN_ALIASES, "generic": sorted(GENERIC)}


@router.post("/platform-aliases", status_code=201)
def add_alias(body: AliasIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    rbac.require_write(db, user, "config", "edit")
    key = normalise(body.alias)
    platform = " ".join((body.platform or "").split())
    if not key or (not body.excluded and not platform):
        raise HTTPException(400, "Give the name as written and the platform it means, or exclude it")
    row = tenant_aliases(db, tenant_id).get(key) or TPRAPlatformAlias(tenant_id=tenant_id, alias=key)
    row.platform, row.excluded = (None if body.excluded else platform), body.excluded
    db.add(row)
    # Refold existing fourth parties so concentration reflects the new alias at once.
    aliases = {**tenant_aliases(db, tenant_id), key: row}
    for fp in db.query(TPRAFourthParty).filter(TPRAFourthParty.tenant_id == tenant_id,
                                               TPRAFourthParty.deleted_at.is_(None)):
        fp.platform = platform_for(fp.name, aliases)
    db.commit()
    return {"id": row.id, "alias": row.alias, "platform": row.platform, "excluded": bool(row.excluded)}


@router.delete("/platform-aliases/{alias_id}")
def remove_alias(alias_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tenant_id = _tenant(db, user)
    rbac.require_write(db, user, "config", "edit")
    row = db.query(TPRAPlatformAlias).filter(TPRAPlatformAlias.id == alias_id,
                                             TPRAPlatformAlias.tenant_id == tenant_id).first()
    if row is None:
        raise HTTPException(404, "Alias not found")
    db.delete(row)
    db.flush()
    aliases = tenant_aliases(db, tenant_id)
    for fp in db.query(TPRAFourthParty).filter(TPRAFourthParty.tenant_id == tenant_id,
                                               TPRAFourthParty.deleted_at.is_(None)):
        fp.platform = platform_for(fp.name, aliases)
    db.commit()
    return {"deleted": True, "id": alias_id}
