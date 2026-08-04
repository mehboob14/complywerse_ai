"""Password policy + account-lockout helpers.

One file holds:
  * `get_active_password_policy(db)` — load or auto-create the per-tenant
    `PasswordPolicy` row. Defaults are NIST-aligned (min 12 chars, all four
    character classes, 5 attempts → 30 min lock, 30 min idle timeout).
  * `validate_password(plain_password, policy)` — return (ok, reason). Used
    by registration + change-password to enforce complexity.
  * `is_account_locked(user, now)` — check if `locked_until` is in the future.
  * `register_failed_login(user, policy, db)` / `register_successful_login(user, db)`
    — counter bookkeeping. Atomic from the caller's perspective: caller commits.
  * `is_session_idle(user, policy, now)` — true if `last_activity_at` is older
    than the policy's idle-timeout window. Login + me endpoints call this.

Everything is best-effort: a missing or unreadable policy falls back to safe
defaults so authentication never breaks because of policy plumbing.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from ..models import GRCUser, PasswordPolicy


def _lockout_enabled() -> bool:
    """Account lockout is OFF by default — a wrong password returns a clear
    "invalid credentials" error and never locks the account. Set
    ``AUTH_ACCOUNT_LOCKOUT_ENABLED=true`` to re-enable the policy-driven
    failed-attempt lockout (e.g. for production hardening)."""
    return os.environ.get("AUTH_ACCOUNT_LOCKOUT_ENABLED", "false").strip().lower() in (
        "1", "true", "yes", "on",
    )


# Effective policy used when no row exists yet. Mirrors NIST SP 800-63B
# moderate-assurance recommendations.
DEFAULT_POLICY = PasswordPolicy(
    min_length=12,
    require_uppercase=True,
    require_lowercase=True,
    require_digit=True,
    require_special=True,
    lockout_threshold=5,
    lockout_minutes=30,
    session_idle_timeout_minutes=30,
    password_history_count=5,
    max_password_age_days=90,
)


def get_active_password_policy(db: Session) -> PasswordPolicy:
    """Return the policy row for this tenant DB, creating one on first call.

    The table is single-row per tenant DB by convention: callers always read
    via this helper, so we never end up with multiple competing policies.
    """
    try:
        policy = db.query(PasswordPolicy).first()
    except Exception:
        # Table might not exist yet on a tenant DB the migration hasn't run on.
        # Return the in-memory default so login still works.
        return DEFAULT_POLICY
    if policy is not None:
        return policy
    # Auto-provision a row with safe defaults so the admin UI has something
    # to edit. Wrapped in try/except so a write-failure can never block a
    # read-mostly auth flow.
    try:
        policy = PasswordPolicy()  # all server-side defaults from model
        db.add(policy)
        db.commit()
        db.refresh(policy)
        return policy
    except Exception:
        db.rollback()
        return DEFAULT_POLICY


# ---------------------------------------------------------------------------
# Complexity validation
# ---------------------------------------------------------------------------

_SPECIAL_RE = re.compile(r"[^a-zA-Z0-9]")


def validate_password(plain_password: str, policy: PasswordPolicy) -> Tuple[bool, Optional[str]]:
    """Check a plaintext password against policy. Returns (ok, error_message).

    Error message is suitable to return verbatim to the caller — it explains
    *which* rule failed so the user can fix it without guessing.
    """
    if plain_password is None:
        return False, "Password is required."
    pw = plain_password
    if len(pw) < (policy.min_length or 0):
        return False, f"Password must be at least {policy.min_length} characters long."
    if policy.require_uppercase and not any(c.isupper() for c in pw):
        return False, "Password must include at least one uppercase letter."
    if policy.require_lowercase and not any(c.islower() for c in pw):
        return False, "Password must include at least one lowercase letter."
    if policy.require_digit and not any(c.isdigit() for c in pw):
        return False, "Password must include at least one digit."
    if policy.require_special and not _SPECIAL_RE.search(pw):
        return False, "Password must include at least one special character (e.g. !@#$%^&*)."
    return True, None


# ---------------------------------------------------------------------------
# Account lockout
# ---------------------------------------------------------------------------

def is_account_locked(user: GRCUser, now: Optional[datetime] = None) -> bool:
    """True if `locked_until` is set and still in the future.

    Always False when lockout is disabled (the default) so a previously-set
    `locked_until` can never block login — the next successful login clears it.
    """
    if user is None or not _lockout_enabled():
        return False
    locked_until = getattr(user, "locked_until", None)
    if locked_until is None:
        return False
    return (now or datetime.utcnow()) < locked_until


def register_failed_login(user: GRCUser, policy: PasswordPolicy, db: Session) -> None:
    """Bump the failed-login counter and lock if threshold is crossed.

    Caller commits — this helper just mutates the row.
    """
    if user is None:
        return
    current = getattr(user, "failed_login_attempts", 0) or 0
    user.failed_login_attempts = current + 1
    # Only ever lock when lockout is explicitly enabled; otherwise we just keep
    # the counter for visibility and never set `locked_until`.
    if _lockout_enabled() and user.failed_login_attempts >= (policy.lockout_threshold or 5):
        user.locked_until = datetime.utcnow() + timedelta(minutes=policy.lockout_minutes or 30)


def register_successful_login(user: GRCUser, db: Session) -> None:
    """Reset failure counters and bump last_activity_at on a successful login.

    Caller commits.
    """
    if user is None:
        return
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_activity_at = datetime.utcnow()


# ---------------------------------------------------------------------------
# Inactive session timeout
# ---------------------------------------------------------------------------

def is_session_idle(user: GRCUser, policy: PasswordPolicy, now: Optional[datetime] = None) -> bool:
    """True if the user's last_activity_at is older than the policy's idle window.

    A NULL `last_activity_at` is treated as "never seen" → NOT idle, so we
    don't lock out users who were created before this migration ran.
    """
    if user is None or policy is None:
        return False
    last = getattr(user, "last_activity_at", None)
    if last is None:
        return False
    window_minutes = policy.session_idle_timeout_minutes or 30
    return ((now or datetime.utcnow()) - last) > timedelta(minutes=window_minutes)


def touch_last_activity(user: GRCUser, db: Session, commit: bool = False) -> None:
    """Bump `last_activity_at` to now. Cheap — single column update.

    Called by `require_auth` on every authenticated request. `commit=False`
    by default so we don't add per-request commit overhead; the next natural
    write in the request flushes it. Pass `commit=True` from explicit endpoints
    that want the timestamp to stick even on a read-only request.
    """
    if user is None:
        return
    user.last_activity_at = datetime.utcnow()
    if commit:
        try:
            db.commit()
        except Exception:
            db.rollback()
