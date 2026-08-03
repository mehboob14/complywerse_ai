import sys
sys.path.insert(0, '.')

from grc.models import get_db, ParsedFrameworkControl, UploadedFramework

db = next(get_db())

# Check framework 21
fw = db.query(UploadedFramework).filter(UploadedFramework.id == 21).first()
if fw:
    print(f"Framework: {fw.name}")
    print(f"Version: {fw.version}")
    print(f"Type: {fw.framework_type}")
    
    # Count controls
    control_count = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == 21
    ).count()
    print(f"Controls count: {control_count}")
else:
    print("Framework 21 not found")

# Check controls
controls = db.query(ParsedFrameworkControl).filter(
    ParsedFrameworkControl.uploaded_framework_id == 21
).limit(5).all()

print(f"\nFound {len(controls)} controls (showing first 5):")
for c in controls[:3]:
    print(f"- {c.control_id}: {c.title[:60]}")

db.close()
