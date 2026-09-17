from ._56_scf_catalog_models import *  # noqa: F401,F403

# =============================================================================
# Tenant-authored custom controls — governance profile + cross-module links
# =============================================================================
#
# A custom control is a ``grc_normalized_controls`` row with ``source='custom'``
# (see modules/scf/custom_controls.py). The columns below are the register
# fields the ERM internal-control register carried — category, control type,
# operating frequency, department, dates, approval workflow — kept in their own
# table so the shared control row stays a control and not a register entry.
#
# Links reuse each module's own control-link table wherever one exists
# (risk / asset / evidence / document / policy statement / vulnerability /
# issue) so the other module's page shows the link back. ``ControlRecordLink``
# is only for the record types that have no such table (vendor, IS project,
# critical task, internal control).


class CustomControlProfile(Base):
    """Register fields for a tenant-authored control, one row per control."""
    __tablename__ = "grc_custom_control_profiles"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    normalized_control_id = Column(
        Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True,
    )

    # classification — same vocabulary as the internal-control register
    category = Column(String(100), nullable=True)
    sub_category = Column(String(100), nullable=True)
    control_type = Column(String(50), nullable=True)        # preventive | detective | corrective
    operating_frequency = Column(String(50), nullable=True)  # continuous … ad_hoc

    # accountability
    department_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    backup_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # provenance & dates
    regulatory_source = Column(String(255), nullable=True)
    effective_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)

    # approval workflow: draft → pending_approval → active | rejected; active ↔ inactive
    lifecycle_status = Column(String(30), default="draft", index=True)
    submitted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    decision_comment = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    department = relationship("BusinessUnit", foreign_keys=[department_id])
    backup_owner = relationship("GRCUser", foreign_keys=[backup_owner_id])

    __table_args__ = (
        UniqueConstraint("normalized_control_id", name="uq_custom_control_profile"),
        Index("ix_custom_control_profile_tenant", "tenant_id", "lifecycle_status"),
    )


class ControlRecordLink(Base):
    """A control ↔ record link for record types with no link table of their own.

    ``record_type`` ∈ vendor | project | task | internal_control (see
    modules/scf/record_links.py, which owns the registry). Everything else goes
    into that module's own table.
    """
    __tablename__ = "grc_control_record_links"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    normalized_control_id = Column(
        Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True,
    )
    record_type = Column(String(40), nullable=False, index=True)
    record_id = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "normalized_control_id", "record_type", "record_id",
            name="uq_control_record_link",
        ),
        Index("ix_control_record_link_target", "tenant_id", "record_type", "record_id"),
    )
