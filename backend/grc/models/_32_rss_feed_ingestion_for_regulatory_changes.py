from ._31_assessment_evidence_approval_workflow_models import *  # noqa: F401,F403

# =============================================================================
# 24. RSS Feed Ingestion for Regulatory Changes
# =============================================================================

class RegulatoryFeedSource(Base):
    """RSS/Atom feed sources for regulatory updates"""
    __tablename__ = "grc_regulatory_feed_sources"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    source_url = Column(String(1000), nullable=False)
    source_type = Column(String(50), default="rss")  # rss, atom, api
    country = Column(String(100), nullable=True)
    regulator = Column(String(255), nullable=True)
    category = Column(String(100), nullable=True)  # notices, monetary_policy, etc.
    is_active = Column(Boolean, default=True)
    poll_interval_hours = Column(Integer, default=24)
    last_polled_at = Column(DateTime, nullable=True)
    last_successful_poll = Column(DateTime, nullable=True)
    items_processed = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    feed_items = relationship("RegulatoryFeedItem", back_populates="feed_source", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_regulatory_feed_source_tenant", "tenant_id"),
        Index("ix_regulatory_feed_source_active", "tenant_id", "is_active"),
        Index("ix_regulatory_feed_source_type", "source_type"),
        Index("ix_regulatory_feed_source_country", "country"),
        Index("ix_regulatory_feed_source_regulator", "regulator"),
    )


class RegulatoryFeedItem(Base):
    """Individual items ingested from regulatory RSS feeds"""
    __tablename__ = "grc_regulatory_feed_items"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    feed_source_id = Column(Integer, ForeignKey("grc_regulatory_feed_sources.id"), nullable=False, index=True)
    guid = Column(String(500), nullable=False)
    title = Column(String(1000), nullable=False)
    description = Column(Text, nullable=True)
    link = Column(String(1000), nullable=True)
    published_date = Column(DateTime, nullable=True)
    content = Column(Text, nullable=True)
    status = Column(String(50), default="new")  # new, processed, ignored, error
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=True, index=True)
    processed_at = Column(DateTime, nullable=True)
    ai_analysis = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    feed_source = relationship("RegulatoryFeedSource", back_populates="feed_items")
    regulatory_change = relationship("RegulatoryChange")
    
    __table_args__ = (
        Index("ix_regulatory_feed_item_tenant", "tenant_id"),
        Index("ix_regulatory_feed_item_source", "feed_source_id"),
        Index("ix_regulatory_feed_item_status", "tenant_id", "status"),
        Index("ix_regulatory_feed_item_guid", "feed_source_id", "guid"),
        Index("ix_regulatory_feed_item_regulatory_change", "regulatory_change_id"),
        Index("ix_regulatory_feed_item_published", "published_date"),
        UniqueConstraint("feed_source_id", "guid", name="uq_feed_item_source_guid"),
    )

