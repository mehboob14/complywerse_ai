"""Reports > Analytics status: plain words for the launcher page, the old keys kept, and the connection given back.

The page shows `headline` and `detail` and never the deployment keys; the keys stay for the Administration page. The probe that lists the reporting views
used to leave its connection open on every call.
"""
import pytest

from grc.routers import reporting_router as rr


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Conn:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        self.log.append("open")
        return self

    def __exit__(self, *exc):
        self.log.append("closed")
        return False

    def execute(self, *_a, **_k):
        return _Result([("reporting_risks",), ("reporting_vendors",)])


class _Engine:
    def __init__(self):
        self.log = []

    def connect(self):
        return _Conn(self.log)


class _Db:
    def __init__(self, engine):
        self._engine = engine

    def get_bind(self):
        return self._engine


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in ("METABASE_SITE_URL", "METABASE_JWT_SHARED_SECRET", "METABASE_PRO_JWT", "METABASE_EMBED_ENABLED", "METABASE_EMBEDDING_SECRET_KEY"):
        monkeypatch.delenv(name, raising=False)


def test_not_set_up_says_so_in_plain_words_and_names_no_product_or_setting():
    out = rr.metabase_status(db=_Db(_Engine()), user=object())
    assert out["ready"] is False and out["configured"] is False and out["can_embed"] is False
    assert out["headline"] == "Not set up yet"
    assert "administrator" in out["detail"]
    for word in ("metabase", "METABASE", "env", "deploy/", "JWT", "OSS", "Mailhog"):
        assert word not in out["headline"] + out["detail"], word


def test_connected_with_a_static_embed_can_show_a_dashboard_in_the_page(monkeypatch):
    monkeypatch.setenv("METABASE_SITE_URL", "http://127.0.0.1:3001")
    monkeypatch.setenv("METABASE_EMBEDDING_SECRET_KEY", "unit-test-secret-do-not-use")
    monkeypatch.setenv("METABASE_EMBED_ENABLED", "1")
    out = rr.metabase_status(db=_Db(_Engine()), user=object())
    assert out["ready"] is True and out["can_embed"] is True and out["headline"] == "Connected"
    assert [d["key"] for d in out["starter_dashboards"]] == ["risk_posture", "vendor_tpra", "issues_vulns", "evidence_compliance"]


def test_site_only_connects_but_cannot_embed(monkeypatch):
    monkeypatch.setenv("METABASE_SITE_URL", "http://127.0.0.1:3001")
    out = rr.metabase_status(db=_Db(_Engine()), user=object())
    assert out["ready"] is True and out["can_embed"] is False


def test_the_old_keys_are_all_still_there():
    out = rr.metabase_status(db=_Db(_Engine()), user=object())
    for key in ("configured", "site_url", "embed_enabled", "jwt_sso", "static_embed", "mode", "reporting_views", "view_catalog", "starter_dashboards", "subscriptions", "licence_note"):
        assert key in out, key
    assert out["reporting_views"] == ["reporting_risks", "reporting_vendors"]


def test_the_view_probe_gives_its_connection_back():
    engine = _Engine()
    rr.metabase_status(db=_Db(engine), user=object())
    assert engine.log == ["open", "closed"]


def test_a_failing_probe_is_an_empty_list_not_a_failed_status():
    class Broken(_Engine):
        def connect(self):
            raise RuntimeError("no database")

    out = rr.metabase_status(db=_Db(Broken()), user=object())
    assert out["reporting_views"] == [] and out["headline"] == "Not set up yet"
