#!/usr/bin/env python3
"""Load evidence_requirements from seed JSON and update existing ParsedFrameworkControl records"""

import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from grc.models import SessionLocal, ParsedFrameworkControl, UploadedFramework

# Load the seed JSON
seed_file = "backend/grc/seed_data/frameworks/sbp_etgrmf.json"

print(f"Loading seed data from: {seed_file}")

with open(seed_file, 'r', encoding='utf-8') as f:
    data = json.load(f)

controls_data = data.get("controls", [])
print(f"Found {len(controls_data)} controls in seed file")

# Get database session
db = SessionLocal()

try:
    # Find ETGRMF framework
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.name == "SBP ETGRMF"
    ).first()
    
    if not framework:
        print("❌ ETGRMF framework not found")
        sys.exit(1)
    
    print(f"✅ Found ETGRMF framework (ID: {framework.id})")
    print()
    
    # Update each control with evidence from seed data
    updated_count = 0
    for control_data in controls_data:
        control_id = control_data.get("control_id")
        evidence_reqs = control_data.get("evidence_requirements", [])
        
        # Find the control in database
        control = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id,
            ParsedFrameworkControl.control_id == control_id
        ).first()
        
        if control:
            # Update with evidence
            control.evidence_requirements = evidence_reqs
            updated_count += 1
        else:
            print(f"⚠️  Control not found: {control_id}")
    
    # Commit changes
    db.commit()
    
    print(f"✅ Updated {updated_count} controls with evidence requirements")
    print()
    
    # Verify
    print("✅ Verification:")
    controls_with_evidence = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework.id,
        ParsedFrameworkControl.evidence_requirements.isnot(None)
    ).all()
    
    print(f"   Controls with evidence in DB: {len(controls_with_evidence)}")
    
    # Sample verification
    if controls_with_evidence:
        sample = controls_with_evidence[0]
        evidence_count = len(sample.evidence_requirements) if sample.evidence_requirements else 0
        print(f"   Sample: {sample.control_id} has {evidence_count} evidence items")
    
    print()
    print("✅ ETGRMF evidence requirements loaded successfully!")
    
except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()

finally:
    db.close()
