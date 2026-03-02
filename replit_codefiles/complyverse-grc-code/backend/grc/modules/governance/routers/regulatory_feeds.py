from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import json
import os

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_

import feedparser
from openai import OpenAI

from ....models import (
    RegulatoryFeedSource, RegulatoryFeedItem, Tenant, GRCUser, get_db,
    Framework, NormalizedControl, GovernanceDocument,
    RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask
)
from ....schemas import (
    RegulatoryFeedSourceCreate, RegulatoryFeedSourceUpdate, RegulatoryFeedSourceResponse,
    RegulatoryFeedItemResponse, FeedPollResult, MessageResponse, RegulatoryChangeResponse
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


def get_openai_client() -> OpenAI:
    """Get OpenAI client with proper configuration"""
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI features unavailable. OpenAI API key not configured.")
    is_modelfarm = "modelfarm" in (base_url or "")
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(status_code=503, detail="AI features unavailable. OpenAI API key not configured.")
    return OpenAI(api_key=api_key, base_url=base_url)


def analyze_regulatory_item(
    item: RegulatoryFeedItem,
    frameworks: List[Framework],
    controls: List[NormalizedControl],
    policies: List[GovernanceDocument],
    db: Session
) -> Dict[str, Any]:
    """
    Perform AI gap analysis on a regulatory feed item.
    Returns a dictionary containing the analysis results.
    """
    client = get_openai_client()
    
    source_info = "Unknown"
    if item.feed_source:
        source_info = f"{item.feed_source.regulator or 'Unknown Regulator'} ({item.feed_source.country or 'Unknown Country'})"
    
    frameworks_text = "\n".join([
        f"- {fw.name} ({fw.short_code}): {fw.description or 'No description'}"
        for fw in frameworks
    ]) if frameworks else "No frameworks registered"
    
    controls_sample = controls[:50] if len(controls) > 50 else controls
    controls_text = "\n".join([
        f"- {ctrl.code}: {ctrl.name}"
        for ctrl in controls_sample
    ]) if controls_sample else "No controls registered"
    
    policies_text = "\n".join([
        f"- {pol.title}"
        for pol in policies
    ]) if policies else "No policies registered"
    
    content_text = item.content or item.description or "No content available"
    if len(content_text) > 8000:
        content_text = content_text[:8000] + "... [truncated]"
    
    prompt = f"""You are a Senior GRC Compliance Expert analyzing regulatory changes. Analyze this regulatory update and assess its impact on existing compliance frameworks and controls.

REGULATORY UPDATE:
Title: {item.title}
Source: {source_info}
Published: {item.published_date.strftime('%Y-%m-%d') if item.published_date else 'Unknown'}
Content: {content_text}
Link: {item.link or 'No link available'}

EXISTING FRAMEWORKS:
{frameworks_text}

EXISTING CONTROLS (sample):
{controls_text}

EXISTING POLICIES:
{policies_text}

Provide your analysis in JSON format:
{{
  "summary": "Brief summary of the regulatory change",
  "priority": "critical|high|medium|low",
  "effective_date_estimate": "YYYY-MM-DD or null if unknown",
  "impacted_frameworks": [{{"name": "framework name", "relevance": "high|medium|low", "reason": "why impacted"}}],
  "impacted_controls": [{{"id": "control id", "name": "control name", "gap_type": "new_requirement|modification|obsolete", "action_needed": "description"}}],
  "impacted_policies": [{{"title": "policy title", "action_needed": "review|update|create_new"}}],
  "implementation_tasks": [{{"title": "task title", "description": "what needs to be done", "priority": "high|medium|low", "suggested_deadline_days": 30}}],
  "compliance_gaps": ["list of identified gaps"],
  "recommendations": ["list of recommended actions"]
}}

Return ONLY valid JSON, no other text."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a Senior GRC Compliance Expert. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4000
        )
        
        response_text = response.choices[0].message.content.strip()
        
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].strip() == "```":
                lines = lines[:-1]
            response_text = "\n".join(lines)
        
        analysis = json.loads(response_text)
        
        analysis["analyzed_at"] = datetime.utcnow().isoformat()
        analysis["model_used"] = "gpt-4o"
        analysis["frameworks_analyzed"] = len(frameworks)
        analysis["controls_analyzed"] = len(controls)
        analysis["policies_analyzed"] = len(policies)
        
        return analysis
        
    except json.JSONDecodeError as e:
        return {
            "error": f"Failed to parse AI response: {str(e)}",
            "raw_response": response_text[:1000] if 'response_text' in locals() else None,
            "analyzed_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"AI analysis failed: {str(e)}"
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


@router.post("/items/{item_id}/analyze", response_model=RegulatoryFeedItemResponse)
def analyze_feed_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Perform AI gap analysis on a regulatory feed item.
    Analyzes the item against existing frameworks, controls, and policies.
    """
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
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
    
    frameworks = db.query(Framework).filter(
        Framework.is_active == True
    ).all()
    
    controls = db.query(NormalizedControl).all()
    
    policies = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id == tenant_id,
        GovernanceDocument.doc_type == "policy"
    ).all()
    
    analysis = analyze_regulatory_item(item, frameworks, controls, policies, db)
    
    item.ai_analysis = analysis
    item.status = "analyzed"
    db.commit()
    db.refresh(item)
    
    return serialize_feed_item(item)


@router.post("/items/{item_id}/convert", response_model=RegulatoryChangeResponse)
def convert_feed_item_to_regulatory_change(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Convert a feed item to a RegulatoryChange record.
    Creates impact assessments and implementation tasks from AI analysis.
    """
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
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
    
    if item.regulatory_change_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Feed item already converted to regulatory change"
        )
    
    ai_analysis = item.ai_analysis or {}
    
    source_name = "custom"
    if item.feed_source:
        regulator = item.feed_source.regulator or ""
        if "OCC" in regulator.upper():
            source_name = "OCC"
        elif "FED" in regulator.upper() or "FEDERAL RESERVE" in regulator.upper():
            source_name = "Fed"
        elif "EBA" in regulator.upper():
            source_name = "EBA"
        elif "PRA" in regulator.upper():
            source_name = "PRA"
        elif "SEC" in regulator.upper():
            source_name = "SEC"
        elif "FINRA" in regulator.upper():
            source_name = "FINRA"
    
    priority = ai_analysis.get("priority", "medium")
    if priority not in ["critical", "high", "medium", "low"]:
        priority = "medium"
    
    effective_date = None
    effective_date_str = ai_analysis.get("effective_date_estimate")
    if effective_date_str and effective_date_str != "null":
        try:
            effective_date = datetime.strptime(effective_date_str, "%Y-%m-%d")
        except (ValueError, TypeError):
            pass
    
    regulatory_change = RegulatoryChange(
        tenant_id=tenant_id,
        title=item.title,
        description=ai_analysis.get("summary") or item.description,
        source=source_name,
        regulation_reference=item.link,
        effective_date=effective_date,
        published_date=item.published_date,
        status="identified",
        priority=priority,
        created_by=current_user.id
    )
    
    db.add(regulatory_change)
    db.flush()
    
    impacted_policies = ai_analysis.get("impacted_policies", [])
    for policy_impact in impacted_policies:
        policy_title = policy_impact.get("title", "")
        action_needed = policy_impact.get("action_needed", "review")
        
        gap_identified = action_needed in ["update", "create_new"]
        
        impact_assessment = RegulatoryImpactAssessment(
            tenant_id=tenant_id,
            regulatory_change_id=regulatory_change.id,
            assessment_type="policy",
            impacted_item_type="policy",
            impact_level="medium",
            impact_description=f"Policy '{policy_title}' requires {action_needed}",
            gap_identified=gap_identified,
            gap_description=f"Action needed: {action_needed}" if gap_identified else None,
            assessed_by=current_user.id,
            assessed_at=datetime.utcnow()
        )
        db.add(impact_assessment)
    
    impacted_controls = ai_analysis.get("impacted_controls", [])
    for control_impact in impacted_controls:
        control_id = control_impact.get("id", "")
        control_name = control_impact.get("name", "")
        gap_type = control_impact.get("gap_type", "modification")
        action_needed = control_impact.get("action_needed", "")
        
        impact_level = "high" if gap_type == "new_requirement" else "medium"
        gap_identified = gap_type in ["new_requirement", "modification"]
        
        impact_assessment = RegulatoryImpactAssessment(
            tenant_id=tenant_id,
            regulatory_change_id=regulatory_change.id,
            assessment_type="control",
            impacted_item_type="control",
            impact_level=impact_level,
            impact_description=f"Control '{control_id}: {control_name}' - {gap_type}",
            gap_identified=gap_identified,
            gap_description=action_needed if gap_identified else None,
            assessed_by=current_user.id,
            assessed_at=datetime.utcnow()
        )
        db.add(impact_assessment)
    
    implementation_tasks = ai_analysis.get("implementation_tasks", [])
    for task_data in implementation_tasks:
        task_title = task_data.get("title", "Implementation Task")
        task_description = task_data.get("description", "")
        task_priority = task_data.get("priority", "medium")
        deadline_days = task_data.get("suggested_deadline_days", 30)
        
        if task_priority not in ["critical", "high", "medium", "low"]:
            task_priority = "medium"
        
        due_date = datetime.utcnow() + timedelta(days=deadline_days)
        
        task_type = "process_change"
        title_lower = task_title.lower()
        if "policy" in title_lower:
            task_type = "policy_update"
        elif "control" in title_lower:
            task_type = "control_update"
        elif "training" in title_lower:
            task_type = "training"
        elif "communication" in title_lower or "notify" in title_lower:
            task_type = "communication"
        
        impl_task = RegulatoryImplementationTask(
            tenant_id=tenant_id,
            regulatory_change_id=regulatory_change.id,
            title=task_title,
            description=task_description,
            task_type=task_type,
            status="pending",
            priority=task_priority,
            due_date=due_date,
            created_by=current_user.id
        )
        db.add(impl_task)
    
    item.status = "processed"
    item.regulatory_change_id = regulatory_change.id
    item.processed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(regulatory_change)
    
    completed_tasks = sum(1 for t in regulatory_change.implementation_tasks if t.status == "completed")
    
    return RegulatoryChangeResponse(
        id=regulatory_change.id,
        tenant_id=regulatory_change.tenant_id,
        title=regulatory_change.title,
        description=regulatory_change.description,
        source=regulatory_change.source,
        regulation_reference=regulatory_change.regulation_reference,
        effective_date=regulatory_change.effective_date,
        published_date=regulatory_change.published_date,
        status=regulatory_change.status,
        priority=regulatory_change.priority,
        assigned_to=regulatory_change.assigned_to,
        assignee_name=regulatory_change.assignee.display_name if regulatory_change.assignee else None,
        created_by=regulatory_change.created_by,
        creator_name=regulatory_change.creator.display_name if regulatory_change.creator else None,
        created_at=regulatory_change.created_at,
        updated_at=regulatory_change.updated_at,
        assessment_count=len(regulatory_change.impact_assessments),
        task_count=len(regulatory_change.implementation_tasks),
        completed_task_count=completed_tasks
    )


@router.post("/seed-cbsl", response_model=List[RegulatoryFeedSourceResponse])
def seed_regulatory_feeds(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Create default regulatory feed sources from Federal Reserve and European Central Bank.
    These are working RSS feeds that provide real regulatory updates.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
    regulatory_feeds = [
        {
            "name": "Federal Reserve - All Press Releases",
            "source_url": "https://www.federalreserve.gov/feeds/press_all.xml",
            "source_type": "rss",
            "country": "United States",
            "regulator": "Federal Reserve Board",
            "category": "press_releases",
            "is_active": True,
            "poll_interval_hours": 12
        },
        {
            "name": "Federal Reserve - Banking Regulatory Policy",
            "source_url": "https://www.federalreserve.gov/feeds/press_bcreg.xml",
            "source_type": "rss",
            "country": "United States",
            "regulator": "Federal Reserve Board",
            "category": "regulatory_policy",
            "is_active": True,
            "poll_interval_hours": 12
        },
        {
            "name": "ECB - Press Releases & Speeches",
            "source_url": "https://www.ecb.europa.eu/rss/press.html",
            "source_type": "rss",
            "country": "European Union",
            "regulator": "European Central Bank",
            "category": "press_releases",
            "is_active": True,
            "poll_interval_hours": 12
        }
    ]
    
    created_sources = []
    
    for feed_data in regulatory_feeds:
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


@router.post("/sources", response_model=RegulatoryFeedSourceResponse)
def create_feed_source(
    source_data: RegulatoryFeedSourceCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Create a custom regulatory feed source with a user-provided RSS URL.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
    existing = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.tenant_id == tenant_id,
        RegulatoryFeedSource.source_url == source_data.source_url
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A feed source with this URL already exists"
        )
    
    db_source = RegulatoryFeedSource(
        tenant_id=tenant_id,
        name=source_data.name,
        source_url=source_data.source_url,
        source_type=source_data.source_type or "rss",
        country=source_data.country or "Unknown",
        regulator=source_data.regulator or "Unknown",
        category=source_data.category or "general",
        is_active=source_data.is_active if source_data.is_active is not None else True,
        poll_interval_hours=source_data.poll_interval_hours or 24
    )
    db.add(db_source)
    db.commit()
    db.refresh(db_source)
    
    return serialize_feed_source(db_source)


@router.delete("/sources/{source_id}", response_model=MessageResponse)
def delete_feed_source(
    source_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Delete a regulatory feed source and all its associated feed items.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not assigned to any tenant"
        )
    
    source = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.id == source_id,
        RegulatoryFeedSource.tenant_id == tenant_id
    ).first()
    
    if not source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feed source not found"
        )
    
    source_name = source.name
    
    # Delete associated feed items first
    db.query(RegulatoryFeedItem).filter(
        RegulatoryFeedItem.feed_source_id == source_id
    ).delete(synchronize_session=False)
    
    # Delete the source
    db.delete(source)
    db.commit()
    
    return MessageResponse(message=f"Feed source '{source_name}' and its items deleted successfully")
