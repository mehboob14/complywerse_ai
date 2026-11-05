"""What happens around an exception once it goes through a rule: the potential risks the reviewers and approvers record, the compensating
controls the implementer records after the approval, and who put which asset on it (DECISIONS D62; ``modules/governance/exception_risks.py``,
``exception_controls.py``, ``exception_assets.py``). The approval itself (rules, runs, decisions) is ``_93_exception_approvals.py``."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class ExceptionRisk(Base):
    """One potential risk recorded by a person asked at a review or approval step: what could go wrong, how likely, how bad, and a note.
    A person who found none says so with a row that has ``none_identified`` set (and no title). Rows are kept for every round."""
    __tablename__ = "grc_exception_risks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id = Column(Integer, nullable=True)                 # the approval run (round) it was recorded in; None: without a rule
    round = Column(Integer, nullable=True)
    step_position = Column(Integer, nullable=True)
    step_name = Column(String(120), nullable=True)
    step_kind = Column(String(20), nullable=True)           # review | approval
    recorded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    title = Column(String(500), nullable=True)              # what could go wrong; empty only when none_identified
    description = Column(Text, nullable=True)               # a note
    likelihood = Column(Integer, nullable=True)             # 1..5
    impact = Column(Integer, nullable=True)                 # 1..5
    score = Column(Integer, nullable=True)                  # likelihood x impact
    rating = Column(String(20), nullable=True)              # low | medium | high | critical: the register's bands for the score
    none_identified = Column(Boolean, default=False)
    register_risk_id = Column(Integer, nullable=True)       # the risk-register entry it is linked to
    source = Column(String(10), default="manual")           # manual | ai (a suggestion the person kept)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_exc_risk_exception_run", "exception_id", "run_id"),)


class ExceptionControl(Base):
    """One compensating control recorded by the implementer: what covers the gap, which potential risks and assets it is for, who owns it,
    by when, whether it is in place, and its evidence (a link, or an item of the Evidence library)."""
    __tablename__ = "grc_exception_controls"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id = Column(Integer, nullable=True)                 # the approved run it implements
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    risk_ids = Column(JSON, default=list)                   # ids of ExceptionRisk rows it covers
    asset_ids = Column(JSON, default=list)                  # ids of assets of the exception's list it protects
    owner_id = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(20), default="planned")          # planned | in_place
    evidence = Column(JSON, default=list)                   # [{kind: link, url, label} | {kind: evidence, evidence_id, label}]
    created_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    source = Column(String(10), default="manual")           # manual | ai
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_exc_control_exception", "exception_id"),)


class ExceptionAssetLink(Base):
    """Who put an asset on an exception's list, and at which stage (the list itself is ``PolicyException.linked_asset_ids``, which the
    posture score and "Move to risk register" read; this keeps who added each and when)."""
    __tablename__ = "grc_exception_asset_links"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(Integer, nullable=False)
    added_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    stage = Column(String(20), default="request")           # request | implementation
    step_name = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("exception_id", "asset_id", name="uq_exc_asset_link"),)
