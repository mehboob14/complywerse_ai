"""Automated tests a control owner can understand, and backups that reach BCD-11.

The Tests tab tells a person what each automated test reads, when it passes and
what a failure means. That text is generated from the check's own definition, so
these pin the two ways it could go wrong: a check with no explanation, and an
explanation that says something the engine does not do.
"""
from grc.modules.compliance_plugins.runners.covers import covers_for_check, scf_targets_from_covers
from grc.modules.compliance_plugins.runners.evidence_engine import _eval_check, _items_from
from grc.modules.compliance_plugins.runners.explain import check_title, explain_check
from grc.modules.compliance_plugins.runners.live_api_catalog import PROVIDER_API, provider_checks

BACKUP_CHECKS = {
    "digitalocean": ["digitalocean.droplet_backups_enabled", "digitalocean.database_backups_present"],
    "neon": ["neon.project_history_retention"],
    "supabase": ["supabase.database_backups_enabled"],
    "aws": ["aws.backup_plans", "aws.backup_protected_resources", "aws.rds_backup_retention", "aws.dynamodb_pitr"],
}


def test_every_check_explains_itself():
    unexplained = [(p, c["id"]) for p in PROVIDER_API for c in provider_checks(p) if not explain_check(p, c["id"])]
    assert unexplained == []


def test_backup_checks_reach_bcd_11_through_covers():
    for provider, ids in BACKUP_CHECKS.items():
        declared = {c["id"]: c for c in provider_checks(provider)}
        for cid in ids:
            assert cid in declared, cid
            assert "BCD-11" in scf_targets_from_covers(covers_for_check(declared[cid])), cid


def test_explanation_matches_what_the_engine_evaluates():
    e = explain_check("digitalocean", "digitalocean.droplet_backups_enabled")
    assert e["call"] == "GET /droplets"
    assert "features includes “backups”" in e["checks"]
    assert "not assessed" in e["when_empty"]  # the engine reports not_run on an empty set
    rds = explain_check("aws", "aws.rds_backup_retention")
    assert rds["checks"].startswith("Every RDS instance") and "at least 7" in rds["rule"]
    assert check_title("aws", "aws.root_mfa") == "Root account has MFA enabled"  # no title: the pass message


def test_every_check_is_written_out_as_a_procedure():
    # the exact written test: where it signs in, what it reads, the rule, what a failure means, what is kept
    for provider in PROVIDER_API:
        for check in provider_checks(provider):
            steps = explain_check(provider, check["id"])["steps"]
            labels = [s["label"] for s in steps]
            assert labels[:2] == ["Sign in", "Read"] and "Test" in labels and labels[-1] == "Keep", (provider, check["id"])
            assert all(s["text"] for s in steps), (provider, check["id"])
            assert ("Limits" in labels) == (not PROVIDER_API[provider].get("transport")), provider   # the engine's caps
    do = {s["label"]: s for s in explain_check("digitalocean", "digitalocean.firewalls_present")["steps"]}
    assert do["Read"]["code"] == "GET /firewalls" and "Droplet network access" in do["Fails when"]["text"]
    assert "5,000" in do["Limits"]["text"] and "25" in do["Limits"]["text"]


def test_the_builtin_aws_checks_are_explained_from_their_definition():
    from grc.modules.compliance_plugins.runners.explain import explain_quantitative
    from grc.modules.compliance_plugins.seed_soc2_quantitative import SOC2_QUANTITATIVE_LIBRARY
    by_key = {s["plugin_key"].split("__", 1)[1]: s for s in SOC2_QUANTITATIVE_LIBRARY}
    for spec in SOC2_QUANTITATIVE_LIBRARY:
        d = spec["check_definition"]
        e = explain_quantitative(d, spec["rationale"], spec["remediation"])
        assert e["rule"] and e["looks_at"] == d["expect"]["path"] and e["fails_when"] == d["fail_message"], spec["plugin_key"]
        assert e["call"].endswith("".join(p.capitalize() for p in d["operation"].split("_")) + (
            " (AccountId = your AWS account id)" if d.get("operation_args") else "")), spec["plugin_key"]
        assert [s["label"] for s in e["steps"]] == ["Sign in", "Read", "Look at", "Test", "Fails when", "If it cannot read", "Keep"]
        assert (e["why"], e["fix"]) == (spec["rationale"], spec["remediation"])
    e = lambda key: explain_quantitative(by_key[key]["check_definition"])   # noqa: E731
    assert "between 14 and 128" in e("CC6.2__password_policy_min_length")["rule"]          # 115 values read as a range
    assert "none of the security groups has group name set to “default”" in e("CC6.8__no_open_ssh_world")["rule"]
    assert "at least one entry in trail list" in e("CC7.2__cloudtrail_enabled")["rule"]


def test_a_control_lists_the_written_test_of_every_automated_check_that_reaches_it():
    # Controls reached through a SOC 2 criterion by a built-in AWS check used to list "0 tests" for it.
    from grc.modules.automation.router import _test_groups
    root_mfa = {"plugin_key": "SOC2_QUANTITATIVE_v1__CC6.1__root_mfa_enabled", "source": "aws", "check_ids": [],
                "binding": "soc2_fallback", "control_status": "not_run", "last_run": None}
    backups = {"plugin_key": "SOC2_CONNECTORS_v1__digitalocean", "source": "connector", "binding": "covers",
               "check_ids": ["digitalocean.droplet_backups_enabled"], "control_status": "not_run", "last_run": None}

    def rows(scf_id, connected, last_run=None):
        groups = _test_groups([{**root_mfa, "last_run": last_run}, backups], connected, scf_id)
        return {p["provider"]: p for g in groups for p in g["providers"]}

    aws = rows("NET-03", set())["aws"]["tests"]
    assert [t["id"] for t in aws] == [root_mfa["plugin_key"]] and aws[0]["title"] == "AWS — Root MFA enabled"
    assert aws[0]["explain"]["steps"][0]["label"] == "Sign in" and aws[0]["result"] is None   # not connected: no result shown
    assert (aws[0]["binding"], aws[0]["soc2"], aws[0]["covers"]) == ("soc2_fallback", ["CC6.1"], [])

    ran = {"status": "failed", "result_summary": "Root account does NOT have MFA enabled.", "started_at": "2026-10-06T10:00:00"}
    result = rows("NET-03", {"aws"}, ran)["aws"]["tests"][0]["result"]
    assert (result["status"], result["detail"], result["checked_at"]) == ("fail", ran["result_summary"], ran["started_at"])

    # a covers match names the objectives it covers for THIS control, never another's
    do = rows("BCD-11", set())["digitalocean"]["tests"][0]
    assert do["binding"] == "covers" and do["covers"] and all(t.startswith("BCD-11") for t in do["covers"])
    assert rows("IAC-01", set())["digitalocean"]["tests"][0]["covers"] == []


def test_a_detail_endpoint_is_one_row_not_an_empty_list():
    # /orgs/{org} returns an object. Read as a list it was empty, so the check on
    # it reported "not assessed" forever instead of evaluating.
    assert _items_from({"login": "acme", "two_factor_requirement_enabled": True}, ["$"]) == [
        {"login": "acme", "two_factor_requirement_enabled": True}]
    assert _items_from({"login": "acme"}, None) == []  # unchanged for list endpoints
    rows = [{"_parent": "orders-db", "backup_count": 0}, {"_parent": "users-db", "backup_count": 3}]
    findings = _eval_check({"id": "do.db", "resource": "database_backups", "kind": "all_match",
                            "field": "backup_count", "op": "gt", "value": 0, "controls": ["A1.2"],
                            "title": "Backups", "item_name": "_parent", "fail_msg": "no backups"}, rows)
    assert [f["resource"] for f in findings if f["status"] == "fail" and f["resource"] != "directory"] == ["orders-db"]


def test_a_collector_is_collected_again_once_a_day():
    from datetime import datetime, timedelta
    from grc.tasks.evidence_collectors import is_due
    now = datetime(2026, 9, 17, 12, 0)
    assert is_due(None, now)                              # never collected
    assert not is_due(now - timedelta(hours=2), now)      # someone just ran it
    assert is_due(now - timedelta(hours=20), now)


# ── connecting a collector ───────────────────────────────────────────────────

def test_every_connector_lists_its_tests_and_calls():
    from grc.modules.compliance_plugins.runners.explain import connector_reads, connector_tests
    for provider in PROVIDER_API:
        tests, reads = connector_tests(provider), connector_reads(provider)
        assert tests and all(t["title"] and t["checks"] for t in tests), provider
        first = "Signs in" if PROVIDER_API[provider].get("token_exchange") else "Confirms"
        assert reads and reads[0]["what"].startswith(first), provider
        assert any(r["what"].startswith("Confirms") for r in reads), provider


def test_pasted_addresses_become_what_the_collector_substitutes():
    from grc.modules.compliance_plugins.runners.connector_setup import normalize_domain
    assert normalize_domain("okta", "https://acme.okta.com/admin/dashboard/") == "acme.okta.com"
    assert normalize_domain("azure_devops", "https://dev.azure.com/acme") == "acme"   # a path segment
    assert normalize_domain("grafana", "https://ops.acme.com/grafana/") == "ops.acme.com/grafana"  # self-hosted root


def test_a_half_filled_form_is_refused_by_label():
    from grc.modules.compliance_plugins.runners.connector_setup import form_fields, missing_fields
    keys = {f["key"] for f in form_fields("aws")}
    assert {"access_key_id", "token", "region"} <= keys
    assert "Secret access key" in missing_fields("aws", {"access_key_id": "AKIA", "region": "eu-west-1"})
    assert missing_fields("digitalocean", {"token": "dop_v1_x"}) == []


def test_raw_prefixed_fields_read_the_item_itself():
    # SentinelOne, Tenable, ServiceNow, Opsgenie, Rippling, Jamf and Mailgun wrote
    # "raw.<field>"; read literally, every value was empty.
    from grc.modules.compliance_plugins.runners.evidence_engine import _normalize
    item = {"isActive": True, "general": {"name": "mac-01"}, "apps": [1, 2]}
    assert _normalize(item, {"active": "raw.isActive", "name": "raw.general.name",
                             "apps": "len:raw.apps", "off": "!raw.isActive"}) == {
        "active": True, "name": "mac-01", "apps": 2, "off": False}


def test_a_broad_scope_is_matched_as_a_word_not_a_substring():
    from grc.modules.compliance_plugins.runners.evidence_engine import _op
    assert _op("global purge_all", "has_word", "global")
    assert not _op("global:read", "has_word", "global")  # Fastly's read-only scope


def test_a_single_object_under_an_items_path_is_one_row():
    assert _items_from({"data": {"id": "org-1", "attributes": {"sast_enabled": True}}}, ["data"]) == [
        {"id": "org-1", "attributes": {"sast_enabled": True}}]
