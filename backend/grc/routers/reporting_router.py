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

import json
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, String, and_, false, func, or_, true
from sqlalchemy.orm import Session

from ..models import (
    CriticalTask, Evidence, GovernanceDocument, GRCUser, InternalControl, Issue, ITAsset,
    MetricSnapshot, MetricTarget, Permission, ReportDefinition, Risk, Role,
    RolePermission, Tenant, UserRole, Vendor, Vulnerability, get_db,
)
from ..services import metric_catalog, metric_snapshots
from ..services import report_linkages, report_open_catalog
from .auth_router import get_user_primary_tenant, get_user_tenants, require_auth

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
        user_fields: Optional[Dict[str, str]] = None,
    ) -> None:
        self.model = model
        self.permissions = permissions    # any-of module perms that grant this dataset (same as the frontend)
        self.fields = fields              # columns to serialize (projection — keeps payloads lean)
        self.search = search              # text columns scanned by global search (ILIKE)
        self.sortable = sortable          # column keys allowed in ORDER BY
        self.filterable = filterable      # column key -> type ('text'|'number'|'date'|'badge')
        self.default_order = default_order  # (column_name, 'asc'|'desc')
        # Maps a raw integer FK column (already in `fields`) to the resolved
        # display-name key that the frontend expects (e.g. owner_id -> owner_name).
        self.user_fields: Dict[str, str] = user_fields or {}


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
            "id", "vuln_id", "title", "severity", "cvss_score", "cve_id", "cwe_id", "status",
            "kev_flag", "due_date", "discovered_at", "resolved_at", "affected_host",
            "affected_component", "assigned_to",
        ],
        filterable={
            "severity": "badge", "status": "badge", "cve_id": "text", "cvss_score": "number",
            "kev_flag": "badge", "due_date": "date", "discovered_at": "date", "title": "text",
            # FE vuln-aligned keys (Asset / Owner / Detected) + the rest of the
            # register's identity/classification columns.
            "affected_host": "text", "assigned_to": "number", "resolved_at": "date",
            "vuln_id": "text", "cwe_id": "text", "affected_component": "text",
        },
        default_order=("discovered_at", "desc"),
        # `assigned_to` is a user FK — resolve it to a display name so the report's
        # Owner column shows a name in server mode, not a raw id.
        user_fields={"assigned_to": "assignee_name"},
    ),
    "risks": DatasetSpec(
        Risk,
        permissions=["erm:risks:*"],
        # NB: the risk list API (RiskResponse) has no resolvable owner name — only
        # business_owner_id — so the Owner column was dropped rather than shipped blank.
        # `risk_category` is a real column; the frontend accessor also falls back to
        # `category` (the field RiskResponse exposes) for client mode.
        # `status` is the real lifecycle field (open/active/…), always populated;
        # `closure_status` is only set during the closure workflow (null for most).
        # Both are projected so the report's Status column has real data.
        fields=[
            "id", "title", "risk_category", "register_type",
            "inherent_score", "residual_score", "risk_appetite", "status", "closure_status", "closed_at", "created_at",
        ],
        search=["title", "risk_category"],
        sortable=[
            "id", "title", "risk_category", "register_type",
            "inherent_score", "residual_score", "risk_appetite", "status", "closure_status", "closed_at", "created_at",
        ],
        filterable={
            "risk_category": "badge", "register_type": "text",
            "inherent_score": "number", "residual_score": "number", "risk_appetite": "text",
            "status": "badge", "closure_status": "badge", "closed_at": "date", "created_at": "date", "title": "text",
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
        fields=[
            "id", "name", "file_type", "evidence_type", "status", "version",
            "uploaded_at", "collection_date", "expiry_date", "is_stale", "owner_id",
        ],
        search=["name", "file_type", "evidence_type"],
        sortable=[
            "id", "name", "file_type", "evidence_type", "status", "uploaded_at",
            "collection_date", "expiry_date", "is_stale", "version",
        ],
        filterable={
            "file_type": "badge", "evidence_type": "badge", "status": "badge",
            "is_stale": "badge", "uploaded_at": "date", "collection_date": "date",
            "expiry_date": "date", "name": "text",
        },
        default_order=("id", "desc"),
        user_fields={"owner_id": "owner_name"},
    ),
    # ── Wave 5 promotions — real columns only; FE columns with no matching
    # model column (nested display-name objects, renamed keys) are covered by
    # an accessor fallback to the scalar FK / real column serialized here
    # rather than shipped blank.
    "issues": DatasetSpec(
        Issue,
        permissions=["issue_management:issues:*"],
        fields=[
            "id", "code", "title", "description", "severity", "workflow_state",
            "issue_type", "category", "source_type", "sla_breached", "assignee_id",
            "created_at", "target_closure_date",
        ],
        search=["title", "code", "description"],
        sortable=[
            "id", "code", "title", "severity", "workflow_state", "issue_type", "category",
            "source_type", "sla_breached", "created_at", "target_closure_date",
        ],
        filterable={
            "severity": "badge", "workflow_state": "badge", "issue_type": "badge",
            "category": "text", "source_type": "badge", "sla_breached": "badge",
            "created_at": "date", "target_closure_date": "date", "title": "text", "code": "text",
        },
        default_order=("created_at", "desc"),
        user_fields={"assignee_id": "assignee_name"},
    ),
    "tasks": DatasetSpec(
        CriticalTask,
        permissions=["critical_tasks:tasks:*", "critical_tasks:reports:view"],
        fields=[
            "id", "title", "status", "priority", "assigned_owner_id", "due_date",
            "created_at", "source_module", "source", "category", "linked_risk_id",
            "linked_issue_id",
        ],
        search=["title"],
        sortable=[
            "id", "title", "status", "priority", "due_date", "created_at",
            "source_module", "source", "category", "linked_risk_id", "linked_issue_id",
        ],
        filterable={
            "status": "badge", "priority": "badge", "due_date": "date", "created_at": "date",
            "source_module": "text", "source": "text", "category": "text", "title": "text",
            "linked_risk_id": "number", "linked_issue_id": "number",
        },
        default_order=("created_at", "desc"),
        user_fields={"assigned_owner_id": "assignee_name"},
    ),
    "vendors": DatasetSpec(
        Vendor,
        permissions=["erm:risks:*"],
        # NB: FE `tier` / `residual_risk_score` / `primary_contact_name` /
        # `website` / `next_reassessment_date` are all real columns — no
        # accessor fallback needed for this dataset.
        fields=[
            "id", "name", "vendor_type", "tier", "data_access_level", "status",
            "primary_contact_name", "website", "residual_risk_score",
            "next_reassessment_date", "created_at",
        ],
        search=["name", "primary_contact_name"],
        sortable=[
            "id", "name", "vendor_type", "tier", "data_access_level", "status",
            "residual_risk_score", "next_reassessment_date", "created_at",
        ],
        filterable={
            "vendor_type": "badge", "tier": "badge", "data_access_level": "badge",
            "status": "badge", "residual_risk_score": "number",
            "next_reassessment_date": "date", "created_at": "date", "name": "text",
        },
        default_order=("created_at", "desc"),
    ),
    "gov_documents": DatasetSpec(
        GovernanceDocument,
        permissions=["governance:policies:*"],
        fields=[
            "id", "title", "doc_type", "status", "classification", "current_version",
            "owner_id", "effective_date", "next_review_date", "last_reviewed_at",
            "approved_at", "published_at", "created_at",
        ],
        search=["title", "document_code"],
        sortable=[
            "id", "title", "doc_type", "status", "classification", "current_version",
            "effective_date", "next_review_date", "last_reviewed_at", "approved_at",
            "published_at", "created_at",
        ],
        filterable={
            "doc_type": "badge", "status": "badge", "classification": "text",
            "effective_date": "date", "next_review_date": "date",
            "last_reviewed_at": "date", "approved_at": "date", "published_at": "date",
            "title": "text",
        },
        default_order=("created_at", "desc"),
        user_fields={"owner_id": "owner_name"},
    ),
    "internal_controls": DatasetSpec(
        InternalControl,
        permissions=["erm:risks:*"],
        fields=[
            "id", "control_id", "name", "category", "control_type", "status",
            "design_effectiveness", "operating_effectiveness", "priority",
            "is_key_control", "owner_id", "next_test_date", "created_at",
        ],
        search=["name", "control_id"],
        sortable=[
            "id", "control_id", "name", "category", "control_type", "status",
            "design_effectiveness", "operating_effectiveness", "priority",
            "is_key_control", "next_test_date", "created_at",
        ],
        filterable={
            "category": "badge", "control_type": "badge", "status": "badge",
            "design_effectiveness": "badge", "operating_effectiveness": "badge",
            "priority": "badge", "is_key_control": "badge", "next_test_date": "date",
            "created_at": "date", "name": "text", "control_id": "text",
        },
        default_order=("created_at", "desc"),
        user_fields={"owner_id": "owner_name"},
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


class AggregateMeasureSpec(BaseModel):
    id: str
    field: Optional[str] = None  # empty / omitted for count(*)
    fn: str = "count"  # count | count_distinct | sum | avg | min | max
    pct_of_total: bool = False


class AggregateBody(BaseModel):
    dataset: str
    search: Optional[str] = None
    sorts: List[SortSpec] = Field(default_factory=list)
    filters: List[FilterSpec] = Field(default_factory=list)
    logic: str = "AND"
    group_by: List[str] = Field(default_factory=list)
    measures: List[AggregateMeasureSpec] = Field(default_factory=list)


_ALLOWED_AGG_FNS = frozenset({"count", "count_distinct", "sum", "avg", "min", "max"})


def _agg_sql(fn: str, col):
    """Map an allowlisted aggregate name to a SQLAlchemy expression. Never accepts raw SQL."""
    if fn == "count":
        return func.count() if col is None else func.count(col)
    if fn == "count_distinct":
        return func.count(func.distinct(col))
    if fn == "sum":
        return func.sum(col)
    if fn == "avg":
        return func.avg(col)
    if fn == "min":
        return func.min(col)
    if fn == "max":
        return func.max(col)
    return None


def _apply_query_filters(
    q,
    model: Any,
    spec: DatasetSpec,
    body_filters: List[FilterSpec],
    logic: str,
    search: Optional[str],
    db: Optional[Session] = None,
    dataset_key: Optional[str] = None,
):
    """Shared WHERE builder for /query and /aggregate. Returns (query, skipped_filters)."""
    if search:
        term = f"%{search.strip()}%"
        search_cols = [c for c in (_col(model, name) for name in spec.search) if c is not None]
        if search_cols:
            q = q.filter(or_(*[c.ilike(term) for c in search_cols]))

    conditions = []
    skipped_filters: List[Dict[str, Any]] = []
    for spec_f in body_filters:
        kind = spec.filterable.get(spec_f.col, "text")
        cond, skip_reason = _build_condition(model, spec_f, kind, db=db, dataset_key=dataset_key)
        if cond is not None:
            conditions.append(cond)
        elif skip_reason:
            skipped_filters.append({"col": spec_f.col, "op": spec_f.op, "reason": skip_reason})
    if conditions:
        q = q.filter(or_(*conditions) if logic.upper() == "OR" else and_(*conditions))
    return q, skipped_filters


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


def _parse_multi_values(val: Any) -> List[str]:
    """Decode multi-select filter values (JSON array, ``|``-joined, or scalar)."""
    if val is None:
        return []
    if isinstance(val, (list, tuple)):
        return [str(x).strip() for x in val if str(x).strip()]
    s = str(val).strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    if "|" in s:
        return [p.strip() for p in s.split("|") if p.strip()]
    return [s]


# Sentinel matching the frontend EMPTY_TOKEN — blank / unassigned facet pick.
_EMPTY_TOKEN = "__EMPTY__"


def _link_presence_condition(model: Any, spec: FilterSpec, db: Session, dataset_key: str):
    """`linkpresence_<target>` + linked/notlinked as a real WHERE clause.

    The browser can only judge "is this row linked" from enriched rows it has
    already downloaded, so a gap filter used to be capped at whatever the build
    pass fetched (5,000 rows) and quietly reported every row past that as
    unlinked. Resolving the linked id set in SQL makes it exact over the whole
    register and lets the answer paginate like any other filter.
    """
    target = spec.col[len("linkpresence_"):]
    pk = _col(model, "id")
    if not target or pk is None:
        return None, "unknown_column"
    linked = report_open_catalog.linked_base_ids(db, dataset_key, target)
    if linked is None:
        return None, "unsupported_operator"   # no join edge — let the client try
    if not linked:
        # Nothing is linked: "not linked" is everything, "linked" is nothing.
        # Expressed as a literal so an empty IN () never becomes a SQL error.
        return (true() if spec.op == "notlinked" else false()), None
    ids = list(linked)
    return (pk.notin_(ids) if spec.op == "notlinked" else pk.in_(ids)), None


def _build_condition(
    model: Any,
    spec: FilterSpec,
    kind: str,
    db: Optional[Session] = None,
    dataset_key: Optional[str] = None,
):
    """Translate one filter condition into a SQLAlchemy expression.

    Returns ``(condition_or_None, skip_reason_or_None)``. `skip_reason` is only
    set when the filter was dropped for a reason the *client* can act on
    (unknown column, an operator this dataset doesn't support, an unparsable
    value) so the caller can surface it as a `warnings.skipped_filters` entry.
    The common "no value typed yet" case stays silent, exactly like before.
    """
    op = spec.op

    # Cross-module link presence resolves through the report linkage graph, not
    # a column on this table — so it is handled before the column lookup.
    if op in ("linked", "notlinked"):
        if db is not None and dataset_key and spec.col.startswith("linkpresence_"):
            return _link_presence_condition(model, spec, db, dataset_key)
        return None, "unsupported_operator"

    col = _col(model, spec.col)
    if col is None:
        return None, "unknown_column"

    # Emptiness — only string columns have a meaningful "" case; on date/number/
    # boolean columns `col == ""` would be a Postgres type error, so use NULL only.
    if op in ("empty", "notempty"):
        is_text = isinstance(col.type, String)
        if op == "empty":
            return (or_(col.is_(None), col == "") if is_text else col.is_(None)), None
        return (and_(col.isnot(None), col != "") if is_text else col.isnot(None)), None

    val = spec.value
    if val is None or val == "":
        return None, None  # nothing to filter on yet — not an error

    if kind == "number":
        try:
            num = float(val)
        except (TypeError, ValueError):
            return None, "invalid_value"
        expr = {
            "eq": col == num, "neq": col != num, "gt": col > num,
            "lt": col < num, "gte": col >= num, "lte": col <= num,
        }.get(op)
        return expr, (None if expr is not None else "unsupported_operator")

    if kind == "date":
        d = _parse_dt(val)
        if d is None:
            return None, "invalid_value"
        if op == "before":
            return col < d, None
        if op == "after":
            # "after <day>" means strictly after that calendar day (matches client).
            return col >= d + timedelta(days=1), None
        if op == "on":
            return and_(col >= d, col < d + timedelta(days=1)), None
        return None, "unsupported_operator"

    # Boolean-backed badge columns (kev_flag, internet_facing): coerce truthy text
    # (func.lower / ilike on a boolean column is a Postgres type error).
    if isinstance(col.type, Boolean):
        if op in ("in", "notin"):
            parts = _parse_multi_values(val)
            names = [p for p in parts if p != _EMPTY_TOKEN]
            if not names:
                return None, "invalid_value"
            # Match if ANY selected token is truthy-equivalent to the column.
            wants_true = any(
                str(p).strip().lower() in ("1", "true", "yes", "y", "on") for p in names
            )
            wants_false = any(
                str(p).strip().lower() in ("0", "false", "no", "n", "off") for p in names
            )
            clauses = []
            if wants_true:
                clauses.append(col.is_(True))
            if wants_false:
                clauses.append(or_(col.is_(False), col.is_(None)))
            if not clauses:
                return None, "invalid_value"
            expr = or_(*clauses)
            return (~expr if op == "notin" else expr), None
        if op not in ("eq", "neq"):
            return None, "unsupported_operator"
        truthy = str(val).strip().lower() in ("1", "true", "yes", "y", "on")
        expr = col.is_(True) if truthy else or_(col.is_(False), col.is_(None))
        return (~expr if op == "neq" else expr), None

    # text / badge — including multi-select facets
    if op in ("in", "notin"):
        parts = _parse_multi_values(val)
        if not parts:
            return None, None
        wants_empty = _EMPTY_TOKEN in parts
        names = [p for p in parts if p != _EMPTY_TOKEN]
        is_text = isinstance(col.type, String)
        clauses = []
        if names:
            clauses.append(or_(*[_norm_col(col) == _norm_literal(n) for n in names]))
        if wants_empty:
            clauses.append(or_(col.is_(None), col == "") if is_text else col.is_(None))
        if not clauses:
            return None, "invalid_value"
        expr = or_(*clauses)
        return (~expr if op == "notin" else expr), None

    s = str(val)
    if op == "eq":
        return _norm_col(col) == _norm_literal(s), None
    if op == "neq":
        return _norm_col(col) != _norm_literal(s), None
    if op == "contains":
        return col.ilike(f"%{s}%"), None
    if op == "notcontains":
        return ~col.ilike(f"%{s}%"), None
    if op == "starts":
        return col.ilike(f"{s}%"), None
    return None, "unsupported_operator"


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

    q, skipped_filters = _apply_query_filters(
        q, model, spec, body.filters, body.logic, body.search,
        db=db, dataset_key=body.dataset,
    )

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

    serialized = [_serialize(spec, r) for r in rows]

    # Resolve user FKs to display names in one batch query per dataset.
    if spec.user_fields and serialized:
        user_id_set: set = set()
        for fk_col in spec.user_fields:
            for row in serialized:
                uid = row.get(fk_col)
                if uid is not None:
                    try:
                        user_id_set.add(int(uid))
                    except (TypeError, ValueError):
                        pass
        if user_id_set:
            users = db.query(GRCUser).filter(GRCUser.id.in_(list(user_id_set))).all()
            user_map: Dict[int, str] = {
                u.id: (u.display_name or u.username or str(u.id))
                for u in users
            }
            for row in serialized:
                for fk_col, name_col in spec.user_fields.items():
                    uid = row.get(fk_col)
                    if uid is not None:
                        try:
                            row[name_col] = user_map.get(int(uid))
                        except (TypeError, ValueError):
                            pass

    result: Dict[str, Any] = {
        "rows": serialized,
        "total": total,
        "skip": skip,
        "limit": limit,
    }
    if skipped_filters:
        result["warnings"] = {"skipped_filters": skipped_filters}
    return result


@router.post("/aggregate")
def aggregate_dataset(body: AggregateBody, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Run allowlisted GROUP BY + aggregate measures for one server dataset.

    Filters apply first (WHERE), then grouping. Only columns present on the
    model and functions in ``_ALLOWED_AGG_FNS`` are accepted — never raw SQL.
    """
    spec = SERVER_DATASETS.get(body.dataset)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset '{body.dataset}' is not available in server mode.",
        )
    if not _user_can(user, db, spec.permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You do not have permission to report on '{body.dataset}'.",
        )
    if not body.measures:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one measure is required.",
        )

    model = spec.model
    # Allowlist: real table columns that are filterable, sortable, or projected.
    allowed_cols = set(spec.fields) | set(spec.sortable) | set(spec.filterable.keys())

    skipped_group_by: List[str] = []
    group_cols = []
    group_keys: List[str] = []
    for key in body.group_by:
        if key not in allowed_cols:
            skipped_group_by.append(key)
            continue
        col = _col(model, key)
        if col is None:
            skipped_group_by.append(key)
            continue
        group_cols.append(col)
        group_keys.append(key)

    skipped_measures: List[str] = []
    select_exprs = list(group_cols)
    measure_meta: List[Dict[str, Any]] = []  # parallel to measure aliases after group cols

    for m in body.measures:
        fn = (m.fn or "count").lower().strip()
        if fn not in _ALLOWED_AGG_FNS:
            skipped_measures.append(m.id)
            continue
        field = (m.field or "").strip() or None
        col = None
        if fn == "count" and not field:
            col = None
        else:
            if not field or field not in allowed_cols:
                skipped_measures.append(m.id)
                continue
            col = _col(model, field)
            if col is None:
                skipped_measures.append(m.id)
                continue
            # sum/avg only on numeric-typed filterable columns (or any real column
            # when the dataset didn't declare a type — still safer than free SQL).
            if fn in ("sum", "avg"):
                kind = spec.filterable.get(field)
                if kind is not None and kind != "number":
                    skipped_measures.append(m.id)
                    continue

        expr = _agg_sql(fn, col)
        if expr is None:
            skipped_measures.append(m.id)
            continue
        alias = f"m_{m.id}"
        select_exprs.append(expr.label(alias))
        measure_meta.append({
            "id": m.id,
            "alias": alias,
            "fn": fn,
            "field": field,
            "pct_of_total": bool(m.pct_of_total) and fn in ("count", "count_distinct"),
            "label": _measure_label(fn, field, spec),
        })

    if not measure_meta:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid measures after allowlist checks.",
        )

    q = db.query(*select_exprs).select_from(model)
    q, skipped_filters = _apply_query_filters(
        q, model, spec, body.filters, body.logic, body.search,
        db=db, dataset_key=body.dataset,
    )
    if group_cols:
        q = q.group_by(*group_cols)

    # Optional sort — only over group keys or measure aliases.
    order_clauses = []
    labeled = {getattr(se, "key", None) or getattr(se, "name", None): se for se in select_exprs}
    for s in body.sorts:
        key = s.key
        col_expr = None
        if key in group_keys:
            col_expr = _col(model, key)
        elif key in labeled:
            col_expr = labeled[key]
        elif key.startswith("m_") and key in labeled:
            col_expr = labeled[key]
        if col_expr is None:
            continue
        order_clauses.append(col_expr.desc() if str(s.dir).lower() == "desc" else col_expr.asc())
    if order_clauses:
        q = q.order_by(*order_clauses)
    elif group_cols:
        q = q.order_by(*[c.asc() for c in group_cols])

    raw_rows = q.limit(MAX_LIMIT).all()

    # Grand totals for pct_of_total (ungrouped aggregates over the same filter).
    grand_vals: Dict[str, Any] = {}
    need_pct = any(mm["pct_of_total"] for mm in measure_meta)
    if need_pct:
        g_exprs = []
        for mm in measure_meta:
            field = mm["field"]
            col = _col(model, field) if field else None
            g_exprs.append(_agg_sql(mm["fn"], col).label(mm["alias"]))
        gq = db.query(*g_exprs).select_from(model)
        gq, _ = _apply_query_filters(
            gq, model, spec, body.filters, body.logic, body.search,
            db=db, dataset_key=body.dataset,
        )
        g_row = gq.one()
        g_map = g_row._mapping if hasattr(g_row, "_mapping") else None
        for i, mm in enumerate(measure_meta):
            raw_v = g_map[mm["alias"]] if g_map is not None else g_row[i]
            grand_vals[mm["alias"]] = _num_or_none(raw_v)

    out_rows: List[Dict[str, Any]] = []
    for raw in raw_rows:
        mapping = raw._mapping if hasattr(raw, "_mapping") else None
        row: Dict[str, Any] = {}
        for i, key in enumerate(group_keys):
            v = mapping[key] if mapping is not None else raw[i]
            if isinstance(v, (datetime, date)):
                v = v.isoformat()
            row[key] = v
        for mi, mm in enumerate(measure_meta):
            alias = mm["alias"]
            v = mapping[alias] if mapping is not None else raw[len(group_keys) + mi]
            v = _num_or_none(v)
            row[alias] = v
            if mm["pct_of_total"]:
                g = grand_vals.get(alias)
                row[f"{alias}_pct"] = (
                    round((float(v) / float(g)) * 100, 1)
                    if g and v is not None and float(g) > 0
                    else None
                )
        out_rows.append(row)

    columns: List[Dict[str, Any]] = []
    for key in group_keys:
        kind = spec.filterable.get(key, "text")
        columns.append({"key": key, "label": key.replace("_", " ").title(), "type": kind})
    for mm in measure_meta:
        columns.append({"key": mm["alias"], "label": mm["label"], "type": "number"})
        if mm["pct_of_total"]:
            columns.append({"key": f"{mm['alias']}_pct", "label": "% of total", "type": "number"})

    result: Dict[str, Any] = {
        "rows": out_rows,
        "total": len(out_rows),
        "columns": columns,
        "grand": {mm["alias"]: grand_vals.get(mm["alias"]) for mm in measure_meta} if need_pct else None,
    }
    warnings: Dict[str, Any] = {}
    if skipped_filters:
        warnings["skipped_filters"] = skipped_filters
    if skipped_group_by:
        warnings["skipped_group_by"] = skipped_group_by
    if skipped_measures:
        warnings["skipped_measures"] = skipped_measures
    if warnings:
        result["warnings"] = warnings
    return result


def _num_or_none(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _measure_label(fn: str, field: Optional[str], _spec: DatasetSpec) -> str:
    labels = {
        "count": "Count",
        "count_distinct": "Distinct",
        "sum": "Sum",
        "avg": "Avg",
        "min": "Min",
        "max": "Max",
    }
    prefix = labels.get(fn, fn)
    if fn == "count" and not field:
        return prefix
    pretty = (field or "").replace("_", " ").title()
    if fn == "count_distinct":
        return f"Distinct {pretty}"
    return f"{prefix} {pretty}"


# ── Saved reports ──────────────────────────────────────────────────────────
_REPORT_TABLE_ENSURED: set = set()


def _ensure_report_table(db: Session) -> None:
    """Self-heal grc_report_definitions for tenant DBs that predate the model.

    This app has no Alembic; create_all runs at tenant provisioning, so existing
    tenants need a checkfirst create on first use (same pattern as MetricTarget).
    """
    try:
        key = str(getattr(db.get_bind(), "url", "default"))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _REPORT_TABLE_ENSURED:
        return
    try:
        ReportDefinition.__table__.create(bind=db.get_bind(), checkfirst=True)
        _REPORT_TABLE_ENSURED.add(key)
    except Exception:  # noqa: BLE001 — never block the caller
        pass


class ReportDefIn(BaseModel):
    slug: str
    name: str
    # A dashboard draws on its tiles' reports, so it carries no dataset.
    dataset: str = ""
    kind: str = "report"
    spec: Dict[str, Any] = Field(default_factory=dict)
    is_shared: bool = False


_KINDS = frozenset({"report", "dashboard"})


def _report_out(r: ReportDefinition, user_id: Optional[int]) -> Dict[str, Any]:
    return {
        "slug": r.slug,
        "name": r.name,
        "kind": getattr(r, "kind", None) or "report",
        "dataset": r.dataset,
        "spec": r.spec or {},
        "is_shared": bool(r.is_shared),
        "is_mine": r.created_by == user_id,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _kind_filter(kind: str):
    """Rows written before `kind` existed have NULL, and they are all reports —
    so a plain `kind == 'report'` would hide every report saved to date."""
    if kind == "report":
        return or_(ReportDefinition.kind.is_(None), ReportDefinition.kind == "report")
    return ReportDefinition.kind == kind


@router.get("/reports")
def list_reports(
    kind: str = "report",
    db: Session = Depends(get_db),
    user=Depends(require_auth),
) -> Dict[str, Any]:
    """Reports the caller can see: their own, plus anything shared in the tenant.

    `kind` selects reports or dashboards — they share this table because a
    dashboard is the same kind of object (an owned, shareable JSON spec).
    """
    _ensure_report_table(db)
    if kind not in _KINDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown kind '{kind}'.",
        )
    rows = (
        db.query(ReportDefinition)
        .filter(
            or_(ReportDefinition.created_by == user.id, ReportDefinition.is_shared.is_(True)),
            _kind_filter(kind),
        )
        .order_by(ReportDefinition.updated_at.desc())
        .all()
    )
    return {"reports": [_report_out(r, user.id) for r in rows]}


@router.get("/reports/{slug}")
def get_report(slug: str, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Fetch one saved report by slug (own or shared-in-tenant)."""
    _ensure_report_table(db)
    own = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.slug == slug, ReportDefinition.created_by == user.id)
        .first()
    )
    if own is not None:
        return _report_out(own, user.id)
    shared = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.slug == slug, ReportDefinition.is_shared.is_(True))
        .first()
    )
    if shared is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return _report_out(shared, user.id)


@router.post("/reports")
def upsert_report(body: ReportDefIn, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Create or update one of the caller's own reports (keyed by slug).

    A shared report belonging to someone else is never mutated here — saving it
    creates the caller's own copy under the same slug, which the (slug, owner)
    uniqueness allows.
    """
    _ensure_report_table(db)
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
    row.kind = body.kind if body.kind in _KINDS else "report"
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
    _ensure_report_table(db)
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


# ── Cross-module linkage enrichment ───────────────────────────────────────────

class EnrichBody(BaseModel):
    dataset: str
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    includes: List[str] = Field(default_factory=list)
    # Open column keys to project (xmod_<dataset>__<field>, link_*, …)
    project: List[str] = Field(default_factory=list)


@router.get("/linkages")
def list_linkages(dataset: str, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Return linkable modules + column definitions for a dataset.

    Prefer the open catalog (every other module's fields). Legacy aggregate
    fields are merged in when present.
    """
    catalog = report_linkages.get_linkage_catalog(dataset)
    spec = SERVER_DATASETS.get(dataset)
    if spec and not _user_can(user, db, spec.permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this dataset.")
    return {"dataset": dataset, "linkages": catalog}


@router.post("/enrich")
def enrich_dataset_rows(body: EnrichBody, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Merge cross-module linkage columns into report rows (batch, tenant-scoped)."""
    spec = SERVER_DATASETS.get(body.dataset)
    if spec and not _user_can(user, db, spec.permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot access this dataset.")
    enriched = report_linkages.enrich_rows(
        db,
        dataset=body.dataset,
        rows=body.rows,
        includes=body.includes,
        project=body.project or None,
    )
    return {"rows": enriched, "includes": body.includes}


# ── Trends (cross-module time-series) ──────────────────────────────────────────
# Historical snapshots live in grc_metric_snapshot (written daily by the same
# per-tenant sweep that writes the risk KPIs). These endpoints read that history,
# compute period-over-period deltas + a RAG status against each metric's target,
# and let a user set targets or capture a snapshot on demand. Every metric is
# gated by the SAME module permission its /reports dataset uses.

_TARGET_ENSURED: set = set()


def _ensure_target_table(db: Session) -> None:
    try:
        key = str(getattr(db.get_bind(), "url", "default"))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _TARGET_ENSURED:
        return
    try:
        MetricTarget.__table__.create(bind=db.get_bind(), checkfirst=True)
        _TARGET_ENSURED.add(key)
    except Exception:  # noqa: BLE001 — never block the caller
        pass


def _tenant_id(user: Any, db: Session) -> int:
    tids = get_user_tenants(user, db)
    if tids:
        return tids[0]
    try:
        return get_user_primary_tenant(user, db) or 0
    except Exception:  # noqa: BLE001
        return 0


def _targets_map(db: Session, tenant_id: int) -> Dict[tuple, MetricTarget]:
    _ensure_target_table(db)
    rows = db.query(MetricTarget).filter(MetricTarget.tenant_id == tenant_id).all()
    return {(r.metric, r.dimension, r.dimension_value): r for r in rows}


def _effective_target(mdef, targets: Dict[tuple, MetricTarget],
                      dimension: str = "overall", dimension_value: str = "all"):
    """A tenant override for this exact scope, else the overall override, else the
    catalog default."""
    row = targets.get((mdef.key, dimension, dimension_value)) or targets.get((mdef.key, "overall", "all"))
    if row is not None:
        return row.target, row.warn, row.critical
    return mdef.target, mdef.warn, mdef.critical


def _series_stats(points: List[dict], mdef, target, warn) -> Dict[str, Any]:
    """Current value, period-over-period delta (vs ~30 days earlier, else the
    earliest point) and RAG status for a single series."""
    if not points:
        return {"current": None, "previous": None, "delta_abs": None,
                "delta_pct": None, "status": "none", "as_of": None}
    current = points[-1]["value"]
    as_of = points[-1]["date"]
    previous = None
    try:
        cutoff = date.fromisoformat(as_of[:10]) - timedelta(days=30)
        for p in points[:-1]:
            if date.fromisoformat(p["date"][:10]) <= cutoff:
                previous = p["value"]
    except (ValueError, TypeError):
        previous = None
    if previous is None and len(points) > 1:
        previous = points[0]["value"]
    delta_abs = (current - previous) if (current is not None and previous is not None) else None
    delta_pct = (round(delta_abs / previous * 100, 1)
                 if (delta_abs is not None and previous not in (None, 0)) else None)
    return {
        "current": current,
        "previous": previous,
        "delta_abs": round(delta_abs, 1) if delta_abs is not None else None,
        "delta_pct": delta_pct,
        "status": metric_catalog.rag_status(current, mdef.direction, target, warn),
        "as_of": as_of,
    }


def _metric_meta(mdef, target, warn, critical) -> Dict[str, Any]:
    return {
        "key": mdef.key, "label": mdef.label, "module": mdef.module,
        "module_label": metric_catalog.MODULE_LABELS.get(mdef.module, mdef.module),
        "unit": mdef.unit, "direction": mdef.direction, "dimension": mdef.dimension,
        "definition": mdef.definition, "target": target, "warn": warn, "critical": critical,
    }


@router.get("/trends/catalog")
def trends_catalog(db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Metrics the caller can trend, with metadata + effective targets, grouped by module."""
    tenant_id = _tenant_id(user, db)
    granted = _user_perm_names(user, db)
    targets = _targets_map(db, tenant_id)
    metrics_out = []
    for m in metric_catalog.METRICS:
        if not any(_satisfies(granted, r) for r in m.permissions):
            continue
        t, w, c = _effective_target(m, targets)
        metrics_out.append(_metric_meta(m, t, w, c))
    modules = [{"key": k, "label": metric_catalog.MODULE_LABELS[k]}
               for k in metric_catalog.MODULE_ORDER
               if any(x["module"] == k for x in metrics_out)]
    return {"modules": modules, "metrics": metrics_out}


@router.get("/trends/overview")
def trends_overview(days: int = 180, db: Session = Depends(get_db),
                    user=Depends(require_auth)) -> Dict[str, Any]:
    """One card per accessible overall metric: current value, delta, RAG status,
    target and the full series — enough to render the whole Trends board."""
    days = max(7, min(days, 730))
    tenant_id = _tenant_id(user, db)
    tids = [tenant_id]
    metric_snapshots.ensure_table(db)
    granted = _user_perm_names(user, db)
    targets = _targets_map(db, tenant_id)
    cards = []
    for m in metric_catalog.METRICS:
        if not any(_satisfies(granted, r) for r in m.permissions):
            continue
        points = metric_snapshots.read_trend(db, tids, m.key, days)
        t, w, c = _effective_target(m, targets)
        card = _metric_meta(m, t, w, c)
        card.update(_series_stats(points, m, t, w))
        card["points"] = points
        cards.append(card)
    return {"days": days, "cards": cards}


@router.get("/trends/series")
def trends_series(metric: str, days: int = 180, dimension: str = "overall",
                  dimension_value: str = "all", db: Session = Depends(get_db),
                  user=Depends(require_auth)) -> Dict[str, Any]:
    """One metric's time-series (optionally a single dimension slice) + stats."""
    m = metric_catalog.get(metric)
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown metric '{metric}'.")
    if not _user_can(user, db, m.permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this metric.")
    days = max(7, min(days, 730))
    tenant_id = _tenant_id(user, db)
    metric_snapshots.ensure_table(db)
    points = metric_snapshots.read_trend(db, [tenant_id], metric, days, dimension, dimension_value)
    targets = _targets_map(db, tenant_id)
    t, w, c = _effective_target(m, targets, dimension, dimension_value)
    out = _metric_meta(m, t, w, c)
    out.update(_series_stats(points, m, t, w))
    out["points"] = points
    out["dimension_value"] = dimension_value
    return out


@router.get("/trends/breakdown")
def trends_breakdown(metric: str, days: int = 180, db: Session = Depends(get_db),
                     user=Depends(require_auth)) -> Dict[str, Any]:
    """Every dimension slice of a dimensional metric as parallel series — e.g.
    open vulnerabilities by severity, or completion by framework, over time."""
    m = metric_catalog.get(metric)
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown metric '{metric}'.")
    if not _user_can(user, db, m.permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this metric.")
    if not m.dimension:
        return {"metric": metric, "dimension": None, "label": m.label, "unit": m.unit, "series": []}
    days = max(7, min(days, 730))
    tenant_id = _tenant_id(user, db)
    metric_snapshots.ensure_table(db)
    cutoff = date.today() - timedelta(days=days)
    values = [r[0] for r in (
        db.query(MetricSnapshot.dimension_value)
        .filter(MetricSnapshot.tenant_id == tenant_id, MetricSnapshot.metric == metric,
                MetricSnapshot.dimension == m.dimension, MetricSnapshot.as_of_date >= cutoff)
        .distinct().all()) if r[0] is not None]
    series = [{"key": dv, "points": metric_snapshots.read_trend(db, [tenant_id], metric, days, m.dimension, dv)}
              for dv in sorted(values)]
    return {"metric": metric, "dimension": m.dimension, "label": m.label, "unit": m.unit, "series": series}


class TargetIn(BaseModel):
    metric: str
    dimension: str = "overall"
    dimension_value: str = "all"
    target: Optional[float] = None
    warn: Optional[float] = None
    critical: Optional[float] = None


@router.put("/trends/targets")
def set_target(body: TargetIn, db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Set (or clear) the target/thresholds for one metric scope. Anyone who can
    view the metric can tune its target."""
    m = metric_catalog.get(body.metric)
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown metric '{body.metric}'.")
    if not _user_can(user, db, m.permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot set this metric's target.")
    tenant_id = _tenant_id(user, db)
    _ensure_target_table(db)
    row = (db.query(MetricTarget)
           .filter(MetricTarget.tenant_id == tenant_id, MetricTarget.metric == body.metric,
                   MetricTarget.dimension == body.dimension,
                   MetricTarget.dimension_value == body.dimension_value).first())
    if row is None:
        row = MetricTarget(tenant_id=tenant_id, metric=body.metric,
                           dimension=body.dimension, dimension_value=body.dimension_value)
        db.add(row)
    row.target = body.target
    row.warn = body.warn
    row.critical = body.critical
    row.updated_by = getattr(user, "id", None)
    db.commit()
    return {"ok": True, "metric": body.metric, "target": row.target, "warn": row.warn, "critical": row.critical}


@router.delete("/trends/targets")
def reset_target(metric: str, dimension: str = "overall", dimension_value: str = "all",
                 db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Remove a tenant override so the metric falls back to its catalog default."""
    m = metric_catalog.get(metric)
    if m is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown metric '{metric}'.")
    if not _user_can(user, db, m.permissions):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot reset this metric's target.")
    tenant_id = _tenant_id(user, db)
    _ensure_target_table(db)
    row = (db.query(MetricTarget)
           .filter(MetricTarget.tenant_id == tenant_id, MetricTarget.metric == metric,
                   MetricTarget.dimension == dimension,
                   MetricTarget.dimension_value == dimension_value).first())
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True, "metric": metric, "target": m.target, "warn": m.warn, "critical": m.critical}


@router.post("/trends/snapshot")
def capture_snapshot(db: Session = Depends(get_db), user=Depends(require_auth)) -> Dict[str, Any]:
    """Capture today's cross-module snapshot on demand (idempotent per day) so a
    user doesn't have to wait for the nightly sweep to see a fresh point."""
    tenant_id = _tenant_id(user, db)
    written = metric_snapshots.write_daily(db, tenant_id)
    return {"written": written, "as_of": date.today().isoformat()}


# ─── Metabase Analytics (Reports › Analytics) ───────────────────────────────

class MetabaseSsoBody(BaseModel):
    return_to: str = Field("/", description="Metabase path after SSO, e.g. /collection/root")
    groups: Optional[List[str]] = None


@router.get("/metabase/status")
def metabase_status(
    db: Session = Depends(get_db),
    user=Depends(require_auth),
) -> Dict[str, Any]:
    """Frontend probe: is Metabase configured, embed mode, semantic views present."""
    from ..services import metabase_sso
    from ..services.reporting_semantic_layer import list_reporting_view_catalog

    views_ok: List[str] = []
    try:
        bind = db.get_bind()
        engine = getattr(bind, "engine", bind)
        from sqlalchemy import text as _text
        rows = engine.connect().execute(
            _text(
                "SELECT table_name FROM information_schema.views "
                "WHERE table_schema = 'public' AND table_name LIKE 'reporting_%'"
            )
        ).fetchall()
        views_ok = [r[0] for r in rows]
    except Exception:
        views_ok = []

    return {
        "configured": metabase_sso.metabase_enabled(),
        "site_url": metabase_sso.metabase_site_url() or None,
        "embed_enabled": metabase_sso.metabase_embed_enabled(),
        "jwt_sso": metabase_sso.jwt_sso_configured(),
        "static_embed": metabase_sso.static_embed_configured(),
        "mode": metabase_sso.metabase_mode(),
        "reporting_views": views_ok,
        "view_catalog": list_reporting_view_catalog(),
        "starter_dashboards": metabase_sso.starter_dashboard_catalog(),
        "subscriptions": {
            "owner": "metabase",
            "requires": ["smtp_configured_in_metabase"],
            "hint": (
                "Metabase Admin → Settings → Email (local: Mailhog on :8025 via "
                "deploy/metabase compose). Then dashboard → Sharing → Subscriptions."
            ),
            "mailhog_ui": "http://127.0.0.1:8025",
            "configure_script": "deploy/metabase/configure_smtp.py",
        },
        "licence_note": (
            "JWT SSO requires Metabase Pro (set METABASE_PRO_JWT=1). "
            "OSS uses open_link or static embeds."
        ),
    }


@router.post("/metabase/sso")
def metabase_sso_url(
    request: Request,
    body: MetabaseSsoBody,
    db: Session = Depends(get_db),
    user=Depends(require_auth),
) -> Dict[str, Any]:
    """Return a Metabase entry URL (Pro JWT SSO, or OSS open_link fallback)."""
    from ..services import metabase_sso

    if not metabase_sso.metabase_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Metabase is not configured. Set METABASE_SITE_URL on the backend.",
        )

    # Prefer the active request tenant (subdomain / X-Tenant-Slug); fall back
    # to the singleton Tenant row on this DB. get_user_tenants returns ids only.
    slug = getattr(request.state, "tenant_slug", None)
    if not slug:
        tenant = getattr(request.state, "tenant", None)
        if isinstance(tenant, dict):
            slug = tenant.get("slug")
    if not slug:
        row = db.query(Tenant).first()
        slug = getattr(row, "slug", None) if row else None

    groups = body.groups or ["compliverse_analyst"]
    if slug:
        groups = list({*groups, f"tenant_{slug}"})
    if getattr(user, "is_superuser", False) or getattr(user, "is_platform_admin", False):
        groups = list({*groups, "compliverse_admin"})

    mode = metabase_sso.metabase_mode()
    try:
        if metabase_sso.jwt_sso_configured():
            token = metabase_sso.mint_sso_token(
                email=user.email,
                display_name=getattr(user, "display_name", None) or user.username,
                groups=groups,
                tenant_slug=slug,
            )
            url = metabase_sso.sso_login_url(token, return_to=body.return_to or "/")
            mode = "embed" if metabase_sso.metabase_embed_enabled() else "sso_link"
        else:
            # OSS: deep-link into Metabase (user logs in once in that tab).
            url = metabase_sso.open_site_url(body.return_to or "/")
            mode = "open_link"
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to build Metabase entry URL: {exc}",
        ) from exc

    return {
        "url": url,
        "expires_in": 300 if mode in ("sso_link", "embed") else None,
        "tenant_slug": slug,
        "mode": mode,
    }


@router.get("/metabase/embed/{dashboard_key}")
def metabase_embed_dashboard(
    dashboard_key: str,
    user=Depends(require_auth),
) -> Dict[str, Any]:
    """Mint a short-lived static embed URL for a curated starter dashboard."""
    from ..services import metabase_sso

    if not metabase_sso.static_embed_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Static embedding is not configured. "
                "Set METABASE_SITE_URL, METABASE_EMBEDDING_SECRET_KEY, METABASE_EMBED_ENABLED=1."
            ),
        )

    catalog = {d["key"]: d for d in metabase_sso.starter_dashboard_catalog()}
    entry = catalog.get(dashboard_key)
    if not entry or not entry.get("metabase_dashboard_id"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown or unmapped starter dashboard '{dashboard_key}'.",
        )

    try:
        url = metabase_sso.mint_static_embed_url(
            resource_type="dashboard",
            resource_id=int(entry["metabase_dashboard_id"]),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to mint embed URL: {exc}",
        ) from exc

    return {
        "key": dashboard_key,
        "title": entry.get("title"),
        "url": url,
        "expires_in": 600,
        "metabase_dashboard_id": entry["metabase_dashboard_id"],
    }


@router.post("/metabase/ensure-views", status_code=200)
def metabase_ensure_views(
    db: Session = Depends(get_db),
    user=Depends(require_auth),
) -> Dict[str, Any]:
    """Admin/analyst helper: (re)create reporting_* views on this tenant DB."""
    from ..services.reporting_semantic_layer import ensure_reporting_views

    bind = db.get_bind()
    engine = getattr(bind, "engine", bind)
    applied = ensure_reporting_views(engine)
    return {"ok": True, "applied": applied}
