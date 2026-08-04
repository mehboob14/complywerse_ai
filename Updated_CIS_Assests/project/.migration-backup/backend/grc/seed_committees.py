"""
Seed file for governance committees.
Creates sample governance committees for the GRC platform.
"""

from datetime import datetime, timedelta
from .models import SessionLocal, GovernanceCommittee, CommitteeMember, CommitteeCharter, Tenant, TenantUser


GOVERNANCE_COMMITTEES = [
    {
        "name": "Board of Directors",
        "description": "The Board of Directors is responsible for overall governance and strategic direction of the organization, including approval of major policies, oversight of executive management, and fiduciary responsibilities to stakeholders.",
        "committee_type": "board",
        "meeting_frequency": "quarterly",
    },
    {
        "name": "Audit Committee",
        "description": "The Audit Committee oversees financial reporting, internal controls, external and internal audit functions, and ensures compliance with financial regulations and accounting standards.",
        "committee_type": "audit_committee",
        "meeting_frequency": "quarterly",
    },
    {
        "name": "Risk Management Committee",
        "description": "Oversees enterprise risk management and ensures appropriate risk governance across all risk categories including credit, market, operational, and compliance risks.",
        "committee_type": "risk_committee",
        "meeting_frequency": "monthly",
    },
    {
        "name": "Compliance Committee",
        "description": "Monitors regulatory compliance across all jurisdictions, oversees compliance programs, reviews regulatory examination findings, and ensures adherence to applicable laws and regulations.",
        "committee_type": "compliance_committee",
        "meeting_frequency": "monthly",
    },
    {
        "name": "IT Steering Committee",
        "description": "Provides strategic direction for technology initiatives, oversees IT investments, monitors cybersecurity posture, and ensures alignment of technology with business objectives.",
        "committee_type": "it_steering",
        "meeting_frequency": "monthly",
    },
    {
        "name": "Executive Management Committee",
        "description": "Senior leadership committee responsible for day-to-day management decisions, operational oversight, and implementation of Board directives.",
        "committee_type": "custom",
        "meeting_frequency": "weekly",
    },
]


def seed_committees():
    """Seed governance committees for the default tenant."""
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.name == "Default Tenant").first()
        if not tenant:
            print("Default tenant not found. Cannot seed committees.")
            return
        
        existing_count = db.query(GovernanceCommittee).filter(
            GovernanceCommittee.tenant_id == tenant.id
        ).count()
        
        if existing_count > 0:
            print(f"Committees already exist for tenant '{tenant.name}' ({existing_count} committees), skipping...")
            return
        
        tenant_users = db.query(TenantUser).filter(TenantUser.tenant_id == tenant.id).limit(5).all()
        user_ids = [tu.user_id for tu in tenant_users] if tenant_users else []
        
        created_count = 0
        for idx, committee_data in enumerate(GOVERNANCE_COMMITTEES):
            chair_id = user_ids[idx % len(user_ids)] if user_ids else None
            secretary_id = user_ids[(idx + 1) % len(user_ids)] if user_ids else None
            
            committee = GovernanceCommittee(
                tenant_id=tenant.id,
                name=committee_data["name"],
                description=committee_data["description"],
                committee_type=committee_data["committee_type"],
                meeting_frequency=committee_data["meeting_frequency"],
                chair_id=chair_id,
                secretary_id=secretary_id,
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            db.add(committee)
            db.flush()
            
            if user_ids:
                for user_id in user_ids[:min(5, len(user_ids))]:
                    role = "member"
                    if user_id == chair_id:
                        role = "chair"
                    elif user_id == secretary_id:
                        role = "secretary"
                    
                    member = CommitteeMember(
                        tenant_id=tenant.id,
                        committee_id=committee.id,
                        user_id=user_id,
                        role=role,
                        joined_at=datetime.utcnow() - timedelta(days=180),
                        is_active=True,
                    )
                    db.add(member)
            
            charter = CommitteeCharter(
                tenant_id=tenant.id,
                committee_id=committee.id,
                title=f"{committee_data['name']} Charter",
                version="1.0",
                content=f"This charter establishes the purpose, authority, composition, and responsibilities of the {committee_data['name']}. {committee_data['description']}",
                status="active",
                effective_date=datetime.utcnow() - timedelta(days=365),
                created_at=datetime.utcnow() - timedelta(days=365),
            )
            db.add(charter)
            
            created_count += 1
        
        db.commit()
        print(f"Successfully seeded {created_count} governance committees.")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding committees: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_committees()
