from ._55_ai_control_proposal_models import *  # noqa: F401,F403

# =============================================================================
# SCF control plane — canonical catalog + per-tenant overlay
# =============================================================================
#
# The Secure Controls Framework becomes the one control library; every framework
# we support is a VIEW over it through grc_scf_mapping. A connector check stops
# naming a SOC 2 criterion and names one SCF control (or assessment objective),
# and each of the 249 crosswalked frameworks inherits that status by join.
#
# Two halves:
#   CATALOG  (grc_scf_release/source/control/mapping/objective/erl/erl_control)
#            — release-versioned, read-only, seeded identically into every tenant
#            DB the way seed_frameworks.py already replicates the framework
#            libraries. Never updated in place: a new SCF release is a new
#            release_id, so an in-flight audit never moves under the auditor.
#   OVERLAY  (grc_scf_scope/control_state/check_result/audit_period)
#            — per tenant. Applicability, designation, evidence and the frozen
#            statement of applicability for an audit period.
#
# The bridge to the rest of the platform is ONE column, added in
# schema_migrations._COLUMN_ADDS: grc_normalized_controls.scf_id. Every table
# already FK'd to grc_normalized_controls (evidence, exceptions, assessments,
# work items, AI proposals) keeps working unchanged.
#
# Joins into the overlay use the TEXT scf_id, never grc_scf_control.id, so a
# release upgrade cannot orphan a tenant's decisions.


# --------------------------------------------------------------------------- #
# Catalog                                                                       #
# --------------------------------------------------------------------------- #

class SCFRelease(Base):
    """One ingested SCF release. `import_status='ready'` is the gate every /scf
    route checks — the app never seeds inline, so a tenant without a ready
    release answers 503 not_provisioned rather than blocking on a 30-90s load."""
    __tablename__ = "grc_scf_release"

    id = Column(Integer, primary_key=True, index=True)
    version = Column(String(16), unique=True, nullable=False, index=True)  # '2026.2'
    generated_at = Column(String(40), nullable=True)   # SCF's own export stamp
    source_url = Column(String(255), nullable=True)
    control_count = Column(Integer, nullable=True)
    is_current = Column(Boolean, default=False, index=True)  # default for NEW scopes only
    imported_at = Column(DateTime, default=datetime.utcnow)
    import_checksum = Column(String(64), nullable=True)
    import_status = Column(String(12), default="importing")  # importing | ready | failed
    delta = Column(JSON, nullable=True)  # vs the previous release: added/retired/renamed/…


class SCFSource(Base):
    """A crosswalk source — one of SCF's ~249 mapped frameworks, or one of ours.
    The only bridge between the SCF catalog and seed_data/frameworks/."""
    __tablename__ = "grc_scf_source"

    id = Column(Integer, primary_key=True, index=True)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    # SCF's verbatim column header, e.g. 'AICPA TSC 2017:2022 (used for SOC 2)'.
    # Kept exactly so a row is traceable back to its STRM sheet.
    source_key = Column(String(160), nullable=False)
    source_slug = Column(String(64), nullable=False)
    display_name = Column(String(160), nullable=True)
    region = Column(String(16), nullable=True)
    is_overlay = Column(Boolean, default=False)      # PCI SAQ, CIS IG1-3, CMMC L1-3, …
    parent_source_slug = Column(String(64), nullable=True)
    # Our framework library this source stands in for (hand-curated once).
    framework_slug = Column(String(64), nullable=True, index=True)
    uploaded_framework_id = Column(Integer, nullable=True)
    # Enforced in the render path, not by policy memory: an 'identifier-only'
    # source may never emit requirement prose from any endpoint.
    license_class = Column(String(20), default="identifier-only")  # open|identifier-only|restricted
    # SCF ships no STRM relationship strength, so SCF-derived numbers are
    # 'indicative' — a source only propagates 'satisfied' when marked 'strict'.
    propagate = Column(String(10), default="indicative")           # strict | indicative
    mapped_control_count = Column(Integer, default=0)
    mapped_requirement_count = Column(Integer, default=0)

    __table_args__ = (
        UniqueConstraint("release_id", "source_key", name="uq_scf_source_release_key"),
        Index("ix_scf_source_release_slug", "release_id", "source_slug"),
    )


class SCFControl(Base):
    """One SCF control. 1,534 per release.

    Never SELECT * from a list endpoint: cmm_levels alone is ~8 MB of prose
    across the table. Project explicit columns or every list view drags TOAST.
    """
    __tablename__ = "grc_scf_control"

    id = Column(Integer, primary_key=True, index=True)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    scf_id = Column(String(16), nullable=False, index=True)        # 'GOV-01', 'IAC-06.2'
    base_scf_id = Column(String(16), nullable=True, index=True)    # 'GOV-01' for 'GOV-01.4'
    sort_key = Column(String(24), nullable=True)                   # zero-padded display order
    domain_identifier = Column(String(8), nullable=True, index=True)
    domain_name = Column(String(255), nullable=True)
    name = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)          # verbatim SCF text
    control_question = Column(Text, nullable=True)     # verbatim SCF text
    weight = Column(Integer, nullable=True, index=True)
    # weight 10 (163 controls). SCF blocks compensating controls on these.
    is_material = Column(Boolean, default=False, index=True)
    pptdf = Column(String(16), nullable=True, index=True)   # People|Process|Technology|Data|Facility
    conformity_cadence = Column(String(16), nullable=True)  # Annual|Semi-Annual|Quarterly
    csf_function = Column(String(16), nullable=True)
    ao_count = Column(Integer, default=0)               # the coverage denominator
    mapped_source_count = Column(Integer, default=0)    # 0 => orphan bucket (107 controls)
    erl_reference = Column(JSON, nullable=True)
    baselines = Column(JSON, nullable=True)             # ['core_fundamentals','esp_1',…]
    solutions = Column(JSON, nullable=True)             # firm-size implementation suggestions
    compensating = Column(JSON, nullable=True)          # alternative controls (index-joined)
    risks = Column(JSON, nullable=True)
    threats = Column(JSON, nullable=True)
    risk_if_not_implemented = Column(Text, nullable=True)
    cmm_levels = Column(JSON, nullable=True)            # large; never in a list projection
    status = Column(String(12), default="active")       # active | retired
    superseded_by = Column(String(16), nullable=True)

    __table_args__ = (
        UniqueConstraint("release_id", "scf_id", name="uq_scf_control_release_scf"),
        Index("ix_scf_control_release_domain", "release_id", "domain_identifier"),
    )


class SCFMapping(Base):
    """The crosswalk: which framework requirement a control discharges.
    ~69,791 SCF rows per release, plus our own resolver/human/AI rows."""
    __tablename__ = "grc_scf_mapping"

    id = Column(Integer, primary_key=True, index=True)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    control_id = Column(Integer, ForeignKey("grc_scf_control.id", ondelete="CASCADE"),
                        nullable=True, index=True)
    # denormalised so the seeder and the check engine work in text space, no join
    scf_id = Column(String(16), nullable=False, index=True)
    source_slug = Column(String(64), nullable=False)
    requirement_code = Column(String(96), nullable=False)
    # OSCAL 1.2 / STRM vocabulary. SCF's JSON ships no strength, so SCF rows are
    # 'intersects-with' and can only ever propagate 'contributes'.
    relationship_type = Column(String(16), default="intersects-with")
    # 'parent' rows (our APO01 matching SCF's APO01.01) are navigation only and
    # are EXCLUDED from every conformance numerator.
    match_mode = Column(String(8), default="exact")
    provenance = Column(String(12), default="scf")      # scf|resolver|human|ai|oss
    provenance_ref = Column(String(160), nullable=True)
    confidence = Column(Numeric(3, 2), default=1.00)
    pivot_via_slug = Column(String(64), nullable=True)  # transitive bridge (max 2 hops)
    # NULL = shipped global row; set = this tenant's own crosswalk. 90% of a graph
    # model's extensibility for one nullable column.
    tenant_id = Column(Integer, nullable=True, index=True)

    __table_args__ = (
        Index("ix_scf_mapping_source_req", "release_id", "source_slug", "requirement_code"),
        Index("ix_scf_mapping_control_source", "scf_id", "source_slug"),
    )


class SCFObjective(Base):
    """Assessment objective — what a check actually asserts against. 5,956/release.

    `rigor` MUST stay a string: 191 rows carry 'NIST 800-171' where an int belongs.
    """
    __tablename__ = "grc_scf_objective"

    id = Column(Integer, primary_key=True, index=True)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    control_id = Column(Integer, ForeignKey("grc_scf_control.id", ondelete="CASCADE"),
                        nullable=True, index=True)
    scf_id = Column(String(16), nullable=False, index=True)
    ao_id = Column(String(24), nullable=False, index=True)   # 'AAT-01_A01'
    seq = Column(Integer, default=0)
    objective = Column(Text, nullable=True)                  # verbatim SCF text
    pptdf = Column(String(16), nullable=True)
    rigor = Column(String(16), nullable=True)
    # newline-separated list of source references (800-53A ids etc.) — routinely
    # far longer than a label, so Text, not String(255)
    origin = Column(Text, nullable=True)
    defined_parameters = Column(Text, nullable=True)         # SDP tailoring field (503 rows)

    __table_args__ = (
        UniqueConstraint("release_id", "ao_id", name="uq_scf_objective_release_ao"),
        Index("ix_scf_objective_control_seq", "control_id", "seq"),
    )


class SCFEvidenceRequest(Base):
    """SCF's Evidence Request List — the manual-evidence taxonomy, and the honest
    denominator for the 57% of the catalog no connector will ever reach."""
    __tablename__ = "grc_scf_erl"

    id = Column(Integer, primary_key=True, index=True)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    erl_id = Column(String(16), nullable=False, index=True)  # 'E-GOV-01'
    number = Column(String(8), nullable=True)
    area_of_focus = Column(String(255), nullable=True)
    artifact = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("release_id", "erl_id", name="uq_scf_erl_release_erl"),
    )


class SCFEvidenceRequestControl(Base):
    """ERL <-> control links (810 per release; the union of both directions)."""
    __tablename__ = "grc_scf_erl_control"

    id = Column(Integer, primary_key=True, index=True)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    erl_id = Column(String(16), nullable=False, index=True)
    scf_id = Column(String(16), nullable=False, index=True)
    control_id = Column(Integer, ForeignKey("grc_scf_control.id", ondelete="CASCADE"),
                        nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("release_id", "erl_id", "scf_id", name="uq_scf_erl_control"),
    )


# --------------------------------------------------------------------------- #
# Tenant overlay                                                                #
# --------------------------------------------------------------------------- #

class SCFScope(Base):
    """A tailoring profile: which frameworks are in scope, and the four answers
    that turn 1,534 controls into an applicable set."""
    __tablename__ = "grc_scf_scope"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    # Pinned per scope so a quarterly SCF import never moves an in-flight audit.
    release_id = Column(Integer, ForeignKey("grc_scf_release.id"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("grc_scf_scope.id"), nullable=True, index=True)
    framework_slugs = Column(JSON, nullable=True)        # ['soc2','iso_27001',…]
    framework_obligations = Column(JSON, nullable=True)  # slug -> 'MCR' | 'DSR'
    baseline_keys = Column(JSON, nullable=True)
    esp_level = Column(Integer, default=0)               # 0-3, strictly nested
    firm_size = Column(Integer, nullable=True)           # 1-9 BLS class
    has_facilities = Column(Boolean, default=True)       # gates 51 Facility controls
    processes_personal_data = Column(Boolean, default=True)  # gates 97 Data controls
    target_cmm = Column(Integer, default=3)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_scf_scope_tenant_name"),
    )


class SCFControlState(Base):
    """Per-scope applicability + designation + ownership for one SCF control.

    Writer-enforced invariants (in the endpoint, not DB triggers):
      1. is_material => alternative_scf_id IS NULL   (SCF blocks this itself)
      2. reviewed_by NOT IN (owner_user_id, requested_by)  — segregation of duties
      3. inheritance_type set => linked_evidence_ids non-empty, else deficient
    """
    __tablename__ = "grc_scf_control_state"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scope_id = Column(Integer, ForeignKey("grc_scf_scope.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    # join on the stable TEXT id so a release upgrade cannot orphan the overlay
    scf_id = Column(String(16), nullable=False, index=True)

    # NULL = inherit the derived answer; TRUE/FALSE = an explicit human decision
    # that survives every recompute.
    is_applicable = Column(Boolean, nullable=True)
    applicability_source = Column(String(12), nullable=True)  # derived|override|inherited|gate|baseline
    applicability_reason = Column(Text, nullable=True)
    obligation = Column(String(4), nullable=True)             # MCR | DSR

    # CDPAS Standard 6.5 vocabulary + our partial/not_assessed
    designation = Column(String(20), default="not_assessed")
    designation_source = Column(String(12), nullable=True)
    coverage_num = Column(Integer, default=0)
    coverage_den = Column(Integer, default=0)
    cmm_actual = Column(Integer, nullable=True)
    cmm_target = Column(Integer, nullable=True)

    owner_user_id = Column(Integer, nullable=True, index=True)
    reviewer_user_id = Column(Integer, nullable=True)
    alternative_scf_id = Column(String(16), nullable=True)
    alternative_justification = Column(Text, nullable=True)
    # shared responsibility — distinct from a compensating control
    provider_vendor_id = Column(Integer, nullable=True)
    inheritance_type = Column(String(10), nullable=True)      # full | shared | customer
    defined_parameters = Column(JSON, nullable=True)          # answers keyed by ao_id
    linked_evidence_ids = Column(JSON, nullable=True)
    # an approved, in-date exception renders "deficient — accepted"; it is still
    # deficient in the conformity denominator
    exception_id = Column(Integer, nullable=True, index=True)

    last_assessed_at = Column(DateTime, nullable=True)
    next_due_at = Column(DateTime, nullable=True, index=True)

    # approval trail, mirroring ClauseApplicability
    status = Column(String(20), default="draft")
    requested_by = Column(Integer, nullable=True)
    requested_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "scope_id", "scf_id", name="uq_scf_state_scope_control"),
        Index("ix_scf_state_scope_designation", "tenant_id", "scope_id", "designation"),
    )


class SCFCheckResult(Base):
    """One assertion by one check against one control/objective, at a point in time.

    Today's per-finding control_codes die inside CompliancePluginRun.evidence_snapshot
    JSON and nothing queries them. This is the append-only record the roll-up and
    every as_of/audit-period query read.
    """
    __tablename__ = "grc_scf_check_result"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scope_id = Column(Integer, ForeignKey("grc_scf_scope.id", ondelete="CASCADE"),
                      nullable=True, index=True)
    run_id = Column(Integer, ForeignKey("grc_compliance_plugin_runs.id", ondelete="SET NULL"),
                    nullable=True, index=True)
    connector = Column(String(64), nullable=False)     # 'github' … or 'manual'
    # what the collector could SEE when it produced this evidence — asked in every
    # cloud audit and unanswerable today, because IntegrationConnection is mutable
    connection_id = Column(Integer, nullable=True)
    credential_fingerprint = Column(String(64), nullable=True)
    granted_scopes = Column(JSON, nullable=True)

    check_id = Column(String(128), nullable=False, index=True)
    scf_id = Column(String(16), nullable=False, index=True)
    ao_id = Column(String(24), nullable=True, index=True)   # NULL = whole-control claim
    method = Column(String(12), default="TEST")             # TEST|EXAMINE|INTERVIEW (800-53A)
    status = Column(String(10), nullable=False)             # pass | fail | error
    severity = Column(String(10), nullable=True)
    resource = Column(String(255), nullable=True)

    # population completeness. truncated=True can NEVER yield 'satisfactory' —
    # the engine pages at MAX_ITEMS, so a 400-repo org tests 300 and reports pass.
    population_size = Column(Integer, nullable=True)
    tested_size = Column(Integer, nullable=True)
    truncated = Column(Boolean, default=False)

    detail = Column(Text, nullable=True)
    evidence_id = Column(Integer, nullable=True)
    collected_at = Column(DateTime, default=datetime.utcnow, index=True)
    # collected_at + the control's conformity_cadence. Past it the result is
    # not_assessed regardless of what it said, so we never report green from a
    # token revoked a year ago.
    expires_at = Column(DateTime, nullable=True, index=True)

    __table_args__ = (
        Index("ix_scf_check_lookup", "tenant_id", "scope_id", "scf_id", "collected_at"),
        Index("ix_scf_check_connector", "tenant_id", "connector", "collected_at"),
    )


class SCFAuditPeriod(Base):
    """The period an opinion covers. Without it the platform can answer 'what is
    the status now' but not 'did this control operate throughout 2026' — which is
    the entire question a SOC 2 Type II, an ISO surveillance audit and a PCI ROC ask.

    Retention pruning must refuse to touch any grc_scf_check_result row whose
    collected_at falls inside an open or fieldwork period.
    """
    __tablename__ = "grc_scf_audit_period"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scope_id = Column(Integer, ForeignKey("grc_scf_scope.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    name = Column(String(255), nullable=False)
    framework_slug = Column(String(64), nullable=True)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    release_id = Column(Integer, ForeignKey("grc_scf_release.id"), nullable=True)
    status = Column(String(12), default="open")     # open | fieldwork | closed
    # the frozen applicability rows at freeze time — the SoA is not live for a
    # period under audit
    soa_snapshot = Column(JSON, nullable=True)
    frozen_at = Column(DateTime, nullable=True)
    frozen_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "scope_id", "name", name="uq_scf_audit_period_name"),
        Index("ix_scf_audit_period_status", "tenant_id", "status"),
    )
