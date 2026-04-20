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
    "regulatory", "regulation", "obligation", "maturity", "readiness",
    # Security / vulnerability
    "vulnerabilit", "vulnerabilty", "vunerabilit",  # typo-tolerant stems
    "pentest", "penetration", "cve", "patch", "exploit", "remediat", "threat", "attack",
    "cybersecurit", "cyber secur", "infosec", "security",
    # Asset management
    "asset", "inventor", "hardware", "software", "system", "infrastructure",
    # Vendor / third-party
    "vendor", "third party", "third-party", "supplier", "outsourc",
    # Incidents / exceptions
    "incident", "exception", "breach", "finding",
    # Certifications / journeys
    "attestation", "certification", "journey", "assessment", "gap", "audit",
    # Frameworks (abbreviations and names)
    "iso", "pci", "nist", "sbp", "sama", "dora", "gdpr", "soc 2", "soc2",
    "cobit", "cis", "hipaa", "sox", "basel",
    # Platform sub-modules & pages
    "rcsa", "self-assessment", "self assessment",
    "internal control", "key control", "control test",
    "regulatory change", "regulatory update", "new regulation",
    "oversight action", "committee meeting", "board meeting",
    "policy statement", "policy gap", "gap analysis",
    "pentest report", "vulnerability report", "vuln report",
    "control library", "control mapping", "control framework",
    "certification journey", "compliance program", "compliance status",
    "issue tracker", "open issue", "risk incident",
    "it asset", "asset inventory", "cde environment",
    "vendor assessment", "vendor review", "vendor risk",
    "policy exception", "control exception",
    # Org / people
    "organization", "tenant", "company", "committee", "document", "charter",
    "department", "business unit", "user", "role", "permission",
    # GRC status words
    "open", "overdue", "critical", "high risk", "pending", "active", "closed",
    # Common typos / misspellings
    "complaince", "complianse", "complience",  # compliance
    "goveranc", "governanc", "govrnance",  # governance
    "framwork", "frameowrk",  # framework
    "attesstati", "attestaion",  # attestation
    "regultory", "regualtory",  # regulatory
    "vulnerablity", "vunlerabilit",  # vulnerability
    "certifcation", "certifiation",  # certification
    "asessment", "assessement",  # assessment
    "controll", "cotrnol",  # control
    "incidnet",  # incident
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
# Platform module nouns — if present, the question is about live DB data
# Covers full platform: modules, sub-modules, pages, features
PLATFORM_DATA_NOUNS = (
    # Risk Management
    "risk register", "risk incidents", "risk exceptions", "risk kris", "key risk indicator",
    "risk review", "risk treatment", "residual risk", "inherent risk", "risk appetite",
    "risk mitigation", "risk owner", "risk category",
    # Exceptions & Issues
    "open exceptions", "policy exceptions", "exceptions", "control exceptions",
    "open issues", "issues", "issue tracker",
    # Incidents
    "open incidents", "security incidents", "incidents", "risk incidents", "incident log",
    # Vendors
    "vendor assessments", "vendor risks", "vendor reviews", "vendor register",
    "third party risk", "supplier list", "vendor list", "vendors",
    # Compliance"
    "compliance assessments", "compliance programs", "compliance status","frameworks", "compliance frameworks", "compliance requirements", "regulatory obligations","pci dss requirements", "iso controls", "nist controls", "cobit controls", "cis controls", "sbp controls", "sama controls", "dora controls", "gdpr requirements", "hipaa requirements", "sox controls","state bank of pakistan"
    "compliance gaps", "compliance score", "compliance checklist",
    # Attestation & Certifications
    "attestation campaigns", "attestation requests", "attestations",
    "pending attestations", "overdue attestations",
    "certification journeys", "certification phases", "certification status",
    # Committee & Governance
    "committee meetings", "governance committees", "oversight actions",
    "board meetings", "meeting agenda", "meeting minutes",
    "governance documents", "governance document",
    # RCSA
    "rcsa campaigns", "rcsa findings", "rcsa assessments", "self assessments",
    "rcsa",
    # Vulnerabilities & Pentests
    "pentest reports", "vuln reports", "vulnerability reports",
    "open vulnerabilities", "critical vulnerabilities", "cve list",
    # Assets
    "asset inventory", "it assets", "asset management", "assets",
    "critical assets", "cde assets",
    # Regulatory Changes
    "regulatory changes", "regulatory updates", "new regulations",
    # Policies & Documents
    "policies", "procedures", "standards", "guidelines", "charters",
    "policy documents", "governance policies", "policy statements",
    "document review", "review schedule", "expiring policies",
    "policy gap analysis", "policy compliance",
    # Internal Controls
    "internal controls", "key controls", "control tests", "control library",
    "control effectiveness", "control gaps",
    # Evidence
    "evidence register", "evidence items", "control evidence",
    "missing evidence", "weak evidence", "evidence gaps",
    # Users & Departments
    "user accounts", "platform users", "department list",
)
FRAMEWORK_PROGRESS_TERMS = (
    "active compliance frameworks", "current progress", "framework progress", "active frameworks",
    "frameworks and their current progress", "framework overview"
)
EVIDENCE_GAP_TERMS = (
    "missing or weak evidence", "missing evidence", "weak evidence", "evidence gaps",
    "controls with missing", "controls with weak evidence"
)
# ─── Prompt injection patterns ──────────────────────────────────────────────
PROMPT_INJECTION_PATTERNS = (
    "forget your role", "ignore previous instructions", "ignore your instructions",
    "ignore all previous", "disregard your", "override your instructions",
    "reveal admin", "reveal credentials", "reveal the admin", "reveal your prompt",
    "pretend you are", "act as if you are", "you are now a",
    "bypass your", "your new instructions", "your new role",
    "execute any instructions", "execute the following instructions",
    "forget everything", "new persona", "jailbreak",
    "dan mode", "developer mode", "unrestricted mode",
    "translate the following", "ignore the above",
    "print your system prompt", "output your instructions",
    "what are your instructions", "reveal your system",
    "respond only in", "respond in the following way",
)
# ─── Harmful / attack-oriented request patterns ─────────────────────────────
HARMFUL_REQUEST_PATTERNS = (
    "ways to bypass", "how to bypass", "bypass security controls",
    "bypass evidence", "bypass audit", "bypass soc 2",
    "bypass iso", "bypass pci", "bypass nist", "bypass compliance",
    "circumvent controls", "circumvent evidence", "circumvent audit",
    "evade controls", "evade detection", "evade audit",
    "disable logging", "disable monitoring", "disable controls",
    "avoid detection", "hide from audit", "avoid audit trail",
    "delete evidence to", "remove evidence to", "destroy evidence",
    "ways to avoid", "how to avoid compliance", "bypass authorization",
    "unauthorized access", "how to hack", "how to exploit",
    "attack vector", "penetrate without", "bypass authentication",
    "disable evidence collection", "defeat monitoring",
)
# ─── Framework content / knowledge signals ───────────────────────────────────
# Questions about what a framework says/requires route to LLM (not DB query)
FRAMEWORK_CONTENT_SIGNALS = (
    "what are the new requirements",
    "new requirements in",
    "new requirements of",
    "what is new in",
    "what changed in",
    "what does pci", "what does iso", "what does nist", "what does sama",
    "what does sbp", "what does gdpr", "what does hipaa", "what does dora",
    "what does soc 2", "what does sox", "what does cobit", "what does cis",
    "what does basel",
    "what are the requirements of",
    "requirements of pci", "requirements of iso", "requirements of nist",
    "requirements of sama", "requirements of sbp", "requirements of gdpr",
    "requirements of hipaa", "requirements of sox",
    "clauses of", "sections of", "domains of framework",
    "explain pci", "explain iso 27001", "explain nist", "explain sama",
    "describe the framework", "explain the framework", "what is the framework",
    "what are the key controls of", "key domains of",
    "what does this standard require", "what does this regulation require",
    # Version references signal framework knowledge question
    " v1.", " v2.", " v3.", " v4.", " v5.",
    "version 1.", "version 2.", "version 3.", "version 4.",
    "pci dss 4", "pci dss 3.2", "iso 27001:2022", "iso 27001:2013",
    "nist 2.0", "nist 1.1",
)
# When present, question is about the USER's platform data → override to DB route
PLATFORM_CONTEXT_SIGNALS = (
    " my ", " our ", " we ", "we have", "do we have",
    "have we", "are we ", "in our system", "in the platform",
    "in this system", "which controls have i", "what have we",
    "our compliance", "our gaps", "our posture", "our implementation",
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
    normalized = normalize_question(lowered)
    return any(term in lowered for term in GRC_RELEVANT_TERMS) or any(term in normalized for term in GRC_RELEVANT_TERMS)


def grc_relevance_score(question: str) -> float:
    """Returns a 0.0-1.0 relevance score — fraction of GRC terms found (capped at 5 matches)."""
    lowered = (question or "").lower()
    hits = sum(1 for term in GRC_RELEVANT_TERMS if term in lowered)
    return min(hits / 5.0, 1.0)


def is_off_topic_question(question: str) -> bool:
    """Only blocks queries that are clearly non-GRC with zero relevance (< 20% score)."""
    lowered = (question or "").lower().strip()
    if any(term == lowered for term in GREETING_TERMS):
        return False
    if is_grc_relevant_question(question):
        return False
    if any(term in lowered for term in OFF_TOPIC_TERMS):
        return True
    return False


def is_prompt_injection(question: str) -> bool:
    """Detect prompt injection / jailbreak attempts."""
    lowered = (question or "").lower()
    return any(pattern in lowered for pattern in PROMPT_INJECTION_PATTERNS)


def is_harmful_request(question: str) -> bool:
    """Detect requests asking how to bypass or defeat security/compliance controls."""
    lowered = (question or "").lower()
    return any(pattern in lowered for pattern in HARMFUL_REQUEST_PATTERNS)


def is_framework_knowledge_question(question: str) -> bool:
    """
    Returns True if the question is asking about what a GRC framework says/requires
    (knowledge question) rather than about the user's own live platform data.
    These route to LLM guidance, not DB query.
    """
    lowered = normalize_question((question or "").lower())
    # If question explicitly references the user's own platform data, it's a DB question
    if any(ctx in lowered for ctx in PLATFORM_CONTEXT_SIGNALS):
        return False
    return any(signal in lowered for signal in FRAMEWORK_CONTENT_SIGNALS)


def normalize_question(question: str) -> str:
    """
    Normalize common typos and alternate spellings to canonical GRC terms
    so classification and routing work regardless of spelling mistakes.
    """
    import re
    text = (question or "").lower()
    substitutions = [
        # compliance
        (r'\bcomplian[sc]e?\b', 'compliance'),
        (r'\bcomplience\b', 'compliance'),
        # governance
        (r'\bgover[ae]n[ae]nce?\b', 'governance'),
        (r'\bgovrnance\b', 'governance'),
        # framework
        (r'\bfram[ew]ork\b', 'framework'),
        (r'\bframworks?\b', 'frameworks'),
        # vulnerability / vulnerabilities
        (r'\bvuln?er[ae]bil[iy]t[yi]e?s?\b', 'vulnerabilities'),
        (r'\bvunerabilit\w*\b', 'vulnerabilities'),
        # regulatory
        (r'\breg[uo]l[ae]tor[yi]\b', 'regulatory'),
        # attestation
        (r'\batte?sta[st]?ion\b', 'attestation'),
        # certification
        (r'\bcertif[iy]?[ae]?tion\b', 'certification'),
        # assessment
        (r'\basse[sc]?e?ment\b', 'assessment'),
        # incident
        (r'\bincid[ae]?nts?\b', 'incident'),
        # control
        (r'\bcontro?ll?\b', 'control'),
        # risk
        (r'\brisk[s]?\b', 'risk'),
    ]
    for pattern, replacement in substitutions:
        text = re.sub(pattern, replacement, text)
    return text


def classify_request_mode(question: str, has_uploaded_files: bool = False) -> str:
    lowered = (question or "").lower().strip()
    # Normalize typos before classification so misspellings route correctly
    normalized = normalize_question(lowered)

    # ── Security guardrails (always first) ───────────────────────────────────
    if is_prompt_injection(question):
        return "blocked_injection"
    if is_harmful_request(question):
        return "blocked_harmful"

    if is_audit_related_question(lowered):
        return "deprecated_audit"
    if is_off_topic_question(normalized) and not has_uploaded_files:
        return "off_topic"
    if any(term in normalized for term in FRAMEWORK_PROGRESS_TERMS):
        return "framework_progress"
    if any(term in normalized for term in EVIDENCE_GAP_TERMS):
        return "evidence_gaps"
    if has_uploaded_files and any(term in normalized for term in FILE_ANALYSIS_TERMS):
        return "file_analysis"
    if has_uploaded_files and not any(term in normalized for term in DB_QUERY_TERMS):
        return "file_analysis"
    # Framework knowledge questions → LLM (before DB check)
    # e.g. "what are the new requirements in PCI DSS v4.0.1?"
    if is_framework_knowledge_question(question) and not has_uploaded_files:
        return "grc_guidance"
    # Explicit DB query commands — check both original and normalized
    if any(term in normalized for term in DB_QUERY_TERMS) or any(term in lowered for term in DB_QUERY_TERMS):
        return "database"
    # GRC platform module nouns always refer to live data
    if (any(noun in normalized for noun in PLATFORM_DATA_NOUNS) or any(noun in lowered for noun in PLATFORM_DATA_NOUNS)) and not has_uploaded_files:
        return "database"
    # If the normalized question has a strong GRC noun signal, prefer DB mode
    if any(term in normalized for term in GRC_RELEVANT_TERMS) and any(term in normalized for term in DB_QUERY_TERMS):
        return "database"
    return "grc_guidance"


# ============================================================================
# LLM KNOWLEDGE FALLBACK
# ============================================================================

def answer_grc_knowledge_question(
    question: str,
    context_summary: str = "",
    uploaded_context: str = "",
    db_context: str = "",
) -> str:
    """
    Answer a GRC knowledge / conceptual question using GPT-4o.
    Covers: framework requirements, ERM overviews, best practices, clause explanations,
    version differences, and general compliance guidance.
    An optional db_context can be passed to ground the answer in real platform data.
    """
    try:
        import openai as _openai
        _api_key = os.environ.get("OPENAI_API_KEY", "")
        if not _api_key:
            return (
                "I couldn't reach the AI engine. "
                "Please ask about frameworks, risks, or controls stored in the platform."
            )
        _client = _openai.OpenAI(api_key=_api_key)

        system_prompt = (
            "You are ComplyChat, an expert GRC AI assistant inside the ComplyVerse enterprise GRC platform.\n\n"
            "You are deeply knowledgeable about:\n"
            "- Compliance frameworks: ISO 27001 (2013 & 2022), PCI DSS (v3.2.1 & v4.0.1), NIST CSF (1.1 & 2.0), "
            "SAMA Cyber Security Framework, SBP ETGRMF, DORA, GDPR, SOC 2, HIPAA, SOX, COBIT, CIS Controls, Basel\n"
            "- Enterprise Risk Management (ERM), internal controls, governance, evidence management\n"
            "- Vulnerability management, asset management, vendor risk, RCSA, attestation, incident management\n\n"
            "RESPONSE RULES — follow strictly:\n"
            "1. Lead with a direct, concise answer. Max 350 words unless detail is clearly needed.\n"
            "2. Use `##` for section headers, `-` for bullets, `**bold**` for key terms and control IDs.\n"
            "3. For version/change questions (e.g. PCI DSS v3.2.1 vs v4.0.1): list specific differences clearly.\n"
            "4. For framework requirement questions: list the actual requirements/controls with their IDs.\n"
            "5. NEVER say 'I cannot answer' for GRC topics you clearly know — give the best answer.\n"
            "6. NEVER hallucinate control IDs or clause numbers you are not sure of — say 'refer to the official document' instead.\n"
            "7. If referencing platform-specific data that isn't in context, note it and suggest checking the relevant module.\n"
            "8. Do NOT mention databases, queries, SQL, or system internals to the user.\n"
            "9. Politely decline anything outside GRC topics in one sentence."
        )

        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        if db_context:
            messages.append({"role": "user", "content": f"Platform data context:\n{db_context}"})
        if context_summary:
            messages.append({"role": "user", "content": f"Previous conversation context:\n{context_summary}"})
        if uploaded_context:
            messages.append({"role": "user", "content": f"Uploaded file context:\n{uploaded_context}"})
        messages.append({"role": "user", "content": question})

        completion = _client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            temperature=0.2,
            max_tokens=1500,
        )
        return (completion.choices[0].message.content or "").strip() or "I couldn't generate an answer. Please try rephrasing."

    except Exception as llm_err:
        logger.warning(f"[LLM-FALLBACK] knowledge answer failed: {llm_err}")
        return (
            "I can answer questions about GRC frameworks (ISO 27001, PCI DSS, NIST, SAMA, SBP, DORA), "
            "controls, vulnerabilities, assets, governance, and evidence management. "
            "Please try rephrasing your question."
        )


def answer_with_db_context(
    question: str,
    db: Session,
    tenant_ids: List[int],
    context_summary: str = "",
    uploaded_context: str = "",
) -> str:
    """
    Hybrid answer: pull relevant framework controls / documents from the DB as grounding
    context, then use LLM to synthesize a comprehensive, accurate answer.
    Used for framework requirement questions, clause lookups, and control explanations.
    """
    db_context_parts: List[str] = []

    try:
        # Detect framework names mentioned in the question
        question_lower = (question or "").lower()
        framework_keywords = []
        for fw in ["pci dss", "pci-dss", "iso 27001", "iso27001", "nist", "sama", "sbp", "dora", "gdpr",
                   "soc 2", "soc2", "hipaa", "sox", "cobit", "cis", "basel", "etgrmf", "bss"]:
            if fw in question_lower:
                framework_keywords.append(fw.replace("-", " ").strip())

        if framework_keywords:
            for kw in framework_keywords[:2]:  # max 2 frameworks
                try:
                    fw_rows = db.execute(
                        text(
                            "SELECT id, name, framework_type, version, source_organization, framework_purpose "
                            "FROM grc_uploaded_frameworks "
                            "WHERE LOWER(name) LIKE :kw "
                            "OR LOWER(framework_type) LIKE :kw "
                            "LIMIT 2"
                        ),
                        {"kw": f"%{kw[:30]}%"},
                    ).fetchall()

                    for fw_row in fw_rows[:1]:
                        fw_dict = dict(fw_row._mapping)
                        fw_name = fw_dict.get("name") or kw
                        fw_ver = fw_dict.get("version") or "N/A"
                        fw_purpose = (str(fw_dict.get("framework_purpose") or "")).strip()[:200]
                        db_context_parts.append(
                            f"## {fw_name} (v{fw_ver})\n"
                            + (f"Purpose: {fw_purpose}\n" if fw_purpose else "")
                        )

                        # Get controls for this framework
                        ctrl_rows = db.execute(
                            text(
                                "SELECT pfc.control_id, pfc.title, pfc.category, pfc.description "
                                "FROM grc_parsed_framework_controls pfc "
                                "JOIN grc_uploaded_frameworks uf ON pfc.uploaded_framework_id = uf.id "
                                "WHERE uf.id = :fw_id "
                                "ORDER BY pfc.control_id "
                                "LIMIT 60"
                            ),
                            {"fw_id": fw_dict.get("id")},
                        ).fetchall()

                        if ctrl_rows:
                            controls_text = "\n".join(
                                f"- **{r.control_id}**: {r.title}"
                                + (f" ({r.category})" if r.category else "")
                                for r in ctrl_rows[:40]
                            )
                            db_context_parts.append(
                                f"Controls in platform ({len(ctrl_rows)} total):\n{controls_text}"
                            )
                except Exception as fw_err:
                    logger.warning(f"[DB-CONTEXT] framework lookup failed for '{kw}': {fw_err}")
                    try:
                        db.rollback()
                    except Exception:
                        pass

        # Also pull relevant governance documents (policies / standards)
        try:
            doc_rows = db.execute(
                text(
                    "SELECT title, doc_type, status, current_version "
                    "FROM grc_governance_documents "
                    "WHERE tenant_id IN :tids "
                    "AND COALESCE(status,'draft') IN ('published','approved') "
                    "LIMIT 10"
                ),
                {"tids": tuple(tenant_ids) if tenant_ids else (-1,)},
            ).fetchall()

            if doc_rows:
                docs_text = "\n".join(
                    f"- {r.title} ({r.doc_type}, v{r.current_version or '1.0'})" for r in doc_rows
                )
                db_context_parts.append(f"Published documents in your platform:\n{docs_text}")
        except Exception as doc_err:
            logger.warning(f"[DB-CONTEXT] document lookup failed: {doc_err}")
            try:
                db.rollback()
            except Exception:
                pass

    except Exception as db_err:
        logger.warning(f"[DB-CONTEXT] DB context fetch failed: {db_err}")

    db_context = "\n\n".join(db_context_parts) if db_context_parts else ""
    return answer_grc_knowledge_question(question, context_summary, uploaded_context, db_context=db_context)


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

        if request_mode == "blocked_injection":
            answer = (
                "This request contains patterns that ComplyChat cannot process. "
                "Please ask a genuine GRC question about compliance frameworks, risks, controls, policies, or governance."
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

        if request_mode == "blocked_harmful":
            answer = (
                "ComplyChat cannot assist with requests related to bypassing, defeating, or circumventing "
                "security controls, audit trails, or compliance mechanisms. "
                "If you have a legitimate security testing requirement, please work through your authorized "
                "security team and follow your organization's change management and approval process."
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
            # LLM-driven answer — use DB-augmented context for framework/knowledge questions
            logger.info(f"[LLM-GUIDANCE] Routing to DB-augmented LLM guidance for: {request.message}")
            tenant_ids = get_user_tenants(current_user, db)
            answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
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
        
        tenant_ids = get_user_tenants(current_user, db)

        # 🤖 STEP 1: Generate SQL query from natural language
        logger.info("[STATS] Generating SQL query from question...")
        sql_result = generate_sql_query(enhanced_question, language="en", limit=request.limit, offset=request.offset)
        
        if not sql_result.get('sql') or not validate_sql(sql_result['sql']):
            # No valid SQL — fall back to LLM knowledge to answer the question directly
            logger.info(f"[LLM-FALLBACK] No valid SQL generated — routing to LLM guidance")
            answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
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
                        logger.error("[FAIL] RETRY FAILED: New query still has column errors — LLM fallback")
                        answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
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
                else:
                    logger.error("[FAIL] RETRY FAILED: Could not regenerate query")
            
            # If retry failed or no schema found, fall back to LLM knowledge
            if not validation['valid']:
                logger.error("[FAIL] Final validation failed — LLM fallback")
                answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
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
                logger.info(f"[LLM-FALLBACK] SQL returned 0 rows — checking if framework knowledge question")
                if is_framework_knowledge_question(request.message):
                    # Framework knowledge question with no matching DB rows — answer from LLM knowledge directly
                    answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
                else:
                    # Platform data question with no results — give setup guidance
                    answer = answer_grc_knowledge_question(
                        f"The user asked: '{request.message}' inside the ComplyVerse GRC platform.\n"
                        "The platform has no data for this type of information yet.\n\n"
                        "Respond as ComplyChat with a brief, professional message (under 100 words):\n"
                        "1. Acknowledge what they asked\n"
                        "2. Note that no data exists in the platform yet\n"
                        "3. Give 2-3 specific steps to set this up in ComplyVerse\n"
                        "Do NOT use technical jargon. Do NOT mention databases or queries.",
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
            
            # Build response with user-friendly source reference
            entity_label = (sql_result.get('entity_type') or 'data').replace('_', ' ').title()
            sources = [ChatSource(
                rank=1,
                entity_type=sql_result.get('entity_type', 'platform_data'),
                entity_id="",
                framework_code="Live Data",
                control_code=None,
                control_name=f"{entity_label} — {len(data_list)} item(s) found",
                relevance_score=1.0,
                snippet=f"{len(data_list)} record(s) retrieved from your platform"
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
                                logger.info("[LLM-FALLBACK] Retry returned 0 rows — routing to LLM knowledge")
                                answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
                            else:
                                # Format successful retry results
                                answer = format_query_results(retry_data, request.message, retry_sql, language="en")
                            
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
            # All SQL execution errors fall back gracefully to LLM knowledge
            logger.info(f"[LLM-FALLBACK] SQL execution failed — routing to LLM knowledge: {error_str[:80]}")
            answer = answer_with_db_context(request.message, db, tenant_ids, context_summary, uploaded_context)
            
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
