"""Cross-module linkage endpoints for Risk Incidents.

  GET    /incidents/{id}/links
  POST   /incidents/{id}/links/{assets|vulnerabilities|risks|evidence}
  DELETE /incidents/{id}/links/{assets|vulnerabilities|risks|evidence}/{target_id}
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    RiskIncident, IncidentAssetLink, IncidentVulnerabilityLink, IncidentRiskLink,
    EvidenceIncidentLink, Risk, ITAsset, Vulnerability, Evidence, GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..schema_migrations import ensure_incident_schema

router = APIRouter(prefix="/incidents", tags=["ERM - Incident Links"])


def _get_incident(incident_id: int, current_user: GRCUser, db: Session) -> RiskIncident:
    user_tenants = get_user_tenants(current_user, db)
    incident = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants),
    ).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


def serialize_links(db: Session, incident_id: int) -> Dict[str, List[Dict[str, Any]]]:
    assets = db.query(IncidentAssetLink).options(
        joinedload(IncidentAssetLink.asset),
    ).filter(IncidentAssetLink.incident_id == incident_id).all()
    vulns = db.query(IncidentVulnerabilityLink).options(
        joinedload(IncidentVulnerabilityLink.vulnerability),
    ).filter(IncidentVulnerabilityLink.incident_id == incident_id).all()
    risks = db.query(IncidentRiskLink).options(
        joinedload(IncidentRiskLink.risk),
    ).filter(IncidentRiskLink.incident_id == incident_id).all()
    evidence = db.query(EvidenceIncidentLink).options(
        joinedload(EvidenceIncidentLink.evidence),
    ).filter(EvidenceIncidentLink.incident_id == incident_id).all()

    return {
        "assets": [{
            "id": r.id,
            "asset_id": r.asset_id,
            "name": getattr(r.asset, "name", None),
            "asset_type": getattr(r.asset, "asset_type", None),
            "notes": r.notes,
        } for r in assets],
        "vulnerabilities": [{
            "id": r.id,
            "vulnerability_id": r.vulnerability_id,
            "title": getattr(r.vulnerability, "title", None),
            "cve_id": getattr(r.vulnerability, "cve_id", None),
            "severity": getattr(r.vulnerability, "severity", None),
            "notes": r.notes,
        } for r in vulns],
        "risks": [{
            "id": r.id,
            "risk_id": r.risk_id,
            "title": getattr(r.risk, "title", None),
            "category": getattr(r.risk, "category", None),
            "notes": r.notes,
        } for r in risks],
        "evidence": [{
            "id": r.id,
            "evidence_id": r.evidence_id,
            "name": getattr(r.evidence, "name", None) or getattr(r.evidence, "title", None),
            "link_type": r.link_type,
        } for r in evidence],
    }


def apply_inline_links(
    db: Session,
    *,
    incident: RiskIncident,
    tenant_id: int,
    body: Dict[str, Any],
    user_id: Optional[int],
    replace: bool = False,
) -> Dict[str, int]:
    """Attach linked_*_ids from a create/update payload. Returns counts."""
    counts = {"assets": 0, "vulnerabilities": 0, "risks": 0, "evidence": 0}

    def _ids(key: str) -> List[int]:
        raw = body.get(key) or []
        out: List[int] = []
        for v in raw:
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                out.append(n)
        return out

    asset_ids = _ids("linked_asset_ids")
    vuln_ids = _ids("linked_vulnerability_ids")
    risk_ids = _ids("linked_risk_ids")
    evidence_ids = _ids("linked_evidence_ids")

    if replace:
        if "linked_asset_ids" in body:
            db.query(IncidentAssetLink).filter(IncidentAssetLink.incident_id == incident.id).delete()
        if "linked_vulnerability_ids" in body:
            db.query(IncidentVulnerabilityLink).filter(
                IncidentVulnerabilityLink.incident_id == incident.id
            ).delete()
        if "linked_risk_ids" in body:
            db.query(IncidentRiskLink).filter(IncidentRiskLink.incident_id == incident.id).delete()
        if "linked_evidence_ids" in body:
            db.query(EvidenceIncidentLink).filter(
                EvidenceIncidentLink.incident_id == incident.id
            ).delete()

    if asset_ids:
        valid = {
            r[0] for r in db.query(ITAsset.id).filter(
                ITAsset.id.in_(asset_ids), ITAsset.tenant_id == tenant_id,
            ).all()
        }
        existing = {
            r[0] for r in db.query(IncidentAssetLink.asset_id).filter(
                IncidentAssetLink.incident_id == incident.id,
            ).all()
        } if not replace else set()
        for aid in valid:
            if aid in existing:
                continue
            db.add(IncidentAssetLink(incident_id=incident.id, asset_id=aid, created_by=user_id))
            counts["assets"] += 1

    if vuln_ids:
        valid = {
            r[0] for r in db.query(Vulnerability.id).filter(
                Vulnerability.id.in_(vuln_ids), Vulnerability.tenant_id == tenant_id,
            ).all()
        }
        existing = {
            r[0] for r in db.query(IncidentVulnerabilityLink.vulnerability_id).filter(
                IncidentVulnerabilityLink.incident_id == incident.id,
            ).all()
        } if not replace else set()
        for vid in valid:
            if vid in existing:
                continue
            db.add(IncidentVulnerabilityLink(
                incident_id=incident.id, vulnerability_id=vid, created_by=user_id,
            ))
            counts["vulnerabilities"] += 1

    if risk_ids:
        valid = {
            r[0] for r in db.query(Risk.id).filter(
                Risk.id.in_(risk_ids), Risk.tenant_id == tenant_id,
            ).all()
        }
        existing = {
            r[0] for r in db.query(IncidentRiskLink.risk_id).filter(
                IncidentRiskLink.incident_id == incident.id,
            ).all()
        } if not replace else set()
        for rid in valid:
            if rid in existing:
                continue
            db.add(IncidentRiskLink(incident_id=incident.id, risk_id=rid, created_by=user_id))
            counts["risks"] += 1

    if evidence_ids:
        valid = {
            r[0] for r in db.query(Evidence.id).filter(
                Evidence.id.in_(evidence_ids), Evidence.tenant_id == tenant_id,
            ).all()
        }
        existing = {
            r[0] for r in db.query(EvidenceIncidentLink.evidence_id).filter(
                EvidenceIncidentLink.incident_id == incident.id,
            ).all()
        } if not replace else set()
        for eid in valid:
            if eid in existing:
                continue
            db.add(EvidenceIncidentLink(
                incident_id=incident.id, evidence_id=eid, created_by=user_id,
            ))
            counts["evidence"] += 1

    return counts


@router.get("/{incident_id}/links")
def get_links(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    _get_incident(incident_id, current_user, db)
    return serialize_links(db, incident_id)


@router.post("/{incident_id}/links/assets", status_code=status.HTTP_201_CREATED)
def add_asset_link(
    incident_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    incident = _get_incident(incident_id, current_user, db)
    asset_id = body.get("asset_id")
    if not asset_id:
        raise HTTPException(status_code=400, detail="asset_id is required")
    asset = db.query(ITAsset).filter(
        ITAsset.id == int(asset_id), ITAsset.tenant_id == incident.tenant_id,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    existing = db.query(IncidentAssetLink).filter(
        IncidentAssetLink.incident_id == incident_id,
        IncidentAssetLink.asset_id == asset.id,
    ).first()
    if existing:
        return {"id": existing.id, "asset_id": asset.id, "already_linked": True}
    row = IncidentAssetLink(
        incident_id=incident_id, asset_id=asset.id,
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "asset_id": asset.id, "already_linked": False}


@router.delete("/{incident_id}/links/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_asset_link(
    incident_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    _get_incident(incident_id, current_user, db)
    row = db.query(IncidentAssetLink).filter(
        IncidentAssetLink.incident_id == incident_id,
        IncidentAssetLink.asset_id == asset_id,
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return


@router.post("/{incident_id}/links/vulnerabilities", status_code=status.HTTP_201_CREATED)
def add_vuln_link(
    incident_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    incident = _get_incident(incident_id, current_user, db)
    vulnerability_id = body.get("vulnerability_id")
    if not vulnerability_id:
        raise HTTPException(status_code=400, detail="vulnerability_id is required")
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == int(vulnerability_id),
        Vulnerability.tenant_id == incident.tenant_id,
    ).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    existing = db.query(IncidentVulnerabilityLink).filter(
        IncidentVulnerabilityLink.incident_id == incident_id,
        IncidentVulnerabilityLink.vulnerability_id == vuln.id,
    ).first()
    if existing:
        return {"id": existing.id, "vulnerability_id": vuln.id, "already_linked": True}
    row = IncidentVulnerabilityLink(
        incident_id=incident_id, vulnerability_id=vuln.id,
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "vulnerability_id": vuln.id, "already_linked": False}


@router.delete("/{incident_id}/links/vulnerabilities/{vulnerability_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_vuln_link(
    incident_id: int,
    vulnerability_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    _get_incident(incident_id, current_user, db)
    row = db.query(IncidentVulnerabilityLink).filter(
        IncidentVulnerabilityLink.incident_id == incident_id,
        IncidentVulnerabilityLink.vulnerability_id == vulnerability_id,
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return


@router.post("/{incident_id}/links/risks", status_code=status.HTTP_201_CREATED)
def add_risk_link(
    incident_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    incident = _get_incident(incident_id, current_user, db)
    risk_id = body.get("risk_id")
    if not risk_id:
        raise HTTPException(status_code=400, detail="risk_id is required")
    risk = db.query(Risk).filter(
        Risk.id == int(risk_id), Risk.tenant_id == incident.tenant_id,
    ).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    existing = db.query(IncidentRiskLink).filter(
        IncidentRiskLink.incident_id == incident_id,
        IncidentRiskLink.risk_id == risk.id,
    ).first()
    if existing:
        return {"id": existing.id, "risk_id": risk.id, "already_linked": True}
    row = IncidentRiskLink(
        incident_id=incident_id, risk_id=risk.id,
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "risk_id": risk.id, "already_linked": False}


@router.delete("/{incident_id}/links/risks/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_risk_link(
    incident_id: int,
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    _get_incident(incident_id, current_user, db)
    row = db.query(IncidentRiskLink).filter(
        IncidentRiskLink.incident_id == incident_id,
        IncidentRiskLink.risk_id == risk_id,
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return


@router.post("/{incident_id}/links/evidence", status_code=status.HTTP_201_CREATED)
def add_evidence_link(
    incident_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    incident = _get_incident(incident_id, current_user, db)
    evidence_id = body.get("evidence_id")
    if not evidence_id:
        raise HTTPException(status_code=400, detail="evidence_id is required")
    evidence = db.query(Evidence).filter(
        Evidence.id == int(evidence_id), Evidence.tenant_id == incident.tenant_id,
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    existing = db.query(EvidenceIncidentLink).filter(
        EvidenceIncidentLink.incident_id == incident_id,
        EvidenceIncidentLink.evidence_id == evidence.id,
    ).first()
    if existing:
        return {"id": existing.id, "evidence_id": evidence.id, "already_linked": True}
    row = EvidenceIncidentLink(
        incident_id=incident_id, evidence_id=evidence.id,
        link_type=body.get("link_type"), created_by=current_user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "evidence_id": evidence.id, "already_linked": False}


@router.delete("/{incident_id}/links/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_evidence_link(
    incident_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    ensure_incident_schema(db)
    _get_incident(incident_id, current_user, db)
    row = db.query(EvidenceIncidentLink).filter(
        EvidenceIncidentLink.incident_id == incident_id,
        EvidenceIncidentLink.evidence_id == evidence_id,
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return
