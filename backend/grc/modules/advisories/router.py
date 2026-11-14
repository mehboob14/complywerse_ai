"""Advisory module API.

Sprint 1 scope: manual create (title + CVE list), list, detail, delete. Each
CVE is bridged into the general Vulnerability pipeline on create. Applicability
cross-check + rollup endpoints arrive in Sprint 2.

Mounted by the app via ``from grc.modules.advisories.router import router``.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import GRCUser, get_db, ITAsset, Vulnerability, VulnerabilityAssetLink
from ...routers.auth_router import (
    require_auth,
    get_user_primary_tenant,
    get_user_tenants,
)
from .models import (
    Advisory, AdvisoryCve, AdvisorySource, AdvisoryAssetApplicability, AdvisoryMatchSession,
)
from .service import normalise_severity
from .applicability import recheck_advisory, _default_scope_ids, _register_finding_details
from .extraction import extract_from_pdf
from .sources import list_sources
from .scrapers import list_pdf_sources
from .sync import sync_source
from .ingest import store_pdf, create_pending_advisory, scrape_source
from .pipeline import pipeline_view
from .events import record_event, history_for
from .regions import classify_region, normalize_region, CANONICAL_REGIONS, UNCLASSIFIED

router = APIRouter(prefix="/advisories", tags=["Advisories"])
logger = logging.getLogger(__name__)


# ─── Schemas ────────────────────────────────────────────────────────────────

class AdvisoryCveIn(BaseModel):
    cve_id: str
    affected_product: Optional[str] = None
    affected_versions: Optional[str] = None


class AdvisoryCreate(BaseModel):
    title: str
    external_id: Optional[str] = None
    summary: Optional[str] = None
    severity: Optional[str] = None
    url: Optional[str] = None
    source_id: Optional[int] = None
    cves: List[AdvisoryCveIn] = []


class AdvisoryConfirm(BaseModel):
    severity: Optional[str] = None
    cves: List[AdvisoryCveIn] = []


class RecheckScope(BaseModel):
    """Which assets to match the advisory's CVEs against."""
    mode: Optional[str] = None            # all | scope | assets (informational)
    ctem_scope_id: Optional[int] = None   # a saved CTEM asset set
    asset_ids: Optional[List[int]] = None  # a hand-picked set


class RegionIn(BaseModel):
    region: str


class MatchRequest(BaseModel):
    """Selection-driven match: advisories (all their CVEs) and/or specific CVE
    rows, against a scope of assets (all scanned assets, or a hand-picked set)."""
    advisory_ids: List[int] = []
    cve_ids: List[int] = []            # AdvisoryCve.id values
    mode: str = "all"                  # all | assets
    asset_ids: List[int] = []
    label: Optional[str] = None


# ─── Serialisation ──────────────────────────────────────────────────────────

def _cve_to_dict(c: AdvisoryCve, bridged: Optional[Vulnerability] = None,
                 asset_names: Optional[Dict[int, str]] = None) -> Dict[str, Any]:
    applic = list(c.applicability)
    affected = [a.asset_id for a in applic if a.verdict == "affected"]
    not_affected = [a.asset_id for a in applic if a.verdict == "not_affected"]
    names = asset_names or {}
    # Context the operator asked for per-CVE: the human title, description and
    # severity. These live on the bridged register Vulnerability (NVD-enriched).
    title = description = severity = None
    cvss = None
    kev = False
    if bridged is not None:
        title = bridged.title
        description = bridged.description
        severity = bridged.severity
        cvss = bridged.cvss_score
        kev = bool(bridged.kev_flag)
    return {
        "id": c.id,
        "cve_id": c.cve_id,
        "title": title,
        "description": description,
        "severity": severity,
        "cvss_score": cvss,
        "kev": kev,
        "affected_product": c.affected_product,
        "affected_versions": c.affected_versions,
        "bridged_vulnerability_id": c.bridged_vulnerability_id,
        "applicability": {
            "affected_count": len(affected),
            "not_affected_count": len(not_affected),
            "affected_asset_ids": affected,
            "affected_assets": [{"id": aid, "name": names.get(aid, f"asset #{aid}")} for aid in affected],
            "not_affected_asset_ids": not_affected,
            "rows": [
                {"asset_id": a.asset_id, "verdict": a.verdict, "evidence": a.evidence}
                for a in applic
            ],
        },
    }


def _advisory_to_dict(a: Advisory, *, with_cves: bool = False,
                      bridged_map: Optional[Dict[int, Vulnerability]] = None,
                      asset_names: Optional[Dict[int, str]] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "id": a.id,
        "external_id": a.external_id,
        "title": a.title,
        "summary": a.summary,
        "severity": a.severity,
        "url": a.url,
        "status": a.status,
        "source_id": a.source_id,
        "cve_count": len(a.cves),
        "asset_affected_count": a.asset_affected_count or 0,
        "asset_total_count": a.asset_total_count or 0,
        "published_at": a.published_at.isoformat() if a.published_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    if with_cves:
        bmap = bridged_map or {}
        out["cves"] = [_cve_to_dict(c, bmap.get(c.bridged_vulnerability_id), asset_names) for c in a.cves]
        out["flow"] = pipeline_view(a)  # lifecycle stages: Ingest→Parse→Review→Match→Remediate
        out["extraction"] = a.extraction_meta  # multi-stage parser report (PDF-sourced)
    return out


def _summary(advisories: List[Advisory]) -> Dict[str, int]:
    counts = {"total": len(advisories), "open": 0, "resolved": 0,
              "not_applicable": 0, "pending": 0}
    for a in advisories:
        counts[a.status] = counts.get(a.status, 0) + 1
    return counts


def _region_by_source_name() -> Dict[str, str]:
    from .sources import SOURCE_REGISTRY
    from .scrapers import PDF_SOURCE_REGISTRY
    out: Dict[str, str] = {}
    for v in SOURCE_REGISTRY.values():
        out[v["name"]] = v.get("region", "Global")
    for v in PDF_SOURCE_REGISTRY.values():
        out[v["name"]] = v["region"]
    return out


def _annotate_sources(dicts: List[Dict[str, Any]], advisories: List[Advisory],
                      db: Session, tenant_id: int) -> None:
    """Add source_name + region to each advisory dict (one query, no N+1) so the
    UI can filter by source and region."""
    ids = {a.source_id for a in advisories if a.source_id}
    sources: Dict[int, AdvisorySource] = {}
    if ids:
        for s in (db.query(AdvisorySource)
                  .filter(AdvisorySource.tenant_id == tenant_id, AdvisorySource.id.in_(ids)).all()):
            sources[s.id] = s
    region_map = _region_by_source_name()
    for d, a in zip(dicts, advisories):
        src = sources.get(a.source_id) if a.source_id else None
        meta = a.extraction_meta if isinstance(a.extraction_meta, dict) else {}
        if src:
            # Has a source → auto-fetched (API feed or scraped site) = "synced".
            # Region is the source's fixed region.
            d["source_name"] = src.name
            d["region"] = region_map.get(src.name) or UNCLASSIFIED
            d["origin"] = "sync"
        elif a.raw_file_path:
            # Operator-uploaded PDF: region is the LLM-classified country (stored
            # in extraction_meta); unclassified until it's recognised or picked.
            d["source_name"] = "Uploaded document"
            d["region"] = normalize_region(meta.get("region")) or UNCLASSIFIED
            d["origin"] = "upload"
        else:
            d["source_name"] = "Manual entry"
            d["region"] = UNCLASSIFIED
            d["origin"] = "manual"


def _resolve_scope_ids(db: Session, tenant_id: int,
                       body: Optional["RecheckScope"]) -> Optional[Set[int]]:
    """Turn the chosen match scope into asset ids. None → the matcher's default
    scope (every asset that has a real register finding)."""
    if not body:
        return None
    if body.asset_ids:
        return set(body.asset_ids)
    if body.ctem_scope_id:
        from ...models import CtemScope
        from ...services.ctem_scopes import resolve_scope_assets
        scope = (db.query(CtemScope)
                 .filter(CtemScope.id == body.ctem_scope_id, CtemScope.tenant_id == tenant_id)
                 .first())
        if not scope:
            raise HTTPException(status_code=404, detail="CTEM scope not found")
        return set(resolve_scope_assets(db, tenant_id, scope.membership_rule))
    return None


def _get_or_404(advisory_id: int, tenant_id: int, db: Session) -> Advisory:
    adv = db.query(Advisory).filter(
        Advisory.id == advisory_id,
        Advisory.tenant_id == tenant_id,
    ).first()
    if not adv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Advisory not found")
    return adv


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("")
def list_advisories(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    advisories = (
        db.query(Advisory)
        .filter(Advisory.tenant_id == tenant_id)
        .order_by(Advisory.id.desc())
        .all()
    )
    dicts = [_advisory_to_dict(a) for a in advisories]
    _annotate_sources(dicts, advisories, db, tenant_id)
    return {"advisories": dicts, "summary": _summary(advisories)}


@router.post("")
def create_advisory(
    body: AdvisoryCreate,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)

    advisory = Advisory(
        tenant_id=tenant_id,
        source_id=body.source_id,
        external_id=body.external_id,
        title=body.title,
        summary=body.summary,
        severity=normalise_severity(body.severity) if body.severity else None,
        url=body.url,
        status="open",
        created_by=user.id,
    )
    db.add(advisory)
    db.flush()  # populate advisory.id for the CVE FK + bridge

    # De-dup CVE ids within the submitted advisory (keep first occurrence).
    seen: set = set()
    for item in body.cves:
        cve = (item.cve_id or "").strip().upper()
        if not cve or cve in seen:
            continue
        seen.add(cve)
        cve_row = AdvisoryCve(
            tenant_id=tenant_id,
            advisory_id=advisory.id,
            cve_id=cve,
            affected_product=item.affected_product,
            affected_versions=item.affected_versions,
        )
        db.add(cve_row)
        db.flush()

    record_event(db, tenant_id=tenant_id, advisory_id=advisory.id, event="ingested", actor=user,
                 detail={"origin": "manual", "cves": len(seen)})
    db.commit()
    db.refresh(advisory)
    return _advisory_to_dict(advisory, with_cves=True)


@router.post("/upload")
async def upload_advisory(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Upload an advisory PDF. Extracts proposed CVEs and creates a PENDING
    advisory for human review — nothing is tracked until it is confirmed."""
    tenant_id = get_user_primary_tenant(user, db)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF advisories are supported")

    content = await file.read()
    stored_path = store_pdf(content)

    # The parser must never fail an upload. extract_from_pdf is built not to raise,
    # but on ANY extraction/classification error we still file a minimal pending
    # advisory (title from the filename, no CVEs) the operator can complete by
    # hand — so an upload always lands and flows through the same region/year/month
    # hierarchy as a synced one, never a 500.
    try:
        extracted = extract_from_pdf(content, filename=file.filename or "")
        region = classify_region(
            title=extracted.get("title") or "", summary=extracted.get("summary") or "",
            external_id=extracted.get("external_id") or "", filename=file.filename or "",
            text=extracted.get("text_sample") or "",
        )
        if isinstance(extracted.get("extraction"), dict):
            extracted["extraction"]["region"] = region.get("region")
            extracted["extraction"]["region_confidence"] = region.get("confidence")
    except Exception:
        logger.exception("advisory upload: extraction failed; filing a minimal pending advisory")
        extracted = {
            "title": os.path.splitext(file.filename or "")[0] or "Uploaded advisory",
            "summary": None, "severity": None, "external_id": None,
            "published_at": None, "cves": [], "ai_used": False,
            "extraction": {"method": "failed", "confidence": "low", "stages": [],
                           "warnings": ["Automatic parsing failed — review the PDF and add CVEs by hand."]},
        }

    advisory = create_pending_advisory(
        db, tenant_id=tenant_id, extracted=extracted,
        raw_file_path=stored_path, created_by=user.id,
    )
    meta_x = extracted.get("extraction") or {}
    record_event(db, tenant_id=tenant_id, advisory_id=advisory.id, event="ingested", actor=user,
                 detail={"origin": "upload", "filename": file.filename,
                         "method": meta_x.get("method"), "confidence": meta_x.get("confidence"),
                         "cves": len(advisory.cves)})
    db.commit()
    db.refresh(advisory)
    return {
        "advisory": _advisory_to_dict(advisory, with_cves=True),
        "extraction": {
            "ai_used": extracted.get("ai_used", False),
            "ocr_used": extracted.get("ocr_used", False),
            "text_chars": extracted.get("text_chars", 0),
            "cve_count": len(advisory.cves),
            # multi-stage pipeline report: method, confidence, warnings, stages
            **(extracted.get("extraction") or {}),
        },
    }


@router.get("/sources")
def get_sources(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Available API advisory sources (declared before /{advisory_id} so the
    literal 'sources' path isn't parsed as an id)."""
    get_user_primary_tenant(user, db)  # authz only
    return {"sources": list_sources()}


@router.post("/sources/{key}/sync")
def sync_source_now(
    key: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Pull the latest advisories from one API source and upsert them."""
    tenant_id = get_user_primary_tenant(user, db)
    try:
        summary = sync_source(db, tenant_id=tenant_id, key=key, limit=min(max(limit, 1), 100), actor=user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return summary


@router.get("/pdf-sources")
def get_pdf_sources(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Regional CERT PDF sources (Pakistan + Middle East). ``auto=True`` means an
    auto-scraper is wired; ``auto=False`` means upload the PDF (same parser)."""
    get_user_primary_tenant(user, db)  # authz only
    return {"sources": list_pdf_sources()}


@router.post("/pdf-sources/{key}/scrape")
def scrape_pdf_source_now(
    key: str,
    limit: int = 15,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Scrape a CERT's PDF listing → download each new PDF → run the multi-stage
    extractor → file as a PENDING advisory for human review. ``limit`` bounds how
    many documents a single run pulls (each new PDF runs the vision pass)."""
    tenant_id = get_user_primary_tenant(user, db)
    try:
        return scrape_source(db, tenant_id=tenant_id, key=key, limit=min(max(limit, 1), 50), actor=user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/regions")
def list_regions(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Canonical region list (hardcoded) for the filter + manual pick. Declared
    before /{advisory_id} so 'regions' isn't parsed as an id."""
    get_user_primary_tenant(user, db)  # authz only
    return {"regions": CANONICAL_REGIONS}


@router.post("/reclassify-uploads")
def reclassify_uploads(
    force: bool = False,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Backfill: run the LLM region classifier over uploaded advisories that never
    got a region (uploaded before the classifier existed). ``force=True`` re-runs
    it over every upload, overwriting the stored region."""
    tenant_id = get_user_primary_tenant(user, db)
    from .extraction import _fitz_text
    advs = (
        db.query(Advisory)
        .filter(Advisory.tenant_id == tenant_id,
                Advisory.raw_file_path.isnot(None),
                Advisory.source_id.is_(None))
        .all()
    )
    updated = 0
    for a in advs:
        meta = dict(a.extraction_meta) if isinstance(a.extraction_meta, dict) else {}
        if not force and normalize_region(meta.get("region")):
            continue  # already classified
        text = ""
        try:
            with open(a.raw_file_path, "rb") as fh:
                text = (_fitz_text(fh.read()).get("text") or "")[:3000]
        except Exception:
            logger.info("reclassify: could not read %s", a.raw_file_path)
        res = classify_region(title=a.title or "", summary=a.summary or "",
                              external_id=a.external_id or "", filename="", text=text)
        if res.get("region"):
            meta["region"] = res["region"]
            meta["region_confidence"] = res["confidence"]
            a.extraction_meta = meta
            updated += 1
    db.commit()
    return {"candidates": len(advs), "updated": updated}


@router.get("/affected-assets")
def affected_assets(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Which assets are affected across all advisories (the KPI drill-down).
    Aggregated from the applicability rows (verdict=affected), grouped by asset."""
    tenant_id = get_user_primary_tenant(user, db)
    rows = (
        db.query(AdvisoryAssetApplicability.asset_id, AdvisoryCve.cve_id,
                 Advisory.id, Advisory.title)
        .join(AdvisoryCve, AdvisoryAssetApplicability.advisory_cve_id == AdvisoryCve.id)
        .join(Advisory, AdvisoryCve.advisory_id == Advisory.id)
        .filter(AdvisoryAssetApplicability.tenant_id == tenant_id,
                AdvisoryAssetApplicability.verdict == "affected")
        .all()
    )
    by_asset: Dict[int, Dict[str, Any]] = {}
    for asset_id, cve_id, adv_id, adv_title in rows:
        g = by_asset.setdefault(asset_id, {"asset_id": asset_id, "items": []})
        g["items"].append({"advisory_id": adv_id, "advisory_title": adv_title, "cve_id": cve_id})
    if by_asset:
        assets = {a.id: a for a in db.query(ITAsset)
                  .filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(by_asset.keys())).all()}
        for aid, g in by_asset.items():
            a = assets.get(aid)
            g["asset_name"] = a.name if a else f"asset #{aid}"
            g["host"] = (a.host_name or a.ip_address) if a else None
    result = sorted(by_asset.values(), key=lambda g: -len(g["items"]))
    return {"assets": result, "total": len(result)}


_SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@router.get("/by-asset/{asset_id}")
def advisories_by_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Advisories that affect ONE asset (applicability verdict=affected) — powers
    the asset-detail 'Advisories' tab. Most-severe first, then most-recently
    checked. 200 with {items:[], total:0} when the asset has no advisory match."""
    tenant_id = get_user_primary_tenant(user, db)
    rows = (
        db.query(
            AdvisoryAssetApplicability.checked_at.label("checked_at"),
            AdvisoryCve.cve_id.label("cve_id"),
            Advisory.id.label("advisory_id"),
            Advisory.title.label("advisory_title"),
            Advisory.severity.label("advisory_severity"),
            Advisory.url.label("url"),
            Advisory.source_id.label("source_id"),
            Advisory.raw_file_path.label("raw_file_path"),
            Advisory.extraction_meta.label("extraction_meta"),
        )
        .join(AdvisoryCve, AdvisoryAssetApplicability.advisory_cve_id == AdvisoryCve.id)
        .join(Advisory, AdvisoryCve.advisory_id == Advisory.id)
        .filter(
            AdvisoryAssetApplicability.tenant_id == tenant_id,
            AdvisoryAssetApplicability.asset_id == asset_id,
            AdvisoryAssetApplicability.verdict == "affected",
        )
        .all()
    )

    # Region isn't a column: synced advisories take it from their source, uploads
    # from extraction_meta (same rule as the list endpoint).
    region_map = _region_by_source_name()
    src_ids = {r.source_id for r in rows if r.source_id}
    src_names = ({s.id: s.name for s in db.query(AdvisorySource.id, AdvisorySource.name)
                  .filter(AdvisorySource.tenant_id == tenant_id, AdvisorySource.id.in_(src_ids)).all()}
                 if src_ids else {})

    def _region(r) -> Optional[str]:
        if r.source_id:
            return region_map.get(src_names.get(r.source_id)) or UNCLASSIFIED
        if r.raw_file_path:
            meta = r.extraction_meta if isinstance(r.extraction_meta, dict) else {}
            return normalize_region(meta.get("region")) or UNCLASSIFIED
        return UNCLASSIFIED

    # Per-CVE severity isn't on AdvisoryCve — it lives on the matched register
    # finding (the same real-detection link the match used). Map cve_id→severity
    # for this asset; fall back to the advisory's own severity when absent.
    cve_ids = {r.cve_id for r in rows}
    sev_by_cve: Dict[str, str] = {}
    if cve_ids:
        for cve, sev in (
            db.query(Vulnerability.cve_id, Vulnerability.severity)
            .join(VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
            .filter(
                Vulnerability.tenant_id == tenant_id,
                VulnerabilityAssetLink.asset_id == asset_id,
                VulnerabilityAssetLink.link_source != "advisory",
                func.upper(Vulnerability.cve_id).in_([c.upper() for c in cve_ids]),
            ).all()
        ):
            if sev and cve and cve.upper() not in sev_by_cve:
                sev_by_cve[cve.upper()] = sev

    items = [{
        "advisory_id": r.advisory_id,
        "advisory_title": r.advisory_title,
        "advisory_severity": (r.advisory_severity or "info"),
        "cve_id": r.cve_id,
        "cve_severity": (sev_by_cve.get((r.cve_id or "").upper()) or r.advisory_severity or "info"),
        "region": _region(r),
        "url": r.url,
        "checked_at": r.checked_at.isoformat() if r.checked_at else None,
    } for r in rows]
    # Two stable passes: checked_at desc, then severity rank asc (critical first).
    items.sort(key=lambda it: it["checked_at"] or "", reverse=True)
    items.sort(key=lambda it: _SEV_RANK.get((it["advisory_severity"] or "info").lower(), 9))
    return {"items": items, "total": len(items)}


# ─── Matching (selection-driven) + saved sessions ───────────────────────────

def _match_scope_ids(db: Session, tenant_id: int, req: "MatchRequest") -> Set[int]:
    """Assets to match against: a hand-picked set, else every asset with a real
    register finding (the default). No CTEM."""
    if req.mode == "assets" and req.asset_ids:
        return set(req.asset_ids)
    return _default_scope_ids(db, tenant_id)


def _match_label(advisory_ids, cve_ids, mode, asset_ids) -> str:
    """A descriptive heading for a saved match run (vs a generic 'Match #N')."""
    n_adv = len(set(advisory_ids or []))
    n_cve = len(set(cve_ids or []))
    parts = []
    if n_adv:
        parts.append(f"{n_adv} advisor{'y' if n_adv == 1 else 'ies'}")
    if n_cve:
        parts.append(f"{n_cve} CVE{'' if n_cve == 1 else 's'}")
    sel = " + ".join(parts) or "selection"
    if mode == "assets" and asset_ids:
        na = len(asset_ids)
        scope = f"{na} selected asset{'' if na == 1 else 's'}"
    else:
        scope = "all scanned assets"
    return f"{sel} → {scope}"


@router.post("/match")
def run_match(
    req: MatchRequest,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Match the selected advisories' CVEs (and any individually-selected CVEs)
    against register findings in scope. Persists each involved advisory's
    applicability + counts, saves a downloadable session, and returns the report."""
    tenant_id = get_user_primary_tenant(user, db)
    scope_ids = _match_scope_ids(db, tenant_id, req)

    # Gather the selected CVE rows: every CVE of advisory_ids ∪ rows in cve_ids.
    cve_rows: List[AdvisoryCve] = []
    seen: Set[int] = set()
    if req.advisory_ids:
        for c in (db.query(AdvisoryCve)
                  .filter(AdvisoryCve.tenant_id == tenant_id,
                          AdvisoryCve.advisory_id.in_(req.advisory_ids)).all()):
            if c.id not in seen:
                seen.add(c.id); cve_rows.append(c)
    if req.cve_ids:
        for c in (db.query(AdvisoryCve)
                  .filter(AdvisoryCve.tenant_id == tenant_id,
                          AdvisoryCve.id.in_(req.cve_ids)).all()):
            if c.id not in seen:
                seen.add(c.id); cve_rows.append(c)
    if not cve_rows:
        raise HTTPException(status_code=400, detail="Select at least one advisory or CVE to match.")

    # Persist per involved advisory (recompute applicability + affected counts).
    adv_ids = sorted({c.advisory_id for c in cve_rows})
    advisories = {a.id: a for a in db.query(Advisory)
                  .filter(Advisory.tenant_id == tenant_id, Advisory.id.in_(adv_ids)).all()}
    for a in advisories.values():
        recheck_advisory(a, db, scope_ids)

    # Build the report from the selected CVEs.
    matched: List[Dict[str, Any]] = []
    not_found: List[Dict[str, Any]] = []
    all_asset_ids: Set[int] = set()
    for c in cve_rows:
        adv = advisories.get(c.advisory_id)
        entry = {"cve_id": c.cve_id, "advisory_id": c.advisory_id,
                 "advisory_title": adv.title if adv else None}
        details = _register_finding_details(db, tenant_id, c.cve_id, scope_ids)
        if details:
            all_asset_ids |= {d["asset_id"] for d in details}
            matched.append({**entry, "_details": details})
        else:
            not_found.append(entry)

    names = {}
    if all_asset_ids:
        names = {a.id: a.name for a in db.query(ITAsset).filter(ITAsset.id.in_(all_asset_ids)).all()}
    for m in matched:
        m["assets"] = [{"id": d["asset_id"], "name": names.get(d["asset_id"], f"asset #{d['asset_id']}"),
                        "severity": d["severity"], "vulnerability_id": d["vulnerability_id"]}
                       for d in m.pop("_details")]

    summary = {"cves_checked": len(cve_rows), "matched": len(matched),
               "not_found": len(not_found), "scope_size": len(scope_ids)}
    report = {"summary": summary, "matched": matched, "not_found": not_found}

    sess = AdvisoryMatchSession(
        tenant_id=tenant_id,
        label=req.label or _match_label(req.advisory_ids, req.cve_ids, req.mode, req.asset_ids),
        scope_mode=req.mode, scope_asset_ids=list(req.asset_ids or []),
        advisory_ids=list(req.advisory_ids or []), cve_ids=list(req.cve_ids or []),
        summary=summary, result=report,
        created_by=getattr(user, "id", None),
        actor_name=getattr(user, "username", None) or getattr(user, "email", None),
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return {"session_id": sess.id,
            "created_at": sess.created_at.isoformat() if sess.created_at else None,
            "report": report}


@router.get("/match-sessions")
def list_match_sessions(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Match history — past runs, newest first (declared before /{advisory_id})."""
    tenant_id = get_user_primary_tenant(user, db)
    rows = (db.query(AdvisoryMatchSession)
            .filter(AdvisoryMatchSession.tenant_id == tenant_id)
            .order_by(AdvisoryMatchSession.created_at.desc())
            .limit(100).all())
    return {"sessions": [{
        "id": s.id,
        "label": s.label or _match_label(s.advisory_ids, s.cve_ids, s.scope_mode, s.scope_asset_ids),
        "actor": s.actor_name,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "summary": s.summary or {},
    } for s in rows]}


@router.get("/match-sessions/{session_id}")
def get_match_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Re-open a saved match session with its full point-in-time report."""
    tenant_id = get_user_primary_tenant(user, db)
    s = (db.query(AdvisoryMatchSession)
         .filter(AdvisoryMatchSession.id == session_id,
                 AdvisoryMatchSession.tenant_id == tenant_id).first())
    if not s:
        raise HTTPException(status_code=404, detail="Match session not found")
    return {"id": s.id,
            "label": s.label or _match_label(s.advisory_ids, s.cve_ids, s.scope_mode, s.scope_asset_ids),
            "actor": s.actor_name,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "scope_mode": s.scope_mode, "summary": s.summary or {}, "report": s.result or {}}


@router.get("/match-sessions/{session_id}/download")
def download_match_session(
    session_id: int,
    fmt: str = "csv",
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Download a saved session's report as CSV (default) or JSON."""
    from fastapi.responses import Response
    tenant_id = get_user_primary_tenant(user, db)
    s = (db.query(AdvisoryMatchSession)
         .filter(AdvisoryMatchSession.id == session_id,
                 AdvisoryMatchSession.tenant_id == tenant_id).first())
    if not s:
        raise HTTPException(status_code=404, detail="Match session not found")
    report = s.result or {}
    if fmt == "json":
        import json
        return Response(content=json.dumps(report, indent=2), media_type="application/json",
                        headers={"Content-Disposition": f"attachment; filename=match-session-{s.id}.json"})
    import csv, io
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["cve_id", "advisory", "verdict", "asset", "severity", "vulnerability_id"])
    for m in report.get("matched", []):
        for a in m.get("assets", []):
            w.writerow([m.get("cve_id"), m.get("advisory_title"), "affected",
                        a.get("name"), a.get("severity"), a.get("vulnerability_id")])
    for n in report.get("not_found", []):
        w.writerow([n.get("cve_id"), n.get("advisory_title"), "not_found", "", "", ""])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=match-session-{s.id}.csv"})


@router.get("/{advisory_id}")
def get_advisory(
    advisory_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    advisory = _get_or_404(advisory_id, tenant_id, db)
    bids = [c.bridged_vulnerability_id for c in advisory.cves if c.bridged_vulnerability_id]
    bmap = ({v.id: v for v in db.query(Vulnerability)
             .filter(Vulnerability.tenant_id == tenant_id, Vulnerability.id.in_(bids)).all()}
            if bids else {})
    # Names of the affected assets, so the UI can say *on whom* a CVE lands.
    aff_ids = {ap.asset_id for c in advisory.cves for ap in c.applicability if ap.verdict == "affected"}
    names = ({a.id: a.name for a in db.query(ITAsset)
              .filter(ITAsset.tenant_id == tenant_id, ITAsset.id.in_(aff_ids)).all()}
             if aff_ids else {})
    d = _advisory_to_dict(advisory, with_cves=True, bridged_map=bmap, asset_names=names)
    _annotate_sources([d], [advisory], db, tenant_id)
    d["history"] = history_for(db, tenant_id, advisory_id)
    return d


@router.post("/{advisory_id}/recheck")
def recheck_applicability(
    advisory_id: int,
    body: Optional[RecheckScope] = None,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Recompute which assets this advisory affects by matching its CVEs against
    register findings, and refresh the rollup. ``body`` picks the asset scope
    (all scanned assets by default, a CTEM scope, or a hand-picked set)."""
    tenant_id = get_user_primary_tenant(user, db)
    advisory = _get_or_404(advisory_id, tenant_id, db)
    scope_ids = _resolve_scope_ids(db, tenant_id, body)
    summary = recheck_advisory(advisory, db, scope_ids)
    record_event(db, tenant_id=tenant_id, advisory_id=advisory.id, event="rechecked", actor=user,
                 detail={"affected": advisory.asset_affected_count, "total": advisory.asset_total_count,
                         "scope": (body.mode if body else None) or "all"})
    db.commit()
    db.refresh(advisory)
    return {"summary": summary, "advisory": _advisory_to_dict(advisory, with_cves=True)}


@router.post("/{advisory_id}/region")
def set_advisory_region(
    advisory_id: int,
    body: RegionIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Set the region for an advisory — the operator pick for an Unclassified
    upload. Stored in extraction_meta (no schema change)."""
    tenant_id = get_user_primary_tenant(user, db)
    advisory = _get_or_404(advisory_id, tenant_id, db)
    region = normalize_region(body.region)
    if region is None:
        raise HTTPException(status_code=400, detail="Unknown region")
    meta = dict(advisory.extraction_meta) if isinstance(advisory.extraction_meta, dict) else {}
    meta["region"] = region
    advisory.extraction_meta = meta  # reassign so SQLAlchemy flags the JSON change
    db.commit()
    return {"region": region}


@router.post("/{advisory_id}/confirm")
def confirm_advisory(
    advisory_id: int,
    body: AdvisoryConfirm,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Promote a reviewed PENDING advisory: replace its CVEs with the confirmed
    set, bridge each into the vulnerability pipeline, and mark it open."""
    tenant_id = get_user_primary_tenant(user, db)
    advisory = _get_or_404(advisory_id, tenant_id, db)
    if advisory.status != "pending":
        raise HTTPException(status_code=400, detail="Advisory is not pending review")

    if body.severity:
        advisory.severity = normalise_severity(body.severity)

    for existing in list(advisory.cves):
        db.delete(existing)
    db.flush()

    seen: set = set()
    for item in body.cves:
        cve = (item.cve_id or "").strip().upper()
        if not cve or cve in seen:
            continue
        seen.add(cve)
        row = AdvisoryCve(
            tenant_id=tenant_id, advisory_id=advisory.id, cve_id=cve,
            affected_product=item.affected_product, affected_versions=item.affected_versions,
        )
        db.add(row)
        db.flush()

    advisory.status = "open"
    record_event(db, tenant_id=tenant_id, advisory_id=advisory.id, event="confirmed", actor=user,
                 detail={"cves": len(seen), "severity": advisory.severity})
    db.commit()
    db.refresh(advisory)
    return _advisory_to_dict(advisory, with_cves=True)


@router.delete("/{advisory_id}")
def delete_advisory(
    advisory_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    advisory = _get_or_404(advisory_id, tenant_id, db)
    # Advisory rows cascade (cves → applicability). The bridged Vulnerability
    # rows are intentionally left in the register — removing an advisory should
    # not silently drop a tracked finding an operator may be remediating.
    db.delete(advisory)
    db.commit()
    return {"deleted": True}
