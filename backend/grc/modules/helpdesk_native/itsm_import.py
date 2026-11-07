"""ITSM bundle importer - idempotent, per-tenant, fail-closed.

`import_bundle(db, tenant_id, bundle, imported_by)` ingests the JSON bundle
produced by `itsm_bundle_export` into the grc_hd_* ITSM foundation tables
(models/_62) and onto the existing HDTicketPriority / HDTicketStatus rows.

Guarantees
* UPSERT by the workbook's own `code` per tenant, in dependency order. A row
  that already matches is SKIPPED untouched, so re-running the same bundle makes
  zero net row changes; a changed row is updated in place.
* source_batch_id = this batch on every row this ingest INSERTS or UPDATES (it
  records the batch that last changed the row; unchanged rows keep the batch
  that wrote them).
* FAIL-CLOSED: every cross-reference is resolved by code. If any is dangling
  (or a required code/name is missing) the whole catalogue write is rolled back
  to a SAVEPOINT, the HDImportBatch is kept as status="failed" with the full
  list in `error`, and ValueError is raised. No partial ingest.
* Pure data layer: nothing here touches HTTP, the frontend, or other tenants.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import (
    HDArticle,
    HDArticleCategory,
    HDBusinessService,
    HDCABConfig,
    HDChangeRiskMatrix,
    HDChangeType,
    HDCIAttribute,
    HDCIRelationship,
    HDCIRelationshipType,
    HDCIType,
    HDConfigurationItem,
    HDDepartment,
    HDImportBatch,
    HDIncidentCategory,
    HDKPI,
    HDPriorityMatrix,
    HDProcessField,
    HDRaci,
    HDRequestItem,
    HDRoleMap,
    HDServiceCategory,
    HDServiceDependency,
    HDSLATarget,
    HDStateTransition,
    HDSupportGroupMap,
    HDTechnicalService,
    HDTicketPriority,
    HDTicketStatus,
    Team,
)
from .itsm_bundle_export import compute_checksum

logger = logging.getLogger(__name__)

# entity key -> accepted aliases in the bundle (workbook Index keys first).
_KEYS = {
    "support_groups": ("support_groups",),
    "roles": ("roles",),
    "categories": ("service_categories",),
    "business_services": ("business_services",),
    "technical_services": ("technical_services",),
    "service_dependencies": ("service_dependencies",),
    "request_items": ("request_offerings", "request_items"),
    "ci_types": ("ci_types",),
    "ci_attributes": ("ci_attributes",),
    "ci_relationship_types": ("ci_relationship_types",),
    "configuration_items": ("sample_cis", "configuration_items"),
    "ci_relationships": ("sample_ci_relationships", "ci_relationships"),
    "priorities": ("priorities",),
    "priority_matrix": ("priority_matrix",),
    "change_types": ("change_types",),
    "change_risk_matrix": ("change_risk_matrix",),
    "incident_categories": ("incident_categories",),
    "sla_targets": ("sla_targets",),
    "incident_fields": ("incident_fields",),
    "problem_fields": ("problem_fields",),
    "change_fields": ("change_fields",),
    "incident_raci": ("incident_raci",),
    "request_raci": ("request_raci",),
    "problem_raci": ("problem_raci",),
    "change_raci": ("change_raci",),
    "change_cab": ("change_cab",),
    "departments": ("departments",),
    "kb_categories": ("kb_categories",),
    "kb_articles": ("kb_articles",),
    "kpis": ("performance_kpis", "kpis"),
}
# process -> entity key of its state sheet
_STATE_KEYS = {
    "incident": ("incident_states",),
    "service_request": ("request_states", "service_request_states"),
    "problem": ("problem_states",),
    "change": ("change_states",),
}

# P-code -> the existing seeded priority (itsm_seed._PRIORITIES) it maps onto.
_LEGACY_PRIORITY = {"P1": ("Urgent", "Urgent"), "P2": ("High", "High"),
                    "P3": ("Medium", "Medium"), "P4": ("Low", "Low")}

_SUMMARY_ENTITIES = (
    "support_groups", "roles", "categories", "business_services",
    "technical_services", "service_dependencies", "request_items", "ci_types",
    "ci_attributes", "ci_relationship_types", "configuration_items",
    "ci_relationships", "priorities", "priority_matrix", "statuses",
    "state_transitions", "change_types", "change_risk_matrix",
    "incident_categories",
    "sla_targets", "process_fields", "raci", "cab", "departments",
    "kb_categories", "kb_articles", "kpis",
)

# process label (any casing) -> the process key used throughout this module.
_PROCESS_MAP = {
    "incident": "incident", "service request": "service_request",
    "service_request": "service_request", "problem": "problem", "change": "change",
}


# --- small parsing helpers -----------------------------------------------------
def _g(row: dict, *names: str) -> Any:
    for n in names:
        v = row.get(n)
        if v is not None and not (isinstance(v, str) and not v.strip()):
            return v.strip() if isinstance(v, str) else v
    return None


def _yes(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    return str(v or "").strip().lower() in ("yes", "y", "true", "1")


def _slug(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = re.sub(r"[^0-9a-z]+", "_", str(v).strip().lower()).strip("_")
    return s or None


def _lower(v: Any) -> Optional[str]:
    return str(v).strip().lower() if v is not None and str(v).strip() else None


def _trunc(v: Any, n: int) -> Optional[str]:
    return None if v is None else str(v)[:n]


def _split_codes(v: Any) -> list[str]:
    """'SVC-0001, SVC-0004' -> ['SVC-0001','SVC-0004'] (comma + optional space)."""
    if v is None:
        return []
    out: list[str] = []
    for tok in str(v).split(","):
        t = tok.strip()
        if t and t not in out:
            out.append(t)
    return out


def _parse_priority(label: Any) -> tuple[Optional[str], Optional[str]]:
    """'P1 <dash> Critical' -> ('P1','Critical'); dash char is irrelevant."""
    m = re.match(r"^\s*(P\d+)\b[\W_]*(.*)$", str(label or ""), flags=re.I | re.S)
    if not m:
        return None, None
    return m.group(1).upper(), (m.group(2).strip() or None)


def _parse_duration_minutes(v: Any) -> Optional[int]:
    """Best-effort SLA-target -> minutes: '15 min'->15, '4 hours'->240,
    '2 business days'->960 (business day = 8h = 480 min), '30 days (RCA)'->43200
    (calendar day = 1440 min). A prose target with no leading number ('Per
    offering SLA', 'Immediate (ECAB)', 'Pre-approved', 'Per plan'/'model'/
    'schedule') has nothing to parse -> None (left for `notes`)."""
    if v is None:
        return None
    m = re.match(r"^\s*(\d+)\s*(business\s*day|day|hour|hr|min)", str(v), flags=re.I)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2).lower()
    if unit.startswith("business"):
        return n * 480
    if unit.startswith("day"):
        return n * 1440
    if unit.startswith("hour") or unit.startswith("hr"):
        return n * 60
    return n  # min


def _compose_kb_content(symptom: Any, cause: Any, resolution: Any, tags: Any) -> Optional[str]:
    """Fold the workbook's symptom/cause/resolution cells (there is no column
    for them on HDArticle) into one body under headings, with tags appended."""
    parts: list[str] = []
    if symptom:
        parts.append(f"## Symptom\n{symptom}")
    if cause:
        parts.append(f"## Cause\n{cause}")
    if resolution:
        parts.append(f"## Resolution\n{resolution}")
    if tags:
        parts.append(f"**Tags:** {tags}")
    return "\n\n".join(parts) or None


# --- import context ------------------------------------------------------------
class _Ctx:
    def __init__(self, db: Session, tid: int, batch: HDImportBatch, entities: dict):
        self.db, self.tid, self.batch, self.entities = db, tid, batch, entities
        self.stats = {k: {"inserted": 0, "updated": 0, "skipped": 0} for k in _SUMMARY_ENTITIES}
        self.unresolved: list[dict] = []
        self.warnings: list[str] = []
        self._maps: dict = {}

    # rows for an entity key (aliases), [] when absent
    def rows(self, entity: str) -> list[dict]:
        for k in _KEYS.get(entity, (entity,)):
            if k in self.entities and self.entities[k]:
                return [r for r in self.entities[k] if isinstance(r, dict)]
        return []

    def code_map(self, model) -> dict:
        """{code: id} for the tenant, lazily loaded from the DB (so references
        to rows from an EARLIER import resolve) and kept current as we upsert."""
        if model not in self._maps:
            self._maps[model] = {c: i for i, c in self.db.query(model.id, model.code)
                                 .filter(model.tenant_id == self.tid).all()}
        return self._maps[model]

    def bad(self, entity: str, row: Any, field: str, ref: Any, problem: str = "unresolved reference") -> None:
        self.unresolved.append({"entity": entity, "row": row, "field": field,
                                "ref": ref, "problem": problem})

    def ref(self, entity: str, row_code: Any, field: str, model, code: Any) -> Optional[int]:
        """Resolve an optional `code` to a local id; record + return None if dangling."""
        if code is None:
            return None
        got = self.code_map(model).get(code)
        if got is None:
            self.bad(entity, row_code, field, code)
        return got

    def upsert(self, entity: str, model, filters: dict, values: dict):
        """Insert, update-in-place, or skip an unchanged row. Stamps
        source_batch_id on insert/update only (skip = true no-op)."""
        st = self.stats[entity]
        row = self.db.query(model).filter_by(**filters).first()
        if row is None:
            row = model(**filters, **values)
            if hasattr(model, "source_batch_id"):
                row.source_batch_id = self.batch.id
            self.db.add(row)
            self.db.flush()
            st["inserted"] += 1
        else:
            changed = False
            for k, v in values.items():
                if getattr(row, k) != v:
                    setattr(row, k, v)
                    changed = True
            if changed:
                if hasattr(model, "source_batch_id"):
                    row.source_batch_id = self.batch.id
                self.db.flush()
                st["updated"] += 1
            else:
                st["skipped"] += 1
        if "code" in filters:
            self.code_map(model)[filters["code"]] = row.id
        return row

    def coded(self, entity: str, model, code: Any, values: dict):
        return self.upsert(entity, model, {"tenant_id": self.tid, "code": code}, values)


# --- per-entity appliers (called in dependency order) ---------------------------
def _find_team(ctx: _Ctx, name: str) -> Optional[int]:
    t = (ctx.db.query(Team.id)
         .filter(Team.tenant_id == ctx.tid, func.lower(Team.name) == name.strip().lower())
         .first())
    return t[0] if t else None


def _apply_support_groups(ctx: _Ctx) -> None:
    # DROPPED-BY-DESIGN: 'Tier' (L1/L2/L3/Process), 'Scope' (prose remit) and
    # 'Coverage' (24x7 / business hours) are descriptive group metadata. This table
    # is purely the GRP-* -> ComplyVerse team bridge (code/name/team_id); the authoritative
    # team record (and its own coverage) lives on grc_teams, so they are not copied.
    for r in ctx.rows("support_groups"):
        code, name = _g(r, "code", "group_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("support_groups", code, "code/name", None, "missing code or name"); continue
        existing = (ctx.db.query(HDSupportGroupMap)
                    .filter_by(tenant_id=ctx.tid, code=code).first())
        team_id = _find_team(ctx, name)
        if team_id is None:
            if existing is None or existing.team_id is None:
                ctx.warnings.append(f"support group {code} '{name}' matched no ComplyVerse team (team_id left null)")
            team_id = existing.team_id if existing else None  # never clobber an admin-set mapping with null
        ctx.coded("support_groups", HDSupportGroupMap, code, {"name": _trunc(name, 200), "team_id": team_id})


def _apply_roles(ctx: _Ctx) -> None:
    for r in ctx.rows("roles"):
        code, name = _g(r, "code", "role_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("roles", code, "code/name", None, "missing code or name"); continue
        # rbac_preset is admin-owned (not in the workbook) -> deliberately not touched.
        ctx.coded("roles", HDRoleMap, code, {"name": _trunc(name, 200), "description": _g(r, "description")})


def _apply_categories(ctx: _Ctx) -> None:
    rows = ctx.rows("categories")
    for i, r in enumerate(rows):
        code, name = _g(r, "code", "category_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("categories", code, "code/name", None, "missing code or name"); continue
        ctx.coded("categories", HDServiceCategory, code,
                  {"name": _trunc(name, 200), "description": _g(r, "description"), "sort_order": i})
    # parents second pass (a child may precede its parent in the sheet)
    for r in rows:
        code, parent = _g(r, "code", "category_id"), _g(r, "parent_id", "parent_category_id")
        if code and parent:
            pid = ctx.ref("categories", code, "parent_id", HDServiceCategory, parent)
            row = ctx.db.query(HDServiceCategory).filter_by(tenant_id=ctx.tid, code=code).first()
            if row is not None and pid is not None and row.parent_id != pid:
                row.parent_id = pid


def _apply_business_services(ctx: _Ctx) -> None:
    for r in ctx.rows("business_services"):
        code, name = _g(r, "code", "service_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("business_services", code, "code/name", None, "missing code or name"); continue
        cat = ctx.ref("business_services", code, "category_id", HDServiceCategory, _g(r, "category_id"))
        # support_group_id has no column on the business service; still validated so a typo can't slide through.
        ctx.ref("business_services", code, "support_group_id", HDSupportGroupMap, _g(r, "support_group_id"))
        # DROPPED-BY-DESIGN: 'Sla Tier' (Tier 1..4 label) and 'Industry Specific'
        # (Yes/No flag) are descriptive catalogue metadata with no column here —
        # criticality + industry_tag already carry the routing-relevant signal, and
        # SLA targets live in sheet 08 keyed by priority, not a per-service tier.
        status = _lower(_g(r, "status"))
        ctx.coded("business_services", HDBusinessService, code, {
            "name": _trunc(name, 200), "category_id": cat, "description": _g(r, "description"),
            "criticality": _trunc(_g(r, "criticality"), 20),
            "service_owner_role": _trunc(_g(r, "service_owner", "service_owner_role"), 60),
            "industry_tag": _trunc(_g(r, "industry", "industry_tag"), 60),
            "status": _trunc(status, 20) or "active",
            "enabled": (status == "active") if status else True,
        })


def _apply_technical_services(ctx: _Ctx) -> None:
    pairs: list[tuple[str, str, Any]] = []   # (bs_code, ts_code, criticality)
    for r in ctx.rows("technical_services"):
        code, name = _g(r, "code", "service_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("technical_services", code, "code/name", None, "missing code or name"); continue
        grp = _g(r, "support_group_id", "owner_group_id")
        grp_id = ctx.ref("technical_services", code, "support_group_id", HDSupportGroupMap, grp)
        team_id = None
        if grp_id is not None:
            team_id = ctx.db.query(HDSupportGroupMap.team_id).filter_by(id=grp_id).scalar()
        status = _lower(_g(r, "status"))
        row = ctx.coded("technical_services", HDTechnicalService, code, {
            "name": _trunc(name, 200), "description": _g(r, "description"),
            "owner_team_id": team_id,
            "status": _trunc(status, 20) or "active",
            "enabled": (status == "active") if status else True,
        })
        # M:N: 'Supports Business Service Id' is a ', '-separated list of SVC-00xx codes.
        for bs in _split_codes(_g(r, "supports_business_service_id")):
            pairs.append((bs, code, None))
    for r in ctx.rows("service_dependencies"):   # optional explicit bridge entity
        bs = _g(r, "business_service_id", "business_service")
        ts = _g(r, "technical_service_id", "technical_service")
        if bs and ts:
            pairs.append((bs, ts, _g(r, "criticality")))
    seen = set()
    for bs, ts, crit in pairs:
        if (bs, ts) in seen:
            continue
        seen.add((bs, ts))
        bs_id = ctx.ref("service_dependencies", ts, "supports_business_service_id", HDBusinessService, bs)
        ts_id = ctx.ref("service_dependencies", ts, "technical_service_id", HDTechnicalService, ts)
        if bs_id is None or ts_id is None:
            continue
        ctx.upsert("service_dependencies", HDServiceDependency,
                   {"business_service_id": bs_id, "technical_service_id": ts_id},
                   {"criticality": _trunc(crit, 20)})


def _apply_request_items(ctx: _Ctx) -> None:
    for r in ctx.rows("request_items"):
        code, name = _g(r, "code", "request_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("request_items", code, "code/name", None, "missing code or name"); continue
        bs_id = ctx.ref("request_items", code, "service_id", HDBusinessService,
                        _g(r, "business_service_id", "service_id"))
        cat_id = None
        if bs_id is not None:
            cat_id = ctx.db.query(HDBusinessService.category_id).filter_by(id=bs_id).scalar()
        grp_id = ctx.ref("request_items", code, "fulfilment_group_id", HDSupportGroupMap,
                         _g(r, "fulfilment_group_id", "fulfilment_team"))
        team_id = None
        if grp_id is not None:
            team_id = ctx.db.query(HDSupportGroupMap.team_id).filter_by(id=grp_id).scalar()
        sla = _g(r, "fulfilment_sla_hours", "sla_hours")
        # DROPPED-BY-DESIGN: 'Industry' (All/Banking/Aviation/…) has no column on the
        # request item; the parent business service already carries industry_tag.
        status = _lower(_g(r, "status"))
        ctx.coded("request_items", HDRequestItem, code, {
            "name": _trunc(name, 200), "business_service_id": bs_id, "category_id": cat_id,
            "description": _g(r, "description"),
            "approval_required": _yes(_g(r, "approval_required")),
            "approver_role": _trunc(_g(r, "approver_role"), 60),
            "fulfilment_team_id": team_id,
            "sla_hours": float(sla) if isinstance(sla, (int, float)) else None,
            # 'Cost Model' in the workbook is a label (None/Chargeable/Varies), not an amount -> cost left null.
            "enabled": (status == "active") if status else True,
        })


# Sample CIs + their CI->CI relationships (workbook sheets 'sample_cis' /
# 'sample_ci_relationships') are ILLUSTRATIVE ONLY. Real configuration items come
# from ComplyVerse asset discovery, not the workbook, so they are not seeded by default.
# The CI *types*, *attributes* and *relationship types* are the standard CMDB
# scaffolding and are always seeded. Flip to True only to load the demo CIs.
SEED_SAMPLE_CIS = False


def _apply_cmdb(ctx: _Ctx) -> None:
    # --- CI types (two-pass: parents may be declared after children)
    # DROPPED-BY-DESIGN: the sheet's flat 'Category' label (Service/Hardware/
    # Software/Cloud/Network/Facility) is not stored — CI types are organised by
    # their own parent_cit_id tree, which subsumes that grouping.
    trows = ctx.rows("ci_types")
    for r in trows:
        code, name = _g(r, "code", "cit_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("ci_types", code, "code/name", None, "missing code or name"); continue
        ctx.coded("ci_types", HDCIType, code, {"name": _trunc(name, 200), "description": _g(r, "description")})
    for r in trows:
        code, parent = _g(r, "code", "cit_id"), _g(r, "parent_cit_id", "parent_id")
        if code and parent:
            pid = ctx.ref("ci_types", code, "parent_cit_id", HDCIType, parent)
            row = ctx.db.query(HDCIType).filter_by(tenant_id=ctx.tid, code=code).first()
            if row is not None and pid is not None and row.parent_id != pid:
                row.parent_id = pid
    # --- CI attributes (child of type; keyed by (type, attribute name))
    idx_by_type: dict = {}
    for r in ctx.rows("ci_attributes"):
        cit, name = _g(r, "cit_id", "ci_type"), _g(r, "attribute", "name")
        type_id = ctx.ref("ci_attributes", f"{cit}/{name}", "cit_id", HDCIType, cit)
        if type_id is None or not name:
            if not name:
                ctx.bad("ci_attributes", cit, "attribute", None, "missing attribute name")
            continue
        idx_by_type[type_id] = idx_by_type.get(type_id, 0) + 1
        dtype = _lower(_g(r, "datatype")) or "string"
        desc = _g(r, "description")
        # The 'Description' cell is consumed into enum `options` (slash-delimited
        # choices). PARTIAL-BY-DESIGN: for non-enum attributes the free-text hint
        # (e.g. "Owning team", "Physical/logical location") has no column on
        # HDCIAttribute and is not retained — the attribute name + datatype are the
        # dictionary key. (If product later needs the hint, add a `description`
        # column here; see the audit note in docs/ITSM_INGEST_AUDIT.md.)
        options = [o.strip() for o in str(desc).split("/") if o.strip()] if (dtype == "enum" and desc and "/" in str(desc)) else None
        ctx.upsert("ci_attributes", HDCIAttribute, {"ci_type_id": type_id, "name": _trunc(name, 140)},
                   {"idx": idx_by_type[type_id], "datatype": _trunc(dtype, 20),
                    "required": _yes(_g(r, "required")), "options": options})
    # --- relationship types
    # DROPPED-BY-DESIGN: the sheet's 'Description' (e.g. "Source needs target to
    # function") has no column; forward name + inverse_name define the edge type.
    for r in ctx.rows("ci_relationship_types"):
        code, name = _g(r, "code", "rel_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("ci_relationship_types", code, "code/name", None, "missing code or name"); continue
        ctx.coded("ci_relationship_types", HDCIRelationshipType, code,
                  {"name": _trunc(name, 140), "inverse_name": _trunc(_g(r, "inverse_name"), 140)})
    # Sample CI instances + their relationships are illustrative only — skip them
    # unless explicitly enabled; real CIs are populated from ComplyVerse asset discovery.
    if not SEED_SAMPLE_CIS:
        return
    # --- CIs. A relationship whose TARGET is a business service (REL-REALISES,
    # 'CI realises a service') cannot be a CI->CI edge, so it is carried as the
    # CI's business_service_id.
    rel_rows = ctx.rows("ci_relationships")
    ci_codes = {_g(r, "code", "ci_id") for r in ctx.rows("configuration_items")} | set(ctx.code_map(HDConfigurationItem))
    realises: dict = {}
    for r in rel_rows:
        src, tgt = _g(r, "source_ci_id", "source_ci"), _g(r, "target_id", "target_ci_id", "target_ci")
        if src and tgt and tgt not in ci_codes and tgt in ctx.code_map(HDBusinessService):
            realises.setdefault(src, tgt)
    for r in ctx.rows("configuration_items"):
        code, name = _g(r, "code", "ci_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("configuration_items", code, "code/name", None, "missing code or name"); continue
        type_id = ctx.ref("configuration_items", code, "cit_id", HDCIType, _g(r, "cit_id", "ci_type"))
        owner_grp = _g(r, "owner_group_id", "owner")
        if owner_grp and str(owner_grp).startswith("GRP-"):
            ctx.ref("configuration_items", code, "owner_group_id", HDSupportGroupMap, owner_grp)
        bs_code = realises.get(code)
        bs_id = ctx.code_map(HDBusinessService).get(bs_code) if bs_code else None
        location = _g(r, "location")
        ctx.coded("configuration_items", HDConfigurationItem, code, {
            "name": _trunc(name, 200), "ci_type_id": type_id, "business_service_id": bs_id,
            "status": _trunc(_slug(_g(r, "ci_status", "status")), 20),
            "criticality": _trunc(_g(r, "criticality"), 20),
            "environment": _trunc(_lower(_g(r, "environment")), 20),
            "owner": _trunc(owner_grp, 255),
            "attributes": {"location": location} if location else None,
        })
    # --- CI relationships (typed M:N edges between CIs)
    ci_map, rt_map = ctx.code_map(HDConfigurationItem), ctx.code_map(HDCIRelationshipType)
    for r in rel_rows:
        src, tgt, rel = (_g(r, "source_ci_id", "source_ci"), _g(r, "target_id", "target_ci_id", "target_ci"),
                         _g(r, "rel_id", "rel_type"))
        label = f"{src}-{rel}->{tgt}"
        rt_id = ctx.ref("ci_relationships", label, "rel_id", HDCIRelationshipType, rel)
        s_id = ctx.ref("ci_relationships", label, "source_ci_id", HDConfigurationItem, src)
        if src is None or tgt is None or rel is None:
            ctx.bad("ci_relationships", label, "source/target/rel", None, "missing source, target or relationship type")
            continue
        if tgt in ci_map:
            t_id = ci_map[tgt]
        elif tgt in ctx.code_map(HDBusinessService):
            continue   # carried as CI.business_service_id above
        else:
            ctx.bad("ci_relationships", label, "target_id", tgt)
            continue
        if s_id is None or rt_id is None:
            continue
        ctx.upsert("ci_relationships", HDCIRelationship,
                   {"source_ci_id": s_id, "target_ci_id": t_id, "rel_type_id": rt_id}, {})


def _ensure_priority(ctx: _Ctx, code: str, label: Optional[str]) -> int:
    """Match-or-create the HDTicketPriority for a P-code, stamping code/rank."""
    st = ctx.stats["priorities"]
    q = ctx.db.query(HDTicketPriority).filter(HDTicketPriority.tenant_id == ctx.tid)
    rank = int(code[1:])
    row = q.filter(HDTicketPriority.code == code).first()
    legacy_name, legacy_level = _LEGACY_PRIORITY.get(code, (None, None))
    if row is None and legacy_name:
        row = q.filter(func.lower(HDTicketPriority.name) == legacy_name.lower(),
                       HDTicketPriority.code.is_(None)).first()
    if row is None and label:
        row = q.filter(func.lower(HDTicketPriority.name) == label.lower(),
                       HDTicketPriority.code.is_(None)).first()
    if row is None:
        row = HDTicketPriority(tenant_id=ctx.tid, name=legacy_name or label or code,
                               level=legacy_level or "Low", code=code, rank=rank)
        ctx.db.add(row)
        ctx.db.flush()
        st["inserted"] += 1
    elif row.code != code or row.rank != rank:
        row.code, row.rank = code, rank
        ctx.db.flush()
        st["updated"] += 1
    else:
        st["skipped"] += 1
    return row.id


def _apply_priorities(ctx: _Ctx) -> None:
    labels: dict = {}   # code -> label (first wins, deterministic by row order)
    for r in ctx.rows("priorities"):
        c, l = _parse_priority(_g(r, "code", "priority") or "")
        if c:
            labels.setdefault(c, _g(r, "name") or l)
    mrows = ctx.rows("priority_matrix")
    for r in mrows:
        c, l = _parse_priority(_g(r, "priority"))
        if c:
            labels.setdefault(c, l)
    ids = {c: _ensure_priority(ctx, c, labels[c]) for c in sorted(labels, key=lambda x: int(x[1:]))}
    for r in mrows:
        impact, urgency = _lower(_g(r, "impact")), _lower(_g(r, "urgency"))
        c, _l = _parse_priority(_g(r, "priority"))
        label = f"{impact}/{urgency}"
        if not impact or not urgency:
            ctx.bad("priority_matrix", label, "impact/urgency", None, "missing impact or urgency"); continue
        if c is None or c not in ids:
            ctx.bad("priority_matrix", label, "priority", _g(r, "priority"), "unparseable priority"); continue
        ctx.upsert("priority_matrix", HDPriorityMatrix,
                   {"tenant_id": ctx.tid, "impact": impact, "urgency": urgency}, {"priority_id": ids[c]})


def _state_category(label: str, terminal: bool) -> str:
    l = label.lower()
    if terminal or l in ("resolved", "fulfilled"):
        return "Resolved"
    if l.startswith(("on hold", "pending", "awaiting")):
        return "Paused"
    return "Open"


def _apply_states(ctx: _Ctx) -> None:
    per_process: dict = {}   # process -> [(label, allowed_next)]
    info: dict = {}          # lower(label) -> aggregate across processes
    for process, keys in _STATE_KEYS.items():
        rows: list = []
        for k in keys:
            if ctx.entities.get(k):
                rows = [r for r in ctx.entities[k] if isinstance(r, dict)]
                break
        out = []
        for i, r in enumerate(rows):
            label = _g(r, "state", "status")
            if not label:
                continue
            # DROPPED-BY-DESIGN: the state-sheet 'Description' (e.g. "Logged, not yet
            # assigned") is not persisted — HDTicketStatus has no workbook-fed
            # description column; the label + category + initial/terminal flags are
            # what the lifecycle engine consumes.
            nxt = _g(r, "allowed_next") or ""
            terminal = (not nxt) or nxt.strip().lower() in ("(terminal)", "terminal", "-", "none")
            out.append((label, "" if terminal else nxt))
            a = info.setdefault(label.lower(), {"label": label, "procs": [], "initial": False,
                                                "terminal": False, "sort": i})
            if process not in a["procs"]:
                a["procs"].append(process)
            a["initial"] = a["initial"] or (len(out) == 1)
            a["terminal"] = a["terminal"] or terminal
            a["sort"] = min(a["sort"], i)
        per_process[process] = out
    ids: dict = {}
    st = ctx.stats["statuses"]
    for key, a in info.items():
        row = (ctx.db.query(HDTicketStatus)
               .filter(HDTicketStatus.tenant_id == ctx.tid,
                       func.lower(HDTicketStatus.label_agent) == key).first())
        process = a["procs"][0] if len(a["procs"]) == 1 else "shared"
        vals = {"process": process, "is_initial": a["initial"], "is_terminal": a["terminal"],
                "sort_order": a["sort"]}
        if row is None:
            row = HDTicketStatus(tenant_id=ctx.tid, label_agent=a["label"],
                                 category=_state_category(a["label"], a["terminal"]),
                                 order=a["sort"], enabled=True, **vals)
            ctx.db.add(row)
            ctx.db.flush()
            st["inserted"] += 1
        else:
            changed = False
            for k, v in vals.items():
                if getattr(row, k) != v:
                    setattr(row, k, v)
                    changed = True
            if changed:
                ctx.db.flush()
                st["updated"] += 1
            else:
                st["skipped"] += 1
        ids[key] = row.id
    # --- transitions: 'Allowed Next' rules as data
    for process, states in per_process.items():
        known = {lbl.lower() for lbl, _n in states}
        for label, nxt in states:
            for tok in _split_codes(nxt):
                m = re.match(r"^(.*?)\s*\((.*)\)\s*$", tok)
                to_label, guard = (m.group(1).strip(), _slug(m.group(2))) if m else (tok, None)
                tag = f"{process}:{label}->{to_label}"
                if to_label.lower() not in known:
                    ctx.bad("state_transitions", tag, "allowed_next", to_label)
                    continue
                ctx.upsert("state_transitions", HDStateTransition,
                           {"tenant_id": ctx.tid, "process": process,
                            "from_status_id": ids[label.lower()], "to_status_id": ids[to_label.lower()]},
                           {"guard": _trunc(guard, 40)})


def _apply_incident_categories(ctx: _Ctx) -> None:
    """Sheet 16 — build the category -> subcategory -> example-item tree. No code
    column, so each node's natural key is its normalized slash-path; upsert on it
    makes a re-seed a no-op. sort_order is first-seen order (stable across runs)."""
    sort_by_key: dict = {}

    def node(key: str, name: str, level: str, parent_id: Optional[int]) -> int:
        key = _trunc(key, 255)
        if key not in sort_by_key:
            sort_by_key[key] = len(sort_by_key)
        row = ctx.upsert("incident_categories", HDIncidentCategory,
                         {"tenant_id": ctx.tid, "key": key},
                         {"name": _trunc(name, 200), "level": level,
                          "parent_id": parent_id, "sort_order": sort_by_key[key]})
        return row.id

    for r in ctx.rows("incident_categories"):
        cat = _g(r, "category")
        if not cat:
            ctx.bad("incident_categories", None, "category", None, "missing category"); continue
        sub = _g(r, "subcategory")
        item = _g(r, "example_item", "item", "example")
        ckey = _slug(cat)
        pid = node(ckey, cat, "category", None)
        base = ckey
        if sub:
            base = f"{ckey}/{_slug(sub)}"
            pid = node(base, sub, "subcategory", pid)
        if item:
            node(f"{base}/{_slug(item)}", item, "item", pid)


def _apply_sla_targets(ctx: _Ctx) -> None:
    """Sheet 08 — SLA / OLA Targets. priority_label is kept verbatim (not every
    row is a P-code: change/service_request rows use type labels like
    'Standard'/'Emergency'); priority_code/*_minutes are the best-effort parse."""
    for i, r in enumerate(ctx.rows("sla_targets")):
        process = _PROCESS_MAP.get(_lower(_g(r, "process")) or "")
        label = _g(r, "priority_or_type")
        if not process or not label:
            ctx.bad("sla_targets", label, "process/priority_or_type", None,
                    "missing process or priority_or_type"); continue
        code, _l = _parse_priority(label)
        ctx.upsert("sla_targets", HDSLATarget,
                   {"tenant_id": ctx.tid, "process": process, "priority_label": _trunc(label, 60),
                    "service_window": _trunc(_lower(_g(r, "service_window")), 20)},
                   {"priority_code": code,
                    "response_minutes": _parse_duration_minutes(_g(r, "response_target")),
                    "resolution_minutes": _parse_duration_minutes(_g(r, "resolution_target")),
                    "notes": _g(r, "notes"), "sort_order": i})


# sheet -> the process its fields/RACI rows belong to.
_FIELD_SHEETS = (("incident_fields", "incident"), ("problem_fields", "problem"), ("change_fields", "change"))
_RACI_SHEETS = (("incident_raci", "incident"), ("request_raci", "service_request"),
                ("problem_raci", "problem"), ("change_raci", "change"))


def _apply_fields(ctx: _Ctx) -> None:
    """Sheets 15/21/25 — Incident/Problem/Change Fields (data dictionary). There
    is no service_request fields sheet in the workbook."""
    for sheet, process in _FIELD_SHEETS:
        for i, r in enumerate(ctx.rows(sheet)):
            name = _g(r, "field")
            if not name:
                ctx.bad("process_fields", process, "field", None, "missing field name"); continue
            ctx.upsert("process_fields", HDProcessField,
                       {"tenant_id": ctx.tid, "process": process, "name": _trunc(name, 200)},
                       {"field_type": _trunc(_g(r, "type"), 60), "required": _yes(_g(r, "required")),
                        "description": _g(r, "description"), "sort_order": i})


def _apply_raci(ctx: _Ctx) -> None:
    """Sheets 17/19/22/28 — per-process RACI. Role values (ROLE-* codes, some-
    times comma-lists) are stored as plain text, never validated against
    HDRoleMap — RACI is advisory/reportable, not a hard FK gate."""
    for sheet, default_process in _RACI_SHEETS:
        for i, r in enumerate(ctx.rows(sheet)):
            process = _PROCESS_MAP.get(_lower(_g(r, "process")) or "", default_process)
            activity = _g(r, "activity")
            if not activity:
                ctx.bad("raci", process, "activity", None, "missing activity"); continue
            ctx.upsert("raci", HDRaci,
                       {"tenant_id": ctx.tid, "process": process, "activity": _trunc(activity, 200)},
                       {"responsible": _trunc(_g(r, "responsible"), 160),
                        "accountable": _trunc(_g(r, "accountable"), 160),
                        "consulted": _trunc(_g(r, "consulted"), 255),
                        "informed": _trunc(_g(r, "informed"), 255),
                        "sort_order": i})


def _apply_cab(ctx: _Ctx) -> None:
    """Sheet 27 — Change Advisory Board Model. Free-text item/detail pairs
    (cadence, chair, standing members, quorum, ...), not a fixed schema."""
    for i, r in enumerate(ctx.rows("change_cab")):
        item = _g(r, "item")
        if not item:
            ctx.bad("cab", None, "item", None, "missing item"); continue
        ctx.upsert("cab", HDCABConfig, {"tenant_id": ctx.tid, "item": _trunc(item, 140)},
                   {"detail": _g(r, "detail"), "sort_order": i})


def _apply_departments(ctx: _Ctx) -> None:
    """Sheet 31 — Departments (Sample). Upserts onto the existing, converted-
    Frappe HDDepartment table by its new `code` column. default_support_group_id
    resolves to an ComplyVerse team the same soft way _apply_support_groups/
    _apply_technical_services do: the GRP-* reference itself is fail-closed
    (a typo'd code is a real bug), but the GRP's OWN team match can be null, and
    a null never clobbers a team an admin already set on the department.
    parent_department_id has no column on HDDepartment -> ignored (no sub-tree
    to maintain yet). DROPPED-BY-DESIGN: the long 'Department Id' (DEPT-IT) is not
    persisted — the short 'Code' cell (IT) IS the stored natural key; 'Self Service
    Created' and 'Seeded' are workbook-authoring provenance flags, not product
    data, so they are not copied either."""
    for r in ctx.rows("departments"):
        code, name = _g(r, "code"), _g(r, "name")
        if not code or not name:
            ctx.bad("departments", code, "code/name", None, "missing code or name"); continue
        existing = ctx.db.query(HDDepartment).filter_by(tenant_id=ctx.tid, code=code).first()
        grp = _g(r, "default_support_group_id")
        grp_id = ctx.ref("departments", code, "default_support_group_id", HDSupportGroupMap, grp) if grp else None
        team_id = ctx.db.query(HDSupportGroupMap.team_id).filter_by(id=grp_id).scalar() if grp_id is not None else None
        if team_id is None:
            team_id = existing.default_team_id if existing else None  # never clobber an admin-set team with null
        status = _lower(_g(r, "status"))
        ctx.upsert("departments", HDDepartment,
                   {"tenant_id": ctx.tid, "code": _trunc(code, 40)},
                   {"name": _trunc(name, 140), "default_team_id": team_id,
                    "enabled": (status == "active") if status else True})


def _apply_kb(ctx: _Ctx) -> None:
    """Sheets 32/33 — KB Categories / Articles. Category links onto the
    existing, converted-Frappe HDArticleCategory/HDArticle tables by their new
    `code` columns. related_service_id is validation-only in the spec but has
    no column to hold it, so (to avoid breaking a KB article on a stale SVC
    reference) it is ignored outright; audience/level fold away, tags fold into
    the composed content."""
    for r in ctx.rows("kb_categories"):
        code, name = _g(r, "kb_category_id"), _g(r, "name")
        if not code or not name:
            ctx.bad("kb_categories", code, "kb_category_id/name", None, "missing kb_category_id or name"); continue
        ctx.upsert("kb_categories", HDArticleCategory,
                   {"tenant_id": ctx.tid, "code": _trunc(code, 40)},
                   {"category_name": _trunc(name, 255)})
    for r in ctx.rows("kb_articles"):
        code, title = _g(r, "kb_id"), _g(r, "title")
        if not code or not title:
            ctx.bad("kb_articles", code, "kb_id/title", None, "missing kb_id or title"); continue
        cat_code = _g(r, "kb_category_id")
        cat_id = ctx.ref("kb_articles", code, "kb_category_id", HDArticleCategory, cat_code) if cat_code else None
        status = "Published" if _lower(_g(r, "status")) == "published" else "Draft"
        content = _compose_kb_content(_g(r, "symptom"), _g(r, "cause"), _g(r, "resolution"), _g(r, "tags"))
        ctx.upsert("kb_articles", HDArticle,
                   {"tenant_id": ctx.tid, "code": _trunc(code, 40)},
                   {"title": _trunc(title, 255), "category_id": cat_id, "status": status, "content": content})


def _apply_change(ctx: _Ctx) -> None:
    for r in ctx.rows("change_types"):
        name = _g(r, "change_type", "name")
        code = _slug(_g(r, "code") or name)
        if not code or not name:
            ctx.bad("change_types", code, "code/name", None, "missing code or name"); continue
        auth = str(_g(r, "authorisation", "authorization") or "").lower()
        desc = _g(r, "description")
        # DROPPED-BY-DESIGN: 'Typical Risk' (Low / Low-Medium-High / High) is an
        # advisory hint with no column; actual per-change risk is computed from the
        # impact x likelihood change-risk matrix (sheet 26), not this label.
        requires_cab = not auth.startswith("no cab")
        auto = ("pre-authoris" in auth or "pre-authoriz" in auth or "pre-approv" in auth
                or "pre-approv" in str(desc or "").lower())
        ctx.coded("change_types", HDChangeType, code, {
            "name": _trunc(name, 140), "requires_cab": requires_cab,
            "auto_approve": bool(auto and not requires_cab), "description": desc})
    for r in ctx.rows("change_risk_matrix"):
        impact, like = _lower(_g(r, "impact")), _lower(_g(r, "likelihood"))
        level = _slug(_g(r, "risk_level"))
        if not impact or not like or not level:
            ctx.bad("change_risk_matrix", f"{like}/{impact}", "impact/likelihood/risk_level", None,
                    "missing impact, likelihood or risk level"); continue
        ctx.upsert("change_risk_matrix", HDChangeRiskMatrix,
                   {"tenant_id": ctx.tid, "impact": impact, "likelihood": like},
                   {"risk_level": _trunc(level, 20), "cab_required": level not in ("low", "very_low")})


# order matters: each step's references must already be upserted
def _apply_kpis(ctx: _Ctx) -> None:
    """Sheet 29 — Performance & Availability KPIs. Definition rows per process,
    upserted by (tenant, process, kpi). The live numbers are computed from tickets
    in the Insights layer; this just stores the authored definitions + targets."""
    for i, r in enumerate(ctx.rows("kpis")):
        process = _lower(_g(r, "process")) or "general"
        kpi = _g(r, "kpi", "name")
        if not kpi:
            ctx.bad("kpis", process, "kpi", None, "missing kpi name"); continue
        ctx.upsert("kpis", HDKPI,
                   {"tenant_id": ctx.tid, "process": _trunc(process, 40), "kpi": _trunc(kpi, 200)},
                   {"definition": _g(r, "definition"), "target": _trunc(_g(r, "target"), 120),
                    "frequency": _trunc(_g(r, "frequency"), 60), "sort_order": i})


_STEPS = (
    _apply_support_groups, _apply_roles,
    _apply_categories, _apply_business_services, _apply_technical_services, _apply_request_items,
    _apply_cmdb,
    _apply_priorities, _apply_states,
    _apply_change,
    _apply_incident_categories,
    _apply_sla_targets, _apply_fields, _apply_raci, _apply_cab,
    _apply_departments, _apply_kb, _apply_kpis,
)


# --- public entry point ----------------------------------------------------------
def import_bundle(db: Session, tenant_id: int, bundle: dict, imported_by: Optional[str] = None) -> HDImportBatch:
    """Ingest `bundle` for `tenant_id`. Returns the applied HDImportBatch.

    Raises ValueError (after persisting a status="failed" batch and rolling the
    catalogue writes back) on a malformed bundle, a checksum mismatch, or any
    dangling cross-reference."""
    if not isinstance(bundle, dict) or not isinstance(bundle.get("entities"), dict):
        raise ValueError("ITSM bundle must be an object with an 'entities' map")
    entities = bundle["entities"]
    computed = compute_checksum(entities)
    batch = HDImportBatch(
        tenant_id=tenant_id,
        bundle_version=_trunc(bundle.get("bundle_version") or "unversioned", 60),
        source_filename=_trunc(bundle.get("source_filename"), 255),
        checksum=bundle.get("checksum") or computed,
        status="pending", imported_by=_trunc(imported_by, 255),
    )
    db.add(batch)
    db.flush()                       # need batch.id for source_batch_id

    def _fail(error_obj: Any, message: str) -> None:
        batch.status = "failed"
        batch.error = json.dumps(error_obj, default=str)
        batch.imported_at = datetime.utcnow()
        db.commit()
        raise ValueError(message)

    if bundle.get("checksum") and bundle["checksum"] != computed:
        _fail([{"problem": "checksum mismatch", "expected": bundle["checksum"], "actual": computed}],
              f"ITSM bundle checksum mismatch (batch {batch.id} marked failed); nothing imported")

    ctx = _Ctx(db, tenant_id, batch, entities)
    batch_id = batch.id
    sp = db.begin_nested()           # SAVEPOINT: every catalogue write below is undoable
    try:
        for step in _STEPS:
            step(ctx)
    except Exception as exc:         # unexpected: roll the catalogue back, keep the failed batch
        sp.rollback()
        logger.exception("itsm_import: batch %s aborted", batch_id)
        batch = db.get(HDImportBatch, batch_id)
        batch.status, batch.error = "failed", json.dumps([{"problem": "exception", "detail": repr(exc)}])
        batch.imported_at = datetime.utcnow()
        db.commit()
        raise

    if ctx.unresolved:
        unresolved = ctx.unresolved
        sp.rollback()                # no partial ingest
        batch = db.get(HDImportBatch, batch_id)
        batch.status, batch.error = "failed", json.dumps(unresolved, default=str)
        batch.imported_at = datetime.utcnow()
        db.commit()
        sample = "; ".join(f"{u['entity']} {u['row']}.{u['field']} -> {u['ref']!r}"
                           for u in unresolved[:5])
        raise ValueError(f"ITSM bundle has {len(unresolved)} dangling/invalid reference(s); "
                         f"batch {batch_id} marked failed and rolled back. First: {sample}")

    sp.commit()
    summary: dict = {k: v for k, v in ctx.stats.items() if any(v.values())}
    if ctx.warnings:
        summary["_warnings"] = ctx.warnings
    batch.status, batch.summary, batch.imported_at = "applied", summary, datetime.utcnow()
    db.commit()
    return batch
