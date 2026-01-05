"""
Seed file for banking internal controls.
Creates 18 real-world banking internal controls covering Operations, Financial,
IT Security, AML/CFT, Credit Risk, and Customer Service categories.

These are sample controls that users can modify or delete as needed.
"""

from datetime import datetime, timedelta
from .models import SessionLocal, InternalControl, Tenant


BANKING_INTERNAL_CONTROLS = [
    # Operations Controls (5)
    {
        "control_id": "IC-001",
        "name": "Daily Cash Position Reconciliation",
        "description": "Treasury Operations must reconcile all nostro and vostro account positions against the general ledger by 4:00 PM daily. Any discrepancies exceeding $1,000 must be escalated to Treasury Manager within 1 hour. Reconciliation must include all currency positions and outstanding items.",
        "category": "Operations",
        "sub_category": "Treasury",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "daily",
        "regulatory_source": "CBB Rulebook Vol. 1 - Module LM",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    {
        "control_id": "IC-002",
        "name": "Dual Authorization for High-Value Transfers",
        "description": "All wire transfers and RTGS payments exceeding $50,000 USD equivalent require dual authorization by two authorized officers with segregated duties. The second authorizer must independently verify beneficiary details, amount, and purpose before release. System prevents single-user approval for transactions above threshold.",
        "category": "Operations",
        "sub_category": "Payments",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "Board Resolution 2024-01",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    {
        "control_id": "IC-003",
        "name": "Branch Cash Limit Monitoring",
        "description": "Operations Control monitors branch vault and teller cash levels against approved limits every 4 hours. Branches exceeding 80% of vault limit must arrange cash collection. System generates automated alerts when limits are approached. Daily reconciliation of physical cash to system records required.",
        "category": "Operations",
        "sub_category": "Cash Management",
        "control_type": "preventive",
        "control_nature": "hybrid",
        "frequency": "daily",
        "regulatory_source": "Internal Policy - Cash Operations",
        "is_key_control": True,
        "priority": "high",
        "status": "active"
    },
    {
        "control_id": "IC-004",
        "name": "ATM Cash Replenishment Verification",
        "description": "ATM Operations team must perform dual-control cash counting and verification during all ATM replenishments. Video recording of counting process is mandatory. Discrepancies must be reported immediately and investigated within 24 hours. Monthly surprise audits of ATM cash are conducted.",
        "category": "Operations",
        "sub_category": "ATM Operations",
        "control_type": "preventive",
        "control_nature": "manual",
        "frequency": "daily",
        "regulatory_source": "CBB Circular 2022-15",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    {
        "control_id": "IC-005",
        "name": "End-of-Day Transaction Cutoff Enforcement",
        "description": "Core banking system enforces transaction cutoff times for different products. All transactions received after cutoff are automatically queued for next business day processing. Branch managers must approve any exceptional late processing with documented justification.",
        "category": "Operations",
        "sub_category": "Transaction Processing",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "Internal Policy - Operations Manual",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    
    # Financial Controls (4)
    {
        "control_id": "IC-006",
        "name": "Month-End Financial Close Procedures",
        "description": "Finance team executes structured month-end close process including: all sub-ledger reconciliations, inter-company eliminations, accrual adjustments, and management review of financial statements. Close must be completed within 5 business days. CFO approval required before finalization.",
        "category": "Financial",
        "sub_category": "Financial Reporting",
        "control_type": "detective",
        "control_nature": "manual",
        "frequency": "monthly",
        "regulatory_source": "IFRS Standards / CBB Financial Reporting Rules",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    {
        "control_id": "IC-007",
        "name": "Journal Entry Authorization Matrix",
        "description": "All manual journal entries require approval based on materiality thresholds: entries up to $10,000 by Senior Accountant, $10,001-$100,000 by Finance Manager, above $100,000 by CFO. System enforces approval workflow. Preparer cannot approve own entries.",
        "category": "Financial",
        "sub_category": "General Ledger",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "Board Resolution 2023-05",
        "is_key_control": True,
        "priority": "high",
        "status": "active"
    },
    {
        "control_id": "IC-008",
        "name": "Inter-Company Account Reconciliation",
        "description": "All inter-company accounts must be reconciled monthly with zero tolerance for unreconciled items older than 30 days. Quarterly confirmations required between group entities. Discrepancies escalated to Group Controller within 48 hours of identification.",
        "category": "Financial",
        "sub_category": "Group Accounting",
        "control_type": "detective",
        "control_nature": "manual",
        "frequency": "monthly",
        "regulatory_source": "Group Accounting Policy",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    {
        "control_id": "IC-009",
        "name": "Suspense Account Aging Review",
        "description": "Finance team reviews all suspense account balances weekly. Items older than 7 days require documented action plan. Items older than 30 days require CFO escalation. Monthly reporting to Audit Committee on suspense account aging and trends.",
        "category": "Financial",
        "sub_category": "General Ledger",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "weekly",
        "regulatory_source": "Internal Policy - Suspense Account Management",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    
    # IT Security Controls (4)
    {
        "control_id": "IC-010",
        "name": "Quarterly User Access Recertification",
        "description": "Business unit managers must recertify all user access rights quarterly using the access governance platform. Access not recertified within 30 days is automatically revoked. Special focus on privileged accounts and access to critical systems. Results reported to IT Risk Committee.",
        "category": "IT Security",
        "sub_category": "Access Management",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "quarterly",
        "regulatory_source": "CBB Module ORM-2",
        "is_key_control": True,
        "priority": "high",
        "status": "active"
    },
    {
        "control_id": "IC-011",
        "name": "Privileged Access Management (PAM)",
        "description": "All privileged access to production systems requires just-in-time approval through PAM solution. Sessions are recorded and retained for 12 months. Emergency access requires CISO approval and post-incident review within 48 hours. Monthly privileged access report to IT Risk Committee.",
        "category": "IT Security",
        "sub_category": "Access Management",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "SAMA Cybersecurity Framework",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    {
        "control_id": "IC-012",
        "name": "Daily Backup Verification",
        "description": "IT Operations verifies successful completion of all critical system backups daily by 8:00 AM. Failed backups must be re-run and completed before noon. Monthly restore tests for randomly selected systems. Quarterly full DR testing with documented results.",
        "category": "IT Security",
        "sub_category": "Business Continuity",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "daily",
        "regulatory_source": "CBB Business Continuity Requirements",
        "is_key_control": True,
        "priority": "high",
        "status": "active"
    },
    {
        "control_id": "IC-013",
        "name": "Security Patch Management",
        "description": "Critical security patches must be assessed within 24 hours of release and applied within 7 days for internet-facing systems. All patches require change approval and testing in non-production before deployment. Monthly patch compliance reporting to CISO.",
        "category": "IT Security",
        "sub_category": "Vulnerability Management",
        "control_type": "preventive",
        "control_nature": "hybrid",
        "frequency": "weekly",
        "regulatory_source": "SAMA Cybersecurity Framework",
        "is_key_control": False,
        "priority": "high",
        "status": "active"
    },
    
    # AML/CFT Controls (4)
    {
        "control_id": "IC-014",
        "name": "Suspicious Activity Report (SAR) Filing",
        "description": "Compliance team reviews all transaction monitoring alerts within 24 hours. Confirmed suspicious activity must be escalated to MLRO within 2 hours. SAR filing decision documented within 5 business days. SARs filed with FIU within regulatory deadline. Monthly SAR statistics reported to Board.",
        "category": "AML/CFT",
        "sub_category": "Transaction Monitoring",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "daily",
        "regulatory_source": "AML Law / CBB Module FC",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    {
        "control_id": "IC-015",
        "name": "Dormant Account Monitoring",
        "description": "Accounts with no customer-initiated activity for 12 months are flagged as dormant. Reactivation requires enhanced verification including source of funds confirmation. Dormant accounts reviewed monthly for suspicious patterns. Annual escheatment review for abandoned accounts.",
        "category": "AML/CFT",
        "sub_category": "Account Monitoring",
        "control_type": "detective",
        "control_nature": "automated",
        "frequency": "monthly",
        "regulatory_source": "CBB Dormant Account Regulations",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    {
        "control_id": "IC-016",
        "name": "KYC Periodic Review",
        "description": "Customer KYC records reviewed based on risk rating: High-risk customers annually, Medium-risk every 2 years, Low-risk every 3 years. Expired documentation triggers account restrictions. PEP and sanctions screening refreshed at each review. Compliance dashboard tracks review completion.",
        "category": "AML/CFT",
        "sub_category": "Customer Due Diligence",
        "control_type": "preventive",
        "control_nature": "hybrid",
        "frequency": "annual",
        "regulatory_source": "FATF Recommendations / CBB Module FC",
        "is_key_control": True,
        "priority": "high",
        "status": "active"
    },
    {
        "control_id": "IC-017",
        "name": "Sanctions Screening",
        "description": "All customer names and transactions screened against OFAC, UN, EU, and local sanctions lists in real-time. Potential matches require disposition within 4 hours. True matches escalated to MLRO immediately. False positive management reviewed monthly for tuning.",
        "category": "AML/CFT",
        "sub_category": "Sanctions Compliance",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "OFAC Regulations / CBB Sanctions Requirements",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    
    # Credit Risk Controls (3)
    {
        "control_id": "IC-018",
        "name": "Credit File Completeness Review",
        "description": "Credit Administration reviews all new credit files for completeness within 5 days of approval. Checklist verification of required documents, approvals, covenants, and security perfection. Incomplete files tracked in exception register and escalated weekly to Chief Credit Officer.",
        "category": "Credit Risk",
        "sub_category": "Credit Administration",
        "control_type": "detective",
        "control_nature": "manual",
        "frequency": "weekly",
        "regulatory_source": "CBB Credit Risk Management Module",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    {
        "control_id": "IC-019",
        "name": "Credit Approval Authority Matrix",
        "description": "System enforces credit approval limits: Branch Manager up to $100K, Regional Credit Committee up to $1M, Head Office Credit Committee up to $10M, Board Credit Committee above $10M. Group exposures aggregate all related party limits. Excesses require next-level approval.",
        "category": "Credit Risk",
        "sub_category": "Credit Approval",
        "control_type": "preventive",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "Board Delegated Authority Policy",
        "is_key_control": True,
        "priority": "critical",
        "status": "active"
    },
    {
        "control_id": "IC-020",
        "name": "Portfolio Stress Testing",
        "description": "Risk Management conducts quarterly stress testing of credit portfolio using regulatory and internal scenarios. Results presented to ALCO and Risk Committee. Capital impact assessment included. Annual reverse stress testing to identify portfolio breaking points.",
        "category": "Credit Risk",
        "sub_category": "Risk Analytics",
        "control_type": "detective",
        "control_nature": "manual",
        "frequency": "quarterly",
        "regulatory_source": "CBB Stress Testing Guidelines",
        "is_key_control": True,
        "priority": "high",
        "status": "active"
    },
    
    # Customer Service Controls (2)
    {
        "control_id": "IC-021",
        "name": "Customer Complaint 24-Hour Logging",
        "description": "All customer complaints must be logged in CRM system within 24 hours of receipt regardless of channel. Acknowledgment sent to customer within 48 hours. Complaint categorization and root cause analysis required. Escalation matrix based on severity and customer segment.",
        "category": "Customer Service",
        "sub_category": "Complaint Management",
        "control_type": "detective",
        "control_nature": "hybrid",
        "frequency": "daily",
        "regulatory_source": "CBB Consumer Protection Regulations",
        "is_key_control": False,
        "priority": "medium",
        "status": "active"
    },
    {
        "control_id": "IC-022",
        "name": "Service Level Agreement (SLA) Monitoring",
        "description": "Customer Service team monitors SLA compliance for all service requests daily. SLA breaches require supervisor intervention and customer notification. Weekly SLA performance reports to Branch Managers. Monthly trending analysis presented to Operations Committee.",
        "category": "Customer Service",
        "sub_category": "Service Quality",
        "control_type": "detective",
        "control_nature": "automated",
        "frequency": "daily",
        "regulatory_source": "Internal Service Standards Policy",
        "is_key_control": False,
        "priority": "low",
        "status": "active"
    }
]


def seed_internal_controls():
    """
    Seed banking internal controls for all existing tenants.
    Skips if controls already exist for a tenant.
    Controls are user-deletable sample data.
    """
    db = SessionLocal()
    try:
        tenants = db.query(Tenant).filter(Tenant.is_active == True).all()
        
        if not tenants:
            print("No active tenants found, skipping internal controls seeding...")
            return
        
        for tenant in tenants:
            existing_controls = db.query(InternalControl).filter(
                InternalControl.tenant_id == tenant.id
            ).first()
            
            if existing_controls:
                print(f"Internal controls already exist for tenant '{tenant.name}', skipping...")
                continue
            
            print(f"Seeding internal controls for tenant '{tenant.name}'...")
            
            for control_data in BANKING_INTERNAL_CONTROLS:
                control = InternalControl(
                    tenant_id=tenant.id,
                    control_id=control_data["control_id"],
                    name=control_data["name"],
                    description=control_data["description"],
                    category=control_data["category"],
                    sub_category=control_data.get("sub_category"),
                    control_type=control_data["control_type"],
                    control_nature=control_data["control_nature"],
                    frequency=control_data["frequency"],
                    regulatory_source=control_data["regulatory_source"],
                    is_key_control=control_data["is_key_control"],
                    priority=control_data["priority"],
                    status=control_data["status"],
                    effective_date=datetime.utcnow(),
                    workflow_status="approved"
                )
                db.add(control)
            
            db.commit()
            print(f"Successfully seeded {len(BANKING_INTERNAL_CONTROLS)} internal controls for tenant '{tenant.name}'")
        
        print("Internal controls seeding completed!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding internal controls: {e}")
        raise
    finally:
        db.close()
