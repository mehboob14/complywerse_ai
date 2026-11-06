"""Connectors that sign in the way each provider requires and read every page.

Research against each vendor's documentation found 24 of 66 connectors that
could not work as coded: tokens that expire within hours pasted as if permanent,
auth prefixes left for the customer to type, and lists read one page deep so a
2FA check judged the first 10 users as if they were everyone. These pin the
fixes at the engine level, where every connector routes through.
"""
import base64
import json
import re
import urllib.parse
from types import SimpleNamespace

import pytest

from grc.modules.compliance_plugins.runners import evidence_engine as engine
from grc.modules.compliance_plugins.runners import live_api_catalog as catalog
from grc.modules.compliance_plugins.runners.connector_setup import form_fields, normalize_domain
from grc.modules.compliance_plugins.runners.live_api_catalog import PROVIDER_API, run_provider


class FakeHttp:
    """Records every request; answers from a list of (predicate, status, body, headers)."""

    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def __call__(self, url, method, headers, data, timeout=15):
        self.calls.append({"url": url, "method": method, "headers": headers, "data": data})
        for match, status, body, response_headers in self.routes:
            if match(url, method):
                return status, body, response_headers
        return 200, {}, {}


def _install(monkeypatch, routes):
    fake = FakeHttp(routes)
    monkeypatch.setattr(catalog, "_send", fake)
    return fake


# ── signing in ───────────────────────────────────────────────────────────────

def test_client_credentials_are_exchanged_for_a_bearer_token(monkeypatch):
    fake = _install(monkeypatch, [
        (lambda u, m: "login.microsoftonline.com" in u, 200, {"access_token": "graph-token", "expires_in": 3599}, {}),
        (lambda u, m: "/users?$top=1" in u, 200, {"value": [{"id": "1"}]}, {}),
    ])
    out = run_provider("microsoft_365", {"domain": "contoso.onmicrosoft.com", "access_key_id": "app-id", "token": "s3cret"})
    assert out["connectivity"] == "pass"
    token_call = fake.calls[0]
    assert token_call["url"] == "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token"
    form = dict(urllib.parse.parse_qsl(token_call["data"].decode()))
    assert form == {"grant_type": "client_credentials", "client_id": "app-id", "client_secret": "s3cret",
                    "scope": "https://graph.microsoft.com/.default"}
    # every Graph call carries the exchanged token, never the client secret
    graph_calls = fake.calls[1:]
    assert graph_calls and all(c["headers"]["Authorization"] == "Bearer graph-token" for c in graph_calls)


def test_a_refused_sign_in_is_a_credential_failure_with_the_providers_reason(monkeypatch):
    _install(monkeypatch, [(lambda u, m: "/oauth/token" in u, 401,
                            {"error": "access_denied", "error_description": "Unauthorized"}, {})])
    out = run_provider("auth0", {"domain": "acme.us.auth0.com", "access_key_id": "id", "token": "bad"})
    assert out["connectivity"] == "fail"
    assert "refused (HTTP 401): Unauthorized" in out["findings"][0]["detail"]


def test_an_unreachable_sign_in_endpoint_is_an_error_not_a_bad_credential(monkeypatch):
    monkeypatch.setattr(catalog, "_send", lambda *a, **k: (0, "timed out", {}))
    out = run_provider("jamf", {"domain": "acme.jamfcloud.com", "access_key_id": "id", "token": "secret"})
    assert out["connectivity"] == "error"


def test_zoom_signs_in_with_basic_client_credentials_and_the_account_id(monkeypatch):
    fake = _install(monkeypatch, [(lambda u, m: "zoom.us/oauth/token" in u, 200, {"access_token": "z"}, {})])
    run_provider("zoom", {"access_key_id": "ACC123", "email": "client-id", "token": "client-secret"})
    call = fake.calls[0]
    assert "account_id=ACC123" in call["url"] and "grant_type=account_credentials" in call["url"]
    assert call["headers"]["Authorization"] == "Basic " + base64.b64encode(b"client-id:client-secret").decode()


def test_google_signs_a_service_account_assertion_that_impersonates_the_admin(monkeypatch):
    jwt = pytest.importorskip("jwt")
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
    key = {"type": "service_account", "client_email": "collector@proj.iam.gserviceaccount.com",
           "private_key": pem, "private_key_id": "kid-1", "token_uri": "https://attacker.example/token"}
    fake = _install(monkeypatch, [(lambda u, m: "oauth2.googleapis.com" in u, 200, {"access_token": "g"}, {})])
    run_provider("google_workspace", {"token": json.dumps(key), "email": "admin@acme.com"})

    call = fake.calls[0]
    assert call["url"] == "https://oauth2.googleapis.com/token"  # never the token_uri from the pasted file
    form = dict(urllib.parse.parse_qsl(call["data"].decode()))
    assert form["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    claims = jwt.decode(form["assertion"], private.public_key(), algorithms=["RS256"],
                        audience="https://oauth2.googleapis.com/token")
    assert claims["sub"] == "admin@acme.com" and claims["iss"] == key["client_email"]
    assert "admin.directory.user.readonly" in claims["scope"]


def test_a_malformed_service_account_key_is_reported_not_raised(monkeypatch):
    _install(monkeypatch, [])
    out = run_provider("google_workspace", {"token": "{not json", "email": "admin@acme.com"})
    assert out["connectivity"] == "fail" and "JSON key file" in out["findings"][0]["detail"]


def test_slack_answering_200_with_ok_false_is_a_rejected_token(monkeypatch):
    _install(monkeypatch, [(lambda u, m: "auth.test" in u, 200, {"ok": False, "error": "invalid_auth"}, {})])
    out = run_provider("slack", {"token": "xoxp-wrong"})
    assert out["connectivity"] == "fail" and "invalid_auth" in out["findings"][0]["detail"]


def test_prefixes_and_second_secrets_are_added_by_the_connector(monkeypatch):
    fake = _install(monkeypatch, [])
    run_provider("datadog", {"token": "api-key", "secret2": "app-key"})
    headers = fake.calls[0]["headers"]
    assert fake.calls[0]["url"].startswith("https://api.datadoghq.com/api/v1/monitor")  # default site
    assert headers["DD-API-KEY"] == "api-key" and headers["DD-APPLICATION-KEY"] == "app-key"
    fake.calls.clear()
    run_provider("opsgenie", {"token": "abc", "domain": "api.eu.opsgenie.com"})
    assert fake.calls[0]["url"].startswith("https://api.eu.opsgenie.com/v2")
    assert fake.calls[0]["headers"]["Authorization"] == "GenieKey abc"
    fake.calls.clear()
    run_provider("bamboohr", {"token": "key", "domain": "acme"})
    assert fake.calls[0]["url"].startswith("https://acme.bamboohr.com/api/v1/")
    assert fake.calls[0]["headers"]["Authorization"] == "Basic " + base64.b64encode(b"key:x").decode()


# ── reading every page ───────────────────────────────────────────────────────

def _pages(monkeypatch, answer):
    seen = []

    def fake_request(spec, creds, url, timeout=15, with_headers=False):
        seen.append(url)
        status, body, headers = answer(url)
        return (status, body, headers) if with_headers else (status, body)

    monkeypatch.setattr(engine, "_request", fake_request)
    return seen


def test_cursor_paging_follows_the_last_id_until_has_more_is_false(monkeypatch):
    def answer(url):
        after = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query)).get("after_id")
        if after is None:
            return 200, {"data": [{"id": "u1"}, {"id": "u2"}], "last_id": "u2", "has_more": True}, {}
        return 200, {"data": [{"id": "u3"}], "last_id": "u3", "has_more": False}, {}
    seen = _pages(monkeypatch, answer)
    rows, note = engine._collect_one({}, {}, "https://api.x.com", {
        "path": "/users?limit=1000", "items": ["data"], "fields": {"id": "id"},
        "paginate": {"style": "cursor", "param": "after_id", "next": "last_id", "more": "has_more"}}, {})
    assert [r["id"] for r in rows] == ["u1", "u2", "u3"] and note is None
    assert seen[1] == "https://api.x.com/users?limit=1000&after_id=u2"


def test_next_links_are_followed_only_on_the_providers_own_host(monkeypatch):
    def answer(url):
        if url.endswith("page=2"):
            return 200, {"values": [{"n": 2}], "next": "https://evil.example/steal"}, {}
        return 200, {"values": [{"n": 1}], "next": "/2.0/repos?page=2"}, {}
    seen = _pages(monkeypatch, answer)
    rows, note = engine._collect_one({}, {}, "https://api.bitbucket.org/2.0", {
        "path": "/repos", "items": ["values"], "fields": {"n": "n"},
        "paginate": {"style": "next_url", "next": "next"}}, {})
    assert [r["n"] for r in rows] == [1, 2]
    assert seen == ["https://api.bitbucket.org/2.0/repos", "https://api.bitbucket.org/2.0/repos?page=2"]
    assert note == "the next page was on another host and was not followed"


def test_link_header_paging_reads_rel_next(monkeypatch):
    def answer(url):
        if "after=" in url:
            return 200, [{"id": "b"}], {"Link": '<https://acme.okta.com/api/v1/users?limit=1>; rel="self"'}
        return 200, [{"id": "a"}], {"link": '<https://acme.okta.com/api/v1/users?after=a&limit=1>; rel="next"'}
    _pages(monkeypatch, answer)
    rows, _ = engine._collect_one({}, {}, "https://acme.okta.com/api/v1", {
        "path": "/users?limit=1", "items": [], "fields": {"id": "id"}, "paginate": {"style": "link_header"}}, {})
    assert [r["id"] for r in rows] == ["a", "b"]


def test_offset_paging_and_a_capped_population_says_so(monkeypatch):
    def answer(url):
        offset = int(dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))["offset"])
        return 200, [{"id": offset + i} for i in range(2)], {}
    _pages(monkeypatch, answer)
    monkeypatch.setattr(engine, "MAX_ITEMS", 4)
    rows, note = engine._collect_one({}, {}, "https://api.clerk.com/v1", {
        "path": "/users", "items": [], "fields": {"id": "id"},
        "paginate": {"style": "offset", "param": "offset", "size_param": "limit", "size": 2}}, {})
    assert [r["id"] for r in rows] == [0, 1, 2, 3]
    assert note == "only the first 4 were checked"
    summary = engine._eval_check({"id": "c.mfa", "kind": "all_true", "field": "mfa", "controls": [], "title": "MFA"},
                                 [{"mfa": True}] * 4, note=note)[-1]
    assert summary["status"] == "pass" and "(only the first 4 were checked)" in summary["detail"] and summary["truncated"]


# ── nested lookups and what an empty answer means ────────────────────────────

GITHUB_2FA = {"id": "github.members_all_have_2fa", "resource": "members_no_2fa", "kind": "max_count", "max": 0,
              "empty": "pass", "controls": ["CC6.1"], "title": "No members without 2FA", "item_name": "login"}
RESOURCES = [
    {"name": "orgs", "path": "/user/orgs", "items": [], "fields": {"login": "login"}},
    {"name": "members_no_2fa", "path": "/orgs/{org}/members?filter=2fa_disabled", "items": [],
     "for_each": {"resource": "orgs", "vars": {"org": "login"}, "label_field": "login"}, "fields": {"login": "login"}},
]


def _run(monkeypatch, answer, checks):
    _pages(monkeypatch, answer)
    return engine.run_connector_checks("github", {}, {}, "https://api.github.com",
                                       {"resources": RESOURCES, "checks": checks})


def test_an_empty_offender_list_passes_only_when_it_was_really_read(monkeypatch):
    ok = _run(monkeypatch, lambda u: (200, [{"login": "acme"}] if u.endswith("/user/orgs") else [], {}), [GITHUB_2FA])
    assert ok[-1]["status"] == "pass"
    # an owner-only filter refused for every org is a collection error, not "nobody lacks 2FA"
    refused = _run(monkeypatch, lambda u: (200, [{"login": "acme"}], {}) if u.endswith("/user/orgs") else (403, {}, {}), [GITHUB_2FA])
    assert refused[-1]["status"] == "error"
    # no organizations visible to the token: nothing was assessed
    none = _run(monkeypatch, lambda u: (200, [], {}), [GITHUB_2FA])
    assert none[-1]["status"] == "not_run" and "no orgs were found" in none[-1]["detail"]


def test_members_without_2fa_are_named_in_the_failure(monkeypatch):
    out = _run(monkeypatch, lambda u: (200, [{"login": "acme"}] if u.endswith("/user/orgs") else [{"login": "mallory"}], {}),
               [GITHUB_2FA])
    assert [f["resource"] for f in out if f["status"] == "fail"] == ["mallory", "directory"]


def test_count_checks_count_the_matching_rows_not_every_row():
    users = [{"email": f"u{i}", "admin": i < 2} for i in range(40)]
    check = {"id": "g.admins", "kind": "max_count", "field": "admin", "op": "eq", "value": True, "max": 5,
             "controls": [], "title": "Super admins"}
    summary = engine._eval_check(check, users)[-1]
    assert summary["status"] == "pass" and "found 2 of 40" in summary["detail"]


def test_a_field_the_provider_withholds_is_not_assessed_rather_than_failed():
    check = {"id": "gh.org2fa", "kind": "all_true", "field": "two_factor_required", "skip_missing": True,
             "controls": [], "title": "Org requires 2FA"}
    assert engine._eval_check(check, [{"login": "acme"}])[-1]["status"] == "not_run"
    assert engine._eval_check(check, [{"login": "acme", "two_factor_required": False}])[-1]["status"] == "fail"


def test_several_skip_fields_leave_out_bots_and_deactivated_members():
    check = {"id": "s.mfa", "kind": "all_true", "field": "has_2fa", "skip_if_field_true": ["is_bot", "deleted"],
             "controls": [], "title": "2FA"}
    rows = [{"name": "bot", "is_bot": True}, {"name": "gone", "deleted": True}, {"name": "ann", "has_2fa": True}]
    assert engine._eval_check(check, rows)[-1]["status"] == "pass"


# ── the connect form matches what each connector sends ───────────────────────

_PLACEHOLDER = re.compile(r"\{(token|secret2|email|domain|access_key_id|region)\}")


def test_every_form_field_is_used_and_every_value_used_has_a_field():
    for provider, spec in PROVIDER_API.items():
        if spec.get("transport"):
            continue
        text = json.dumps({k: spec.get(k) for k in ("base", "header_templates", "token_exchange",
                                                     "basic_user", "basic_password")})
        used = set(_PLACEHOLDER.findall(text)) | {"token"}
        default_user = spec.get("auth") == "basic" and "basic_user" not in spec
        if default_user:
            used.add("email")
        fields = {f["key"]: f for f in form_fields(provider)}
        assert set(fields) <= used, (provider, set(fields) - used)
        optional = ({"email"} if default_user else set()) | ({"domain"} if spec.get("domain_default") else set())
        assert used - set(fields) - optional == set(), provider
        if spec.get("domain_default") and "domain" in fields:
            assert fields["domain"]["required"] is False, provider


def test_pasted_urls_reduce_to_the_part_each_connector_substitutes():
    assert normalize_domain("bamboohr", "https://acme.bamboohr.com/home") == "acme"
    assert normalize_domain("posthog", "https://eu.posthog.com/project/12/settings") == "eu.posthog.com"
    assert normalize_domain("grafana", "https://ops.acme.com/grafana/") == "ops.acme.com/grafana"


def test_a_saved_connection_with_a_blank_host_uses_the_providers_default(monkeypatch):
    from grc.modules.compliance_plugins.services import credentials
    monkeypatch.setattr(credentials, "decrypt_secret", lambda v: v)
    conn = SimpleNamespace(integration_type="datadog", credential_env_prefix=None, password=None, username=None,
                           console_url="https://{domain}/api/v1",  # the NOT NULL placeholder written on create
                           credentials_extra_json={"token": "api", "secret2": "app", "domain": "", "email": ""})
    creds = credentials.resolve_credentials_for_connection(conn)
    assert creds["domain"] == "" and creds["secret2"] == "app"
