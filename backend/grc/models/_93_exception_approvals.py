"""Who reviews and approves a policy exception (grc/modules/governance/exception_rules.py + exception_approvals.py, DECISIONS D58).

A rule says, for the whole organisation or for a department / sub-department / unit (the unit and everything under it), optionally
only for some priorities or some kinds of policy: the steps an exception goes through and who is asked at each. Submitting an
exception picks the most specific rule and copies its steps into a RUN of that exception (so changing a rule never changes an
exception already waiting); every decision is kept as a row, with who decided at which step. An exception no rule matches
follows the older flow: anyone allowed to approve exceptions decides (policy_exception_router)."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class ExceptionApprovalRule(Base):
    __tablename__ = "grc_exception_approval_rules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    # None: the whole organisation; else a department at any level (it applies to the department and to everything under it)
    department_id = Column(Integer, nullable=True, index=True)
    priorities = Column(JSON, default=list)          # [] = any priority; else some of low | medium | high | critical
    doc_types = Column(JSON, default=list)           # [] = any kind of policy; else document types (policy, standard, ...)
    steps = Column(JSON, default=list)               # exception_rules.validate_steps: [{position, name, kind, order, rule, min_count, due_days, ...}]
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_exc_rule_tenant_dept", "tenant_id", "department_id"),)


class ExceptionApprovalRun(Base):
    """One trip of one exception through a rule: starts when it is submitted, ends when it is approved, rejected, sent back for
    changes or withdrawn. A new submission is a new round."""
    __tablename__ = "grc_exception_approval_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id", ondelete="CASCADE"), nullable=False, index=True)
    round = Column(Integer, nullable=False, default=1)
    rule_id = Column(Integer, nullable=True)         # the rule it came from (it may be changed or deleted since: the steps below are the copy)
    rule_name = Column(String(120), nullable=True)
    department_id = Column(Integer, nullable=True)   # the unit the rule was matched for, and its owners were read from
    steps = Column(JSON, default=list)               # the rule's steps as they were, each with its state and the people it asks
    current_step = Column(Integer, nullable=True)    # position of the step waiting now
    status = Column(String(20), nullable=False, default="open")   # open | approved | rejected | changes_requested | withdrawn
    asked = Column(JSON, default=list)               # user ids who may decide now
    started_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_exc_run_exception_round", "exception_id", "round"),)


class ExceptionApprovalDecision(Base):
    """Who decided what at which step, and when (the audit trail of a run)."""
    __tablename__ = "grc_exception_approval_decisions"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("grc_exception_approval_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id", ondelete="CASCADE"), nullable=False, index=True)
    step_position = Column(Integer, nullable=False)
    step_name = Column(String(120), nullable=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    decision = Column(String(20), nullable=False)    # approve | reject | changes
    comment = Column(Text, nullable=True)
    decided_at = Column(DateTime, default=datetime.utcnow)
