from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_

import feedparser

from ....models import (
    RegulatoryFeedSource, RegulatoryFeedItem, Tenant, GRCUser, get_db
)
from ....schemas import (
    RegulatoryFeedSourceCreate, RegulatoryFeedSourceUpdate, RegulatoryFeedSourceResponse,
    RegulatoryFeedItemResponse, FeedPollResult, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/regulatory-feeds", tags=["Governance - Regulatory Feed Management"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_feed_source(source: RegulatoryFeedSource) -> RegulatoryFeedSourceResponse:
    return RegulatoryFeedSourceResponse(
        id=source.id,
        tenant_id=source.tenant_id,
        name=source.name,
        source_url=source.source_url,
        source_type=source.source_type,
        country=source.country,
        regulator=source.regulator,
        category=source.category,
        is_active=source.is_active,
        poll_interval_hours=source.poll_interval_hours,
        last_polled_at=source.last_polled_at,
        last_successful_poll=source.last_successful_poll,
        items_processed=source.items_processed,
        created_at=source.created_at,
        updated_at=source.updated_at
    )


def serialize_feed_item(item: RegulatoryFeedItem) -> RegulatoryFeedItemResponse:
    return RegulatoryFeedItemResponse(
        id=item.id,
        tenant_id=item.tenant_id,
        feed_source_id=item.feed_source_id,
        guid=item.guid,
        title=item.title,
        description=item.description,
        link=item.link,
        published_date=item.published_date,
        content=item.content,
        status=item.status,
        regulatory_change_id=item.regulatory_change_id,
        processed_at=item.processed_at,
        ai_analysis=item.ai_analysis,
        created_at=item.created_at,
        feed_source_name=item.feed_source.name if item.feed_source else None
    )


def poll_rss_feed(source: RegulatoryFeedSource, db: Session, tenant_id: int) -> FeedPollResult:
    """
    Poll an RSS feed and create new RegulatoryFeedItem records for new entries.
    """
    now = datetime.utcnow()
    source.last_polled_at = now
    
    try:
        feed = feedparser.parse(source.source_url)
        
        if feed.bozo and not feed.entries:
            db.commit()
            return FeedPollResult(
                feed_source_id=source.id,
                feed_source_name=source.name,
                success=False,
                items_found=0,
                new_items=0,
                error_message=f"Failed to parse feed: {str(feed.bozo_exception) if hasattr(feed, 'bozo_exception') else 'Unknown error'}",
                polled_at=now
            )
        
        items_found = len(feed.entries)
        new_items = 0
        
        for entry in feed.entries:
            guid = entry.get('id') or entry.get('link') or entry.get('title', '')
            
            if not guid:
                continue
            
            existing = db.query(RegulatoryFeedItem).filter(
                RegulatoryFeedItem.feed_source_id == source.id,
                RegulatoryFeedItem.guid == guid
            ).first()
            
            if existing:
                continue
            
            published_date = None
            if hasattr(entry, 'published_parsed') and entry.published_parsed:
                try:
                    published_date = datetime(*entry.published_parsed[:6])
                except (TypeError, ValueError):
                    pass
            elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                try:
                    published_date = datetime(*entry.updated_parsed[:6])
                except (TypeError, ValueError):
                    pass
            
            description = entry.get('summary') or entry.get('description', '')
            content = ''
            if hasattr(entry, 'content') and entry.content:
                content = entry.content[0].get('value', '')
            
            new_item = RegulatoryFeedItem(
                tenant_id=tenant_id,
                feed_source_id=source.id,
                guid=guid,
                title=entry.get('title', 'Untitled'),
                description=description[:10000] if description else None,
                link=entry.get('link'),
                published_date=published_date,
                content=content[:50000] if content else None,
                status="new"
            )
            
            db.add(new_item)
            new_items += 1
        
        source.last_successful_poll = now
        source.items_processed = (source.items_processed or 0) + new_items
        db.commit()
        
        return FeedPollResult(
            feed_source_id=source.id,
            feed_source_name=source.name,
            success=True,
            items_found=items_found,
            new_items=new_items,
            error_message=None,
            polled_at=now
        )
        
    except Exception as e:
        db.rollback()
        source.last_polled_at = now
        db.commit()
        
        return FeedPollResult(
            feed_source_id=source.id,
            feed_source_name=source.name,
            success=False,
            items_found=0,
            new_items=0,
            error_message=str(e),
            polled_at=now
        )


@router.get("/sources", response_model=List[RegulatoryFeedSourceResponse])
def list_feed_sources(
    tenant_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    country: Optional[str] = None,
    regulator: Optional[str] = None,
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """List all feed sources for the user's tenants."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RegulatoryFeedSource.tenant_id == tenant_id)
    if is_active is not None:
        query = query.filter(RegulatoryFeedSource.is_active == is_active)
    if country:
        query = query.filter(RegulatoryFeedSource.country == country)
    if regulator:
        query = query.filter(RegulatoryFeedSource.regulator == regulator)
    if category:
        query = query.filter(RegulatoryFeedSource.category == category)
    
    sources = query.order_by(RegulatoryFeedSource.created_at.desc()).offset(skip).limit(limit).all()
    return [serialize_feed_source(s) for s in sources]


@router.post("/sources", response_model=RegulatoryFeedSourceResponse, status_code=status.HTTP_201_CREATED)
def create_feed_source(
    source: RegulatoryFeedSourceCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Create a new feed source."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
    valid_source_types = ["rss", "atom", "api"]
    if source.source_type not in valid_source_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source_type. Must be one of: {', '.join(valid_source_types)}"
        )
    
    db_source = RegulatoryFeedSource(
        tenant_id=tenant_id,
        name=source.name,
        source_url=source.source_url,
        source_type=source.source_type,
        country=source.country,
        regulator=source.regulator,
        category=source.category,
        is_active=source.is_active,
        poll_interval_hours=source.poll_interval_hours
    )
    
    db.add(db_source)
    db.commit()
    db.refresh(db_source)
    
    return serialize_feed_source(db_source)


@router.get("/sources/{source_id}", response_model=RegulatoryFeedSourceResponse)
def get_feed_source(
    source_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get a specific feed source by ID."""
    user_tenants = get_user_tenants(current_user, db)
    
    source = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.id == source_id,
        RegulatoryFeedSource.tenant_id.in_(user_tenants)
    ).first()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feed source not found"
        )
    
    return serialize_feed_source(source)


@router.put("/sources/{source_id}", response_model=RegulatoryFeedSourceResponse)
def update_feed_source(
    source_id: int,
    source_update: RegulatoryFeedSourceUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Update a feed source."""
    user_tenants = get_user_tenants(current_user, db)
    
    db_source = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.id == source_id,
        RegulatoryFeedSource.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feed source not found"
        )
    
    update_data = source_update.model_dump(exclude_unset=True)
    
    if "source_type" in update_data:
        valid_source_types = ["rss", "atom", "api"]
        if update_data["source_type"] not in valid_source_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid source_type. Must be one of: {', '.join(valid_source_types)}"
            )
    
    for field, value in update_data.items():
        setattr(db_source, field, value)
    
    db.commit()
    db.refresh(db_source)
    
    return serialize_feed_source(db_source)


@router.delete("/sources/{source_id}", response_model=MessageResponse)
def delete_feed_source(
    source_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Delete a feed source and all its items."""
    user_tenants = get_user_tenants(current_user, db)
    
    db_source = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.id == source_id,
        RegulatoryFeedSource.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feed source not found"
        )
    
    source_name = db_source.name
    db.delete(db_source)
    db.commit()
    
    return MessageResponse(message=f"Feed source '{source_name}' deleted successfully")


@router.post("/sources/{source_id}/poll", response_model=FeedPollResult)
def poll_feed_source(
    source_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Manually poll a specific feed source for new items."""
    user_tenants = get_user_tenants(current_user, db)
    
    source = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.id == source_id,
        RegulatoryFeedSource.tenant_id.in_(user_tenants)
    ).first()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feed source not found"
        )
    
    result = poll_rss_feed(source, db, source.tenant_id)
    return result


@router.post("/poll-all", response_model=List[FeedPollResult])
def poll_all_feeds(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Poll all active feeds for the user's primary tenant."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
    sources = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.tenant_id == tenant_id,
        RegulatoryFeedSource.is_active == True
    ).all()
    
    results = []
    for source in sources:
        result = poll_rss_feed(source, db, tenant_id)
        results.append(result)
    
    return results


@router.get("/items", response_model=List[RegulatoryFeedItemResponse])
def list_feed_items(
    tenant_id: Optional[int] = None,
    feed_source_id: Optional[int] = None,
    status: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """List feed items with optional filters."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RegulatoryFeedItem).options(
        joinedload(RegulatoryFeedItem.feed_source)
    ).filter(
        RegulatoryFeedItem.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RegulatoryFeedItem.tenant_id == tenant_id)
    if feed_source_id:
        query = query.filter(RegulatoryFeedItem.feed_source_id == feed_source_id)
    if status:
        query = query.filter(RegulatoryFeedItem.status == status)
    if date_from:
        query = query.filter(RegulatoryFeedItem.published_date >= date_from)
    if date_to:
        query = query.filter(RegulatoryFeedItem.published_date <= date_to)
    if search:
        search_filter = or_(
            RegulatoryFeedItem.title.ilike(f"%{search}%"),
            RegulatoryFeedItem.description.ilike(f"%{search}%")
        )
        query = query.filter(search_filter)
    
    items = query.order_by(RegulatoryFeedItem.published_date.desc().nullslast()).offset(skip).limit(limit).all()
    return [serialize_feed_item(item) for item in items]


@router.get("/items/{item_id}", response_model=RegulatoryFeedItemResponse)
def get_feed_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get a specific feed item by ID."""
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(RegulatoryFeedItem).options(
        joinedload(RegulatoryFeedItem.feed_source)
    ).filter(
        RegulatoryFeedItem.id == item_id,
        RegulatoryFeedItem.tenant_id.in_(user_tenants)
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feed item not found"
        )
    
    return serialize_feed_item(item)


@router.post("/seed-cbsl", response_model=List[RegulatoryFeedSourceResponse])
def seed_cbsl_feeds(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Create default Sri Lanka Central Bank (CBSL) feed sources.
    Note: RSS URLs are placeholders and may need to be updated with actual CBSL RSS feed URLs.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
    cbsl_feeds = [
        {
            "name": "CBSL Notices",
            "source_url": "https://www.cbsl.gov.lk/en/rss/notices",
            "source_type": "rss",
            "country": "Sri Lanka",
            "regulator": "Central Bank of Sri Lanka",
            "category": "notices",
            "is_active": True,
            "poll_interval_hours": 24
        },
        {
            "name": "CBSL Monetary Policy",
            "source_url": "https://www.cbsl.gov.lk/en/rss/monetary-policy",
            "source_type": "rss",
            "country": "Sri Lanka",
            "regulator": "Central Bank of Sri Lanka",
            "category": "monetary_policy",
            "is_active": True,
            "poll_interval_hours": 24
        }
    ]
    
    created_sources = []
    
    for feed_data in cbsl_feeds:
        existing = db.query(RegulatoryFeedSource).filter(
            RegulatoryFeedSource.tenant_id == tenant_id,
            RegulatoryFeedSource.source_url == feed_data["source_url"]
        ).first()
        
        if existing:
            created_sources.append(serialize_feed_source(existing))
            continue
        
        db_source = RegulatoryFeedSource(
            tenant_id=tenant_id,
            **feed_data
        )
        db.add(db_source)
        db.flush()
        created_sources.append(serialize_feed_source(db_source))
    
    db.commit()
    
    return created_sources
