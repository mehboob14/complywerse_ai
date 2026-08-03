"""Verify the on-prem AD/LDAP -> grc_users mapping WITHOUT a real directory.
Run:  python test_ldap_mapping.py

`fetch_ldap_users` is patched out, so no ldap3 server is contacted; we feed
representative Active Directory entry dicts (as ldap3 returns them — values in
lists) and assert the upsert + field mapping.
"""
from dotenv import load_dotenv; load_dotenv()
import main  # noqa: F401
from datetime import datetime
from grc.db import get_tenant_session_factory
from grc.models import GRCUser
from grc.modules.access_review import ldap_ad as L

# Windows FILETIME for ~2026-06-12 (100-ns ticks since 1601). Computed from the
# module's own converter so the test stays consistent with production logic.
_FT = int((datetime(2026, 6, 12, 7, 30, 0) - L._FILETIME_EPOCH).total_seconds() * 10_000_000)

AD_ENTRIES = [
    {  # normal enabled AD user
        "distinguishedName": "CN=Alice Admin,OU=IT,DC=acme,DC=local",
        "objectGUID": ["{11111111-1111-1111-1111-111111111111}"],
        "mail": ["alice@acme.local"], "displayName": ["Alice Admin"],
        "department": ["IT"], "title": ["Administrator"],
        "userAccountControl": [512], "lastLogonTimestamp": [str(_FT)],
    },
    {  # disabled account (UAC 514 = NORMAL|ACCOUNTDISABLE)
        "distinguishedName": "CN=Bob Gone,OU=Sales,DC=acme,DC=local",
        "objectGUID": ["{22222222-2222-2222-2222-222222222222}"],
        "userPrincipalName": ["bob@acme.local"], "cn": ["Bob Gone"],
        "department": ["Sales"], "userAccountControl": [514],
    },
    {  # no email -> must be skipped
        "distinguishedName": "CN=Service Acct,OU=Svc,DC=acme,DC=local",
        "objectGUID": ["{33333333-3333-3333-3333-333333333333}"],
        "sAMAccountName": ["svc-backup"], "userAccountControl": [512],
    },
]


def run():
    db = get_tenant_session_factory("complyverse")()
    L.fetch_ldap_users = lambda *a, **k: list(AD_ENTRIES)
    db.commit = db.flush  # keep everything in-transaction; roll back at the end
    R = []
    def ok(n, c): R.append((n, bool(c)))
    try:
        # ---- pure mapping checks (no DB) ----
        a = L.map_entry(AD_ENTRIES[0])
        ok("alice email mapped", a and a["email"] == "alice@acme.local")
        ok("alice name", a and a["display_name"] == "Alice Admin")
        ok("alice department", a and a["department"] == "IT")
        ok("alice title -> designation", a and a["designation"] == "Administrator")
        ok("alice enabled (uac 512)", a and a["account_enabled"] is True)
        ok("alice last sign-in from FILETIME", a and a["entra_last_sign_in"] is not None
           and a["entra_last_sign_in"].year == 2026)
        ok("alice external_id from GUID", a and a["external_id"].startswith("{11111111"))

        b = L.map_entry(AD_ENTRIES[1])
        ok("bob email from UPN", b and b["email"] == "bob@acme.local")
        ok("bob disabled (uac 514)", b and b["account_enabled"] is False)

        ok("no-email entry skipped", L.map_entry(AD_ENTRIES[2]) is None)

        # ---- full sync upsert (rolled back) ----
        res = L.sync_ldap_population(
            db, server="dc01.acme.local", base_dn="DC=acme,DC=local",
            bind_dn="CN=svc,DC=acme,DC=local", bind_password="x",
        )
        ok("created 2 (3rd skipped)", res.get("created") == 2 and res.get("skipped") == 1)

        def u(e): return db.query(GRCUser).filter(GRCUser.email == e).first()
        au, bu = u("alice@acme.local"), u("bob@acme.local")
        ok("alice persisted", au is not None)
        ok("alice provider=ldap", au and au.external_provider == "ldap")
        ok("alice account_enabled True", au and au.account_enabled is True)
        ok("bob account_enabled False", bu and bu.account_enabled is False)
    finally:
        db.rollback()
        db.close()
    print()
    for n, p in R:
        print(("  [PASS] " if p else "  [FAIL] ") + n)
    print("\n  RESULT:", ("ALL %d LDAP MAPPING CHECKS PASS" % len(R)) if all(p for _, p in R) else "SOME FAILED")


if __name__ == "__main__":
    run()
