#!/usr/bin/env python3
"""Test ETGRMF evidence requirements in API response"""

import requests
import json

BASE_URL = "http://localhost:8000/grc"

print("=" * 80)
print("TESTING ETGRMF EVIDENCE REQUIREMENTS ENDPOINT")
print("=" * 80)
print()

# First, get the list of framework controls
print("Testing: GET /controls/framework-controls (list with evidence)")
print("-" * 80)

try:
    response = requests.get(
        f"{BASE_URL}/controls/framework-controls",
        params={"limit": 3},
        timeout=5
    )
    
    if response.status_code == 200:
        data = response.json()
        controls = data.get("controls", [])
        
        print(f"✅ API Response Status: {response.status_code}")
        print(f"✅ Total Controls: {data.get('total')}")
        print(f"✅ Sample Controls Returned: {len(controls)}")
        print()
        
        if controls:
            control = controls[0]
            print(f"Sample Control ID: {control.get('control_id')}")
            print(f"Sample Control Title: {control.get('title')}")
            print()
            
            # Check for evidence_requirements
            evidence_reqs = control.get('evidence_requirements')
            if evidence_reqs:
                print(f"✅ EVIDENCE REQUIREMENTS FOUND: {len(evidence_reqs)} items")
                print()
                for i, ev in enumerate(evidence_reqs[:3], 1):
                    print(f"  Evidence {i}:")
                    if isinstance(ev, dict):
                        print(f"    - Title: {ev.get('title', 'N/A')}")
                        print(f"    - Type: {ev.get('artifact_type', 'N/A')}")
                        print(f"    - Desc: {ev.get('description', 'N/A')[:60]}...")
                    else:
                        print(f"    - {str(ev)[:60]}...")
            else:
                print("⚠️  NO EVIDENCE REQUIREMENTS FIELD Found")
        else:
            print("⚠️  No controls returned")
    else:
        print(f"❌ API Error: {response.status_code}")
        print(f"Response: {response.text[:200]}")
        
except Exception as e:
    print(f"❌ Connection Error: {e}")
    print()
    print("Note: Make sure the backend server is running:")
    print("  cd backend && python main.py")

print()
print("=" * 80)
print("TEST COMPLETE")
print("=" * 80)
