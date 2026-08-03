import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)
from grc.db import open_tenant_session
from grc.models import ITAsset, Tenant

db = open_tenant_session("liztek-1")
try:
    t = db.query(Tenant).filter(Tenant.slug == "liztek-1").first()
    print(f"tenant_id={t.id} (slug=liztek-1)\n")
    print("Current mock cluster:")
    rows = db.query(ITAsset).filter(
        ITAsset.tenant_id == t.id,
        ITAsset.ip_address == "10.50.0.21",
    ).order_by(ITAsset.id).all()
    for a in rows:
        marker = "  <-- HOST (open this one)" if a.asset_type == "infrastructure" else ""
        print(f"  id={a.id:>3}  {a.name:<26}  type={a.asset_type:<14}  os={a.os_normalized}{marker}")
finally:
    db.close()
