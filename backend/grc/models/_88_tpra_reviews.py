"""Third-party risk: who reviews which part of a supplier's answers (vendor_risk/tpra/reviews.py).

An assignment names a person to review one section of a questionnaire (the
questions that share a section, else a risk domain), or the whole of it when
section_key is empty. Several people may share a section. It is assigned, in
review once its reviewer opens it, then done, which takes a decision on every
question of the section that applies; accepting the questionnaire waits for
every assignment, and planning counts the people assigned among its reviewers.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from ._00_base import Base


class TPRAReviewAssignment(Base):
    __tablename__ = "grc_tpra_review_assignments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    # The questionnaire's assessment, when it has one (kept in step when it is linked later).
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=True, index=True)
    questionnaire_response_id = Column(Integer, ForeignKey("grc_vendor_questionnaire_responses.id"),
                                       nullable=True, index=True)
    section_key = Column(String(100), nullable=True)                  # none: the whole questionnaire
    reviewer_id = Column(Integer, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="assigned")   # assigned | in_review | done
    note = Column(Text, nullable=True)                                # what the reviewer is asked to look at
    assigned_by = Column(Integer, nullable=True)
    assigned_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    done_at = Column(DateTime, nullable=True)
