"""Verify the SailPoint IGA -> grc_users/roles mapping WITHOUT a real tenant.
Run:  python test_sailpoint_mapping.py

fetch_sailpoint_identities is patched out (no API call); we feed representative
SailPoint identity docs and assert the upsert + entitlement→role linking.
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401
from grc.db import get_tenant_session_factory
from grc.models import GRCUser, Role, UserRole
from grc.modules.access_review import sailpoint as SP

IDENTITIES = [
    {"id": "sp-1", "name": "Pam Privileged",
     "attributes": {"email": "pam@sptest.example", "displayName": "Pam Privileged",
                    "department": "Finance", "jobTitle": "Manager",
                    "cloudLifecycleState": "active"},
     "access": [{"type": "ROLE", "name": "Administrator"},
                {"type": "ENTITLEMENT", "name": "Payments Approver"}]},
    {"id": "sp-2", "name": "Leo Leaver",
     "attributes": {"email": "leo@sptest.example", "displayName": "Leo Leaver",
                    "cloudLifecycleState": "terminated"},
     "access": [{"type": "ENTITLEMENT", "name": "VPN Access"}]},
    {"id": "sp-3", "name": "No Email",  # missing email -> skipped
     "attributes": {"displayName": "No Email", "cloudLifecycleState": "active"},
     "access": []},
]


def run():
    db = get_tenant_session_factory("complyverse")()
    SP.fetch_sailpoint_identities = lambda *a, **k: list(IDENTITIES)
    db.commit = db.flush  # stay in-transaction; roll back at the end
    R = []
    def ok(n, c): R.append((n, bool(c)))
    try:
        # ---- pure mapping ----
        a = SP.map_identity(IDENTITIES[0])
        ok("pam email", a and a["email"] == "pam@sptest.example")
        ok("pam department", a and a["department"] == "Finance")
        ok("pam 2 entitlements", a and a["entitlements"] == ["Administrator", "Payments Approver"])
        ok("pam active", a and a["account_enabled"] is True)
        b = SP.map_identity(IDENTITIES[1])
        ok("leo terminated -> disabled", b and b["account_enabled"] is False and b["terminated"] is True)
        ok("no-email skipped", SP.map_identity(IDENTITIES[2]) is None)

        # ---- full sync (rolled back) ----
        # find a real tenant id from an existing role/user, fallback 1
        tid = (db.query(Role.tenant_id).filter(Role.tenant_id.isnot(None)).first() or [1])[0]
        res = SP.sync_sailpoint_population(db, tenant_id=tid, base_url="https://x.api.identitynow.com",
                                           client_id="cid", client_secret="sec")
        ok("created 2 (3rd skipped)", res.get("created") == 2 and res.get("skipped") == 1)
        ok("entitlements linked = 3", res.get("entitlements_linked") == 3)

        pam = db.query(GRCUser).filter(GRCUser.email == "pam@sptest.example").first()
        ok("pam persisted", pam is not None)
        ok("pam provider sailpoint", pam and pam.external_provider == "sailpoint")
        # pam has 2 sailpoint-sourced roles
        prole_ct = db.query(UserRole).filter(UserRole.user_id == pam.id,
                                             UserRole.source == "sailpoint").count()
        ok("pam 2 roles linked", prole_ct == 2)
        # 'Administrator' role exists and is linked → privileged detection works
        admin_role = db.query(Role).filter(Role.name == "Administrator", Role.tenant_id == tid).first()
        ok("Administrator role created/reused", admin_role is not None)
    finally:
        db.rollback()
        db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print("\n  RESULT:", ("ALL %d SAILPOINT CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    run()
