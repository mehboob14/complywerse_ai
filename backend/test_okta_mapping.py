"""Verify the Okta -> grc_users mapping WITHOUT a real Okta org.

Patches the HTTP fetch with a recorded sample Okta /api/v1/users payload, runs
the real sync, and asserts every grc_users field maps correctly. Rolls back.

Run:  python test_okta_mapping.py
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401
from datetime import date
from grc.db import get_tenant_session_factory
from grc.models import GRCUser
from grc.modules.access_review import okta as O

# recorded sample Okta users payload
OKTA_USERS = [
    {"id": "okta-1", "status": "ACTIVE", "lastLogin": "2026-06-10T08:00:00.000Z",
     "profile": {"firstName": "Dana", "lastName": "Okta", "email": "dana@oktatest.example",
                 "login": "dana@oktatest.example", "department": "Finance", "title": "Analyst"}},
    {"id": "okta-2", "status": "DEPROVISIONED", "lastLogin": "2025-12-01T09:00:00.000Z",
     "statusChanged": "2026-03-01T00:00:00.000Z",
     "profile": {"displayName": "Evan Gone", "email": "evan@oktatest.example",
                 "login": "evan@oktatest.example", "department": "IT"}},
    {"id": "okta-3", "status": "SUSPENDED",
     "profile": {"firstName": "Fay", "lastName": "Hold", "email": "fay@oktatest.example",
                 "login": "fay@oktatest.example"}},
]


def run():
    db = get_tenant_session_factory("complyverse")()
    O.fetch_okta_users = lambda domain, token, max_pages=50: list(OKTA_USERS)
    orig_commit = db.commit
    db.commit = db.flush
    R = []
    def ok(n, c): R.append((n, bool(c)))
    try:
        res = O.sync_okta_population(db, domain="oktatest.example", token="fake")
        ok("sync created 3", res.get("created") == 3)

        def u(e):
            return db.query(GRCUser).filter(GRCUser.email == e).first()
        a, b, c = u("dana@oktatest.example"), u("evan@oktatest.example"), u("fay@oktatest.example")
        ok("dana imported", a is not None)
        ok("dana name = First Last", a and a.display_name == "Dana Okta")
        ok("dana department mapped", a and a.department == "Finance")
        ok("dana title -> designation", a and a.designation == "Analyst")
        ok("dana ACTIVE -> account_enabled True", a and a.account_enabled is True)
        ok("dana lastLogin mapped (2026-06-10)", a and a.entra_last_sign_in and a.entra_last_sign_in.date() == date(2026, 6, 10))
        ok("dana external_provider = okta", a and a.external_provider == "okta")
        ok("dana external_id = okta-1", a and a.external_id == "okta-1")
        ok("evan displayName used", b and b.display_name == "Evan Gone")
        ok("evan DEPROVISIONED -> account_enabled False", b and b.account_enabled is False)
        ok("evan DEPROVISIONED -> termination_date (2026-03-01)", b and b.termination_date == date(2026, 3, 1))
        ok("fay SUSPENDED -> account_enabled False", c and c.account_enabled is False)
    finally:
        db.commit = orig_commit
        db.rollback()
        db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print()
    print("  RESULT:", ("ALL %d OKTA MAPPING CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    run()
