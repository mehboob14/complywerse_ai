import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import Optional

from ....models import get_db, Framework, VulnerabilitySLAConfig, GRCUser, TenantUser, Role
from ....routers.auth_router import require_tenant_permission, require_auth, get_user_primary_tenant, get_user_tenants

logger = logging.getLogger(__name__)

from ..services.catalog import (
    ACTION_NODE_TYPES,
    APPROVAL_NODE_TYPES,
    CONDITION_NODE_TYPES,
    get_platform_functions_grouped_by_module,
    INTEGRATION_POINTS,
    PREBUILT_TEMPLATES,
    TIMER_NODE_TYPES,
    TRIGGER_NODE_TYPES,
)

router = APIRouter(prefix="/catalog", tags=["Workflow Engine Catalog"])


@router.get("/node-types")
def list_node_types(
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    platform_functions = get_platform_functions_grouped_by_module()
    return {
        "triggers": TRIGGER_NODE_TYPES,
        "actions": ACTION_NODE_TYPES,
        "platform_functions": platform_functions,
        "conditions": CONDITION_NODE_TYPES,
        "approvals": APPROVAL_NODE_TYPES,
        "timers": TIMER_NODE_TYPES,
    }


@router.get("/node-param-schemas")
def get_node_param_schemas_endpoint(
    request: Request,
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    """Per-node input-field schemas (path / query / body params, with enum
    choices and entity references) so the builder config panel renders fields
    specific to the selected platform-function node instead of a generic
    action picker. Returns ``{schemas: {node_key: [field, ...]}}``."""
    from ..services.param_schema import build_node_param_schemas
    return {"schemas": build_node_param_schemas(request.app)}


# Entity -> (model class name on the models package, candidate label columns).
# Powers the record pickers ("which document / control / risk") for config
# fields whose name resolves to a platform entity.
_LOOKUP_SPECS = {
    "document": ("GovernanceDocument", ["title", "name"]),
    "evidence": ("Evidence", ["name", "title"]),
    "framework": ("UploadedFramework", ["name"]),
    "control": ("ParsedFrameworkControl", ["title", "name", "control_id"]),
    "risk": ("Risk", ["title", "name"]),
    "vulnerability": ("Vulnerability", ["title", "name"]),
}


@router.get("/lookup/{entity}")
def lookup_records(
    entity: str,
    q: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    """Search real platform records for a config field's record picker.

    Returns ``{entity, results: [{id, label}]}``. Unknown or unavailable
    entities return an empty list so the UI falls back to a plain id input.
    """
    limit = max(1, min(int(limit or 20), 50))
    tenant_id = get_user_primary_tenant(current_user, db)

    if entity == "user":
        query = db.query(GRCUser).filter(GRCUser.is_active.is_(True))
        if q:
            query = query.filter(
                GRCUser.username.ilike(f"%{q}%")
                | GRCUser.email.ilike(f"%{q}%")
                | GRCUser.display_name.ilike(f"%{q}%")
            )
        rows = query.order_by(GRCUser.display_name.asc()).limit(limit).all()
        return {"entity": entity, "results": [
            {"id": u.id, "label": u.display_name or u.username or u.email} for u in rows
        ]}

    spec = _LOOKUP_SPECS.get(entity)
    if not spec:
        return {"entity": entity, "results": []}
    try:
        from .... import models as _models
        model = getattr(_models, spec[0], None)
        if model is None:
            return {"entity": entity, "results": []}
        label_cols = [c for c in spec[1] if hasattr(model, c)]
        query = db.query(model)
        if hasattr(model, "tenant_id") and tenant_id is not None:
            query = query.filter(model.tenant_id == tenant_id)
        if q and label_cols:
            query = query.filter(or_(*[getattr(model, c).ilike(f"%{q}%") for c in label_cols]))
        rows = query.limit(limit).all()
        results = []
        for r in rows:
            label = None
            for c in label_cols:
                v = getattr(r, c, None)
                if v:
                    label = str(v)
                    break
            results.append({"id": getattr(r, "id", None), "label": label or f"#{getattr(r, 'id', '')}"})
        return {"entity": entity, "results": results}
    except Exception:  # noqa: BLE001
        logger.exception("workflow lookup failed for entity=%s", entity)
        return {"entity": entity, "results": []}


@router.get("/node-config-options")
def get_node_config_options(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Return tenant-aware dynamic reference data for populating node configuration fields."""
    tenant_id = get_user_primary_tenant(current_user, db)

    frameworks = (
        db.query(Framework)
        .filter(Framework.is_active.is_(True))
        .order_by(Framework.name)
        .limit(300)
        .all()
    )

    sla_configs = []
    if tenant_id:
        sla_configs = (
            db.query(VulnerabilitySLAConfig)
            .filter(
                VulnerabilitySLAConfig.tenant_id == tenant_id,
                VulnerabilitySLAConfig.is_active.is_(True),
            )
            .all()
        )

    return {
        "frameworks": [
            {
                "id": f.id,
                "name": f.name,
                "version": f.version or "",
                "short_code": getattr(f, "short_code", "") or "",
            }
            for f in frameworks
        ],
        "vulnerability_sla_configs": [
            {"severity": s.severity, "remediation_days": s.remediation_days}
            for s in sla_configs
        ],
        # ── Static reference data ──────────────────────────────────────────────────
        "risk_categories": [
            "strategic", "operational", "financial", "compliance",
            "technology", "third_party", "project_change",
        ],
        "risk_statuses": ["open", "in_progress", "mitigated", "accepted", "closed"],
        "risk_levels": ["critical", "high", "medium", "low"],
        "risk_treatment_types": ["mitigate", "accept", "transfer", "avoid"],
        "risk_register_types": [
            "operational", "strategic", "financial", "technology",
            "compliance", "third_party", "project_change", "ubl_template",
        ],
        "risk_sub_categories": [
            "cybersecurity", "data_privacy", "business_continuity", "fraud",
            "regulatory", "reputational", "supply_chain", "human_error",
            "natural_disaster", "financial_reporting", "market", "credit",
            "liquidity", "concentration", "it_infrastructure", "change_management",
        ],
        "compliance_statuses": [
            "not_started", "in_progress", "submitted_for_review",
            "approved", "certified", "expired", "rejected",
        ],
        "vulnerability_severities": ["critical", "high", "medium", "low", "info"],
        "vulnerability_statuses": [
            "open", "in_progress", "resolved", "accepted", "false_positive",
        ],
        "policy_categories": [
            "Information Security", "Privacy & Data Protection", "Business Continuity",
            "Acceptable Use", "Change Management", "Incident Response",
            "Access Control", "Third Party Management", "Physical Security",
            "Compliance", "Human Resources", "Financial Controls",
        ],
        "policy_statuses": ["draft", "under_review", "approved", "published", "archived"],
        "audit_types": ["internal", "external", "supplier", "regulatory", "certification"],
        "finding_severities": ["critical", "high", "medium", "low", "informational"],
        "control_effectiveness_levels": [
            "fully_effective", "largely_effective",
            "partially_effective", "ineffective", "not_assessed",
        ],
        "evidence_categories": [
            "policy", "procedure", "training_record", "technical_control",
            "operational_control", "audit_report", "certification",
            "screenshot", "log", "contract",
        ],
        "report_types": [
            "executive_summary", "gap_analysis", "risk_register",
            "compliance_status", "vulnerability_summary", "audit_report",
            "evidence_completeness",
        ],
        "kri_categories": [
            "financial", "operational", "compliance", "reputation",
            "strategic", "technology",
        ],
        "remediation_priorities": ["critical", "high", "medium", "low"],
        "asset_types": [
            "server", "workstation", "network_device", "database", "application",
            "cloud_service", "storage", "endpoint", "iot_device", "virtual_machine",
        ],
        "asset_criticality_levels": ["critical", "high", "medium", "low"],
    }


@router.get("/templates/library")
def list_template_library(
    _: bool = Depends(require_tenant_permission("workflow_engine:templates:view")),
):
    return {"templates": PREBUILT_TEMPLATES}


@router.get("/integrations")
def list_cross_module_integration_points(
    _: bool = Depends(require_tenant_permission("workflow_engine:integrations:view")),
):
    return {"integration_points": INTEGRATION_POINTS}


@router.get("/actors/users")
def list_actor_users(
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    """List tenant users available as workflow actors (approvers, assignees, recipients)."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"users": []}

    # Per-tenant DB: every active grc_users row is a tenant member.
    # Joining through grc_tenant_users would silently drop users created
    # via /admin/users (which doesn't backfill that join table).
    query = (
        db.query(GRCUser)
        .filter(GRCUser.is_active.is_(True))
    )

    if search:
        query = query.filter(
            GRCUser.username.ilike(f"%{search}%")
            | GRCUser.email.ilike(f"%{search}%")
            | GRCUser.display_name.ilike(f"%{search}%")
        )
    users = query.order_by(GRCUser.display_name.asc(), GRCUser.username.asc()).limit(200).all()
    return {
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name or user.username,
            }
            for user in users
        ]
    }


@router.get("/actors/roles")
def list_actor_roles(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    """List tenant roles available as workflow actors."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return []

    roles = (
        db.query(Role)
        .filter(Role.tenant_id.in_(tenant_ids))
        .order_by(Role.name)
        .all()
    )

    return [
        {"id": r.id, "name": r.name, "description": getattr(r, "description", None)}
        for r in roles
    ]
