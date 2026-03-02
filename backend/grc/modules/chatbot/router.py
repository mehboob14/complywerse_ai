"""
ComplyChatRouter - AI-Powered Compliance Q&A Integration
Integrates RAG-based chatbot into the main GRC platform
"""

import os
import sys
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
from collections import deque
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

# Add complychat to path
complychat_path = Path(__file__).parent / "complychat" / "complychat"
sys.path.insert(0, str(complychat_path))

logger = logging.getLogger(__name__)

# ============================================================================
# CONVERSATION HISTORY STORAGE (In-memory for now - last 10 queries per session)
# ============================================================================
conversation_history: Dict[str, deque] = {}  # {user_id: deque of last 10 messages}
MAX_HISTORY_LENGTH = 10

try:
    from grc_sql_agent import (
        detect_query_type, generate_sql_query, validate_sql, format_query_results,
        validate_columns_in_sql, get_fallback_data_for_question, generate_answer_from_fallback_data,
        load_full_database_schema
    )  # type: ignore
    SQL_AGENT_ENABLED = True
    logger.info("[YES] SQL Agent loaded successfully (ChromaDB disabled)")
    # Pre-load database schema at startup
    load_full_database_schema()
except ImportError as e:
    logging.error(f"Failed to import SQL agent: {e}")
    SQL_AGENT_ENABLED = False

from ...models import GRCUser, get_db
from ...routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/ai/complychat", tags=["AI Compliance Chat"])
logger = logging.getLogger(__name__)


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class ChatRequest(BaseModel):
    """Chat request model"""
    message: str = Field(..., description="User's GRC question (compliance, risk, governance, audit, etc.)", min_length=1)
    framework: Optional[str] = Field(None, description="Filter by framework code (e.g., 'PCI_DSS', 'ISO_27001')")
    include_sources: bool = Field(True, description="Include source references in response")
    session_id: Optional[str] = Field(None, description="Session ID for conversation history tracking")
    limit: int = Field(10, description="Number of results to return (default 10 for pagination)")
    offset: int = Field(0, description="Offset for pagination (0 = first page)")


class ChatSource(BaseModel):
    """Source reference model"""
    rank: int
    entity_type: str
    entity_id: Optional[str] = ""
    framework_code: str
    control_code: Optional[str] = None
    control_name: Optional[str] = None
    relevance_score: float
    snippet: str


class ChatResponse(BaseModel):
    """Chat response model"""
    answer: str
    sources: List[ChatSource]
    framework_filter: Optional[str]
    timestamp: str
    has_more: bool = Field(False, description="Whether more results are available")
    total_count: int = Field(0, description="Total number of results available")
    current_offset: int = Field(0, description="Current offset in results")


class FrameworkInfo(BaseModel):
    """Framework information model"""
    id: Optional[str] = None
    code: str
    name: str
    version: Optional[str] = ""
    description: Optional[str] = ""


class StatsResponse(BaseModel):
    """Knowledge base statistics"""
    total_entities: int
    entity_types: Dict[str, int]
    available_frameworks: List[FrameworkInfo]


class TriggerEmbeddingRequest(BaseModel):
    """Request to trigger embedding regeneration"""
    entity_types: Optional[List[str]] = Field(None, description="Specific entity types to update")
    async_mode: bool = Field(True, description="Run in background (non-blocking)")


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("/ask", response_model=ChatResponse)
async def ask_compliance_question(
    request: ChatRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Ask ANY question and get AI-powered answers from direct SQL queries.
    
    **PURE SQL INTELLIGENCE - No ChromaDB, No Embeddings**
    - ALL queries (data + compliance) go through SQL Agent
    - Queries actual database tables for 100% accurate, real-time answers
    - No sync delays, no embedding confusion, just direct data
    - **Conversation context**: Last 10 queries are remembered for follow-up questions
    
    **Example Questions:**
    - "List all critical vulnerabilities" [>] Direct SQL query
    - "Show me more details about the first one" [>] Uses context from previous query
    - "What does PCI DSS require for encryption?" [>] Query grc_framework_controls table
    - "How about ISO 27001?" [>] Understands reference to previous topic
    """
    # Add no-cache headers to prevent any caching
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    
    # Import SQL agent functions at the start
    from .complychat.complychat.grc_sql_agent import (
        generate_sql_query,
        validate_sql,
        validate_columns_in_sql,
        format_query_results,
        fetch_table_schema_from_db,
        get_fallback_data_for_question,
        generate_answer_from_fallback_data
    )

    # === Deterministic handling for active certification journey framework counts ===
    normalized_question = request.message.lower()
    if (
        ("journey" in normalized_question or "certification" in normalized_question)
        and "active" in normalized_question
        and "framework" in normalized_question
    ):
        tenant_ids = get_user_tenants(current_user, db)
        if not tenant_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No tenant context available for this user."
            )

        tenant_filter = ",".join(str(int(tid)) for tid in tenant_ids)

        journey_sql = f"""
            SELECT
                cj.id,
                cj.status,
                COALESCE(f.name, uf.name, cj.name) AS framework_name
            FROM grc_certification_journeys cj
            LEFT JOIN grc_frameworks f ON f.id = cj.framework_id
            LEFT JOIN grc_uploaded_frameworks uf ON uf.id = cj.uploaded_framework_id
            WHERE cj.status IN ('in_progress', 'active')
              AND cj.tenant_id IN ({tenant_filter})
        """

        result = db.execute(text(journey_sql))
        rows = result.fetchall()
        framework_names = [row._mapping.get("framework_name") for row in rows if row._mapping.get("framework_name")]
        unique_frameworks = sorted(set(framework_names))
        total_active = len(unique_frameworks)

        answer_lines = [
            f"Total Active Frameworks: {total_active}",
        ]
        if unique_frameworks:
            answer_lines.append("")
            answer_lines.append("Active Certification Journeys:")
            for name in unique_frameworks:
                answer_lines.append(f"- {name}")

        answer = "\n".join(answer_lines)

        sources = [ChatSource(
            rank=1,
            entity_type="certification",
            entity_id="",
            framework_code="SQL",
            control_code=None,
            control_name=f"Direct Database Query ({len(rows)} results)",
            relevance_score=1.0,
            snippet=f"Executed SQL query returned {len(rows)} results"
        )] if request.include_sources else []

        return ChatResponse(
            answer=answer,
            sources=sources,
            framework_filter="SQL_DIRECT_QUERY",
            timestamp=datetime.utcnow().isoformat(),
            has_more=False,
            total_count=len(rows),
            current_offset=0
        )
    
    # Get session ID (use user_id if no session_id provided)
    session_id = request.session_id or f"user_{current_user.id}"
    
    # Initialize conversation history for this session if needed
    if session_id not in conversation_history:
        conversation_history[session_id] = deque(maxlen=MAX_HISTORY_LENGTH)
    
    # Get recent history for context
    recent_history = list(conversation_history[session_id])
    context_summary = ""
    if recent_history:
        context_summary = "\n\n**Recent conversation context:**\n"
        for i, msg in enumerate(recent_history[-3:], 1):  # Last 3 exchanges
            context_summary += f"{i}. Q: {msg['question'][:100]}...\n   A: {msg['answer'][:100]}...\n"
    
    logger.info(f"\n{'='*60}\n🤖 NEW QUESTION: {request.message}\nSession: {session_id}\nHistory: {len(recent_history)} messages\nFramework filter: {request.framework}\n{'='*60}")
    
    if not SQL_AGENT_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SQL Agent service is not available."
        )
    
    try:
        # Enhance question with context if user references previous conversation
        enhanced_question = request.message
        reference_words = ['that', 'it', 'them', 'those', 'this', 'first', 'second', 'last', 'previous', 'above']
        if any(word in request.message.lower() for word in reference_words) and recent_history:
            enhanced_question = f"{request.message}\n\nContext from previous query: {recent_history[-1]['question']}"
            logger.info(f"💡 Enhanced question with context: {enhanced_question}")
        
        # 🤖 STEP 1: Generate SQL query from natural language
        logger.info("[STATS] Generating SQL query from question...")
        sql_result = generate_sql_query(enhanced_question, language="en", limit=request.limit, offset=request.offset)
        
        if not sql_result.get('sql') or not validate_sql(sql_result['sql']):
            # If no valid SQL generated, return explanation
            answer = sql_result.get('explanation', 'Unable to process this question as a SQL query.')
            
            # Save to history
            conversation_history[session_id].append({
                'question': request.message,
                'answer': answer,
                'timestamp': datetime.utcnow().isoformat(),
                'sql': None
            })
            
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )
        
        # [SEARCH] STEP 2: Validate columns BEFORE execution
        sql_query = sql_result['sql']
        
        # Validate that all columns exist in database
        validation = validate_columns_in_sql(sql_query)
        if not validation['valid']:
            logger.warning(f"[WARN]️ Column validation failed: {validation['errors']}")
            
            # [REFRESH] SMART RETRY: Auto-fetch real schema and regenerate query
            logger.info("[REFRESH] ATTEMPTING SMART RETRY: Fetching actual table schemas...")
            
            # Extract table names from failed query
            import re
            table_pattern = r'FROM\s+(\w+)|JOIN\s+(\w+)'
            tables = set()
            for match in re.finditer(table_pattern, sql_query, re.IGNORECASE):
                table_name = match.group(1) or match.group(2)
                if table_name:
                    tables.add(table_name)
            
            logger.info(f"[STATS] Tables in failed query: {tables}")
            
            # Fetch real schemas for these tables
            updated_schema_info = []
            for table in tables:
                try:
                    schema_text = fetch_table_schema_from_db(table)
                    if schema_text:
                        updated_schema_info.append(schema_text)
                        logger.info(f"  [YES] Fetched schema for {table}")
                except Exception as e:
                    logger.warning(f"  [WARN]️ Could not fetch schema for {table}: {e}")
            
            if updated_schema_info:
                # Retry query generation with real schema
                logger.info("[REFRESH] Retrying query generation with actual schema...")
                retry_prompt = f"""
PREVIOUS QUERY FAILED - Column names were incorrect.

ACTUAL TABLE SCHEMAS (from database):
{chr(10).join(updated_schema_info)}

ORIGINAL QUESTION: {request.message}

Generate new SQL using ONLY the column names listed above.
"""
                
                retry_result = generate_sql_query(
                    retry_prompt,
                    language="en",
                    offset=request.offset,
                    limit=request.limit
                )
                
                if retry_result and retry_result.get('sql'):
                    logger.info(f"[YES] RETRY SUCCESSFUL: New SQL generated")
                    sql_query = retry_result['sql']
                    sql_result = retry_result
                    # Re-validate new query
                    validation = validate_columns_in_sql(sql_query)
                    if not validation['valid']:
                        logger.error("[FAIL] RETRY FAILED: New query still has column errors")
                        answer = f"**Unable to Query This Data**\n\nThe system tried multiple times but couldn't find the correct database structure for your question.\n\nValidation errors:\n" + "\n".join(f"- {e}" for e in validation['errors']) + "\n\n💡 Try a simpler question or contact support."
                        return ChatResponse(
                            answer=answer,
                            sources=[],
                            framework_filter=request.framework,
                            timestamp=datetime.utcnow().isoformat(),
                            has_more=False,
                            total_count=0,
                            current_offset=0
                        )
                else:
                    logger.error("[FAIL] RETRY FAILED: Could not regenerate query")
            
            # If retry failed or no schema found, return friendly error
            if not validation['valid']:
                logger.error("[FAIL] Final validation failed - returning error to user")
                for error in validation['errors']:
                    logger.warning(f"  - {error}")
                
                answer = f"**Unable to Query This Data**\n\nThe database structure for this question is not yet fully mapped.\n\n💡 **Suggestions:**\n- Try asking about frameworks, controls, or vulnerabilities\n- Use simpler queries like 'Show all [item type]'\n- This feature may be available soon as more data is added\n\n*Error details: Column validation failed for the requested data*"
                
                return ChatResponse(
                    answer=answer,
                    sources=[],
                    framework_filter=request.framework,
                    timestamp=datetime.utcnow().isoformat(),
                    has_more=False,
                    total_count=0,
                    current_offset=0
                )
        
        # [SEARCH] STEP 3: Execute SQL query
        from sqlalchemy import text
        logger.info(f"[SEARCH] Executing SQL: {sql_query[:200]}...")
        
        try:
            # Get total count first (remove LIMIT/OFFSET for count query)
            count_query = sql_query.upper()
            if 'LIMIT' in count_query:
                count_query = sql_query[:sql_query.upper().rfind('LIMIT')].strip()
            count_sql = f"SELECT COUNT(*) as total FROM ({count_query}) as count_subquery"
            
            try:
                count_result = db.execute(text(count_sql))
                total_count = count_result.scalar() or 0
            except Exception as count_err:
                logger.warning(f"[WARN]️ Could not get total count: {count_err}")
                # Rollback to clear failed transaction
                try:
                    db.rollback()
                except:
                    pass
                total_count = 0
            
            # Execute paginated query
            result = db.execute(text(sql_query))
            rows = result.fetchall()
            
            # Convert rows to dicts
            data_list = [dict(row._mapping) for row in rows]
            logger.info(f"[YES] SQL returned {len(data_list)} rows (Total: {total_count}, Offset: {request.offset})")
            
            # Check if more results available
            has_more = (request.offset + len(data_list)) < total_count
            
            # [STYLE] STEP 3: Format results using AI
            # Add pagination context to formatting
            pagination_note = ""
            if total_count > request.limit:
                pagination_note = f"\n\n*Showing {request.offset + 1}-{request.offset + len(data_list)} of {total_count} total results*"
            answer = format_query_results(data_list, request.message, sql_query, language="en") + pagination_note
            
            # 💾 STEP 4: Save to conversation history
            conversation_history[session_id].append({
                'question': request.message,
                'answer': answer[:500],  # Store first 500 chars for context
                'timestamp': datetime.utcnow().isoformat(),
                'sql': sql_query[:200],  # Store truncated SQL
                'result_count': len(data_list),
                'total_count': total_count
            })
            logger.info(f"💾 Saved to history. Total messages in session: {len(conversation_history[session_id])}")
            
            # Build response with SQL metadata
            sources = [ChatSource(
                rank=1,
                entity_type=sql_result.get('entity_type', 'sql_query'),
                entity_id="",
                framework_code="SQL",
                control_code=None,
                control_name=f"Direct Database Query ({len(data_list)} results)",
                relevance_score=1.0,
                snippet=f"Executed SQL query returned {len(data_list)} results"
            )] if request.include_sources else []
            
            return ChatResponse(
                answer=answer,
                sources=sources,
                framework_filter="SQL_DIRECT_QUERY",
                timestamp=datetime.utcnow().isoformat(),
                has_more=has_more,
                total_count=total_count,
                current_offset=request.offset
            )
            
        except Exception as sql_error:
            # CRITICAL: Rollback transaction on error to prevent InFailedSqlTransaction state
            try:
                db.rollback()
                logger.info("[REFRESH] Transaction rolled back after SQL error")
            except Exception as rollback_err:
                logger.warning(f"[WARN]️ Rollback warning: {rollback_err}")
            
            logger.error(f"[FAIL] SQL execution error: {sql_error}")
            
            # [REFRESH] SMART RETRY: Check if it's a "no such column" error
            error_str = str(sql_error).lower()
            if 'no such column' in error_str or 'no such function' in error_str:
                logger.info("[REFRESH] DETECTED SCHEMA ERROR - Attempting smart retry...")
                
                # Extract table names from query
                import re
                table_pattern = r'FROM\s+(\w+)|JOIN\s+(\w+)'
                tables = set()
                for match in re.finditer(table_pattern, sql_query, re.IGNORECASE):
                    table_name = match.group(1) or match.group(2)
                    if table_name:
                        tables.add(table_name)
                
                # Fetch real schemas
                updated_schema_info = []
                for table in tables:
                    try:
                        schema_text = fetch_table_schema_from_db(table)
                        if schema_text:
                            updated_schema_info.append(schema_text)
                            logger.info(f"  [YES] Fetched {table} schema")
                    except Exception as e:
                        logger.warning(f"  [WARN]️ Failed to fetch {table} schema: {e}")
                
                if updated_schema_info:
                    # Retry with correct schema
                    retry_prompt = f"""
PREVIOUS QUERY FAILED WITH ERROR: {sql_error}

ACTUAL TABLE SCHEMAS (from database):
{chr(10).join(updated_schema_info)}

ORIGINAL QUESTION: {request.message}

Generate new SQL using ONLY the column names listed above. Use SQLite syntax (datetime('now'), LIKE, strftime).
"""
                    
                    retry_result = generate_sql_query(
                        retry_prompt,
                        language="en",
                        offset=request.offset,
                        limit=request.limit
                    )
                    
                    if retry_result and retry_result.get('sql'):
                        retry_sql = retry_result['sql']
                        logger.info(f"[REFRESH] RETRY SQL: {retry_sql[:150]}...")
                        
                        try:
                            # Try executing retry query
                            retry_exec = db.execute(text(retry_sql))
                            retry_rows = retry_exec.fetchall()
                            retry_data = [dict(row._mapping) for row in retry_rows]
                            
                            logger.info(f"[YES] RETRY SUCCESSFUL: {len(retry_data)} rows")
                            
                            # Check if empty result
                            if len(retry_data) == 0:
                                answer = f"## No Data Found\n\nThe query executed successfully but found no matching records.\n\n💡 This table may be empty or the filter criteria didn't match any data.\n\n**What was queried:** {request.message}"
                            else:
                                # Format successful retry results
                                answer = format_query_results(retry_data, request.message, retry_sql, language="en")
                                answer += f"\n\n*[YES] Query auto-corrected and returned {len(retry_data)} results*"
                            
                            return ChatResponse(
                                answer=answer,
                                sources=[],
                                framework_filter=request.framework,
                                timestamp=datetime.utcnow().isoformat(),
                                has_more=False,
                                total_count=len(retry_data),
                                current_offset=0
                            )
                        except Exception as retry_error:
                            logger.error(f"[FAIL] RETRY EXECUTION FAILED: {retry_error}")
                            db.rollback()
            
            # If retry failed or not a schema error, return friendly message
            logger.info("[REFRESH] No retry possible or retry failed - returning friendly error")
            
            # Check if it's empty data vs actual error
            if 'no such column' in error_str:
                answer = f"## Data Structure Not Available\n\nThe information you're asking about uses a database structure that isn't fully configured yet.\n\n💡 **Try these instead:**\n- 'Show all frameworks'\n- 'List vulnerabilities'\n- 'Show all controls'\n\n*This feature will be available as more data structures are added.*"
            elif 'no such table' in error_str:
                answer = f"## Feature Not Available\n\nThis type of data isn't available in the system yet.\n\n💡 **Available data:**\n- Compliance frameworks (NIST CSF, SAMA, BSL)\n- Vulnerabilities\n- Controls\n- Evidence\n\n*Additional features are being added regularly.*"
            else:
                answer = f"## Unable to Process Query\n\nThe system encountered an issue processing your question.\n\n💡 **Suggestions:**\n- Try rephrasing your question\n- Use simpler terms\n- Ask about specific items like 'Show frameworks' or 'List controls'\n\n*If this persists, contact support with this error: Query execution failed*"
            
            # Save error to history
            conversation_history[session_id].append({
                'question': request.message,
                'answer': answer[:500],
                'timestamp': datetime.utcnow().isoformat(),
                'sql': sql_query,
                'error': True,
                'auto_retry_attempted': True
            })
            
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )
        
    except Exception as e:
        logger.error(f"Error in complychat ask: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process question: {str(e)}"
        )


@router.get("/history/{session_id}")
async def get_conversation_history(
    session_id: str,
    current_user: GRCUser = Depends(require_auth)
):
    """
    Get conversation history for a session (last 10 queries).
    
    Returns the recent conversation context that the AI uses to understand follow-up questions.
    """
    if session_id not in conversation_history:
        return {"session_id": session_id, "messages": [], "count": 0}
    
    history = list(conversation_history[session_id])
    return {
        "session_id": session_id,
        "messages": history,
        "count": len(history),
        "max_length": MAX_HISTORY_LENGTH
    }


@router.delete("/history/{session_id}")
async def clear_conversation_history(
    session_id: str,
    current_user: GRCUser = Depends(require_auth)
):
    """
    Clear conversation history for a session.
    
    Use this to start a fresh conversation without context from previous queries.
    """
    if session_id in conversation_history:
        del conversation_history[session_id]
        logger.info(f"🗑️ Cleared history for session: {session_id}")
    
    return {"message": f"History cleared for session {session_id}", "success": True}


@router.get("/frameworks", response_model=List[FrameworkInfo])
def list_available_frameworks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    List all compliance frameworks available in the knowledge base.
    
    Use these framework codes to filter questions to specific frameworks.
    """
    try:
        # Query frameworks directly from database
        result = db.execute(text("""
            SELECT id, short_code, name, version, description 
            FROM grc_frameworks 
            WHERE is_active = true 
            ORDER BY name
        """))
        frameworks_data = result.fetchall()
        
        frameworks = [
            FrameworkInfo(
                id=str(row.id),
                code=row.short_code,
                name=row.name,
                version=row.version or "",
                description=row.description or ""
            )
            for row in frameworks_data
        ]
        
        logger.info(f"[YES] Found {len(frameworks)} active frameworks")
        return frameworks
    except Exception as e:
        logger.error(f"Error getting frameworks: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve frameworks: {str(e)}"
        )


@router.get("/stats", response_model=StatsResponse)
def get_knowledge_base_stats(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Get statistics about the GRC database.
    
    Returns counts of key entities and list of available frameworks.
    """
    try:
        # Query statistics from database
        stats_query = text("""
            SELECT 
                (SELECT COUNT(*) FROM grc_frameworks WHERE is_active = true) as frameworks_count,
                (SELECT COUNT(*) FROM grc_framework_controls) as controls_count,
                (SELECT COUNT(*) FROM grc_vulnerabilities) as vulnerabilities_count,
                (SELECT COUNT(*) FROM grc_it_assets) as assets_count,
                (SELECT COUNT(*) FROM grc_risks) as risks_count
        """)
        stats_result = db.execute(stats_query)
        stats_row = stats_result.fetchone()
        
        # Query frameworks
        frameworks_query = text("""
            SELECT id, short_code, name, version, description 
            FROM grc_frameworks 
            WHERE is_active = true 
            ORDER BY name
        """)
        frameworks_result = db.execute(frameworks_query)
        frameworks_data = frameworks_result.fetchall()
        
        frameworks = [
            FrameworkInfo(
                id=str(row.id),
                code=row.short_code,
                name=row.name,
                version=row.version or "",
                description=row.description or ""
            )
            for row in frameworks_data
        ]
        
        total = sum([stats_row.frameworks_count, stats_row.controls_count, 
                     stats_row.vulnerabilities_count, stats_row.assets_count, stats_row.risks_count])
        
        return StatsResponse(
            total_entities=total,
            entity_types={
                "frameworks": stats_row.frameworks_count,
                "controls": stats_row.controls_count,
                "vulnerabilities": stats_row.vulnerabilities_count,
                "assets": stats_row.assets_count,
                "risks": stats_row.risks_count
            },
            available_frameworks=frameworks
        )
    except Exception as e:
        logger.error(f"Error getting stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve statistics: {str(e)}"
        )


@router.post("/trigger-embedding-update")
def trigger_embedding_update(
    request: TriggerEmbeddingRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    **DEPRECATED**: This endpoint is no longer needed.
    
    Embeddings are now generated automatically when data is created/uploaded:
    - Evidence uploads [>] auto-embedded
    - Documents [>] auto-embedded
    - Risks [>] auto-embedded
    - Governance data [>] auto-embedded
    - AI responses [>] auto-embedded
    
    To regenerate ALL embeddings from scratch, run:
    `python complychat/scripts/regenerate_local_embeddings.py`
    """
    return {
        "status": "deprecated",
        "message": "Auto-embedding is now active on all upload/create endpoints",
        "info": "No manual regeneration needed - embeddings generate automatically"
    }


# @router.post("/regenerate", response_model=dict)
# def regenerate_embeddings(
#     request: RegenerateRequest,
#     db: Session = Depends(get_db),
#     current_user: GRCUser = Depends(require_auth)
# ):
#     """OLD ENDPOINT - Kept for backward compatibility but returns deprecation notice"""
#     pass


@router.get("/health")
def health_check():
    """Check if SQL Agent service is healthy and ready"""
    if not SQL_AGENT_ENABLED:
        return {
            "status": "unavailable",
            "message": "SQL Agent not initialized.",
            "ready": False
        }
    
    return {
        "status": "healthy",
        "message": "SQL Agent service is operational (ChromaDB disabled)",
        "ready": True,
        "mode": "pure_sql"
    }
