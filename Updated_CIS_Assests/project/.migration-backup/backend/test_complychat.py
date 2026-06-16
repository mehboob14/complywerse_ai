import requests
import json

# Test ComplyChat with framework queries
base_url = "http://localhost:4000"

# Login first to get auth token
print("=" * 80)
print("LOGGING IN...")
print("=" * 80)

try:
    login_response = requests.post(
        f"{base_url}/grc/auth/login",
        json={"username": "admin@example.com", "password": "admin123"},
        timeout=10
    )
    
    if login_response.status_code == 200:
        auth_data = login_response.json()
        token = auth_data.get("access_token")
        print(f"✓ Logged in successfully")
        print(f"Token: {token[:50]}...")
    else:
        print(f"✗ Login failed: {login_response.status_code}")
        print(f"Response: {login_response.text}")
        token = None
except Exception as e:
    print(f"✗ Login error: {str(e)}")
    token = None

if not token:
    print("\n✗ Cannot proceed without authentication")
    exit(1)

headers = {"Authorization": f"Bearer {token}"}

queries = [
    "how many frameworks are in the system?",
    "show all frameworks",
    "list frameworks with their control counts",
   "show NIST controls",
    "how many documents uploaded under governance",
    "how many risks do we have?",
]

print("\n" + "=" * 80)
print("TESTING COMPLYCHAT WITH VARIOUS QUERIES")
print("=" * 80)

for i, query in enumerate(queries, 1):
    print(f"\n{i}. Query: '{query}'")
    print("-" * 80)
    
    try:
        response = requests.post(
            f"{base_url}/grc/ai/complychat/ask",
            json={"question": query},
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            
            # Print SQL Generated
            if 'sql' in result and result['sql']:
                print(f"SQL Generated: {result['sql'][:200]}..." if len(result['sql']) > 200 else f"SQL Generated: {result['sql']}")
            
            # Print Answer
            if 'answer' in result:
                print(f"Answer: {result['answer'][:300]}..." if len(result['answer']) > 300 else f"Answer: {result['answer']}")
            
            # Print Data Preview
            if 'data' in result and result['data']:
                print(f"Data rows: {len(result['data'])}")
                if len(result['data']) > 0:
                    print(f"First row: {json.dumps(result['data'][0], indent=2)[:200]}...")
        else:
            print(f"Error: Status code {response.status_code}")
            print(f"Response: {response.text[:200]}")
    
    except Exception as e:
        print(f"Error: {str(e)}")

print("\n" + "=" * 80)
print("TEST COMPLETE")
print("=" * 80)
