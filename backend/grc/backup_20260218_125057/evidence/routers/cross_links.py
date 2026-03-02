from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ....models import (
    Evidence, Risk, ITAsset, RiskIncident, PolicyStatement,
    RiskEvidenceLink, AssetEvidenceLink, EvidenceIncidentLink, EvidencePolicyLink,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/cross-links", tags=["Evidence - Cross-Module Links"])


class RiskLinkCreate(BaseModel):
    risk_ids: List[int]
    link_type: Optional[str] = None


class AssetLinkCreate(BaseModel):
    asset_ids: List[int]
    link_type: Optional[str] = None


class IncidentLinkCreate(BaseModel):
    incident_ids: List[int]
    link_type: Optional[str] = None


class PolicyStatementLinkCreate(BaseModel):
    statement_ids: List[int]
    link_type: Optional[str] = None


def get_evidence_with_tenant_check(evidence_id: int, user: GRCUser, db: Session) -> Evidence:
    user_tenants = get_user_tenants(user, db)
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    return evidence


def serialize_risk(risk: Risk) -> dict:
    return {
        "id": risk.id,
        "title": risk.title,
        "description": risk.description,
        "category": risk.category,
        "status": risk.status,
        "inherent_score": risk.inherent_score,
        "residual_score": risk.residual_score,
        "tenant_id": risk.tenant_id
    }


def serialize_asset(asset: ITAsset) -> dict:
    return {
        "id": asset.id,
        "name": asset.name,
        "description": asset.description,
        "asset_type": asset.asset_type,
        "criticality": asset.criticality,
        "status": asset.status,
        "tenant_id": asset.tenant_id
    }


def serialize_incident(incident: RiskIncident) -> dict:
    return {
        "id": incident.id,
        "title": incident.title,
        "description": incident.description,
        "severity": incident.severity,
        "status": incident.status,
        "incident_date": incident.incident_date.isoformat() if incident.incident_date else None,
        "risk_id": incident.risk_id,
        "tenant_id": incident.tenant_id
    }


def serialize_policy_statement(statement: PolicyStatement) -> dict:
    return {
        "id": statement.id,
        "statement_code": statement.statement_code,
        "statement_text": statement.statement_text,
        "statement_summary": statement.statement_summary,
        "category": statement.category,
        "priority": statement.priority,
        "status": statement.status,
        "document_id": statement.document_id,
        "tenant_id": statement.tenant_id
    }


@router.post("/{evidence_id}/risks", status_code=status.HTTP_201_CREATED)
def link_evidence_to_risks(
    evidence_id: int,
    link_data: RiskLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    user_tenants = get_user_tenants(current_user, db)
    
    created_links = []
    skipped = []
    
    for risk_id in link_data.risk_ids:
        risk = db.query(Risk).filter(
            Risk.id == risk_id,
            Risk.tenant_id.in_(user_tenants)
        ).first()
        
        if not risk:
            skipped.append({"risk_id": risk_id, "reason": "Risk not found or access denied"})
            continue
        
        existing = db.query(RiskEvidenceLink).filter(
            RiskEvidenceLink.evidence_id == evidence_id,
            RiskEvidenceLink.risk_id == risk_id
        ).first()
        
        if existing:
            skipped.append({"risk_id": risk_id, "reason": "Link already exists"})
            continue
        
        link = RiskEvidenceLink(
            evidence_id=evidence_id,
            risk_id=risk_id
        )
        db.add(link)
        db.flush()
        
        created_links.append({
            "id": link.id,
            "evidence_id": evidence_id,
            "risk_id": risk_id,
            "risk": serialize_risk(risk)
        })
    
    db.commit()
    
    return {
        "evidence_id": evidence_id,
        "created_count": len(created_links),
        "skipped_count": len(skipped),
        "created_links": created_links,
        "skipped": skipped
    }


@router.get("/{evidence_id}/risks")
def get_evidence_risk_links(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    links = db.query(RiskEvidenceLink).options(
        joinedload(RiskEvidenceLink.risk)
    ).filter(
        RiskEvidenceLink.evidence_id == evidence_id
    ).all()
    
    return {
        "evidence_id": evidence_id,
        "evidence_name": evidence.name,
        "total_links": len(links),
        "links": [
            {
                "id": link.id,
                "risk_id": link.risk_id,
                "risk": serialize_risk(link.risk) if link.risk else None
            }
            for link in links
        ]
    }


@router.delete("/{evidence_id}/risks/{link_id}")
def delete_evidence_risk_link(
    evidence_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    link = db.query(RiskEvidenceLink).filter(
        RiskEvidenceLink.id == link_id,
        RiskEvidenceLink.evidence_id == evidence_id
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk link not found"
        )
    
    db.delete(link)
    db.commit()
    
    return {"message": "Risk link removed successfully"}


@router.post("/{evidence_id}/assets", status_code=status.HTTP_201_CREATED)
def link_evidence_to_assets(
    evidence_id: int,
    link_data: AssetLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    user_tenants = get_user_tenants(current_user, db)
    
    created_links = []
    skipped = []
    
    for asset_id in link_data.asset_ids:
        asset = db.query(ITAsset).filter(
            ITAsset.id == asset_id,
            ITAsset.tenant_id.in_(user_tenants)
        ).first()
        
        if not asset:
            skipped.append({"asset_id": asset_id, "reason": "Asset not found or access denied"})
            continue
        
        existing = db.query(AssetEvidenceLink).filter(
            AssetEvidenceLink.evidence_id == evidence_id,
            AssetEvidenceLink.asset_id == asset_id
        ).first()
        
        if existing:
            skipped.append({"asset_id": asset_id, "reason": "Link already exists"})
            continue
        
        link = AssetEvidenceLink(
            evidence_id=evidence_id,
            asset_id=asset_id,
            relationship_type=link_data.link_type or "supports"
        )
        db.add(link)
        db.flush()
        
        created_links.append({
            "id": link.id,
            "evidence_id": evidence_id,
            "asset_id": asset_id,
            "link_type": link.relationship_type,
            "asset": serialize_asset(asset)
        })
    
    db.commit()
    
    return {
        "evidence_id": evidence_id,
        "created_count": len(created_links),
        "skipped_count": len(skipped),
        "created_links": created_links,
        "skipped": skipped
    }


@router.get("/{evidence_id}/assets")
def get_evidence_asset_links(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    links = db.query(AssetEvidenceLink).options(
        joinedload(AssetEvidenceLink.asset)
    ).filter(
        AssetEvidenceLink.evidence_id == evidence_id
    ).all()
    
    return {
        "evidence_id": evidence_id,
        "evidence_name": evidence.name,
        "total_links": len(links),
        "links": [
            {
                "id": link.id,
                "asset_id": link.asset_id,
                "link_type": link.relationship_type,
                "asset": serialize_asset(link.asset) if link.asset else None
            }
            for link in links
        ]
    }


@router.delete("/{evidence_id}/assets/{link_id}")
def delete_evidence_asset_link(
    evidence_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    link = db.query(AssetEvidenceLink).filter(
        AssetEvidenceLink.id == link_id,
        AssetEvidenceLink.evidence_id == evidence_id
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset link not found"
        )
    
    db.delete(link)
    db.commit()
    
    return {"message": "Asset link removed successfully"}


@router.post("/{evidence_id}/incidents", status_code=status.HTTP_201_CREATED)
def link_evidence_to_incidents(
    evidence_id: int,
    link_data: IncidentLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    user_tenants = get_user_tenants(current_user, db)
    
    created_links = []
    skipped = []
    
    for incident_id in link_data.incident_ids:
        incident = db.query(RiskIncident).filter(
            RiskIncident.id == incident_id,
            RiskIncident.tenant_id.in_(user_tenants)
        ).first()
        
        if not incident:
            skipped.append({"incident_id": incident_id, "reason": "Incident not found or access denied"})
            continue
        
        existing = db.query(EvidenceIncidentLink).filter(
            EvidenceIncidentLink.evidence_id == evidence_id,
            EvidenceIncidentLink.incident_id == incident_id
        ).first()
        
        if existing:
            skipped.append({"incident_id": incident_id, "reason": "Link already exists"})
            continue
        
        link = EvidenceIncidentLink(
            evidence_id=evidence_id,
            incident_id=incident_id,
            link_type=link_data.link_type,
            created_by=current_user.id,
            created_at=datetime.utcnow()
        )
        db.add(link)
        db.flush()
        
        created_links.append({
            "id": link.id,
            "evidence_id": evidence_id,
            "incident_id": incident_id,
            "link_type": link.link_type,
            "incident": serialize_incident(incident)
        })
    
    db.commit()
    
    return {
        "evidence_id": evidence_id,
        "created_count": len(created_links),
        "skipped_count": len(skipped),
        "created_links": created_links,
        "skipped": skipped
    }


@router.get("/{evidence_id}/incidents")
def get_evidence_incident_links(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    links = db.query(EvidenceIncidentLink).options(
        joinedload(EvidenceIncidentLink.incident)
    ).filter(
        EvidenceIncidentLink.evidence_id == evidence_id
    ).all()
    
    return {
        "evidence_id": evidence_id,
        "evidence_name": evidence.name,
        "total_links": len(links),
        "links": [
            {
                "id": link.id,
                "incident_id": link.incident_id,
                "link_type": link.link_type,
                "created_at": link.created_at.isoformat() if link.created_at else None,
                "incident": serialize_incident(link.incident) if link.incident else None
            }
            for link in links
        ]
    }


@router.delete("/{evidence_id}/incidents/{link_id}")
def delete_evidence_incident_link(
    evidence_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    link = db.query(EvidenceIncidentLink).filter(
        EvidenceIncidentLink.id == link_id,
        EvidenceIncidentLink.evidence_id == evidence_id
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident link not found"
        )
    
    db.delete(link)
    db.commit()
    
    return {"message": "Incident link removed successfully"}


@router.post("/{evidence_id}/policy-statements", status_code=status.HTTP_201_CREATED)
def link_evidence_to_policy_statements(
    evidence_id: int,
    link_data: PolicyStatementLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    user_tenants = get_user_tenants(current_user, db)
    
    created_links = []
    skipped = []
    
    for statement_id in link_data.statement_ids:
        statement = db.query(PolicyStatement).filter(
            PolicyStatement.id == statement_id,
            PolicyStatement.tenant_id.in_(user_tenants)
        ).first()
        
        if not statement:
            skipped.append({"statement_id": statement_id, "reason": "Policy statement not found or access denied"})
            continue
        
        existing = db.query(EvidencePolicyLink).filter(
            EvidencePolicyLink.evidence_id == evidence_id,
            EvidencePolicyLink.policy_statement_id == statement_id
        ).first()
        
        if existing:
            skipped.append({"statement_id": statement_id, "reason": "Link already exists"})
            continue
        
        link = EvidencePolicyLink(
            evidence_id=evidence_id,
            policy_statement_id=statement_id,
            link_type=link_data.link_type,
            created_by=current_user.id,
            created_at=datetime.utcnow()
        )
        db.add(link)
        db.flush()
        
        created_links.append({
            "id": link.id,
            "evidence_id": evidence_id,
            "policy_statement_id": statement_id,
            "link_type": link.link_type,
            "policy_statement": serialize_policy_statement(statement)
        })
    
    db.commit()
    
    return {
        "evidence_id": evidence_id,
        "created_count": len(created_links),
        "skipped_count": len(skipped),
        "created_links": created_links,
        "skipped": skipped
    }


@router.get("/{evidence_id}/policy-statements")
def get_evidence_policy_statement_links(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    links = db.query(EvidencePolicyLink).options(
        joinedload(EvidencePolicyLink.policy_statement)
    ).filter(
        EvidencePolicyLink.evidence_id == evidence_id
    ).all()
    
    return {
        "evidence_id": evidence_id,
        "evidence_name": evidence.name,
        "total_links": len(links),
        "links": [
            {
                "id": link.id,
                "policy_statement_id": link.policy_statement_id,
                "link_type": link.link_type,
                "created_at": link.created_at.isoformat() if link.created_at else None,
                "policy_statement": serialize_policy_statement(link.policy_statement) if link.policy_statement else None
            }
            for link in links
        ]
    }


@router.delete("/{evidence_id}/policy-statements/{link_id}")
def delete_evidence_policy_statement_link(
    evidence_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    link = db.query(EvidencePolicyLink).filter(
        EvidencePolicyLink.id == link_id,
        EvidencePolicyLink.evidence_id == evidence_id
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy statement link not found"
        )
    
    db.delete(link)
    db.commit()
    
    return {"message": "Policy statement link removed successfully"}


@router.get("/{evidence_id}/all-links")
def get_all_evidence_links(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = get_evidence_with_tenant_check(evidence_id, current_user, db)
    
    risk_links = db.query(RiskEvidenceLink).options(
        joinedload(RiskEvidenceLink.risk)
    ).filter(RiskEvidenceLink.evidence_id == evidence_id).all()
    
    asset_links = db.query(AssetEvidenceLink).options(
        joinedload(AssetEvidenceLink.asset)
    ).filter(AssetEvidenceLink.evidence_id == evidence_id).all()
    
    incident_links = db.query(EvidenceIncidentLink).options(
        joinedload(EvidenceIncidentLink.incident)
    ).filter(EvidenceIncidentLink.evidence_id == evidence_id).all()
    
    policy_links = db.query(EvidencePolicyLink).options(
        joinedload(EvidencePolicyLink.policy_statement)
    ).filter(EvidencePolicyLink.evidence_id == evidence_id).all()
    
    return {
        "evidence_id": evidence_id,
        "evidence_name": evidence.name,
        "risks": {
            "total": len(risk_links),
            "links": [
                {
                    "id": link.id,
                    "risk_id": link.risk_id,
                    "risk": serialize_risk(link.risk) if link.risk else None
                }
                for link in risk_links
            ]
        },
        "assets": {
            "total": len(asset_links),
            "links": [
                {
                    "id": link.id,
                    "asset_id": link.asset_id,
                    "link_type": link.relationship_type,
                    "asset": serialize_asset(link.asset) if link.asset else None
                }
                for link in asset_links
            ]
        },
        "incidents": {
            "total": len(incident_links),
            "links": [
                {
                    "id": link.id,
                    "incident_id": link.incident_id,
                    "link_type": link.link_type,
                    "created_at": link.created_at.isoformat() if link.created_at else None,
                    "incident": serialize_incident(link.incident) if link.incident else None
                }
                for link in incident_links
            ]
        },
        "policy_statements": {
            "total": len(policy_links),
            "links": [
                {
                    "id": link.id,
                    "policy_statement_id": link.policy_statement_id,
                    "link_type": link.link_type,
                    "created_at": link.created_at.isoformat() if link.created_at else None,
                    "policy_statement": serialize_policy_statement(link.policy_statement) if link.policy_statement else None
                }
                for link in policy_links
            ]
        },
        "total_links": len(risk_links) + len(asset_links) + len(incident_links) + len(policy_links)
    }
