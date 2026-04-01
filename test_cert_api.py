#!/usr/bin/env python3
"""Verify the certification API returns evidence requirements"""

import requests
import json

BASE_URL = "http://localhost:4000/grc"

print("=" * 80)
print("TESTING CERTIFICATION API - EVIDENCE REQUIREMENTS")
print("=" * 80)
print()

# First, get a certification (assuming one exists for ETGRMF)
print("Step 1: Getting certifications list...")
try:
    response = requests.get(f"{BASE_URL}/certifications", timeout=5)
    if response.status_code == 200:
        data = response.json()
        certifications = data.get("certifications", [])
        
        # Find ETGRMF certification
        etgrmf_cert = None
        for cert in certifications:
            if "ETGRMF" in cert.get("framework_name", ""):
                etgrmf_cert = cert
                break
        
        if etgrmf_cert:
            cert_id = etgrmf_cert["id"]
            print(f"✅ Found ETGRMF certification (ID: {cert_id})")
            print()
            
            # Get controls for this certification
            print(f"Step 2: Getting controls from certification {cert_id}...")
            response = requests.get(
                f"{BASE_URL}/certifications/{cert_id}/controls",
                timeout=5
            )
            
            if response.status_code == 200:
                controls_data = response.json()
                controls = controls_data.get("controls", [])
                
                print(f"✅ Got {len(controls)} controls")
                print()
                
                if controls:
                    # Check first control
                    control = controls[0]
                    print(f"Sample Control: {control.get('control_code')} - {control.get('control_name')}")
                    print(f"  Sub-controls: {len(control.get('sub_controls', []))}")
                    
                    evidence = control.get('evidence_requirements')
                    print(f"  Evidence requirements: {bool(evidence)}")
                    print(f"  Evidence count: {len(evidence) if evidence else 0}")
                    
                    if evidence:
                        print(f"  ✅ EVIDENCE IS BEING RETURNED!")
                        print()
                        for i, ev in enumerate(evidence[:3], 1):
                            if isinstance(ev, dict):
                                print(f"     {i}. {ev.get('title', 'N/A')}")
                            else:
                                print(f"     {i}. {str(ev)[:50]}")
                    else:
                        print(f"  ❌ NO EVIDENCE IN RESPONSE")
                    
                    # Check sub-controls
                    if control.get('sub_controls'):
                        print()
                        print(f"Sub-control sample:")
                        sub = control['sub_controls'][0]
                        print(f"  Code: {sub.get('code')}")
                        print(f"  Evidence: {len(sub.get('evidence_requirements', []))}")
            else:
                print(f"❌ Error getting controls: {response.status_code}")
                print(response.text[:200])
        else:
            print("❌ No ETGRMF certification found")
            print(f"Available: {[c.get('framework_name') for c in certifications]}")
    else:
        print(f"❌ Error: {response.status_code}")
        print(response.text[:200])
        
except Exception as e:
    print(f"❌ Connection error: {e}")
    print()
    print("Make sure backend is running: python main.py (in backend folder)")

print()
print("=" * 80)
