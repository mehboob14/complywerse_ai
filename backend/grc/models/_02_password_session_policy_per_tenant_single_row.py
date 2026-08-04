from ._01_multi_tenancy_models import *  # noqa: F401,F403

# =============================================================================
# 1b. Password / session policy (per-tenant, single row)
# =============================================================================
# One row per tenant DB holds the active password complexity rules, account
# lockout thresholds, and inactive-session timeout. The admin "Password
# Policy" page reads + writes this row. The login handler reads it via
# `get_active_password_policy(db)` to enforce complexity on registration /
# change-password and to gate lockout on failed login.

class PasswordPolicy(Base):
    __tablename__ = "grc_password_policies"

    id = Column(Integer, primary_key=True, index=True)
    # Complexity
    min_length = Column(Integer, default=12, nullable=False)
    require_uppercase = Column(Boolean, default=True, nullable=False)
    require_lowercase = Column(Boolean, default=True, nullable=False)
    require_digit = Column(Boolean, default=True, nullable=False)
    require_special = Column(Boolean, default=True, nullable=False)
    # Account lockout
    lockout_threshold = Column(Integer, default=5, nullable=False)   # failed attempts before lock
    lockout_minutes = Column(Integer, default=30, nullable=False)    # how long to lock for
    # Inactive session timeout — used by the login handler to refuse very old
    # tokens whose user hasn't touched the API in this long.
    session_idle_timeout_minutes = Column(Integer, default=30, nullable=False)
    # Password reuse + age (informational for now; enforcement is opt-in)
    password_history_count = Column(Integer, default=5, nullable=False)
    max_password_age_days = Column(Integer, default=90, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

