"""What an organisation calls the levels of its department tree (grc/services/org_departments.py, DECISIONS D57).

A department can sit under another, three levels deep at most. The first level is a "Department", the second a "Sub-department",
the third a "Unit" until the organisation names them otherwise. A level with no row here has its default name, so a tenant that
never touches this behaves as before."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from ._00_base import Base


class GRCDepartmentLevel(Base):
    __tablename__ = "grc_department_levels"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    level = Column(Integer, nullable=False)                      # 1 (top) to 3
    label = Column(String(40), nullable=False)
    updated_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "level", name="uq_department_level"),)
