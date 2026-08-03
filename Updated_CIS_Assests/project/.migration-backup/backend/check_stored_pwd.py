"""Check what password is actually stored on connection id=7."""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)

from grc.models import IntegrationConnection
sess = Session()
try:
    c = sess.get(IntegrationConnection, 7)
    pwd = c.password
    print(f"Stored password length: {len(pwd) if pwd else 'NULL'}")
    print(f"Equals 'ScannerSvc!2026': {pwd == 'ScannerSvc!2026'}")
    if pwd and pwd != "ScannerSvc!2026":
        print(f"First 4 chars: {pwd[:4]!r}")
        print(f"Last 4 chars:  {pwd[-4:]!r}")
finally:
    sess.close()
