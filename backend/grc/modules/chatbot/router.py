"""
ComplyChatRouter - AI-Powered Compliance Q&A Integration
Integrates RAG-based chatbot into the main GRC platform
"""

import os
import sys
import json
import logging
from io import BytesIO
from typing import List, Dict, Any, Optional
from pathlib import Path
from collections import deque
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status, Response, UploadFile, File, Form
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import text, func, or_

# Add complychat to path
complychat_path = Path(__file__).parent / "complychat" / "complychat"
sys.path.insert(0, str(complychat_path))

logger = logging.getLogger(__name__)

# ============================================================================
# CONVERSATION HISTORY STORAGE
# ============================================================================
conversation_history: Dict[str, deque] = {}  # Backward-compatible history snapshots
session_message_logs: Dict[str, List[Dict[str, Any]]] = {}
session_uploaded_files: Dict[str, List[Dict[str, Any]]] = {}
langchain_histories: Dict[str, Any] = {}
MAX_HISTORY_LENGTH = 10
CHAT_UPLOAD_ROOT = Path(__file__).resolve().parents[3] / "uploads" / "complychat"
CHAT_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
AUDIT_QUERY_TERMS = (
    "audit",
    "auditor",
    "audit universe",
    "audit finding",
    "audit findings",
    "audit plan",
    "audit engagement",
    "workpaper",
    "qaip",
)
GRC_RELEVANT_TERMS = (
    # Platform modules
    "grc", "erm", "enterprise risk", "risk management", "risk register",
    # Core GRC concepts
    "compliance", "framework", "control", "policy", "risk", "evidence", "governance",
    "regulatory", "regulation", "regulation", "obligation", "maturity", "readiness",
    # Security / vulnerability (use stem to match plural forms)
    "vulnerabilit",  # matches vulnerability + vulnerabilities
    "pentest", "penetration", "cve", "patch", "exploit", "remediat", "threat", "attack",
    "cybersecurit",  # matches cybersecurity
    "infosec", "security",
    # Asset management
    "asset", "inventor", "hardware", "software", "system", "infrastructure",
    # Vendor / third-party
    "vendor", "third party", "third-party", "supplier", "outsourc",
    # Incidents and exceptions
    "incident", "exception", "breach", "finding",
    # Certifications and journeys
    "attestation", "certification", "journey", "assessment", "gap", "audit",
    # Frameworks (abbreviations and names)
    "iso", "pci", "nist", "sbp", "sama", "dora", "gdpr", "soc 2", "soc2",
    "cobit", "cis", "hipaa", "sox", "basel",
    # Org / people
    "organization", "tenant", "company", "committee", "document", "charter",
    "department", "user", "role", "permission",
    # GRC status words (combined with other context)
    "open", "overdue", "critical", "high risk", "pending", "active", "closed",
)
OFF_TOPIC_TERMS = (
    "weather", "football", "cricket score", "movie review", "movie ticket",
    "recipe", "song lyrics", "joke", "dating", "bitcoin price", "crypto price",
    "celebrity", "travel booking", "restaurant", "shopping cart", "video game",
    "horoscope", "sports score", "stock price",
)
GREETING_TERMS = (
    "hi", "hello", "hey", "good morning", "good afternoon", "good evening", "thanks", "thank you"
)
FILE_ANALYSIS_TERMS = (
    "analyze", "analyse", "review", "summarize", "summary", "gap", "assess", "assessment",
    "what does this file", "check this document", "uploaded file", "uploaded files", "document",
    "comply", "complian", "this policy", "attached policy", "this document", "attached document",
    "extract controls", "identify gaps", "check gaps", "is there", "does this", "cover",
    "requirement", "obligation", "missing clause", "non-conformit",
)
DB_QUERY_TERMS = (
    # Explicit retrieval commands
    "show", "list", "count", "how many", "which", "what are", "find", "get", "fetch",
    "give me", "tell me", "display", "report on", "pull",
    # Status / state (always live-data signals)
    "status", "current status", "current state", "progress", "how is", "how are",
    "open", "closed", "resolved", "unresolved", "approved", "rejected", "in progress",
    "overdue", "missing", "weak", "critical", "top", "active", "pending", "on hold",
    # Quantity / existence checks
    "any open", "any pending", "any unresolved", "any active", "any critical",
    "are there", "is there any", "do we have", "how many open", "how many pending",
    # Time-based = always live data
    "current", "recent", "latest", "last week", "this month", "today", "this year",
    # Summary / overview of live data
    "summary of", "overview of", "breakdown of", "breakdown", "distribution",
    "by severity", "by status", "by category", "by framework", "by department",
    # Possessive patterns = platform data
    "my risks", "my controls", "my vendors", "my exceptions", "our risks",
)
# Platform module nouns — if present, the question is ALWAYS about live DB data
# regardless of whether any DB_QUERY_TERM appears
PLATFORM_DATA_NOUNS = (
    "risk register", "risk incidents", "risk exceptions", "risk kris", "key risk indicator",
    "open exceptions", "policy exceptions", "exceptions",
    "open incidents", "security incidents", "incidents",
    "vendor assessments", "vendor risks", "vendor reviews",
    "compliance assessments", "compliance programs", "compliance status",
    "attestation campaigns", "attestation requests", "attestations",
    "committee meetings", "governance committees", "oversight actions",
    "certification journeys", "certification phases",
    "rcsa campaigns", "rcsa findings",
    "pentest reports", "vuln reports", "vulnerability reports",
    "asset inventory", "it assets", "asset management",
    "issues", "open issues", "regulatory changes",
)
FRAMEWORK_PROGRESS_TERMS = (
    "active compliance frameworks", "current progress", "framework progress", "active frameworks",
    "frameworks and their current progress", "framework overview"
)
EVIDENCE_GAP_TERMS = (
    "missing or weak evidence", "missing evidence", "weak evidence", "evidence gaps",
    "controls with missing", "controls with weak evidence"
)
LANGCHAIN_HISTORY_AVAILABLE = False

try:
    from langchain_core.chat_history import InMemoryChatMessageHistory
    from langchain_core.messages import AIMessage, HumanMessage
    LANGCHAIN_HISTORY_AVAILABLE = True
except Exception as langchain_error:
    logger.warning(f"LangChain history module unavailable: {langchain_error}")


def normalize_chat_message(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError("message cannot be empty")
    return cleaned


def resolve_chat_session_id(session_id: Optional[str], user_id: Any) -> str:
    raw_value = (session_id or "").strip()
    cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in raw_value)
    return cleaned or f"user_{user_id}"


def get_session_storage_key(user_id: Any, session_id: str) -> str:
    return f"{user_id}:{resolve_chat_session_id(session_id, user_id)}"


def is_audit_related_question(question: str) -> bool:
    lowered = (question or "").lower()
    return any(term in lowered for term in AUDIT_QUERY_TERMS)


def get_recent_session_log(user_id: Any, session_id: str) -> List[Dict[str, Any]]:
    storage_key = get_session_storage_key(user_id, session_id)
    return session_message_logs.setdefault(storage_key, [])


def append_session_message(user_id: Any, session_id: str, role: str, content: str, **extra: Any) -> None:
    storage_key = get_session_storage_key(user_id, session_id)
    payload: Dict[str, Any] = {
        "role": role,
        "content": (content or "").strip(),
        "timestamp": datetime.utcnow().isoformat(),
    }
    payload.update(extra)
    logs = session_message_logs.setdefault(storage_key, [])
    logs.append(payload)
    session_message_logs[storage_key] = logs[-(MAX_HISTORY_LENGTH * 2):]
    conversation_history[storage_key] = deque(session_message_logs[storage_key], maxlen=MAX_HISTORY_LENGTH * 2)


def hydrate_langchain_history(user_id: Any, session_id: str, history_items: Optional[List[Dict[str, Any]]] = None):
    if not LANGCHAIN_HISTORY_AVAILABLE:
        return None

    storage_key = get_session_storage_key(user_id, session_id)
    message_history = InMemoryChatMessageHistory()
    for item in (history_items or session_message_logs.get(storage_key, []))[-(MAX_HISTORY_LENGTH * 2):]:
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        if role == "assistant":
            message_history.add_ai_message(content)
        elif role == "user":
            message_history.add_user_message(content)
    langchain_histories[storage_key] = message_history
    return message_history


def build_context_summary(user_id: Any, session_id: str, history_items: Optional[List[Dict[str, Any]]] = None) -> str:
    hydrated = hydrate_langchain_history(user_id, session_id, history_items)
    context_lines = ["Recent conversation context:"]

    if hydrated is not None:
        for message in hydrated.messages[-6:]:
            content = str(getattr(message, "content", "")).strip()
            if not content:
                continue
            role = "Assistant" if isinstance(message, AIMessage) else "User"
            context_lines.append(f"- {role}: {content[:200]}")
    else:
        for item in (history_items or [])[-6:]:
            content = str(item.get("content", "")).strip()
            if not content:
                continue
            role = "Assistant" if item.get("role") == "assistant" else "User"
            context_lines.append(f"- {role}: {content[:200]}")

    return "\n".join(context_lines) if len(context_lines) > 1 else ""


def store_chat_exchange(
    user_id: Any,
    session_id: str,
    user_message: str,
    assistant_message: str,
    *,
    offset: int = 0,
    sources: Optional[List[Dict[str, Any]]] = None,
    is_error: bool = False,
) -> None:
    if offset == 0:
        append_session_message(user_id, session_id, "user", user_message)
        append_session_message(user_id, session_id, "assistant", assistant_message, sources=sources or [], is_error=is_error)
        hydrate_langchain_history(user_id, session_id)


def get_session_upload_dir(user_id: Any, session_id: str) -> Path:
    upload_dir = CHAT_UPLOAD_ROOT / f"user_{user_id}" / resolve_chat_session_id(session_id, user_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    return upload_dir


def get_session_manifest_path(user_id: Any, session_id: str) -> Path:
    return get_session_upload_dir(user_id, session_id) / "manifest.json"


def load_session_uploaded_files(user_id: Any, session_id: str) -> List[Dict[str, Any]]:
    storage_key = get_session_storage_key(user_id, session_id)
    if storage_key in session_uploaded_files:
        return session_uploaded_files[storage_key]

    manifest_path = get_session_manifest_path(user_id, session_id)
    if manifest_path.exists():
        try:
            session_uploaded_files[storage_key] = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            session_uploaded_files[storage_key] = []
    else:
        session_uploaded_files[storage_key] = []

    return session_uploaded_files[storage_key]


def save_session_uploaded_files(user_id: Any, session_id: str, files: List[Dict[str, Any]]) -> None:
    storage_key = get_session_storage_key(user_id, session_id)
    session_uploaded_files[storage_key] = files
    manifest_path = get_session_manifest_path(user_id, session_id)
    manifest_path.write_text(json.dumps(files, ensure_ascii=False, indent=2), encoding="utf-8")


def extract_text_from_upload(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    text_extract = ""

    try:
        if suffix in {".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".html", ".log", ".ini", ".py", ".js", ".ts"}:
            text_extract = content.decode("utf-8", errors="ignore")
        elif suffix == ".pdf":
            from PyPDF2 import PdfReader
            pdf_reader = PdfReader(BytesIO(content))
            text_extract = "\n".join((page.extract_text() or "") for page in pdf_reader.pages[:10])
        elif suffix == ".docx":
            from docx import Document
            document = Document(BytesIO(content))
            text_extract = "\n".join(paragraph.text for paragraph in document.paragraphs if paragraph.text)
        elif suffix == ".pptx":
            from pptx import Presentation
            presentation = Presentation(BytesIO(content))
            chunks: List[str] = []
            for slide in presentation.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text:
                        chunks.append(shape.text)
            text_extract = "\n".join(chunks)
    except Exception as parse_error:
        logger.warning(f"Could not extract text from {filename}: {parse_error}")

    if not text_extract:
        text_extract = content.decode("utf-8", errors="ignore")

    text_extract = text_extract.strip()
    return text_extract[:4000] if text_extract else f"Uploaded binary file '{filename}' ({len(content)} bytes)."


def build_uploaded_context(user_id: Any, session_id: str) -> str:
    uploaded_files = load_session_uploaded_files(user_id, session_id)
    if not uploaded_files:
        return ""

    context_lines = ["Uploaded file context:"]
    for item in uploaded_files[-5:]:
        filename = item.get("filename", "file")
        excerpt = str(item.get("excerpt", "")).strip()
        if excerpt:
            context_lines.append(f"- {filename}: {excerpt[:600]}")
        else:
            context_lines.append(f"- {filename}: File uploaded successfully and available for reference.")
    return "\n".join(context_lines)


def is_grc_relevant_question(question: str) -> bool:
    """Returns True if the question contains ANY GRC-related signal (permissive)."""
    lowered = (question or "").lower()
    return any(term in lowered for term in GRC_RELEVANT_TERMS)


def grc_relevance_score(question: str) -> float:
    """Returns a 0.0-1.0 relevance score — fraction of GRC terms found (capped at 5 matches)."""
    lowered = (question or "").lower()
    hits = sum(1 for term in GRC_RELEVANT_TERMS if term in lowered)
    return min(hits / 5.0, 1.0)


def is_off_topic_question(question: str) -> bool:
    """Only blocks queries that are clearly non-GRC with zero relevance (< 20% score)."""
    lowered = (question or "").lower().strip()
    # Always allow greetings
    if any(term == lowered for term in GREETING_TERMS):
        return False
    # Any GRC signal at all → not off-topic (permissive guardrail)
    if is_grc_relevant_question(question):
        return False
    # Clearly off-topic only if it matches an off-topic phrase
    if any(term in lowered for term in OFF_TOPIC_TERMS):
        return True
    # Short ambiguous queries without ANY GRC term pass through to LLM
    # (LLM will handle the GRC scope, not a hard reject)
    return False


def classify_request_mode(question: str, has_uploaded_files: bool = False) -> str:
    lowered = (question or "").lower().strip()

    if is_audit_related_question(lowered):
        return "deprecated_audit"
    if is_off_topic_question(lowered) and not has_uploaded_files:
        return "off_topic"
    if any(term in lowered for term in FRAMEWORK_PROGRESS_TERMS):
        return "framework_progress"
    if any(term in lowered for term in EVIDENCE_GAP_TERMS):
        return "evidence_gaps"
    if has_uploaded_files and any(term in lowered for term in FILE_ANALYSIS_TERMS):
        return "file_analysis"
    if has_uploaded_files and not any(term in lowered for term in DB_QUERY_TERMS):
        return "file_analysis"
    # Explicit DB query commands
    if any(term in lowered for term in DB_QUERY_TERMS):
        return "database"
    # GRC platform module nouns always refer to live data — route to SQL agent
    # even when no standard query verb is present (e.g. "any exceptions?", "vendor overview")
    if any(noun in lowered for noun in PLATFORM_DATA_NOUNS) and not has_uploaded_files:
        return "database"
    return "grc_guidance"


# ============================================================================
# LLM KNOWLEDGE FALLBACK
# ============================================================================

def answer_grc_knowledge_question(
    question: str,
    context_summary: str = "",
    uploaded_context: str = "",
) -> str:
    """
    Call GPT directly to answer GRC knowledge/conceptual questions
    when no live DB data is needed or available.
    Covers: ERM overviews, framework explanations, best practices, module summaries.
    """
    try:
        import openai as _openai
        _api_key = os.environ.get("OPENAI_API_KEY", "")
        if not _api_key:
            return (
                "I couldn't reach the AI engine (missing API key). "
                "Please ask about specific data such as frameworks, risks or vulnerabilities that are stored in the system."
            )
        _client = _openai.OpenAI(api_key=_api_key)

        system_prompt = (
            "You are ComplyChat, an expert GRC AI assistant inside the ComplyVerse enterprise GRC platform.\n\n"
            "You specialise in: ERM, compliance frameworks (ISO 27001, PCI DSS, NIST, SAMA, SBP, DORA, GDPR, SOC 2, HIPAA, COBIT), "
            "controls, evidence management, vulnerability management, asset management, governance, and incidents.\n\n"
            "RESPONSE RULES — follow strictly:\n"
            "1. Be CONCISE. Max 200 words unless the question clearly requires more.\n"
            "2. Use markdown formatting: `##` for section headers, `-` for bullet points, `**bold**` for key terms.\n"
            "3. Do NOT use numbered top-level sections like '1. Definition', '2. Overview' — use `##` headers instead.\n"
            "4. Lead with the direct answer, not a definition.\n"
            "5. If asked about live platform data (counts, statuses), say: 'Your platform has no [X] data yet.' and list 2-3 quick setup steps.\n"
            "6. Answer ONLY GRC topics. Redirect non-GRC questions politely in one sentence."
        )

        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        if context_summary:
            messages.append({"role": "user", "content": f"Previous conversation context:\n{context_summary}"})
        if uploaded_context:
            messages.append({"role": "user", "content": f"Uploaded file context:\n{uploaded_context}"})
        messages.append({"role": "user", "content": question})

        completion = _client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.3,
            max_tokens=1200,
        )
        return (completion.choices[0].message.content or "").strip() or "I couldn't generate an answer. Please try rephrasing."

    except Exception as llm_err:
        logger.warning(f"[LLM-FALLBACK] knowledge answer failed: {llm_err}")
        return (
            "I can answer questions about ERM, compliance frameworks (ISO, PCI DSS, NIST, SAMA, SBP), "
            "controls, vulnerabilities, assets, governance, and evidence management. "
            "Please try rephrasing your question."
        )


def summarize_framework_progress(db: Session, tenant_ids: List[int]) -> str:
    available_statuses = ["published", "completed", "parsed", "classified"]
    framework_rows = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(available_statuses),
        or_(
            UploadedFramework.tenant_id.in_(tenant_ids) if tenant_ids else False,
            UploadedFramework.is_shared == True,
            UploadedFramework.tenant_id.is_(None)
        )
    ).order_by(UploadedFramework.name.asc()).all()

    deduped: Dict[str, Any] = {}
    for framework in framework_rows:
        key = f"{(framework.name or '').strip().lower()}::{(framework.version or '').strip().lower()}"
        if key not in deduped or framework.tenant_id in tenant_ids:
            deduped[key] = framework

    journeys = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(tenant_ids) if tenant_ids else False
    ).all()

    tracked_journeys = [journey for journey in journeys if (journey.status or "").lower() in {"active", "in_progress", "completed", "on_hold"}]
    active_journeys = [journey for journey in tracked_journeys if (journey.status or "").lower() in {"active", "in_progress"}]
    journey_by_framework_id = {
        journey.uploaded_framework_id: journey
        for journey in active_journeys
        if getattr(journey, "uploaded_framework_id", None)
    }

    lines: List[str] = []
    if not active_journeys:
        lines.append("Executive Summary")
        lines.append("No active compliance or certification journeys are currently running for your tenant.")
        lines.append(f"{len(deduped)} unique framework(s) are available in the library, but progress tracking will begin only after a journey is started.")
        if tracked_journeys:
            lines.append(f"There are {len(tracked_journeys)} tracked journey record(s), but none are currently active or in progress.")
        lines.append("")
        lines.append("Available Frameworks")
        for framework in list(deduped.values())[:10]:
            lines.append(
                f"- {framework.name} — library status: {framework.upload_status or 'unknown'}"
                + (f", version: {framework.version}" if framework.version else "")
            )
        return "\n".join(lines)

    lines.append("Executive Summary")
    lines.append(f"{len(active_journeys)} active journey(s) were found across {len(journey_by_framework_id)} framework(s).")
    lines.append("")
    lines.append("Current Progress")

    for journey in active_journeys[:10]:
        framework_name = getattr(getattr(journey, "uploaded_framework", None), "name", None) or journey.name or "Unknown Framework"
        readiness = 0
        status_label = journey.status or "unknown"
        if callable(calculate_progress_summary):
            try:
                summary = calculate_progress_summary(journey, db)
                readiness = round(float(getattr(summary, "readiness_percentage", 0) or 0), 1)
            except Exception:
                readiness = 0
        lines.append(f"- {framework_name}: status {status_label}, readiness {readiness}%")

    return "\n".join(lines)


def summarize_evidence_gaps(db: Session, tenant_ids: List[int]) -> str:
    journeys = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(tenant_ids) if tenant_ids else False
    ).all()

    if not journeys:
        return (
            "No evidence-backed control implementations were found for your tenant yet. "
            "Start a framework journey and upload/link evidence to surface missing or weak controls."
        )

    implementation_ids = [journey.id for journey in journeys]
    implementations = db.query(ControlImplementation).filter(
        ControlImplementation.journey_id.in_(implementation_ids)
    ).all()

    if not implementations:
        return (
            "No control implementations exist yet for the current journeys, so there is no real evidence gap data to report. "
            "Create or sync the controls first, then upload evidence for review."
        )

    weak_rows: List[Dict[str, Any]] = []
    for implementation in implementations:
        parsed_control = getattr(implementation, "parsed_control", None)
        framework_control = getattr(implementation, "framework_control", None)
        control_code = getattr(parsed_control, "control_id", None) or getattr(framework_control, "code", None) or f"Control {implementation.id}"
        control_name = getattr(parsed_control, "title", None) or getattr(framework_control, "name", None) or "Untitled Control"

        attachment_count = len(getattr(implementation, "evidence_attachments", []) or [])
        approved_count = len([item for item in (implementation.evidence_attachments or []) if getattr(item, "review_status", None) == "approved"])
        weak_count = len([
            item for item in (implementation.evidence_attachments or [])
            if getattr(item, "review_status", None) in {"rejected", "pending"}
            or ((getattr(item, "ai_confidence_score", None) or 0) > 0 and (getattr(item, "ai_confidence_score", None) or 0) < 70)
        ])

        if attachment_count == 0 or approved_count == 0 or weak_count > 0:
            weak_rows.append({
                "control_code": control_code,
                "control_name": control_name,
                "attachment_count": attachment_count,
                "approved_count": approved_count,
                "weak_count": weak_count,
            })

    if not weak_rows:
        total_evidence = db.query(func.count(Evidence.id)).filter(Evidence.tenant_id.in_(tenant_ids) if tenant_ids else False).scalar() or 0
        return f"Good news: the tracked controls do not currently show missing or weak evidence. Total evidence records found: {total_evidence}."

    weak_rows.sort(key=lambda row: (row["approved_count"], row["attachment_count"], -row["weak_count"]))
    lines = [
        "Evidence Gap Summary",
        f"{len(weak_rows)} control(s) currently need attention.",
        "",
        "Priority Controls"
    ]
    for row in weak_rows[:10]:
        issue_bits = []
        if row["attachment_count"] == 0:
            issue_bits.append("no evidence uploaded")
        if row["approved_count"] == 0 and row["attachment_count"] > 0:
            issue_bits.append("nothing approved yet")
        if row["weak_count"] > 0:
            issue_bits.append(f"{row['weak_count']} weak or pending item(s)")
        lines.append(f"- {row['control_code']} — {row['control_name']} ({'; '.join(issue_bits)})")
    return "\n".join(lines)


def analyze_uploaded_files_with_llm(
    question: str,
    uploaded_files: List[Dict[str, Any]],
    context_summary: str = "",
) -> str:
    """
    Send the actual uploaded file content + user question to the LLM for a real GRC analysis.
    Handles gap analysis, compliance checks, control extraction, obligation summaries etc.
    """
    if not uploaded_files:
        return "Please upload one or more files so I can analyze them from a GRC perspective."

    try:
        import openai as _openai
        _api_key = os.environ.get("OPENAI_API_KEY", "")
        if not _api_key:
            return (
                "I couldn't reach the AI engine (missing API key). "
                "Please check that OPENAI_API_KEY is configured."
            )
        _client = _openai.OpenAI(api_key=_api_key)

        # Build file context — include actual extracted text, not just keyword counts
        file_blocks: List[str] = []
        for item in uploaded_files[-5:]:
            filename = item.get("filename", "uploaded file")
            excerpt = str(item.get("excerpt", "")).strip()
            if excerpt:
                file_blocks.append(f"--- FILE: {filename} ---\n{excerpt[:3500]}\n--- END FILE ---")
            else:
                file_blocks.append(f"--- FILE: {filename} ---\n[No extractable text content]\n--- END FILE ---")

        files_content = "\n\n".join(file_blocks)

        system_prompt = (
            "You are ComplyChat, an expert GRC (Governance, Risk & Compliance) AI assistant. "
            "You have been given one or more uploaded document(s) to analyze.\n\n"
            "Your capabilities include:\n"
            "- Gap analysis against compliance frameworks (ISO 27001, PCI DSS, NIST CSF, SAMA, SBP, DORA, GDPR, SOC 2, HIPAA etc.)\n"
            "- Extracting controls, obligations, and requirements from policy documents\n"
            "- Identifying missing clauses, weak language, or non-conformities\n"
            "- Summarizing document scope, purpose, and coverage\n"
            "- Mapping document content to specific framework control domains\n\n"
            "Rules:\n"
            "1. Base your answer STRICTLY on the document content provided. Do not hallucinate clauses.\n"
            "2. When doing gap analysis, list what IS covered and what IS MISSING or insufficient.\n"
            "3. Use clear headings, bullet points, and control IDs where applicable.\n"
            "4. Be specific — reference actual text from the document when possible.\n"
            "5. If the document text is truncated, note that and work with what is available."
        )

        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        if context_summary:
            messages.append({"role": "user", "content": f"Conversation context:\n{context_summary}"})
        messages.append({
            "role": "user",
            "content": (
                f"Uploaded document(s):\n\n{files_content}\n\n"
                f"User question: {question}"
            )
        })

        completion = _client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.2,
            max_tokens=2000,
        )
        return (completion.choices[0].message.content or "").strip() or "I couldn't generate an analysis. Please try rephrasing."

    except Exception as llm_err:
        logger.warning(f"[FILE-ANALYSIS-LLM] failed: {llm_err}")
        return (
            "I encountered an error while analyzing the document. "
            "Please ensure the file is a readable PDF, Word document (.docx), or plain text file and try again."
        )


detect_query_type = None
generate_sql_query = None
validate_sql = None
format_query_results = None
validate_columns_in_sql = None
get_fallback_data_for_question = None
generate_answer_from_fallback_data = None
fetch_table_schema_from_db = None
load_full_database_schema = None
SQL_AGENT_ENABLED = False

try:
    from grc_sql_agent import (
        detect_query_type, generate_sql_query, validate_sql, format_query_results,
        validate_columns_in_sql, get_fallback_data_for_question, generate_answer_from_fallback_data,
        fetch_table_schema_from_db, load_full_database_schema
    )  # type: ignore
    SQL_AGENT_ENABLED = True
    logger.info("[YES] SQL Agent loaded successfully (ChromaDB disabled)")
    if callable(load_full_database_schema):
        try:
            load_full_database_schema()
        except Exception as schema_error:
            logger.warning(f"SQL agent schema preload warning: {schema_error}")
except Exception as e:
    logging.error(f"Failed to import SQL agent: {e}")
    SQL_AGENT_ENABLED = False

from ...models import (
    GRCUser,
    get_db,
    UploadedFramework,
    CertificationJourney,
    ControlImplementation,
    Evidence,
    EvidenceControlMapping,
)
from ...routers.auth_router import require_auth, get_user_tenants

try:
    from ...routers.certification_router import calculate_progress_summary
except Exception:
    calculate_progress_summary = None

router = APIRouter(prefix="/ai/complychat", tags=["AI Compliance Chat"])
logger = logging.getLogger(__name__)


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class ChatRequest(BaseModel):
    """Chat request model"""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    message: str = Field(
        ...,
        description="User's GRC question (compliance, risk, governance, evidence, policies, etc.)",
        min_length=1,
        validation_alias=AliasChoices("message", "question"),
        serialization_alias="message",
    )
    framework: Optional[str] = Field(None, description="Filter by framework code (e.g., 'PCI_DSS', 'ISO_27001')")
    include_sources: bool = Field(True, description="Include source references in response")
    session_id: Optional[str] = Field(None, description="Session ID for conversation history tracking")
    history: Optional[List[Dict[str, Any]]] = Field(None, description="Recent chat history for context hydration")
    limit: int = Field(10, ge=1, le=100, description="Number of results to return (default 10 for pagination)")
    offset: int = Field(0, ge=0, description="Offset for pagination (0 = first page)")

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        return normalize_chat_message(value)

    @property
    def question(self) -> str:
        return self.message


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
    
    if not SQL_AGENT_ENABLED or not callable(generate_sql_query) or not callable(validate_sql):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SQL Agent service is not available."
        )

    # === Deterministic handling for framework progress / active journey overview ===
    normalized_question = request.message.lower()
    if (
        "framework" in normalized_question
        and ("active" in normalized_question or "progress" in normalized_question)
        and ("journey" in normalized_question or "certification" in normalized_question or "progress" in normalized_question)
    ):
        tenant_ids = get_user_tenants(current_user, db)
        answer = summarize_framework_progress(db, tenant_ids)

        return ChatResponse(
            answer=answer,
            sources=[],
            framework_filter="FRAMEWORK_PROGRESS_OVERVIEW",
            timestamp=datetime.utcnow().isoformat(),
            has_more=False,
            total_count=0,
            current_offset=0
        )
    
    # Resolve session-specific context and hydrate LangChain history
    session_id = resolve_chat_session_id(request.session_id, current_user.id)
    recent_history = request.history or get_recent_session_log(current_user.id, session_id)
    context_summary = build_context_summary(current_user.id, session_id, recent_history)
    uploaded_files = load_session_uploaded_files(current_user.id, session_id)
    uploaded_context = build_uploaded_context(current_user.id, session_id)

    logger.info(f"\n{'='*60}\n🤖 NEW QUESTION: {request.message}\nSession: {session_id}\nHistory: {len(recent_history)} messages\nFramework filter: {request.framework}\n{'='*60}")

    try:
        request_mode = classify_request_mode(request.message, has_uploaded_files=bool(uploaded_files))

        if request_mode == "off_topic":
            answer = (
                "ComplyChat is limited to GRC topics only. "
                "Please ask about compliance frameworks, ISO, PCI DSS, SBP, governance, evidence, risks, vulnerabilities, assets, or related organizational controls."
            )
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset)
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )

        if request_mode == "deprecated_audit":
            answer = (
                "Audit Management is no longer available in this system. "
                "I can still help with governance, policies, compliance, risks, evidence, certifications, and vulnerabilities."
            )
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset, is_error=False)
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )

        tenant_ids = get_user_tenants(current_user, db)

        if request_mode == "framework_progress":
            answer = summarize_framework_progress(db, tenant_ids)
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset)
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )

        if request_mode == "evidence_gaps":
            answer = summarize_evidence_gaps(db, tenant_ids)
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset)
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )

        if request_mode == "file_analysis":
            logger.info(f"[FILE-ANALYSIS] Sending {len(uploaded_files)} file(s) + question to LLM: {request.message}")
            answer = analyze_uploaded_files_with_llm(request.message, uploaded_files, context_summary)
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset)
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )

        if request_mode == "grc_guidance":
            # LLM-driven answer for conceptual / knowledge questions (ERM overview, framework explanations, best practices)
            logger.info(f"[LLM-GUIDANCE] Routing to LLM knowledge fallback for: {request.message}")
            answer = answer_grc_knowledge_question(request.message, context_summary, uploaded_context)
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset)
            return ChatResponse(
                answer=answer,
                sources=[],
                framework_filter=request.framework,
                timestamp=datetime.utcnow().isoformat(),
                has_more=False,
                total_count=0,
                current_offset=0
            )

        # Enhance question with context if user references previous conversation or uploaded files
        enhanced_question = request.message
        reference_words = ['that', 'it', 'them', 'those', 'this', 'first', 'second', 'last', 'previous', 'above']
        if any(word in request.message.lower() for word in reference_words) and context_summary:
            enhanced_question = f"{request.message}\n\n{context_summary}"
            logger.info(f"💡 Enhanced question with context: {enhanced_question}")
        if uploaded_context:
            enhanced_question = f"{enhanced_question}\n\n{uploaded_context}"
        
        # 🤖 STEP 1: Generate SQL query from natural language
        logger.info("[STATS] Generating SQL query from question...")
        sql_result = generate_sql_query(enhanced_question, language="en", limit=request.limit, offset=request.offset)
        
        if not sql_result.get('sql') or not validate_sql(sql_result['sql']):
            # If no valid SQL generated, return explanation
            answer = sql_result.get('explanation', 'Unable to process this question as a SQL query.')
            
            store_chat_exchange(current_user.id, session_id, request.message, answer, offset=request.offset)
            
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

            if not data_list:
                # No DB rows — give a short, platform-focused "no data yet" message
                logger.info(f"[LLM-FALLBACK] SQL returned 0 rows, generating platform status response")
                answer = answer_grc_knowledge_question(
                    f"The user asked: '{request.message}' inside the ComplyVerse GRC platform.\n"
                    "The live database has NO records for this query yet — the platform is empty for this data type.\n\n"
                    "Respond in this EXACT concise format (no verbose definitions, no academic content):\n\n"
                    "## No [data type] found in your platform yet\n\n"
                    "**Why:** One sentence explaining this data is empty.\n\n"
                    "**Quick steps to populate this:**\n"
                    "1. [First specific action in ComplyVerse]\n"
                    "2. [Second specific action]\n"
                    "3. [Third specific action]\n\n"
                    "Keep it under 120 words total. Do NOT explain what the concept means — the user already knows.",
                    context_summary,
                    uploaded_context,
                )
            else:
                answer = format_query_results(data_list, request.message, sql_query, language="en") + pagination_note
            
            # 💾 STEP 4: Save to conversation history
            store_chat_exchange(
                current_user.id,
                session_id,
                request.message,
                answer[:500],
                offset=request.offset,
                sources=[{
                    "entity_type": sql_result.get('entity_type', 'sql_query'),
                    "result_count": len(data_list),
                    "total_count": total_count,
                    "sql_preview": sql_query[:200],
                }],
            )
            logger.info(f"💾 Saved to history. Total messages in session: {len(get_recent_session_log(current_user.id, session_id))}")
            
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
            store_chat_exchange(
                current_user.id,
                session_id,
                request.message,
                answer[:500],
                offset=request.offset,
                is_error=True,
                sources=[{"sql_preview": sql_query, "auto_retry_attempted": True}],
            )
            
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
    Get conversation history for a session.

    Returns the recent conversation context that the AI uses to understand follow-up questions.
    """
    history = get_recent_session_log(current_user.id, session_id)
    uploaded_files = load_session_uploaded_files(current_user.id, session_id)
    return {
        "session_id": resolve_chat_session_id(session_id, current_user.id),
        "messages": history,
        "count": len(history),
        "max_length": MAX_HISTORY_LENGTH,
        "uploaded_files": uploaded_files,
    }


@router.delete("/history/{session_id}")
async def clear_conversation_history(
    session_id: str,
    current_user: GRCUser = Depends(require_auth)
):
    """
    Clear conversation history for a session.

    Use this to delete a chat and its associated uploaded file context.
    """
    storage_key = get_session_storage_key(current_user.id, session_id)
    session_message_logs.pop(storage_key, None)
    conversation_history.pop(storage_key, None)
    session_uploaded_files.pop(storage_key, None)
    langchain_histories.pop(storage_key, None)

    upload_dir = get_session_upload_dir(current_user.id, session_id)
    if upload_dir.exists():
        for child in upload_dir.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
        try:
            upload_dir.rmdir()
        except OSError:
            pass

    logger.info(f"🗑️ Cleared history for session: {session_id}")
    return {"message": f"History cleared for session {session_id}", "success": True}


@router.post("/upload")
async def upload_chat_files(
    files: List[UploadFile] = File(...),
    session_id: str = Form(...),
    current_user: GRCUser = Depends(require_auth)
):
    """Upload one or more files for ComplyChat context. Any format is accepted."""
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files were provided."
        )

    resolved_session_id = resolve_chat_session_id(session_id, current_user.id)
    upload_dir = get_session_upload_dir(current_user.id, resolved_session_id)
    existing_files = load_session_uploaded_files(current_user.id, resolved_session_id)
    uploaded_items: List[Dict[str, Any]] = []

    for upload in files:
        file_bytes = await upload.read()
        original_name = upload.filename or f"upload-{uuid4().hex}"
        saved_name = f"{uuid4().hex}_{original_name}"
        file_path = upload_dir / saved_name
        file_path.write_bytes(file_bytes)

        extracted_excerpt = extract_text_from_upload(original_name, file_bytes)
        file_info = {
            "id": uuid4().hex,
            "filename": original_name,
            "saved_name": saved_name,
            "path": str(file_path),
            "size": len(file_bytes),
            "content_type": upload.content_type or "application/octet-stream",
            "uploaded_at": datetime.utcnow().isoformat(),
            "excerpt": extracted_excerpt,
        }
        existing_files.append(file_info)
        uploaded_items.append(file_info)

    save_session_uploaded_files(current_user.id, resolved_session_id, existing_files)

    return {
        "session_id": resolved_session_id,
        "count": len(uploaded_items),
        "uploaded_files": uploaded_items,
    }


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
