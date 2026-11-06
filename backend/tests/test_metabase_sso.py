"""Unit tests for Metabase SSO helpers (Reports › Analytics)."""
from __future__ import annotations

import jwt
import pytest

from grc.services import metabase_sso


@pytest.fixture(autouse=True)
def _metabase_env(monkeypatch):
    monkeypatch.setenv("METABASE_SITE_URL", "http://127.0.0.1:3001")
    monkeypatch.setenv("METABASE_JWT_SHARED_SECRET", "unit-test-secret-do-not-use")
    monkeypatch.delenv("METABASE_EMBED_ENABLED", raising=False)
    monkeypatch.delenv("METABASE_EMBEDDING_SECRET_KEY", raising=False)


def test_metabase_enabled_with_site_only(monkeypatch):
    monkeypatch.delenv("METABASE_JWT_SHARED_SECRET", raising=False)
    monkeypatch.delenv("METABASE_PRO_JWT", raising=False)
    assert metabase_sso.metabase_enabled() is True
    assert metabase_sso.metabase_mode() == "open_link"


def test_mint_sso_token_claims(monkeypatch):
    monkeypatch.setenv("METABASE_PRO_JWT", "1")
    token = metabase_sso.mint_sso_token(
        email="analyst@example.com",
        display_name="Ada Lovelace",
        groups=["compliverse_analyst"],
        tenant_slug="acme",
        ttl_seconds=120,
    )
    payload = jwt.decode(token, "unit-test-secret-do-not-use", algorithms=["HS256"])
    assert payload["email"] == "analyst@example.com"
    assert payload["first_name"] == "Ada"
    assert payload["last_name"] == "Lovelace"
    assert payload["groups"] == ["compliverse_analyst"]
    assert payload["tenant_slug"] == "acme"
    assert "exp" in payload and "iat" in payload


def test_sso_login_url(monkeypatch):
    monkeypatch.setenv("METABASE_PRO_JWT", "1")
    token = metabase_sso.mint_sso_token(email="a@b.com")
    url = metabase_sso.sso_login_url(token, return_to="/dashboard/1")
    assert url.startswith("http://127.0.0.1:3001/auth/sso?jwt=")
    assert "return_to=%2Fdashboard%2F1" in url


def test_jwt_required_for_mint(monkeypatch):
    monkeypatch.delenv("METABASE_JWT_SHARED_SECRET", raising=False)
    monkeypatch.setenv("METABASE_PRO_JWT", "1")
    with pytest.raises(RuntimeError):
        metabase_sso.mint_sso_token(email="a@b.com")


def test_pro_jwt_opt_in(monkeypatch):
    monkeypatch.setenv("METABASE_JWT_SHARED_SECRET", "unit-test-secret-do-not-use")
    monkeypatch.delenv("METABASE_PRO_JWT", raising=False)
    assert metabase_sso.jwt_sso_configured() is False
    monkeypatch.setenv("METABASE_PRO_JWT", "1")
    assert metabase_sso.jwt_sso_configured() is True
    assert metabase_sso.metabase_mode() == "sso_link"


def test_static_embed_url(monkeypatch):
    monkeypatch.delenv("METABASE_JWT_SHARED_SECRET", raising=False)
    monkeypatch.setenv("METABASE_EMBEDDING_SECRET_KEY", "embed-secret")
    monkeypatch.setenv("METABASE_EMBED_ENABLED", "1")
    assert metabase_sso.metabase_mode() == "static_embed"
    url = metabase_sso.mint_static_embed_url(resource_type="dashboard", resource_id=9)
    assert "/embed/dashboard/" in url


def test_starter_dashboard_catalog(tmp_path, monkeypatch):
    import json
    path = tmp_path / "dashboard_ids.json"
    path.write_text(json.dumps({"risk_posture": {"id": 2, "title": "Risk posture"}}), encoding="utf-8")
    monkeypatch.setenv("METABASE_DASHBOARD_IDS_FILE", str(path))
    catalog = metabase_sso.starter_dashboard_catalog()
    by_key = {c["key"]: c for c in catalog}
    assert by_key["risk_posture"]["metabase_dashboard_id"] == 2
    assert by_key["vendor_tpra"]["metabase_dashboard_id"] is None


def test_list_reporting_view_catalog():
    from grc.services.reporting_semantic_layer import list_reporting_view_catalog

    catalog = list_reporting_view_catalog()
    names = {c["view"] for c in catalog}
    assert "reporting_risks" in names
    assert "reporting_vendors_tpra" in names
    assert "reporting_scf_check_results" in names
