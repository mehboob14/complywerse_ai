"""
Verify phases after AI generation
"""
import sys
sys.path.insert(0, '.')

from grc.models import get_db, UploadedFramework
import json

db = next(get_db())

# Check framework 21's document_structure for phases
framework = db.query(UploadedFramework).filter(UploadedFramework.id == 21).first()

if framework:
    print(f"Framework: {framework.name}")
    print(f"Has document_structure: {framework.document_structure is not None}")
    
    if framework.document_structure:
        doc_struct = framework.document_structure
        if isinstance(doc_struct, str):
            doc_struct = json.loads(doc_struct)
        
        sections = doc_struct.get("sections", [])
        print(f"\nPhases/Sections count: {len(sections)}")
        
        if sections:
            print("\nPhases:")
            for section in sections:
                num = section.get("number", "?")
                name = section.get("name", "Unnamed")
                desc = section.get("description", "")[:60]
                tasks = len(section.get("key_tasks", []))
                deliverables = len(section.get("deliverables", []))
                print(f"  {num}. {name}")
                print(f"     {desc}...")
                print(f"     Tasks: {tasks}, Deliverables: {deliverables}")
        else:
            print("\nNo phases/sections found in document_structure")
            print("Run AI generation to create phases")
    else:
        print("\nNo document_structure found")
else:
    print("Framework 21 not found")

db.close()
