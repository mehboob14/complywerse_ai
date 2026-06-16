from ._38_database_initialization_functions import *  # noqa: F401,F403

# =============================================================================
# AI Risk Assessment Template
# =============================================================================
# Storage for the externally provided "AI Risk Assessment Template.xlsx" used
# by GRC teams to track AI/ML system risks. Mirrors the spreadsheet columns
# 1:1 so an operator can upload the workbook and continue editing without
# losing any fields. Each entry can optionally bridge to a general Risk row
# so the entry inherits the full ERM detail page (mitigations, asset/control
# links, workflow). Same pattern as NcaRiskEntry.

class AIRiskAssessmentEntry(Base):
    """AI Risk Assessment template entry (13 columns from the workbook)."""
    __tablename__ = "grc_ai_risk_assessment_entries"

    id                              = Column(Integer, primary_key=True, index=True)
    tenant_id                       = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # Spreadsheet column 1: Risk ID (free text in the template, e.g. "1").
    risk_id_external                = Column(String(50),  nullable=True)
    # Column 2: AI System / Use Case (e.g. "AI Chatbot", "Predictive Analytics Engine").
    ai_system_use_case              = Column(String(255), nullable=True)
    # Column 3: Risk Description.
    risk_description                = Column(Text,        nullable=True)
    # Column 4: Risk Category (Ethical / Fairness, Data Privacy, Operational, Regulatory, Security, etc.).
    risk_category                   = Column(String(100), nullable=True)
    # Column 5: Likelihood (1-5).
    likelihood                      = Column(Integer,     nullable=True)
    # Column 6: Impact (1-5).
    impact                          = Column(Integer,     nullable=True)
    # Column 7: Risk Score (computed L x I but stored verbatim from sheet).
    risk_score                      = Column(Integer,     nullable=True)
    # Column 8: Existing Controls.
    existing_controls               = Column(Text,        nullable=True)
    # Column 9: Residual Risk Level (text bucket: High / Medium / Low).
    residual_risk_level             = Column(String(20),  nullable=True)
    # Column 10: Mitigation Plan.
    mitigation_plan                 = Column(Text,        nullable=True)
    # Column 11: Risk Owner (free text in template; bridged user id stored separately).
    risk_owner                      = Column(String(255), nullable=True)
    risk_owner_user_id              = Column(Integer,     ForeignKey("grc_users.id"), nullable=True)
    # Column 12: Target Review Date.
    target_review_date              = Column(Date,        nullable=True)
    # Column 13: Status (Open / In Progress / Closed etc.).
    status                          = Column(String(50),  default="Open", nullable=True)

    # Optional bridge to general Risk row. Same pattern as NcaRiskEntry: when
    # set, the entry inherits the full ERM detail page (mitigations, asset
    # and control links, workflow). idempotent.
    bridged_risk_id                 = Column(Integer,     ForeignKey("grc_risks.id"), nullable=True, index=True)

    # AI assist fields. Set when the AI suggest endpoint is invoked.
    # Stored verbatim so the operator can audit what the model proposed.
    ai_suggested_mitigation         = Column(Text,        nullable=True)
    ai_suggested_controls           = Column(Text,        nullable=True)
    ai_suggested_likelihood         = Column(Integer,     nullable=True)
    ai_suggested_impact             = Column(Integer,     nullable=True)
    ai_suggested_residual_level     = Column(String(20),  nullable=True)
    ai_rationale                    = Column(Text,        nullable=True)
    ai_generated_at                 = Column(DateTime,    nullable=True)
    ai_model                        = Column(String(80),  nullable=True)
    # When the operator accepts an AI suggestion, the value is copied into
    # the primary column AND ai_suggestion_accepted flag flips. Lets the UI
    # render an "accepted" chip on accepted entries.
    ai_suggestion_accepted          = Column(Boolean,     default=False, nullable=True)

    # Provenance.
    source                          = Column(String(50),  default="manual", nullable=True)  # manual / template_upload / api
    source_file_name                = Column(String(255), nullable=True)

    created_by_user_id              = Column(Integer,     ForeignKey("grc_users.id"), nullable=True)
    created_at                      = Column(DateTime,    default=datetime.utcnow)
    updated_at                      = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
