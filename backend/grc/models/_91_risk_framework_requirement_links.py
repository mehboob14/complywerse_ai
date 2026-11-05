"""A risk linked to a control of a framework in the framework library (UAE IA, ISO 27001, ...): the tenant's installed frameworks live in
`grc_uploaded_frameworks` / `grc_parsed_framework_controls`, which the older `grc_risk_framework_control_links` (to the legacy control
catalog) cannot point at. Used by the register's Controls tab (erm/risk_framework_requirements)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from ._00_base import Base


class RiskFrameworkRequirementLink(Base):
    __tablename__ = "grc_risk_framework_requirement_links"

    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    control_code = Column(String(100), nullable=False)               # the control's own id ("M2.3.1"), kept readable if the catalog is re-seeded
    mitigation_effectiveness = Column(String(50), default="partial")  # full, partial, minimal, none (the register's own scale)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    risk = relationship("Risk", back_populates="framework_requirement_links")
    framework = relationship("UploadedFramework")
    control = relationship("ParsedFrameworkControl")

    __table_args__ = (UniqueConstraint("risk_id", "parsed_control_id", name="uq_risk_framework_requirement"),)
