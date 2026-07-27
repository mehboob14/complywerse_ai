"""Seed realistic Risk Posture v2 demo data.

Tenant `company` has 3 assets but only 2 vulns (one test CVE on each test
asset, none on mehboob's desktop). The Risk Posture v2 page renders the
asset's vuln dimension empty in that state — even though the formula
works, there's nothing to compute against.

This script seeds 5 well-known CVEs covering every effective-risk band
+ the escalation rule, links them to mehboob's desktop (the user's
main demo asset), and fills in the missing CIA + business-context
fields so the dashboard shows meaningful variation:

  CVE-2021-44228 (Log4Shell)        — CVSS 10.0, EPSS 94.6%, KEV=True   → CRITICAL (escalation)
  CVE-2024-3094  (XZ-utils backdoor) — CVSS 10.0, EPSS  3.0%, KEV=True   → CRITICAL (escalation)
  CVE-2023-23397 (Outlook NTLM)     — CVSS 9.8,  EPSS 90.0%, KEV=True   → CRITICAL (escalation)
  CVE-2022-22965 (Spring4Shell)     — CVSS 9.8,  EPSS 95.0%, KEV=True   → CRITICAL (escalation)
  CVE-2023-50164 (Struts2 RCE)      — CVSS 9.8,  EPSS 55.0%, KEV=False  → HIGH
  CVE-2024-21413 (Outlook RCE)      — CVSS 9.8,  EPSS 12.0%, KEV=False  → HIGH
  CVE-2023-22515 (Confluence)       — CVSS 9.8,  EPSS  5.0%, KEV=False  → MEDIUM
  CVE-2023-2868  (Barracuda)        — CVSS 9.8,  EPSS  2.0%, KEV=False  → MEDIUM

All idempotent — re-running checks for existing CVE-id before INSERT.
"""
from dotenv import load_dotenv
load_dotenv()

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from datetime import datetime, timedelta
from grc.db import open_tenant_session
from sqlalchemy import text

# Tenant id 9 = company.
TENANT_ID = 9

DEMO_CVES = [
    {
        "cve_id": "CVE-2021-44228", "title": "Apache Log4j2 JNDI lookup RCE (Log4Shell)",
        "description": "Remote code execution via crafted JNDI lookups in log messages.",
        "severity": "critical", "cvss_score": 10.0,
        "epss_score": 0.94358, "epss_percentile": 0.999, "kev_flag": True,
        "kev_date_added": datetime(2021, 12, 10),
        "status": "open", "category": "rce",
    },
    {
        "cve_id": "CVE-2024-3094", "title": "XZ Utils SSH backdoor (CVE-2024-3094)",
        "description": "Backdoored liblzma in xz-utils 5.6.0/5.6.1 enables remote shell access via sshd.",
        "severity": "critical", "cvss_score": 10.0,
        "epss_score": 0.03012, "epss_percentile": 0.910, "kev_flag": True,
        "kev_date_added": datetime(2024, 3, 29),
        "status": "open", "category": "supply_chain",
    },
    {
        "cve_id": "CVE-2023-23397", "title": "Outlook NTLM credential leak (no-click)",
        "description": "Crafted calendar invite triggers NTLM authentication leak.",
        "severity": "critical", "cvss_score": 9.8,
        "epss_score": 0.90122, "epss_percentile": 0.997, "kev_flag": True,
        "kev_date_added": datetime(2023, 3, 14),
        "status": "open", "category": "credential_theft",
    },
    {
        "cve_id": "CVE-2022-22965", "title": "Spring4Shell (Spring Framework class.module.classLoader)",
        "description": "Property binding RCE in Spring MVC on JDK 9+ with Tomcat.",
        "severity": "critical", "cvss_score": 9.8,
        "epss_score": 0.95423, "epss_percentile": 0.999, "kev_flag": True,
        "kev_date_added": datetime(2022, 4, 4),
        "status": "open", "category": "rce",
    },
    {
        "cve_id": "CVE-2023-50164", "title": "Apache Struts2 path traversal upload",
        "description": "Crafted file upload bypasses parameter validation, allows RCE.",
        "severity": "critical", "cvss_score": 9.8,
        "epss_score": 0.55876, "epss_percentile": 0.985, "kev_flag": False,
        "status": "open", "category": "rce",
    },
    {
        "cve_id": "CVE-2024-21413", "title": "Microsoft Outlook RCE (Moniker Link bypass)",
        "description": "Crafted Outlook hyperlink bypasses Office Protected View, RCE.",
        "severity": "high", "cvss_score": 9.8,
        "epss_score": 0.12012, "epss_percentile": 0.960, "kev_flag": False,
        "status": "open", "category": "rce",
    },
    {
        "cve_id": "CVE-2023-22515", "title": "Atlassian Confluence privilege escalation",
        "description": "Unauthenticated admin account creation in Confluence Data Center / Server.",
        "severity": "high", "cvss_score": 9.8,
        "epss_score": 0.04978, "epss_percentile": 0.928, "kev_flag": False,
        "status": "open", "category": "privesc",
    },
    {
        "cve_id": "CVE-2023-2868", "title": "Barracuda Email Gateway code injection",
        "description": "Command injection in tar attachment handler.",
        "severity": "high", "cvss_score": 9.8,
        "epss_score": 0.02214, "epss_percentile": 0.889, "kev_flag": False,
        "status": "open", "category": "rce",
    },
]


sess = open_tenant_session('company')
try:
    now = datetime.utcnow()

    # ── A. Seed CVEs ────────────────────────────────────────────────────
    seeded = 0
    cve_ids_for_link: dict[str, int] = {}
    for cve in DEMO_CVES:
        existing = sess.execute(text(
            "SELECT id FROM grc_vulnerabilities "
            "WHERE tenant_id = :tid AND cve_id = :cve"
        ), {"tid": TENANT_ID, "cve": cve["cve_id"]}).first()
        if existing:
            cve_ids_for_link[cve["cve_id"]] = existing[0]
            continue
        # vuln_id is NOT NULL — use the CVE ID as the human-readable id
        result = sess.execute(text(
            "INSERT INTO grc_vulnerabilities "
            "  (tenant_id, vuln_id, cve_id, title, description, severity, cvss_score, "
            "   epss_score, epss_percentile, kev_flag, kev_date_added, "
            "   status, discovered_at, created_at, updated_at) "
            "VALUES (:tid, :vid, :cve, :title, :description, :severity, :cvss, "
            "   :epss, :epss_p, :kev, :kev_date, :status, "
            "   :idt, :crt, :upd) "
            "RETURNING id"
        ), {
            "tid": TENANT_ID, "vid": cve["cve_id"], "cve": cve["cve_id"], "title": cve["title"],
            "description": cve["description"], "severity": cve["severity"],
            "cvss": cve["cvss_score"], "epss": cve["epss_score"],
            "epss_p": cve["epss_percentile"], "kev": cve["kev_flag"],
            "kev_date": cve.get("kev_date_added"),
            "status": cve["status"],
            "idt": now - timedelta(days=14), "crt": now, "upd": now,
        })
        cve_ids_for_link[cve["cve_id"]] = result.scalar()
        seeded += 1
    sess.commit()
    logger.info("Seeded %d new CVE rows (skipped %d existing)", seeded, len(DEMO_CVES) - seeded)

    # ── B. Link 5 CVEs to mehboob's desktop (asset id=3) ────────────────
    asset_id = 3
    target_cves = ["CVE-2021-44228", "CVE-2023-23397", "CVE-2022-22965",
                   "CVE-2024-21413", "CVE-2023-22515"]
    linked = 0
    for cve_id in target_cves:
        vid = cve_ids_for_link.get(cve_id)
        if not vid:
            continue
        existing = sess.execute(text(
            "SELECT id FROM grc_vulnerability_asset_links "
            "WHERE vulnerability_id = :vid AND asset_id = :aid"
        ), {"vid": vid, "aid": asset_id}).first()
        if existing:
            continue
        sess.execute(text(
            "INSERT INTO grc_vulnerability_asset_links "
            "  (vulnerability_id, asset_id, created_at) "
            "VALUES (:vid, :aid, :now)"
        ), {"vid": vid, "aid": asset_id, "now": now})
        linked += 1
    sess.commit()
    logger.info("Linked %d new vulns to mehboob's desktop (asset id=%d)", linked, asset_id)

    # ── C. Backfill missing CIA + business-context on mehboob ───────────
    # Mehboob is a Windows desktop used as a banking-app dev box —
    # representative of an internal-but-sensitive endpoint. Demo values
    # below let the v2 page show the full escalation behaviour.
    sess.execute(text(
        "UPDATE grc_it_assets SET "
        "  confidentiality_rating = COALESCE(confidentiality_rating, 4), "
        "  integrity_rating = COALESCE(integrity_rating, 4), "
        "  availability_rating = COALESCE(availability_rating, 3), "
        "  is_customer_facing = TRUE, "
        "  is_internet_facing = FALSE, "
        "  regulated_data_type = 'pii', "
        "  op_dep_business_impact = 'high', "
        "  business_impact_notes = 'Internal banking-app dev box. Carries staff PII + dev credentials.' "
        "WHERE id = :aid"
    ), {"aid": asset_id})

    # ── D. Backfill business context on the other 2 assets so dashboard
    # shows variation across cards (currently all default "medium"). ────
    sess.execute(text(
        "UPDATE grc_it_assets SET "
        "  confidentiality_rating = COALESCE(confidentiality_rating, 5), "
        "  integrity_rating = COALESCE(integrity_rating, 5), "
        "  availability_rating = COALESCE(availability_rating, 5), "
        "  is_internet_facing = TRUE, "
        "  regulated_data_type = 'pci', "
        "  op_dep_business_impact = 'critical', "
        "  business_impact_notes = 'Customer-facing production web server. PCI in scope.' "
        "WHERE id = 1"
    ))
    sess.execute(text(
        "UPDATE grc_it_assets SET "
        "  confidentiality_rating = COALESCE(confidentiality_rating, 2), "
        "  integrity_rating = COALESCE(integrity_rating, 2), "
        "  availability_rating = COALESCE(availability_rating, 1), "
        "  op_dep_business_impact = 'low', "
        "  business_impact_notes = 'Test asset \\u2014 throwaway / low-impact.' "
        "WHERE id = 2"
    ))
    sess.commit()
    logger.info("Backfilled CIA + business-context on all 3 assets")

    # ── E. Verify ───────────────────────────────────────────────────────
    print()
    print("=== Resulting per-asset state ===")
    rows = sess.execute(text(
        "SELECT a.id, a.name, "
        "  a.confidentiality_rating, a.integrity_rating, a.availability_rating, "
        "  a.is_customer_facing, a.is_internet_facing, "
        "  a.regulated_data_type, a.op_dep_business_impact, "
        "  (SELECT COUNT(*) FROM grc_vulnerability_asset_links val "
        "    JOIN grc_vulnerabilities v ON v.id = val.vulnerability_id "
        "    WHERE val.asset_id = a.id AND v.status = 'open') AS active_vulns "
        "FROM grc_it_assets a WHERE a.tenant_id = :tid ORDER BY a.id"
    ), {"tid": TENANT_ID}).all()
    for r in rows:
        print(f"  asset #{r[0]} {r[1]!r}: CIA={r[2]}/{r[3]}/{r[4]}  "
              f"cust={r[5]} inet={r[6]}  data={r[7]}  op={r[8]}  active_vulns={r[9]}")
finally:
    sess.close()

logger.info("Done.")
