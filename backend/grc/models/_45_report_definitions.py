from ._43_scorecard_config import *  # noqa: F401,F403 — continue the model chain (Base, Column, Integer, String, DateTime, JSON, ForeignKey, Index, UniqueConstraint, datetime)
from sqlalchemy import Boolean  # not re-exported by the chain


class ReportDefinition(Base):
    """A saved report from the /reports Report Builder.

    The whole builder spec (rows / columns / values / filters / view) is stored
    as open JSON rather than as columns, deliberately: this app has no Alembic,
    so a schema-per-field design would need a migration every time the builder
    gains an option. JSON keeps the builder free to evolve.

    `slug` is the client-generated spec id, so a report keeps its identity when
    it moves from localStorage to the server. Unique per owner — two users may
    each hold a report with the same slug without colliding.

    Visibility: a row is readable by its owner, or by anyone in the tenant when
    `is_shared` is set. Tenant isolation is physical (one DB per tenant), so
    `tenant_id` is recorded for consistency with the other models rather than
    being the thing that enforces separation.
    """
    __tablename__ = "grc_report_definitions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)

    slug = Column(String(64), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    dataset = Column(String(64), nullable=False, index=True)
    spec = Column(JSON, default=dict)

    is_shared = Column(Boolean, default=False, nullable=True, index=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("slug", "created_by", name="uq_report_definition_slug_owner"),
        Index("ix_report_definition_visibility", "created_by", "is_shared"),
    )
