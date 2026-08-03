"""Add Aisha as a second user in the Layeron tenant.

Mirrors what tenant signup does:
  • Inserts into public.grc_users
  • Inserts into tenant_layerongroupllc.users
  • Same bcrypt password hash in both, so login works against either
    the public-schema fallback or the tenant schema.
"""
import os, bcrypt
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

PASSWORD = "Compliance2026"
pw_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()

with eng.begin() as c:
    # Public schema (cross-tenant identity)
    existing = c.execute(
        text("SELECT id FROM grc_users WHERE email='aisha@layeron.com'")
    ).first()
    if not existing:
        c.execute(text(
            "INSERT INTO grc_users (username, email, password_hash, display_name, "
            "is_active, created_at) VALUES (:u, :e, :h, :d, true, NOW())"
        ), {"u": "aisha", "e": "aisha@layeron.com", "h": pw_hash, "d": "Aisha"})
        print("✓ Inserted into public.grc_users")
    else:
        print(f"public.grc_users already has aisha at id={existing[0]}")

    # Tenant schema (authoritative for login when subdomain resolves)
    existing_t = c.execute(text(
        "SELECT id FROM tenant_layerongroupllc.users WHERE email='aisha@layeron.com'"
    )).first()
    if not existing_t:
        c.execute(text(
            "INSERT INTO tenant_layerongroupllc.users "
            "(tenant_id, username, email, password_hash, display_name, is_active, created_at) "
            "VALUES ('tenant_layerongroupllc', :u, :e, :h, :d, true, NOW())"
        ), {"u": "aisha", "e": "aisha@layeron.com", "h": pw_hash, "d": "Aisha"})
        print("✓ Inserted into tenant_layerongroupllc.users")
    else:
        print(f"tenant_layerongroupllc.users already has aisha at id={existing_t[0]}")

print()
print(f"Aisha credentials:")
print(f"  email:    aisha@layeron.com")
print(f"  password: {PASSWORD}")
