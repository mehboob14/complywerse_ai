import requests
import json

base_url = "http://localhost:4000"

# Login first
try:
    login_response = requests.post(
        f"{base_url}/grc/auth/login",
        json={"username": "market@market.com", "password": "123456"},
        timeout=10
    )
    
    if login_response.status_code == 200:
        auth_data = login_response.json()
        token = auth_data.get("access_token")
        print(f"✓ Logged in successfully")
    else:
        print(f"✗ Login failed: {login_response.status_code}")
        print(f"Trying another user...")
        
        # Try alternate credentials
        login_response = requests.post(
            f"{base_url}/grc/auth/login",
            json={"username": "myorg@org.com", "password": "password"},
            timeout=10
        )
        
        if login_response.status_code == 200:
            auth_data = login_response.json()
            token = auth_data.get("access_token")
            print(f"✓ Logged in with alternate user")
        else:
            token = None
except Exception as e:
    print(f"✗ Login error: {str(e)}")
    token = None

if not token:
    print("\n✗ Cannot proceed without authentication")
    exit(1)

headers = {"Authorization": f"Bearer {token}"}

print("\n" + "=" * 80)
print("TESTING AI RECOMMENDATION ENDPOINT")
print("=" * 80)

# First, list assessments to find one with items
try:
    response = requests.get(
        f"{base_url}/grc/compliance/assessments",
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        data = response.json()
        assessments = data.get("assessments", [])
        
        if assessments:
            print(f"\n✓ Found {len(assessments)} assessment(s)")
            
            # Get the first assessment details
            assessment_id = assessments[0]["id"]
            print(f"Testing with assessment ID: {assessment_id}")
            
            # Get assessment details with items
            detail_response = requests.get(
                f"{base_url}/grc/compliance/assessments/{assessment_id}",
                headers=headers,
                timeout=10
            )
            
            if detail_response.status_code == 200:
                assessment_data = detail_response.json()
                items = assessment_data.get("items", [])
                
                if items:
                    print(f"✓ Found {len(items)} items in assessment")
                    
                    # Test AI recommendation on first item
                    item_id = items[0]["id"]
                    print(f"\nGenerating AI recommendation for item ID: {item_id}")
                    print(f"Item: {items[0].get('control_description', 'N/A')[:100]}...")
                    
                    ai_response = requests.post(
                        f"{base_url}/grc/compliance/assessments/{assessment_id}/items/{item_id}/ai-recommendation",
                        headers=headers,
                        timeout=60
                    )
                    
                    print(f"\nAI Recommendation Response Status: {ai_response.status_code}")
                    print(f"Response: {json.dumps(ai_response.json(), indent=2)}")
                    
                else:
                    print("✗ No items found in assessment")
            else:
                print(f"✗ Failed to get assessment details: {detail_response.status_code}")
                print(f"Response: {detail_response.text}")
        else:
            print("✗ No assessments found")
    else:
        print(f"✗ Failed to list assessments: {response.status_code}")
        print(f"Response: {response.text}")
        
except Exception as e:
    print(f"✗ Error: {str(e)}")

print("\n" + "=" * 80)
