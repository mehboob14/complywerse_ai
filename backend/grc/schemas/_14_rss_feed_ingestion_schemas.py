from ._13_board_committee_management_schemas import *  # noqa: F401,F403

# =============================================================================
# RSS Feed Ingestion Schemas
# =============================================================================

class RegulatoryFeedSourceCreate(BaseModel):
    name: str
    source_url: str
    source_type: str = "rss"
    country: Optional[str] = None
    regulator: Optional[str] = None
    category: Optional[str] = None
    is_active: bool = True
    poll_interval_hours: int = 24


class RegulatoryFeedSourceUpdate(BaseModel):
    name: Optional[str] = None
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    country: Optional[str] = None
    regulator: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None
    poll_interval_hours: Optional[int] = None


class RegulatoryFeedSourceResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    source_url: str
    source_type: str
    country: Optional[str]
    regulator: Optional[str]
    category: Optional[str]
    is_active: bool
    poll_interval_hours: int
    last_polled_at: Optional[datetime]
    last_successful_poll: Optional[datetime]
    items_processed: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RegulatoryFeedItemResponse(BaseModel):
    id: int
    tenant_id: int
    feed_source_id: int
    guid: str
    title: str
    description: Optional[str]
    link: Optional[str]
    published_date: Optional[datetime]
    content: Optional[str]
    status: str
    regulatory_change_id: Optional[int]
    processed_at: Optional[datetime]
    ai_analysis: Optional[Dict[str, Any]]
    created_at: datetime
    feed_source_name: Optional[str] = None

    class Config:
        from_attributes = True


class FeedPollResult(BaseModel):
    feed_source_id: int
    feed_source_name: str
    success: bool
    items_found: int
    new_items: int
    error_message: Optional[str] = None
    polled_at: datetime
