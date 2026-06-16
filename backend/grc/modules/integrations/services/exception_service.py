import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from grc.models import (
    IntegrationConnection,
    IntegrationAuditLog,
    OutboundExceptionRequest,
    Vulnerability,
    GRCUser,
)
from .sync_service import SyncService

logger = logging.getLogger(__name__)

VALID_EXCEPTION_TYPES = ("false_positive", "risk_accepted", "deferred")
VALID_REASONS = (
    "compensating_control", "not_applicable", "accepted_risk",
    "false_positive_confirmed", "deferred_to_next_cycle", "other",
)


class ExceptionService:

    @staticmethod
    def create_exception_request(
        db: Session,
        tenant_id: int,
        vulnerability_id: int,
        connection_id: int,
        exception_type: str,
        reason: str,
        justification: str,
        requested_by_user_id: int,
        expires_at: Optional[datetime] = None,
    ) -> OutboundExceptionRequest:
        if exception_type not in VALID_EXCEPTION_TYPES:
            raise ValueError(f"Invalid exception type. Must be one of: {VALID_EXCEPTION_TYPES}")
        if reason not in VALID_REASONS:
            raise ValueError(f"Invalid reason. Must be one of: {VALID_REASONS}")

        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == vulnerability_id,
            Vulnerability.tenant_id == tenant_id,
        ).first()
        if not vuln:
            raise ValueError("Vulnerability not found")

        conn = db.query(IntegrationConnection).filter(
            IntegrationConnection.id == connection_id,
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.is_active == True,
        ).first()
        if not conn:
            raise ValueError("Integration connection not found or inactive")

        existing = db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.tenant_id == tenant_id,
            OutboundExceptionRequest.vulnerability_id == vulnerability_id,
            OutboundExceptionRequest.status.in_(["pending_approval", "approved"]),
        ).first()
        if existing:
            raise ValueError("An active exception request already exists for this vulnerability")

        request = OutboundExceptionRequest(
            tenant_id=tenant_id,
            vulnerability_id=vulnerability_id,
            connection_id=connection_id,
            exception_type=exception_type,
            reason=reason,
            justification=justification,
            requested_by_user_id=requested_by_user_id,
            expires_at=expires_at,
            status="pending_approval",
        )
        db.add(request)
        db.commit()
        db.refresh(request)

        SyncService._audit(
            db, tenant_id, "exception_request", request.id, "create",
            performed_by_user_id=requested_by_user_id,
            details={
                "vulnerability_id": vulnerability_id,
                "exception_type": exception_type,
                "reason": reason,
            },
        )

        return request

    @staticmethod
    def approve_exception(
        db: Session,
        tenant_id: int,
        exception_id: int,
        reviewed_by_user_id: int,
        review_notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        request = db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.id == exception_id,
            OutboundExceptionRequest.tenant_id == tenant_id,
            OutboundExceptionRequest.status == "pending_approval",
        ).first()
        if not request:
            raise ValueError("Exception request not found or not pending approval")

        request.status = "approved"
        request.reviewed_by_user_id = reviewed_by_user_id
        request.reviewed_at = datetime.utcnow()
        request.review_notes = review_notes
        request.updated_at = datetime.utcnow()
        db.commit()

        push_result = ExceptionService._push_to_scanner(db, request)

        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == request.vulnerability_id,
        ).first()
        if vuln:
            vuln.status = request.exception_type
            vuln.updated_at = datetime.utcnow()
            if request.exception_type == "deferred" and request.expires_at:
                vuln.deferred_until = request.expires_at
            db.commit()

        SyncService._audit(
            db, tenant_id, "exception_request", request.id, "approve",
            performed_by_user_id=reviewed_by_user_id,
            details={"review_notes": review_notes, "push_result": push_result},
        )

        ExceptionService._send_exception_notification(db, request, "approved")

        return {
            "id": request.id,
            "status": request.status,
            "push_status": request.push_status,
            "push_error": request.push_error,
        }

    @staticmethod
    def reject_exception(
        db: Session,
        tenant_id: int,
        exception_id: int,
        reviewed_by_user_id: int,
        review_notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        request = db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.id == exception_id,
            OutboundExceptionRequest.tenant_id == tenant_id,
            OutboundExceptionRequest.status == "pending_approval",
        ).first()
        if not request:
            raise ValueError("Exception request not found or not pending approval")

        request.status = "rejected"
        request.reviewed_by_user_id = reviewed_by_user_id
        request.reviewed_at = datetime.utcnow()
        request.review_notes = review_notes
        request.updated_at = datetime.utcnow()
        db.commit()

        SyncService._audit(
            db, tenant_id, "exception_request", request.id, "reject",
            performed_by_user_id=reviewed_by_user_id,
            details={"review_notes": review_notes},
        )

        ExceptionService._send_exception_notification(db, request, "rejected")

        return {"id": request.id, "status": "rejected"}

    @staticmethod
    def _push_to_scanner(db: Session, request: OutboundExceptionRequest) -> Dict[str, Any]:
        try:
            conn = db.query(IntegrationConnection).filter(
                IntegrationConnection.id == request.connection_id,
            ).first()
            if not conn:
                request.push_status = "failed"
                request.push_error = "Connection not found"
                db.commit()
                return {"success": False, "error": "Connection not found"}

            adapter = SyncService.build_adapter(conn)

            vuln = db.query(Vulnerability).filter(
                Vulnerability.id == request.vulnerability_id,
            ).first()

            reason_map = {
                "false_positive": "False Positive",
                "risk_accepted": "Acceptable Risk",
                "deferred": "Other",
            }

            payload = {
                "type": "Global",
                "reason": reason_map.get(request.exception_type, "Other"),
                "scope": {
                    "vulnerability": vuln.external_vuln_id if vuln else str(request.vulnerability_id),
                },
                "comment": request.justification[:1000],
                "state": "Under Review",
            }
            if request.expires_at:
                payload["expires"] = request.expires_at.isoformat()

            result = adapter.create_exception(payload)
            scanner_exception_id = str(result.get("id", ""))
            result_status = result.get("status", "")

            request.nexpose_exception_id = scanner_exception_id
            request.pushed_at = datetime.utcnow()
            request.updated_at = datetime.utcnow()

            if result_status == "logged_locally":
                request.push_status = "local_only"
                request.push_error = result.get("message", "Exception recorded locally only")
                db.commit()
                return {"success": False, "scanner_exception_id": scanner_exception_id, "push_status": "local_only"}

            request.push_status = "pushed"
            db.commit()

            return {"success": True, "scanner_exception_id": scanner_exception_id}

        except Exception as e:
            logger.error(f"Failed to push exception to scanner: {e}")
            request.push_status = "failed"
            request.push_error = str(e)[:500]
            request.updated_at = datetime.utcnow()
            db.commit()
            return {"success": False, "error": str(e)[:500]}

    @staticmethod
    def revoke_exception(
        db: Session,
        tenant_id: int,
        exception_id: int,
        revoked_by_user_id: int,
        revoke_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        request = db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.id == exception_id,
            OutboundExceptionRequest.tenant_id == tenant_id,
            OutboundExceptionRequest.status == "approved",
        ).first()
        if not request:
            raise ValueError("Exception request not found or not in approved state")

        if request.nexpose_exception_id and request.push_status == "pushed":
            try:
                conn = db.query(IntegrationConnection).filter(
                    IntegrationConnection.id == request.connection_id,
                ).first()
                if conn:
                    adapter = SyncService.build_adapter(conn)
                    adapter.delete_exception(request.nexpose_exception_id)
            except Exception as e:
                logger.error(f"Failed to delete scanner exception {request.nexpose_exception_id}: {e}")

        request.status = "revoked"
        request.review_notes = f"Revoked: {revoke_reason}" if revoke_reason else "Revoked"
        request.updated_at = datetime.utcnow()

        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == request.vulnerability_id,
        ).first()
        if vuln:
            vuln.status = "open"
            vuln.updated_at = datetime.utcnow()

        db.commit()

        SyncService._audit(
            db, tenant_id, "exception_request", request.id, "revoke",
            performed_by_user_id=revoked_by_user_id,
            details={"revoke_reason": revoke_reason},
        )

        return {"id": request.id, "status": "revoked"}

    @staticmethod
    def withdraw_exception(
        db: Session,
        tenant_id: int,
        exception_id: int,
        user_id: int,
    ) -> Dict[str, Any]:
        request = db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.id == exception_id,
            OutboundExceptionRequest.tenant_id == tenant_id,
            OutboundExceptionRequest.status == "pending_approval",
            OutboundExceptionRequest.requested_by_user_id == user_id,
        ).first()
        if not request:
            raise ValueError("Exception request not found, not pending, or not owned by you")

        request.status = "withdrawn"
        request.updated_at = datetime.utcnow()
        db.commit()

        SyncService._audit(
            db, tenant_id, "exception_request", request.id, "withdraw",
            performed_by_user_id=user_id,
        )

        return {"id": request.id, "status": "withdrawn"}

    @staticmethod
    def _send_exception_notification(
        db: Session,
        request: OutboundExceptionRequest,
        action: str,
    ):
        try:
            from grc.modules.vuln_management.services.notification_service import NotificationService

            vuln = db.query(Vulnerability).filter(
                Vulnerability.id == request.vulnerability_id,
            ).first()
            if not vuln:
                return

            if action == "approved":
                NotificationService.create_notification(
                    db,
                    tenant_id=vuln.tenant_id,
                    vulnerability_id=vuln.id,
                    notification_type="status_change",
                    title=f"Exception Approved: {vuln.title or vuln.vuln_id}",
                    message=f"Your {request.exception_type} exception for vulnerability {vuln.vuln_id} has been approved.",
                    recipient_user_id=request.requested_by_user_id,
                    triggered_by_user_id=request.reviewed_by_user_id,
                )
            elif action == "rejected":
                NotificationService.create_notification(
                    db,
                    tenant_id=vuln.tenant_id,
                    vulnerability_id=vuln.id,
                    notification_type="status_change",
                    title=f"Exception Rejected: {vuln.title or vuln.vuln_id}",
                    message=f"Your {request.exception_type} exception for vulnerability {vuln.vuln_id} has been rejected.{(' Reason: ' + request.review_notes) if request.review_notes else ''}",
                    recipient_user_id=request.requested_by_user_id,
                    triggered_by_user_id=request.reviewed_by_user_id,
                )
        except Exception as e:
            logger.error(f"Failed to send exception notification: {e}")

    @staticmethod
    def list_exception_requests(
        db: Session,
        tenant_id: int,
        status: Optional[str] = None,
        vulnerability_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[OutboundExceptionRequest], int]:
        query = db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.tenant_id == tenant_id,
        )
        if status:
            query = query.filter(OutboundExceptionRequest.status == status)
        if vulnerability_id:
            query = query.filter(OutboundExceptionRequest.vulnerability_id == vulnerability_id)

        total = query.count()
        records = query.order_by(OutboundExceptionRequest.created_at.desc()).offset(offset).limit(limit).all()
        return records, total

    @staticmethod
    def get_exception_request(
        db: Session,
        tenant_id: int,
        exception_id: int,
    ) -> Optional[OutboundExceptionRequest]:
        return db.query(OutboundExceptionRequest).filter(
            OutboundExceptionRequest.id == exception_id,
            OutboundExceptionRequest.tenant_id == tenant_id,
        ).first()
