"""Test-session defaults.

The platform clock starts with the app and queues real jobs against the master
database. A test that boots the app must not do that, so it is off here; the
clock's own tests drive it directly.
"""
import os

os.environ.setdefault("DISABLE_PLATFORM_CLOCK", "1")
# Tests never reach a real Redis or Celery worker. When the local platform runs (Redis in WSL on 6379 and a worker), a test
# that created a document or started a parse would queue a real job, and the worker would run it against the real tenant
# database with the same slug (many tests use "cfsb"). Port 1 refuses at once, so every job takes the in-process path the
# suite is written for. Set before anything imports grc.config; load_dotenv never overrides a variable already set.
for _name, _db in (("REDIS_URL", 0), ("CELERY_BROKER_URL", 1), ("CELERY_RESULT_BACKEND", 2)):
    os.environ[_name] = f"redis://127.0.0.1:1/{_db}"
os.environ["DISABLE_CELERY_DISPATCH"] = "1"


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _never_the_real_claude(monkeypatch):
    """Tests never reach Claude. Some modules load backend/.env when they are imported (python-dotenv), so a real key can be in
    the environment by the time a test runs; saving a document asks Comply Agent whether the change is major or minor, which
    would then send the test's text out. A test that needs Claude sets a test key and a mocked wire (test_studio_flow.world)."""
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def _never_real_email(monkeypatch):
    """Tests never send email. backend/.env is loaded on import, and the workflow e-mail service falls back to its SMTP_*
    settings when an organisation has none of its own, so a test that raised a notification (a document sent for review, a
    reminder) logged in to the real mailbox and sent mail to the tests' made-up addresses — dozens per run. Tests that check
    e-mail replace `email_service.send_email` themselves."""
    import smtplib

    for key in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"):
        monkeypatch.delenv(key, raising=False)

    def refuse(*args, **kwargs):
        raise ConnectionRefusedError("tests never send email")

    monkeypatch.setattr(smtplib, "SMTP", refuse)
    monkeypatch.setattr(smtplib, "SMTP_SSL", refuse)


@pytest.fixture(autouse=True)
def _no_ai_context_leaks():
    """The data-protection guard looks up the calling tenant before every AI call, so a tenant left in the usage
    context by one test (``bind_request_context``, ``usage_scope``) would make the next test try a real database."""
    yield
    from grc.services import ai_usage

    ai_usage._context.set(ai_usage.AIUsageContext())
    ai_usage._request_holder.set(None)
    ai_usage._attempts.set({})
