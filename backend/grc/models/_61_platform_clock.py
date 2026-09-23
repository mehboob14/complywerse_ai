"""When the platform last put each scheduled job on the queue.

This lives in the master database, not in any tenant's: the jobs are
platform-wide sweeps that fan out to tenants themselves. It is declared on its
own metadata so a tenant database's `create_all` never creates it there.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.orm import declarative_base

# Tables that belong to the master catalog only.
MasterBase = declarative_base()


class ScheduledJobRun(MasterBase):
    __tablename__ = "grc_scheduled_job_runs"

    id = Column(Integer, primary_key=True)
    job_key = Column(String(80), nullable=False, index=True)    # the beat_schedule entry name
    task = Column(String(200), nullable=False)                  # the Celery task it queues
    status = Column(String(12), nullable=False, index=True)     # queued | failed
    queued_at = Column(DateTime, default=datetime.utcnow, index=True)
    # A failure that repeats is counted on one row rather than written once a minute.
    attempts = Column(Integer, default=1)
    detail = Column(Text, nullable=True)
    task_id = Column(String(64), nullable=True)
    host = Column(String(120), nullable=True)
    pid = Column(Integer, nullable=True)
