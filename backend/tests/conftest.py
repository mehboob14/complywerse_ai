"""Test-session defaults.

The platform clock starts with the app and queues real jobs against the master
database. A test that boots the app must not do that, so it is off here; the
clock's own tests drive it directly.
"""
import os

os.environ.setdefault("DISABLE_PLATFORM_CLOCK", "1")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _never_the_real_claude(monkeypatch):
    """Tests never reach Claude. Some modules load backend/.env when they are imported (python-dotenv), so a real key can be in
    the environment by the time a test runs; saving a document asks Comply Agent whether the change is major or minor, which
    would then send the test's text out. A test that needs Claude sets a test key and a mocked wire (test_studio_flow.world)."""
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def _no_ai_context_leaks():
    """The data-protection guard looks up the calling tenant before every AI call, so a tenant left in the usage
    context by one test (``bind_request_context``, ``usage_scope``) would make the next test try a real database."""
    yield
    from grc.services import ai_usage

    ai_usage._context.set(ai_usage.AIUsageContext())
    ai_usage._request_holder.set(None)
    ai_usage._attempts.set({})
