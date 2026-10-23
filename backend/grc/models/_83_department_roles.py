"""The roles a department takes its members from (grc/services/org_departments.py, DECISIONS D37): everyone who holds one of its
roles belongs to the department. Membership through a role is computed when it is asked, never stored, so a person who gains or
loses the role joins or leaves the department at once."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint

from ._00_base import Base


class GRCDepartmentRole(Base):
    __tablename__ = "grc_department_roles"

    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id", ondelete="CASCADE"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id", ondelete="CASCADE"), nullable=False, index=True)
    # SET NULL: deleting the person who chose the role must not be blocked by it
    added_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("department_id", "role_id", name="uq_department_role"),)
