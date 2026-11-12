"""Who may do what in a department, handed down the tree (grc/services/department_rights.py).

A row gives one principal (a person, or a role: its holders) a level on one department: ``view``, ``edit`` or ``manage``, or
``none`` to stop what a department above gave that principal. A row on a department counts for everything below it, nearest row
wins. Rows only ADD access to what a person already has through their roles and as a head; none takes a global right away.
Departments are never deleted, so a row stays with its department; a deleted role leaves none behind (admin_router.delete_role)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint

from ._00_base import Base


class GRCDepartmentGrant(Base):
    __tablename__ = "grc_department_grants"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id", ondelete="CASCADE"), nullable=False, index=True)
    principal_type = Column(String(10), nullable=False)          # user | role
    principal_id = Column(Integer, nullable=False)               # a grc_users.id or a roles.id, by principal_type (no FK: two tables)
    level = Column(String(10), nullable=False)                   # none | view | edit | manage
    created_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("department_id", "principal_type", "principal_id", name="uq_department_grant"),
        Index("ix_department_grant_principal", "principal_type", "principal_id"),
    )
