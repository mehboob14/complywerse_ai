"""Vendor exchange — 'complete once, reuse across buyers' (Whistic/CyberGRX-style).

The platform is per-database-per-tenant, so there is no live cross-tenant store. The
exchange therefore works two ways, both additive and isolation-safe:

  • PUBLISH a completed assessment as a reusable ``TPRASharedAssessment`` snapshot
    (the vendor's answers + evidence count + a validation snapshot + a share token).
  • REUSE it — intra-tenant by share token, or across tenants via a portable JSON
    PACKAGE (export from the publisher, import into the buyer). Importing pre-fills a
    new assessment's questionnaire; the BUYER then re-scores with their own governed
    engine (the publisher's score travels only as advisory context).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ....models import (
    Vendor, VendorAssessment, VendorQuestionnaireTemplate, VendorQuestionnaireResponse,
    TPRAEvidenceLink, TPRASharedAssessment,
)
from . import service

PACKAGE_FORMAT = "tpra-shared-assessment/v1"


def publish_shared_assessment(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int],
    expires_days: int = 180,
) -> TPRASharedAssessment:
    """Snapshot a completed assessment into a reusable shared assessment. Requires the
    vendor's questionnaire answers to exist (there must be something to reuse)."""
    qr = service._latest_submitted_questionnaire(db, assessment.id)
    responses = (qr.responses or {}) if qr else {}
    if not responses:
        raise ValueError("Nothing to publish — the assessment has no submitted questionnaire answers.")
    template = None
    if assessment.template_id:
        template = (
            db.query(VendorQuestionnaireTemplate)
            .filter(VendorQuestionnaireTemplate.id == assessment.template_id)
            .first()
        )
    evidence_count = (
        db.query(TPRAEvidenceLink.id)
        .filter(TPRAEvidenceLink.assessment_id == assessment.id, TPRAEvidenceLink.deleted_at.is_(None))
        .count()
    )
    now = datetime.utcnow()
    shared = TPRASharedAssessment(
        tenant_id=assessment.tenant_id, vendor_id=vendor.id,
        source_assessment_id=assessment.id, vendor_name=vendor.name,
        template_id=assessment.template_id,
        template_name=(template.name if template else None),
        responses=responses,
        inherent_tier=assessment.inherent_tier,
        residual_score=assessment.residual_score,
        residual_rating=assessment.residual_rating,
        domain_scores=assessment.domain_scores or {},
        evidence_count=int(evidence_count or 0),
        validated_by=actor_id, validated_at=now,
        share_token=uuid.uuid4().hex, status="active",
        expires_at=now + timedelta(days=max(1, int(expires_days or 180))),
        created_by=actor_id,
    )
    db.add(shared)
    db.flush()
    service.write_audit(
        db, assessment.tenant_id, entity="shared_assessment", action="create",
        vendor_id=vendor.id, assessment_id=assessment.id, entity_id=shared.id,
        actor_id=actor_id, to_value=shared.share_token,
    )
    return shared


def to_package(shared: TPRASharedAssessment) -> dict:
    """Portable, JSON-serializable package for cross-tenant transfer."""
    return {
        "format": PACKAGE_FORMAT,
        "share_token": shared.share_token,
        "vendor_name": shared.vendor_name,
        "template_id": shared.template_id,
        "template_name": shared.template_name,
        "responses": shared.responses or {},
        "inherent_tier": shared.inherent_tier,
        "residual_score": shared.residual_score,
        "residual_rating": shared.residual_rating,
        "domain_scores": shared.domain_scores or {},
        "evidence_count": shared.evidence_count,
        "validated_at": shared.validated_at.isoformat() if shared.validated_at else None,
        "expires_at": shared.expires_at.isoformat() if shared.expires_at else None,
        "published_at": shared.created_at.isoformat() if shared.created_at else None,
    }


def import_into_assessment(
    db: Session, vendor: Vendor, target: VendorAssessment, *,
    responses: dict, template_id: Optional[int], template_name: Optional[str],
    source_label: str, actor_id: Optional[int],
) -> VendorQuestionnaireResponse:
    """Pre-fill a target assessment's questionnaire with imported answers so the BUYER
    can re-score them with their own governed engine. No publisher score is carried."""
    if not responses:
        raise ValueError("The shared assessment has no responses to import.")
    if template_id and not target.template_id:
        target.template_id = template_id
    qr = VendorQuestionnaireResponse(
        tenant_id=target.tenant_id, vendor_id=vendor.id, assessment_id=target.id,
        template_id=target.template_id or template_id,
        respondent_name=(f"Imported from exchange ({source_label})")[:255],
        responses=responses, status="submitted", submitted_at=datetime.utcnow(),
        token=uuid.uuid4().hex,
    )
    db.add(qr)
    db.flush()
    service.write_audit(
        db, target.tenant_id, entity="assessment", action="import",
        vendor_id=vendor.id, assessment_id=target.id, actor_id=actor_id,
        to_value=source_label, extra={"imported_responses": len(responses), "source": source_label},
    )
    return qr
