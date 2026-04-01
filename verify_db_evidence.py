#!/usr/bin/env python3
"""Directly query database to verify evidence loaded by API"""

import sys
sys.path.insert(0, 'backend')

from grc.models import SessionLocal, UploadedFramework, ParsedFrameworkControl

db = SessionLocal()

try:
    print("=" * 80)
    print("VERIFYING EVIDENCE IN DATABASE (via API services)")
    print("=" * 80)
    print()
    
    # Get ETGRMF framework
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.name == "SBP ETGRMF"
    ).first()
    
    if not framework:
        print("❌ ETGRMF framework not found")
    else:
        print(f"✅ Found ETGRMF framework (ID: {framework.id})")
        
        # Get controls
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework.id
        ).all()
        
        print(f"✅ Found {len(controls)} controls in database")
        print()
        
        # Check evidence in controls
        evidence_count = 0
        samples_with_evidence = []
        
        for control in controls[:20]:  # Check first 20
            evidence = control.evidence_requirements
            if evidence:
                evidence_count += 1
                if len(samples_with_evidence) < 3:
                    samples_with_evidence.append({
                        'code': control.control_id,
                        'name': control.title[:40],
                        'evidence_count': len(evidence)
                    })
        
        print(f"Controls with evidence (in first 20 checked): {evidence_count}/20")
        print()
        
        if samples_with_evidence:
            print("Sample controls with evidence:")
            for sample in samples_with_evidence:
                print(f"  • {sample['code']} - {sample['name']}... ({sample['evidence_count']} items)")
                
                # Get one control with evidence to show detail
                control = db.query(ParsedFrameworkControl).filter(
                    ParsedFrameworkControl.control_id == sample['code'],
                    ParsedFrameworkControl.uploaded_framework_id == framework.id
                ).first()
                
                if control and control.evidence_requirements:
                    print(f"    First evidence: {control.evidence_requirements[0].get('title', 'N/A') if isinstance(control.evidence_requirements[0], dict) else str(control.evidence_requirements[0])[:50]}")
            print()
        
        # Summary
        total_with_evidence = sum(
            1 for c in controls 
            if c.evidence_requirements and len(c.evidence_requirements) > 0
        )
        
        print(f"SUMMARY:")
        print(f"  Total controls: {len(controls)}")
        print(f"  Controls with evidence: {total_with_evidence}")
        print(f"  Average evidence per control: {sum(len(c.evidence_requirements or []) for c in controls) / len(controls) if controls else 0:.1f}")
        print()
        
        if total_with_evidence > 0:
            print("✅ DATABASE IS READY - Evidence is loaded and accessible to API")
        else:
            print("❌ NO EVIDENCE IN DATABASE")
            
finally:
    db.close()

print("=" * 80)
