"""Third-party risk: what a monitoring signal sets off (vendor_risk/tpra/alert_rules.py).

A rule names the tiers and the kinds of signal it is for (none named: all), the
least severity, and the one thing it does: tell people, plan a to-do, bring the
next reassessment forward, or open one. A tenant's rules run in their position
order, after what every signal always sets off (the alert email and the tier's
reopening threshold), which needs no row here.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String

from ._00_base import Base


class TPRAAlertRule(Base):
    __tablename__ = "grc_tpra_alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    tiers = Column(JSON, nullable=True)                  # critical | high | medium | low; empty is every tier
    signal_kinds = Column(JSON, nullable=True)           # breach, sla, …; empty is every kind
    min_severity = Column(String(20), nullable=False, default="high")
    # notify | create_task | bring_forward_reassessment | open_reassessment
    action = Column(String(40), nullable=False)
    notify_user_ids = Column(JSON, nullable=True)        # who it tells, or the to-do is for
    notify_roles = Column(JSON, nullable=True)           # role names, their holders too
    enabled = Column(Boolean, nullable=False, default=True)
    position = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_tpra_alert_rule_order", "tenant_id", "position"),)
