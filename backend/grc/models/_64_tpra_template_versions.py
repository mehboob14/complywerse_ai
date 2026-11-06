"""Questionnaire templates as they were sent: frozen, never edited.

A template's questions are a working draft. Sending a questionnaire publishes the
draft as a numbered version — a new one only when the questions changed — and
pins the questionnaire to it, so what the vendor was asked, how the answers score
and which findings they raise stay what they were however the template changes.
"""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from ._00_base import Base


class TPRATemplateVersion(Base):
    __tablename__ = "grc_tpra_template_versions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("grc_vendor_questionnaire_templates.id"), nullable=False, index=True)
    version_no = Column(Integer, nullable=False)
    name = Column(String(255), nullable=True)
    # The questions with everything scoring needs baked in: option scores and
    # the finding each weak answer raises.
    questions = Column(JSON, nullable=False, default=list)
    content_hash = Column(String(64), nullable=False)
    published_by = Column(Integer, nullable=True)
    published_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("template_id", "version_no", name="uq_tpra_template_version"),
    )
