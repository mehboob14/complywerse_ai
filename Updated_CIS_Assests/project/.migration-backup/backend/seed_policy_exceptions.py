"""
Seed default policy exceptions against existing governance documents.
Run from backend/: python seed_policy_exceptions.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
from grc.models import SessionLocal, GovernanceDocument, PolicyException, Tenant, GRCUser, TenantUser

EXCEPTIONS_TEMPLATE = [
    {
        "title": "Temporary waiver for legacy system password policy",
        "justification": (
            "The legacy ERP system (v3.2) does not support passwords longer than 12 characters "
            "or special characters required by the current Password Management Policy. "
            "Migrating to a compliant system is scheduled for Q3 2026."
        ),
        "risk_assessment": (
            "Medium risk. The legacy system is restricted to internal network access only, "
            "reducing exposure. Privileged accounts are monitored via SIEM."
        ),
        "compensating_controls": (
            "Mandatory MFA for all accounts on the legacy system. "
            "Network segmentation applied. Access limited to 5 named users."
        ),
        "priority": "high",
        "status": "approved",
        "doc_type_hint": "policy",
        "days_until_expiry": 90,
    },
    {
        "title": "Exception: Third-party vendor remote access without VPN",
        "justification": (
            "Vendor XYZ requires direct HTTPS access to the monitoring portal for SLA obligations. "
            "Their toolset is incompatible with the company VPN client required by the Remote Access Policy."
        ),
        "risk_assessment": (
            "High risk. Remote access without VPN increases attack surface. "
            "All sessions are logged and vendor credentials rotate every 30 days."
        ),
        "compensating_controls": (
            "IP allowlisting for vendor IP ranges. Session recording enabled. "
            "Dedicated read-only service account with least-privilege access. "
            "Quarterly access review required."
        ),
        "priority": "critical",
        "status": "pending_approval",
        "doc_type_hint": "policy",
        "days_until_expiry": 60,
    },
    {
        "title": "Data retention deviation for archived project files",
        "justification": (
            "Legal hold on Project Alpha files requires retention beyond the 3-year "
            "limit defined in the Data Retention Standard due to ongoing litigation."
        ),
        "risk_assessment": (
            "Low risk. Files are stored in an air-gapped archive with no user access. "
            "Legal counsel has reviewed and approved the extended retention."
        ),
        "compensating_controls": (
            "Files are encrypted at rest. Access requires dual authorisation from Legal and IT Security. "
            "Reviewed monthly until litigation concludes."
        ),
        "priority": "medium",
        "status": "approved",
        "doc_type_hint": "standard",
        "days_until_expiry": 180,
    },
    {
        "title": "Mobile device policy exception for field operations team",
        "justification": (
            "Field operations staff use ruggedised Android devices that cannot support the MDM agent "
            "required by the Mobile Device Management Policy. Device replacement is budgeted for FY2027."
        ),
        "risk_assessment": (
            "Medium risk. Devices store only operational data (no PII). "
            "Devices are locked to a dedicated APN with limited internet access."
        ),
        "compensating_controls": (
            "Devices encrypted using vendor encryption. Remote wipe capability via carrier. "
            "Physical device inventory checked monthly. "
            "No corporate email or cloud sync enabled on these devices."
        ),
        "priority": "medium",
        "status": "draft",
        "doc_type_hint": "policy",
        "days_until_expiry": 120,
    },
    {
        "title": "Patch management exception for production database server",
        "justification": (
            "Critical Oracle DB patch requires a 6-hour downtime window incompatible with "
            "the current 99.9% SLA commitment. Patching is scheduled for the next maintenance window "
            "in January 2027 per change control approval."
        ),
        "risk_assessment": (
            "High risk. CVE-2025-3847 (CVSS 7.8) affects the current version. "
            "Vulnerability is only exploitable from internal network. "
            "WAF rules updated to block known exploit patterns."
        ),
        "compensating_controls": (
            "Intrusion detection signatures updated. Network traffic to/from DB monitored in real-time. "
            "Vulnerability scanner scheduled to run daily. Incident response plan rehearsed."
        ),
        "priority": "high",
        "status": "approved",
        "doc_type_hint": "procedure",
        "days_until_expiry": 45,
    },
]


def run():
    db = SessionLocal()
    try:
        # Get all tenants
        tenants = db.query(Tenant).filter(Tenant.is_active == True).all()
        if not tenants:
            print("No active tenants found. Exiting.")
            return

        for tenant in tenants:
            print(f"\nProcessing tenant: {tenant.name} (id={tenant.id})")

            # Get a user to assign as requester (via TenantUser junction)
            tenant_user = db.query(TenantUser).filter(
                TenantUser.tenant_id == tenant.id
            ).first()
            user = db.query(GRCUser).filter(GRCUser.id == tenant_user.user_id, GRCUser.is_active == True).first() if tenant_user else None
            if not user:
                print(f"  No active user found for tenant {tenant.id}, skipping.")
                continue

            # Get existing documents for this tenant
            docs = db.query(GovernanceDocument).filter(
                GovernanceDocument.tenant_id == tenant.id
            ).all()

            if not docs:
                print(f"  No governance documents found for tenant {tenant.id}, skipping.")
                continue

            # Build a quick lookup: doc_type -> first matching doc
            doc_by_type: dict[str, GovernanceDocument] = {}
            for doc in docs:
                t = (doc.doc_type or '').lower()
                if t not in doc_by_type:
                    doc_by_type[t] = doc

            added = 0
            for tpl in EXCEPTIONS_TEMPLATE:
                # Check if a similar exception already exists
                existing = db.query(PolicyException).filter(
                    PolicyException.tenant_id == tenant.id,
                    PolicyException.title == tpl["title"],
                ).first()
                if existing:
                    print(f"  Skipping (already exists): {tpl['title'][:60]}")
                    continue

                # Find a matching document
                hint = tpl.get("doc_type_hint", "policy")
                matched_doc = doc_by_type.get(hint) or doc_by_type.get("policy") or docs[0]

                now = datetime.utcnow()
                exc = PolicyException(
                    tenant_id=tenant.id,
                    document_id=matched_doc.id,
                    title=tpl["title"],
                    justification=tpl["justification"],
                    risk_assessment=tpl["risk_assessment"],
                    compensating_controls=tpl["compensating_controls"],
                    priority=tpl["priority"],
                    status=tpl["status"],
                    requested_by=user.id,
                    requested_at=now,
                    effective_date=now,
                    expiry_date=now + timedelta(days=tpl.get("days_until_expiry", 90)),
                    created_at=now,
                    updated_at=now,
                )
                db.add(exc)
                added += 1
                print(f"  + {tpl['title'][:60]} [{tpl['status']}]")

            db.commit()
            print(f"  Done — {added} exception(s) added for tenant {tenant.id}.")

    except Exception as e:
        db.rollback()
        print(f"\nError: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
