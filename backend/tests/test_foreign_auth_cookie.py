"""Another deployment's auth cookie must not mask this server's session.

Production scopes grc_auth_token to .compliverse.ai, so a server on a sibling
subdomain receives it too, beside its own. Starlette keeps the last duplicate,
and the browser lists the newest last — so signing in to production made the
sibling read a token it cannot verify, and loop on login.
"""
from jose import jwt
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from grc.middleware.subdomain import ForeignAuthCookieFilter
from grc.routers.auth_router import ALGORITHM, create_access_token


def _echo(request):
    return PlainTextResponse(f"{request.cookies.get('grc_auth_token')}|{request.cookies.get('theme')}")


client = TestClient(ForeignAuthCookieFilter(Starlette(routes=[Route("/", _echo)])))
ours = create_access_token({"sub": "admin", "tenant_slug": "acme"})
foreign = jwt.encode({"sub": "admin", "tenant_slug": "cfsb"}, "another-server", algorithm=ALGORITHM)


def seen(cookie):
    return client.get("/", headers={"cookie": cookie}).text


def test_own_cookie_wins_whichever_order_the_browser_sends():
    assert seen(f"grc_auth_token={ours}; theme=dark; grc_auth_token={foreign}") == f"{ours}|dark"
    assert seen(f"grc_auth_token={foreign}; theme=dark; grc_auth_token={ours}") == f"{ours}|dark"


def test_single_or_unverifiable_cookies_pass_through_unchanged():
    assert seen(f"grc_auth_token={foreign}") == f"{foreign}|None"
    assert seen(f"grc_auth_token=a; grc_auth_token={foreign}") == f"{foreign}|None"


def test_filter_is_the_outermost_middleware():
    from grc.main import app

    assert app.user_middleware[0].cls is ForeignAuthCookieFilter
