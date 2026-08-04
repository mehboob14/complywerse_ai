"""Tenant-local AI provider usage ledger.

The product uses one database per tenant, so these events deliberately live in
the tenant database.  No prompts, responses, evidence text, or credentials are
stored here.
"""

from ._00_base import *  # noqa: F401,F403


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id = Column(Integer, primary_key=True)
    request_id = Column(String(64), nullable=True, index=True)
    operation_id = Column(String(64), nullable=True, index=True)
    background_job_id = Column(String(128), nullable=True, index=True)

    actor_user_id = Column(Integer, nullable=True, index=True)
    actor_username = Column(String(150), nullable=True, index=True)
    actor_type = Column(String(30), nullable=False, default="user")

    module_key = Column(String(100), nullable=False, index=True)
    feature_key = Column(String(150), nullable=False, index=True)
    attribution_source = Column(String(30), nullable=False, default="callsite")
    endpoint = Column(String(500), nullable=True)
    http_method = Column(String(10), nullable=True)

    provider = Column(String(50), nullable=False, default="openai")
    api_family = Column(String(50), nullable=False, default="chat_completions")
    requested_model = Column(String(150), nullable=True, index=True)
    response_model = Column(String(150), nullable=True)
    provider_request_id = Column(String(150), nullable=True)

    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0)
    cached_tokens = Column(Integer, nullable=False, default=0)
    reasoning_tokens = Column(Integer, nullable=False, default=0)

    estimated_cost = Column(Numeric(18, 8), nullable=True)
    currency = Column(String(3), nullable=False, default="USD")
    pricing_version = Column(String(80), nullable=True)

    status = Column(String(30), nullable=False, default="success", index=True)
    error_type = Column(String(150), nullable=True)
    duration_ms = Column(Integer, nullable=False, default=0)
    attempt_number = Column(Integer, nullable=False, default=1)
    usage_metadata = Column(JSON, nullable=False, default=dict)
    occurred_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_ai_usage_occurred_module", "occurred_at", "module_key"),
        Index("ix_ai_usage_actor_occurred", "actor_username", "occurred_at"),
        Index("ix_ai_usage_operation_attempt", "operation_id", "attempt_number"),
    )

