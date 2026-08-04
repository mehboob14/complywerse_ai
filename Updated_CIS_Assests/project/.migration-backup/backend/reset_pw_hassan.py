"""Reset Hassan (mehboob / info@layeron.com) password to a known value
for browser testing."""
import os
import bcrypt
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

EMAIL_CANDIDATES = ["info@layeron.com", "hassan@layeron.com", "mehboob@layeron.com"]
NEW_PASSWORD = "Compliance2026"
pw_hash = bcrypt.hashpw(NEW_PASSWORD.encode(), bcrypt.gensalt()).decode()

with eng.begin() as c:
    for email in EMAIL_CANDIDATES:
        # Public
        r1 = c.execute(text(
            "UPDATE grc_users SET password_hash=:h WHERE email=:e"
        ), {"h": pw_hash, "e": email})
        # Tenant schema
        try:
            r2 = c.execute(text(
                "UPDATE tenant_layerongroupllc.users SET password_hash=:h WHERE email=:e"
            ), {"h": pw_hash, "e": email})
            rcount2 = r2.rowcount
        except Exception:
            rcount2 = 0
        if r1.rowcount or rcount2:
            print(f"  {email}: public={r1.rowcount} tenant={rcount2}")
print()
print("All matching users now have password:", NEW_PASSWORD)
