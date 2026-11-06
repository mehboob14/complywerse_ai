"""Demo data for trying the audit register: risks, and the hosts the pen test names.

A fresh tenant has no risk register and no asset inventory, so suggestions and
automatic linking have nothing to find. This adds a small, clearly tagged set —
bank-relevant ERM risks, and IT assets plus matching vulnerabilities for the
hosts the imported pen-test findings name — then re-runs the linking.
Everything it creates is tagged and `cleanup` removes exactly that.

    python -m grc.tools.audit_register_demo seed --tenant cfsb
    python -m grc.tools.audit_register_demo cleanup --tenant cfsb
"""
from __future__ import annotations

from typing import Dict

from sqlalchemy.orm import Session

DEMO_TAG = "demo:audit-register"
_ASSET_NOTE = "[demo] Added to try the audit register's automatic linking."

_RISKS = [
    ("Enterprise risk management programme is ineffective", "strategic",
     "Board and management oversight of enterprise risk is not prioritised, limiting the "
     "identification and escalation of material risks."),
    ("Third-party risk is not identified or monitored", "operational",
     "Vendor due diligence, contract oversight and ongoing monitoring of third parties are "
     "incomplete."),
    ("Sanctions screening backlog leaves alerts undispositioned", "compliance",
     "OFAC and sanctions screening alerts are not reviewed and closed in a timely way."),
    ("BSA/AML transaction monitoring gaps", "compliance",
     "Suspicious activity monitoring and customer due diligence do not cover all products."),
    ("Weak identity and access management on cloud consoles", "technology",
     "IAM password policy, multi-factor authentication and privileged access on cloud "
     "consoles do not meet the bank's standard."),
    ("Cloud configuration drift and logging gaps", "technology",
     "Cloud resources are not configured to baseline and security logging is incomplete."),
    ("Staff training is not assigned by role", "operational",
     "Required training is assigned manually, so employees may miss role-based courses."),
    ("Data backup and recovery is not tested", "operational",
     "Backups are not stored apart from primary systems and restores are not exercised."),
]


def _demo_hosts(db: Session, tenant_id: int) -> Dict[str, tuple]:
    """Hosts the imported pen-test findings name → one finding's title and rating."""
    from ....models import AuditIssueProfile
    from .linkage import hosts_named_by

    hosts: Dict[str, tuple] = {}
    for profile in (db.query(AuditIssueProfile)
                    .filter(AuditIssueProfile.tenant_id == tenant_id,
                            AuditIssueProfile.source == "it_pen").all()):
        for host in hosts_named_by(profile)[:3]:
            hosts.setdefault(host, (profile.issue.title, profile.risk_rating))
    return dict(list(hosts.items())[:15])


def seed(db: Session, tenant_id: int) -> Dict[str, int]:
    from ....models import ITAsset, Risk, Vulnerability

    made = {"risks": 0, "assets": 0, "vulnerabilities": 0}
    for title, category, description in _RISKS:
        if not db.query(Risk).filter(Risk.tenant_id == tenant_id, Risk.title == title).first():
            db.add(Risk(tenant_id=tenant_id, title=title, category=category,
                        risk_category=category, description=description,
                        source_type="demo", source_reference=DEMO_TAG, status="open"))
            made["risks"] += 1

    known_assets = {a.host_name for a in db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id)}
    for number, (host, (title, rating)) in enumerate(_demo_hosts(db, tenant_id).items(), start=1):
        if host not in known_assets:
            db.add(ITAsset(tenant_id=tenant_id, name=host, host_name=host, asset_type="server",
                           description=_ASSET_NOTE))
            made["assets"] += 1
        vuln_id = f"DEMO-{number:03d}"
        if not db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id,
                                              Vulnerability.vuln_id == vuln_id).first():
            severity = {"high": "high", "moderate": "medium", "medium": "medium"}.get(
                str(rating or "").lower(), "low")
            db.add(Vulnerability(tenant_id=tenant_id, vuln_id=vuln_id, title=title,
                                 severity=severity, affected_host=host,
                                 description="[demo] Matches an audit-register pen-test finding."))
            made["vulnerabilities"] += 1
    db.flush()
    return made


def relink(db: Session, tenant_id: int) -> Dict[str, int]:
    from ....models import AuditIssueProfile
    from .linkage import (build_asset_index, build_vendor_index, build_vulnerability_index,
                          link_issue)

    assets, vendors = build_asset_index(db), build_vendor_index(db)
    vulnerabilities = build_vulnerability_index(db)
    made = {"assets": 0, "vulnerabilities": 0, "vendors": 0}
    for profile in db.query(AuditIssueProfile).filter(AuditIssueProfile.tenant_id == tenant_id,
                                                      AuditIssueProfile.deleted_at.is_(None)):
        for kind, count in link_issue(db, profile.issue, profile, assets=assets, vendors=vendors,
                                      vulnerabilities=vulnerabilities).items():
            made[kind] += count
    return made


def cleanup(db: Session, tenant_id: int) -> Dict[str, int]:
    from ....models import (IssueAssetLink, IssueRiskLink, IssueVulnerabilityLink, ITAsset,
                            Risk, Vulnerability)

    risks = [r.id for r in db.query(Risk).filter(Risk.tenant_id == tenant_id,
                                                  Risk.source_reference == DEMO_TAG)]
    assets = [a.id for a in db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id,
                                                     ITAsset.description == _ASSET_NOTE)]
    vulns = [v.id for v in db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id,
                                                          Vulnerability.vuln_id.like("DEMO-%"))]
    db.query(IssueRiskLink).filter(IssueRiskLink.risk_id.in_(risks)).delete(synchronize_session=False)
    db.query(IssueAssetLink).filter(IssueAssetLink.asset_id.in_(assets)).delete(synchronize_session=False)
    db.query(IssueVulnerabilityLink).filter(
        IssueVulnerabilityLink.vulnerability_id.in_(vulns)).delete(synchronize_session=False)
    db.query(Risk).filter(Risk.id.in_(risks)).delete(synchronize_session=False)
    db.query(ITAsset).filter(ITAsset.id.in_(assets)).delete(synchronize_session=False)
    db.query(Vulnerability).filter(Vulnerability.id.in_(vulns)).delete(synchronize_session=False)
    return {"risks": len(risks), "assets": len(assets), "vulnerabilities": len(vulns)}
