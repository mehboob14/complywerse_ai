# Test script to verify AI phase generation endpoint with mock OpenAI key
import os
os.environ["OPENAI_API_KEY"] = "sk-test-mock-key-for-testing-purposes-only"

import sys
sys.path.insert(0, '.')

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

# Test the endpoint
print("Testing generate-phases endpoint...")
print("=" * 60)

response = client.post("/grc/certifications/frameworks/21/generate-phases")

print(f"Status Code: {response.status_code}")
print(f"Response: {response.json() if response.status_code != 500 else response.text}")

if response.status_code == 503:
    print("\n✓ Endpoint properly handles missing/invalid API key")
elif response.status_code == 200:
    print("\n✓ Endpoint works! (with valid API key)")
else:
    print(f"\n✗ Unexpected status code: {response.status_code}")
