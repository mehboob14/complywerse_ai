# Integration Guide — Workflow Engine + Audit Log AI Summaries

> **Audience:** the engineer merging this branch's workflow engine + audit log work into the main GRC repo.
> Assumes the main GRC is the same FastAPI + SQLAlchemy + Vite/React baseline.

This guide is **separate from** and **complementary to** `INTEGRATION_GUIDE.md` (which covers the CIS/agents/risk-posture work). The two feature areas don't overlap on file paths except for `backend/grc/main.py` — see §5 step 3 for the merge order.

---

## TL;DR

1. **Workflow engine** — 80+ new platform-action handlers in `action_handlers.py`, dispatcher routing fixes in `trigger_dispatcher.py`, recipient resolution fixes in `step_executor.py`. Takes the platform from ~120 no-op stub workflows to real DB-mutating handlers.
2. **Audit log AI summaries** — on-demand OpenAI-backed natural-language summaries rendered as markdown in the audit-log details modal, plus listing endpoint hardening that made the system stable against legacy corrupt rows.

| Type | Count |
|---|---|
| Backend files modified | 5 |
| Backend files added | 1 (`audit_ai_summary.py`) |
| Frontend files modified | 2 |
| Proxy files modified | 1 |
| New env vars required | 1 (`OPENAI_API_KEY`) |
| DB schema migrations | 0 (uses existing `grc_audit_logs.changes` JSON) |

---

## 1. Workflow Engine changes

### 1.1 Files modified / added

| Path (relative to `backend/`) | Change | What it does |
|---|---|---|
| `grc/modules/workflow_engine/services/action_handlers.py` | **modified** (~+1,500 LOC) | New routing block + four new module-level handlers. Each covers all sub-resources of its module with real DB mutations. |
| `grc/modules/workflow_engine/services/trigger_dispatcher.py` | **modified** | Added `_CANONICAL_RESOURCE_MAP`, `_resolve_canonical_resource()`, nested-sub-resource handling in `_derive_event_names()`. |
| `grc/modules/workflow_engine/services/step_executor.py` | **modified** | Fixed inline `send_in_app_alert` + `send_notification_email` recipient resolution (was reading the wrong config field). |
| `grc/main.py` | **modified** | Audit middleware now captures non-2xx JSON response bodies (16 KB cap) so AI summaries can show real failure reasons. |

### 1.2 New platform-action handlers in `action_handlers.py`

The legacy `WorkflowActionHandlers._execute_platform_capability_action()` previously returned `{"result": "executed"}` for everything except `governance.documents.*`. Around line **590**, the routing block was extended:

```python
if module_key == "governance" and submodule_key == "documents":
    return WorkflowActionHandlers._execute_governance_document_action(...)

if module_key == "compliance":
    return WorkflowActionHandlers._execute_compliance_action(
        db, instance, definition, verb, submodule_key, functionality_key, payload
    )

if module_key == "risk_management":
    return WorkflowActionHandlers._execute_risk_action(
        db, instance, definition, verb, submodule_key, functionality_key, payload
    )

# Generic fallback: log and return "noop"
```

The new handlers (each is a `@staticmethod` on `WorkflowActionHandlers`):

| Handler | Submodules covered | Real DB tables it writes |
|---|---|---|
| `_execute_risk_action` (line ~1357) | `risk_register`, `kris`, `internal_controls`, `mitigation_actions`, `incidents`, `vendor_risk`, `rcsa`, `reviews`, `risk_assessments`, `risk_framework` | `grc_risks`, `grc_risk_kris`, `grc_risk_mitigation_actions`, `grc_risk_incidents`, `grc_risk_reviews`, `grc_risk_assessments`, `grc_risk_audit_finding_links`, `grc_risk_asset_links`, `grc_risk_control_links`, `grc_internal_controls`, `grc_internal_control_risk_links`, `grc_vendors`, `grc_vendor_assessments`, `grc_vendor_incidents`, `grc_rcsa_campaigns`, `grc_rcsa_findings`, `grc_rcsa_assessments` |
| `_execute_compliance_evidence_action` | `compliance.evidence` | `grc_evidence` — `quick_assess_evidence`, `lock_assessment`, `process_ocr`, `check_staleness`, `link_evidence_from_ai_suggestion`, `review_evidence`, `audit_package`, `add_evidence_to_package`, `finalize_package` |
| `_execute_compliance_control_library_action` | `compliance.control_library` | `group`, `auto_group_controls`, `generate_summary`, `inheritance_analysis`, `framework_driven_population`, `harmonization_report` |
| `_execute_compliance_controls_action` | `compliance.controls` | `side_by_side_comparison`, `ai_map_crosswalk`, `start_analysis`, `comparison.export` |
| `_execute_compliance_frameworks_action` | `compliance.frameworks` | `extract_text_from_framework`, `analyze_and_align_controls`, `alignment`, `confirm_alignment`, `unpublish_framework` |
| `_execute_compliance_evidence_requirements_action` | `compliance.evidence_requirements` | `upload_evidence`, `generate_for_control`, `bulk_generate_recommendations`, `recommendation`, `classify_framework`, `parse_framework_document`, `verify_parsed_control` |

### 1.3 The `_resolve_id` helper inside `_execute_risk_action`

This is the single most important piece of logic. The FastAPI audit middleware writes a row **before** SQLAlchemy returns the new entity's id, so `trigger.resource_id` is typically `null` on creates. The helper falls back to **looking up the entity by `resource_name`** (the human-readable name the middleware captures from request/response):

```python
def _resolve_id(*keys):
    # 1. Try explicit keys from trigger/ctx/payload
    for k in keys:
        v = trigger.get(k) or ctx.get(k) or payload.get(k)
        if v is not None:
            try: return int(v)
            except (TypeError, ValueError): pass
    # 2. Try trigger.resource_id directly
    if trigger.get("resource_id"):
        try: return int(trigger["resource_id"])
        except (TypeError, ValueError): pass
    # 3. Fallback: look up by resource_name + tenant
    resource_name = trigger.get("resource_name") or trigger.get("changes", {}).get("resource_name")
    if not resource_name and isinstance(trigger.get("changes"), dict):
        req = trigger["changes"].get("request") or {}
        resource_name = req.get("title") or req.get("name")
    if resource_name:
        rtype = (trigger.get("resource_type") or "").lower()
        try:
            if rtype.startswith("risk") and "risk_register" in (submodule_key or ""):
                row = (db.query(Risk)
                       .filter(Risk.tenant_id == tenant_id, Risk.title == resource_name)
                       .order_by(Risk.id.desc()).first())
                if row: return int(row.id)
            # ...similar branches for RiskKRI, InternalControl,
            # RiskMitigationAction, RiskIncident, Vendor
        except Exception:
            pass
    return None
```

**Without this**, every cascade-fired risk handler returns `"result": "skipped", "reason": "no risk_id"` and the platform looks like the workflows ran but did nothing.

### 1.4 Asset model name fix

The handler `link_risk_to_asset` initially imported `Asset` — the actual model is named **`ITAsset`**. The `ImportError` was being caught silently and the handler then reported "no assets exist". Fix:

```python
from ....models import ITAsset
asset = (
    db.query(ITAsset)
    .filter(ITAsset.tenant_id == tenant_id)
    .order_by(ITAsset.id.asc())
    .first()
)
```

### 1.5 Dispatcher routing — `trigger_dispatcher.py`

The dispatcher used to derive event names purely from `resource_type + action`. The Pattern-B v6 catalog uses canonical events like `risk.risk_register.create` which the legacy `risks.create` derivation could never match.

#### `_CANONICAL_RESOURCE_MAP` (around line 113)

Lookup table that maps `(URL module, URL entity)` to the canonical `(v6 module, v6 entity)`:

```python
_CANONICAL_RESOURCE_MAP: Dict[tuple, tuple] = {
    # /erm/* -> risk.<canonical_entity>
    ("erm", "risks"):                ("risk", "risk_register"),
    ("erm", "kris"):                 ("risk", "kris"),
    ("erm", "internal-controls"):    ("risk", "internal_controls"),
    ("erm", "mitigation-actions"):   ("risk", "mitigation_actions"),
    ("erm", "incidents"):            ("risk", "incidents"),
    ("erm", "rcsa"):                 ("risk", "rcsa"),
    ("erm", "reviews"):              ("risk", "reviews"),
    ("erm", "risk-assessments"):     ("risk", "risk_assessments"),
    ("vendor-risk", "*"):            ("risk", "vendor_risk"),
    # Compliance
    ("frameworks", "*"):                     ("compliance", "frameworks"),
    ("controls", "*"):                       ("compliance", "controls"),
    ("evidence", "*"):                       ("compliance", "evidence"),
    ("evidence-requirements", "*"):          ("compliance", "evidence_requirements"),
    ("control-library", "*"):                ("compliance", "control_library"),
    # Governance
    ("governance", "documents"):             ("governance", "documents"),
    ("governance", "attestations"):          ("governance", "attestations"),
    ("governance", "attestation-campaigns"): ("governance", "attestations"),  # alias
    ("governance", "committees"):            ("governance", "committees"),
    ("governance", "regulatory-changes"):    ("governance", "regulatory_changes"),
    ("governance", "regulatory-feeds"):      ("governance", "regulatory_feeds"),
    # Vulnerability mgmt
    ("vulnerabilities", "*"):                ("vulnmgmt", "vulnerabilities"),
}
```

The `"*"` wildcard catches sub-paths where the second URL segment is a numeric ID (e.g. `/evidence/4`).

#### Nested sub-resource handling — new block in `_derive_event_names()`

For paths like `POST /grc/erm/risks/65/mitigation-actions` the FastAPI middleware logs:
- `action: "mitigation_actions"` (sub-resource name)
- `resource_type: "risks"` (parent)

Neither matches any workflow. New code detects the pattern:

```python
if (
    len(parts) >= 4
    and parts[2].isdigit()
    and action in (parts[3].lower().replace("-", "_"), "create", "update", "delete")
):
    sub_entity = parts[3].lower()
    sub_v6_module, sub_v6_entity = _resolve_canonical_resource(module, sub_entity)
    sub_verb = "create" if action in (sub_entity.replace("-", "_"),) else action
    if sub_v6_module and sub_v6_entity:
        event_names.append(f"{sub_v6_module}.{sub_v6_entity}.{sub_verb}")
    canonical_for_sub = _MODULE_ALIASES.get(module, module)
    if canonical_for_sub != sub_entity:
        event_names.append(f"{canonical_for_sub}.{sub_entity.replace('-', '_')}.{sub_verb}")
```

This is what makes mitigation-action creates fire `risk.mitigation_actions.create` workflows.

### 1.6 In-app alert + email recipient fix (`step_executor.py`)

Both `send_in_app_alert` and `send_notification_email` previously only read recipients from `config.recipient_user_ids` / `config.to`. The catalog workflows write recipients into `config.payload.recipients`. The fix reads from both:

```python
recipients = (
    config.get("recipient_user_ids")
    or (config.get("payload") or {}).get("recipients")
    or []
)
```

### 1.7 What the workflow engine now does end-to-end

For example, creating a risk via `POST /grc/erm/risks`:

1. Risk row is INSERTed.
2. `audit_log_middleware` writes `grc_audit_logs` with `action=create`, `resource_type=risks`, `resource_name=<title>`.
3. Embedded dispatcher polls `grc_audit_logs` every 1s, picks up the new row.
4. `_derive_event_names()` emits both legacy and v6 events: `risks.create`, `risk.risk_register.create`.
5. ~13 subscribed workflow definitions are matched.
6. Each fires a `grc_workflow_instances` row → step executor walks the graph.
7. `platform_action.create.risk_management.risk_register.add_treatment_plan` → routes to `_execute_risk_action(submodule="risk_register", functionality="add_treatment_plan")` → `_resolve_id` looks up risk by title → writes `Risk.treatment_plan`.
8. Email + in-app nodes use `config.payload.recipients` to deliver notifications.

### 1.8 Embedded runtime startup

Both `backend/main.py` (outer entry uvicorn loads) and `grc/main.py` start the workflow runtime gated on:

```
DISABLE_EMBEDDED_WORKFLOW_RUNTIME=    # blank or "0" — runtime starts
DISABLE_EMBEDDED_WORKFLOW_RUNTIME=1   # disabled (for production with separate worker process)
```

---

## 2. Audit Log AI Summaries

### 2.1 Files added / modified

| Path | Change | What it does |
|---|---|---|
| `backend/grc/audit_ai_summary.py` | **NEW** | OpenAI-backed generator. Strict prompt enforces markdown structure (`### / ####` headings, restate-only-the-facts). Returns `{ai_summary, cached, fallback}`. |
| `backend/grc/routers/admin_router.py` | **modified** | New endpoint `POST /admin/audit-logs/{id}/ai-summary?force=<bool>`. Listing endpoint `GET /admin/audit-logs` actor_type filter switched from `CAST(changes AS JSONB)` (which crashed on ` `) to text-pattern match. |
| `backend/grc/main.py` | **modified** | Audit middleware captures non-2xx JSON response body (16 KB cap) into `changes.response_error` so AI can explain failures. |
| `artifacts/grc-frontend/src/app/(dashboard)/admin/audit-logs/page.tsx` | **modified** | Modal renders `aiSummary` via `<ReactMarkdown>`. `useEffect` auto-fetches on row click. Inline cache for instant re-open. Hides raw Request Data when AI present. |
| `artifacts/grc-frontend/src/lib/api.ts` | **modified** | Added `adminApi.generateAuditLogAiSummary(logId, force=false)`. Posts empty `{}` body (not `null`) so the proxy doesn't choke. |
| `artifacts/api-server/src/routes/proxy.ts` | **modified** | Re-serializes `req.body` when not null so empty `{}` body works. |

### 2.2 The endpoint

```
POST /grc/admin/audit-logs/{log_id}/ai-summary?force=<bool>
Body: {}
```

Behaviour:
- If `changes.ai_summary` already cached and `force=false` (default) — returns cached.
- Otherwise calls OpenAI `gpt-4o-mini` with the strict system prompt + the row's full `changes` JSON.
- Caches result inline at `grc_audit_logs.changes.ai_summary` (UPDATE on the row, `flag_modified` on the JSON column).
- On any failure (no OpenAI key, rate limit, network) — returns `{ai_summary: <template_summary>, fallback: true}` so the UI degrades gracefully.

Response shape:
```json
{
  "ai_summary": "### Mehboob created \"E2E_RiskMgmt_Cascade_v2\"\n\n#### Details\n- **Name:** ...",
  "cached": false,
  "fallback": false
}
```

### 2.3 Sample AI summary output

For a risk-create row:

```markdown
### Mehboob created "E2E_PostFix_NameLookup_v4"

#### Details
- **Name:** E2E_PostFix_NameLookup_v4
- **Description:** Validate that _resolve_id name-lookup fallback makes risk handlers do real DB work.
- **Category:** operational
- **Status:** open
- **Inherent Likelihood:** 3
- **Inherent Impact:** 3
- **Residual Likelihood:** 2
- **Residual Impact:** 2
- **Inherent Score:** 9
- **Residual Score:** 4

#### Result
- **Status Code:** 201 (Created)
```

For a workflow-execution row, the prompt also walks `nodes_json` / `edges_json` and produces a `#### Steps` and `#### Flow` section.

### 2.4 The listing endpoint hardening

The legacy filter on `actor_type` used:
```python
actor_val = func.jsonb_extract_path_text(
    cast(GlobalAuditLog.changes, JSONB), 'actor_type'
)
```

Postgres rejects `CAST(json AS jsonb)` when the JSON contains the literal six-char escape ` `. This happens routinely from CIS plugin scans on Windows registry values. Any such row caused **the entire list query to 500**.

The fix avoids the cast and uses text pattern matching on the JSON column:
```python
changes_text = cast(GlobalAuditLog.changes, SAString)
if actor_type == "workflow_engine":
    query = query.filter(changes_text.ilike('%"actor_type": "workflow_engine"%'))
elif actor_type == "user":
    query = query.filter(or_(
        changes_text.ilike('%"actor_type": "user"%'),
        ~changes_text.ilike('%"actor_type":%'),
    ))
```

### 2.5 Frontend — what the modal renders

```tsx
{aiSummaryLoading ? (
  <p className="text-xs ...">Generating readable summary…</p>
) : aiSummary ? (
  <div className="prose prose-sm max-w-none prose-headings:font-semibold ...">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>
  </div>
) : selectedLog.summary ? (
  <p className="text-xs font-semibold text-indigo-800">{selectedLog.summary}</p>
) : (
  <p className="text-xs text-slate-400 italic">No summary available.</p>
)}
```

`useEffect` triggers `adminApi.generateAuditLogAiSummary(selectedLog.id)` when a row is opened that doesn't already have a cached `ai_summary`. The successful response is patched back into the row in the list state so subsequent opens are instant.

### 2.6 Optional backfill script

`scripts_backfill_ai_summaries.py` (project root) iterates every audit row in the tenant, posts to `/admin/audit-logs/{id}/ai-summary`, caches the result. Used once on this tenant to seed ~16k+ historical audit rows. Safe to re-run — skips already-cached rows unless `force=True`.

---

## 3. Required environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI gpt-4o-mini calls for AI summary | **Yes** for AI summaries (graceful fallback if missing) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Alias the backend also checks | Optional |
| `DISABLE_EMBEDDED_WORKFLOW_RUNTIME` | Set to `1` in production where a separate workflow worker process runs | Optional |
| `WORKFLOW_DISPATCH_REPLAY_AUDIT_LOGS` | Default `false`. If `true`, dispatcher replays historical audit logs on startup (use with caution — floods workflow queue) | Optional |
| `WORKFLOW_DISPATCH_INCLUDE_READ_EVENTS` | Default `false`. Whether GET/read audit events should also be dispatched | Optional |
| `BACKEND_URL` | Used by Express proxy to reach FastAPI. Default `http://127.0.0.1:5000` | Optional |
| `PORT` (express) | Default proxy listening port | Optional |
| `PORT` + `BASE_PATH` (vite) | Frontend dev server. `BASE_PATH=/` is the right value for non-subpath deploys | Optional |

### SMTP for workflow notifications

Stored per-tenant in DB table `grc_workflow_email_configs`. Fields: `smtp_host`, `smtp_port`, `use_tls`, `username`, `password`, `from_email`. Production should set via admin UI rather than env vars. Test endpoint at `POST /grc/workflow-engine/notifications/email-config/{config_id}/test`.

---

## 4. Database — no schema changes needed

All new fields live inside the existing `grc_audit_logs.changes` JSON column:
- `changes.ai_summary` — cached markdown string
- `changes.response_error` — captured non-2xx body (added by middleware)

### One-off data sanitization for legacy ` ` rows

A small set of legacy audit rows (~18 in the tested tenant) contain the literal six-char escape ` ` inside `changes`. The listing endpoint now tolerates them, but if you want a clean state:

```python
# scripts/sanitize_audit_nul_escapes.py — run once per tenant DB
import psycopg2

conn = psycopg2.connect("postgresql://...")
cur = conn.cursor()
cur.execute("SELECT id FROM grc_audit_logs WHERE tenant_id=%s", (TENANT_ID,))
needle = chr(92) + 'u0000'  # 6 chars: backslash + u0000

for (rid,) in cur.fetchall():
    cur.execute("SELECT changes::text FROM grc_audit_logs WHERE id=%s", (rid,))
    raw = cur.fetchone()[0]
    if needle in raw:
        cleaned = raw.replace(needle, '')
        cur.execute("UPDATE grc_audit_logs SET changes = %s::json WHERE id=%s", (cleaned, rid))
        conn.commit()
```

---

## 5. Integration steps for the main GRC repo

Assuming the main GRC is the same Python+FastAPI+SQLAlchemy codebase as this branch, the merge is a file-by-file copy. Recommended order to minimize partially-broken states:

### Step 1 — copy `audit_ai_summary.py`

```bash
cp backend/grc/audit_ai_summary.py  <main_repo>/backend/grc/audit_ai_summary.py
```

No imports/dependencies needed beyond standard library + `openai` (already in the main repo).

### Step 2 — patch `backend/grc/routers/admin_router.py`

Two changes:

**(a)** Replace the `actor_type` filter block in `GET /admin/audit-logs` (around line 1054):

```python
if actor_type:
    if IS_SQLITE:
        actor_val = func.json_extract(GlobalAuditLog.changes, '$.actor_type')
        if actor_type == "workflow_engine":
            query = query.filter(actor_val == "workflow_engine")
        elif actor_type == "user":
            query = query.filter(or_(actor_val == "user", actor_val.is_(None)))
    else:
        # Postgres path: avoid CAST(changes AS jsonb) because the json column
        # may contain literal ' ' escapes which JSONB rejects.
        changes_text = cast(GlobalAuditLog.changes, SAString)
        if actor_type == "workflow_engine":
            query = query.filter(changes_text.ilike('%"actor_type": "workflow_engine"%'))
        elif actor_type == "user":
            query = query.filter(or_(
                changes_text.ilike('%"actor_type": "user"%'),
                ~changes_text.ilike('%"actor_type":%'),
            ))
```

**(b)** Add the new endpoint at the bottom of the file:

```python
@router.post("/audit-logs/{log_id}/ai-summary")
def generate_audit_log_ai_summary(
    log_id: int,
    force: bool = False,
    request: Request = ...,
    body: dict = Body(default={}),
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    db: Session = Depends(get_db),
):
    from sqlalchemy.orm.attributes import flag_modified
    from ..audit_ai_summary import generate_ai_summary

    tenant = get_tenant_from_request(request, db=db)
    log = db.query(GlobalAuditLog).filter(
        GlobalAuditLog.id == log_id,
        GlobalAuditLog.tenant_id == tenant.id,
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")

    changes = log.changes if isinstance(log.changes, dict) else {}
    if not force and changes.get("ai_summary"):
        return {"ai_summary": changes["ai_summary"], "cached": True}

    actor_name = None
    if log.user_id:
        u = db.query(GRCUser).filter(GRCUser.id == log.user_id).first()
        if u: actor_name = u.display_name

    result = generate_ai_summary(log, actor_name=actor_name)
    if result.get("ai_summary") and not result.get("fallback"):
        changes["ai_summary"] = result["ai_summary"]
        log.changes = changes
        flag_modified(log, "changes")
        db.commit()
    return result
```

### Step 3 — patch `backend/grc/main.py`

In the existing `audit_log_middleware`, between `try: response = await call_next(request)` and the `write_audit_log(...)` call, insert the response-body capture block. **Note:** if you've already integrated the CIS branch's `INTEGRATION_GUIDE.md`, this file has other changes too — apply both in the order they appear.

Diff:

```diff
 try:
     response = await call_next(request)
+    # Capture non-2xx JSON response bodies so AI summary can show
+    # the real failure reason. Cap at 16 KB.
+    response_error = None
+    try:
+        status = getattr(response, "status_code", 200)
+        ctype = response.headers.get("content-type", "").lower() if hasattr(response, "headers") else ""
+        if status >= 400 and "application/json" in ctype:
+            body_chunks = [chunk async for chunk in response.body_iterator]
+            joined = b"".join(body_chunks)
+            if len(joined) <= 16 * 1024:
+                try:
+                    response_error = _json.loads(joined.decode("utf-8"))
+                except Exception:
+                    response_error = {"raw": joined.decode("utf-8", errors="replace")[:2000]}
+            else:
+                response_error = {"truncated": True, "size": len(joined)}
+            response.body_iterator = iterate_in_threadpool(iter([joined]))
+    except Exception:
+        response_error = None
-    write_audit_log(request, response, started_at, request_payload)
+    write_audit_log(request, response, started_at, request_payload, response_error)
     return response
```

Then update `write_audit_log()` (in `audit_logger.py`) to accept `response_error` and stash it under `changes.response_error`.

### Step 4 — patch `backend/grc/modules/workflow_engine/services/trigger_dispatcher.py`

Two blocks:

**(a)** Add `_CANONICAL_RESOURCE_MAP` and `_resolve_canonical_resource()` at module top (just below `_MODULE_ALIASES`). Full contents in §1.5 above.

**(b)** In `_derive_event_names()`, after the existing module/entity derivation, add the v6 canonical event emission + nested sub-resource block. Full contents in §1.5 above.

### Step 5 — patch `backend/grc/modules/workflow_engine/services/action_handlers.py`

This is the biggest single file change. Copy whole-function:

- The routing block in `_execute_platform_capability_action` (the 3 new `if module_key == ...` branches).
- The new module handler methods `_execute_risk_action`, `_execute_compliance_action`, plus the sub-handlers for `compliance.evidence`, `compliance.control_library`, `compliance.controls`, `compliance.frameworks`, `compliance.evidence_requirements`.

The `_resolve_id` helper (with the resource_name fallback) is defined inline inside `_execute_risk_action` — copy as-is.

### Step 6 — patch `backend/grc/modules/workflow_engine/services/step_executor.py`

Two small edits: in the inline `send_in_app_alert` block and the inline `send_notification_email` block, the recipient lookup now also checks `config.payload.recipients`:

```python
recipients = (
    config.get("recipient_user_ids")
    or (config.get("payload") or {}).get("recipients")
    or []
)
```

### Step 7 — frontend

**(a)** `artifacts/grc-frontend/src/lib/api.ts`:

```ts
adminApi.generateAuditLogAiSummary = (logId: number, force = false) =>
  apiClient.post(`/admin/audit-logs/${logId}/ai-summary?force=${force}`, {});
//                                                                    ^^^
// must be {} not null — the express proxy hangs on null body otherwise
```

**(b)** `artifacts/grc-frontend/src/app/(dashboard)/admin/audit-logs/page.tsx`:

- Add `aiSummary` / `aiSummaryLoading` state hooks.
- Add the `useEffect` that auto-fetches when a row is selected.
- Render the AI block at the top of the modal with `<ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>`.
- Hide the raw "Request Data" section when `aiSummary` is set.

Dependencies needed (already present if the main repo has them):

```bash
pnpm add react-markdown remark-gfm
```

### Step 8 — express proxy

`artifacts/api-server/src/routes/proxy.ts`, in the catch-all `router.use` handler, the body forwarding must re-serialize when `req.body` is non-null (because body-parser already consumed the stream):

```ts
const hasBody = ["POST", "PUT", "PATCH"].includes(req.method.toUpperCase());
let body: Buffer | undefined;
if (hasBody) {
  if (req.body !== undefined && req.body !== null) {
    body = Buffer.from(JSON.stringify(req.body));
  } else {
    body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
}
```

The `else` branch (stream-read) is the existing path — the `if` branch is new and required for empty `{}` payloads from the new AI-summary endpoint.

### Step 9 — `OPENAI_API_KEY`

Set it in the backend `.env` (or wherever the main repo configures env vars). The code checks both `OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_API_KEY` — pick whichever your config standard uses.

### Step 10 — restart

```bash
# Backend
cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 5000

# Express proxy
cd artifacts/api-server && PORT=8080 BACKEND_URL=http://127.0.0.1:5000 node ./dist/index.mjs

# Frontend (Windows / git-bash careful — BASE_PATH gets mangled if you `export` it.
# Use cmd or wrap in quotes.)
cd artifacts/grc-frontend && PORT=20080 BASE_PATH=/ pnpm exec vite --host 0.0.0.0 --port 20080
```

---

## 6. Verification checklist

After integrating, run through this to confirm both feature areas work:

### 6.1 Workflow engine sanity

```sql
-- After creating a risk via UI (/erm/risks → Add Risk):
SELECT id, workflow_definition_id, trigger_event, status
FROM grc_workflow_instances
WHERE tenant_id = <your_tenant>
ORDER BY id DESC LIMIT 20;
```

Expected: a fan-out of ~13 instances with mixed `trigger_event` values including `risk.risk_register.create` and `risk_created`. Each should reach `status='completed'` (some `'waiting'` is fine — those have SLA timers).

Then check the actual DB writes:

```sql
SELECT id, title, treatment_plan, status FROM grc_risks WHERE id = <new_id>;
-- treatment_plan should be populated, not NULL

SELECT * FROM grc_risk_asset_links WHERE risk_id = <new_id>;
-- should have at least 1 row IF the tenant has any IT assets

SELECT * FROM grc_risk_control_links WHERE risk_id = <new_id>;
-- should have at least 1 row IF the tenant has any FrameworkControls
```

### 6.2 Audit log AI summaries

1. Navigate to `/admin/audit-logs` in the UI.
2. Click View on any row.
3. The modal should briefly show "Generating readable summary…" then render a markdown block:
   - First line: `### <Actor> <verb> <resource>`
   - `#### Details` with bullet list of facts
   - Optional `#### Steps`, `#### Flow`, `#### Field changes`, `#### Result`
4. Re-open the same row — should appear instantly (cached in `changes.ai_summary`).
5. Open a known-failure row (status 4xx/5xx) — the summary should include the `response_error` reason.

### 6.3 End-to-end cascade trace

Open audit log row for a risk-create. The modal's AI summary should:
- Name the actor, resource, action.
- Restate the request body fields (title, description, scores).
- Show the status code.

Then open a downstream workflow_engine audit row from the same timestamp — its AI summary should describe the workflow execution (which workflow definition, which steps ran).

---

## 7. Known limitations / gotchas

| Issue | Status | Workaround |
|---|---|---|
| Some sub-resource POSTs (e.g. KRI `measure` endpoint) still don't map to v6 catalog events. | Dispatcher gap | Add an entry to `_CANONICAL_RESOURCE_MAP` or extend the nested-path detector to cover the new action name. |
| Plugin scan rows from CIS Windows checks occasionally contain literal ` ` escapes (Windows registry values). | Tolerated by listing endpoint, but the JSONB cast still rejects them. | The endpoint no longer crashes. Run the sanitize script (§4) for clean JSONB queries elsewhere. |
| AI summaries depend on `OPENAI_API_KEY`. Without it, falls back to template summary. | Documented | Just set the key. |
| Each create-risk fan-out fires 13+ emails → noisy inbox. | Expected behaviour — it's a real cascade. | Use `grc_workflow_email_configs.disabled_for_workflows` JSON array per tenant to mute specific definition IDs. |
| `DISABLE_EMBEDDED_WORKFLOW_RUNTIME` not set → runtime starts twice if you also run a separate `workflow_watcher` process. | Documented | Set the env var in production. |
| Coverage validated via UI testing today: **80 of 163 workflow defs exercised (~49%), 215 instances fired across 9 modules.** | The other 83 workflows weren't exercised because the UI doesn't surface trigger actions for them (e.g. compliance.statements.assess, vendor questionnaire submit, audit_finding lifecycle). Handlers exist but need UI surface or external API triggers. | Either add UI surface or invoke them via direct workflow trigger endpoint (`POST /grc/workflow-engine/executions/trigger`). |

---

## 8. File path quick reference

```
backend/
├── grc/
│   ├── audit_ai_summary.py                                       ← NEW
│   ├── main.py                                                   ← MODIFIED (middleware)
│   ├── routers/
│   │   └── admin_router.py                                       ← MODIFIED (endpoint + filter)
│   └── modules/
│       └── workflow_engine/
│           └── services/
│               ├── action_handlers.py                            ← MODIFIED (+1500 LOC handlers)
│               ├── trigger_dispatcher.py                         ← MODIFIED (canonical map)
│               └── step_executor.py                              ← MODIFIED (recipient fix)
artifacts/
├── grc-frontend/
│   └── src/
│       ├── app/(dashboard)/admin/audit-logs/page.tsx             ← MODIFIED (modal markdown)
│       └── lib/api.ts                                            ← MODIFIED (new method)
└── api-server/
    └── src/routes/proxy.ts                                       ← MODIFIED (body fix)
scripts_backfill_ai_summaries.py                                  ← NEW (optional)
```

---

## 9. Common integration questions

- **"Why isn't my workflow firing for `/path/{id}/sub`?"** → check `_CANONICAL_RESOURCE_MAP` and the nested-path handler in `_derive_event_names`. Add a mapping or extend the detector.
- **"Why does my handler return `risk_id: null`?"** → `_resolve_id`'s fallback only covers a handful of entity types. Add a branch for yours, mirroring the existing Risk/KRI/InternalControl/etc lookups.
- **"Why is the AI summary blank in the modal?"** → check `OPENAI_API_KEY` env var, then check the network tab for the `POST /admin/audit-logs/{id}/ai-summary` response — `fallback: true` means OpenAI rejected the call.
- **"Why is my audit-log list returning 500?"** → there's a row with corrupt JSON (` ` escape). The new filter avoids `CAST(JSONB)` but if anything else still casts, that'll crash. Run the sanitize script.
- **"Why is email going to the wrong recipient?"** → the workflow node's `config.payload.recipients` is the source of truth now, not the legacy `config.recipient_user_ids`. Confirm `step_executor.py` has the OR-combined recipient lookup.

---

End of guide.
