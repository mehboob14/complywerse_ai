from ._53_choke_point_models import *  # noqa: F401,F403

# =============================================================================
# CTEM Phase 5 — ITSM ticket links (mobilisation over ServiceNow/Jira)
# =============================================================================
#
# The connectors module (grc/modules/connectors/) already carries a working
# ServiceNow ticketing adapter (create_ticket / fetch_statuses / two-way
# status sync). What was missing was the LINK between a finding and the
# ticket it was pushed as — without it there is no idempotency ("did we
# already open a ticket for this vuln?") and no way to roll a ServiceNow
# resolution back onto the finding's remediation plan. This table is that
# link.
#
# Safety boundary (mirrors scanner closure): ServiceNow resolving a ticket
# means engineering did the WORK, so the linked remediation plan advances to
# `applied` — NOT `verified`. Verification stays the scanner/retest's job; a
# ticket close is not proof the finding is actually gone.


class VulnTicketLink(Base):
    """One live ITSM ticket per (vulnerability, connection). Idempotent: a
    second push finds the existing link instead of opening a duplicate."""
    __tablename__ = "grc_vuln_ticket_links"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id", ondelete="CASCADE"),
                              nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id", ondelete="CASCADE"),
                           nullable=False, index=True)

    kind = Column(String(20), nullable=False, default="vulnerability")  # vulnerability | exception
    external_ticket_id = Column(String(120), nullable=True, index=True)  # e.g. INC0010234
    # Raw provider status + our normalised taxonomy (new/in_progress/on_hold/
    # resolved/closed/cancelled) from TicketStatus.
    ticket_status = Column(String(60), nullable=True)
    normalised_status = Column(String(30), nullable=True)

    pushed_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    pushed_at = Column(DateTime, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    # Set once the ticket's resolution has advanced the linked remediation
    # plan to `applied`, so a repeated sync doesn't re-advance / re-audit.
    plan_advanced_at = Column(DateTime, nullable=True)
    push_error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")
    connection = relationship("IntegrationConnection")

    __table_args__ = (
        # PARTIAL unique — one LIVE ticket per (vuln, connection), but a
        # resolved-then-reopened finding CAN push again (reopens are
        # first-class in this codebase). An absolute constraint would forbid
        # re-ticketing forever, and additive-only migrations make a wrong
        # constraint expensive to undo — so it must be partial from day one.
        Index("uq_vuln_ticket_link_live", "tenant_id", "vulnerability_id", "connection_id",
              unique=True,
              postgresql_where=text("resolved_at IS NULL"),
              sqlite_where=text("resolved_at IS NULL")),
        Index("ix_vuln_ticket_link_conn", "connection_id", "normalised_status"),
        Index("ix_vuln_ticket_link_ext", "tenant_id", "external_ticket_id"),
    )
