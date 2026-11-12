"""A Risk Library risk proposed to a risk owner for one unit (erm/routers/risk_library.py).

The risk team proposes it (proposed), the owner confirms it applies and drafts the inherent score, which makes a Draft register
risk (drafted), or declines with a reason (declined); someone other than the person who drafted it accepts it into the register,
Draft -> Open (accepted), or returns it with comments (returned) for the owner to draft again."""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ._00_base import Base


class RiskLibraryProposal(Base):
    __tablename__ = "grc_risk_library_proposals"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    library_item_id = Column(String(100), nullable=False, index=True)        # the library risk ("uae_ia:M2.3:03")
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    proposed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    proposed_at = Column(DateTime, default=datetime.utcnow)
    note = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="proposed")          # proposed | drafted | returned | declined | accepted
    control_codes = Column(JSON, nullable=True)                               # the item's controls to link on acceptance; null = all
    risk_id = Column(Integer, ForeignKey("grc_risks.id", ondelete="SET NULL"), nullable=True, index=True)   # the draft risk
    drafted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)   # the maker: cannot accept it
    drafted_at = Column(DateTime, nullable=True)
    decline_reason = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_comment = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    risk = relationship("Risk")
    business_unit = relationship("BusinessUnit")
