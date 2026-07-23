"""
Seed sample data for the CompliverseAI GRC Platform demo / day-one experience.

This script populates:
  - NormalizedControls       (shared, global – controls_count in dashboard)
  - UploadedFrameworks       (tenant-visible frameworks, status=parsed → frameworks_count)
  - EvidenceControlMappings  (links evidence to framework controls → compliance coverage)
  - Risks                    (for both tenants)
  - InternalControls         (for both tenants)
  - VulnerabilityReport      (for tenant 1 – Layeron Group LLC)
  - Vulnerabilities          (linked to the report above)
  - ITAssets                 (for both tenants)
  - Evidence                 (for both tenants)

Safe to run multiple times – every entity is guarded by a check-before-insert.

Usage (from repo root):
    cd .migration-backup/backend
    python3 -m grc.seed_sample_data
"""

import os
import sys
import logging
from datetime import datetime, timedelta

from dotenv import load_dotenv

# ── resolve project root so the dotenv / imports work when run standalone ──
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
load_dotenv(os.path.join(_BACKEND, ".env"))

from .models import (
    SessionLocal,
    Tenant,
    GRCUser,
    NormalizedControl,
    Risk,
    InternalControl,
    VulnerabilityReport,
    Vulnerability,
    ITAsset,
    Evidence,
    UploadedFramework,
    EvidenceControlMapping,
    ParsedFrameworkControl,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_or_none(db, model, **kwargs):
    return db.query(model).filter_by(**kwargs).first()


# ─────────────────────────────────────────────────────────────────────────────
# 1.  NormalizedControls  (global, not tenant-scoped)
# ─────────────────────────────────────────────────────────────────────────────

NORMALIZED_CONTROLS = [
    {
        "code": "NC-ACC-001",
        "name": "Access Control Policy",
        "statement": "All systems must enforce role-based access controls with least-privilege principles.",
        "objective": "Prevent unauthorized access to systems and data.",
        "control_owner": "CISO",
        "maturity_level": 3,
    },
    {
        "code": "NC-ENC-001",
        "name": "Data Encryption at Rest",
        "statement": "Sensitive data must be encrypted at rest using AES-256 or equivalent.",
        "objective": "Protect data confidentiality in storage.",
        "control_owner": "Security Architecture",
        "maturity_level": 3,
    },
    {
        "code": "NC-ENC-002",
        "name": "Data Encryption in Transit",
        "statement": "All data in transit must use TLS 1.2 or higher.",
        "objective": "Protect data confidentiality during transmission.",
        "control_owner": "Network Security",
        "maturity_level": 4,
    },
    {
        "code": "NC-INC-001",
        "name": "Incident Response Plan",
        "statement": "An incident response plan must be maintained and tested annually.",
        "objective": "Ensure effective and timely response to security incidents.",
        "control_owner": "Security Operations",
        "maturity_level": 2,
    },
    {
        "code": "NC-LOG-001",
        "name": "Audit Logging and Monitoring",
        "statement": "All critical systems must generate audit logs retained for a minimum of 12 months.",
        "objective": "Detect and investigate security events.",
        "control_owner": "Security Operations",
        "maturity_level": 3,
    },
    {
        "code": "NC-BCM-001",
        "name": "Business Continuity Plan",
        "statement": "A BCP/DRP must be documented, approved, and tested at least annually.",
        "objective": "Ensure continuity of critical business operations.",
        "control_owner": "Risk Management",
        "maturity_level": 2,
    },
    {
        "code": "NC-VUL-001",
        "name": "Vulnerability Management",
        "statement": "Vulnerability scans must be conducted quarterly; critical findings remediated within 7 days.",
        "objective": "Identify and remediate technical vulnerabilities.",
        "control_owner": "IT Security",
        "maturity_level": 3,
    },
    {
        "code": "NC-CHG-001",
        "name": "Change Management",
        "statement": "All changes to production systems must follow the approved change management process.",
        "objective": "Prevent unauthorized or untested changes from impacting production.",
        "control_owner": "IT Operations",
        "maturity_level": 3,
    },
    {
        "code": "NC-TRN-001",
        "name": "Security Awareness Training",
        "statement": "All employees must complete mandatory security awareness training annually.",
        "objective": "Build a security-conscious workforce.",
        "control_owner": "HR / Security",
        "maturity_level": 2,
    },
    {
        "code": "NC-VEN-001",
        "name": "Third-Party Risk Management",
        "statement": "Third-party vendors with access to sensitive data must be assessed annually.",
        "objective": "Manage supply-chain and third-party security risks.",
        "control_owner": "Procurement / Risk",
        "maturity_level": 2,
    },
]


def seed_normalized_controls(db):
    seeded = 0
    for ctrl in NORMALIZED_CONTROLS:
        if not _get_or_none(db, NormalizedControl, code=ctrl["code"]):
            db.add(NormalizedControl(**ctrl, created_at=datetime.utcnow()))
            seeded += 1
    db.commit()
    log.info("NormalizedControls: seeded %d / %d", seeded, len(NORMALIZED_CONTROLS))


# ─────────────────────────────────────────────────────────────────────────────
# 2.  Risks
# ─────────────────────────────────────────────────────────────────────────────

RISKS_LAYERON = [
    {
        "title": "Ransomware Attack on Core Banking Systems",
        "description": "Threat actors may deploy ransomware targeting core banking infrastructure, resulting in prolonged system outages and data loss.",
        "category": "technology",
        "risk_category": "technology",
        "register_type": "ISO 27001",
        "inherent_likelihood": 3,
        "inherent_impact": 5,
        "inherent_score": 15.0,
        "residual_likelihood": 2,
        "residual_impact": 4,
        "residual_score": 8.0,
        "risk_appetite": "low",
        "status": "mitigating",
        "treatment_plan": "Deploy endpoint detection and response (EDR) tooling; implement offline backup strategy; conduct quarterly tabletop exercises.",
    },
    {
        "title": "Third-Party Vendor Data Breach",
        "description": "A key outsourcing partner handling customer data experiences a breach, exposing personal and financial records.",
        "category": "third_party",
        "risk_category": "third_party",
        "register_type": "GDPR",
        "inherent_likelihood": 3,
        "inherent_impact": 4,
        "inherent_score": 12.0,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "residual_score": 6.0,
        "risk_appetite": "low",
        "status": "under_review",
        "treatment_plan": "Enforce mandatory annual vendor security assessments; include contractual data processing obligations.",
    },
    {
        "title": "Regulatory Non-Compliance with GDPR",
        "description": "Inadequate data governance practices may result in GDPR enforcement actions including significant fines.",
        "category": "compliance",
        "risk_category": "compliance",
        "register_type": "GDPR",
        "inherent_likelihood": 2,
        "inherent_impact": 4,
        "inherent_score": 8.0,
        "residual_likelihood": 1,
        "residual_impact": 3,
        "residual_score": 3.0,
        "risk_appetite": "medium",
        "status": "identified",
        "treatment_plan": "Appoint a Data Protection Officer; complete Records of Processing Activities (RoPA); implement consent management.",
    },
    {
        "title": "Insider Threat – Privileged Account Misuse",
        "description": "Employees with elevated system privileges may intentionally or unintentionally misuse access rights to exfiltrate or alter sensitive data.",
        "category": "operational",
        "risk_category": "operational",
        "register_type": "Internal",
        "inherent_likelihood": 2,
        "inherent_impact": 5,
        "inherent_score": 10.0,
        "residual_likelihood": 1,
        "residual_impact": 4,
        "residual_score": 4.0,
        "risk_appetite": "low",
        "status": "mitigating",
        "treatment_plan": "Implement privileged access management (PAM); enforce segregation of duties; deploy UEBA monitoring.",
    },
    {
        "title": "Cloud Misconfiguration Leading to Data Exposure",
        "description": "Improperly configured cloud storage buckets or services expose sensitive customer data to the public internet.",
        "category": "technology",
        "risk_category": "technology",
        "register_type": "ISO 27001",
        "inherent_likelihood": 4,
        "inherent_impact": 4,
        "inherent_score": 16.0,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "residual_score": 6.0,
        "risk_appetite": "low",
        "status": "identified",
        "treatment_plan": "Deploy Cloud Security Posture Management (CSPM); enforce policy-as-code for cloud configurations.",
    },
    {
        "title": "Business Continuity Failure During Disaster",
        "description": "Inadequate disaster recovery procedures may lead to extended downtime during a natural disaster or major outage.",
        "category": "operational",
        "risk_category": "operational",
        "register_type": "Internal",
        "inherent_likelihood": 2,
        "inherent_impact": 5,
        "inherent_score": 10.0,
        "residual_likelihood": 1,
        "residual_impact": 4,
        "residual_score": 4.0,
        "risk_appetite": "medium",
        "status": "under_review",
        "treatment_plan": "Conduct annual BCP/DRP tests; maintain warm standby infrastructure; define clear RTOs and RPOs.",
    },
    {
        "title": "Phishing Campaign Targeting Finance Team",
        "description": "Sophisticated phishing emails targeting finance employees could result in fraudulent wire transfers or credential compromise.",
        "category": "operational",
        "risk_category": "operational",
        "register_type": "Internal",
        "inherent_likelihood": 4,
        "inherent_impact": 3,
        "inherent_score": 12.0,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "residual_score": 6.0,
        "risk_appetite": "medium",
        "status": "mitigating",
        "treatment_plan": "Deploy advanced email filtering; conduct quarterly phishing simulations; enforce MFA on all email accounts.",
    },
    {
        "title": "Strategic Risk: Failure to Meet Digital Transformation Goals",
        "description": "Inability to deliver planned digital transformation initiatives on time and within budget may undermine competitiveness.",
        "category": "strategic",
        "risk_category": "strategic",
        "register_type": "Internal",
        "inherent_likelihood": 3,
        "inherent_impact": 3,
        "inherent_score": 9.0,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "residual_score": 6.0,
        "risk_appetite": "medium",
        "status": "identified",
        "treatment_plan": "Establish a PMO; adopt agile delivery methodologies; track milestones via quarterly board reviews.",
    },
]

RISKS_TESTCORP = [
    {
        "title": "SQL Injection Vulnerability in Customer Portal",
        "description": "Unvalidated inputs in the customer portal allow attackers to execute arbitrary SQL against the database.",
        "category": "technology",
        "risk_category": "technology",
        "register_type": "PCI-DSS",
        "inherent_likelihood": 3,
        "inherent_impact": 5,
        "inherent_score": 15.0,
        "residual_likelihood": 1,
        "residual_impact": 4,
        "residual_score": 4.0,
        "risk_appetite": "low",
        "status": "mitigating",
        "treatment_plan": "Implement parameterized queries; deploy WAF; conduct web application penetration tests quarterly.",
    },
    {
        "title": "PCI DSS Scope Creep",
        "description": "Uncontrolled growth of the cardholder data environment (CDE) increases audit scope and compliance burden.",
        "category": "compliance",
        "risk_category": "compliance",
        "register_type": "PCI-DSS",
        "inherent_likelihood": 3,
        "inherent_impact": 3,
        "inherent_score": 9.0,
        "residual_likelihood": 2,
        "residual_impact": 2,
        "residual_score": 4.0,
        "risk_appetite": "medium",
        "status": "identified",
        "treatment_plan": "Implement network segmentation; tokenize cardholder data; maintain an up-to-date data flow diagram.",
    },
    {
        "title": "Weak Password Policy for Administrative Accounts",
        "description": "Administrators using weak or recycled passwords are vulnerable to credential stuffing and brute-force attacks.",
        "category": "technology",
        "risk_category": "technology",
        "register_type": "Internal",
        "inherent_likelihood": 4,
        "inherent_impact": 4,
        "inherent_score": 16.0,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "residual_score": 6.0,
        "risk_appetite": "low",
        "status": "under_review",
        "treatment_plan": "Enforce MFA and password manager adoption; implement password complexity policy; rotate credentials every 90 days.",
    },
    {
        "title": "Supply Chain Software Compromise",
        "description": "Use of open-source or third-party libraries with known vulnerabilities may be exploited to gain unauthorized access.",
        "category": "third_party",
        "risk_category": "third_party",
        "register_type": "Internal",
        "inherent_likelihood": 3,
        "inherent_impact": 4,
        "inherent_score": 12.0,
        "residual_likelihood": 2,
        "residual_impact": 3,
        "residual_score": 6.0,
        "risk_appetite": "medium",
        "status": "mitigating",
        "treatment_plan": "Implement software composition analysis (SCA); maintain a software bill of materials (SBOM).",
    },
    {
        "title": "Insufficient Audit Logging",
        "description": "Missing or incomplete audit logs prevent timely detection and forensic investigation of security incidents.",
        "category": "operational",
        "risk_category": "operational",
        "register_type": "PCI-DSS",
        "inherent_likelihood": 2,
        "inherent_impact": 3,
        "inherent_score": 6.0,
        "residual_likelihood": 1,
        "residual_impact": 2,
        "residual_score": 2.0,
        "risk_appetite": "medium",
        "status": "identified",
        "treatment_plan": "Centralize logs in a SIEM; define log retention policies; set up real-time alerting.",
    },
    {
        "title": "Data Residency Non-Compliance",
        "description": "Customer data processed or stored outside of mandated jurisdictions may violate data residency requirements.",
        "category": "compliance",
        "risk_category": "compliance",
        "register_type": "GDPR",
        "inherent_likelihood": 2,
        "inherent_impact": 4,
        "inherent_score": 8.0,
        "residual_likelihood": 1,
        "residual_impact": 3,
        "residual_score": 3.0,
        "risk_appetite": "low",
        "status": "identified",
        "treatment_plan": "Audit cloud provider regions; implement data residency tagging; update cloud service contracts.",
    },
]


def seed_risks(db, tenant_id: int, user_id: int, risks_data: list, label: str):
    existing = db.query(Risk).filter(Risk.tenant_id == tenant_id).count()
    if existing:
        log.info("Risks (%s): already have %d rows – skipping", label, existing)
        return
    now = datetime.utcnow()
    for r in risks_data:
        db.add(Risk(
            tenant_id=tenant_id,
            owner_id=user_id,
            created_at=now,
            updated_at=now,
            due_date=now + timedelta(days=90),
            review_date=now + timedelta(days=60),
            affected_department_ids=[],
            **r,
        ))
    db.commit()
    log.info("Risks (%s): seeded %d rows", label, len(risks_data))


# ─────────────────────────────────────────────────────────────────────────────
# 3.  Internal Controls
# ─────────────────────────────────────────────────────────────────────────────

INTERNAL_CONTROLS = [
    {
        "control_id": "IC-001",
        "name": "Multi-Factor Authentication Enforcement",
        "description": "All privileged and remote-access accounts must use MFA.",
        "category": "IT",
        "sub_category": "Identity & Access",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "continuous",
        "status": "active",
        "design_effectiveness": "effective",
        "operating_effectiveness": "effective",
    },
    {
        "control_id": "IC-002",
        "name": "Quarterly Vulnerability Scanning",
        "description": "Authenticated vulnerability scans of all production systems are performed quarterly.",
        "category": "IT",
        "sub_category": "Vulnerability Management",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "quarterly",
        "status": "active",
        "design_effectiveness": "effective",
        "operating_effectiveness": "partially_effective",
    },
    {
        "control_id": "IC-003",
        "name": "Annual BCP/DRP Test",
        "description": "Business continuity and disaster recovery plans are tested annually via tabletop or full failover exercises.",
        "category": "Operations",
        "sub_category": "Business Continuity",
        "control_type": "corrective",
        "control_nature": "manual",
        "frequency": "annual",
        "status": "active",
        "design_effectiveness": "effective",
        "operating_effectiveness": "partially_effective",
    },
    {
        "control_id": "IC-004",
        "name": "User Access Review",
        "description": "Periodic review of user access rights conducted semi-annually to enforce least privilege.",
        "category": "IT",
        "sub_category": "Access Management",
        "control_type": "detective",
        "control_nature": "manual",
        "frequency": "monthly",
        "status": "active",
        "design_effectiveness": "effective",
        "operating_effectiveness": "effective",
    },
    {
        "control_id": "IC-005",
        "name": "Security Awareness Training Completion",
        "description": "All employees must complete mandatory security awareness training within 30 days of joining and annually thereafter.",
        "category": "Compliance",
        "sub_category": "Training",
        "control_type": "preventive",
        "control_nature": "manual",
        "frequency": "annual",
        "status": "active",
        "design_effectiveness": "effective",
        "operating_effectiveness": "effective",
    },
    {
        "control_id": "IC-006",
        "name": "Change Advisory Board (CAB) Approval",
        "description": "All production changes must be reviewed and approved by the CAB before implementation.",
        "category": "IT",
        "sub_category": "Change Management",
        "control_type": "preventive",
        "control_nature": "manual",
        "frequency": "ad-hoc",
        "status": "active",
        "design_effectiveness": "effective",
        "operating_effectiveness": "effective",
    },
]


def seed_internal_controls(db, tenant_id: int, user_id: int, label: str):
    existing = db.query(InternalControl).filter(InternalControl.tenant_id == tenant_id).count()
    if existing:
        log.info("InternalControls (%s): already have %d rows – skipping", label, existing)
        return
    now = datetime.utcnow()
    for ctrl in INTERNAL_CONTROLS:
        db.add(InternalControl(
            tenant_id=tenant_id,
            owner_id=user_id,
            created_at=now,
            updated_at=now,
            effective_date=now - timedelta(days=180),
            review_date=now + timedelta(days=180),
            **ctrl,
        ))
    db.commit()
    log.info("InternalControls (%s): seeded %d rows", label, len(INTERNAL_CONTROLS))


# ─────────────────────────────────────────────────────────────────────────────
# 4.  Vulnerability Report + Vulnerabilities  (tenant 1 – Layeron)
# ─────────────────────────────────────────────────────────────────────────────

VULNERABILITIES = [
    {
        "vuln_id": "VULN-001",
        "title": "SQL Injection in User Login Form",
        "description": "The login form is vulnerable to SQL injection through the username parameter, allowing an attacker to bypass authentication or extract data.",
        "severity": "critical",
        "cvss_score": 9.8,
        "cve_id": "CVE-2024-1001",
        "cwe_id": "CWE-89",
        "affected_component": "Authentication Module",
        "affected_host": "app.internal",
        "status": "open",
    },
    {
        "vuln_id": "VULN-002",
        "title": "Remote Code Execution via Deserialization Flaw",
        "description": "Unsafe deserialization of user-supplied data in the file upload service allows attackers to execute arbitrary code.",
        "severity": "critical",
        "cvss_score": 9.1,
        "cve_id": "CVE-2024-1002",
        "cwe_id": "CWE-502",
        "affected_component": "File Upload Service",
        "affected_host": "upload.internal",
        "status": "in_progress",
    },
    {
        "vuln_id": "VULN-003",
        "title": "Cross-Site Scripting (XSS) in Search Functionality",
        "description": "Reflected XSS vulnerability in the search parameter allows attackers to inject malicious scripts into the browser session of other users.",
        "severity": "high",
        "cvss_score": 7.4,
        "cve_id": None,
        "cwe_id": "CWE-79",
        "affected_component": "Search Module",
        "affected_host": "portal.internal",
        "status": "open",
    },
    {
        "vuln_id": "VULN-004",
        "title": "Exposed Administrative Interface Without MFA",
        "description": "The administration panel is accessible without multi-factor authentication, increasing risk of credential-based attacks.",
        "severity": "high",
        "cvss_score": 7.5,
        "cve_id": None,
        "cwe_id": "CWE-306",
        "affected_component": "Admin Panel",
        "affected_host": "admin.internal",
        "status": "in_progress",
    },
    {
        "vuln_id": "VULN-005",
        "title": "Outdated TLS Version (TLS 1.0) Supported",
        "description": "The web server still accepts connections using TLS 1.0, which is deprecated and vulnerable to POODLE and BEAST attacks.",
        "severity": "high",
        "cvss_score": 7.0,
        "cve_id": "CVE-2014-3566",
        "cwe_id": "CWE-326",
        "affected_component": "Web Server",
        "affected_host": "www.internal",
        "status": "open",
    },
    {
        "vuln_id": "VULN-006",
        "title": "Insecure Direct Object Reference (IDOR) in Document API",
        "description": "Sequential document IDs in the API allow authenticated users to access other tenants' documents by incrementing the ID.",
        "severity": "high",
        "cvss_score": 6.8,
        "cve_id": None,
        "cwe_id": "CWE-639",
        "affected_component": "Document API",
        "affected_host": "api.internal",
        "status": "open",
    },
    {
        "vuln_id": "VULN-007",
        "title": "Sensitive Data in HTTP Response Headers",
        "description": "Server headers expose the web server version, technology stack, and internal IP addresses.",
        "severity": "medium",
        "cvss_score": 5.3,
        "cve_id": None,
        "cwe_id": "CWE-200",
        "affected_component": "Web Server",
        "affected_host": "www.internal",
        "status": "open",
    },
    {
        "vuln_id": "VULN-008",
        "title": "Missing Content-Security-Policy Header",
        "description": "The application does not set a Content-Security-Policy header, making it more vulnerable to XSS attacks.",
        "severity": "medium",
        "cvss_score": 5.0,
        "cve_id": None,
        "cwe_id": "CWE-1021",
        "affected_component": "Web Application",
        "affected_host": "portal.internal",
        "status": "resolved",
    },
    {
        "vuln_id": "VULN-009",
        "title": "Default Database Credentials on Internal Reporting Server",
        "description": "An internal reporting database was found using vendor default credentials, exposing sensitive business data.",
        "severity": "medium",
        "cvss_score": 5.9,
        "cve_id": None,
        "cwe_id": "CWE-521",
        "affected_component": "Reporting Database",
        "affected_host": "reports.internal",
        "status": "in_progress",
    },
    {
        "vuln_id": "VULN-010",
        "title": "Unpatched OpenSSL Library (CVE-2022-0778)",
        "description": "An internal service uses an outdated OpenSSL version vulnerable to an infinite loop DoS attack.",
        "severity": "low",
        "cvss_score": 3.7,
        "cve_id": "CVE-2022-0778",
        "cwe_id": "CWE-835",
        "affected_component": "Internal Service",
        "affected_host": "svc.internal",
        "status": "open",
    },
]


def seed_vulnerabilities(db, tenant_id: int, user_id: int, label: str):
    existing = db.query(VulnerabilityReport).filter(
        VulnerabilityReport.tenant_id == tenant_id
    ).count()
    if existing:
        log.info("VulnerabilityReport (%s): already have %d rows – skipping", label, existing)
        return

    now = datetime.utcnow()
    report = VulnerabilityReport(
        tenant_id=tenant_id,
        name="Q1 2026 External Penetration Test Report",
        description="Annual external penetration test conducted by an independent security firm covering web applications, APIs, and network perimeter.",
        report_type="penetration_test",
        scan_tool="manual",
        scan_date=now - timedelta(days=14),
        scan_scope="External-facing web applications, REST APIs, and network perimeter of primary data centre.",
        status="analyzed",
        uploaded_by=user_id,
        uploaded_at=now - timedelta(days=14),
        total_vulnerabilities=len(VULNERABILITIES),
        critical_count=sum(1 for v in VULNERABILITIES if v["severity"] == "critical"),
        high_count=sum(1 for v in VULNERABILITIES if v["severity"] == "high"),
        medium_count=sum(1 for v in VULNERABILITIES if v["severity"] == "medium"),
        low_count=sum(1 for v in VULNERABILITIES if v["severity"] == "low"),
        info_count=0,
        created_at=now - timedelta(days=14),
        updated_at=now,
    )
    db.add(report)
    db.flush()  # get report.id

    for vuln in VULNERABILITIES:
        db.add(Vulnerability(
            tenant_id=tenant_id,
            report_id=report.id,
            discovered_at=now - timedelta(days=14),
            created_at=now - timedelta(days=14),
            updated_at=now,
            **vuln,
        ))
    db.commit()
    log.info("Vulnerabilities (%s): seeded 1 report + %d findings", label, len(VULNERABILITIES))


# ─────────────────────────────────────────────────────────────────────────────
# 5.  IT Assets
# ─────────────────────────────────────────────────────────────────────────────

ASSETS = [
    {
        "name": "Core Banking System",
        "description": "Primary banking application handling all customer accounts, transactions, and reporting.",
        "asset_type": "application",
        "criticality": "critical",
        "host_name": "cbs.internal",
        "ip_address": "10.0.1.10",
        "confidentiality_rating": 5,
        "integrity_rating": 5,
    },
    {
        "name": "Customer Portal",
        "description": "External-facing web portal for retail and corporate customers.",
        "asset_type": "application",
        "criticality": "high",
        "host_name": "portal.internal",
        "ip_address": "10.0.1.20",
        "confidentiality_rating": 4,
        "integrity_rating": 4,
    },
    {
        "name": "Active Directory",
        "description": "Enterprise directory service managing user identities and access.",
        "asset_type": "infrastructure",
        "criticality": "critical",
        "host_name": "dc01.internal",
        "ip_address": "10.0.0.5",
        "confidentiality_rating": 5,
        "integrity_rating": 5,
    },
    {
        "name": "Cloud Object Storage",
        "description": "AWS S3-compatible object storage for documents and backups.",
        "asset_type": "cloud",
        "criticality": "high",
        "host_name": "s3.cloud.internal",
        "ip_address": None,
        "confidentiality_rating": 4,
        "integrity_rating": 3,
    },
    {
        "name": "SIEM Platform",
        "description": "Security information and event management system aggregating logs from all critical systems.",
        "asset_type": "infrastructure",
        "criticality": "high",
        "host_name": "siem.internal",
        "ip_address": "10.0.2.30",
        "confidentiality_rating": 3,
        "integrity_rating": 4,
    },
]


def seed_assets(db, tenant_id: int, user_id: int, label: str):
    existing = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).count()
    if existing:
        log.info("ITAssets (%s): already have %d rows – skipping", label, existing)
        return
    now = datetime.utcnow()
    for asset in ASSETS:
        db.add(ITAsset(
            tenant_id=tenant_id,
            owner_id=user_id,
            owner_name="IT Department",
            created_at=now,
            status="active",
            **asset,
        ))
    db.commit()
    log.info("ITAssets (%s): seeded %d rows", label, len(ASSETS))


# ─────────────────────────────────────────────────────────────────────────────
# 6.  Evidence
# ─────────────────────────────────────────────────────────────────────────────

EVIDENCE_ITEMS = [
    {
        "name": "MFA Configuration Screenshot – Azure AD",
        "description": "Screenshot confirming MFA is enabled for all privileged accounts in Azure Active Directory.",
        "evidence_type": "screenshot",
        "status": "approved",
        "file_name": "mfa_config_azure_ad.png",
    },
    {
        "name": "Q4 2025 Vulnerability Scan Report",
        "description": "Authenticated internal vulnerability scan report from Nessus for all production servers.",
        "evidence_type": "report",
        "status": "approved",
        "file_name": "vuln_scan_q4_2025.pdf",
    },
    {
        "name": "Annual BCP Test Report 2025",
        "description": "Tabletop exercise results and lessons learned from the 2025 BCP/DRP test.",
        "evidence_type": "audit_report",
        "status": "approved",
        "file_name": "bcp_test_report_2025.pdf",
    },
    {
        "name": "Security Awareness Training Completion Records",
        "description": "Employee completion records for the mandatory annual security awareness training programme.",
        "evidence_type": "record",
        "status": "approved",
        "file_name": "training_completion_2025.xlsx",
    },
    {
        "name": "Access Review Sign-Off Sheet",
        "description": "Department manager sign-off sheets confirming semi-annual user access review completion.",
        "evidence_type": "document",
        "status": "pending_review",
        "file_name": "access_review_h2_2025.pdf",
    },
]


def seed_evidence(db, tenant_id: int, user_id: int, label: str):
    existing = db.query(Evidence).filter(Evidence.tenant_id == tenant_id).count()
    if existing:
        log.info("Evidence (%s): already have %d rows – skipping", label, existing)
        return
    now = datetime.utcnow()
    for ev in EVIDENCE_ITEMS:
        db.add(Evidence(
            tenant_id=tenant_id,
            uploaded_by=user_id,
            uploaded_at=now,
            collection_date=now - timedelta(days=30),
            validity_period_days=365,
            version=1,
            ocr_status="completed",
            **ev,
        ))
    db.commit()
    log.info("Evidence (%s): seeded %d rows", label, len(EVIDENCE_ITEMS))


# ─────────────────────────────────────────────────────────────────────────────
# 7.  UploadedFrameworks for tenant 2  (TestCorp)
#     Tenant 1 already has 22 parsed frameworks from the original migration.
#     Tenant 2 needs at least 3 so its framework_count is non-zero.
# ─────────────────────────────────────────────────────────────────────────────

TESTCORP_FRAMEWORKS = [
    {
        "name": "PCI DSS v4.0",
        "description": "Payment Card Industry Data Security Standard – protects cardholder data environments.",
        "file_name": "pci_dss_v4_0.pdf",
        "file_path": "/seed/pci_dss_v4_0.pdf",
        "file_type": "pdf",
        "upload_status": "parsed",
        "framework_type": "security",
        "source_organization": "PCI Security Standards Council",
        "version": "4.0",
        "is_active": True,
        "is_shared": False,
    },
    {
        "name": "NIST Cybersecurity Framework v2.0",
        "description": "NIST CSF provides a framework for managing and reducing cybersecurity risk.",
        "file_name": "nist_csf_2_0.pdf",
        "file_path": "/seed/nist_csf_2_0.pdf",
        "file_type": "pdf",
        "upload_status": "parsed",
        "framework_type": "security",
        "source_organization": "NIST",
        "version": "2.0",
        "is_active": True,
        "is_shared": False,
    },
    {
        "name": "ISO/IEC 27001:2022",
        "description": "International standard for information security management systems (ISMS).",
        "file_name": "iso_27001_2022.pdf",
        "file_path": "/seed/iso_27001_2022.pdf",
        "file_type": "pdf",
        "upload_status": "parsed",
        "framework_type": "security",
        "source_organization": "ISO/IEC",
        "version": "2022",
        "is_active": True,
        "is_shared": False,
    },
]


def seed_uploaded_frameworks(db, tenant_id: int, user_id: int, label: str):
    existing = db.query(UploadedFramework).filter(
        UploadedFramework.tenant_id == tenant_id
    ).count()
    if existing:
        log.info("UploadedFrameworks (%s): already have %d rows – skipping", label, existing)
        return
    now = datetime.utcnow()
    for fw in TESTCORP_FRAMEWORKS:
        db.add(UploadedFramework(
            tenant_id=tenant_id,
            uploaded_by=user_id,
            created_at=now,
            updated_at=now,
            parsed_at=now,
            **fw,
        ))
    db.commit()
    log.info("UploadedFrameworks (%s): seeded %d rows", label, len(TESTCORP_FRAMEWORKS))


# ─────────────────────────────────────────────────────────────────────────────
# 8.  EvidenceControlMappings
#     Links evidence to parsed framework controls so compliance coverage is > 0.
#     Strategy:
#       • For tenant 1 (Layeron): fetch the first 5 ParsedFrameworkControl rows
#         from the existing uploaded frameworks, then link each of the 5 approved
#         evidence items to a different control.
#       • For tenant 2 (TestCorp): link evidence to NormalizedControls (simpler
#         path that's always available).
# ─────────────────────────────────────────────────────────────────────────────

def seed_evidence_control_mappings(db, tenant_id: int, label: str):
    existing = db.query(EvidenceControlMapping).join(
        Evidence, EvidenceControlMapping.evidence_id == Evidence.id
    ).filter(Evidence.tenant_id == tenant_id).count()
    if existing:
        log.info("EvidenceControlMappings (%s): already have %d rows – skipping", label, existing)
        return

    # Approved evidence for this tenant
    evidence_rows = db.query(Evidence).filter(
        Evidence.tenant_id == tenant_id,
        Evidence.status == "approved",
    ).all()
    if not evidence_rows:
        log.warning("EvidenceControlMappings (%s): no approved evidence found – skipping", label)
        return

    now = datetime.utcnow()
    mappings_created = 0

    # Preferred: link to ParsedFrameworkControl rows for tenant's own frameworks
    parsed_controls = (
        db.query(ParsedFrameworkControl)
        .join(UploadedFramework, ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id)
        .filter(UploadedFramework.tenant_id == tenant_id)
        .limit(len(evidence_rows) * 2)
        .all()
    )

    if parsed_controls:
        for i, ev in enumerate(evidence_rows):
            pc = parsed_controls[i % len(parsed_controls)]
            db.add(EvidenceControlMapping(
                evidence_id=ev.id,
                parsed_control_id=pc.id,
                uploaded_framework_id=pc.uploaded_framework_id,
                framework_name=pc.domain or "Framework",
                control_code=pc.control_id or f"CTRL-{pc.id}",
                control_title=pc.title or "Control",
                confidence_score=0.85,
                coverage_type="direct",
                created_by_ai=False,
                created_at=now,
            ))
            mappings_created += 1
        db.commit()
        log.info("EvidenceControlMappings (%s): seeded %d rows via parsed controls", label, mappings_created)
        return

    # Fallback: link to NormalizedControls (always available)
    norm_controls = db.query(NormalizedControl).limit(len(evidence_rows)).all()
    if not norm_controls:
        log.warning("EvidenceControlMappings (%s): no controls found – skipping", label)
        return

    for i, ev in enumerate(evidence_rows):
        nc = norm_controls[i % len(norm_controls)]
        db.add(EvidenceControlMapping(
            evidence_id=ev.id,
            normalized_control_id=nc.id,
            framework_name="Internal Controls",
            control_code=nc.code,
            control_title=nc.name,
            confidence_score=0.80,
            coverage_type="direct",
            created_by_ai=False,
            created_at=now,
        ))
        mappings_created += 1
    db.commit()
    log.info("EvidenceControlMappings (%s): seeded %d rows via normalized controls", label, mappings_created)


# ─────────────────────────────────────────────────────────────────────────────
# Tenant lookup helper
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_tenant(db, slug: str, schema_name: str):
    """Look up a tenant by slug first, then by schema_name as fallback.
    Returns None only if neither slug nor schema_name matches; does NOT
    fall through to an arbitrary active tenant to avoid accidental mis-seeding.
    """
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant and schema_name:
        tenant = db.query(Tenant).filter(Tenant.schema_name == schema_name).first()
    return tenant


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def run():
    db = SessionLocal()
    try:
        # ── look up tenants (slug → schema_name → first active) ──────────────
        layeron = _resolve_tenant(db, "layeron-group-llc", "tenant_layerongroupllc")
        testcorp = _resolve_tenant(db, "testcorp-e2e", "tenant_testcorpe2e")

        if not layeron:
            log.error("No suitable tenant found for Layeron – aborting")
            sys.exit(1)
        if not testcorp:
            log.warning("Tenant 'testcorp-e2e' not found – skipping TestCorp seeding")

        log.info("Seeding for tenants: %s (id=%d)%s",
                 layeron.name, layeron.id,
                 f", {testcorp.name} (id={testcorp.id})" if testcorp else "")

        # ── look up users ─────────────────────────────────────────────────────
        # Prefer known emails; fall back to ANY user so FK constraints are met.
        _any_user = db.query(GRCUser).first()
        if not _any_user:
            log.error("No GRCUser rows found – cannot satisfy non-null FK constraints. Aborting.")
            sys.exit(1)

        layeron_user = (
            db.query(GRCUser).filter(GRCUser.email == "info@layeron.com").first()
            or _any_user
        )
        testcorp_user = (
            db.query(GRCUser).filter(GRCUser.email == "admin-e2e@testcorp.com").first()
            or _any_user
        )

        layeron_uid = layeron_user.id
        testcorp_uid = testcorp_user.id

        # ── 1. Normalized controls (global) ──────────────────────────────────
        seed_normalized_controls(db)

        # ── 2. Risks ──────────────────────────────────────────────────────────
        seed_risks(db, layeron.id, layeron_uid, RISKS_LAYERON, "layeron")
        if testcorp:
            seed_risks(db, testcorp.id, testcorp_uid, RISKS_TESTCORP, "testcorp")

        # ── 3. Internal Controls ──────────────────────────────────────────────
        seed_internal_controls(db, layeron.id, layeron_uid, "layeron")
        if testcorp:
            seed_internal_controls(db, testcorp.id, testcorp_uid, "testcorp")

        # ── 4. Vulnerabilities (Layeron only) ─────────────────────────────────
        seed_vulnerabilities(db, layeron.id, layeron_uid, "layeron")

        # ── 5. IT Assets ──────────────────────────────────────────────────────
        seed_assets(db, layeron.id, layeron_uid, "layeron")
        if testcorp:
            seed_assets(db, testcorp.id, testcorp_uid, "testcorp")

        # ── 6. Evidence ───────────────────────────────────────────────────────
        seed_evidence(db, layeron.id, layeron_uid, "layeron")
        if testcorp:
            seed_evidence(db, testcorp.id, testcorp_uid, "testcorp")

        # ── 7. UploadedFrameworks for TestCorp (Layeron already has 22) ───────
        if testcorp:
            seed_uploaded_frameworks(db, testcorp.id, testcorp_uid, "testcorp")

        # ── 8. Evidence → Control mappings (drives compliance coverage) ───────
        seed_evidence_control_mappings(db, layeron.id, "layeron")
        if testcorp:
            seed_evidence_control_mappings(db, testcorp.id, "testcorp")

        # ── Post-seed summary ──────────────────────────────────────────────────
        from sqlalchemy import text as _text
        summary_sql = _text("""
            SELECT 'risks'         AS entity, COUNT(*)::text AS n FROM grc_risks          WHERE tenant_id = :tid
            UNION ALL
            SELECT 'frameworks',              COUNT(*)::text         FROM grc_uploaded_frameworks WHERE tenant_id = :tid
            UNION ALL
            SELECT 'int_controls',            COUNT(*)::text         FROM grc_internal_controls   WHERE tenant_id = :tid
            UNION ALL
            SELECT 'assets',                  COUNT(*)::text         FROM grc_it_assets           WHERE tenant_id = :tid
            UNION ALL
            SELECT 'evidence',                COUNT(*)::text         FROM grc_evidence             WHERE tenant_id = :tid
            UNION ALL
            SELECT 'ecm_links',               COUNT(*)::text
              FROM grc_evidence_control_mappings ecm
              JOIN grc_evidence e ON e.id = ecm.evidence_id
             WHERE e.tenant_id = :tid
        """)
        for tenant_obj in filter(None, [layeron, testcorp]):
            rows = db.execute(summary_sql, {"tid": tenant_obj.id}).fetchall()
            stats = {r[0]: r[1] for r in rows}
            norm_count = db.execute(_text("SELECT COUNT(*) FROM grc_normalized_controls")).scalar()
            log.info("Post-seed counts for %-20s → risks=%-3s frameworks=%-3s "
                     "controls(norm)=%-3s int_controls=%-3s assets=%-3s evidence=%-3s ecm=%-3s",
                     tenant_obj.name,
                     stats.get("risks", 0), stats.get("frameworks", 0),
                     norm_count,
                     stats.get("int_controls", 0), stats.get("assets", 0),
                     stats.get("evidence", 0), stats.get("ecm_links", 0))

        log.info("✓  Sample data seeding complete.")
    except Exception:
        db.rollback()
        log.exception("Seeding failed – transaction rolled back.")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run()
