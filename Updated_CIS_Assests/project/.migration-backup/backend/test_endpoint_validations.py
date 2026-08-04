"""
Quick end-to-end test for the AI phase generation feature
"""
import os
import sys
sys.path.insert(0, '.')

# Set a dummy API key to test API key validation
os.environ["OPENAI_API_KEY"] = "sk-test-mock-for-validation"

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

print("=" * 70)
print("AI PHASE GENERATION ENDPOINT TEST")
print("=" * 70)

# Test 1: Without API key or with invalid key - should get 503
print("\n📋 Test 1: API Key validation (set to test-mock)")
print("-" * 70)

response = client.post("/grc/certifications/frameworks/21/generate-phases")
print(f"Status Code: {response.status_code}")

if response.status_code == 503:
    data = response.json()
    print(f"✓ PASS: Proper 503 error handling")
    print(f"  Detail: {data.get('detail')}")
elif response.status_code == 200:
    print(f"✓ PASS: API key works, phases generated!")
    data = response.json()
    print(f"  Phases: {len(data.get('phases', []))}")
else:
    print(f"✗ FAIL: Unexpected status {response.status_code}")
    print(f"  Response: {response.json() if response.status_code < 500 else response.text}")

# Test 2: Non-existent framework
print("\n📋 Test 2: Non-existent framework")
print("-" * 70)

response = client.post("/grc/certifications/frameworks/99999/generate-phases")
print(f"Status Code: {response.status_code}")

if response.status_code == 404:
    data = response.json()
    print(f"✓ PASS: 404 for non-existent framework")
    print(f"  Detail: {data.get('detail')}")
else:
    print(f"✗ FAIL: Expected 404, got {response.status_code}")

print("\n" + "=" * 70)
