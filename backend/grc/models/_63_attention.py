"""What people have done to the items in an attention queue.

The queue itself is computed from current data every time it is read, so it
cannot go stale. These two tables hold only what a person added on top: who has
an item, whether it is snoozed or closed, and every note along the way. They are
keyed on (condition, record type, record id) rather than on anything
vendor-specific, so another module can put its own conditions in a queue later.
"""
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class AttentionState(Base):
    """One row per item somebody has touched."""
    __tablename__ = "grc_attention_state"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    condition = Column(String(60), nullable=False)
    record_type = Column(String(40), nullable=False)
    record_id = Column(Integer, nullable=False)
    assignee_id = Column(Integer, nullable=True, index=True)
    snoozed_until = Column(Date, nullable=True)            # the item comes back on this day
    snooze_reason = Column(Text, nullable=True)
    # The date that made the item urgent when it was closed. The close holds only
    # while that date stands: if the record becomes urgent again on a new date,
    # the item comes back.
    closed_for = Column(Date, nullable=True)
    updated_by = Column(Integer, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "condition", "record_type", "record_id", name="uq_attention_state_item"),
    )


class AttentionActivity(Base):
    """Append-only: every note, assignment, snooze and close on an item."""
    __tablename__ = "grc_attention_activity"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    condition = Column(String(60), nullable=False)
    record_type = Column(String(40), nullable=False)
    record_id = Column(Integer, nullable=False)
    action = Column(String(12), nullable=False)            # note | assign | snooze | unsnooze | close | reopen
    text = Column(Text, nullable=True)
    assignee_id = Column(Integer, nullable=True)
    actor_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_attention_activity_item", "tenant_id", "condition", "record_type", "record_id"),
    )
