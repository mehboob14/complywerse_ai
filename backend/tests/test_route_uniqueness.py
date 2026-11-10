"""One handler per URL: two handlers on the same method and path never both answer (FastAPI keeps the one registered first), so the later one is dead code and the
page that calls it gets the other's payload. GET /admin/ai-usage/overview was defined twice (the token-usage dashboard in admin_router.py and the external tracing view
in admin_ai_usage_router.py): the Usage Monitoring page always got the wrong shape (G12 P-2). This walks every route the app registers.
"""
from collections import Counter

from fastapi.routing import APIRoute


def _routes():
    from grc.main import app

    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods or []):
                if method in ("HEAD", "OPTIONS"):
                    continue
                yield method, route.path, route.endpoint


def test_no_two_handlers_answer_the_same_admin_url():
    seen = Counter((method, path) for method, path, _ in _routes() if path.startswith("/admin/"))
    assert [key for key, count in seen.items() if count > 1] == []


def test_ai_usage_overview_is_the_token_dashboard_and_tracing_has_its_own_address():
    by_key = {}
    for method, path, endpoint in _routes():
        by_key.setdefault((method, path), []).append(endpoint)
    token = by_key[("GET", "/admin/ai-usage/overview")]
    assert [fn.__module__ for fn in token] == ["grc.routers.admin_router"]
    tracing = by_key[("GET", "/admin/ai-usage/tracing/overview")]
    assert [fn.__module__ for fn in tracing] == ["grc.routers.admin_ai_usage_router"]


def test_every_route_in_the_app_is_unique_or_the_known_leftovers():
    """The whole app, not only /admin: a duplicate anywhere is a handler that never runs. The leftovers outside Administration that already existed are listed so a NEW
    duplicate fails the test (shrink this list, never grow it)."""
    seen = Counter((method, path) for method, path, _ in _routes())
    duplicated = sorted(key for key, count in seen.items() if count > 1)
    outside_admin = [key for key in duplicated if not key[1].startswith("/admin/")]
    assert outside_admin == sorted(KNOWN_DUPLICATES_OUTSIDE_ADMIN)


KNOWN_DUPLICATES_OUTSIDE_ADMIN: list = [
    # found 2026-11-08 by this test, outside Administration (not this group's to fix): the second handler of each never runs
    ("DELETE", "/governance/regulatory-feeds/sources/{source_id}"),
    ("GET", "/erm/risks/{risk_id}/mitigation-actions"),
    ("POST", "/erm/risks/{risk_id}/mitigation-actions"),
    ("POST", "/governance/regulatory-feeds/sources"),
]
