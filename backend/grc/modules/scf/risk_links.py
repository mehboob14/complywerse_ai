"""SCF Stage E — risk ↔ control links via NormalizedControl bridge.

Decision 4: ``control_status`` is an **indicator only**. These helpers never
recalculate or mutate ``Risk.residual_score`` from failing controls.

Canonical link table is ``grc_risk_control_links`` (normalized_control_id only).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session, joinedload

from grc.models import (
    NormalizedControl,
    Risk,
    RiskControlLink,
    SCFControl,
)
from grc.modules.scf.custom_controls import get_custom
from grc.rich_audit import write_rich_audit_log


def ensure_normalized_for_control(
    db: Session,
    *,
    tenant_id: int,
    scf_id_or_code: str,
    release_id: Optional[int] = None,
) -> NormalizedControl:
    """Resolve or create the NC bridge row for an SCF / custom control code."""
    code = (scf_id_or_code or "").strip()
    if not code:
        raise ValueError("scf_id_or_code required")

    nc = (
        db.query(NormalizedControl)
        .filter(NormalizedControl.scf_id == code)
        .order_by(NormalizedControl.id.asc())
        .first()
    )
    if nc is not None:
        return nc

    custom = get_custom(db, tenant_id, code)
    if custom is not None:
        return custom

    q = db.query(SCFControl).filter(SCFControl.scf_id == code)
    if release_id is not None:
        q = q.filter(SCFControl.release_id == release_id)
    ctl = q.order_by(SCFControl.id.desc()).first()
    if ctl is None:
        raise ValueError(f"No SCF or custom control '{code}'")

    nc = NormalizedControl(
        code=f"SCF-{ctl.scf_id}"[:50],
        name=(ctl.name or ctl.scf_id)[:255],
        statement=ctl.description,
        objective=ctl.control_question,
        domain=(ctl.domain_name or "")[:255] if ctl.domain_name else None,
        source="scf",
        scf_id=ctl.scf_id,
    )
    db.add(nc)
    db.flush()
    return nc


def control_status_indicator(
    db: Session,
    nc: NormalizedControl,
    *,
    tenant_id: Optional[int] = None,
) -> str:
    """Best-effort automation status string. Never touches residual scores.

    Prefer the latest ``SCFCheckResult`` row per check for this control's
    ``scf_id`` (when ``tenant_id`` is known). Aggregate:
    any fail → ``failed``; any error → ``collection_failed``; all pass →
    ``passed``; mix → ``partial``; no results → ``not_run`` (custom without
    checks → ``manual``).
    """
    if (getattr(nc, "source", None) or "") == "custom":
        # Customs may still have check results if Stage G binds them later.
        scf_key = getattr(nc, "scf_id", None) or getattr(nc, "code", None)
    else:
        scf_key = getattr(nc, "scf_id", None)

    if not scf_key or tenant_id is None:
        return "manual" if (getattr(nc, "source", None) or "") == "custom" else "unknown"

    from grc.models import SCFCheckResult

    # Latest result per check_id (append-only table).
    rows = (
        db.query(SCFCheckResult.check_id, SCFCheckResult.status, SCFCheckResult.collected_at)
        .filter(
            SCFCheckResult.tenant_id == tenant_id,
            SCFCheckResult.scf_id == scf_key,
        )
        .order_by(SCFCheckResult.collected_at.desc())
        .all()
    )
    if not rows:
        return "manual" if (getattr(nc, "source", None) or "") == "custom" else "not_run"

    latest: Dict[str, str] = {}
    for check_id, status, _collected in rows:
        if check_id not in latest:
            latest[check_id] = (status or "").lower()

    statuses = set(latest.values())
    if "fail" in statuses:
        return "failed"
    if "error" in statuses:
        return "collection_failed"
    if statuses and statuses <= {"pass", "not_applicable"}:
        return "passed" if "pass" in statuses else "not_run"
    if "pass" in statuses and ({"fail", "error", "not_run"} & statuses):
        return "partial"
    if "pass" in statuses:
        return "partial"
    return "not_run"


def list_risks_for_control(db: Session, tenant_id: int, scf_id: str) -> List[Dict[str, Any]]:
    nc = ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=scf_id)
    status = control_status_indicator(db, nc, tenant_id=tenant_id)
    rows = (
        db.query(RiskControlLink)
        .options(
            joinedload(RiskControlLink.risk).joinedload(Risk.owner),
        )
        .join(Risk, Risk.id == RiskControlLink.risk_id)
        .filter(
            RiskControlLink.normalized_control_id == nc.id,
            Risk.tenant_id == tenant_id,
        )
        .all()
    )
    out: List[Dict[str, Any]] = []
    for link in rows:
        risk = link.risk
        if risk is None:
            continue
        owner_name = None
        if risk.owner is not None:
            owner_name = (
                getattr(risk.owner, "display_name", None)
                or getattr(risk.owner, "username", None)
                or getattr(risk.owner, "email", None)
            )
        out.append({
            "link_id": link.id,
            "risk_id": risk.id,
            "title": risk.title,
            "status": risk.status,
            "owner_name": owner_name,
            "inherent_score": risk.inherent_score,
            "residual_score": risk.residual_score,
            "control_status": status,
        })
    return out


def link_risk(
    db: Session,
    tenant_id: int,
    scf_id: str,
    risk_id: int,
    actor_id: Optional[int],
) -> RiskControlLink:
    nc = ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=scf_id)
    risk = (
        db.query(Risk)
        .filter(Risk.id == risk_id, Risk.tenant_id == tenant_id)
        .first()
    )
    if risk is None:
        raise ValueError(f"Risk {risk_id} not found for tenant")

    existing = (
        db.query(RiskControlLink)
        .filter(
            RiskControlLink.risk_id == risk_id,
            RiskControlLink.normalized_control_id == nc.id,
        )
        .first()
    )
    if existing is not None:
        return existing

    link = RiskControlLink(risk_id=risk_id, normalized_control_id=nc.id)
    db.add(link)
    db.flush()

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="risk_control_link",
        resource_type="risk_control_link",
        resource_id=link.id,
        resource_name=scf_id,
        summary=f"Linked risk {risk_id} to control {scf_id}",
        after={"risk_id": risk_id, "normalized_control_id": nc.id, "scf_id": scf_id},
    )
    return link


def unlink_risk(
    db: Session,
    tenant_id: int,
    scf_id: str,
    link_id: int,
    actor_id: Optional[int] = None,
) -> None:
    nc = ensure_normalized_for_control(db, tenant_id=tenant_id, scf_id_or_code=scf_id)
    link = (
        db.query(RiskControlLink)
        .join(Risk, Risk.id == RiskControlLink.risk_id)
        .filter(
            RiskControlLink.id == link_id,
            RiskControlLink.normalized_control_id == nc.id,
            Risk.tenant_id == tenant_id,
        )
        .first()
    )
    if link is None:
        raise ValueError(f"Link {link_id} not found for control {scf_id}")

    risk_id = link.risk_id
    db.delete(link)
    db.flush()

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=actor_id,
        action="risk_control_unlink",
        resource_type="risk_control_link",
        resource_id=link_id,
        resource_name=scf_id,
        summary=f"Unlinked risk {risk_id} from control {scf_id}",
        before={"risk_id": risk_id, "normalized_control_id": nc.id, "scf_id": scf_id},
    )


def scf_risk_prompts(
    db: Session,
    release_id: Optional[int],
    scf_id: str,
) -> Dict[str, Any]:
    """Verbatim SCF catalog risk/threat prompts (null/empty for custom)."""
    empty = {"risks": [], "threats": [], "risk_if_not_implemented": None}
    if release_id is None or not scf_id:
        return empty
    ctl = (
        db.query(SCFControl)
        .filter(SCFControl.release_id == release_id, SCFControl.scf_id == scf_id)
        .first()
    )
    if ctl is None:
        return empty
    risks = ctl.risks if isinstance(ctl.risks, list) else []
    threats = ctl.threats if isinstance(ctl.threats, list) else []
    return {
        "risks": risks,
        "threats": threats,
        "risk_if_not_implemented": ctl.risk_if_not_implemented,
    }
