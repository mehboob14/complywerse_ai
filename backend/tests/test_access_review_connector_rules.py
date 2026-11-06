"""A review tests the connector's estate, not just the people it lists.

DigitalOcean's rules read the firewalls in front of the droplets, who may reach each
database, and the keys and tokens that open the account. Each rule reports one
verdict: pass, fail, not_applicable (nothing in scope) or not_run (could not look) —
a rule over nothing is never a pass. The identity rules judge only the identities
they can: MFA is a fact about a person, not about a storage key.
"""
import dataclasses
import importlib
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import dsa, ec, ed25519, rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.db import get_tenant_db
from grc.modules.access_review import connector_rules as cr
from grc.modules.access_review import digitalocean_rules as do_rules
from grc.modules.access_review import rule_catalog as rules

ar = importlib.import_module("grc.routers.access_review_router")
ECC, SOC2 = "emea_saudi_arabia_ecc_1_2018", "aicpa_tsc_soc2"


def openssh(key) -> str:
    return key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()


# ---- pure helpers ----------------------------------------------------------

def test_a_key_is_judged_by_what_it_is_not_by_its_name():
    assert do_rules.ssh_key_strength(openssh(ed25519.Ed25519PrivateKey.generate())) == ("ed25519", 256)
    assert do_rules.ssh_key_strength(openssh(ec.generate_private_key(ec.SECP256R1()))) == ("ecdsa", 256)
    assert do_rules.ssh_key_strength(openssh(rsa.generate_private_key(65537, 2048))) == ("rsa", 2048)
    assert do_rules.ssh_key_strength(openssh(rsa.generate_private_key(65537, 1024)))[1] == 1024
    assert do_rules.ssh_key_strength(openssh(dsa.generate_private_key(1024)))[0] == "dsa"
    assert do_rules.ssh_key_strength("not a key") == ("unknown", None)

    assert do_rules.key_is_strong("ed25519", 256) and do_rules.key_is_strong("rsa", 2048)
    assert do_rules.key_is_strong("rsa", 1024) is False and do_rules.key_is_strong("dsa", 1024) is False
    assert do_rules.key_is_strong("unknown", None) is None          # never guess a key weak


def test_firewall_ports_and_sources_are_read_the_way_digitalocean_writes_them():
    for ports, port, hit in (("22", 22, True), ("22", 80, False), ("20-30", 22, True), ("80,443", 443, True),
                             ("80,443", 22, False), ("0", 22, True), ("", 22, True), ("all", 5432, True),
                             ("1-65535", 3306, True)):
        assert do_rules.ports_cover(ports, port) is hit, (ports, port)
    world = {"protocol": "tcp", "ports": "22", "sources": {"addresses": ["0.0.0.0/0", "::/0"]}}
    office = {"protocol": "tcp", "ports": "22", "sources": {"addresses": ["203.0.113.0/24"]}}
    tagged = {"protocol": "tcp", "ports": "22", "sources": {"tags": ["bastion"]}}
    icmp = {"protocol": "icmp", "sources": {"addresses": ["0.0.0.0/0"]}}
    assert do_rules.world_reaches([world], 22) and not do_rules.world_reaches([office, tagged, icmp], 22)
    assert do_rules.any_to_any({"protocol": "tcp", "ports": "0", "sources": {"addresses": ["0.0.0.0/0"]}})
    assert not do_rules.any_to_any(world)


def _droplet(i, name, tags=(), public=True):
    nets = [{"type": "public", "ip_address": f"203.0.113.{i}"}] if public else [{"type": "private", "ip_address": "10.0.0.1"}]
    return {"id": i, "name": name, "status": "active", "tags": list(tags), "networks": {"v4": nets},
            "region": {"slug": "nyc1"}}


def _firewall(name, inbound, droplet_ids=(), tags=()):
    return {"id": f"fw-{name}", "name": name, "status": "succeeded", "inbound_rules": inbound,
            "droplet_ids": list(droplet_ids), "tags": list(tags)}


SSH_WORLD = {"protocol": "tcp", "ports": "22", "sources": {"addresses": ["0.0.0.0/0"]}}
SSH_OFFICE = {"protocol": "tcp", "ports": "22", "sources": {"addresses": ["203.0.113.0/24"]}}
PG_WORLD = {"protocol": "tcp", "ports": "5432", "sources": {"addresses": ["0.0.0.0/0"]}}


def test_a_droplet_is_exposed_unless_a_cloud_firewall_covers_it():
    firewalls = do_rules.firewall_rows([
        _firewall("by-id", [SSH_OFFICE], droplet_ids=[1]),
        _firewall("by-tag", [SSH_WORLD, PG_WORLD], tags=["web"]),
    ])
    rows = {r["name"]: r for r in do_rules.droplet_rows(
        [_droplet(1, "locked-down"), _droplet(2, "web-1", tags=["web"]), _droplet(3, "bare"),
         _droplet(4, "private-only", public=False)], firewalls)}

    assert rows["locked-down"]["firewalled"] and not rows["locked-down"]["ssh_open_world"]
    assert rows["web-1"]["firewalled"] and rows["web-1"]["ssh_open_world"]          # a tag brings the world-open rule
    assert rows["web-1"]["db_ports_open_world"] and "5432" in rows["web-1"]["exposed_db_ports"]
    assert not rows["bare"]["firewalled"] and rows["bare"]["ssh_open_world"]          # no firewall: reachable from anywhere
    assert not rows["private-only"]["public_ipv4"] and not rows["private-only"]["ssh_open_world"]

    # two firewalls on one droplet are a union: the open rule wins over the strict one
    both = do_rules.droplet_rows([_droplet(1, "both")], do_rules.firewall_rows([
        _firewall("strict", [SSH_OFFICE], droplet_ids=[1]), _firewall("loose", [SSH_WORLD], droplet_ids=[1])]))
    assert both[0]["ssh_open_world"] and sorted(both[0]["firewalls"]) == ["loose", "strict"]


# ---- the rules over an estate ----------------------------------------------

def snapshot(**resources):
    base = {name: cr.Resource() for name in ("account", "ssh_keys", "spaces_keys", "api_tokens", "firewalls",
                                             "droplets", "databases", "database_users")}
    base["account"] = cr.Resource(rows=[do_rules.account_row(
        {"email": "owner@bank.example", "status": "active", "email_verified": True, "team": {"name": "Bank"}})])
    base.update(resources)
    return base


def verdicts(snap):
    return {r.id: cr.evaluate(r, snap) for r in do_rules.RULES}


def test_the_account_we_test_with_has_three_open_droplets_and_nothing_else():
    """3 public droplets, no cloud firewalls, no keys, no databases, and a token that cannot list API tokens."""
    snap = snapshot(
        droplets=cr.Resource(rows=do_rules.droplet_rows([_droplet(1, "a"), _droplet(2, "b"), _droplet(3, "c")], [])),
        firewalls=cr.Resource(rows=[]),
        api_tokens=cr.Resource(error="The token cannot read API tokens: the token has no access to it (403)"),
        databases=cr.Resource(rows=[]), database_users=cr.Resource(rows=[]))
    v = verdicts(snap)

    assert v["DO-NET-01"]["status"] == "fail" and v["DO-NET-01"]["failed"] == 3 and v["DO-NET-01"]["tested"] == 3
    assert [f["resource"] for f in v["DO-NET-01"]["failures"]] == ["a", "b", "c"]
    assert "no cloud firewall covers it" in v["DO-NET-01"]["failures"][0]["detail"]
    assert v["DO-NET-02"]["status"] == "fail"
    assert v["DO-NET-03"]["status"] == "not_applicable"             # no firewall rules to read
    assert v["DO-NET-04"]["status"] == "not_applicable"
    for rule_id in ("DO-DBS-01", "DO-DBS-02", "DO-DBS-03", "DO-DBS-04", "DO-KEY-01", "DO-KEY-02", "DO-SPC-01", "DO-SPC-02"):
        assert v[rule_id]["status"] == "not_applicable", rule_id    # nothing exists to judge: not a pass
        assert v[rule_id]["passed"] == 0
    assert v["DO-TOK-01"]["status"] == "not_run" and "403" in v["DO-TOK-01"]["reason"]
    assert v["DO-ACC-01"]["status"] == "pass" and v["DO-ACC-02"]["status"] == "pass"


def test_a_well_run_estate_passes_and_a_badly_run_one_names_what_is_wrong():
    weak, good = rsa.generate_private_key(65537, 1024), ed25519.Ed25519PrivateKey.generate()
    firewalls = do_rules.firewall_rows([
        _firewall("web", [SSH_OFFICE, {"protocol": "tcp", "ports": "443", "sources": {"addresses": ["0.0.0.0/0"]}}], droplet_ids=[1]),
        _firewall("wide", [{"protocol": "tcp", "ports": "0", "sources": {"addresses": ["0.0.0.0/0"]}}], droplet_ids=[2])])
    clusters = [{"id": "c1", "name": "orders", "engine": "pg", "private_network_uuid": "vpc-1"},
                {"id": "c2", "name": "legacy", "engine": "mysql"}]
    trusted = {"c1": [{"type": "droplet", "value": "1"}], "c2": []}
    users = {"c1": [{"name": "doadmin", "role": "primary"}],
             "c2": [{"name": "doadmin", "role": "primary"}, {"name": "dba", "role": "primary",
                    "mysql_settings": {"auth_plugin": "mysql_native_password"}}]}
    snap = snapshot(
        droplets=cr.Resource(rows=do_rules.droplet_rows([_droplet(1, "web"), _droplet(2, "api")], firewalls)),
        firewalls=cr.Resource(rows=firewalls),
        ssh_keys=cr.Resource(rows=do_rules.ssh_key_rows([
            {"name": "alice-laptop", "fingerprint": "aa", "public_key": openssh(good)},
            {"name": "key", "fingerprint": "bb", "public_key": openssh(weak)}])),
        spaces_keys=cr.Resource(rows=do_rules.spaces_key_rows([
            {"name": "backups", "access_key": "DO00ABCDEFGH1234", "grants": [{"bucket": "backups", "permission": "readwrite"}],
             "created_at": "2099-01-01T00:00:00Z"},
            {"name": "ci", "access_key": "DO00ZZZZZZZZ9999", "grants": [], "created_at": "2020-01-01T00:00:00Z"}])),
        databases=cr.Resource(rows=do_rules.database_rows(clusters, trusted, users)),
        database_users=cr.Resource(rows=do_rules.database_user_rows(clusters, users)))
    v = verdicts(snap)

    assert v["DO-NET-01"]["status"] == "pass" and v["DO-NET-01"]["passed"] == 2
    assert v["DO-NET-02"]["status"] == "fail" and v["DO-NET-02"]["tested"] == 2   # api's firewall opens every port
    assert [f["resource"] for f in v["DO-NET-02"]["failures"]] == ["api"]         # web only allows the office
    assert v["DO-NET-04"]["status"] == "fail" and v["DO-NET-04"]["failures"][0]["resource"] == "wide"
    assert v["DO-DBS-01"]["status"] == "fail" and [f["resource"] for f in v["DO-DBS-01"]["failures"]] == ["legacy"]
    assert v["DO-DBS-02"]["status"] == "fail" and v["DO-DBS-02"]["failures"][0]["resource"] == "legacy"
    assert v["DO-DBS-03"]["status"] == "fail" and "2 admin users" in v["DO-DBS-03"]["failures"][0]["detail"]
    assert v["DO-DBS-04"]["status"] == "fail" and v["DO-DBS-04"]["tested"] == 1   # only the MySQL user with a plugin
    assert v["DO-KEY-01"]["status"] == "fail" and v["DO-KEY-01"]["failures"][0]["resource"] == "key"
    assert v["DO-KEY-02"]["status"] == "fail" and v["DO-KEY-02"]["failures"][0]["resource"] == "key"
    assert v["DO-SPC-01"]["status"] == "fail" and v["DO-SPC-01"]["failed"] == 1   # the unscoped CI key
    assert v["DO-SPC-02"]["status"] == "fail" and v["DO-SPC-02"]["failures"][0]["resource"].startswith("ci")


def test_a_resource_that_was_only_partly_read_says_so():
    snap = snapshot(droplets=cr.Resource(rows=do_rules.droplet_rows([_droplet(1, "a")], []),
                                         note="only the first 25 of 40 clusters were read"))
    assert "only the first 25" in cr.evaluate(do_rules.RULES[0], snap)["detail"]
    # a malformed rule is reported, never mistaken for a failing estate
    bad = dataclasses.replace(do_rules.RULES[0], assertion={"all": ["only-one-element"]})
    assert cr.evaluate(bad, snap)["status"] == "error"


# ---- running a connector ---------------------------------------------------

def test_a_connector_that_is_not_connected_or_cannot_be_read_is_not_run(monkeypatch):
    pack = cr.packs()["digitalocean"]
    monkeypatch.setitem(cr.PACKS, "digitalocean", dataclasses.replace(pack, token_for=lambda db, t: None))
    out = cr.run_connector(None, 1, "digitalocean")
    assert out["connected"] is False and {r["status"] for r in out["results"]} == {"not_run"}
    assert "not connected" in out["results"][0]["reason"]

    def boom(token):
        raise RuntimeError("down")
    monkeypatch.setitem(cr.PACKS, "digitalocean", dataclasses.replace(pack, token_for=lambda db, t: "tok", collect=boom))
    out = cr.run_connector(None, 1, "digitalocean", ["DO-NET-01", "DO-ACC-01"])
    assert [r["id"] for r in out["results"]] == ["DO-NET-01", "DO-ACC-01"]
    assert {r["status"] for r in out["results"]} == {"not_run"} and "could not be read" in out["results"][0]["reason"]


# ---- identities: judge only what a rule can judge --------------------------

def item(email, **kw):
    base = dict(id=1, user_id=1, email=email, roles_snapshot=[], access_snapshot=[], account_enabled=True,
                department="IT", is_privileged=False, termination_date=None, last_sign_in=None, mfa_enabled=None)
    return SimpleNamespace(**{**base, **kw})


def test_an_identity_is_a_person_a_key_or_a_database_account():
    assert rules.account_kind(item("a@bank.example")) == "person"
    assert rules.account_kind(item("ci-1@spaces.bank.do")) == "cloud_credential"
    assert rules.account_kind(item("app@orders.db.bank.do")) == "db_account"
    assert rules.account_kind(item("sa@host.db")) == "db_account"
    assert rules.account_kind(item("root@vault.pam")) == "service_account"


def test_a_rule_does_not_pass_an_identity_it_cannot_judge():
    mfa = rules.CATALOG_BY_ID["AUTH-01"]
    key = item("ci-1@spaces.bank.do", mfa_enabled=None)
    assert rules.applicability(mfa, key)[0] == "not_applicable"                       # MFA is a fact about people
    unknown = item("owner@bank.example", mfa_enabled=None)
    assert rules.applicability(mfa, unknown) == ("not_run", "The source does not report MFA status for this account.")
    assert rules.applicability(mfa, item("owner@bank.example", mfa_enabled=False)) is None
    # a source that never reports sign-ins cannot show that somebody has stopped signing in
    stale = rules.CATALOG_BY_ID["IDM-04"]
    do_owner = item("owner@bank.example", access_snapshot=[{"name": "DigitalOcean: team Bank", "source": "digitalocean"}])
    assert rules.applicability(stale, do_owner)[0] == "not_run"
    assert rules.applicability(stale, item("pat@bank.example", access_snapshot=[{"name": "x", "source": "okta"}])) is None
    # database rules judge database accounts, including DigitalOcean's
    assert rules.applicability(rules.CATALOG_BY_ID["DB-01"], item("app@orders.db.bank.do")) is None
    assert rules.applicability(rules.CATALOG_BY_ID["DB-01"], do_owner)[0] == "not_applicable"


def test_identity_results_count_what_was_judged_and_what_was_not():
    people = [item("a@bank.example", id=1, mfa_enabled=False), item("b@bank.example", id=2, mfa_enabled=True),
              item("c@bank.example", id=3, mfa_enabled=None), item("ci@spaces.bank.do", id=4)]
    finding = SimpleNamespace(rule_id="AUTH-01", severity="high", detail="no MFA")
    defs = [dict(rules.CATALOG_BY_ID["AUTH-01"], frameworks=[]), dict(rules.CATALOG_BY_ID["DB-01"], frameworks=[])]
    res = {r["id"]: r for r in rules.identity_rule_results(people, {1: [finding]}, defs)}

    assert res["AUTH-01"]["status"] == "fail" and (res["AUTH-01"]["tested"], res["AUTH-01"]["failed"], res["AUTH-01"]["passed"]) == (2, 1, 1)
    assert (res["AUTH-01"]["not_run"], res["AUTH-01"]["not_applicable"]) == (1, 1)
    assert res["DB-01"]["status"] == "not_applicable" and res["DB-01"]["tested"] == 0     # nobody here holds a database account

    per_item = {r["id"]: r["status"] for r in rules.item_rule_results(people[2], [], defs)}
    assert per_item == {"AUTH-01": "not_run", "DB-01": "not_applicable"}


# ---- the library, a review, and the report --------------------------------

@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.add_all([
            m.SCFSource(release_id=1, source_key="k1", source_slug=SOC2, display_name="AICPA TSC 2017:2022 (used for SOC 2)"),
            m.SCFSource(release_id=1, source_key="k2", source_slug=ECC, display_name="EMEA Saudi Arabia ECC-1 2018"),
            # network access answers ECC and SOC 2; key hygiene answers SOC 2 only
            m.SCFMapping(release_id=1, scf_id="NET-04", source_slug=ECC, requirement_code="2-5-1-1"),
            m.SCFMapping(release_id=1, scf_id="NET-04", source_slug=SOC2, requirement_code="CC6.6"),
            m.SCFMapping(release_id=1, scf_id="NET-03", source_slug=SOC2, requirement_code="CC6.6"),
            m.SCFMapping(release_id=1, scf_id="IAC-10", source_slug=SOC2, requirement_code="CC6.1"),
            m.SCFMapping(release_id=1, scf_id="IAC-06", source_slug=SOC2, requirement_code="CC6.1"),
            m.SCFMapping(release_id=1, scf_id="NET-04", source_slug=ECC, requirement_code="parent-only", match_mode="parent"),
        ])
        session.commit()
        yield session


ESTATE = snapshot(
    droplets=cr.Resource(rows=do_rules.droplet_rows([_droplet(1, "web"), _droplet(2, "api")], [])),
    firewalls=cr.Resource(rows=[]), api_tokens=cr.Resource(error="The token cannot read API tokens: forbidden (403)"),
    databases=cr.Resource(rows=[]), database_users=cr.Resource(rows=[]))


@pytest.fixture
def connected(monkeypatch):
    pack = cr.packs()["digitalocean"]
    monkeypatch.setitem(cr.PACKS, "digitalocean", dataclasses.replace(
        pack, token_for=lambda db, t: "tok", collect=lambda token: (ESTATE, {"droplets": 2})))


@pytest.fixture
def api(db, monkeypatch):
    monkeypatch.setattr(ar, "_require_admin", lambda *a, **k: SimpleNamespace(id=7))
    app = FastAPI()
    app.include_router(ar.router)
    app.dependency_overrides[get_tenant_db] = lambda: db
    return TestClient(app)


def test_the_library_lists_each_connectors_rules_and_whether_they_can_run(db, api, connected, monkeypatch):
    view = api.get("/access-reviews/rules/catalog?source=digitalocean").json()
    shown = [r for d in view["domains"] for r in d["rules"]]
    do_ids = {r["id"] for r in shown if r["kind"] == "connector"}
    assert do_ids == {r.id for r in do_rules.RULES}
    assert all(r["runnable"] and r["connector_label"] == "DigitalOcean" for r in shown if r["kind"] == "connector")
    # a review of one source lists what can run on it: not the rules that need SAP or a code platform
    assert {r["status"] for r in shown} == {"runnable"}
    assert not {"DEV-02", "ERP-01", "NET-01"} & {r["id"] for r in shown}
    assert {"CLD-02", "DB-01", "AUTH-01"} <= {r["id"] for r in shown}
    assert view["connectors"][0]["connected"] is True and "team-member" in view["connectors"][0]["limits"]

    # without a credential the same rules are listed, but cannot run
    pack = cr.packs()["digitalocean"]
    monkeypatch.setitem(cr.PACKS, "digitalocean", dataclasses.replace(pack, token_for=lambda db, t: None))
    off = [r for d in api.get("/access-reviews/rules/catalog").json()["domains"] for r in d["rules"] if r["kind"] == "connector"]
    assert off and not any(r["runnable"] for r in off) and {r["status"] for r in off} == {"needs_connector"}


def test_a_framework_picks_the_rules_that_evidence_it_with_its_own_clauses(db, api, connected):
    ecc = api.get(f"/access-reviews/rules/catalog?source=digitalocean&framework={ECC}").json()
    soc2 = api.get(f"/access-reviews/rules/catalog?source=digitalocean&framework={SOC2}").json()
    ecc_ids = {r["id"] for d in ecc["domains"] for r in d["rules"]}
    soc2_ids = {r["id"] for d in soc2["domains"] for r in d["rules"]}

    assert {"DO-NET-01", "DO-NET-02", "DO-DBS-01"} <= ecc_ids              # network access answers ECC
    assert "DO-KEY-01" not in ecc_ids and "DO-KEY-01" in soc2_ids         # key hygiene answers SOC 2 only
    assert len(ecc_ids) != len(soc2_ids)                                  # a framework is not a fixed list
    clauses = {c["code"]: c["rules"] for c in ecc["clauses"]}
    assert "DO-NET-01" in clauses["2-5-1-1"] and "parent-only" not in clauses     # navigation-only rows are not evidence
    # the framework picker counts what can run
    assert {f["slug"]: f["runnable"] for f in ecc["frameworks"]}[ECC] == len(ecc_ids)


def _sample_owner(db, campaign_id):
    db.add(m.AccessReviewItem(
        tenant_id=1, campaign_id=campaign_id, email="owner@bank.example", display_name="Owner", department="IT",
        account_enabled=True, mfa_enabled=None, decision="pending", roles_snapshot=["DigitalOcean: team Bank"],
        access_snapshot=[{"name": "DigitalOcean: team Bank", "source": "digitalocean"}]))
    db.get(m.AccessReviewCampaign, campaign_id).status = "sampled"
    db.commit()


def test_a_review_of_digitalocean_tests_the_estate_and_reports_each_rule(db, api, connected):
    review = api.post("/access-reviews", json={"name": "DO", "source": "digitalocean", "rule_scope": "framework",
                                               "rule_framework": ECC}).json()
    _sample_owner(db, review["id"])
    ran = api.post(f"/access-reviews/{review['id']}/run-checks").json()
    assert ran["connector_rules"] > 0 and ran["connector_rules_failed"] == 2          # NET-01 and NET-02

    detail = api.get(f"/access-reviews/{review['id']}").json()
    results = {r["id"]: r for r in detail["rule_results"]}
    assert results["DO-NET-01"]["status"] == "fail" and results["DO-NET-01"]["failed"] == 2
    assert results["DO-NET-01"]["frameworks"][0]["slug"] == ECC and results["DO-NET-01"]["frameworks"][0]["codes"] == ["2-5-1-1"]
    assert results["DO-NET-04"]["status"] == "not_applicable"
    assert [r["status"] for r in detail["rule_results"]][:2] == ["fail", "fail"]       # failures first
    assert detail["connector_notes"][0]["label"] == "DigitalOcean"

    # the report counts the failed estate rules in its verdict and says why
    report = api.get(f"/access-reviews/{review['id']}/report").json()
    assert report["verdict"] == "deficient" and report["connector_rules_failed"] == 2
    assert any("2 rules failed against the connected estate" in why for why in report["verdict_reasons"])
    assert detail["campaign"]["exceptions_found"] == 2
    assert sum(report["findings_by_severity"].values()) == report["exceptions_total"] == 2     # the breakdown adds up

    # the exports name the failing resources
    csv = api.get(f"/access-reviews/{review['id']}/report/export?format=csv").text
    assert "DO-NET-01" in csv and "web: web has a public address" in csv and "Not applicable" in csv

    # the results are frozen: the library changing later does not rewrite them
    api.patch("/access-reviews/rules/DO-NET-01", json={"enabled": False})
    again = {r["id"]: r for r in api.get(f"/access-reviews/{review['id']}").json()["rule_results"]}
    assert again["DO-NET-01"]["status"] == "fail"


def test_a_critical_estate_failure_is_a_material_weakness(db, api, connected, monkeypatch):
    cr.RULES_BY_ID  # noqa: B018 — the pack is loaded
    pack = cr.packs()["digitalocean"]
    critical = dataclasses.replace(next(r for r in pack.rules if r.id == "DO-NET-01"), severity="critical")
    monkeypatch.setitem(cr.PACKS, "digitalocean", dataclasses.replace(
        pack, rules=tuple(critical if r.id == "DO-NET-01" else r for r in pack.rules)))
    monkeypatch.setitem(cr.RULES_BY_ID, "DO-NET-01", critical)
    review = api.post("/access-reviews", json={"name": "DO", "source": "digitalocean", "rule_scope": "custom",
                                               "rule_ids": ["DO-NET-01"]}).json()
    _sample_owner(db, review["id"])
    api.post(f"/access-reviews/{review['id']}/run-checks")
    assert api.get(f"/access-reviews/{review['id']}/report").json()["verdict"] == "material_weakness"


def test_a_source_can_be_tested_against_its_rules_without_a_review(db, api, connected):
    out = api.post("/access-reviews/connectors/digitalocean/rules/run")
    assert out.status_code == 200, out.text
    body = out.json()
    assert body["connected"] is True and body["label"] == "DigitalOcean" and "team-member" in body["limits"]
    by_id = {r["id"]: r for r in body["results"]}
    assert by_id["DO-NET-01"]["status"] == "fail" and by_id["DO-NET-01"]["failures"][0]["resource"] == "web"
    assert [r["status"] for r in body["results"]][:2] == ["fail", "fail"]               # failing first
    assert db.query(m.AccessReviewCampaign).count() == 0                                 # nothing stored
    assert api.post("/access-reviews/connectors/okta/rules/run").status_code == 404
