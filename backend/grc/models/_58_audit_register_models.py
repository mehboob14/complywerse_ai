"""The bank's audit issue register — its monthly workbook, kept field for field.

Every regulatory, internal-audit, pen-test and self-identified finding lives in
one Excel pack with four column layouts, its own status vocabulary
(NS/IP/DE/PD/EXT/CD), a validation pass/fail step owned by Audit Services, and
aging buckets. ``Issue`` already carries the tracked work — owner, dates,
actions, and links to controls, risks, assets, vulnerabilities and documents —
so a register row becomes an Issue, and this profile holds the register's own
fields beside it. That keeps the shared Issue model unchanged for other tenants
while the register still reads, filters and exports exactly as the client keeps
it today.
"""
from datetime import datetime

from sqlalchemy import (
    Column, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from ._00_base import Base


class AuditRegisterImport(Base):
    """One upload of the register workbook: what it contained and what it changed."""
    __tablename__ = "grc_audit_register_imports"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    file_name = Column(String(255), nullable=True)
    as_of_date = Column(Date, nullable=True)          # the workbook's own "AS OF" date
    status = Column(String(20), default="parsed")     # parsed → applied | failed
    sheet_counts = Column(JSON, default=dict)         # {sheet: rows parsed}
    # The pack's own SUMMARY roll-forward, kept so our computed one can be
    # reconciled against what the client reported that month.
    client_summary = Column(JSON, default=dict)
    summary_month = Column(String(7), nullable=True)   # "April 2026 Issue Summary" → 2026-04
    # {sheet: {status code: the client's definition}}, as each sheet states it.
    status_definitions = Column(JSON, default=dict)
    # {sheet: [header, …]} exactly as the workbook heads each sheet — what the
    # blank template download reproduces.
    sheet_headers = Column(JSON, default=dict)
    created_count = Column(Integer, default=0)
    updated_count = Column(Integer, default=0)
    skipped_count = Column(Integer, default=0)
    # Owner names the file used that matched no platform user, so the import can
    # be applied now and the names resolved afterwards without re-uploading.
    unmatched_owners = Column(JSON, default=list)
    warnings = Column(JSON, default=list)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    applied_at = Column(DateTime, nullable=True)


class AuditIssueProfile(Base):
    """The register's own columns for one Issue, in the client's own words.

    Every column the client writes is Text, so nothing they type is truncated —
    their "Issue Resolution Status Update" runs to 225 characters in a column its
    header suggests holds OPEN or CLOSED. Only our own derived keys are sized.
    """
    __tablename__ = "grc_audit_issue_profiles"
    __table_args__ = (
        UniqueConstraint("issue_id", name="uq_audit_issue_profile_issue"),
        # What identifies a row across monthly files, so re-uploading updates it.
        # The title is part of it because the client's own references repeat:
        # eight findings in one report all carry "Issue # = MRA".
        UniqueConstraint(
            "tenant_id", "source", "record_type", "report_key", "issue_ref", "title_key",
            name="uq_audit_issue_profile_register_key",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    import_id = Column(Integer, ForeignKey("grc_audit_register_imports.id"), nullable=True, index=True)
    source_sheet = Column(String(80), nullable=True)
    source_row = Column(Integer, nullable=True)

    # ── identity in the register ─────────────────────────────────────────────
    record_type = Column(String(20), default="issue")      # issue | recommendation
    source = Column(String(30), nullable=True, index=True)  # regulator | mercadien | ey |
    #                                        self_id | it_pen | credit_review — drives the summary
    regulator = Column(Text, nullable=True)           # OCC, FDIC, …
    report_key = Column(String(255), nullable=True)         # report number, else report name
    report_number = Column(Text, nullable=True)
    report_name = Column(Text, nullable=True)
    report_date = Column(Date, nullable=True)
    engagement_year = Column(Text, nullable=True)
    project_name = Column(Text, nullable=True)       # "Project Name-Year (20XX)"
    issue_ref = Column(String(80), nullable=True)           # "Issue #" / "Issue ID", e.g. MRA-1
    title_key = Column(String(120), nullable=True)          # normalised title, to tell repeats apart
    risk_rating = Column(Text, nullable=True)         # High | Moderate | Medium | Low
    type_of_audit = Column(Text, nullable=True)       # CFSB IA, SELF ID, …
    source_label = Column(Text, nullable=True)       # the file's own Source wording

    # ── the finding, as written ──────────────────────────────────────────────
    issue_text = Column(Text, nullable=True)
    risk_text = Column(Text, nullable=True)
    impact_text = Column(Text, nullable=True)
    causes = Column(Text, nullable=True)
    consequences = Column(Text, nullable=True)
    condition = Column(Text, nullable=True)
    counsel = Column(Text, nullable=True)
    recommendation = Column(Text, nullable=True)
    recommendation_title = Column(Text, nullable=True)
    corrective_actions = Column(Text, nullable=True)
    management_action_plan = Column(Text, nullable=True)
    management_response = Column(Text, nullable=True)

    # ── ownership ────────────────────────────────────────────────────────────
    owner_name_raw = Column(Text, nullable=True)     # kept as written, e.g. "Rivera, P"
    owner_title = Column(Text, nullable=True)
    lob = Column(Text, nullable=True, index=True)
    business_unit = Column(Text, nullable=True)
    executive = Column(Text, nullable=True)          # Self ID sheet

    # ── dates and aging ──────────────────────────────────────────────────────
    target_date = Column(Date, nullable=True)
    revised_target_date = Column(Date, nullable=True)
    extensions_count = Column(Integer, nullable=True)
    days_past_due = Column(Integer, nullable=True)
    aged_days_from_target = Column(Integer, nullable=True)
    aged_status = Column(Text, nullable=True)         # e.g. ">90"
    as_of_date = Column(Date, nullable=True)
    date_received = Column(Date, nullable=True)
    event_date = Column(Date, nullable=True)                # Self ID sheet

    # ── status, and the validation Audit Services owns ───────────────────────
    management_reported_status = Column(Text, nullable=True)
    ia_status = Column(Text, nullable=True, index=True)   # NS | IP | DE | PD | EXT | CD
    resolution_status = Column(Text, nullable=True)       # OPEN | CLOSED
    recommendation_state = Column(Text, nullable=True)    # Closed-Validated, …
    remediation_status = Column(Text, nullable=True)      # NOT STARTED | IN PROGRESS | …
    remediation_type = Column(Text, nullable=True)
    current_internal_status = Column(Text, nullable=True)
    validation_status = Column(Text, nullable=True)       # NOT STARTED | IN PROGRESS | CLOSED
    validation_pass_fail = Column(Text, nullable=True)
    validated_on = Column(Date, nullable=True)                  # "Date of Validation by CFSB IA"
    validation_performed_by = Column(Text, nullable=True)  # EY | CIAO | TBD | NA-CLOSED
    validation_owner = Column(Text, nullable=True)       # the archive layout's second "Owner"
    validation_started_on = Column(Date, nullable=True)
    validation_completed_on = Column(Date, nullable=True)
    validation_materials_source = Column(Text, nullable=True)
    validation_location = Column(Text, nullable=True)
    comments = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    # ── IT findings ──────────────────────────────────────────────────────────
    it_record_kind = Column(Text, nullable=True)      # ISSUE | VULNERABILITY
    affected_hosts = Column(Text, nullable=True)
    location = Column(Text, nullable=True)

    # ── self-identified events ───────────────────────────────────────────────
    self_id_category = Column(Text, nullable=True)    # Fin | Ops | Reg | IT
    monetary_impact = Column(Numeric(18, 2), nullable=True)
    impact_to_client = Column(Text, nullable=True)
    actions_to_address = Column(Text, nullable=True)

    # Fields someone changed in the platform. The monthly import leaves these
    # alone, so an edit made here is not silently undone by next month's file.
    edited_fields = Column(JSON, default=list)

    # Where the finding lives in the rest of the platform. An MRA's Statutory
    # Audit observation goes through AuditObservationIssueLink instead.
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=True)   # Self ID loss event
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)  # the LOB
    regulator_status = Column(Text, nullable=True)     # submitted / accepted / MRA closed by regulator
    last_reminded_on = Column(Date, nullable=True)
    # Deleted from the register, kept as a cancelled issue with its history:
    # later uploads that still carry it leave it out, and it can be restored.
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    issue = relationship("Issue", backref="audit_profile")


class AuditExtensionRequest(Base):
    """A request to move a finding's target date — decided by the Audit Committee.

    It goes on the committee's next meeting as an agenda item; approving it sets
    the revised target date, counts the extension and marks the finding EXT. For
    an MRA the regulator has to be told, and the date that happened is kept.
    """
    __tablename__ = "grc_audit_extension_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    previous_date = Column(Date, nullable=True)
    requested_date = Column(Date, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), default="requested")   # requested → approved | rejected | withdrawn
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=True)
    agenda_item_id = Column(Integer, ForeignKey("grc_meeting_agenda_items.id"), nullable=True)
    decision_notes = Column(Text, nullable=True)
    decided_on = Column(Date, nullable=True)
    decided_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    regulator_notified_on = Column(Date, nullable=True)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AuditRegisterSettings(Base):
    """The register's own settings, one row per tenant: status SLAs and who is
    notified, the dropdown lists, and how new findings are numbered. Stored as
    one JSON document; defaults fill anything not set (audit_register/settings.py)."""
    __tablename__ = "grc_audit_register_settings"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_audit_register_settings_tenant"),)

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    config = Column(JSON, default=dict)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditRegisterReport(Base):
    """An audit report or exam findings belong to — defined once, picked from a
    dropdown when a finding is added. Kept in step with the reports the
    register's findings name; ``report_key`` is how findings refer to it."""
    __tablename__ = "grc_audit_register_reports"
    __table_args__ = (UniqueConstraint("tenant_id", "source", "report_key", name="uq_audit_register_report"),)

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source = Column(String(30), nullable=False)       # regulator | mercadien | ey | it_pen | …
    report_key = Column(String(255), nullable=False)
    source_label = Column(Text, nullable=True)        # the regulator or firm, e.g. OCC, EY
    report_number = Column(Text, nullable=True)
    report_name = Column(Text, nullable=True)
    report_date = Column(Date, nullable=True)
    engagement_year = Column(Text, nullable=True)
    project_name = Column(Text, nullable=True)        # the IT Pen sheet's "Project name-year"
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditRegisterAlias(Base):
    """A name the workbook uses, mapped once to a platform record and used by
    every import after: an owner ("Rivera, P" → a user) or a line of business
    ("BSA/AML" → a business unit)."""
    __tablename__ = "grc_audit_register_aliases"
    __table_args__ = (UniqueConstraint("tenant_id", "kind", "alias_key", name="uq_audit_register_alias"),)

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)          # owner → grc_users | lob → grc_business_units
    alias_key = Column(String(255), nullable=False)    # the name, normalised
    raw_name = Column(Text, nullable=False)            # as the workbook writes it
    target_id = Column(Integer, nullable=False)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
