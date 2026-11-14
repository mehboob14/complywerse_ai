"""Advisory → Vulnerability bridge and shared helpers.

The bridge is the link that keeps the Advisory feature "part of ComplyVerse": each
advisory CVE becomes a general ``Vulnerability`` row, so it inherits enrichment
(NVD/EPSS/KEV), asset matching, SLA, tickets and the detail page — exactly like
the proven NCA register bridge (``routers/nca_vuln_router.py``).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ...models import Vulnerability, VulnerabilitySLAConfig
from .models import Advisory, AdvisoryCve

logger = logging.getLogger(__name__)

_DEFAULT_SLA = {"critical": 7, "high": 30, "medium": 90, "low": 180, "info": 365}
_VALID_SEVERITY = set(_DEFAULT_SLA)


def normalise_severity(value: Optional[str]) -> str:
    """Coerce a free-form advisory severity to the platform's band."""
    sev = (value or "").strip().lower()
    return sev if sev in _VALID_SEVERITY else "medium"


def get_sla_days(tenant_id: int, severity: str, db: Session) -> int:
    """Tenant SLA config for this severity, else the platform default."""
    sla = (
        db.query(VulnerabilitySLAConfig)
        .filter(
            VulnerabilitySLAConfig.tenant_id == tenant_id,
            VulnerabilitySLAConfig.severity == severity,
            VulnerabilitySLAConfig.is_active == True,  # noqa: E712
        )
        .first()
    )
    if sla:
        return sla.remediation_days
    return _DEFAULT_SLA.get(severity, 90)


def _next_vuln_id(tenant_id: int, db: Session) -> str:
    count = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id).count()
    return f"VULN-{count + 1:05d}"


def _dispatch_enrich(tenant_id: int, vuln_id: int) -> None:
    """Best-effort async enrichment (NVD → CPE match → EPSS/KEV). A broker
    outage never blocks the advisory; the daily refresh backstops it."""
    try:
        from ...db import MasterSession
        from ...models import Tenant

        session = MasterSession()
        try:
            row = session.query(Tenant.slug).filter(Tenant.id == tenant_id).first()
        finally:
            session.close()
        slug = row[0] if row and row[0] else None
    except Exception:
        logger.debug("advisory: tenant slug lookup failed tenant=%s", tenant_id)
        return

    if not slug:
        return
    try:
        from ...tasks.vulnerabilities import enrich_vuln
        enrich_vuln.delay(tenant_slug=slug, vuln_id=vuln_id)
    except Exception:
        logger.debug("advisory: enrich dispatch skipped (no broker?) vuln=%s", vuln_id)


def bridge_cve(advisory: Advisory, cve_row: AdvisoryCve, db: Session) -> Vulnerability:
    """Create or update the backing ``Vulnerability`` for one advisory CVE.

    Idempotent: re-runs update the existing bridged row rather than duplicate.
    Caller commits.
    """
    severity = normalise_severity(advisory.severity)
    template_fields = {
        "advisory_id": advisory.id,
        "advisory_external_id": advisory.external_id,
        "advisory_title": advisory.title,
        "affected_product": cve_row.affected_product,
        "affected_versions": cve_row.affected_versions,
        "source_url": advisory.url,
    }

    bridged: Optional[Vulnerability] = None
    if cve_row.bridged_vulnerability_id:
        bridged = (
            db.query(Vulnerability)
            .filter(Vulnerability.id == cve_row.bridged_vulnerability_id)
            .first()
        )

    if bridged is None:
        due_date = datetime.utcnow() + timedelta(
            days=get_sla_days(advisory.tenant_id, severity, db)
        )
        bridged = Vulnerability(
            tenant_id=advisory.tenant_id,
            vuln_id=_next_vuln_id(advisory.tenant_id, db),
            title=(advisory.title or cve_row.cve_id),
            description=advisory.summary,
            severity=severity,
            cve_id=cve_row.cve_id,
            affected_component=cve_row.affected_product,
            status="open",
            discovered_at=datetime.utcnow(),
            due_date=due_date,
            template_type="Advisory",
            template_fields=template_fields,
        )
        db.add(bridged)
        db.flush()  # populate id
        cve_row.bridged_vulnerability_id = bridged.id
    else:
        bridged.template_type = "Advisory"
        bridged.severity = severity
        bridged.cve_id = cve_row.cve_id or bridged.cve_id
        bridged.affected_component = cve_row.affected_product or bridged.affected_component
        bridged.template_fields = template_fields

    _dispatch_enrich(advisory.tenant_id, bridged.id)
    return bridged
