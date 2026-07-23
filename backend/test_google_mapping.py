"""Verify the Google Workspace -> grc_users mapping WITHOUT a real Google org.
Run:  python test_google_mapping.py
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401
from grc.db import get_tenant_session_factory
from grc.models import GRCUser
from grc.modules.access_review import google as G

GUSERS = [
    {"id": "g-1", "primaryEmail": "gita@gtest.example", "suspended": False, "archived": False,
     "isEnrolledIn2Sv": True, "lastLoginTime": "2026-06-12T07:30:00.000Z",
     "name": {"fullName": "Gita Google"},
     "organizations": [{"department": "Marketing", "title": "Manager"}]},
    {"id": "g-2", "primaryEmail": "hank@gtest.example", "suspended": True, "archived": False,
     "isEnrolledIn2Sv": False, "name": {"fullName": "Hank Suspended"}},
    {"id": "g-3", "primaryEmail": "ivy@gtest.example", "suspended": False, "archived": True,
     "isEnrolledIn2Sv": True, "name": {"fullName": "Ivy Archived"}},
]


def run():
    db = get_tenant_session_factory("complyverse")()
    G.fetch_google_users = lambda access_token, customer="my_customer", max_pages=50: list(GUSERS)
    orig = db.commit
    db.commit = db.flush
    R = []
    def ok(n, c): R.append((n, bool(c)))
    try:
        res = G.sync_google_population(db, access_token="fake")
        ok("created 3", res.get("created") == 3)

        def u(e): return db.query(GRCUser).filter(GRCUser.email == e).first()
        a, b, c = u("gita@gtest.example"), u("hank@gtest.example"), u("ivy@gtest.example")
        ok("gita imported", a is not None)
        ok("gita name", a and a.display_name == "Gita Google")
        ok("gita department", a and a.department == "Marketing")
        ok("gita title -> designation", a and a.designation == "Manager")
        ok("gita MFA True (2Sv)", a and a.mfa_enabled is True)
        ok("gita active", a and a.account_enabled is True)
        ok("gita provider google", a and a.external_provider == "google")
        ok("hank suspended -> disabled", b and b.account_enabled is False)
        ok("hank no 2Sv -> mfa False", b and b.mfa_enabled is False)
        ok("ivy archived -> disabled", c and c.account_enabled is False)
        ok("ivy archived -> termination_date set", c and c.termination_date is not None)
    finally:
        db.commit = orig
        db.rollback()
        db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print("\n  RESULT:", ("ALL %d GOOGLE MAPPING CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    run()
