"""Software people use that no one has assessed (vendor_risk/tpra/shadow_saas.py).

One row per app, from a discovery export, a SaaS-discovery feed, or our own
records. It is decided once — onboarded as a supplier request, denied (and
optionally blocked at the web gateway), or dismissed as noise — and the
decision, with who made it and why, stays on the row.
"""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text

from ._00_base import Base


class TPRAShadowApp(Base):
    __tablename__ = "grc_tpra_shadow_apps"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), nullable=True, index=True)
    category = Column(String(120), nullable=True)
    description = Column(Text, nullable=True)
    users = Column(Integer, nullable=True)
    owner_name = Column(String(255), nullable=True)       # the business owner, as the source names them
    owner_email = Column(String(255), nullable=True)
    source = Column(String(40), nullable=False, default="csv")   # csv | grip
    external_id = Column(String(120), nullable=True)      # the source's own id
    source_risk = Column(Integer, nullable=True)          # the source's own 0..100 risk, if it gives one
    facts = Column(JSON, nullable=True)                   # mfa, sso, file sharing, uploads, breaches, OAuth, AI
    risk = Column(Integer, nullable=True)                 # our 0..100 score from those facts
    status = Column(String(20), nullable=False, default="pending")  # pending | onboarded | denied | dismissed
    vendor_id = Column(Integer, nullable=True)            # the supplier request it became
    decided_by = Column(Integer, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_note = Column(Text, nullable=True)
    blocked = Column(Boolean, nullable=False, default=False)   # on the web gateway's block list
    blocked_at = Column(DateTime, nullable=True)
    first_seen = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (Index("ix_tpra_shadow_apps_tenant", "tenant_id", "status"),)
