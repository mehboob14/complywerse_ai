"""Verify the Tier-3 business-app adapters WITHOUT any real system.
Run:  python test_apps_mapping.py
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401
from grc.db import get_tenant_session_factory
from grc.models import GRCUser, Role, UserRole
from grc.modules.access_review import apps as APPS

SAMPLES = {
    "core_banking": [{"id": "cb-1", "email": "teller@bank.example", "fullName": "Terry Teller",
                      "department": "Branch", "status": "active",
                      "roles": [{"name": "Payments"}, {"name": "Teller"}]}],
    "salesforce": [{"Id": "005x1", "Email": "rep@sf.example", "Name": "Rep One", "IsActive": True,
                    "Department": "Sales", "Profile": {"Name": "System Administrator"}}],
    "servicenow": [{"sys_id": "sn1", "email": "ops@snow.example", "name": "Ops One",
                    "active": "true", "department": "IT", "roles": [{"name": "admin"}]}],
    "database": [{"rolname": "app_writer", "rolsuper": False, "rolcanlogin": True,
                  "memberof": ["readwrite"], "_host": "core-db"},
                 {"rolname": "dba1", "rolsuper": True, "rolcanlogin": True, "memberof": [], "_host": "core-db"}],
}


def run():
    db = get_tenant_session_factory("complyverse")()
    db.commit = db.flush
    R = []
    def ok(n, c): R.append((n, bool(c)))
    try:
        tid = (db.query(Role.tenant_id).filter(Role.tenant_id.isnot(None)).first() or [1])[0]
        # ---- pure mapping ----
        cb = APPS.APPS["core_banking"]["map"](SAMPLES["core_banking"][0])
        ok("core banking email", cb and cb["email"] == "teller@bank.example")
        ok("core banking 2 roles", cb and cb["entitlements"] == ["Payments", "Teller"])
        sf = APPS.APPS["salesforce"]["map"](SAMPLES["salesforce"][0])
        ok("salesforce profile -> entitlement", sf and sf["entitlements"] == ["System Administrator"])
        sn = APPS.APPS["servicenow"]["map"](SAMPLES["servicenow"][0])
        ok("servicenow active + role", sn and sn["account_enabled"] and sn["entitlements"] == ["admin"])
        dba = APPS.APPS["database"]["map"](SAMPLES["database"][1])
        ok("db superuser -> 'DB Superuser'", dba and "DB Superuser" in dba["entitlements"])
        ok("app_list has 6", len(APPS.app_list()) == 6)

        # ---- full sync via the database adapter (patched fetch), rolled back ----
        APPS.fetch_app_records = lambda app_key, base, creds, **k: list(SAMPLES["database"])
        res = APPS.sync_app_population(db, tenant_id=tid, app_key="database",
                                       base_url="", credentials={"db_type": "postgresql", "host": "core-db",
                                       "port": "5432", "database": "core", "username": "u", "password": "p"})
        ok("db sync created 2", res.get("created") == 2)
        u = db.query(GRCUser).filter(GRCUser.email == "dba1@core-db.db").first()
        ok("db account persisted, provider app:database", u and u.external_provider == "app:database")
        ok("dba1 has DB Superuser role", u and db.query(UserRole).join(Role, Role.id == UserRole.role_id)
           .filter(UserRole.user_id == u.id, Role.name == "DB Superuser").count() == 1)

        # ---- missing-cred validation ----
        try:
            APPS.sync_app_population(db, tenant_id=tid, app_key="servicenow",
                                     base_url="https://x", credentials={"username": "u"})
            ok("servicenow missing password rejected", False)
        except ValueError:
            ok("servicenow missing password rejected", True)
    finally:
        db.rollback(); db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print("\n  RESULT:", ("ALL %d APP CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    run()
