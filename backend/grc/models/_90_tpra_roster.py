"""Third-party risk: who the workflow asks at each review stage, tenant-wide (vendor_risk/tpra/roster.py).

The workspace roster names the people behind each review role (TPRM lead, security, legal, …). It is not a
permission editor: it decides who is asked and told, and is the default for a supplier's own team seats, which
still win where a supplier has set one. A person holds a role once; a role can have several people.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from ._00_base import Base


class TPRARoster(Base):
    __tablename__ = "grc_tpra_roster"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    role = Column(String(40), nullable=False)            # tprm_lead | tprm_analyst | security | … (tpra/stages.ROSTER_ROLES)
    user_id = Column(Integer, nullable=False, index=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "role", "user_id", name="uq_tpra_roster_member"),)
