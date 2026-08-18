from ._54_itsm_ticket_link_models import *  # noqa: F401,F403

# =============================================================================
# CTEM P5 — AI-suggested SPECIFIC control links (proposals, human-approved)
# =============================================================================
#
# The rule crosswalk links every open CVE to the GENERAL patch/vuln-mgmt
# controls. This table holds the AI's proposals for the SPECIFIC controls
# (input validation, crypto config, hardening…) drawn from the tenant's
# control corpus — the Unified Control Library AND the uploaded frameworks
# (ISO/NIST/PCI/CSF parsed controls) — as PROPOSALS, never links. A human
# accepts or rejects each one; only an accept creates a VulnerabilityControlLink
# (notes "ai_suggested:", with the approver's id).
#
# REASON ONCE, APPLY MANY (the L4 rule from CTEM_VALIDATE_REASONING_PLAN):
# a (weakness key = CWE, control) pair a human has already ACCEPTED is applied
# to every later finding with that CWE without another model call — provenance
# "reused", decided_by = the original approver, link created. A pair a human
# REJECTED is never re-proposed for that CWE. The model is called only for
# keys nobody has decided yet.
#
# Auditability: every proposal stores the prompt version, the full prompt
# inputs and the model's raw output, so "why did the AI suggest this?" is
# answerable later. A rejected pair is never re-proposed (the unique key
# on (vuln, control) makes a re-run an update, not a duplicate).

class AiControlProposal(Base):
    __tablename__ = "grc_ai_control_proposals"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id", ondelete="CASCADE"),
                              nullable=False, index=True)
    # exactly ONE of the two control refs is set (Unified Library OR uploaded framework)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id", ondelete="CASCADE"),
                                   nullable=True, index=True)
    parsed_framework_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id", ondelete="CASCADE"),
                                         nullable=True, index=True)
    # model = the LLM proposed it for this finding; reused = applied from a human's
    # earlier decision on the same (CWE, control) pair, no model call
    provenance = Column(String(12), nullable=False, default="model", server_default="model")

    # what the model said
    confidence = Column(String(10), nullable=False)          # high | medium | low
    reason = Column(Text, nullable=True)
    driven_by = Column(String(40), nullable=True)            # cve_description | cwe | finding_description
    prompt_version = Column(String(30), nullable=False)
    bucket = Column(String(30), nullable=True)               # cve | described_weakness

    # human decision
    status = Column(String(20), nullable=False, default="proposed", index=True)  # proposed | accepted | rejected
    decided_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_note = Column(Text, nullable=True)
    # the link this proposal created on accept (so reject-after-accept can unwind)
    control_link_id = Column(Integer, ForeignKey("grc_vulnerability_control_links.id", ondelete="SET NULL"),
                             nullable=True)

    # audit — full inputs + raw output, per run
    run_id = Column(String(40), nullable=True, index=True)   # groups one batch run
    prompt_inputs = Column(JSON, nullable=True)              # {system, user}
    raw_output = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vulnerability = relationship("Vulnerability")
    control = relationship("NormalizedControl")
    parsed_control = relationship("ParsedFrameworkControl")
    decider = relationship("GRCUser", foreign_keys=[decided_by])

    __table_args__ = (
        # one proposal per (finding, control) per control kind — a re-run refreshes it, never duplicates
        UniqueConstraint("vulnerability_id", "normalized_control_id", name="uq_ai_control_proposal_pair"),
        UniqueConstraint("vulnerability_id", "parsed_framework_control_id", name="uq_ai_control_proposal_pfc_pair"),
        Index("ix_ai_control_proposal_status", "tenant_id", "status"),
    )

    @property
    def control_ref(self):
        """('normalized_control'|'parsed_framework_control', id) — the one ref that is set."""
        if self.parsed_framework_control_id is not None:
            return ("parsed_framework_control", self.parsed_framework_control_id)
        return ("normalized_control", self.normalized_control_id)


class AiControlProposalRun(Base):
    """One batch run of the mapper — what was scoped, what it cost, what came out.
    The command center / review page reads this for 'last run' honesty."""
    __tablename__ = "grc_ai_control_proposal_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    run_id = Column(String(40), nullable=False, unique=True, index=True)
    prompt_version = Column(String(30), nullable=False)
    ctem_scope_id = Column(Integer, nullable=True)           # null = tenant-wide
    triggered_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    findings_total = Column(Integer, default=0)
    findings_inventory = Column(Integer, default=0)          # never sent
    findings_sent = Column(Integer, default=0)               # model called
    proposals_created = Column(Integer, default=0)
    proposals_updated = Column(Integer, default=0)
    findings_reused = Column(Integer, default=0)             # key already human-decided → no model call
    proposals_reused = Column(Integer, default=0)            # links applied from those decisions
    model_errors = Column(Integer, default=0)
    invalid_ids_dropped = Column(Integer, default=0)

    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
