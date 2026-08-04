"""
Direct database test for AI recommendation feature
"""
import sqlite3
import json
from pathlib import Path

db_path = Path(__file__).parent / "grc_app.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("CHECKING COMPLIANCE ASSESSMENTS")
print("=" * 80)

# Check if we have any assessments
cursor.execute("SELECT COUNT(*) FROM grc_compliance_assessment_documents")
assessment_count = cursor.fetchone()[0]
print(f"\nTotal assessments: {assessment_count}")

if assessment_count > 0:
    # Get first assessment
    cursor.execute("""
        SELECT id, name, assessment_type, total_items 
        FROM grc_compliance_assessment_documents 
        LIMIT 1
    """)
    assessment = cursor.fetchone()
    print(f"\nFirst assessment:")
    print(f"  ID: {assessment[0]}")
    print(f"  Name: {assessment[1]}")
    print(f"  Type: {assessment[2]}")
    print(f"  Total Items: {assessment[3]}")
    
    # Check items for this assessment
    cursor.execute("""
        SELECT id, item_number, control_description, compliance_status,
               ai_evidence_recommendation, ai_recommendation_generated_at
        FROM grc_compliance_assessment_document_items
        WHERE assessment_id = ?
        LIMIT 5
    """, (assessment[0],))
    
    items = cursor.fetchall()
    print(f"\nFound {len(items)} items:")
    
    for item in items:
        print(f"\n  Item {item[0]}:")
        print(f"    Number: {item[1]}")
        print(f"    Description: {item[2][:80]}..." if item[2] and len(item[2]) > 80 else f"    Description: {item[2]}")
        print(f"    Status: {item[3]}")
        print(f"    AI Recommendation: {'YES' if item[4] else 'NO'}")
        if item[4]:
            try:
                rec = json.loads(item[4])
                print(f"    Recommendation summary: {rec.get('summary', 'N/A')[:100]}...")
            except:
                print(f"    Recommendation (raw): {item[4][:100]}...")
        print(f"    Generated at: {item[5] or 'Never'}")
else:
    print("\n✗ No assessments found in database")
    print("\nTo test AI recommendations:")
    print("1. Upload a compliance assessment through the UI")
    print("2. Navigate to the assessment details")
    print("3. Click on an item and request AI recommendation")

conn.close()

print("\n" + "=" * 80)
print("ENVIRONMENT CHECK")
print("=" * 80)

import os
from dotenv import load_dotenv

# Load environment
load_dotenv(Path(__file__).parent / ".env")

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

print(f"\nOpenAI API Key: {'✓ SET' if api_key and len(api_key) > 20 else '✗ NOT SET'}")
if api_key:
    print(f"  Key prefix: {api_key[:20]}...")
print(f"OpenAI Model: {model}")
print(f"Base URL: {os.getenv('AI_INTEGRATIONS_OPENAI_BASE_URL', 'Default (api.openai.com)')}")

print("\n" + "=" * 80)
print("TEST OPENAI CONNECTION")
print("=" * 80)

if api_key and len(api_key) > 20:
    try:
        from openai import OpenAI
        
        client = OpenAI(api_key=api_key)
        
        print("\nTesting API connection with simple query...")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Say 'test successful' if you receive this."}
            ],
            max_tokens=20
        )
        
        print(f"✓ API Connection Successful!")
        print(f"Response: {response.choices[0].message.content}")
        
    except Exception as e:
        print(f"✗ API Connection Failed: {str(e)}")
else:
    print("\n✗ Cannot test - API key not configured")

print("\n" + "=" * 80)
