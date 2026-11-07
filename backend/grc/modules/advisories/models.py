"""Advisory module tables.

Kept inside the module folder (not the numbered ``models/_NN`` files) so the
whole feature stays in one place. They are still registered for table creation
by a single ``from ..modules.advisories.models import *`` line in
``grc/models/__init__.py`` — there is no Alembic; ``Base.metadata.create_all``
picks up any table whose class is imported before the engine is created.

All four tables carry ``tenant_id`` per the platform's per-tenant convention.
"""
from ...models._00_base import (
    Base, Column, Integer, String, Text, Boolean, DateTime, JSON,
    ForeignKey, Index, UniqueConstraint, relationship, datetime,
)

__all__ = [
    "AdvisorySource",
    "Advisory",
    "AdvisoryCve",
    "AdvisoryAssetApplicability",
    "AdvisoryEvent",
    "AdvisoryMatchSession",
]


class AdvisorySource(Base):
    """Where advisories come from. ``kind`` governs ingestion:
    manual (typed in), upload (a document), api (pulled via a connector)."""

    __tablename__ = "grc_advisory_sources"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    kind = Column(String(20), nullable=False, default="manual")  # manual | upload | api
    # For api sources: the connectors IntegrationConnection this source pulls
    # through. Nullable until the Sprint-5 connector work wires it.
    connection_id = Column(Integer, nullable=True)
    url = Column(String(500), nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_advisory_source_tenant", "tenant_id"),)


class Advisory(Base):
    """One advisory (e.g. NCert NCA-19.211026). Holds its CVEs and a
    denormalised applicability rollup recomputed on each recheck."""

    __tablename__ = "grc_advisories"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_id = Column(Integer, ForeignKey("grc_advisory_sources.id"), nullable=True, index=True)
    external_id = Column(String(120), nullable=True, index=True)  # e.g. NCA-19.211026
    title = Column(String(500), nullable=False)
    summary = Column(Text, nullable=True)
    severity = Column(String(20), nullable=True)  # critical | high | medium | low | info
    published_at = Column(DateTime, nullable=True)
    url = Column(String(500), nullable=True)
    raw_file_path = Column(String(500), nullable=True)  # uploaded document (Sprint 4)
    # pending (extracted, awaiting human confirm) | open | resolved | not_applicable
    status = Column(String(20), default="open", index=True)
    # Rollup across this advisory's CVEs, recomputed on applicability recheck.
    asset_affected_count = Column(Integer, default=0)
    asset_total_count = Column(Integer, default=0)
    # Multi-stage extraction report (method/confidence/warnings/stages) kept for
    # the review screen — set for PDF-sourced (upload/scrape) advisories.
    extraction_meta = Column(JSON, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cves = relationship("AdvisoryCve", back_populates="advisory", cascade="all, delete-orphan")
    events = relationship("AdvisoryEvent", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_advisory_tenant_status", "tenant_id", "status"),)


class AdvisoryCve(Base):
    """A CVE named by an advisory, bridged into the general Vulnerability
    system so it inherits enrichment, asset matching, SLA and remediation."""

    __tablename__ = "grc_advisory_cves"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    advisory_id = Column(Integer, ForeignKey("grc_advisories.id"), nullable=False, index=True)
    cve_id = Column(String(50), nullable=False, index=True)
    affected_product = Column(String(255), nullable=True)
    affected_versions = Column(String(255), nullable=True)  # free text, e.g. "< 8.2.35"
    # The general Vulnerability this CVE was bridged into (the row that carries
    # enrichment + the fix flow). Nullable until the bridge runs.
    bridged_vulnerability_id = Column(
        Integer, ForeignKey("grc_vulnerabilities.id"), nullable=True, index=True
    )
    created_at = Column(DateTime, default=datetime.utcnow)

    advisory = relationship("Advisory", back_populates="cves")
    applicability = relationship(
        "AdvisoryAssetApplicability", back_populates="advisory_cve",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("advisory_id", "cve_id", name="uq_advisory_cve"),
        Index("ix_advisory_cve_tenant", "tenant_id"),
    )


class AdvisoryEvent(Base):
    """One entry in an advisory's history/session timeline — what happened
    (ingested, confirmed, bridged, rechecked, status change), when, and by whom."""

    __tablename__ = "grc_advisory_events"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    advisory_id = Column(Integer, ForeignKey("grc_advisories.id"), nullable=False, index=True)
    event = Column(String(30), nullable=False)  # ingested|confirmed|bridged|rechecked|status_change
    detail = Column(JSON, default=dict)
    actor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    actor_name = Column(String(150), nullable=True)  # denormalised for display
    at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_advisory_event_advisory", "advisory_id", "at"),)


class AdvisoryAssetApplicability(Base):
    """Per-asset verdict for one advisory CVE — the 'we checked, here's the
    answer (with proof)' record. Written by the Sprint-2 cross-check."""

    __tablename__ = "grc_advisory_asset_applicability"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    advisory_cve_id = Column(Integer, ForeignKey("grc_advisory_cves.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    verdict = Column(String(20), nullable=False, default="unknown")  # affected | not_affected | fixed | unknown
    evidence = Column(JSON, default=dict)
    checked_at = Column(DateTime, default=datetime.utcnow)

    advisory_cve = relationship("AdvisoryCve", back_populates="applicability")

    __table_args__ = (
        UniqueConstraint("advisory_cve_id", "asset_id", name="uq_advisory_cve_asset"),
        Index("ix_advisory_applic_tenant", "tenant_id"),
    )


class AdvisoryMatchSession(Base):
    """A saved advisory-match run — the selection, the scope, a summary and the
    full report snapshot — so it can be re-opened and downloaded later as a
    point-in-time record (the advisory 'history' of match sessions)."""

    __tablename__ = "grc_advisory_match_sessions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    label = Column(String(200), nullable=True)
    scope_mode = Column(String(20), nullable=False, default="all")  # all | assets
    scope_asset_ids = Column(JSON, default=list)
    advisory_ids = Column(JSON, default=list)
    cve_ids = Column(JSON, default=list)
    summary = Column(JSON, default=dict)   # cves_checked / matched / not_found / scope_size
    result = Column(JSON, default=dict)     # full report snapshot (matched + not_found)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    actor_name = Column(String(150), nullable=True)  # denormalised for the history list
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_advisory_match_tenant", "tenant_id", "created_at"),)
