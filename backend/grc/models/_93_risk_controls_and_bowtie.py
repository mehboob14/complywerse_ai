"""The one risk–control link, and the bow-tie saved per risk (Risk Management redesign, waves 4 and 5).

`RiskControl` is the only link of a risk to a control of any kind: every link, unlink and read goes through
`grc/modules/erm/services/risk_control_links.py`. The older link tables (internal controls, Control Library work items,
normalized/SCF controls, the legacy framework catalog, installed-framework requirements) are no longer written; their rows
were copied in once per database (`RiskControlLegacyCopy` records each table copied), and their models stay so old
data can still be read.

`RiskBowtieItem` is one cause or consequence on a risk's bow-tie; the controls on the bow-tie come from `RiskControl`.
"""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import backref, relationship

from ._00_base import Base


class RiskControl(Base):
    __tablename__ = "grc_risk_controls"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id", ondelete="CASCADE"), nullable=False, index=True)
    # Which table control_id points at: internal → grc_internal_controls, normalized → grc_normalized_controls (the
    # Control Library / SCF), framework → grc_parsed_framework_controls (installed frameworks), catalog →
    # grc_framework_controls (the legacy framework catalog).
    control_source = Column(String(20), nullable=False)
    control_id = Column(Integer, nullable=False)
    link_type = Column(String(50), default="mitigates")      # mitigates | monitors | detects
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    # The older link row this one was copied from or written alongside (an old id still unlinks it).
    legacy_table = Column(String(64), nullable=True)
    legacy_id = Column(Integer, nullable=True)
    # What the older tables said about the link, kept so their screens show the same thing.
    effectiveness_rating = Column(String(50), nullable=True)        # internal / work-item links: high | medium | low
    mitigation_effectiveness = Column(String(50), nullable=True)    # framework links: full | partial | minimal | none
    # FAIR control effect (was on grc_risk_control_links): min / most likely / max % reduction of event frequency and of
    # loss magnitude, sampled by the simulation engine. NULL = no effect modelled.
    freq_reduction_min_pct = Column(Float, nullable=True)
    freq_reduction_ml_pct = Column(Float, nullable=True)
    freq_reduction_max_pct = Column(Float, nullable=True)
    mag_reduction_min_pct = Column(Float, nullable=True)
    mag_reduction_ml_pct = Column(Float, nullable=True)
    mag_reduction_max_pct = Column(Float, nullable=True)
    effect_rationale = Column(Text, nullable=True)
    effect_updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    effect_updated_at = Column(DateTime, nullable=True)

    # Deleting a risk takes its links with it (the database cascades too).
    risk = relationship("Risk", backref=backref("risk_controls", cascade="all, delete-orphan"))

    __table_args__ = (
        UniqueConstraint("risk_id", "control_source", "control_id", name="uq_risk_control"),
        Index("ix_risk_control_legacy", "legacy_table", "legacy_id"),
    )


class RiskControlLegacyCopy(Base):
    """One row per old link table whose rows were copied into grc_risk_controls in this database. The copy never runs
    again for that table, so a link removed afterwards does not come back."""
    __tablename__ = "grc_risk_control_legacy_copies"

    id = Column(Integer, primary_key=True, index=True)
    legacy_table = Column(String(64), nullable=False, unique=True)
    copied = Column(Integer, default=0)                       # links this table added
    copied_at = Column(DateTime, default=datetime.utcnow)


class RiskBowtieItem(Base):
    __tablename__ = "grc_risk_bowtie_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id", ondelete="CASCADE"), nullable=False, index=True)
    side = Column(String(20), nullable=False)                 # cause | consequence
    title = Column(String(500), nullable=False)
    impact_category = Column(String(30), nullable=True)       # consequences: financial | regulatory | ...
    # The RiskControl ids placed on this cause or consequence; empty means every control on its side of the bow-tie.
    control_link_ids = Column(JSON, nullable=True)
    source = Column(String(30), nullable=True)                # loss_event | risk_cause | risk_consequence | manual
    position = Column(Integer, default=0)
    gap_action_id = Column(Integer, ForeignKey("grc_issue_actions.id"), nullable=True)   # the action raised for its gap
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
