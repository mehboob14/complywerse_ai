import requests
import json

# Test the generate-phases endpoint
url = "http://localhost:4000/grc/certifications/frameworks/21/generate-phases"

try:
    print("Testing POST /certifications/frameworks/21/generate-phases...")
    print(f"URL: {url}\n")
    
    response = requests.post(url, timeout=60)
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}\n")
    
    if response.status_code == 200:
        data = response.json()
        print("✓ Success!")
        print(f"Message: {data.get('message')}")
        print(f"Framework ID: {data.get('framework_id')}")
        print(f"Number of phases: {len(data.get('phases', []))}\n")
        
        phases = data.get('phases', [])
        for phase in phases:
            print(f"Phase {phase.get('phase_number')}: {phase.get('name')}")
            print(f"  Description: {phase.get('description')}")
            print(f"  Key Tasks: {len(phase.get('key_tasks', []))} tasks")
            print(f"  Deliverables: {len(phase.get('deliverables', []))} deliverables")
            print()
    else:
        print("✗ Error!")
        print(f"Response: {response.text}")
        
except Exception as e:
    print(f"✗ Exception: {str(e)}")
