"""Scheduled & emailed reports - one additive, tenant-scoped table.

  grc_scheduled_reports   one row per schedule: WHAT to run (a saved report
                          definition from the Report Builder, or an inline
                          dataset + columns + filters), HOW OFTEN, to WHOM, and
                          in WHICH file format.

The table is brand new, so Base.metadata.create_all creates it on every tenant DB
when the tenant engine is first opened (grc.db._init_tenant_schema) - NO Alembic,
NO per-tenant column ALTER. Importing this module (main.py imports the router)
registers the class on Base.metadata. service.ensure_table() adds a checkfirst
create for tenant engines that were opened before the class was imported.

Source of the report (exactly one is set):
  * saved_report_id   -> grc_report_definitions.id; resolved FRESH on every run, so
                         editing the saved report changes what the schedule sends.
                         (No FK constraint on purpose: deleting the saved report must
                         not be blocked by, or cascade into, a schedule - the next run
                         just records a clear error.)
  * dataset + columns + filters + logic -> an inline definition owned by the schedule.

Timing: `start_at` is the ANCHOR (first intended run; fixes time-of-day / weekday /
day-of-month). `next_run` is the next due instant, always derived from the anchor so
monthly schedules never drift. All datetimes are naive UTC (the codebase convention).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, JSON, String, Text

from grc.models import Base


class ScheduledReport(Base):
    __tablename__ = "grc_scheduled_reports"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    name = Column(String(200), nullable=False)

    # --- what to run ------------------------------------------------------------
    saved_report_id = Column(Integer, nullable=True, index=True)   # -> grc_report_definitions.id
    saved_report_slug = Column(String(64), nullable=True)          # display cache of the link
    dataset = Column(String(64), nullable=True)                    # inline dataset (cache for saved)
    columns = Column(JSON, nullable=False, default=list)           # inline: [] = every column
    filters = Column(JSON, nullable=False, default=list)           # inline: [{col, op, value}]
    logic = Column(String(3), nullable=False, default="AND")       # inline: AND | OR

    # --- when / to whom / in what -----------------------------------------------
    frequency = Column(String(10), nullable=False, default="weekly")   # daily | weekly | monthly
    recipients = Column(JSON, nullable=False, default=list)            # ["a@b.com", ...]
    format = Column(String(8), nullable=False, default="xlsx")         # csv | xlsx | pdf
    message = Column(Text, nullable=True)                              # optional note in the email body

    start_at = Column(DateTime, nullable=False)                    # anchor (UTC)
    next_run = Column(DateTime, nullable=True)                     # next due (UTC); NULL while paused
    active = Column(Boolean, nullable=False, default=True)

    # --- ownership: a run executes with THIS user's permissions ------------------
    created_by = Column(Integer, nullable=True, index=True)        # grc_users.id (no FK, see above)
    created_by_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # --- last outcome ------------------------------------------------------------
    last_run_at = Column(DateTime, nullable=True)
    last_status = Column(String(12), nullable=True)                # sent | error
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_sched_report_due", "active", "next_run"),
    )
