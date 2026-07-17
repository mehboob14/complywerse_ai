"""Cross-module reporting query engine (Reporting Phase 3 — server-side scale).

A single tenant-scoped endpoint that runs filter / sort / search / paginate in
SQL so the browser only ever holds one page. This powers the `/reports` module's
"server mode" for datasets large enough that shipping the whole table to the
client (the Phase 1/2 default) is wasteful.

Design notes
------------
* **Tenant isolation is physical.** `get_db` yields a Session bound to the
  request's tenant database (resolved from the subdomain / `X-Tenant-Slug`
  header by `TenantMiddleware`), so queries need no `tenant_id` predicate.
* **No schema duplication.** Rows are serialized by reflecting the model's real
  table columns over a per-dataset field projection — the shape matches the
  module list APIs the client-side path already consumes, so a dataset can flip
  between client and server mode with no frontend column changes.
* **Only clean-serializing datasets are registered.** A dataset belongs here
  only when its report columns are backed by real model columns. Datasets whose
  columns are computed/join-enriched (e.g. control `automation_status`, the
  governance latest-version number) stay client-side until enrichment is added.
* **Guarded by construction.** Unknown sort/filter columns are skipped rather
  than raising, so a registry key that doesn't resolve to a real column
  degrades to "not server-filterable" instead of a 500.

Adding a dataset = one `SERVER_DATASETS` entry (+ `server: true` on the matching
frontend dataset).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, String, and_, func, or_
from sqlalchemy.orm import Session

from ..models import (
    Evidence, ITAsset, Permission, ReportDefinition, Risk, Role, RolePermission,
    Tenant, UserRole, Vulnerability, get_db,
)
from .auth_router import get_user_primary_tenant, require_auth

router = APIRouter(prefix="/reporting", tags=["Reporting Engine"])

MAX_LIMIT = 500


class DatasetSpec:
    """Server-side capability description for one report dataset."""

    def __init__(
        self,
        model: Any,
        *,
        permissions: List[str],
        fields: List[str],
        search: List[str],
        sortable: List[str],
        filterable: Dict[str, str],
        default_order: tuple,
    ) -> None:
        self.model = model
        self.permissions = permissions    # any-of module perms that grant this dataset (same as the frontend)
        self.fields = fields              # columns to serialize (projection — keeps payloads lean)
        self.search = search              # text columns scanned by global search (ILIKE)
        self.sortable = sortable          # column keys allowed in ORDER BY
        self.filterable = filterable      # column key -> type ('text'|'number'|'date'|'badge')
        self.default_order = default_order  # (column_name, 'asc'|'desc')


# Registry — key MUST match the frontend dataset key so the grid can address it.
SERVER_DATASETS: Dict[str, DatasetSpec] = {
    "vulnerabilities": DatasetSpec(
        Vulnerability,
        permissions=["vulnerabilities:vulnerability_register:*"],
        fields=[
            "id", "vuln_id", "title", "severity", "cvss_score", "cve_id", "cwe_id",
            "kev_flag", "epss_score", "status", "affected_host", "affected_component",
            "assigned_to", "due_date", "discovered_at", "resolved_at",
        ],
        search=["title", "vuln_id", "cve_id", "affected_host", "affected_component"],
        sortable=[
            "id", "vuln_id", "title", "severity", "cvss_score", "cve_id", "status",
            "kev_flag", "due_date", "discovered_at", "resolved_at",
        ],
        filterable={
            "severity": "badge", "status": "badge", "cve_id": "text", "cvss_score": "number",
            "kev_flag": "badge", "due_date": "date", "discovered_at": "date", "title": "text",
        },
        default_order=("discovered_at", "desc"),
    ),
    "risks": DatasetSpec(
        Risk,
        permissions=["erm:risks:*"],
        # NB: the risk list API (RiskResponse) has no resolvable owner name — only
        # business_owner_id — so the Owner column was dropped rather than shipped blank.
        # `risk_category` is a real column; the frontend accessor also falls back to
        # `category` (the field RiskResponse exposes) for client mode.
        fields=[
            "id", "title", "risk_category", "register_type",
            "inherent_score", "residual_score", "risk_appetite", "closure_status", "closed_at", "created_at",
        ],
        search=["title", "risk_category"],
        sortable=[
            "id", "title", "risk_category", "register_type",
            "inherent_score", "residual_score", "risk_appetite", "closure_status", "closed_at", "created_at",
        ],
        filterable={
            "risk_category": "badge", "register_type": "text",
            "inherent_score": "number", "residual_score": "number", "risk_appetite": "text",
            "closure_status": "badge", "closed_at": "date", "created_at": "date", "title": "text",
        },
        default_order=("id", "desc"),
    ),
    "assets": DatasetSpec(
        ITAsset,
        permissions=["assets:asset_inventory:*"],
        fields=[
            "id", "name", "asset_type", "criticality", "owner_name", "host_name",
            "ip_address", "location", "internet_facing", "status", "created_at",
        ],
        search=["name", "owner_name", "host_name", "ip_address", "location"],
        sortable=[
            "id", "name", "asset_type", "criticality", "owner_name", "host_name",
            "ip_address", "location", "internet_facing", "status", "created_at",
        ],
        filterable={
            "asset_type": "badge", "criticality": "badge", "owner_name": "text",
            "location": "text", "internet_facing": "badge", "status": "badge",
            "created_at": "date", "name": "text",
        },
        default_order=("id", "desc"),
    ),
    "evidence": DatasetSpec(
        Evidence,
        permissions=["evidence:evidence_library:*", "evidence:evidence_upload:*"],
        # The evidence list API (EvidenceResponse) exposes name / file_type / status /
        # uploaded_at — NOT title / evidence_type / collection_date. Serialize the real
        # fields; the frontend accessors map title<-name, evidence_type<-file_type,
        # created_at<-uploaded_at so client and server modes match.
        fields=["id", "name", "file_type", "status", "uploaded_at", "version"],
        search=["name", "file_type"],
        sortable=["id", "name", "file_type", "status", "uploaded_at", "version"],
        filterable={
            "file_type": "badge", "status": "badge", "uploaded_at": "date", "name": "text",
        },
        default_order=("id", "desc"),
    ),
}


# ── Per-dataset authorization ──────────────────────────────────────────────
def _user_perm_names(user: Any, db: Session) -> set:
    """The permission strings granted to a user, or {'*:*:*'} for admins /
    primary contact — mirrors how /auth/me resolves permissions."""
    tenant = db.query(Tenant).first()
    if tenant and getattr(tenant, "primary_contact_email", None) and user.email \
            and tenant.primary_contact_email.lower() == user.email.lower():
        return {"*:*:*"}
    role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        return set()
    if db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first():
        return {"*:*:*"}
    perms = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id.in_(role_ids))
        .all()
    )
    return {p.name for p in perms if p.name}


def _satisfies(granted: set, required: str) -> bool:
    """Same wildcard grammar as the frontend usePermissions / Sidebar."""
    if "*:*:*" in granted or required in granted:
        return True
    parts = required.split(":")
    if required.endswith(":*"):
        prefix = ":".join(parts[:-1]) + ":"          # 'module:sub:'
        if any(g.startswith(prefix) for g in granted):
            return True
    if len(parts) == 3:                               # covering wildcards
        if f"{parts[0]}:{parts[1]}:*" in granted or f"{parts[0]}:*:*" in granted:
            return True
    return False


def _user_can(user: Any, db: Session, required_any: List[str]) -> bool:
    granted = _user_perm_names(user, db)
    return any(_satisfies(granted, r) for r in required_any)


# ── Request / response shapes ──────────────────────────────────────────────
class SortSpec(BaseModel):
    key: str
    dir: str = "asc"


class FilterSpec(BaseModel):
    col: str
    op: str
    value: Optional[Any] = None


class QueryBody(BaseModel):
    dataset: str
    skip: int = 0
    limit: int = 100
    search: Optional[str] = None
    sorts: List[SortSpec] = Field(default_factory=list)
    filters: List[FilterSpec] = Field(default_factory=list)
    logic: str = "AND"  # how `filters` combine: AND | OR


# ── Helpers ────────────────────────────────────────────────────────────────
def _col(model: Any, name: str):
    """Return the InstrumentedAttribute for a real column, else None (guarded)."""
    if name in model.__table__.columns:
        return getattr(model, name, None)
    return None


def _norm_literal(s: str) -> str:
    """Normalize a display value so 'In Progress' matches raw 'in_progress'."""
    return s.strip().lower().replace("_", " ").replace("-", " ")


def _norm_col(col):
    return func.replace(func.replace(func.lower(col), "_", " "), "-", " ")


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        # Accept 'yyyy-mm-dd' and full ISO timestamps.
        return datetime.fromisoformat(s[:19]) if len(s) > 10 else datetime.fromisoformat(s)
    except ValueError:
        return None


def _build_condition(model: Any, spec: FilterSpec, kind: str):
    """Translate one filter condition into a SQLAlchemy expression, or None to skip."""
    col = _col(model, spec.col)
    if col is None:
        return None
    op = spec.op

    # Emptiness — only string columns have a meaningful "" case; on date/number/
    # boolean columns `col == ""` would be a Postgres type error, so use NULL only.
    if op in ("empty", "notempty"):
        is_text = isinstance(col.type, String)
        if op == "empty":
            return or_(col.is_(None), col == "") if is_text else col.is_(None)
        return and_(col.isnot(None), col != "") if is_text else col.isnot(None)

    val = spec.value
    if val is None or val == "":
        return None

    if kind == "number":
        try:
            num = float(val)
        except (TypeError, ValueError):
            return None
        return {
            "eq": col == num, "neq": col != num, "gt": col > num,
            "lt": col < num, "gte": col >= num, "lte": col <= num,
        }.get(op)

    if kind == "date":
        d = _parse_dt(val)
        if d is None:
            return None
        if op == "before":
            return col < d
        if op == "after":
            # "after <day>" means strictly after that calendar day (matches client).
            return col >= d + timedelta(days=1)
        if op == "on":
            return and_(col >= d, col < d + timedelta(days=1))
        return None

    # Boolean-backed badge columns (kev_flag, internet_facing): coerce truthy text
    # (func.lower / ilike on a boolean column is a Postgres type error).
    if isinstance(col.type, Boolean):
        if op not in ("eq", "neq"):
            return None
        truthy = str(val).strip().lower() in ("1", "true", "yes", "y", "on")
        expr = col.is_(True) if truthy else or_(col.is_(False), col.is_(None))
        return ~expr if op == "neq" else expr

    # text / badge
    s = str(val)
    if op == "eq":
        return _norm_col(col) == _norm_literal(s)
    if op == "neq":
        return _norm_col(col) != _norm_literal(s)
    if op == "contains":
        return col.ilike(f"%{s}%")
    if op == "notcontains":
        return ~col.ilike(f"%{s}%")
    if op == "starts":
        return col.ilike(f"{s}%")
    return None


def _serialize(spec: DatasetSpec, obj: Any) -> Dict[str, Any]:
    """Project the row to its report fields, ISO-encoding date/datetime values."""
    cols = spec.model.__table__.columns
    out: Dict[str, Any] = {}
    for f in spec.fields:
        v = getattr(obj, f, None) if f in cols else None
        if isinstance(v, (datetime, date)):
            v = v.isoformat()
        out[f] = v
    return out


# ── Endpoints ──────────────────────────────────────────────────────────────
@router.get("/datasets")
def list_server_datasets(user=Depends(require_auth)) -> Dict[str, Any]:
    """Capability discovery — which datasets support server mode and how."""
    return {
        "datasets": [
            {
                "key": key,
                "sortable": spec.sortable,
                "filterable": spec.filterable,
                "search": spec.search,
            }
            for key, spec in SERVER_DATASETS.items()
        ]
    }


@router.post("/query")
def query_dataset(body: QueryBody, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Run a paginated, filtered, sorted query for one registered dataset."""
    spec = SERVER_DATASETS.get(body.dataset)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset '{body.dataset}' is not available in server mode.",
        )

    # Authorization: reporting must never be a side door onto a module the user
    # can't open. Gate on the same permission strings the frontend uses.
    if not _user_can(user, db, spec.permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You do not have permission to report on '{body.dataset}'.",
        )

    model = spec.model
    q = db.query(model)

    # Global search across configured text columns.
    if body.search:
        term = f"%{body.search.strip()}%"
        search_cols = [c for c in (_col(model, name) for name in spec.search) if c is not None]
        if search_cols:
            q = q.filter(or_(*[c.ilike(term) for c in search_cols]))

    # Advanced / column filters.
    conditions = []
    for spec_f in body.filters:
        kind = spec.filterable.get(spec_f.col, "text")
        cond = _build_condition(model, spec_f, kind)
        if cond is not None:
            conditions.append(cond)
    if conditions:
        q = q.filter(or_(*conditions) if body.logic.upper() == "OR" else and_(*conditions))

    total = q.count()

    # Sorting — only over whitelisted columns; fall back to the dataset default.
    order_clauses = []
    for s in body.sorts:
        if s.key not in spec.sortable:
            continue
        col = _col(model, s.key)
        if col is None:
            continue
        order_clauses.append(col.desc() if str(s.dir).lower() == "desc" else col.asc())
    if not order_clauses:
        dcol = _col(model, spec.default_order[0])
        if dcol is not None:
            order_clauses.append(dcol.desc() if spec.default_order[1] == "desc" else dcol.asc())
    # Stable tiebreaker: without a unique final sort key, ORDER BY on a non-unique
    # column lets Postgres return rows in any order for ties, so pagination can
    # duplicate or skip rows across pages. Append the PK unless already sorting by it.
    if not any(s.key == "id" for s in body.sorts):
        pk = _col(model, "id")
        if pk is not None:
            order_clauses.append(pk.asc())
    if order_clauses:
        q = q.order_by(*order_clauses)

    skip = max(0, body.skip)
    limit = max(1, min(body.limit, MAX_LIMIT))
    rows = q.offset(skip).limit(limit).all()

    return {
        "rows": [_serialize(spec, r) for r in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


# ── Saved reports ──────────────────────────────────────────────────────────
class ReportDefIn(BaseModel):
    slug: str
    name: str
    dataset: str
    spec: Dict[str, Any] = Field(default_factory=dict)
    is_shared: bool = False


def _report_out(r: ReportDefinition, user_id: Optional[int]) -> Dict[str, Any]:
    return {
        "slug": r.slug,
        "name": r.name,
        "dataset": r.dataset,
        "spec": r.spec or {},
        "is_shared": bool(r.is_shared),
        "is_mine": r.created_by == user_id,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@router.get("/reports")
def list_reports(db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Reports the caller can see: their own, plus anything shared in the tenant."""
    rows = (
        db.query(ReportDefinition)
        .filter(or_(ReportDefinition.created_by == user.id, ReportDefinition.is_shared.is_(True)))
        .order_by(ReportDefinition.updated_at.desc())
        .all()
    )
    return {"reports": [_report_out(r, user.id) for r in rows]}


@router.post("/reports")
def upsert_report(body: ReportDefIn, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Create or update one of the caller's own reports (keyed by slug).

    A shared report belonging to someone else is never mutated here — saving it
    creates the caller's own copy under the same slug, which the (slug, owner)
    uniqueness allows.
    """
    row = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.slug == body.slug, ReportDefinition.created_by == user.id)
        .first()
    )
    if row is None:
        try:
            tenant_id = get_user_primary_tenant(user, db)
        except Exception:
            tenant_id = None
        row = ReportDefinition(slug=body.slug, created_by=user.id, tenant_id=tenant_id)
        db.add(row)

    row.name = body.name
    row.dataset = body.dataset
    row.spec = body.spec
    row.is_shared = body.is_shared
    db.commit()
    db.refresh(row)
    return _report_out(row, user.id)


@router.delete("/reports/{slug}")
def delete_report(slug: str, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Delete one of the caller's own reports. Shared reports owned by someone
    else are not the caller's to remove."""
    row = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.slug == slug, ReportDefinition.created_by == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found (or not yours to delete).")
    db.delete(row)
    db.commit()
    return {"deleted": slug}
