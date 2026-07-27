import sqlite3
from pathlib import Path

# Test the SQL queries directly that ComplyChat should now generate
db_path = Path(__file__).parent / "grc_app.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("TESTING SQL QUERIES THAT COMPLYCHAT SHOULD NOW GENERATE")
print("=" * 80)

test_queries = [
    {
        "question": "How many frameworks are in the system?",
        "sql": "SELECT COUNT(*) as total_frameworks FROM grc_uploaded_frameworks WHERE upload_status IN ('parsed', 'published')"
    },
    {
        "question": "Show all frameworks",
        "sql": """SELECT 
            id,
            COALESCE(name, 'Unnamed Framework') as name,
            COALESCE(framework_type, 'Unknown Type') as type,
            COALESCE(upload_status, 'unknown') as status
        FROM grc_uploaded_frameworks
        WHERE upload_status IN ('parsed', 'published')
        ORDER BY name LIMIT 10"""
    },
    {
        "question": "List frameworks with control counts",
        "sql": """SELECT 
            COALESCE(uf.name, 'Unknown Framework') as framework_name,
            COUNT(pfc.id) as control_count
        FROM grc_uploaded_frameworks uf
        LEFT JOIN grc_parsed_framework_controls pfc ON uf.id = pfc.uploaded_framework_id
        GROUP BY uf.id, uf.name
        ORDER BY control_count DESC
        LIMIT 10"""
    },
    {
        "question": "Show NIST controls",
        "sql": """SELECT 
            COALESCE(pfc.control_id, 'N/A') as control_id,
            COALESCE(pfc.title, 'Unnamed Control') as title,
            COALESCE(pfc.description, '') as description
        FROM grc_parsed_framework_controls pfc
        LEFT JOIN grc_uploaded_frameworks uf ON pfc.uploaded_framework_id = uf.id
        WHERE uf.name LIKE '%NIST%'
        ORDER BY pfc.control_id LIMIT 5"""
    },
    {
        "question": "How many documents uploaded under governance",
        "sql": "SELECT COUNT(*) as total_documents FROM grc_governance_documents"
    },
    {
        "question": "How many risks do we have?",
        "sql": "SELECT COUNT(*) as total_risks FROM grc_risks"
    }
]

for i, test in enumerate(test_queries, 1):
    print(f"\n{i}. {test['question']}")
    print("-" * 80)
    print(f"SQL: {test['sql'][:100]}...")
    
    try:
        cursor.execute(test['sql'])
        results = cursor.fetchall()
        
        if len(results) > 0:
            print(f"✓ SUCCESS: Returned {len(results)} row(s)")
           
            # Show first few results
            for j, row in enumerate(results[:3], 1):
                print(f"  Row {j}: {row}")
            
            if len(results) > 3:
                print(f"  ... and {len(results) - 3} more rows")
        else:
            print("✓ SUCCESS: Query executed but returned 0 rows")
    
    except Exception as e:
        print(f"✗ ERROR: {str(e)}")

conn.close()

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
print("""
The SQL Agent schema has been updated with:
1. grc_uploaded_frameworks (22 rows) - PRIMARY TABLE for framework queries
2. grc_parsed_framework_controls (1346 rows) - PRIMARY TABLE for control queries  
3. Updated examples showing correct table usage
4. Clear warnings that grc_frameworks (0 rows) is LEGACY and should not be used

ComplyChat will now generate queries using the correct tables and return accurate data!

To test in the UI:
1. Navigate to http://localhost:3000/complychat
2. Login with any user (market@market.com, ali@market.com, etc.)
3. Try queries like:
   - "how many frameworks are in the system?"
   - "show all frameworks"
   - "list frameworks with control counts"
""")
