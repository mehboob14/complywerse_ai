from ._61_helpdesk_mail_models import *  # noqa: F401,F403 — pulls Base, Column types, datetime, Index, ForeignKey, relationship, text, JSON via the section chain

# =============================================================================
# AVA-native Help Desk — ITSM foundation layer (Excel workbook ingest)
# =============================================================================
#
# Source of truth: the owner's 34-sheet ITIL-4 ITSM workbook
# (AVA_ServiceDesk_ITSM_enriched_v*.xlsx). The workbook is the AUTHORING tool;
# it is exported to a versioned JSON bundle and ingested here by a per-tenant,
# idempotent importer that upserts by the workbook's own IDs.
#
# This module is PURELY ADDITIVE to the converted Frappe engine in
# _60_helpdesk_native_models.py. It adds the layers that engine lacks:
#   * Service catalogue   — categories, business services, technical services,
#                           and the MANY-TO-MANY dependency bridge between them
#                           (the chain a single "Supports Business Service Id"
#                           column could never express), plus request items.
#   * CMDB                — CI types, their attribute definitions, the CIs
#                           themselves (each optionally linked to an ComplyVerse
#                           discovered IT asset), and the typed CI relationship
#                           graph (also many-to-many).
#   * Governance          — the impact x urgency -> P1..P5 priority matrix, the
#                           data-driven state-transition table (the workbook's
#                           "Allowed Next" rules, so the server rejects illegal
#                           jumps), change types + risk matrix, and ONE approval
#                           engine (request approvals AND CAB votes with quorum).
#   * Provenance / mapping— the import batch each row came from, the GRP-* ->
#                           ComplyVerse team map, and the ROLE-* -> RBAC preset map.
#
# Conventions (mirror _60_helpdesk_native_models.py exactly):
#   * Table name = "grc_hd_<name>".
#   * Surrogate  = id (Integer PK).
#   * Tenancy    = tenant_id FK on every top-level table; child/bridge tables are
#                  scoped through their parent and carry no tenant_id.
#   * code       = the workbook's own identifier (CAT-xx / SVC-00xx / SVC-Txxx /
#                  REQ-xxx / CIT-xx / CI-xxx / REL-xx / GRP-xx / ROLE-xx), UNIQUE
#                  per tenant. The importer upserts on (tenant_id, code), so a
#                  re-import of the same bundle is a no-op, and a changed row
#                  updates in place.
#   * source_batch_id -> grc_hd_import_batch.id: which ingest wrote/last-touched
#                  the row (provenance; lets an import be audited or rolled back).
#   * created_at/updated_at timestamps on every table.
#   * FKs to existing tables: grc_tenants, grc_teams (ComplyVerse Administration team),
#     grc_hd_ticket_template, grc_hd_ticket_priority, grc_hd_ticket_status,
#     grc_hd_ticket.


# ----------------------------------------------------------------------------
# PROVENANCE — one row per ingest of a JSON bundle
# ----------------------------------------------------------------------------
class HDImportBatch(Base):
    __tablename__ = "grc_hd_import_batch"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    bundle_version = Column(String(60), nullable=False)    # semantic/date version stamped by the exporter
    source_filename = Column(String(255), nullable=True)   # e.g. AVA_ServiceDesk_ITSM_enriched_v3.xlsx
    checksum = Column(String(64), nullable=True)            # sha256 of the JSON bundle — detects re-ingest of same bytes
    status = Column(String(20), nullable=False, server_default="pending")  # pending|applied|failed
    summary = Column(JSON, nullable=True)                  # per-entity upsert/insert/skip counts + any warnings
    error = Column(Text, nullable=True)                    # populated when status=failed (e.g. dangling refs)
    imported_by = Column(String(255), nullable=True)       # acting user email
    imported_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_hd_import_batch_tenant_ver", "tenant_id", "bundle_version"),
    )


# ----------------------------------------------------------------------------
# SERVICE CATALOGUE
# ----------------------------------------------------------------------------
class HDServiceCategory(Base):
    """Workbook sheet 01 — Service Categories (CAT-xx). Self-nesting tree."""
    __tablename__ = "grc_hd_service_category"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # CAT-COLLAB, CAT-NET, ...
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("grc_hd_service_category.id"), nullable=True)
    icon = Column(String(40), nullable=True)
    sort_order = Column(Integer, nullable=True)
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("HDServiceCategory", remote_side=[id])

    __table_args__ = (
        Index("uq_hd_service_category_code", "tenant_id", "code", unique=True),
    )


class HDBusinessService(Base):
    """Workbook sheet 02 — Business Service Catalogue (SVC-00xx). What the
    business consumes (e.g. 'Corporate Email')."""
    __tablename__ = "grc_hd_business_service"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # SVC-0004, ...
    name = Column(String(200), nullable=False)
    category_id = Column(Integer, ForeignKey("grc_hd_service_category.id"), nullable=True, index=True)
    description = Column(Text, nullable=True)
    criticality = Column(String(20), nullable=True)        # Tier 1..4 / Critical..Low
    service_owner_role = Column(String(60), nullable=True) # ROLE-* code (resolved via HDRoleMap for RACI)
    industry_tag = Column(String(60), nullable=True)       # banking / fintech / aviation / manufacturing / ...
    status = Column(String(20), nullable=True, server_default="active")  # active | retired | pipeline
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    category = relationship("HDServiceCategory")

    __table_args__ = (
        Index("uq_hd_business_service_code", "tenant_id", "code", unique=True),
    )


class HDTechnicalService(Base):
    """Workbook sheet 03 — Technical / Supporting Services (SVC-Txxx). The
    underlying capability (Mail Transport, Directory/Identity, LAN Switching...)
    that one or MANY business services depend on."""
    __tablename__ = "grc_hd_technical_service"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # SVC-T004, ...
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    owner_team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)  # ComplyVerse Administration team
    status = Column(String(20), nullable=True, server_default="active")
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_technical_service_code", "tenant_id", "code", unique=True),
    )


class HDServiceDependency(Base):
    """MANY-TO-MANY bridge: which technical services support which business
    services. The workbook authors this as a comma-separated 'Supports Business
    Service Id' cell; the importer explodes it into one row per pair. THIS is the
    fix for 'email shows only one supporting service' — a business service can
    now have many, and a technical service can underpin many."""
    __tablename__ = "grc_hd_service_dependency"

    id = Column(Integer, primary_key=True)
    business_service_id = Column(Integer, ForeignKey("grc_hd_business_service.id", ondelete="CASCADE"),
                                 nullable=False, index=True)
    technical_service_id = Column(Integer, ForeignKey("grc_hd_technical_service.id", ondelete="CASCADE"),
                                  nullable=False, index=True)
    criticality = Column(String(20), nullable=True)        # how critical this dependency is to the business service

    created_at = Column(DateTime, default=datetime.utcnow)

    business_service = relationship("HDBusinessService", backref="dependencies")
    technical_service = relationship("HDTechnicalService")

    __table_args__ = (
        Index("uq_hd_service_dependency_pair", "business_service_id", "technical_service_id", unique=True),
    )


class HDRequestItem(Base):
    """Workbook sheet 04 — Request Catalogue (REQ-xxx). A concrete thing an end
    user can request against a business service (New Mailbox, Distribution List,
    VPN Access...). Optionally backed by an HDTicketTemplate for its intake form."""
    __tablename__ = "grc_hd_request_item"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # REQ-012, ...
    name = Column(String(200), nullable=False)
    business_service_id = Column(Integer, ForeignKey("grc_hd_business_service.id"), nullable=True, index=True)
    category_id = Column(Integer, ForeignKey("grc_hd_service_category.id"), nullable=True)
    ci_type_id = Column(Integer, ForeignKey("grc_hd_ci_type.id"), nullable=True, index=True)  # kind of asset this request concerns
    description = Column(Text, nullable=True)
    approval_required = Column(Boolean, server_default=text("false"))
    approver_role = Column(String(60), nullable=True)      # ROLE-* code (resolved via HDRoleMap)
    fulfilment_team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)  # ComplyVerse Administration team
    sla_hours = Column(Float, nullable=True)               # target fulfilment time
    cost = Column(Float, nullable=True)
    template_id = Column(Integer, ForeignKey("grc_hd_ticket_template.id"), nullable=True)  # intake form
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    business_service = relationship("HDBusinessService")
    category = relationship("HDServiceCategory")
    ci_type = relationship("HDCIType")

    __table_args__ = (
        Index("uq_hd_request_item_code", "tenant_id", "code", unique=True),
    )


# ----------------------------------------------------------------------------
# CMDB
# ----------------------------------------------------------------------------
class HDCIType(Base):
    """Workbook sheet 09 — CI Types (CIT-xx). Self-nesting classification."""
    __tablename__ = "grc_hd_ci_type"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # CIT-SRV, CIT-APP, ...
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("grc_hd_ci_type.id"), nullable=True)
    icon = Column(String(40), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("HDCIType", remote_side=[id])

    __table_args__ = (
        Index("uq_hd_ci_type_code", "tenant_id", "code", unique=True),
    )


class HDCIAttribute(Base):
    """Workbook sheet 10 — CI Attributes. Per-CI-type attribute definitions
    (the schema a CI of this type carries, stored on the CI as JSON)."""
    __tablename__ = "grc_hd_ci_attribute"

    id = Column(Integer, primary_key=True)
    ci_type_id = Column(Integer, ForeignKey("grc_hd_ci_type.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    idx = Column(Integer, nullable=True)                   # display order within the type

    name = Column(String(140), nullable=False)             # attribute key (e.g. "OS Version")
    datatype = Column(String(20), nullable=True, server_default="string")  # string|int|float|bool|date|enum
    required = Column(Boolean, server_default=text("false"))
    options = Column(JSON, nullable=True)                  # enum choices when datatype=enum

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ci_type = relationship("HDCIType", backref="attributes")

    __table_args__ = (
        Index("uq_hd_ci_attribute_name", "ci_type_id", "name", unique=True),
    )


class HDConfigurationItem(Base):
    """Workbook sheet 12 — Sample CIs (CI-xxx). A configuration item. Optionally
    linked to an ComplyVerse discovered IT asset (ava_asset_id), so the CMDB reuses asset
    discovery instead of being a second, drifting inventory."""
    __tablename__ = "grc_hd_ci"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # CI-0007, ...
    name = Column(String(200), nullable=False)
    ci_type_id = Column(Integer, ForeignKey("grc_hd_ci_type.id"), nullable=True, index=True)
    business_service_id = Column(Integer, ForeignKey("grc_hd_business_service.id"), nullable=True, index=True)
    status = Column(String(20), nullable=True, server_default="in_use")  # in_use|retired|in_stock|...
    criticality = Column(String(20), nullable=True)
    environment = Column(String(20), nullable=True)        # prod | staging | dev | dr
    owner = Column(String(255), nullable=True)             # owning user/team email
    ava_asset_id = Column(Integer, nullable=True, index=True)  # soft link to ComplyVerse discovered IT asset (no cross-module FK)
    attributes = Column(JSON, nullable=True)               # values keyed by HDCIAttribute.name

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ci_type = relationship("HDCIType")
    business_service = relationship("HDBusinessService")

    __table_args__ = (
        Index("uq_hd_ci_code", "tenant_id", "code", unique=True),
    )


class HDCIRelationshipType(Base):
    """Workbook sheet 11 — Relationship Types (REL-xx). e.g. 'Depends On' with
    inverse 'Supports'; 'Runs On' / 'Hosts'."""
    __tablename__ = "grc_hd_ci_relationship_type"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # REL-DEP, REL-RUN, ...
    name = Column(String(140), nullable=False)             # forward label ("Depends On")
    inverse_name = Column(String(140), nullable=True)      # reverse label ("Supports")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_ci_rel_type_code", "tenant_id", "code", unique=True),
    )


class HDCIRelationship(Base):
    """Workbook sheet 13 — Sample Relationships. MANY-TO-MANY typed edges between
    CIs — the CMDB graph that the React Flow map renders (@xyflow/react, already
    in package.json)."""
    __tablename__ = "grc_hd_ci_relationship"

    id = Column(Integer, primary_key=True)
    source_ci_id = Column(Integer, ForeignKey("grc_hd_ci.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    target_ci_id = Column(Integer, ForeignKey("grc_hd_ci.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    rel_type_id = Column(Integer, ForeignKey("grc_hd_ci_relationship_type.id"), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    source_ci = relationship("HDConfigurationItem", foreign_keys=[source_ci_id], backref="out_relationships")
    target_ci = relationship("HDConfigurationItem", foreign_keys=[target_ci_id], backref="in_relationships")
    rel_type = relationship("HDCIRelationshipType")

    __table_args__ = (
        Index("uq_hd_ci_relationship", "source_ci_id", "target_ci_id", "rel_type_id", unique=True),
    )


# ----------------------------------------------------------------------------
# GOVERNANCE — priority matrix, state machine, change control, approvals
# ----------------------------------------------------------------------------
class HDPriorityMatrix(Base):
    """Workbook sheet 07 — Priority Matrix. impact x urgency -> priority. The
    create-ticket path computes priority_id from the ticket's impact+urgency
    server-side (the user never picks P1 directly)."""
    __tablename__ = "grc_hd_priority_matrix"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    impact = Column(String(20), nullable=False)            # e.g. high | medium | low  (or Enterprise..Individual)
    urgency = Column(String(20), nullable=False)           # e.g. high | medium | low
    priority_id = Column(Integer, ForeignKey("grc_hd_ticket_priority.id"), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    priority = relationship("HDTicketPriority")

    __table_args__ = (
        Index("uq_hd_priority_matrix_cell", "tenant_id", "impact", "urgency", unique=True),
    )


class HDStateTransition(Base):
    """Workbook sheets 14/18/20/24 — the 'Allowed Next' rules per process, as
    DATA. from_status -> to_status, scoped by process, optionally gated by a role
    or a guard (e.g. 'approved'). The ticket engine consults this table and
    REJECTS any transition not listed — illegal state jumps become impossible,
    which is what makes the lifecycle bank-auditable."""
    __tablename__ = "grc_hd_state_transition"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    process = Column(String(20), nullable=False)           # incident|problem|change|service_request
    from_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=False, index=True)
    to_status_id = Column(Integer, ForeignKey("grc_hd_ticket_status.id"), nullable=False)
    required_role = Column(String(60), nullable=True)      # ROLE-* code allowed to make this move
    guard = Column(String(40), nullable=True)              # optional precondition key (e.g. "approved", "cab_passed")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    from_status = relationship("HDTicketStatus", foreign_keys=[from_status_id])
    to_status = relationship("HDTicketStatus", foreign_keys=[to_status_id])

    __table_args__ = (
        Index("uq_hd_state_transition", "tenant_id", "process", "from_status_id", "to_status_id", unique=True),
    )


class HDChangeType(Base):
    """Workbook sheet 23 — Change Types. Governs whether a change needs CAB and
    whether it can auto-approve (Standard/pre-authorised)."""
    __tablename__ = "grc_hd_change_type"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # standard | normal | major | emergency
    name = Column(String(140), nullable=False)
    requires_cab = Column(Boolean, server_default=text("true"))
    auto_approve = Column(Boolean, server_default=text("false"))  # Standard pre-authorised changes skip CAB
    description = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_change_type_code", "tenant_id", "code", unique=True),
    )


class HDChangeRiskMatrix(Base):
    """Workbook sheet 26 — Change Risk Matrix. impact x likelihood -> risk level,
    and whether that risk level forces CAB/ECAB."""
    __tablename__ = "grc_hd_change_risk_matrix"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    impact = Column(String(20), nullable=False)
    likelihood = Column(String(20), nullable=False)
    risk_level = Column(String(20), nullable=False)        # low | medium | high | very_high
    cab_required = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_change_risk_cell", "tenant_id", "impact", "likelihood", unique=True),
    )


class HDApproval(Base):
    """ONE approval engine for both worlds: a service-request approval (single
    approver, quorum 1) and a Change Advisory Board decision (quorum >= 3 incl.
    Change Manager + Service Owner). Attached to the ticket it gates. While an
    approval is pending, the ticket sits in a Paused status so its SLA clock
    stops (status category = Paused)."""
    __tablename__ = "grc_hd_approval"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    kind = Column(String(20), nullable=False)              # request | cab | ecab
    required_quorum = Column(Integer, nullable=False, server_default="1")
    required_role_codes = Column(JSON, nullable=True)      # ROLE-* that MUST vote (e.g. Change Manager + Service Owner)
    state = Column(String(20), nullable=False, server_default="pending")  # pending|approved|rejected|cancelled
    opened_by = Column(String(255), nullable=True)
    opened_at = Column(DateTime, default=datetime.utcnow)
    decided_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    ticket = relationship("HDTicket")

    __table_args__ = (
        Index("ix_hd_approval_ticket_state", "ticket_id", "state"),
    )


class HDApprovalVote(Base):
    """A single approver's decision on an HDApproval. Quorum is reached when the
    count of 'approve' votes (covering every required role) meets required_quorum;
    any 'reject' can fail the approval immediately depending on policy."""
    __tablename__ = "grc_hd_approval_vote"

    id = Column(Integer, primary_key=True)
    approval_id = Column(Integer, ForeignKey("grc_hd_approval.id", ondelete="CASCADE"),
                         nullable=False, index=True)

    approver = Column(String(255), nullable=False)         # voting user email
    approver_role = Column(String(60), nullable=True)      # ROLE-* code they voted as
    decision = Column(String(20), nullable=False)          # approve | reject | abstain
    comment = Column(Text, nullable=True)
    voted_at = Column(DateTime, default=datetime.utcnow)

    created_at = Column(DateTime, default=datetime.utcnow)

    approval = relationship("HDApproval", backref="votes")

    __table_args__ = (
        Index("uq_hd_approval_vote_approver", "approval_id", "approver", unique=True),
    )


# ----------------------------------------------------------------------------
# MAPPING — workbook org identifiers -> ComplyVerse's existing primitives
# ----------------------------------------------------------------------------
class HDSupportGroupMap(Base):
    """Workbook sheet 05 — Support Groups (GRP-xx). ComplyVerse does NOT get a second
    team table: a support group maps to an existing ComplyVerse Administration team
    (grc_teams). The importer resolves GRP-* -> team_id so RACI/fulfilment/owner
    references land on real teams."""
    __tablename__ = "grc_hd_support_group_map"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # GRP-NET, GRP-MSG, ...
    name = Column(String(200), nullable=False)
    team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)  # resolved ComplyVerse Administration team

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team = relationship("Team")

    __table_args__ = (
        Index("uq_hd_support_group_code", "tenant_id", "code", unique=True),
    )


class HDRoleMap(Base):
    """Workbook sheet 06 — Roles (ROLE-xx). Maps an ITSM role to an ComplyVerse RBAC
    preset / permission set, so a RACI 'Accountable = Change Manager' resolves to
    the people who actually hold that preset in the tenant."""
    __tablename__ = "grc_hd_role_map"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    code = Column(String(40), nullable=False)              # ROLE-CHGMGR, ROLE-SVCOWN, ...
    name = Column(String(200), nullable=False)
    rbac_preset = Column(String(120), nullable=True)       # ComplyVerse RBAC preset name this role maps to
    description = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_role_map_code", "tenant_id", "code", unique=True),
    )


# ----------------------------------------------------------------------------
# INCIDENT CLASSIFICATION — the triage taxonomy a reporter drills through
# ----------------------------------------------------------------------------
class HDIncidentCategory(Base):
    """Workbook sheet 16 — Incident Categories. A 3-level tree
    (category -> subcategory -> example item) the end-user 'report a problem'
    wizard walks and an agent classifies an incident by. The sheet has no code
    column, so the natural key is the normalized slash-path `key` (e.g.
    'email/mailbox/mailbox_full'), unique per tenant — the seed upserts on it.
    `business_service_id` is reserved for later routing (e.g. the Email category
    -> the Email business service); the workbook has no column for it yet."""
    __tablename__ = "grc_hd_incident_category"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    key = Column(String(255), nullable=False)              # normalized slash-path (natural key)
    name = Column(String(200), nullable=False)             # display label at this node
    level = Column(String(20), nullable=False)             # category | subcategory | item
    parent_id = Column(Integer, ForeignKey("grc_hd_incident_category.id"), nullable=True)
    business_service_id = Column(Integer, ForeignKey("grc_hd_business_service.id"), nullable=True)  # reserved for routing
    sort_order = Column(Integer, nullable=True)
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("HDIncidentCategory", remote_side=[id])
    business_service = relationship("HDBusinessService")

    __table_args__ = (
        Index("uq_hd_incident_category_key", "tenant_id", "key", unique=True),
    )


class HDProblemCategory(Base):
    """Per-process category taxonomy for Problems. Same (category -> subcategory)
    tree shape as HDIncidentCategory; seeded from the canonical service catalogue
    so every process agrees on the same category set but can diverge per process.
    Natural key = normalized slash-path `key`, unique per tenant (seed upserts)."""
    __tablename__ = "grc_hd_problem_category"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    key = Column(String(255), nullable=False)
    name = Column(String(200), nullable=False)
    level = Column(String(20), nullable=False)             # category | subcategory
    parent_id = Column(Integer, ForeignKey("grc_hd_problem_category.id"), nullable=True)
    sort_order = Column(Integer, nullable=True)
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("HDProblemCategory", remote_side=[id])

    __table_args__ = (
        Index("uq_hd_problem_category_key", "tenant_id", "key", unique=True),
    )


class HDChangeCategory(Base):
    """Per-process category taxonomy for Changes. Mirrors HDProblemCategory; the
    domain category of a change (distinct from its change TYPE: Standard/Normal/
    Emergency). Seeded from the canonical service catalogue."""
    __tablename__ = "grc_hd_change_category"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    key = Column(String(255), nullable=False)
    name = Column(String(200), nullable=False)
    level = Column(String(20), nullable=False)             # category | subcategory
    parent_id = Column(Integer, ForeignKey("grc_hd_change_category.id"), nullable=True)
    sort_order = Column(Integer, nullable=True)
    enabled = Column(Boolean, server_default=text("true"))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship("HDChangeCategory", remote_side=[id])

    __table_args__ = (
        Index("uq_hd_change_category_key", "tenant_id", "key", unique=True),
    )


# ----------------------------------------------------------------------------
# PERFORMANCE — the KPI definitions the Insights views report against
# ----------------------------------------------------------------------------
class HDKPI(Base):
    """Workbook sheet 29 — Performance & Availability KPIs. Definition rows only
    (name + definition + target + cadence) per process; the live Insights numbers
    are computed later from tickets. Natural key = (tenant, process, kpi)."""
    __tablename__ = "grc_hd_kpi"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    process = Column(String(40), nullable=False)          # incident | problem | change | service_request | general...
    kpi = Column(String(200), nullable=False)             # KPI name (e.g. "Mean Time to Resolve")
    definition = Column(Text, nullable=True)
    target = Column(String(120), nullable=True)           # e.g. "P1 < 4h", ">= 70%"
    frequency = Column(String(60), nullable=True)         # Monthly / Weekly / ...
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_kpi_process_name", "tenant_id", "process", "kpi", unique=True),
    )


# ----------------------------------------------------------------------------
# SLA / RACI / CAB — the remaining governance sheets (08, 15/17/19/21/22/25/28,
# 27). Phase 2 continuation of the same workbook ingest.
# ----------------------------------------------------------------------------
class HDSLATarget(Base):
    """Workbook sheet 08 — SLA / OLA Targets. Response/resolution targets per
    process and priority (or, for change/service_request, a type label like
    'Standard'/'Emergency' instead of a P-code). The raw label is kept verbatim
    (priority_label) since not every row parses to a P-code; priority_code and
    the *_minutes columns are the best-effort parse, nullable when the workbook
    cell is a prose target ('Per offering SLA', 'Immediate (ECAB)', ...)."""
    __tablename__ = "grc_hd_sla_target"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    process = Column(String(20), nullable=False)           # incident|service_request|problem|change
    priority_label = Column(String(60), nullable=False)    # raw "priority_or_type" cell
    priority_code = Column(String(10), nullable=True)      # parsed P1..P5, else null
    service_window = Column(String(20), nullable=True)     # 24x7 | business hours
    response_minutes = Column(Integer, nullable=True)
    resolution_minutes = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_sla_target", "tenant_id", "process", "priority_label", "service_window", unique=True),
    )


class HDProcessField(Base):
    """Workbook sheets 15/21/25 — Incident/Problem/Change Fields. The data
    dictionary for each process record (field name, free-text type like
    'Auto'/'String'/'Ref:CIT-USER', required, description). There is no
    service_request fields sheet in the workbook."""
    __tablename__ = "grc_hd_process_field"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    process = Column(String(20), nullable=False)           # incident|problem|change
    name = Column(String(200), nullable=False)              # the sheet's "Field" cell
    field_type = Column(String(60), nullable=True)          # free text: Auto/String/Text/Enum/Ref:...
    required = Column(Boolean, nullable=True)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_process_field", "tenant_id", "process", "name", unique=True),
    )


class HDRaci(Base):
    """Workbook sheets 17/19/22/28 — Incident/Request/Problem/Change RACI. Role
    values are ROLE-* codes (sometimes a comma-list) kept as plain text — RACI
    is advisory/reportable, not a hard FK gate like other cross-references."""
    __tablename__ = "grc_hd_raci"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    process = Column(String(20), nullable=False)            # incident|service_request|problem|change
    activity = Column(String(200), nullable=False)
    responsible = Column(String(160), nullable=True)
    accountable = Column(String(160), nullable=True)
    consulted = Column(String(255), nullable=True)
    informed = Column(String(255), nullable=True)
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_raci", "tenant_id", "process", "activity", unique=True),
    )


class HDCABConfig(Base):
    """Workbook sheet 27 — Change Advisory Board Model. Key/value configuration
    rows (cadence, chair, standing members, quorum, ...) rather than a fixed
    schema — the workbook authors it as free-text item/detail pairs."""
    __tablename__ = "grc_hd_cab_config"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_batch_id = Column(Integer, ForeignKey("grc_hd_import_batch.id"), nullable=True)

    item = Column(String(140), nullable=False)
    detail = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uq_hd_cab_config", "tenant_id", "item", unique=True),
    )


# ----------------------------------------------------------------------------
# BATCH 4 — ticket linkage bridges (impacted CIs, KB articles)
# ----------------------------------------------------------------------------
class HDTicketCI(Base):
    """Batch 4 linkage B — the SET of CIs a ticket impacts, beyond its single
    primary grc_hd_ticket.ci_id. A change usually touches more than one CI; the
    CAB exposure check unions the primary ci_id with every CI here so a change is
    escalated when ANY impacted CI is internet-facing / PCI. Tenant-scoped (the
    bridge carries tenant_id so the add/remove/exposure queries filter on it
    directly, same as the Batch 4 KB bridge)."""
    __tablename__ = "grc_hd_ticket_ci"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    ci_id = Column(Integer, ForeignKey("grc_hd_ci.id", ondelete="CASCADE"),
                   nullable=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    ci = relationship("HDConfigurationItem")

    __table_args__ = (
        Index("uq_hd_ticket_ci", "ticket_id", "ci_id", unique=True),
    )


class HDTicketKBLink(Base):
    """Batch 4 linkage C — a KB article attached to a ticket (resolution /
    suggested article). Bridge to grc_hd_article; tenant-scoped so link/unlink
    queries filter on tenant_id. Idempotent via the unique (ticket_id,
    article_id) pair."""
    __tablename__ = "grc_hd_ticket_kb_link"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    ticket_id = Column(Integer, ForeignKey("grc_hd_ticket.id", ondelete="CASCADE"),
                       nullable=False, index=True)
    article_id = Column(Integer, ForeignKey("grc_hd_article.id", ondelete="CASCADE"),
                        nullable=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    article = relationship("HDArticle")

    __table_args__ = (
        Index("uq_hd_ticket_kb_link", "ticket_id", "article_id", unique=True),
    )
