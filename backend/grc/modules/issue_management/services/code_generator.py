"""Tenant-scoped issue code generator.

Returns the next `ISS-NNNN` code for a tenant by counting existing rows
and adding 1. Race-condition safety isn't critical here because the
backend retries on UNIQUE constraint failure (the index on `code` is
non-unique at the schema level — uniqueness comes from the sequence).
"""
from sqlalchemy.orm import Session
from sqlalchemy import func

from ....models import Issue


def next_issue_code(tenant_id: int, db: Session) -> str:
    count = db.query(func.count(Issue.id)).filter(Issue.tenant_id == tenant_id).scalar() or 0
    return f"ISS-{count + 1:04d}"
