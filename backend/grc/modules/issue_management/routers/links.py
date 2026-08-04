"""Linkage endpoints — six target entity types, same shape per family.

  POST   /issues/{id}/links/vulns            { vulnerability_id, notes? }
  DELETE /issues/{id}/links/vulns/{vuln_id}
  GET    /issues/{id}/links/vulns            list with hydrated target

(Same shape for risks / assets / controls / evidence / vendors.)
"""
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Issue, IssueActivity, Vulnerability, Risk, ITAsset, Evidence,
    FrameworkControl, ParsedFrameworkControl, NormalizedControl, InternalControl,
    Vendor,
    IssueVulnerabilityLink, IssueRiskLink, IssueAssetLink,
    IssueControlLink, IssueEvidenceLink, IssueVendorLink,
    # v2 — IS Project + Governance linkage families
    IssueISProjectLink, IssueGovernanceLink, ISProject,
    GovernanceDocument, PolicyStatement,
    GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission

_require_view = require_tenant_permission("issue_management:issues:view")
_require_edit = require_tenant_permission("issue_management:issues:edit")

# Router-level view gate — every endpoint here (read or write) needs at
# least view. Write endpoints are marked individually with the edit gate.

router = APIRouter(
    prefix="/issues",
    tags=["Issue Management - Links"],
    dependencies=[Depends(_require_view)],
)


def _get_issue(issue_id: int, current_user: GRCUser, db: Session) -> Issue:
    user_tenants = get_user_tenants(current_user, db)
    issue = db.query(Issue).filter(
        Issue.id == issue_id,
        Issue.tenant_id.in_(user_tenants),
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def _log_link(db: Session, issue_id: int, user_id: Optional[int], kind: str, target_type: str, target_id: int) -> None:
    db.add(IssueActivity(
        issue_id=issue_id, user_id=user_id, type=kind,
        payload={"target_type": target_type, "target_id": target_id},
    ))


# ─── Vulnerabilities ────────────────────────────────────────────────────
@router.get("/{issue_id}/links/vulns")
def list_vuln_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueVulnerabilityLink).options(
        joinedload(IssueVulnerabilityLink.vulnerability),
    ).filter(IssueVulnerabilityLink.issue_id == issue_id).all()
    return [{
        "id": r.id,
        "vulnerability_id": r.vulnerability_id,
        "vuln_id": getattr(r.vulnerability, "vuln_id", None),
        "title": getattr(r.vulnerability, "title", None),
        "severity": getattr(r.vulnerability, "severity", None),
        "cvss_score": getattr(r.vulnerability, "cvss_score", None),
        "kev_flag": bool(getattr(r.vulnerability, "kev_flag", False)),
        "notes": r.notes,
    } for r in rows]


@router.post("/{issue_id}/links/vulns", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_vuln_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    vuln_id = body.get("vulnerability_id")
    if not vuln_id:
        raise HTTPException(status_code=400, detail="vulnerability_id required")
    if not db.query(Vulnerability).filter(Vulnerability.id == vuln_id, Vulnerability.tenant_id == issue.tenant_id).first():
        raise HTTPException(status_code=404, detail="Vulnerability not found in tenant")
    exists = db.query(IssueVulnerabilityLink).filter(
        IssueVulnerabilityLink.issue_id == issue_id,
        IssueVulnerabilityLink.vulnerability_id == vuln_id,
    ).first()
    if exists:
        return {"id": exists.id, "vulnerability_id": vuln_id, "notes": exists.notes}
    link = IssueVulnerabilityLink(issue_id=issue_id, vulnerability_id=vuln_id, notes=body.get("notes"), created_by=current_user.id)
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", "vulnerability", vuln_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "vulnerability_id": vuln_id, "notes": link.notes}


@router.delete("/{issue_id}/links/vulns/{vuln_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_vuln_link(issue_id: int, vuln_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueVulnerabilityLink).filter(
        IssueVulnerabilityLink.issue_id == issue_id,
        IssueVulnerabilityLink.vulnerability_id == vuln_id,
    ).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "vulnerability", vuln_id)
        db.commit()
    return


# ─── Risks ──────────────────────────────────────────────────────────────
@router.get("/{issue_id}/links/risks")
def list_risk_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueRiskLink).options(joinedload(IssueRiskLink.risk)).filter(IssueRiskLink.issue_id == issue_id).all()
    out = []
    for r in rows:
        risk = r.risk
        out.append({
            "id": r.id,
            "risk_id": r.risk_id,
            "link_type": r.link_type,
            "title": getattr(risk, "title", None),
            "status": getattr(risk, "status", None),
            "inherent_score": getattr(risk, "inherent_score", None),
            "residual_score": getattr(risk, "residual_score", None),
            "notes": r.notes,
        })
    return out


@router.post("/{issue_id}/links/risks", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_risk_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    risk_id = body.get("risk_id")
    if not risk_id:
        raise HTTPException(status_code=400, detail="risk_id required")
    if not db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id == issue.tenant_id).first():
        raise HTTPException(status_code=404, detail="Risk not found in tenant")
    exists = db.query(IssueRiskLink).filter(IssueRiskLink.issue_id == issue_id, IssueRiskLink.risk_id == risk_id).first()
    if exists:
        return {"id": exists.id, "risk_id": risk_id}
    link = IssueRiskLink(
        issue_id=issue_id, risk_id=risk_id,
        link_type=body.get("link_type") or "instance_of",
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", "risk", risk_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "risk_id": risk_id, "link_type": link.link_type}


@router.delete("/{issue_id}/links/risks/{risk_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_risk_link(issue_id: int, risk_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueRiskLink).filter(IssueRiskLink.issue_id == issue_id, IssueRiskLink.risk_id == risk_id).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "risk", risk_id)
        db.commit()
    return


# ─── Assets ─────────────────────────────────────────────────────────────
@router.get("/{issue_id}/links/assets")
def list_asset_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueAssetLink).options(joinedload(IssueAssetLink.asset)).filter(IssueAssetLink.issue_id == issue_id).all()
    return [{
        "id": r.id, "asset_id": r.asset_id,
        "name": getattr(r.asset, "name", None),
        "type": getattr(r.asset, "asset_type", None),
        "criticality": getattr(r.asset, "criticality", None),
        "notes": r.notes,
    } for r in rows]


@router.post("/{issue_id}/links/assets", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_asset_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    asset_id = body.get("asset_id")
    if not asset_id:
        raise HTTPException(status_code=400, detail="asset_id required")
    if not db.query(ITAsset).filter(ITAsset.id == asset_id, ITAsset.tenant_id == issue.tenant_id).first():
        raise HTTPException(status_code=404, detail="Asset not found in tenant")
    exists = db.query(IssueAssetLink).filter(IssueAssetLink.issue_id == issue_id, IssueAssetLink.asset_id == asset_id).first()
    if exists:
        return {"id": exists.id, "asset_id": asset_id}
    link = IssueAssetLink(issue_id=issue_id, asset_id=asset_id, notes=body.get("notes"), created_by=current_user.id)
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", "asset", asset_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "asset_id": asset_id}


@router.delete("/{issue_id}/links/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_asset_link(issue_id: int, asset_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueAssetLink).filter(IssueAssetLink.issue_id == issue_id, IssueAssetLink.asset_id == asset_id).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "asset", asset_id)
        db.commit()
    return


# ─── Controls (polymorphic 4-target) ────────────────────────────────────
@router.get("/{issue_id}/links/controls")
def list_control_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueControlLink).options(
        joinedload(IssueControlLink.framework_control),
        joinedload(IssueControlLink.parsed_control),
        joinedload(IssueControlLink.normalized_control),
        joinedload(IssueControlLink.internal_control),
    ).filter(IssueControlLink.issue_id == issue_id).all()

    out = []
    for r in rows:
        target_type, control_id, code, name = None, None, None, None
        if r.framework_control_id:
            target_type, control_id = "framework", r.framework_control_id
            code = getattr(r.framework_control, "code", None)
            name = getattr(r.framework_control, "name", None)
        elif r.parsed_framework_control_id:
            target_type, control_id = "parsed", r.parsed_framework_control_id
            code = getattr(r.parsed_control, "control_id", None)
            name = getattr(r.parsed_control, "title", None)
        elif r.normalized_control_id:
            target_type, control_id = "normalized", r.normalized_control_id
            code = getattr(r.normalized_control, "code", None) or getattr(r.normalized_control, "control_id", None)
            name = getattr(r.normalized_control, "name", None) or getattr(r.normalized_control, "title", None)
        elif r.internal_control_id:
            target_type, control_id = "internal", r.internal_control_id
            code = getattr(r.internal_control, "control_id", None)
            name = getattr(r.internal_control, "name", None)
        out.append({
            "id": r.id, "target_type": target_type, "control_id": control_id,
            "code": code, "name": name, "link_type": r.link_type, "notes": r.notes,
        })
    return out


@router.post("/{issue_id}/links/controls", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_control_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    target_type = (body.get("target_type") or "").lower()
    control_id = body.get("control_id")
    if target_type not in {"framework", "parsed", "normalized", "internal"} or not control_id:
        raise HTTPException(status_code=400, detail="target_type ∈ {framework,parsed,normalized,internal} and control_id required")

    link = IssueControlLink(
        issue_id=issue_id,
        link_type=body.get("link_type") or "failed",
        notes=body.get("notes"),
        created_by=current_user.id,
    )
    if target_type == "framework":   link.framework_control_id = control_id
    elif target_type == "parsed":    link.parsed_framework_control_id = control_id
    elif target_type == "normalized":link.normalized_control_id = control_id
    elif target_type == "internal":  link.internal_control_id = control_id
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", f"control_{target_type}", control_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "target_type": target_type, "control_id": control_id}


@router.delete("/{issue_id}/links/controls/{link_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_control_link(issue_id: int, link_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueControlLink).filter(IssueControlLink.id == link_id, IssueControlLink.issue_id == issue_id).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "control", link_id)
        db.commit()
    return


# ─── Evidence ───────────────────────────────────────────────────────────
@router.get("/{issue_id}/links/evidence")
def list_evidence_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueEvidenceLink).options(joinedload(IssueEvidenceLink.evidence)).filter(IssueEvidenceLink.issue_id == issue_id).all()
    return [{
        "id": r.id, "evidence_id": r.evidence_id,
        "name": getattr(r.evidence, "name", None) or getattr(r.evidence, "title", None),
        "relationship_type": r.relationship_type,
        "notes": r.notes,
    } for r in rows]


@router.post("/{issue_id}/links/evidence", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_evidence_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    evidence_id = body.get("evidence_id")
    if not evidence_id:
        raise HTTPException(status_code=400, detail="evidence_id required")
    if not db.query(Evidence).filter(Evidence.id == evidence_id, Evidence.tenant_id == issue.tenant_id).first():
        raise HTTPException(status_code=404, detail="Evidence not found in tenant")
    exists = db.query(IssueEvidenceLink).filter(IssueEvidenceLink.issue_id == issue_id, IssueEvidenceLink.evidence_id == evidence_id).first()
    if exists:
        return {"id": exists.id, "evidence_id": evidence_id}
    link = IssueEvidenceLink(
        issue_id=issue_id, evidence_id=evidence_id,
        relationship_type=body.get("relationship_type") or "proof",
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", "evidence", evidence_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "evidence_id": evidence_id}


@router.delete("/{issue_id}/links/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_evidence_link(issue_id: int, evidence_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueEvidenceLink).filter(IssueEvidenceLink.issue_id == issue_id, IssueEvidenceLink.evidence_id == evidence_id).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "evidence", evidence_id)
        db.commit()
    return


# ─── Vendors (Contract Compliance) ──────────────────────────────────────
@router.get("/{issue_id}/links/vendors")
def list_vendor_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueVendorLink).options(joinedload(IssueVendorLink.vendor)).filter(IssueVendorLink.issue_id == issue_id).all()
    return [{
        "id": r.id, "vendor_id": r.vendor_id,
        "name": getattr(r.vendor, "name", None),
        "contract_reference": r.contract_reference,
        "breach_clause": r.breach_clause,
        "notes": r.notes,
    } for r in rows]


@router.post("/{issue_id}/links/vendors", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_vendor_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    vendor_id = body.get("vendor_id")
    if not vendor_id:
        raise HTTPException(status_code=400, detail="vendor_id required")
    if not db.query(Vendor).filter(Vendor.id == vendor_id, Vendor.tenant_id == issue.tenant_id).first():
        raise HTTPException(status_code=404, detail="Vendor not found in tenant")
    exists = db.query(IssueVendorLink).filter(IssueVendorLink.issue_id == issue_id, IssueVendorLink.vendor_id == vendor_id).first()
    if exists:
        return {"id": exists.id, "vendor_id": vendor_id}
    link = IssueVendorLink(
        issue_id=issue_id, vendor_id=vendor_id,
        contract_reference=body.get("contract_reference"),
        breach_clause=body.get("breach_clause"),
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", "vendor", vendor_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "vendor_id": vendor_id}


@router.delete("/{issue_id}/links/vendors/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_vendor_link(issue_id: int, vendor_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueVendorLink).filter(IssueVendorLink.issue_id == issue_id, IssueVendorLink.vendor_id == vendor_id).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "vendor", vendor_id)
        db.commit()
    return


# ─── v2: IS Projects ────────────────────────────────────────────────────
@router.get("/{issue_id}/links/projects")
def list_project_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueISProjectLink).options(joinedload(IssueISProjectLink.is_project)).filter(IssueISProjectLink.issue_id == issue_id).all()
    return [{
        "id": r.id, "is_project_id": r.is_project_id,
        "name": getattr(r.is_project, "name", None),
        "status": getattr(r.is_project, "status", None),
        "health": getattr(r.is_project, "health", None),
        "role": r.role,
        "notes": r.notes,
    } for r in rows]


@router.post("/{issue_id}/links/projects", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_project_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    project_id = body.get("is_project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="is_project_id required")
    if not db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == issue.tenant_id).first():
        raise HTTPException(status_code=404, detail="IS Project not found in tenant")
    exists = db.query(IssueISProjectLink).filter(
        IssueISProjectLink.issue_id == issue_id,
        IssueISProjectLink.is_project_id == project_id,
    ).first()
    if exists:
        return {"id": exists.id, "is_project_id": project_id, "role": exists.role}
    link = IssueISProjectLink(
        issue_id=issue_id, is_project_id=project_id,
        role=body.get("role") or "contributor",
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", "is_project", project_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "is_project_id": project_id, "role": link.role}


@router.delete("/{issue_id}/links/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_project_link(issue_id: int, project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueISProjectLink).filter(
        IssueISProjectLink.issue_id == issue_id,
        IssueISProjectLink.is_project_id == project_id,
    ).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "is_project", project_id)
        db.commit()
    return


# ─── v2: Governance Documents + Policy Statements ───────────────────────
@router.get("/{issue_id}/links/governance")
def list_governance_links(issue_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    rows = db.query(IssueGovernanceLink).options(
        joinedload(IssueGovernanceLink.governance_document),
        joinedload(IssueGovernanceLink.policy_statement),
    ).filter(IssueGovernanceLink.issue_id == issue_id).all()
    out = []
    for r in rows:
        if r.governance_document_id and r.governance_document is not None:
            out.append({
                "id": r.id, "target_type": "governance_document",
                "target_id": r.governance_document_id,
                "title": getattr(r.governance_document, "title", None),
                "code": getattr(r.governance_document, "document_code", None),
                "link_type": r.link_type, "notes": r.notes,
            })
        elif r.policy_statement_id and r.policy_statement is not None:
            ps = r.policy_statement
            out.append({
                "id": r.id, "target_type": "policy_statement",
                "target_id": r.policy_statement_id,
                "title": getattr(ps, "statement_summary", None) or getattr(ps, "statement_text", None),
                "code": getattr(ps, "statement_code", None),
                "link_type": r.link_type, "notes": r.notes,
            })
    return out


@router.post("/{issue_id}/links/governance", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def add_governance_link(issue_id: int, body: Dict[str, Any], db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    issue = _get_issue(issue_id, current_user, db)
    target_type = (body.get("target_type") or "").lower()
    target_id = body.get("target_id")
    if target_type not in {"governance_document", "policy_statement"} or not target_id:
        raise HTTPException(status_code=400, detail="target_type must be governance_document or policy_statement, with target_id")

    if target_type == "governance_document":
        if not db.query(GovernanceDocument).filter(GovernanceDocument.id == target_id, GovernanceDocument.tenant_id == issue.tenant_id).first():
            raise HTTPException(status_code=404, detail="Governance document not found in tenant")
    else:
        if not db.query(PolicyStatement).filter(PolicyStatement.id == target_id, PolicyStatement.tenant_id == issue.tenant_id).first():
            raise HTTPException(status_code=404, detail="Policy statement not found in tenant")

    link = IssueGovernanceLink(
        issue_id=issue_id,
        governance_document_id=target_id if target_type == "governance_document" else None,
        policy_statement_id=target_id if target_type == "policy_statement" else None,
        link_type=body.get("link_type") or "non_conformance",
        notes=body.get("notes"), created_by=current_user.id,
    )
    db.add(link)
    _log_link(db, issue_id, current_user.id, "linked", target_type, target_id)
    db.commit()
    db.refresh(link)
    return {"id": link.id, "target_type": target_type, "target_id": target_id, "link_type": link.link_type}


@router.delete("/{issue_id}/links/governance/{link_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def remove_governance_link(issue_id: int, link_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    _get_issue(issue_id, current_user, db)
    link = db.query(IssueGovernanceLink).filter(
        IssueGovernanceLink.id == link_id,
        IssueGovernanceLink.issue_id == issue_id,
    ).first()
    if link:
        db.delete(link)
        _log_link(db, issue_id, current_user.id, "unlinked", "governance", link_id)
        db.commit()
    return
