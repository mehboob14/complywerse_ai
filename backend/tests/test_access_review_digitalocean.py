"""DigitalOcean as an access-review source.

Its keys, tokens and database users become population rows — accounts, not
people, so they stay out of the app's owner pickers while still being
reviewed; a token that can't read a resource skips it instead of failing the
sync; a campaign can be scoped to this one source; and the cloud rules fire on
an unscoped credential, an old key and a leaver's key.
"""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.access_review import digitalocean as do
from grc.modules.access_review import rule_catalog as rules
from grc.modules.access_review import sampling
from grc.modules.access_review._ingest import ROLE_NAME_MAX

ACCOUNT = {"uuid": "acc-uuid-1", "email": "Ops@bank.example", "name": "Ops Team",
           "status": "active", "team": {"name": "CFSB Prod", "uuid": "team-1"}}


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.commit()
        yield session


def _item(email, roles, *, enabled=True, department="IT"):
    return SimpleNamespace(email=email, roles_snapshot=roles, account_enabled=enabled,
                           department=department, user_id=1, is_privileged=False,
                           termination_date=None, last_sign_in=None, mfa_enabled=None)


# ── Mapping ──────────────────────────────────────────────────────────────────

def test_the_token_owner_is_a_person_and_everything_else_is_an_account():
    acct = do.map_account(ACCOUNT)
    assert acct["is_person"] is True and acct["email"] == "ops@bank.example"
    assert acct["entitlements"] == ["DigitalOcean: team CFSB Prod"]

    slug = do.account_slug(ACCOUNT)
    key = do.map_ssh_key({"id": 77, "name": "Aziz laptop", "fingerprint": "aa:bb"}, acct=slug)
    assert key["is_person"] is False and key["email"].endswith("@ssh.cfsb-prod.do")
    assert key["entitlements"] == ["DigitalOcean: SSH root access to droplets"]
    # two keys with one name are two grants, so they must not collapse into one row
    twin = do.map_ssh_key({"id": 78, "name": "Aziz laptop"}, acct=slug)
    assert twin["email"] != key["email"] and twin["external_id"] != key["external_id"]


def test_an_unscoped_spaces_key_reads_as_full_access_and_an_old_one_says_so():
    slug = do.account_slug(ACCOUNT)
    old = datetime.utcnow() - timedelta(days=200)
    wide = do.map_spaces_key({"access_key": "DO00AAA", "name": "backups",
                              "grants": [{"bucket": "", "permission": "fullaccess"}],
                              "created_at": old.isoformat() + "Z"}, acct=slug)
    assert "DigitalOcean: Spaces full access (all buckets)" in wide["entitlements"]
    assert do.OLD_KEY_ENTITLEMENT in wide["entitlements"]

    fresh = do.map_spaces_key({"access_key": "DO00BBB", "name": "reports",
                               "grants": [{"bucket": "invoices", "permission": "read"}],
                               "created_at": datetime.utcnow().isoformat() + "Z"}, acct=slug)
    assert fresh["entitlements"] == ["DigitalOcean: Spaces read on invoices"]


def test_a_database_admin_reads_as_privileged_and_a_token_scope_says_read_or_write():
    slug = do.account_slug(ACCOUNT)
    admin = do.map_database_user({"name": "doadmin", "role": "primary"},
                                 cluster={"id": "c-1", "name": "prod-pg"}, acct=slug)
    # the wording has to trip the privileged-role heuristic, or a DB admin
    # would never be sampled by a privileged-access review
    assert sampling._is_privileged_role_name(admin["entitlements"][0])

    writes = do.map_api_token({"id": 3, "name": "ci", "scopes": ["droplet:read", "droplet:create"]}, acct=slug)
    reads = do.map_api_token({"id": 4, "name": "audit", "scopes": ["account:read"]}, acct=slug)
    assert "read-write (account admin)" in writes["entitlements"][0]
    assert "read-only" in reads["entitlements"][0]


def test_an_entitlement_never_outgrows_the_column_it_is_stored_in():
    long_bucket = "b" * 300
    rec = do.map_spaces_key({"access_key": "DO00CCC", "name": "x",
                             "grants": [{"bucket": long_bucket, "permission": "read"}]},
                            acct="acct")
    assert all(len(e) <= ROLE_NAME_MAX for e in rec["entitlements"])
    assert len(do.PROVIDER_DO) <= m.UserRole.__table__.c.source.type.length


def test_a_resource_the_token_cannot_read_is_skipped_not_fatal(monkeypatch):
    calls = {}

    def fake_get(token, path, params=None):
        calls[path] = calls.get(path, 0) + 1
        if path == "/account":
            return {"account": ACCOUNT}, None
        if path == "/account/keys":
            return {"ssh_keys": [{"id": 1, "name": "deploy"}]}, None
        if path == "/databases":
            return None, "the token has no access to it (403)"
        return {}, None

    monkeypatch.setattr(do, "_get", fake_get)
    out = do.collect("token")
    assert out["read"]["ssh_keys"] == 1
    assert {"resource": "databases", "reason": "the token has no access to it (403)"} in out["skipped"]
    assert [r for r in out["records"] if r["designation"] == "SSH key"]
    assert out["scope_note"].startswith("DigitalOcean publishes no team-member endpoint")


def test_the_sync_also_reports_the_estate_the_credentials_reach(monkeypatch):
    """A key or database user means little without the machines, disks and
    clusters behind it."""
    api = {
        "/account": {"account": ACCOUNT},
        "/droplets": {"droplets": [{"id": 5, "name": "cfsb-prod", "status": "active", "size_slug": "s-2vcpu-4gb",
                                    "region": {"slug": "fra1"},
                                    "networks": {"v4": [{"type": "private", "ip_address": "10.0.0.2"},
                                                        {"type": "public", "ip_address": "137.184.137.106"}]}}]},
        "/volumes": {"volumes": [{"id": "v1", "name": "backups", "size_gigabytes": 100,
                                  "region": {"slug": "fra1"}, "droplet_ids": [5]}]},
        "/databases": {"databases": [{"id": "c1", "name": "cfsb-pg", "engine": "pg", "num_nodes": 1}]},
        "/databases/c1/users": {"users": [{"name": "doadmin", "role": "primary"}]},
    }
    monkeypatch.setattr(do, "_get", lambda token, path, params=None:
                        (api[path], None) if path in api else (None, "the token has no access to it (403)"))
    out = do.collect("token")
    estate = out["estate"]
    assert estate["droplets"] == [{"name": "cfsb-prod", "id": 5, "status": "active", "region": "fra1",
                                   "size": "s-2vcpu-4gb", "ip": "137.184.137.106", "created_at": None}]
    assert estate["volumes"][0]["size_gb"] == 100 and estate["volumes"][0]["attached_to"] == [5]
    assert estate["databases"][0]["engine"] == "pg"
    # the database user says which cluster it reaches
    db_user = next(r for r in out["records"] if r["designation"] == "Managed database user")
    assert "Reaches database: cfsb-pg (PG)" in db_user["entitlements"]


def test_a_refused_token_fails_the_sync_rather_than_reporting_an_empty_estate(monkeypatch):
    monkeypatch.setattr(do, "_get", lambda *a, **k: (None, "the token was refused (401)"))
    with pytest.raises(ValueError, match="refused"):
        do.collect("bad-token")


# ── Population ───────────────────────────────────────────────────────────────

def test_synced_accounts_join_the_population_but_not_the_people_pickers(db, monkeypatch):
    monkeypatch.setattr(do, "collect", lambda token: {
        "records": [do.map_account(ACCOUNT),
                    do.map_ssh_key({"id": 9, "name": "deploy"}, acct="cfsb-prod")],
        "read": {}, "skipped": [], "team": "CFSB Prod", "account_email": "ops@bank.example",
        "scope_note": "note"})
    result = do.sync_digitalocean_population(db, tenant_id=1, token="t")
    assert result["created"] == 2 and result["source"] == "request"

    person = db.query(m.GRCUser).filter(m.GRCUser.email == "ops@bank.example").one()
    key = db.query(m.GRCUser).filter(m.GRCUser.email.like("%@ssh.%")).one()
    assert person.is_active is True                       # a real human stays assignable
    assert key.is_active is False                         # a key never appears in a picker
    assert key.account_enabled is True                    # but it is live in DigitalOcean

    population = sampling.build_population(db, 1, "user_access", source=do.PROVIDER_DO)
    assert {u.email for u in population} == {person.email, key.email}


def test_a_privileged_pam_account_is_also_kept_out_of_the_people_pickers(db, monkeypatch):
    """The IGA connector used to upsert with its own copy of the shared code,
    which is why CyberArk accounts were assignable. It goes through ingest now."""
    from grc.modules.access_review import iga

    monkeypatch.setattr(iga, "fetch_identities", lambda *a, **k: [
        {"id": "7", "userName": "svc-backup", "address": "prod-db"}])
    result = iga.sync_iga_population(db, tenant_id=1, vendor_key="cyberark",
                                     base_url="https://vault.example",
                                     credentials={"username": "u", "password": "p"})
    account = db.query(m.GRCUser).filter(m.GRCUser.email.like("%.pam")).one()
    assert result["created"] == 1 and account.is_active is False
    assert account.account_enabled is True


def test_a_connected_source_shows_what_it_pulled_and_who_holds_what(db, monkeypatch):
    """A card that only says "Connected" tells nobody whether the sync worked;
    the source reports its people, its grants and what each identity holds."""
    from grc.routers import access_review_router as router

    monkeypatch.setattr(do, "collect", lambda token: {
        "records": [do.map_account(ACCOUNT),
                    do.map_ssh_key({"id": 9, "name": "deploy"}, acct="cfsb-prod")],
        "read": {}, "skipped": [], "team": "CFSB Prod", "account_email": "ops@bank.example",
        "scope_note": "note"})
    do.sync_digitalocean_population(db, tenant_id=1, token="t", remember=False)

    stats = {s["key"]: s for s in router._source_options(db)}
    assert stats[do.PROVIDER_DO]["label"] == "DigitalOcean"
    assert stats[do.PROVIDER_DO]["people"] == 2 and stats[do.PROVIDER_DO]["entitlements"] == 2
    assert stats[do.PROVIDER_DO]["last_synced"]

    # what the drawer lists: each identity and the access this source gave it
    ids = router._source_user_ids(db, do.PROVIDER_DO)
    held = {u.email: [a["name"] for a in router._access_for_user(db, u.id)]
            for u in db.query(m.GRCUser).filter(m.GRCUser.id.in_(ids))}
    key = next(e for e in held if e.endswith("@ssh.cfsb-prod.do"))
    assert held[key] == ["DigitalOcean: SSH root access to droplets"]
    assert held["ops@bank.example"] == ["DigitalOcean: team CFSB Prod"]


def test_a_campaign_scoped_to_one_source_leaves_the_rest_of_the_directory_alone(db):
    staff = m.GRCUser(id=50, username="dana", email="dana@bank.example", is_active=True)
    cloud = m.GRCUser(id=51, username="k", email="k@ssh.acct.do", is_active=False,
                      external_provider=do.PROVIDER_DO)
    db.add_all([staff, cloud])
    db.commit()
    everyone = sampling.build_population(db, 1, "user_access")
    only_do = sampling.build_population(db, 1, "user_access", source=do.PROVIDER_DO)
    assert {u.id for u in everyone} == {50, 51} and {u.id for u in only_do} == {51}

    # a person another source imported still counts as in-source once this
    # source grants them something
    assert sampling.filter_by_source([staff, cloud], do.PROVIDER_DO, {50}) == [staff, cloud]


# ── Rules ────────────────────────────────────────────────────────────────────

def test_the_cloud_rules_fire_on_unscoped_old_and_orphaned_credentials():
    ctx = {"now": datetime.utcnow(), "terminated_locals": {"dana"}}
    wide = _item("backups@spaces.acct.do", ["DigitalOcean: Spaces full access (all buckets)"])
    old = _item("ci@token.acct.do", ["DigitalOcean: API token read-only", do.OLD_KEY_ENTITLEMENT])
    leaver = _item("dana-laptop-9@ssh.acct.do", ["DigitalOcean: SSH root access to droplets"])
    tidy = _item("app@prod-pg.db.acct.do", ["DigitalOcean: database normal on prod-pg"])

    assert rules._chk_cloud_wildcard(wide, ctx)[0]["severity"] == "critical"
    assert rules._chk_cloud_key_age(old, ctx)[0]["finding_type"] == "cloud_stale_key"
    assert rules._chk_cloud_orphan(leaver, ctx)[0]["finding_type"] == "cloud_orphan"
    assert not any(check(tidy, ctx) for check in
                   (rules._chk_cloud_wildcard, rules._chk_cloud_key_age, rules._chk_cloud_orphan))
    # a person is not a cloud credential
    assert not rules._chk_cloud_wildcard(_item("dana@bank.example", ["Administrator"]), ctx)


def test_a_key_is_not_reported_as_a_dormant_account():
    ctx = {"now": datetime.utcnow()}
    key = _item("deploy@ssh.acct.do", ["DigitalOcean: SSH root access to droplets"])
    person = _item("dana@bank.example", ["Staff"])
    assert rules._chk_stale(key, ctx) == []                # no sign-in by nature
    assert rules._chk_stale(person, ctx)[0]["finding_type"] == "stale_account"


def test_only_the_cloud_rules_the_data_supports_are_runnable():
    by_id = {r["id"]: r for r in rules.RULE_CATALOG}
    assert [r for r in ("CLD-02", "CLD-03", "CLD-05") if by_id[r]["check"] is None] == []
    # no MFA flag and no bucket ACLs in the v2 API — honest about what can't run
    assert by_id["CLD-01"]["check"] is None and by_id["CLD-04"]["check"] is None
    assert by_id["CLD-01"]["status"] == rules.NEEDS_CONNECTOR


def test_a_connected_tool_becomes_a_review_source_without_a_connector_of_its_own(db):
    """The people of 30-odd SaaS tools come from the credential already stored
    for them, mapped by a table entry rather than a module each."""
    from grc.modules.access_review import collectors

    slack = collectors.PEOPLE["slack"]
    person = collectors.map_person(
        {"name": "dana", "real_name": "Dana Ali", "email": "dana@bank.example", "is_admin": True}, slack, "slack")
    assert person["entitlements"] == ["Slack: workspace admin"] and person["is_person"] is True
    assert person["external_id"] == "slack:dana"
    assert collectors.map_person({"email": "bot@x.example", "is_bot": True}, slack, "slack") is None
    # a handle-only tool still yields an addressable identity
    handle = collectors.map_person({"login": "octocat", "id": 7}, collectors.PEOPLE["github"], "github")
    assert handle["email"] == "octocat@github.account"
    # a disabled account is still reviewed, marked as off in the source
    off = collectors.map_person({"email": "x@bank.example", "deleted": True}, slack, "slack")
    assert off["account_enabled"] is False

    listed = {c["key"]: c for c in collectors.available(db, 1)}
    assert len(listed) >= 30 and listed["slack"]["connected"] is False
    for provider, spec in collectors.PEOPLE.items():
        assert len(provider) <= m.UserRole.__table__.c.source.type.length, provider
        assert spec.resource and spec.label
    with pytest.raises(ValueError, match="not connected"):
        collectors.sync_collector_population(db, tenant_id=1, provider="slack")


def test_a_rule_names_the_frameworks_the_tenant_actually_holds(db):
    """A rule states the SCF controls it evidences; the tenant's own crosswalk
    turns those into their frameworks — no per-framework rule list."""
    db.add_all([
        m.SCFSource(release_id=1, source_key="k1", source_slug="aicpa_tsc_soc2",
                    display_name="AICPA TSC 2017:2022 (used for SOC 2)"),
        m.SCFSource(release_id=1, source_key="k2", source_slug="emea_saudi_arabia_ecc_1_2018",
                    display_name="EMEA Saudi Arabia ECC-1 2018"),
        m.SCFMapping(release_id=1, scf_id="IAC-06", source_slug="aicpa_tsc_soc2", requirement_code="CC6.6"),
        m.SCFMapping(release_id=1, scf_id="IAC-06", source_slug="emea_saudi_arabia_ecc_1_2018",
                     requirement_code="2-2-3-2"),
    ])
    db.commit()

    mfa = rules.CATALOG_BY_ID["AUTH-01"]
    assert mfa["scf"] == ("IAC-06",)
    refs = rules.framework_refs(db, list(mfa["scf"]))
    assert [(f["name"], f["codes"]) for f in refs["frameworks"]] == [
        ("AICPA TSC 2017:2022 (used for SOC 2)", ["CC6.6"]),
        ("EMEA Saudi Arabia ECC-1 2018", ["2-2-3-2"]),
    ]
    # a rule with no mapping says so rather than inventing coverage
    assert rules.framework_refs(db, [])["frameworks"] == []
    assert any(r["id"] == "AUTH-01" and r["frameworks"]
               for r in rules.enabled_rules(db, 1, with_frameworks=True))


def test_the_stored_connection_supplies_the_token_so_a_resync_needs_no_paste(db, monkeypatch):
    assert do.token_for_tenant(db, 1) is None
    db.add(m.IntegrationConnection(tenant_id=1, connection_name="DigitalOcean",
                                   integration_type="digitalocean", console_url=do.API,
                                   credentials_extra_json={"token": "enc"}))
    db.commit()
    monkeypatch.setattr("grc.modules.compliance_plugins.services.credentials.resolve_credentials_for_connection",
                        lambda conn: {"token": "dop_v1_stored"})
    assert do.token_for_tenant(db, 1) == "dop_v1_stored"
    with pytest.raises(ValueError, match="No DigitalOcean token"):
        do.sync_digitalocean_population(Session(db.get_bind()), tenant_id=99, token=None)
