from ._56_scf_catalog_models import *  # noqa: F401,F403

# =============================================================================
# 57. Thomson Reuters / LSEG data-provider integration
# -----------------------------------------------------------------------------
# World-Check One (LSEG) screening, Thomson Reuters CLEAR due-diligence
# enrichment, and Thomson Reuters Regulatory Intelligence feeds.
# See docs/thomson-reuters-integration-plan.md.
#
# ADDITIVE ONLY. New tables auto-create via create_all on every tenant engine.
# Connections live in their OWN table (not grc_integration_connections) so the
# legacy scanner / compliance-plugin surfaces that list every IntegrationConnection
# row never see — or try to run — these providers.
# =============================================================================

# Provider keys (stable identifiers stored in the DB).
TR_PROVIDER_WC1 = "lseg_world_check_one"
TR_PROVIDER_CLEAR = "tr_clear"
TR_PROVIDER_TRRI = "tr_regulatory_intelligence"


class TRProviderConnection(Base):
    """One per (tenant, provider). Per-tenant credentials (decision Q4) stored
    encrypted via services.connector_credentials. `mode` is 'simulated' until the
    tenant has real credentials; simulated data is always labelled as such."""
    __tablename__ = "grc_tr_provider_connections"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    provider = Column(String(60), nullable=False, index=True)
    name = Column(String(200), nullable=True)
    # simulated | live
    mode = Column(String(20), nullable=False, default="simulated")
    base_url = Column(String(500), nullable=True)
    # Fernet token (or dev:: sentinel) of a JSON dict of secrets — never returned by the API.
    encrypted_credentials = Column(Text, nullable=True)
    # Non-secret provider settings (group id, auto-screen toggles, mapping overrides, …).
    config = Column(JSON, default=dict)
    # Cached reference data (WC1 groups / resolution toolkit, OAuth token expiry, cursors).
    cache = Column(JSON, default=dict)
    # not_tested | connected | error
    status = Column(String(20), default="not_tested")
    is_active = Column(Boolean, default=True)
    last_tested_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    consecutive_failures = Column(Integer, default=0)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_tr_provider_connection_tenant_provider"),
    )


class TPRAVendorPerson(Base):
    """Key people of a vendor (directors, UBOs, key contacts) screened alongside
    the organisation (decision Q5). PII kept to what screening needs; DOB and
    nationality optional (decision F)."""
    __tablename__ = "grc_tpra_vendor_people"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    # director | ubo | key_contact | signatory | other
    role = Column(String(30), default="director")
    ownership_pct = Column(Float, nullable=True)
    date_of_birth = Column(String(10), nullable=True)      # YYYY-MM-DD (as WC1 expects)
    nationality = Column(String(3), nullable=True)          # ISO-3166 alpha-3
    country_location = Column(String(3), nullable=True)     # ISO-3166 alpha-3
    gender = Column(String(12), nullable=True)              # MALE | FEMALE | UNSPECIFIED
    include_in_screening = Column(Boolean, default=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_vendor_people_vendor", "vendor_id", "deleted_at"),
    )


class TPRAScreeningSubject(Base):
    """A screened party (the vendor org, or one key person) for one provider.
    Holds the provider case id so re-screens / ongoing screening reuse the case."""
    __tablename__ = "grc_tpra_screening_subjects"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    person_id = Column(Integer, ForeignKey("grc_tpra_vendor_people.id"), nullable=True, index=True)
    provider = Column(String(60), nullable=False, default=TR_PROVIDER_WC1)
    # ORGANISATION | INDIVIDUAL
    entity_type = Column(String(20), nullable=False, default="ORGANISATION")
    submitted_name = Column(String(255), nullable=False)
    secondary_fields = Column(JSON, default=dict)
    external_case_id = Column(String(120), nullable=True, index=True)   # WC1 caseSystemId
    ongoing_screening = Column(Boolean, default=False)
    # not_screened | clear | potential_matches | confirmed_hit | error
    status = Column(String(30), default="not_screened", index=True)
    last_screened_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    simulated = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_screening_subject_vendor", "vendor_id", "provider"),
    )


class TPRAScreeningMatch(Base):
    """One provider result for a subject, with the analyst's resolution and the
    sync-back state to World-Check One (decision Q6)."""
    __tablename__ = "grc_tpra_screening_matches"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("grc_tpra_screening_subjects.id"), nullable=False, index=True)
    external_result_id = Column(String(120), nullable=False)
    reference_id = Column(String(120), nullable=True)        # provider profile id
    matched_name = Column(String(500), nullable=True)
    match_strength = Column(String(20), nullable=True)       # WEAK | MEDIUM | STRONG | EXACT
    provider_type = Column(String(30), nullable=True)        # WATCHLIST | MEDIA_CHECK | …
    categories = Column(JSON, default=list)
    countries = Column(JSON, default=list)
    # sanctions | pep | law_enforcement | adverse_media | other  (our normalisation)
    hit_class = Column(String(30), default="other", index=True)
    # unresolved | positive | possible | false | unspecified
    resolution_status = Column(String(20), default="unresolved", index=True)
    risk_level = Column(String(20), nullable=True)            # high | medium | low | unknown
    reason = Column(String(120), nullable=True)
    remark = Column(Text, nullable=True)
    resolved_by = Column(Integer, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    # not_required | pending | synced | failed
    sync_status = Column(String(20), default="not_required")
    sync_error = Column(Text, nullable=True)
    linked_finding_id = Column(Integer, nullable=True, index=True)
    first_seen_via = Column(String(20), default="screen")    # screen | ongoing
    raw = Column(JSON, default=dict)
    simulated = Column(Boolean, default=False)
    row_version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("subject_id", "external_result_id", name="uq_tpra_screening_match_subject_result"),
        Index("ix_tpra_screening_match_queue", "tenant_id", "resolution_status"),
    )


class TPRAEnrichmentReport(Base):
    """Immutable CLEAR due-diligence report snapshot (decision Q7). Re-running
    creates a new row, so the history is kept."""
    __tablename__ = "grc_tpra_enrichment_reports"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    person_id = Column(Integer, nullable=True)
    provider = Column(String(60), nullable=False, default=TR_PROVIDER_CLEAR)
    external_report_id = Column(String(120), nullable=True)
    candidate_id = Column(String(120), nullable=True)
    entity_name = Column(String(255), nullable=True)
    permissible_purpose = Column(JSON, default=dict)         # {glb, dppa}
    risk_score = Column(Float, nullable=True)
    # [{key, family, label, severity, domain, detail, finding_id?}]
    flags = Column(JSON, default=list)
    summary = Column(JSON, default=dict)
    raw = Column(Text, nullable=True)
    requested_by = Column(Integer, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow)
    simulated = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_enrichment_vendor", "vendor_id", "fetched_at"),
    )
