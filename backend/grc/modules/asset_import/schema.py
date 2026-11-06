"""Request/response models for the asset-import wizard."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class CanonicalField(BaseModel):
    key: str
    label: str
    required: bool = False


class AnalyzeResponse(BaseModel):
    filename: str
    kind: str = "asset"
    header_row: int
    columns: List[str]
    row_count: int
    sample_rows: List[Dict[str, Any]]
    # source_header -> {field, confidence, why}
    suggested_mapping: Dict[str, Dict[str, Any]]
    canonical_fields: List[CanonicalField]
    ai_available: bool = False


class CommitResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: List[str]
    total_errors: int
    row_count: int
    batch_id: str
    message: str


class UndoResponse(BaseModel):
    deleted: int
    failed: int
    batch_id: str
    message: str
