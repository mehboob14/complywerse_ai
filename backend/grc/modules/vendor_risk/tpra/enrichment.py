"""CLEAR due-diligence enrichment for TPRA (decision Q7; plan §6.5).

search → analyst picks the right candidate → report (immutable snapshot) → red
flags mapped to risk domains. Flags are ADVISORY (decision B): an analyst
promotes one with ``raise_finding``. GLB + DPPA permissible purposes are required
on every request (US law for CLEAR) and stored on the report for audit.
Callers own the commit.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ....models import (
    Vendor, TPRAFinding, TPRAVendorPerson, TPRAEnrichmentReport, TR_PROVIDER_CLEAR,
)
from ....integrations_tr import connections, registry
from ....integrations_tr.clear import derive_flags, risk_score
from . import service

logger = logging.getLogger(__name__)

SOURCE_LABEL = "Thomson Reuters CLEAR"
SEVERITIES = ("critical", "high", "medium", "low")


class EnrichmentError(ValueError):
    """User-correctable enrichment problem (HTTP 400)."""


def _conn(db: Session, tenant_id: int):
    return connections.require_active(db, tenant_id, TR_PROVIDER_CLEAR)


def _purpose(conn, glb: Optional[str], dppa: Optional[str]) -> dict:
    cfg = connections.effective_config(conn)
    glb = (glb or cfg.get("default_glb_purpose") or "").strip()
    dppa = (dppa or cfg.get("default_dppa_purpose") or "").strip()
    if not glb or not dppa:
        raise EnrichmentError("CLEAR requires a GLB and a DPPA permissible purpose for every search.")
    return {"glb": glb[:120], "dppa": dppa[:120]}


def _subject(db: Session, vendor: Vendor, person_id: Optional[int]):
    if person_id is None:
        return None, vendor.name
    p = db.query(TPRAVendorPerson).filter(TPRAVendorPerson.id == person_id, TPRAVendorPerson.vendor_id == vendor.id,
                                          TPRAVendorPerson.deleted_at.is_(None)).first()
    if p is None:
        raise EnrichmentError("Key person not found on this vendor.")
    return p, p.full_name


def search(db: Session, vendor: Vendor, *, person_id: Optional[int] = None, name: Optional[str] = None,
           glb: Optional[str] = None, dppa: Optional[str] = None) -> dict:
    conn = _conn(db, vendor.tenant_id)
    purpose = _purpose(conn, glb, dppa)
    person, default_name = _subject(db, vendor, person_id)
    query = (name or default_name or "").strip()
    if not query:
        raise EnrichmentError("A name to search is required.")
    client = registry.clear_client(conn)
    candidates = client.search(query, glb=purpose["glb"], dppa=purpose["dppa"], is_person=person is not None)
    connections.record_result(conn, True)
    return {"query": query, "candidates": candidates, "simulated": bool(client.simulated)}


def run_report(db: Session, vendor: Vendor, *, candidate_id: str, actor_id: Optional[int],
               person_id: Optional[int] = None, entity_name: Optional[str] = None,
               glb: Optional[str] = None, dppa: Optional[str] = None) -> TPRAEnrichmentReport:
    if not candidate_id:
        raise EnrichmentError("Pick the matching CLEAR record first.")
    conn = _conn(db, vendor.tenant_id)
    purpose = _purpose(conn, glb, dppa)
    person, default_name = _subject(db, vendor, person_id)
    client = registry.clear_client(conn)
    data = client.report(candidate_id, glb=purpose["glb"], dppa=purpose["dppa"], name=entity_name or default_name)
    flags = derive_flags(data.get("report") or {})
    connections.record_result(conn, True)
    rep = TPRAEnrichmentReport(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, person_id=person.id if person else None,
        provider=TR_PROVIDER_CLEAR, external_report_id=str(data.get("report_id") or candidate_id),
        candidate_id=candidate_id, entity_name=(entity_name or default_name)[:255],
        permissible_purpose=purpose, risk_score=risk_score(flags), flags=flags,
        summary=_summary(data.get("report") or {}), raw=json.dumps(data.get("report") or {})[:500000],
        requested_by=actor_id, fetched_at=datetime.utcnow(), simulated=bool(client.simulated),
    )
    db.add(rep)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="enrichment_report", action="create", vendor_id=vendor.id,
                        entity_id=rep.id, actor_id=actor_id, to_value=SOURCE_LABEL,
                        extra={"flags": [f["key"] for f in flags], "purpose": purpose,
                               "simulated": rep.simulated})
    return rep


def _summary(report: dict) -> dict:
    """Pull a few identity fields for the card header, wherever they sit."""
    wanted = {"name": ("Name", "BusinessName", "FullName"), "registration_number": ("RegistrationNumber",),
              "status": ("Status", "BusinessStatus"), "address": ("Address",)}
    out: dict = {}

    def visit(node):
        if isinstance(node, dict):
            for key, names in wanted.items():
                if key not in out:
                    for n in names:
                        if isinstance(node.get(n), str):
                            out[key] = node[n]
                            break
            for v in node.values():
                visit(v)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    visit(report)
    return out


def raise_finding(db: Session, report: TPRAEnrichmentReport, flag_key: str, *, actor_id: Optional[int],
                  severity: Optional[str] = None) -> TPRAFinding:
    flags = list(report.flags or [])
    idx = next((i for i, f in enumerate(flags) if f.get("key") == flag_key), None)
    if idx is None:
        raise EnrichmentError("Flag not found on this report.")
    flag = dict(flags[idx])
    if flag.get("finding_id"):
        f = db.query(TPRAFinding).filter(TPRAFinding.id == flag["finding_id"]).first()
        if f is not None and f.deleted_at is None:
            return f
    sev = (severity or flag["severity"]).lower()
    if sev not in SEVERITIES:
        raise EnrichmentError(f"severity must be one of {', '.join(SEVERITIES)}")
    vendor = db.query(Vendor).filter(Vendor.id == report.vendor_id).first()
    assessment = service.ensure_active_assessment(db, vendor, actor_id)
    f = TPRAFinding(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id, domain=flag["domain"],
        severity=sev, title=f"{flag['label']} — {report.entity_name or vendor.name}"[:255],
        description=(f"Raised from a {SOURCE_LABEL} due-diligence report "
                     f"(record {report.external_report_id}, {report.fetched_at:%Y-%m-%d}).\n{flag.get('detail') or ''}"
                     + ("\n[SIMULATED CLEAR data — not a real public-records result]" if report.simulated else "")),
        status="open", created_by=actor_id, is_critical_control_fail=(sev == "critical"),
    )
    db.add(f)
    db.flush()
    flag["finding_id"] = f.id
    flags[idx] = flag
    report.flags = flags  # reassign so the JSON change is persisted
    service.write_audit(db, vendor.tenant_id, entity="finding", action="create", vendor_id=vendor.id,
                        assessment_id=assessment.id, entity_id=f.id, actor_id=actor_id, to_value=f.title,
                        extra={"source": "clear", "report_id": report.id, "flag": flag_key})
    service.ensure_finding_issue(db, f, actor_id)
    if sev == "critical":
        service.enforce_critical_invariant(db, vendor, assessment, actor_id)
    return f


def list_reports(db: Session, vendor: Vendor) -> List[TPRAEnrichmentReport]:
    return (db.query(TPRAEnrichmentReport).filter(TPRAEnrichmentReport.vendor_id == vendor.id)
            .order_by(TPRAEnrichmentReport.fetched_at.desc()).all())
