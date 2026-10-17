"""Read and verify electronic signatures (services/esign.py). Signing itself happens in the sign-off and
attestation endpoints, which keep the signature with their own record."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ....models import ElectronicSignature, GovernanceDocument, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from ....services import esign
from ..permissions import ensure_reader

router = APIRouter(prefix="/esignatures", tags=["Governance - Electronic signatures"])


def _own(db: Session, signature_id: int, user: GRCUser) -> ElectronicSignature:
    sig = db.query(ElectronicSignature).filter(
        ElectronicSignature.id == signature_id, ElectronicSignature.tenant_id.in_(get_user_tenants(user, db) or [])
    ).first()
    if not sig:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signature not found")
    document = db.get(GovernanceDocument, sig.document_id) if sig.document_id else None
    if document is not None:
        ensure_reader(db, user, document)          # a signature on a document is shown to whoever may read the document
    return sig


@router.get("/{signature_id}")
def get_signature(signature_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Who signed what and when, the fingerprints, and whether the signature still verifies."""
    sig = _own(db, signature_id, current_user)
    document = db.get(GovernanceDocument, sig.document_id) if sig.document_id else None
    return {
        "id": sig.id, "record_type": sig.record_type, "record_id": sig.record_id,
        "document_id": sig.document_id, "document_version": sig.document_version,
        "signer_name": sig.signer_name, "signer_email": sig.signer_email, "signer_title": sig.signer_title,
        "meaning": sig.meaning, "method": "drawn",
        "signed_at": sig.signed_at.isoformat(), "ip_address": sig.ip_address, "user_agent": sig.user_agent,
        "image_sha256": sig.image_sha256, "content_sha256": sig.content_sha256, "seal": sig.seal,
        **esign.verify(sig, document),
    }


@router.get("/{signature_id}/image")
def get_signature_image(signature_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    sig = _own(db, signature_id, current_user)
    return Response(content=sig.image_png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
