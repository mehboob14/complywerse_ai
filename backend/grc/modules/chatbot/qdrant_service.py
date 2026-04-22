"""
Qdrant-backed vector retrieval for ComplyChat.

This module is intentionally self-contained so chatbot routing can use:
- deterministic document chunk indexing
- OpenAI embeddings
- Qdrant search with tenant isolation
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import requests
from openai import OpenAI
from PyPDF2 import PdfReader

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[3]
WORKSPACE_DIR = BACKEND_DIR.parent

TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".htm",
    ".log",
    ".ini",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".sql",
}


@dataclass
class IndexedSourceDocument:
    tenant_id: int
    source_type: str
    source_id: str
    title: str
    text: str
    description: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    updated_at: str = ""


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value).strip()
    return str(value).strip()


def _normalize_whitespace(text: str) -> str:
    normalized = re.sub(r"\r\n?", "\n", text or "")
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def resolve_existing_path(raw_path: Optional[str]) -> Optional[Path]:
    path_value = (raw_path or "").strip()
    if not path_value:
        return None

    raw = Path(path_value)
    candidates: List[Path] = [raw]
    if not raw.is_absolute():
        candidates.extend(
            [
                (Path.cwd() / raw).resolve(),
                (BACKEND_DIR / raw).resolve(),
                (WORKSPACE_DIR / raw).resolve(),
            ]
        )
    for candidate in candidates:
        try:
            if candidate.exists() and candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _extract_text_from_plain(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            data = path.read_text(encoding=encoding, errors="ignore")
            if data and data.strip():
                return data
        except Exception:
            continue
    return ""


def _extract_text_from_pdf(path: Path) -> str:
    try:
        reader = PdfReader(str(path))
        parts: List[str] = []
        for page in reader.pages[:40]:
            page_text = page.extract_text() or ""
            if page_text.strip():
                parts.append(page_text)
        return "\n\n".join(parts)
    except Exception as exc:
        logger.warning("PDF text extraction failed for %s: %s", path, exc)
        return ""


def _extract_text_from_docx(path: Path) -> str:
    try:
        from docx import Document

        doc = Document(str(path))
        chunks: List[str] = []
        for paragraph in doc.paragraphs:
            text = (paragraph.text or "").strip()
            if text:
                chunks.append(text)
        for table in doc.tables:
            for row in table.rows:
                cells = [(cell.text or "").strip() for cell in row.cells]
                cells = [cell for cell in cells if cell]
                if cells:
                    chunks.append(" | ".join(cells))
        return "\n".join(chunks)
    except Exception as exc:
        logger.warning("DOCX text extraction failed for %s: %s", path, exc)
        return ""


def _extract_text_from_excel(path: Path) -> str:
    try:
        from openpyxl import load_workbook

        workbook = load_workbook(filename=str(path), data_only=True, read_only=True)
        parts: List[str] = []
        for sheet in workbook.worksheets:
            parts.append(f"# Sheet: {sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                cells = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
                if cells:
                    parts.append(" | ".join(cells))
        return "\n".join(parts)
    except Exception as exc:
        logger.warning("Excel text extraction failed for %s: %s", path, exc)
        return ""


def _extract_text_from_legacy_excel(path: Path) -> str:
    try:
        import pandas as pd

        frames = pd.read_excel(str(path), sheet_name=None)
        parts: List[str] = []
        for sheet_name, frame in frames.items():
            parts.append(f"# Sheet: {sheet_name}")
            if frame is None:
                continue
            frame = frame.fillna("")
            for row in frame.values.tolist():
                cells = [str(cell).strip() for cell in row if str(cell).strip()]
                if cells:
                    parts.append(" | ".join(cells))
        return "\n".join(parts)
    except Exception as exc:
        logger.warning("Legacy Excel text extraction failed for %s: %s", path, exc)
        return ""


def extract_text_from_path(raw_path: Optional[str], *, max_chars: int = 12000) -> str:
    resolved = resolve_existing_path(raw_path)
    if not resolved:
        return ""

    suffix = resolved.suffix.lower()
    text_content = ""
    if suffix in TEXT_EXTENSIONS:
        text_content = _extract_text_from_plain(resolved)
    elif suffix == ".pdf":
        text_content = _extract_text_from_pdf(resolved)
    elif suffix == ".docx":
        text_content = _extract_text_from_docx(resolved)
    elif suffix in {".xlsx", ".xlsm", ".xltx", ".xltm"}:
        text_content = _extract_text_from_excel(resolved)
    elif suffix == ".xls":
        text_content = _extract_text_from_legacy_excel(resolved)
    else:
        try:
            text_content = resolved.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            text_content = ""

    cleaned = _normalize_whitespace(text_content)
    return cleaned[:max_chars] if cleaned else ""


def chunk_text(text: str, *, chunk_size: int = 1800, overlap: int = 260) -> List[str]:
    normalized = _normalize_whitespace(text)
    if not normalized:
        return []
    if len(normalized) <= chunk_size:
        return [normalized]

    paragraphs = [part.strip() for part in re.split(r"\n{2,}", normalized) if part.strip()]
    chunks: List[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= chunk_size:
            current = candidate
            continue

        if current:
            chunks.append(current)
        if len(paragraph) <= chunk_size:
            current = paragraph
            continue

        start = 0
        while start < len(paragraph):
            end = min(start + chunk_size, len(paragraph))
            piece = paragraph[start:end].strip()
            if piece:
                chunks.append(piece)
            if end >= len(paragraph):
                break
            start = max(0, end - overlap)
        current = ""

    if current:
        chunks.append(current)

    return [chunk for chunk in chunks if chunk.strip()]


class QdrantComplyChatService:
    def __init__(self) -> None:
        self.qdrant_url = (os.getenv("QDRANT_URL") or "http://127.0.0.1:6333").rstrip("/")
        self.qdrant_api_key = os.getenv("QDRANT_API_KEY")
        self.collection_name = os.getenv("QDRANT_COMPLYCHAT_COLLECTION") or "complychat_documents"
        self.request_timeout = float(os.getenv("QDRANT_TIMEOUT_SECONDS") or "20")
        self.embedding_model = os.getenv("COMPLYCHAT_EMBEDDING_MODEL") or "text-embedding-3-small"
        self.vector_size = int(os.getenv("COMPLYCHAT_VECTOR_SIZE") or "1536")
        self.max_chunks_per_doc = int(os.getenv("COMPLYCHAT_MAX_CHUNKS_PER_DOC") or "18")

        openai_api_key = os.getenv("OPENAI_API_KEY") or os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
        openai_base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("AI_INTEGRATIONS_OPENAI_BASE_URL")
        if openai_api_key or openai_base_url:
            self.openai_client = OpenAI(api_key=openai_api_key, base_url=openai_base_url)
        else:
            self.openai_client = None

    @property
    def is_available(self) -> bool:
        return bool(self.qdrant_url and self.openai_client is not None)

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.qdrant_api_key:
            headers["api-key"] = self.qdrant_api_key
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        accept_404: bool = False,
    ) -> Dict[str, Any]:
        url = f"{self.qdrant_url}{path}"
        response = requests.request(
            method=method.upper(),
            url=url,
            headers=self._headers(),
            json=payload,
            timeout=self.request_timeout,
        )
        if accept_404 and response.status_code == 404:
            return {}
        if response.status_code >= 400:
            raise RuntimeError(f"Qdrant request failed ({response.status_code}): {response.text[:400]}")
        if not response.text.strip():
            return {}
        return response.json()

    def ensure_collection(self) -> None:
        if not self.is_available:
            raise RuntimeError("Qdrant service is not configured.")

        existing = self._request(
            "GET",
            f"/collections/{self.collection_name}",
            accept_404=True,
        )
        if existing:
            return

        self._request(
            "PUT",
            f"/collections/{self.collection_name}",
            payload={
                "vectors": {
                    "size": self.vector_size,
                    "distance": "Cosine",
                }
            },
        )

    def embed_texts(self, texts: Sequence[str]) -> List[List[float]]:
        if not self.openai_client:
            raise RuntimeError("OpenAI client is not configured for embeddings.")
        if not texts:
            return []

        response = self.openai_client.embeddings.create(
            model=self.embedding_model,
            input=list(texts),
        )
        return [list(item.embedding) for item in response.data]

    def _point_id(self, tenant_id: int, source_type: str, source_id: str, chunk_index: int) -> str:
        raw = f"{tenant_id}|{source_type}|{source_id}|{chunk_index}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def delete_source_points(self, tenant_id: int, source_type: str, source_id: str) -> None:
        self._request(
            "POST",
            f"/collections/{self.collection_name}/points/delete?wait=true",
            payload={
                "filter": {
                    "must": [
                        {"key": "tenant_id", "match": {"value": tenant_id}},
                        {"key": "source_type", "match": {"value": source_type}},
                        {"key": "source_id", "match": {"value": source_id}},
                    ]
                }
            },
        )

    def upsert_documents(self, documents: Sequence[IndexedSourceDocument]) -> int:
        if not documents:
            return 0
        self.ensure_collection()

        payload_rows: List[Dict[str, Any]] = []
        chunk_texts: List[str] = []

        for doc in documents:
            content = _normalize_whitespace(doc.text)
            if not content:
                continue
            chunks = chunk_text(content, chunk_size=1800, overlap=260)[: self.max_chunks_per_doc]
            for index, chunk in enumerate(chunks):
                point_id = self._point_id(doc.tenant_id, doc.source_type, doc.source_id, index)
                payload_rows.append(
                    {
                        "id": point_id,
                        "tenant_id": doc.tenant_id,
                        "source_type": doc.source_type,
                        "source_id": doc.source_id,
                        "title": doc.title[:400],
                        "description": doc.description[:800],
                        "snippet": chunk[:700],
                        "text": chunk,
                        "metadata": doc.metadata or {},
                        "updated_at": doc.updated_at or "",
                        "chunk_index": index,
                    }
                )
                chunk_texts.append(chunk)

        if not chunk_texts:
            return 0

        vectors = self.embed_texts(chunk_texts)
        points: List[Dict[str, Any]] = []
        for row, vector in zip(payload_rows, vectors):
            points.append({"id": row["id"], "vector": vector, "payload": row})

        batch_size = 64
        for start in range(0, len(points), batch_size):
            batch = points[start : start + batch_size]
            self._request(
                "PUT",
                f"/collections/{self.collection_name}/points?wait=true",
                payload={"points": batch},
            )
        return len(points)

    def search(
        self,
        *,
        tenant_id: int,
        query: str,
        limit: int = 8,
        source_types: Optional[Sequence[str]] = None,
    ) -> List[Dict[str, Any]]:
        self.ensure_collection()
        embeddings = self.embed_texts([query])
        if not embeddings:
            return []

        must_filters: List[Dict[str, Any]] = [{"key": "tenant_id", "match": {"value": tenant_id}}]
        if source_types:
            must_filters.append({"key": "source_type", "match": {"any": list(source_types)}})

        try:
            response = self._request(
                "POST",
                f"/collections/{self.collection_name}/points/search",
                payload={
                    "vector": embeddings[0],
                    "limit": max(1, min(limit, 20)),
                    "with_payload": True,
                    "filter": {"must": must_filters},
                },
            )
        except Exception:
            # Older Qdrant versions may not support match.any; retry without source type filter.
            response = self._request(
                "POST",
                f"/collections/{self.collection_name}/points/search",
                payload={
                    "vector": embeddings[0],
                    "limit": max(1, min(limit, 20)),
                    "with_payload": True,
                    "filter": {"must": [{"key": "tenant_id", "match": {"value": tenant_id}}]},
                },
            )

        return response.get("result") or []

    def health(self) -> Dict[str, Any]:
        if not self.is_available:
            return {"available": False, "reason": "missing_qdrant_or_openai_configuration"}
        try:
            self.ensure_collection()
            info = self._request("GET", f"/collections/{self.collection_name}")
            status_value = (((info.get("result") or {}).get("status")) or "ok")
            return {"available": True, "collection": self.collection_name, "status": status_value}
        except Exception as exc:
            return {"available": False, "reason": str(exc)}
