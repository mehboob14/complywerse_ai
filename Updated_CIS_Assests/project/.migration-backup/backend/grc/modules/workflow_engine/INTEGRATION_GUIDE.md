# Workflow Engine — Full Integration Guide

This document records every change made to integrate the Workflow Engine (watcher) into the
GRC platform.  Follow these steps in order to reproduce the integration in an equivalent project.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database — SQLAlchemy Models](#2-database--sqlalchemy-models)
3. [Backend — Audit Logging Middleware](#3-backend--audit-logging-middleware)
4. [Backend — Workflow Engine Module Wiring](#4-backend--workflow-engine-module-wiring)
5. [Backend — Trigger Dispatcher (event mapping)](#5-backend--trigger-dispatcher-event-mapping)
6. [Backend — Action Handlers (template variables)](#6-backend--action-handlers-template-variables)
7. [Backend — Trigger Catalog](#7-backend--trigger-catalog)
8. [Frontend — types.ts Registries](#8-frontend--typests-registries)
9. [Database — Seed Workflow Definitions](#9-database--seed-workflow-definitions)
10. [Environment Variables](#10-environment-variables)
11. [Quick-Start Checklist](#11-quick-start-checklist)

---

## 1. Architecture Overview

```
HTTP Request
    │
    ▼
FastAPI audit_log_middleware   ← writes every mutating request to AuditLog table
    │
    ▼
TriggerDispatcher.poll_platform_events()   ← polls AuditLog every 500 ms
    │   • reads new AuditLog rows since last poll
    │   • maps (resource_type, action, request_body) → event name(s)
    ▼
WorkflowEventQueue              ← in-memory thread-safe queue
    │
    ▼
TriggerDispatcher.dispatch_event()  ← matches event name against WorkflowDefinition.trigger_event
    │   • evaluates optional trigger_conditions (JSON filter rules)
    ▼
WorkflowRuntime._start_instance()   ← creates WorkflowInstance row, runs node graph
    │
    ▼
StepExecutor   ← executes each node: send_email, in_app_alert, webhook, approval, timer, …
```

The whole runtime runs as a **single background daemon thread** inside the FastAPI process,
started on the `startup` lifecycle event.

---

## 2. Database — SQLAlchemy Models

All models live in `backend/grc/models.py`.  Add these classes (or equivalent migrations) to
your database before starting the server.

### 2.1 AuditLog  *(pre-existing, but must have these columns)*

```python
class AuditLog(Base):
    __tablename__ = "grc_audit_logs"

    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id      = Column(Integer, ForeignKey("grc_users.id"),   nullable=True)
    action       = Column(String(100), index=True)   # "create" | "update" | "delete" | "read"
    resource_type = Column(String(100), index=True)  # "risks" | "governance" | "vulnerabilities" …
    resource_id  = Column(Integer, nullable=True)
    changes      = Column(JSON, default={})           # {"method","path","request":{body},...}
    ip_address   = Column(String(45), nullable=True)
    timestamp    = Column(DateTime, default=datetime.utcnow, index=True)
```

### 2.2 Workflow Engine Tables

```python
class WorkflowDefinition(Base):
    __tablename__ = "grc_workflow_definitions"
    id                 = Column(Integer, primary_key=True, index=True)
    tenant_id          = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name               = Column(String(255), nullable=False)
    description        = Column(Text, nullable=True)
    version            = Column(Integer, default=1)
    is_active          = Column(Boolean, default=True, index=True)
    trigger_event      = Column(String(255), nullable=False, index=True)
    trigger_conditions = Column(JSON, default={})
    definition_json    = Column(JSON, default={})
    created_by_id      = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by_id      = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at         = Column(DateTime, default=datetime.utcnow)
    updated_at         = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WorkflowNode(Base):
    __tablename__ = "grc_workflow_nodes"
    id                       = Column(Integer, primary_key=True, index=True)
    workflow_definition_id   = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False)
    node_key                 = Column(String(100), nullable=False)  # unique within definition
    node_type                = Column(String(255), nullable=False)  # "start"|"end"|"action"|"condition"|...
    name                     = Column(String(255), nullable=False)
    config                   = Column(JSON, default={})
    position_x               = Column(Float, default=0)
    position_y               = Column(Float, default=0)
    is_start                 = Column(Boolean, default=False)
    is_terminal              = Column(Boolean, default=False)
    created_at               = Column(DateTime, default=datetime.utcnow)
    updated_at               = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WorkflowEdge(Base):
    __tablename__ = "grc_workflow_edges"
    id                       = Column(Integer, primary_key=True, index=True)
    workflow_definition_id   = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False)
    source_node_key          = Column(String(100), nullable=False)
    target_node_key          = Column(String(100), nullable=False)
    condition                = Column(JSON, default={})
    priority                 = Column(Integer, default=100)
    created_at               = Column(DateTime, default=datetime.utcnow)


class WorkflowInstance(Base):
    __tablename__ = "grc_workflow_instances"
    id                       = Column(Integer, primary_key=True, index=True)
    workflow_definition_id   = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False)
    tenant_id                = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    status                   = Column(String(50), default="running", index=True)
    current_node_key         = Column(String(100), nullable=True)
    trigger_event            = Column(String(255), nullable=True)
    trigger_payload          = Column(JSON, default={})
    context                  = Column(JSON, default={})
    correlation_id           = Column(String(255), nullable=True, index=True)
    started_at               = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at             = Column(DateTime, nullable=True)
    failed_at                = Column(DateTime, nullable=True)
    error_message            = Column(Text, nullable=True)


class WorkflowEngineStep(Base):
    __tablename__ = "grc_workflow_engine_steps"
    id                       = Column(Integer, primary_key=True, index=True)
    workflow_instance_id     = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=False)
    node_key                 = Column(String(100), nullable=False)
    node_type                = Column(String(50), nullable=False)
    status                   = Column(String(50), default="pending", index=True)
    input_payload            = Column(JSON, default={})
    output_payload           = Column(JSON, default={})
    attempts                 = Column(Integer, default=0)
    assigned_to_user_id      = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    next_run_at              = Column(DateTime, nullable=True, index=True)
    started_at               = Column(DateTime, default=datetime.utcnow)
    completed_at             = Column(DateTime, nullable=True)
    error_message            = Column(Text, nullable=True)


class ApprovalRequest(Base):
    __tablename__ = "grc_workflow_approval_requests"
    id                       = Column(Integer, primary_key=True, index=True)
    tenant_id                = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)
    workflow_instance_id     = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=False)
    workflow_step_id         = Column(Integer, ForeignKey("grc_workflow_engine_steps.id"), nullable=False)
    status                   = Column(String(50), default="pending", index=True)
    approval_type            = Column(String(50), default="single")
    required_approvals       = Column(Integer, default=1)
    received_approvals       = Column(Integer, default=0)
    approver_user_id         = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approver_role            = Column(String(100), nullable=True)
    decision_comment         = Column(Text, nullable=True)
    due_at                   = Column(DateTime, nullable=True)
    responded_at             = Column(DateTime, nullable=True)
    request_metadata         = Column(JSON, default={})
    created_at               = Column(DateTime, default=datetime.utcnow)


class WorkflowAuditLog(Base):
    __tablename__ = "grc_workflow_audit_logs"
    id                       = Column(Integer, primary_key=True, index=True)
    tenant_id                = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_definition_id   = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=True)
    workflow_instance_id     = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=True)
    workflow_step_id         = Column(Integer, ForeignKey("grc_workflow_engine_steps.id"), nullable=True)
    event_type               = Column(String(100), nullable=False, index=True)
    message                  = Column(Text, nullable=True)
    payload                  = Column(JSON, default={})
    created_by_id            = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at               = Column(DateTime, default=datetime.utcnow, index=True)


class WorkflowDefinitionVersion(Base):
    __tablename__ = "grc_workflow_definition_versions"
    id                       = Column(Integer, primary_key=True, index=True)
    workflow_definition_id   = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False)
    tenant_id                = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False)
    version_number           = Column(Integer, nullable=False)
    name                     = Column(String(255), nullable=False)
    description              = Column(Text, nullable=True)
    trigger_event            = Column(String(255), nullable=False)
    trigger_conditions       = Column(JSON, default={})
    definition_json          = Column(JSON, default={})
    nodes_json               = Column(JSON, default=[])
    edges_json               = Column(JSON, default=[])
    change_summary           = Column(Text, nullable=True)
    created_by_id            = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at               = Column(DateTime, default=datetime.utcnow, index=True)


class WorkflowEngineWebhookEndpoint(Base):
    __tablename__ = "grc_workflow_webhook_endpoints"
    id                       = Column(Integer, primary_key=True, index=True)
    tenant_id                = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name                     = Column(String(255), nullable=False)
    url                      = Column(String(1024), nullable=False)
    method                   = Column(String(10), default="POST")
    headers                  = Column(JSON, default={})
    auth_type                = Column(String(50), nullable=True)
    auth_config              = Column(JSON, default={})
    is_active                = Column(Boolean, default=True)
    created_at               = Column(DateTime, default=datetime.utcnow)
    updated_at               = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

Call `Base.metadata.create_all(engine)` (or run Alembic migrations) after adding these models.

---

## 3. Backend — Audit Logging Middleware

**File:** `backend/grc/audit_logger.py`  
**File:** `backend/grc/main.py`

### 3.1 `audit_logger.py`

This module writes an `AuditLog` row on every mutating HTTP request.  The key function is
`write_audit_log` — it is called from the HTTP middleware in `main.py`.

The `changes` column stores a JSON dict with these keys:

| Key           | Value                                                       |
|---------------|-------------------------------------------------------------|
| `method`      | `"POST"` / `"PUT"` / `"PATCH"` / `"DELETE"`                |
| `path`        | Full request path, e.g. `/grc/erm/risks/42`                 |
| `query`       | Dict of query params                                        |
| `status_code` | HTTP response status code                                   |
| `duration_ms` | Request duration in milliseconds                            |
| `request`     | Parsed + sanitized request body (JSON/form)                 |

**How `resource_type` is determined:**

```
/grc/erm/risks/5           → resource_type="risks",          resource_id=5
/grc/erm/incidents/3       → resource_type="incidents",       resource_id=3
/grc/governance/12/status  → resource_type="governance",      resource_id=12
/grc/vuln-management/vulnerabilities/7 → resource_type="vulnerabilities", resource_id=7
```

Modules listed in `_MODULE_SUB_ENTITY_PREFIXES` (`erm`, `evidence-mgmt`, `vuln-management`,
`audit-management`, `control-library`) use their **second** path segment as `resource_type`.
All other modules use the alias in `_MODULE_RESOURCE_ALIASES` or the module name itself.

### 3.2 `main.py` — middleware registration

Add the audit middleware **before** registering any routers:

```python
from .audit_logger import should_audit_request, parse_request_payload, write_audit_log

@app.middleware("http")
async def audit_log_middleware(request: Request, call_next):
    if not should_audit_request(request):
        return await call_next(request)

    import time
    started_at = time.time()

    request_payload = None
    if request.method.upper() not in {"GET", "DELETE", "HEAD", "OPTIONS"}:
        body = await request.body()
        received = False

        async def receive():
            nonlocal received
            if received:
                return {"type": "http.request", "body": b"", "more_body": False}
            received = True
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive
        request_payload = await parse_request_payload(request, body)

    try:
        response = await call_next(request)
        write_audit_log(request, response, started_at, request_payload)
        return response
    except Exception:
        write_audit_log(request, Response(status_code=500), started_at, request_payload)
        raise
```

### 3.3 `main.py` — startup / shutdown hooks

```python
from .modules.workflow_engine import (
    workflow_engine_router,
    start_workflow_engine_runtime,
    stop_workflow_engine_runtime,
)

app.include_router(workflow_engine_router)

@app.on_event("startup")
def on_startup():
    init_grc_db()
    _disable_embedded = os.getenv("DISABLE_EMBEDDED_WORKFLOW_RUNTIME", "").strip().lower()
    if _disable_embedded not in ("1", "true", "yes", "on"):
        start_workflow_engine_runtime()

@app.on_event("shutdown")
def on_shutdown():
    stop_workflow_engine_runtime()
```

---

## 4. Backend — Workflow Engine Module Wiring

**File:** `backend/grc/modules/workflow_engine/__init__.py`

```python
from .router import router as workflow_engine_router
from .services.runtime import start_runtime as start_workflow_engine_runtime
from .services.runtime import stop_runtime as stop_workflow_engine_runtime

__all__ = [
    "workflow_engine_router",
    "start_workflow_engine_runtime",
    "stop_workflow_engine_runtime",
]
```

**File:** `backend/grc/modules/workflow_engine/services/runtime.py` — exposes `start_runtime`
and `stop_runtime` module-level helpers:

```python
_runtime_instance: Optional[WorkflowRuntime] = None

def start_runtime() -> None:
    global _runtime_instance
    if _runtime_instance is None:
        _runtime_instance = WorkflowRuntime()
    _runtime_instance.start()

def stop_runtime() -> None:
    if _runtime_instance:
        _runtime_instance.stop()
```

The `WorkflowRuntime._run_loop` polls the database every **500 ms** (`time.sleep(0.5)`).

---

## 5. Backend — Trigger Dispatcher (event mapping)

**File:** `backend/grc/modules/workflow_engine/services/trigger_dispatcher.py`

This is the heart of the watcher.  It converts every `AuditLog` row into one or more named
workflow events.

### 5.1 `_EVENT_MAP` — static mapping

Maps `(resource_type, action)` → list of trigger event names.  
Extend this dict whenever you add a new module or event:

```python
_EVENT_MAP: Dict[str, Dict[str, List[str]]] = {
    "risks": {
        "create": ["risk_created", "risks.create", "risks.created"],
        "update": ["risk_updated", "risk_score_exceeds_threshold", "risk_status_changed", "risks.update", ...],
        "delete": ["risk_deleted", "risks.delete"],
    },
    "vulnerabilities": {
        "create": ["vulnerability_created", "new_vulnerability_detected", ...],
        "update": ["vulnerability_updated", "vulnerability_sla_breach", "vulnerability_sla_warning", ...],
        "delete": ["vulnerability_deleted", ...],
    },
    "governance": {
        "create": ["governance.create"],
        "update": ["assessment_status_change", "control_review_due", "attestation_overdue", "governance.update", ...],
    },
    # … see the actual file for the complete map …
}
```

### 5.2 `_derive_event_names` — special-case logic

Some triggers cannot be derived from `(resource_type, action)` alone because the same HTTP
method is reused for multiple semantically different operations.  Add special-case blocks inside
`_derive_event_names` after the direct `_EVENT_MAP` lookup:

#### Example added: `policy_submitted_for_review`

"Submit for Review" calls `PUT /grc/governance/{id}/status` with body `{"status":"pending_review"}`.
That HTTP call produces `resource_type="governance"`, `action="update"` — the same as any other
governance update.  To distinguish it:

```python
# Special: governance document submitted for review
# Fires when PUT /{doc_id}/status is called with {"status": "pending_review"}
if resource_type == "governance" and action == "update":
    changes_inner = (log.changes or {}) if isinstance(log.changes, dict) else {}
    requested = changes_inner.get("request") or {}
    if isinstance(requested, dict) and requested.get("status") == "pending_review":
        if "policy_submitted_for_review" not in event_names:
            event_names.append("policy_submitted_for_review")
```

**Pattern to follow for any new status-change trigger:**

```python
if resource_type == "<your_module>" and action == "update":
    changes_inner = (log.changes or {}) if isinstance(log.changes, dict) else {}
    requested = changes_inner.get("request") or {}
    if isinstance(requested, dict) and requested.get("<field_name>") == "<expected_value>":
        if "<your_new_event>" not in event_names:
            event_names.append("<your_new_event>")
```

### 5.3 Module path aliases

If your module URL does not match the resource type name, add it to `_MODULE_ALIASES`:

```python
_MODULE_ALIASES: Dict[str, str] = {
    "erm": "risks",
    "vuln-management": "vulnerabilities",
    "evidence-mgmt": "evidence",
    "audit-management": "audits",
    # add your own:
    # "my-module": "my_resource_type",
}
```

---

## 6. Backend — Action Handlers (template variables)

**File:** `backend/grc/modules/workflow_engine/services/action_handlers.py`

`_build_template_context` enriches the event payload with database fields so email/alert
templates can use `{{title}}`, `{{status}}`, `{{owner_name}}`, etc.

### 6.1 Adding a new resource type

Add an `elif resource_type == "your_type":` branch inside the DB enrichment block:

```python
elif resource_type in ("governance", "policies"):
    obj = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == rid,
        GovernanceDocument.tenant_id == tid
    ).first()
    if obj:
        ctx.update({
            "title":            obj.title or "",
            "description":      getattr(obj, 'description', '') or "",
            "doc_type":         obj.doc_type or "",
            "status":           obj.status or "",
            "current_version":  obj.current_version or "",
            "next_review_date": obj.next_review_date.strftime("%Y-%m-%d") if obj.next_review_date else "",
            "expiry_date":      obj.expiry_date.strftime("%Y-%m-%d") if obj.expiry_date else "",
        })
```

### 6.2 Available common variables (always present)

| Variable           | Source                                    |
|--------------------|-------------------------------------------|
| `workflow_name`    | WorkflowDefinition.name                   |
| `event_timestamp`  | AuditLog.timestamp                        |
| `resource_type`    | AuditLog.resource_type                    |
| `resource_id`      | AuditLog.resource_id                      |
| `action`           | AuditLog.action                           |
| `tenant_id`        | token / middleware                        |
| `severity`         | from changes or DB                        |
| `status`           | from changes or DB                        |
| `created_by_name`  | GRCUser.display_name of triggering user   |
| `created_by_email` | GRCUser.email of triggering user          |

### 6.3 Resource-specific variables

**Risks:** `title`, `description`, `category`, `status`, `inherent_score`, `residual_score`,
`risk_appetite`, `due_date`, `register_type`, `risk_sub_category`, `owner_name`, `owner_email`

**Vulnerabilities:** `title`, `description`, `severity`, `cvss_score`, `status`, `cve_id`,
`cwe_id`, `affected_component`, `affected_host`, `affected_url`, `due_date`, `vuln_id`,
`recommendation`, `sla_remediation_days`, `sla_due_date`, `owner_name`, `owner_email`

**Governance / Policies:** `title`, `description`, `doc_type`, `status`, `current_version`,
`next_review_date`, `expiry_date`

**Evidence:** `name`, `description`, `status`, `evidence_type`, `file_name`, `expiry_date`,
`quality_score`, `version`

**Audits:** `title`, `condition`, `severity`, `status`, `finding_number`, `due_date`

**IT Assets:** `name`, `description`, `asset_type`, `criticality`, `status`, `host_name`,
`ip_address`, `vendor`, `location`, `valuation`, `custodian`, `confidentiality_rating`,
`integrity_rating`, `availability_rating`, `owner_name`, `owner_email`

---

## 7. Backend — Trigger Catalog

**File:** `backend/grc/modules/workflow_engine/services/catalog.py`

The catalog is displayed in the frontend workflow builder palette.  Add a new entry for every
new trigger event you create:

```python
TRIGGER_NODE_TYPES = [
    # … existing entries …

    # ── Governance & policy triggers ──────────────────────────────────────────
    {"key": "policy_submitted_for_review", "label": "Policy submitted for review"},
    {"key": "policy_review_due",           "label": "Policy review due"},
    {"key": "policy_approved",             "label": "Policy approved / published"},
    # ── Audit triggers ────────────────────────────────────────────────────────
    {"key": "audit_finding_created",       "label": "Audit finding created"},
    # ── IT Asset triggers ─────────────────────────────────────────────────────
    {"key": "asset_created",               "label": "IT asset created"},
    {"key": "asset_updated",               "label": "IT asset updated"},
    {"key": "asset_deleted",               "label": "IT asset deleted"},
]
```

The `key` must exactly match the event name string used in `_EVENT_MAP` /
`_derive_event_names` and in the frontend registries.

---

## 8. Frontend — types.ts Registries

**File:** `grc-frontend/src/app/(dashboard)/workflow-engine/components/types.ts`

Every new trigger event must be registered in **all six** of the following locations.
Failure to add the entry to even one of them will cause the trigger to be invisible or broken
in the workflow builder UI.

### 8.1 `TRIGGER_KEYS` set  *(~line 230)*

```ts
export const TRIGGER_KEYS = new Set([
  // … existing …
  // Governance & policy
  'policy_submitted_for_review',   // ← ADD
  'policy_review_due',
  'policy_approved',
  // …
]);
```

### 8.2 `CURATED_NODE_METADATA`  *(~line 333)*

```ts
export const CURATED_NODE_METADATA: Record<string, ...> = {
  // …
  policy_submitted_for_review: { domains: ['governance'], module: 'Governance' },  // ← ADD
  policy_review_due:           { domains: ['governance'], module: 'Governance' },
  // …
};
```

### 8.3 `TRIGGER_EVENT_MAP`  *(~line 615)*

```ts
export const TRIGGER_EVENT_MAP: Record<string, string> = {
  // …
  // Governance & policy
  policy_submitted_for_review: 'policy_submitted_for_review',  // ← ADD
  policy_review_due: 'policy_review_due',
  // …
};
```

### 8.4 `NODE_TYPE_LABELS`  *(~line 653)*

```ts
export const NODE_TYPE_LABELS: Record<string, string> = {
  // …
  // Governance triggers
  policy_submitted_for_review: 'Policy Submitted for Review',  // ← ADD
  policy_review_due: 'Policy Review Due',
  // …
};
```

### 8.5 `PALETTE_DESCRIPTIONS`  *(~line 755)*

```ts
export const PALETTE_DESCRIPTIONS: Record<string, string> = {
  // …
  // Governance triggers
  policy_submitted_for_review: 'Fires when a policy is submitted for review',  // ← ADD
  policy_review_due: 'Fires when a policy is due for review',
  // …
};
```

### 8.6 `TRIGGER_TEMPLATE_VARS`  *(~line 954)*

```ts
export const TRIGGER_TEMPLATE_VARS: Record<string, TemplateSections[]> = {
  // …
  // Policy / Governance
  policy_submitted_for_review: [{ section: 'Policy Fields', vars: _POLICY }, { section: 'Common', vars: _COMMON }],  // ← ADD
  policy_review_due:           [{ section: 'Policy Fields', vars: _POLICY }, { section: 'Common', vars: _COMMON }],
  // …
  // IT Assets
  asset_created: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],  // ← ADD
  asset_updated: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],  // ← ADD
  asset_deleted: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],  // ← ADD
  // …
};
```

You must also define the `_ASSET` variable group (add it alongside `_AUDIT`, `_RISK`, etc.):

```ts
const _ASSET: TemplateVar[] = [
  { key: 'name',                   label: 'Asset Name'            },
  { key: 'description',            label: 'Description'           },
  { key: 'asset_type',             label: 'Asset Type'            },
  { key: 'criticality',            label: 'Criticality'           },
  { key: 'status',                 label: 'Status'                },
  { key: 'host_name',              label: 'Hostname'              },
  { key: 'ip_address',             label: 'IP Address'            },
  { key: 'vendor',                 label: 'Vendor'                },
  { key: 'location',               label: 'Location'              },
  { key: 'valuation',              label: 'Valuation'             },
  { key: 'custodian',              label: 'Custodian'             },
  { key: 'confidentiality_rating', label: 'Confidentiality (CIA)' },
  { key: 'integrity_rating',       label: 'Integrity (CIA)'       },
  { key: 'availability_rating',    label: 'Availability (CIA)'    },
  { key: 'owner_name',             label: 'Asset Owner (Name)'    },
  { key: 'owner_email',            label: 'Asset Owner (Email)'   },
];
```

The `_POLICY` variable group (already defined in `types.ts`) exposes:
`title`, `doc_type`, `status`, `current_version`, `next_review_date`, `expiry_date`.

---

## 9. Database — Seed Workflow Definitions

Use the following Python pattern to seed a workflow definition programmatically.
Run it once after the server tables are created.

```python
import sys; sys.path.insert(0, 'backend')
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from grc.models import WorkflowDefinition, WorkflowNode, WorkflowEdge

db = sessionmaker(bind=create_engine('sqlite:///backend/grc_app.db'))()

# ── Configuration ────────────────────────────────────────────────────────────
TENANT_ID         = 1                                    # your tenant id
RECIPIENT_EMAIL   = 'admin@yourcompany.com'              # notification target
RECIPIENT_USER_ID = 1                                    # grc_users.id

TRIGGER_EVENT = 'risk_created'   # change to any trigger key from Section 7

email_node_key = f'send_email_{TRIGGER_EVENT}'
alert_node_key = f'send_alert_{TRIGGER_EVENT}'

email_cfg = {
    'action_name': 'send_notification_email',
    'payload': {},
    'module': 'Workflow Engine',
    'domains': ['shared'],
    'to': [RECIPIENT_EMAIL],
    'recipient_user_ids': [RECIPIENT_USER_ID],
    'subject': f'[{TRIGGER_EVENT}] {{{{title}}}}',
    'body': 'Event: ' + TRIGGER_EVENT + '\n\nTitle: {{title}}\nStatus: {{status}}\nBy: {{created_by_name}}',
}

alert_cfg = {
    'action_name': 'send_in_app_alert',
    'payload': {},
    'module': 'Workflow Engine',
    'domains': ['shared'],
    'recipient_user_ids': [RECIPIENT_USER_ID],
    'alert_type': 'info',
    'subject': TRIGGER_EVENT,
    'message': '{{title}} — {{status}}',
}

defn = WorkflowDefinition(
    tenant_id=TENANT_ID,
    name=TRIGGER_EVENT,
    trigger_event=TRIGGER_EVENT,
    is_active=True,
    description=f'Auto-fires on {TRIGGER_EVENT}',
    trigger_conditions={},
    definition_json={},
)
db.add(defn); db.flush()
defn_id = defn.id

nodes = [
    WorkflowNode(workflow_definition_id=defn_id, node_key='start',          node_type='start',  name='Start',
                 is_start=True,  is_terminal=False, config={'trigger_type': TRIGGER_EVENT, 'module': 'GRC', 'domains': ['shared']},
                 position_x=350, position_y=30),
    WorkflowNode(workflow_definition_id=defn_id, node_key=email_node_key,   node_type='action', name='Send Email',
                 is_start=False, is_terminal=False, config=email_cfg,        position_x=350, position_y=160),
    WorkflowNode(workflow_definition_id=defn_id, node_key=alert_node_key,   node_type='action', name='In-App Alert',
                 is_start=False, is_terminal=False, config=alert_cfg,        position_x=350, position_y=290),
    WorkflowNode(workflow_definition_id=defn_id, node_key='end',            node_type='end',    name='End',
                 is_start=False, is_terminal=True,  config={'module': 'Workflow Engine', 'domains': ['workflow']},
                 position_x=350, position_y=420),
]
db.add_all(nodes); db.flush()

edges = [
    WorkflowEdge(workflow_definition_id=defn_id, source_node_key='start',        target_node_key=email_node_key, condition={}, priority=1),
    WorkflowEdge(workflow_definition_id=defn_id, source_node_key=email_node_key, target_node_key=alert_node_key, condition={}, priority=1),
    WorkflowEdge(workflow_definition_id=defn_id, source_node_key=alert_node_key, target_node_key='end',          condition={}, priority=1),
]
db.add_all(edges)
db.commit()
print(f'Seeded workflow id={defn_id} trigger={TRIGGER_EVENT!r}')
db.close()
```

### 9.1 All currently seeded workflows

| id | name                      | trigger_event                  |
|----|---------------------------|--------------------------------|
| 1  | risk_creation             | `risk_created`                 |
| 2  | anomaly creation          | `vulnerability_created`        |
| 3  | risk_updated              | `risk_updated`                 |
| 4  | risk_deleted              | `risk_deleted`                 |
| 5  | vulnerability_updated     | `vulnerability_updated`        |
| 6  | vulnerability_deleted     | `vulnerability_deleted`        |
| 7  | policy_submitted_for_review | `policy_submitted_for_review` |
| 8  | asset_created               | `asset_created`               |
| 9  | asset_updated               | `asset_updated`               |
| 10 | asset_deleted               | `asset_deleted`               |

---

## 10. Environment Variables

| Variable                              | Default | Description                                                                                |
|---------------------------------------|---------|--------------------------------------------------------------------------------------------|
| `DISABLE_EMBEDDED_WORKFLOW_RUNTIME`   | `false` | Set to `true` to skip starting the runtime inside the FastAPI process                     |
| `WORKFLOW_DISPATCH_REPLAY_AUDIT_LOGS` | `false` | Set to `true` to replay all historical AuditLog rows on startup (use with caution)        |
| `WORKFLOW_DISPATCH_INCLUDE_READ_EVENTS`| `false` | Set to `true` to emit workflow events for GET/read requests (normally skipped)            |
| `SMTP_HOST`                           | —       | SMTP server hostname for email delivery                                                    |
| `SMTP_PORT`                           | `587`   | SMTP port                                                                                  |
| `SMTP_USERNAME`                       | —       | SMTP authentication username                                                               |
| `SMTP_PASSWORD`                       | —       | SMTP authentication password                                                               |
| `SMTP_FROM_EMAIL`                     | —       | Sender address shown in notification emails                                                |

---

## 11. Quick-Start Checklist

Use this as a step-by-step integration checklist for a new project:

- [ ] **DB models** — copy all 9 Workflow Engine model classes into `models.py` and run migrations (Section 2)
- [ ] **AuditLog model** — confirm `changes` column is JSON and stores request body (Section 2.1)
- [ ] **`audit_logger.py`** — copy the file; adjust `_MODULE_SUB_ENTITY_PREFIXES` and `_MODULE_RESOURCE_ALIASES` to match your URL structure (Section 3.1)
- [ ] **`main.py` middleware** — add `audit_log_middleware` before router registration (Section 3.2)
- [ ] **`main.py` startup/shutdown** — add `start_workflow_engine_runtime` / `stop_workflow_engine_runtime` calls (Section 3.3)
- [ ] **`workflow_engine/__init__.py`** — expose `workflow_engine_router`, `start_runtime`, `stop_runtime` (Section 4)
- [ ] **`trigger_dispatcher.py`** — update `_EVENT_MAP` and `_MODULE_ALIASES` for your modules (Section 5)
- [ ] **`trigger_dispatcher.py`** — add any special-case status-change event blocks in `_derive_event_names` (Section 5.2)
- [ ] **`action_handlers.py`** — add `elif resource_type == "…"` enrichment blocks for every module (Section 6)
- [ ] **`catalog.py`** — add a `{"key": "…", "label": "…"}` entry for every new trigger (Section 7)
- [ ] **`types.ts`** — add 6 entries (Sections 8.1 – 8.6) for every new trigger
- [ ] **Seed DB** — run the Python seed script for each workflow you want active (Section 9)
- [ ] **Set SMTP env vars** — configure email delivery (Section 10)
- [ ] **Restart server** — the runtime thread starts automatically on `startup`

### Adding a brand-new trigger (summary)

1. Identify the HTTP request that represents the trigger (method, path, body shape)
2. Determine what `resource_type` the audit middleware will write (trace through `_extract_resource`)
3. Add the event name to `_EVENT_MAP[resource_type][action]` **or** add a special-case block in `_derive_event_names`
4. Add `{"key": "my_event", "label": "…"}` to `catalog.py`
5. Add 6 entries to `types.ts` (Sections 8.1–8.6)
6. Seed (or create via UI) a `WorkflowDefinition` with `trigger_event="my_event"`
