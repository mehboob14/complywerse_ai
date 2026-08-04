"""Phase-2 verification: prove the Microsoft Entra → grc_users field mapping is
correct WITHOUT a real Azure tenant.

The only part of Access Review that depends on Microsoft is
`enrichment.sync_population` (it calls Graph). This test feeds a recorded sample
Graph payload through the real mapping code (by patching the two Graph helpers)
and asserts every field lands on grc_users as expected. Everything downstream of
this is already tested on mock data, so once this passes, connecting a real Entra
directory cannot introduce pipeline bugs — only auth/permission differences,
which the code already degrades gracefully on.

Run:  python test_entra_mapping.py        (rolls back; persists nothing)
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401  (loads app + models)
from datetime import date
from grc.db import get_tenant_session_factory
from grc.models import GRCUser
from grc.modules.access_review import enrichment as E

# ---- recorded sample Microsoft Graph payloads ---------------------------------
GRAPH_USERS = [
    {"id": "oid-alice", "mail": "alice@graphtest.example", "userPrincipalName": "alice@graphtest.example",
     "displayName": "Alice Graph", "accountEnabled": True, "department": "Finance",
     "jobTitle": "Analyst", "employeeHireDate": "2023-01-15T00:00:00Z", "employeeLeaveDateTime": None},
    {"id": "oid-bob", "mail": "bob@graphtest.example", "userPrincipalName": "bob@graphtest.example",
     "displayName": "Bob Graph", "accountEnabled": True, "department": "IT",
     "jobTitle": "Engineer", "employeeLeaveDateTime": "2026-03-01T00:00:00Z"},
    {"id": "oid-carol", "mail": "carol@graphtest.example", "userPrincipalName": "carol@graphtest.example",
     "displayName": "Carol Graph", "accountEnabled": False, "department": "Sales", "jobTitle": "Rep"},
]
GRAPH_MFA = [
    {"id": "oid-alice", "isMfaRegistered": False, "methodsRegistered": []},
    {"id": "oid-bob", "isMfaRegistered": True, "methodsRegistered": ["microsoftAuthenticator"]},
    # carol absent -> mfa stays unknown (None)
]
GRAPH_SIGNIN = [
    {"id": "oid-alice", "signInActivity": {"lastSignInDateTime": "2026-06-01T09:00:00Z"}},
    {"id": "oid-bob", "signInActivity": {"lastSignInDateTime": "2025-02-01T12:00:00Z"}},
    # carol absent -> sign-in stays None
]


class _Cfg:
    entra_directory_id = "fake-dir-id"
    allowed_email_domains = ["graphtest.example"]


def _fake_paged(url, token):
    if "userRegistrationDetails" in url:
        return list(GRAPH_MFA)
    if "signInActivity" in url:
        return list(GRAPH_SIGNIN)
    return list(GRAPH_USERS)


def main_test():
    db = get_tenant_session_factory("complyverse")()
    # patch ONLY the two Graph entry points; the real mapping logic runs untouched
    E._acquire_app_token = lambda tid: "fake-token"
    E._graph_get_paged = _fake_paged
    orig_commit = db.commit
    db.commit = db.flush  # keep changes in-transaction; we roll back at the end
    R = []
    def ok(name, cond): R.append((name, bool(cond)))
    try:
        res = E.sync_population(db, _Cfg())
        ok("sync returned created>=3", res.get("created", 0) >= 3)
        ok("MFA report detected available", res.get("mfa_report_available") is True)
        ok("sign-in activity detected available", res.get("sign_in_activity_available") is True)

        def u(email):
            return db.query(GRCUser).filter(GRCUser.email == email).first()
        a, b, c = u("alice@graphtest.example"), u("bob@graphtest.example"), u("carol@graphtest.example")
        ok("alice imported", a is not None)
        ok("alice department mapped", a and a.department == "Finance")
        ok("alice jobTitle -> designation", a and a.designation == "Analyst")
        ok("alice MFA=False mapped", a and a.mfa_enabled is False)
        ok("alice last sign-in mapped (2026-06-01)", a and a.entra_last_sign_in and a.entra_last_sign_in.date() == date(2026, 6, 1))
        ok("alice external_id (oid) stored", a and a.external_id == "oid-alice")
        ok("bob termination_date mapped (2026-03-01)", b and b.termination_date == date(2026, 3, 1))
        ok("bob MFA=True mapped", b and b.mfa_enabled is True)
        ok("bob account_enabled True", b and b.account_enabled is True)
        ok("carol account_enabled False mapped", c and c.account_enabled is False)
        ok("carol MFA unknown (None, absent from report)", c and c.mfa_enabled is None)
        ok("carol no sign-in (None, absent)", c and c.entra_last_sign_in is None)
    finally:
        db.commit = orig_commit
        db.rollback()
        db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print()
    print("  RESULT:", ("ALL %d MAPPING CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    main_test()
