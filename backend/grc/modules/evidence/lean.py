"""The Evidence Library's complete load: ``GET /evidence-mgmt/items?lean=1`` (UX revamp, Stage 4; audit G10 P-9).

The Library draws its rows, live facet counts, board, quick views and exports from the whole list, so it needs every file in ONE request and none of
the weight a list of full records carries: the extracted text of every file (``ocr_content``), the summaries, the custom values, and the two or four
queries a row used to cost (``control_mappings_count``, the four link counts, the uploader, the owner). A lean row has the keys of
``serialize_evidence`` that the Library reads, with the same names and values, and adds ``frameworks`` (the names of the frameworks the file answers),
``links_count`` (risks, assets, incidents and policies together), ``lapsed`` (freshness.py) and ``has_file``; the description, the content summary,
the custom values, the file path and the per-kind link counts are left out. Who sees which file is the standard list's rule (the tenant), not a second one.

Counts are grouped queries over the whole page of ids, not a query per row. The envelope is the list's: ``{items, total, skip, limit}`` plus
``truncated`` (true when more files match than ``LEAN_LIMIT`` allows in one answer; ``total`` is always the true count).
"""
from datetime import datetime
from typing import Any, Dict, Iterator, List, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, load_only

from ...models import (AssetEvidenceLink, ControlObjective, Evidence, EvidenceControlMapping, EvidenceIncidentLink, EvidencePolicyLink, FrameworkControl,
                       FrameworkDomain, Framework, ParsedFrameworkControl, RiskEvidenceLink, UploadedFramework)
from ...services import evidence_review
from .freshness import is_lapsed

# the most rows one lean request returns (``limit`` above it is clamped and the envelope echoes the clamped value)
LEAN_LIMIT = 5_000
# a review comment is a sentence or two; the rest is for the record page
COMMENT_CUT = 400

_COLUMNS = (
    Evidence.id, Evidence.tenant_id, Evidence.name, Evidence.file_path, Evidence.file_name, Evidence.file_type, Evidence.version, Evidence.uploaded_by,
    Evidence.uploaded_at, Evidence.status, Evidence.ocr_status, Evidence.ocr_processed_at, Evidence.evidence_type, Evidence.collection_date,
    Evidence.validity_period_days, Evidence.expiry_date, Evidence.is_stale, Evidence.source_system, Evidence.quality_score, Evidence.owner_id,
    Evidence.submitted_by, Evidence.submitted_at, Evidence.reviewed_by, Evidence.reviewed_at, Evidence.review_comments, Evidence.approved_by,
    Evidence.approved_at, Evidence.ai_review,
)


def chunks(seq: Sequence, size: int = 500) -> Iterator[Sequence]:
    """Slices of ``seq`` short enough for one ``IN (...)`` list."""
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _grouped(db: Session, model: Any, ids: Sequence[int]) -> Dict[int, int]:
    """``{evidence id: number of rows of `model`}`` for a model that has an ``evidence_id``."""
    out: Dict[int, int] = {}
    for chunk in chunks(ids):
        for evidence_id, n in db.query(model.evidence_id, func.count()).filter(model.evidence_id.in_(chunk)).group_by(model.evidence_id):
            out[evidence_id] = int(n)
    return out


def _framework_names(db: Session, ids: Sequence[int]) -> Dict[int, List[str]]:
    """``{evidence id: sorted framework names}`` from the file's control links, by the same rule as ``GET /links/{id}/controls`` (a framework control's
    framework, else a parsed control's uploaded framework, else the name written on the link). Common (SCF) controls name no framework."""
    maps: List[Any] = []
    for chunk in chunks(ids):
        maps.extend(db.query(EvidenceControlMapping.evidence_id, EvidenceControlMapping.framework_control_id, EvidenceControlMapping.parsed_control_id,
                             EvidenceControlMapping.framework_name).filter(EvidenceControlMapping.evidence_id.in_(chunk)))
    fc_ids = sorted({m.framework_control_id for m in maps if m.framework_control_id})
    pc_ids = sorted({m.parsed_control_id for m in maps if m.parsed_control_id and not m.framework_control_id})
    fc_name: Dict[int, str] = {}
    for chunk in chunks(fc_ids):
        for fc_id, name in (db.query(FrameworkControl.id, Framework.name)
                            .join(ControlObjective, FrameworkControl.objective_id == ControlObjective.id)
                            .join(FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id)
                            .join(Framework, FrameworkDomain.framework_id == Framework.id)
                            .filter(FrameworkControl.id.in_(chunk))):
            fc_name[fc_id] = name
    pc_name: Dict[int, str] = {}
    for chunk in chunks(pc_ids):
        for pc_id, name in (db.query(ParsedFrameworkControl.id, UploadedFramework.name)
                            .join(UploadedFramework, ParsedFrameworkControl.uploaded_framework_id == UploadedFramework.id)
                            .filter(ParsedFrameworkControl.id.in_(chunk))):
            pc_name[pc_id] = name
    found: Dict[int, set] = {}
    for m in maps:
        name = fc_name.get(m.framework_control_id) if m.framework_control_id else pc_name.get(m.parsed_control_id) if m.parsed_control_id else None
        name = name or (m.framework_name or "").strip() or None
        if name:
            found.setdefault(m.evidence_id, set()).add(name)
    return {k: sorted(v, key=str.lower) for k, v in found.items()}


def lean_page(db: Session, query, skip: int, limit: int, now: datetime) -> Dict[str, Any]:
    """The lean envelope for ``query`` (the standard list's query, filters applied): the newest files first, one request."""
    limit = max(1, min(limit, LEAN_LIMIT))
    total = query.count()
    rows = (query.options(load_only(*_COLUMNS), joinedload(Evidence.uploader), joinedload(Evidence.owner))
            .order_by(Evidence.uploaded_at.desc(), Evidence.id.desc()).offset(skip).limit(limit).all())
    ids = [e.id for e in rows]
    mappings = _grouped(db, EvidenceControlMapping, ids)
    links: Dict[int, int] = {}
    for model in (RiskEvidenceLink, AssetEvidenceLink, EvidenceIncidentLink, EvidencePolicyLink):
        for evidence_id, n in _grouped(db, model, ids).items():
            links[evidence_id] = links.get(evidence_id, 0) + n
    frameworks = _framework_names(db, ids)

    def iso(value: Any) -> Any:
        return value.isoformat() if value else None

    items = []
    for e in rows:
        lapsed = is_lapsed(e, now)
        items.append({
            "id": e.id,
            "tenant_id": e.tenant_id,
            "name": e.name,
            "file_name": e.file_name,
            "file_type": e.file_type,
            "has_file": bool(e.file_path),
            "version": e.version,
            "uploaded_by": e.uploaded_by,
            "uploader_name": e.uploader.display_name if e.uploader else None,
            "owner_id": e.owner_id,
            "owner_name": e.owner.display_name if e.owner else None,
            "uploaded_at": iso(e.uploaded_at),
            "status": e.status,
            "ocr_status": e.ocr_status,
            "ocr_processed_at": iso(e.ocr_processed_at),
            "evidence_type": e.evidence_type,
            "collection_date": iso(e.collection_date),
            "validity_period_days": e.validity_period_days,
            "expiry_date": iso(e.expiry_date),
            "is_stale": lapsed,
            "lapsed": lapsed,
            "source_system": e.source_system,
            "quality_score": e.quality_score,
            "submitted_by": e.submitted_by,
            "submitted_at": iso(e.submitted_at),
            "reviewed_by": e.reviewed_by,
            "reviewed_at": iso(e.reviewed_at),
            "review_comments": (e.review_comments or "")[:COMMENT_CUT] or None,
            "approved_by": e.approved_by,
            "approved_at": iso(e.approved_at),
            "ai_review": evidence_review.public(e),
            "control_mappings_count": mappings.get(e.id, 0),
            "links_count": mappings.get(e.id, 0) + links.get(e.id, 0),
            "frameworks": frameworks.get(e.id, []),
        })
    return {"items": items, "total": total, "skip": skip, "limit": limit, "truncated": total > skip + len(items)}
