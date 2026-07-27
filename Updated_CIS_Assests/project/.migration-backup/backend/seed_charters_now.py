"""
Seed charters for existing committees
"""

from datetime import datetime, timedelta
import sys
sys.path.insert(0, 'c:/Users/Admin/Documents/GRC-Tenant/backend')

from grc.models import SessionLocal, GovernanceCommittee, CommitteeCharter

db = SessionLocal()

try:
    # Get all committees
    committees = db.query(GovernanceCommittee).all()
    
    print(f"Found {len(committees)} committee(s)")
    
    created_count = 0
    for committee in committees:
        # Check if charter already exists
        existing_charter = db.query(CommitteeCharter).filter(
            CommitteeCharter.committee_id == committee.id
        ).first()
        
        if existing_charter:
            print(f"  Committee '{committee.name}' (ID: {committee.id}) already has a charter")
            continue
        
        # Create default charter
        charter = CommitteeCharter(
            tenant_id=committee.tenant_id,
            committee_id=committee.id,
            title=f"{committee.name} Charter",
            version="1.0",
            content=f"This charter establishes the purpose, authority, composition, and responsibilities of the {committee.name}. {committee.description or 'The Board of Directors is responsible for overall governance and strategic direction of the organization, including approval of major policies, oversight of executive management, and fiduciary responsibilities to stakeholders.'}",
            status="active",
            effective_date=datetime(2025, 1, 25),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(charter)
        print(f"  ✓ Created charter for '{committee.name}' (ID: {committee.id})")
        created_count += 1
    
    db.commit()
    print(f"\n✓ Successfully created {created_count} charter(s)")
    
except Exception as e:
    db.rollback()
    print(f"\n✗ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
