#!/usr/bin/env python
import requests
import json

# First check if the endpoint exists by checking the OpenAPI schema
try:
    schema_response = requests.get('http://localhost:4000/openapi.json', timeout=5)
    schema = schema_response.json()
    
    # Look for phase endpoints
    paths = schema.get('paths', {})
    print("Available endpoints with 'phase' in path:")
    for path in sorted(paths.keys()):
        if 'phase' in path.lower():
            print(f"  {path}")
            for method in paths[path].keys():
                print(f"    {method.upper()}: {paths[path][method].get('description', 'No description')[:80]}")
    
    print("\n\nSearching for /certifications endpoints:")
    for path in sorted(paths.keys()):
        if '/certifications/' in path:
            print(f"  {path}: {list(paths[path].keys())}")
            
    # Now try to make the PATCH request
    print("\n\nTesting PATCH request to /grc/certifications/2/phases/1:")
    response = requests.patch(
        'http://localhost:4000/grc/certifications/2/phases/1',
        json={'is_completed': True},
        headers={'Content-Type': 'application/json'}
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text[:500]}")
            
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
