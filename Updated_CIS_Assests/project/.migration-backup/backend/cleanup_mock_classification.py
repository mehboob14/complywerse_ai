"""Remove the lab fixtures inserted by mock_multi_os_for_classification.py."""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

LAB_NAMES = ("WIN-DC-LAB", "LNX-WEB-LAB", "AWS-PROD-LAB", "CISCO-SW-LAB")

with eng.begin() as c:
    r = c.execute(text(
        "DELETE FROM grc_it_assets WHERE name = ANY(:n)"
    ), {"n": list(LAB_NAMES)})
    print(f"Removed {r.rowcount} lab fixtures.")
