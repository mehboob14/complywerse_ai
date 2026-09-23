"""Whether an uploaded file actually proves the thing it was attached to.

The Evidence library's own AI assessment answers a different question — which
framework clauses does this file appear to map to — so it cannot say "is this
good enough for THIS assessment item". This holds that verdict: one row per
(evidence, target) pair, written wherever evidence is uploaded or linked, so an
assessor sees what is missing before the item is called done.

`target_kind` + `target_ref` name what the file was judged against without a
foreign key per surface: an assessment item, a framework requirement, a control.
`basis` records whether the requirement's own wording could be used — SCF text
is licence-restricted, so those checks are made against the control's code and
name only, and the verdict says so rather than pretending otherwise.
"""
from datetime import datetime

from sqlalchemy import (
    Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint,
)

from ._00_base import Base


class EvidenceQualityCheck(Base):
    __tablename__ = "grc_evidence_quality_checks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id", ondelete="CASCADE"),
                         nullable=False, index=True)

    # What the file was judged against.
    target_kind = Column(String(40), nullable=False)    # assessment_item | framework_requirement | control | issue | observation
    target_ref = Column(String(120), nullable=False)    # the code a person would recognise
    target_label = Column(String(255), nullable=True)   # its title, for display

    # The verdict.
    covers = Column(String(10), nullable=True)          # full | partial | none
    score = Column(Integer, nullable=True)              # 0-100, how well it proves the target
    confidence = Column(Integer, nullable=True)         # 0-100, the model's own certainty
    verdict = Column(Text, nullable=True)               # one sentence a reviewer can read
    detail = Column(JSON, nullable=True)                # {strengths, gaps, improvements, as_of}

    # How the answer was reached, so a weak check is never mistaken for a strong one.
    basis = Column(String(20), nullable=True)           # requirement_text | identifier_only
    status = Column(String(20), nullable=False, default="ok")  # ok | no_text | licence_restricted | failed
    note = Column(Text, nullable=True)                  # why, when status is not ok

    model_version = Column(String(80), nullable=True)
    prompt_version = Column(String(10), nullable=True)
    content_hash = Column(String(64), nullable=True)    # of the text judged; a new file re-checks
    checked_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "evidence_id", "target_kind", "target_ref",
                         name="uq_evidence_quality_target"),
        Index("ix_evidence_quality_target", "tenant_id", "target_kind", "target_ref"),
    )
