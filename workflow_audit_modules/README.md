# Workflow Engine + Audit Log Bundle

Every file that touches the workflow engine and the audit log, from dawn to dusk.
This is a code bundle for review, not a runnable package. Drop each file back into
the corresponding path in your main repo to apply.

## Tree

```
backend/grc/
  audit_logger.py              HTTP-middleware audit writer (resource_type, action, summary)
  audit_ai_summary.py          OpenAI on-demand summary generator (system prompt + caller)
  rich_audit.py                Handler-level audit writer with before/after diff + actor context
  main.py                      FastAPI app entrypoint, wires the audit middleware
  seed_workflow_engine_defaults.py    Per-tenant 10 default workflow templates
  seed_vuln_workflows.py              Vulnerability-domain workflow seeds
  routers/admin_router.py             /admin/audit-logs endpoints + force-regen AI summary
  modules/workflow_engine/
    router.py                  Module router that mounts sub-routers
    schemas.py                 Pydantic models for definitions, instances, steps, webhooks
    node_types.py              Built-in node type enum + metadata
    INTEGRATION_GUIDE.md       Plain-English overview of how nodes flow at runtime
    WORKFLOW_RUNTIME_FLOW.md   Sequence diagram for trigger → dispatch → execution
    routers/
      ai.py                    /workflow-engine/ai/* — natural-language workflow builder
      analytics.py             Counters, recent runs, failure breakdown
      catalog.py               Node catalog, actors, event types, modules
      definitions.py           CRUD on workflow definitions
      events.py                Event firing endpoints (manual + webhook ingest)
      executions.py            Run a workflow, list instances, approve / reject pending steps
      integrations.py          Schedules + webhooks (inbound triggers)
      notifications.py         In-app notification feed for workflow output
      templates.py             Template library import / export
    services/
      runtime.py               Instance lifecycle: queue, advance, terminate, write_lifecycle_log
      step_executor.py         Per-node execution incl. _build_node_meta (description, path, module)
      action_handlers.py       Platform action dispatchers (risk, evidence, vendor, etc.)
      catalog.py               PLATFORM_FUNCTION_NODE_TYPES + manual node entries
      condition_evaluator.py   Expression DSL evaluator for condition nodes
      definition_versions.py   Version history snapshots
      email_service.py         SMTP send wrapper (per-tenant config)
      event_queue.py           In-process event queue + claim semantics
      node_catalog_generator.py    Builds catalog JSON from platform-capabilities.json
      notification_service.py  Email + in-app notification orchestration
      state_machine.py         Step status transitions
      timer_service.py         Polls timer + waiting steps for due transitions
      trigger_dispatcher.py    Audit-log → workflow-instance fan-out (debounce, idempotency)

frontend/src/
  app/(dashboard)/
    workflow-engine/
      page.tsx                 Editor page (canvas, palette, AI panel, approvals tab, history)
      components/
        AIPanel.tsx            Natural-language workflow generator
        AnalyticsTab.tsx       Instance counters + run history charts
        ApprovalsTab.tsx       Pending step queue, approve / reject UI
        ConfigPanel.tsx        Per-node config form (right rail)
        CustomNodes.tsx        React Flow node renderers
        NodePalette.tsx        Left-rail draggable catalog
        SchedulesTab.tsx       Schedules + webhooks management
        TemplatesModal.tsx     Workflow template picker
        Tooltip.tsx            Shared tooltip primitive
        TopToolbar.tsx         Save, run, version, validate
        VersionDrawer.tsx      Version history side panel
        types.ts               Shared types incl. formatNodeLabel + PALETTE_DESCRIPTIONS
    admin/audit-logs/
      page.tsx                 Audit log table + filters + detail modal + AI summary panel
  components/WorkflowBuilder.tsx     Legacy builder reused by template picker
  lib/workflowEngineApi.ts           Typed API client for all workflow endpoints

scripts/
  seed_workflows.py            Builds Pattern-B v6 catalog (~128 workflows) per tenant
  seed_workflow_templates.py   Imports community workflow templates
  fix_workflow_gaps.py         One-shot repair of stale instances and orphaned steps
  workflow_validator.py        Lint-style structural check for definitions
  test_all_workflows.py        Triggers every active workflow against synthetic data
  audit_workflow_health.py     Diagnoses queued, stuck, or failed runs
  backfill_ai_summaries.py     Re-generate AI summaries for legacy audit rows
  sanitize_audit_nul_escapes.py    Clean NUL byte escapes that broke older rows
```

## Cross-references

- The audit middleware in `audit_logger.py` is mounted from `main.py` via
  `app.middleware("http")`. Without that wire-up the rest of the audit code
  never fires.
- `rich_audit.py` is called from every route handler that performs a real
  CRUD mutation. It uses `workflow_actor_context()` so workflow-engine
  callbacks self-identify in the row.
- `audit_ai_summary.py` is invoked from `admin_router.py` when the user
  clicks "Generate AI summary" on a row. It caches the result inside
  `changes.ai_summary` so re-opens return instantly.
- `step_executor.py::_build_node_meta` writes `node_meta` into every step's
  `output_payload`. `runtime.py::_write_instance_lifecycle_log` snapshots
  those into the workflow_engine audit row's `changes.after.steps`. That's
  what the AI summary's "Steps" section reads.

## Known issues from the latest audit

1. Double-logging: middleware + rich_audit fire for the same request.
2. Resource-type duplicates: `risks` vs `risk`, `kris` vs `kri`, etc.
3. URL-fragment resource_types leak in (`dashboard`, `connect-wizard`, `ai`).
4. AI summary is on-demand, not auto, so most rows never get one.
5. Reads dominate the table even with the "Hide system reads" toggle.

See the latest in-chat findings for row IDs and the proposed fix order.
