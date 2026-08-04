"""Tenant-local AI token budget & quota configuration.

Drives the Token-usage dashboard's budget widgets (org monthly quota, per-module
budgets, alert banner, utilization, month-end projection). One-database-per-tenant,
so these live in the tenant database alongside the usage ledger.
"""

from sqlalchemy import BigInteger

from ._00_base import *  # noqa: F401,F403


# Sensible defaults so a brand-new tenant renders a coherent page before an admin
# has configured anything. 60M tokens/month at a blended $4.50 / 1M is the
# design's reference org.
DEFAULT_MONTHLY_QUOTA = 60_000_000
DEFAULT_BLENDED_RATE = 4.50  # USD per 1M tokens
DEFAULT_BILLING_CYCLE_DAY = 1  # cycle = Nth of month → today


class AITokenBudgetConfig(Base):
    """Singleton per tenant: org-wide quota, blended rate, billing cycle anchor."""

    __tablename__ = "ai_token_budget_config"

    id = Column(Integer, primary_key=True)
    monthly_quota = Column(BigInteger, nullable=False, default=DEFAULT_MONTHLY_QUOTA)
    blended_rate_per_million = Column(Numeric(10, 4), nullable=False, default=DEFAULT_BLENDED_RATE)
    billing_cycle_day = Column(Integer, nullable=False, default=DEFAULT_BILLING_CYCLE_DAY)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String(150), nullable=True)


class AIModuleBudget(Base):
    """Per-module monthly token budget (keyed by the usage ledger's module_key)."""

    __tablename__ = "ai_module_budgets"

    id = Column(Integer, primary_key=True)
    module_key = Column(String(100), nullable=False, unique=True, index=True)
    monthly_budget = Column(BigInteger, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String(150), nullable=True)
