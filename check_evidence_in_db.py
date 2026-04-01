#!/usr/bin/env python3
"""Check if ETGRMF ParsedFrameworkControl records have evidence_requirements loaded"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from grc.models import SessionLocal, ParsedFrameworkControl, UploadedFramework

db = SessionLocal()

try:
    # Find ETGRMF framework
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.name == "SBP ETGRMF"
    ).first()
    
    if not framework:
        print("❌ ETGRMF framework not found in database")
        print()
        print("Available frameworks:")
        frameworks = db.query(UploadedFramework).all()
        for fw in frameworks:
            print(f"  - {fw.name} (ID: {fw.id})")
    else:
        print(f"✅ Found ETGRMF framework (ID: {framework.id})")
        print()
        
        # Check controls
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).limit(5).all()
        
        print(f"✅ Total controls in framework: {framework.parsed_controls if hasattr(framework, 'parsed_controls') else 'N/A'}")
        print()
        print("✅ Sample controls with evidence check:")
        print()
        
        for control in controls:
            evidence = control.evidence_requirements
            print(f"  Control: {control.control_id} - {control.title[:40]}")
            print(f"    Evidence stored: {bool(evidence)}")
            print(f"    Evidence count: {len(evidence) if evidence else 0}")
            if evidence:
                if isinstance(evidence, list):
                    if len(evidence) > 0:
                        first_ev = evidence[0]
                        if isinstance(first_ev, dict):
                            print(f"    Sample: {first_ev.get('title', 'N/A')}")
                        else:
                            print(f"    Sample: {str(first_ev)[:60]}")
            print()
            
finally:
    db.close()
