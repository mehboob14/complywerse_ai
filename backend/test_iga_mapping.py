"""Verify the generic Tier-2 IGA adapters WITHOUT any real system.
Run:  python test_iga_mapping.py

fetch_identities is patched per vendor; we feed representative records and
assert each adapter's map() + the shared upsert (users + entitlements→roles).
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401
from grc.db import get_tenant_session_factory
from grc.models import GRCUser, Role, UserRole
from grc.modules.access_review import iga as IGA

# One representative record per vendor adapter.
SAMPLES = {
    "saviynt": [{"username": "sav@iga.example", "email": "sav@iga.example", "firstname": "Sav",
                 "lastname": "User", "departmentname": "Finance", "statuskey": "1",
                 "entitlements": [{"entitlement_value": "AP_Clerk"}, {"entitlement_value": "Administrator"}]}],
    "oracle_ig": [{"id": "oig-1", "userName": "ora@iga.example", "active": True,
                   "name": {"formatted": "Ora User"}, "emails": [{"value": "ora@iga.example"}],
                   "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {"department": "IT"},
                   "roles": [{"value": "DBA"}]}],
    "jumpcloud": [{"_id": "jc-1", "email": "jc@iga.example", "firstname": "Jay", "lastname": "Cloud",
                   "department": "Ops", "suspended": False, "groups": [{"name": "Admins"}]}],
    "cyberark": [{"id": "ca-1", "userName": "root", "address": "core-bank-db", "platformId": "UnixSSH"}],
}
VENDOR_TID = None


def run():
    db = get_tenant_session_factory("complyverse")()
    db.commit = db.flush
    R = []
    def ok(n, c): R.append((n, bool(c)))
    try:
        tid = (db.query(Role.tenant_id).filter(Role.tenant_id.isnot(None)).first() or [1])[0]
        # ---- pure mapping per adapter ----
        sav = IGA.VENDORS["saviynt"]["map"](SAMPLES["saviynt"][0])
        ok("saviynt email", sav and sav["email"] == "sav@iga.example")
        ok("saviynt 2 entitlements", sav and sav["entitlements"] == ["AP_Clerk", "Administrator"])
        oig = IGA.VENDORS["oracle_ig"]["map"](SAMPLES["oracle_ig"][0])
        ok("oracle SCIM email", oig and oig["email"] == "ora@iga.example")
        ok("oracle dept from enterprise ext", oig and oig["department"] == "IT")
        ok("oracle role -> entitlement", oig and oig["entitlements"] == ["DBA"])
        jc = IGA.VENDORS["jumpcloud"]["map"](SAMPLES["jumpcloud"][0])
        ok("jumpcloud active", jc and jc["account_enabled"] is True)
        ca = IGA.VENDORS["cyberark"]["map"](SAMPLES["cyberark"][0])
        ok("cyberark account -> privileged ent", ca and ca["entitlements"] == ["Privileged: core-bank-db"])
        ok("cyberark synthetic email", ca and ca["email"].endswith(".pam"))
        ok("vendor_list has 9", len(IGA.vendor_list()) == 9)

        # ---- full sync via one adapter (saviynt), rolled back ----
        IGA.fetch_identities = lambda vk, base, creds, **k: list(SAMPLES["saviynt"])
        res = IGA.sync_iga_population(db, tenant_id=tid, vendor_key="saviynt",
                                      base_url="https://x", credentials={"username": "u", "password": "p"})
        ok("saviynt sync created 1", res.get("created") == 1)
        ok("saviynt sync 2 entitlements linked", res.get("entitlements_linked") == 2)
        u = db.query(GRCUser).filter(GRCUser.email == "sav@iga.example").first()
        ok("user persisted, provider iga:saviynt", u and u.external_provider == "iga:saviynt")
        n_roles = db.query(UserRole).filter(UserRole.user_id == u.id,
                                            UserRole.source == "iga:saviynt").count()
        ok("2 sourced roles", n_roles == 2)

        # ---- missing-credential validation ----
        try:
            IGA.sync_iga_population(db, tenant_id=tid, vendor_key="saviynt",
                                    base_url="https://x", credentials={"username": "u"})
            ok("missing password rejected", False)
        except ValueError:
            ok("missing password rejected", True)
    finally:
        db.rollback(); db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print("\n  RESULT:", ("ALL %d IGA CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    run()
