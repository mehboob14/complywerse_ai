"""
Seed Templates modal with a curated catalog of 35 GRC workflows.

Per Task #51, each workflow must be stored TWO ways:
  1. As a reusable Template row (`grc_workflow_engine_templates`,
     is_system_template=True) — appears in the Templates modal.
  2. As a live Workflow Definition (`grc_workflow_definitions`,
     is_active=True) — appears in "Saved Workflows".

Strategy:
  - The platform already has 128 hand-curated, validated workflow
    DEFINITIONS (see scripts/seed_workflows.py + replit.md catalog notes).
  - For each entry in CATALOG below, we:
      a) Look up its source definition by NAME (stable key — no
         hardcoded IDs that drift across environments).
      b) Build a clean nodes/edges payload from that definition.
      c) POST /workflow-engine/templates  → creates the template row
         (uses the real API, full Pydantic validation runs).
      d) POST /workflow-engine/templates/{id}/instantiate  → creates a
         live definition copy named "<Template> (Template Instance)".
      e) GET  /workflow-engine/definitions/{id}  → re-fetch and assert
         node/edge counts + trigger_event match.
  - Fail-fast: any missing source, validation error, or post-fetch
    mismatch aborts the run with a non-zero exit. No silent skips.
  - Idempotent: skips a CATALOG row if a template with that exact
    name already exists for tenant 1 (re-runs after a partial run
    are safe and converge).

==============================================================================
CATALOG SUMMARY — 35 system templates across 11 categories
==============================================================================
| Category                  | Template Name                                      | Trigger                             |
|---------------------------|----------------------------------------------------|-------------------------------------|
| Compliance                | Framework Assessment Kick-Off                      | compliance.assessments.create       |
| Compliance                | Framework Document Parsing Pipeline                | compliance.evidence.create          |
| Compliance                | Evidence Upload → AI Assessment                    | compliance.evidence.update          |
| Compliance                | Evidence Renewal Workflow                          | compliance.evidence.update          |
| Compliance                | Framework Publishing Approval                      | compliance.frameworks.update        |
| Evidence                  | Bulk Evidence AI Review                            | compliance.evidence.create          |
| Evidence                  | Evidence Staleness Check (90 days)                 | compliance.evidence.create          |
| Evidence                  | Audit Package Finalization                         | compliance.evidence.create          |
| Risk Management           | New Risk → AI Suggestions                          | risk.risk_register.create           |
| Risk Management           | Risk Register: Severity-Based Routing              | risk.risk_register.create           |
| Risk Management           | Risk Acceptance Approval Gate                      | risk.risk_register.update           |
| Risk Management           | AI Treatment Plan Generation                       | risk.risk_register.create           |
| Risk Management           | Risk Treatment Plan SLA Reminder (72h)             | risk.risk_register.create           |
| Incident Response         | Incident Severity Routing                          | risk.incidents.create               |
| Incident Response         | Incident Closure Approval                          | risk.incidents.delete               |
| Incident Response         | Vendor Incident Logged                             | risk.vendor_risk.create             |
| Vulnerability Management  | Vulnerability: Critical/High Escalation            | vulnmgmt.vulnerabilities.create     |
| Vulnerability Management  | Vulnerability SLA Warning (24h before breach)      | vulnmgmt.vulnerabilities.update     |
| Vulnerability Management  | Vulnerability Report → AI Analysis & Fix           | vulnmgmt.reports.create             |
| Vulnerability Management  | Vulnerability Exception Approval                   | vulnmgmt.vulnerabilities.create     |
| Policy / Governance       | Policy Document Approval Workflow                  | governance.documents.trigger        |
| Policy / Governance       | Annual Policy Review Reminder                      | governance.documents.trigger        |
| Policy / Governance       | Attestation Campaign Launch                        | governance.attestations.create      |
| Policy / Governance       | Attestation Reminder & Escalation                  | governance.attestations.create      |
| Vendor Onboarding         | Vendor Onboarding                                  | risk.vendor_risk.create             |
| Vendor Onboarding         | Vendor Assessment Approval                         | risk.vendor_risk.update             |
| Vendor Onboarding         | Vendor SLA Tracking                                | risk.vendor_risk.create             |
| Audit                     | RCSA Finding → Risk + Mitigation                   | risk.rcsa.create                    |
| Audit                     | Audit Finding to Risk                              | risk.risk_register.create           |
| Access Review             | Bulk Attestation-Evidence Linking                  | governance.attestations.create      |
| Asset Management          | Risk-Asset Linking                                 | risk.risk_register.create           |
| Asset Management          | Vulnerability-Asset Linking                        | vulnmgmt.vulnerabilities.create     |
| Scheduled Operations      | Bulk Risk Review Scheduling                        | risk.reviews.create                 |
| Scheduled Operations      | Bulk Vulnerability Assignment                      | vulnmgmt.departments.create         |
| Scheduled Operations      | KRI Threshold Breach Routing                       | risk.kris.update                    |
==============================================================================

Usage:
    python3 scripts/seed_workflow_templates.py
"""
from __future__ import annotations

import os
import sys
from typing import Any

import psycopg2
import requests

BASE = os.environ.get("GRC_BASE_URL", "http://localhost:5000/grc")
DB_URL = os.environ["DATABASE_URL"]
TENANT_ID = 1
INSTANCE_SUFFIX = " (Template Instance)"
EMAIL = os.environ.get("GRC_SEED_EMAIL", "info@layeron.com")
PASSWORD = os.environ.get("GRC_SEED_PASSWORD", "TestE2E!2026")

session = requests.Session()


# (source_definition_name, template_name, category, description)
CATALOG: list[tuple[str, str, str, str]] = [
    ("Framework Assessment Kick-Off",                   "Framework Assessment Kick-Off",            "Compliance",              "Spin up assessment scaffolding and notify owners when a framework assessment is created."),
    ("Framework Document Parsing Pipeline",             "Framework Document Parsing Pipeline",      "Compliance",              "Parse uploaded framework PDFs, extract controls, and queue for AI mapping."),
    ("Evidence Upload → AI Assessment",                 "Evidence Upload → AI Assessment",          "Compliance",              "Auto-route freshly uploaded evidence through the AI compliance assessor."),
    ("Evidence Renewal Workflow",                       "Evidence Renewal Workflow",                "Compliance",              "Detect expiring evidence and reopen the renewal request to the owner."),
    ("Framework Publishing Approval",                   "Framework Publishing Approval",            "Compliance",              "Multi-level review gate before a draft framework becomes live to all tenants."),
    ("Bulk Evidence AI Review",                         "Bulk Evidence AI Review",                  "Evidence",                "Batch-process newly uploaded evidence with the AI reviewer + notify approvers."),
    ("Evidence Staleness Check (90 days)",              "Evidence Staleness Check (90 days)",       "Evidence",                "Flag evidence older than 90 days and request a refreshed copy."),
    ("Audit Package Finalization",                      "Audit Package Finalization",               "Evidence",                "Bundle approved evidence into an audit-ready package and notify the audit lead."),
    ("New Risk → AI Suggestions",                       "New Risk → AI Suggestions",                "Risk Management",         "When a new risk is logged, generate AI-suggested mitigations and assign an owner."),
    ("Risk Register: Severity-Based Routing",           "Risk Register: Severity-Based Routing",    "Risk Management",         "Route freshly created risks based on severity score (escalate critical, queue medium/low)."),
    ("Risk Acceptance Approval Gate",                   "Risk Acceptance Approval Gate",            "Risk Management",         "Manager + executive approval before a risk can be marked accepted."),
    ("AI Treatment Plan Generation",                    "AI Treatment Plan Generation",             "Risk Management",         "Generate a draft risk-treatment plan via AI as soon as a risk is created."),
    ("Risk Treatment Plan SLA Reminder (72h)",          "Risk Treatment Plan SLA Reminder (72h)",   "Risk Management",         "Wait 72h after risk creation; escalate if no treatment plan has been drafted."),
    ("Incident Severity Routing",                       "Incident Severity Routing",                "Incident Response",       "Route reported incidents based on severity; escalate critical/high to management."),
    ("Incident Closure Approval",                       "Incident Closure Approval",                "Incident Response",       "Manager approval gate before a security/risk incident can be closed out."),
    ("Vendor Incident Logged",                          "Vendor Incident Logged",                   "Incident Response",       "Notify vendor-risk team and trigger investigation when a vendor incident is filed."),
    ("Vulnerability: Critical/High Escalation",         "Vulnerability: Critical/High Escalation",  "Vulnerability Management","Auto-escalate critical/high CVSS findings to the security team within 1 hour."),
    ("Vulnerability SLA Warning (24h before breach)",   "Vulnerability SLA Warning (24h before breach)", "Vulnerability Management", "Send SLA-breach warning 24h before a vulnerability remediation deadline."),
    ("Vulnerability Report → AI Analysis & Fix",        "Vulnerability Report → AI Analysis & Fix", "Vulnerability Management","Run AI fix-suggestion analysis when a new vulnerability scan report is uploaded."),
    ("Vulnerability Exception Approval",                "Vulnerability Exception Approval",         "Vulnerability Management","Request a multi-level approval for a vulnerability remediation exception."),
    ("Policy Document Approval Workflow",               "Policy Document Approval Workflow",        "Policy / Governance",     "Multi-stage review (Author → Legal → CISO) when a policy is submitted for review."),
    ("Annual Policy Review Reminder",                   "Annual Policy Review Reminder",            "Policy / Governance",     "Notify policy owners on schedule that an annual review is due."),
    ("Attestation Campaign Launch",                     "Attestation Campaign Launch",              "Policy / Governance",     "Send attestation requests to all in-scope users when a campaign is created."),
    ("Attestation Reminder & Escalation",               "Attestation Reminder & Escalation",        "Policy / Governance",     "Remind unacknowledged attestations and escalate to the manager if overdue."),
    ("Vendor Onboarding",                               "Vendor Onboarding",                        "Vendor Onboarding",       "Risk profile, document request, and risk-based approval routing for a new vendor."),
    ("Vendor Assessment Approval",                      "Vendor Assessment Approval",               "Vendor Onboarding",       "Approval gate after a vendor risk assessment is updated."),
    ("Vendor SLA Tracking",                             "Vendor SLA Tracking",                      "Vendor Onboarding",       "Open SLA monitoring tasks when a new vendor is created."),
    ("RCSA Finding → Risk + Mitigation",                "RCSA Finding → Risk + Mitigation",         "Audit",                   "Convert an RCSA finding into a risk-register entry and queue the mitigation owner."),
    ("Audit Finding to Risk",                           "Audit Finding to Risk",                    "Audit",                   "Promote a recorded audit finding into the risk register with owner assignment."),
    ("Bulk Attestation-Evidence Linking",               "Bulk Attestation-Evidence Linking",        "Access Review",           "Bulk link evidence to a quarterly access-review attestation campaign."),
    ("Risk-Asset Linking",                              "Risk-Asset Linking",                       "Asset Management",        "Auto-link a newly created risk to its impacted IT assets."),
    ("Vulnerability-Asset Linking",                     "Vulnerability-Asset Linking",              "Asset Management",        "Auto-link new vulnerabilities to their affected assets and notify asset owners."),
    ("Bulk Risk Review Scheduling",                     "Bulk Risk Review Scheduling",              "Scheduled Operations",    "Schedule recurring risk reviews in bulk for the upcoming review cycle."),
    ("Bulk Vulnerability Assignment",                   "Bulk Vulnerability Assignment",            "Scheduled Operations",    "Bulk assign open vulnerabilities to a department's owners on a scheduled cadence."),
    ("KRI Threshold Breach Routing",                    "KRI Threshold Breach Routing",             "Scheduled Operations",    "Polled KRI breaches route to the right owner with severity-based escalation."),
]


def fail(msg: str) -> None:
    print(f"\n[FATAL] {msg}", file=sys.stderr)
    sys.exit(1)


def login() -> None:
    r = session.post(f"{BASE}/auth/login", json={"username": EMAIL, "password": PASSWORD}, timeout=15)
    if not r.ok:
        fail(f"login failed: HTTP {r.status_code}: {r.text[:300]}")
    print(f"[auth] logged in as {EMAIL}")


def list_definitions() -> dict[str, dict]:
    """Return {name: definition_dict} for current tenant — name is the stable key."""
    r = session.get(f"{BASE}/workflow-engine/definitions", timeout=30)
    if not r.ok:
        fail(f"list definitions failed: HTTP {r.status_code}: {r.text[:300]}")
    out: dict[str, dict] = {}
    for d in r.json():
        n = d.get("name")
        if n and n not in out:  # first wins; v6 catalog has unique names
            out[n] = d
    return out


def list_templates() -> dict[str, dict]:
    r = session.get(f"{BASE}/workflow-engine/templates", timeout=30)
    if not r.ok:
        fail(f"list templates failed: HTTP {r.status_code}: {r.text[:300]}")
    return {t["name"]: t for t in r.json() if t.get("name")}


def mark_system_template(template_id: int) -> None:
    """`is_system_template` is not exposed on the create API, so flip it
    directly after creation. Minimal, scoped, single-row update."""
    with psycopg2.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE grc_workflow_engine_templates "
                "SET is_system_template=TRUE WHERE id=%s AND tenant_id=%s",
                (template_id, TENANT_ID),
            )
            if cur.rowcount != 1:
                fail(f"failed to flag template #{template_id} as is_system_template (rowcount={cur.rowcount})")
        conn.commit()


def fetch_definition(def_id: int) -> dict:
    r = session.get(f"{BASE}/workflow-engine/definitions/{def_id}", timeout=15)
    if not r.ok:
        fail(f"fetch definition {def_id} failed: HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def _normalize_node(n: dict) -> dict:
    """Strip server-only fields; keep what the templates create-endpoint accepts."""
    return {
        "node_key": n["node_key"],
        "node_type": n.get("node_type") or "action",
        "name": n.get("name") or n["node_key"],
        "config": n.get("config") or {},
        "position_x": float(n.get("position_x", 0) or 0),
        "position_y": float(n.get("position_y", 0) or 0),
        "is_start": bool(n.get("is_start")),
        "is_terminal": bool(n.get("is_terminal")),
    }


def _normalize_edge(e: dict) -> dict:
    return {
        "source_node_key": e["source_node_key"],
        "target_node_key": e["target_node_key"],
        "condition": e.get("condition") or {},
        "priority": int(e.get("priority", 100) or 100),
    }


def create_template(payload: dict) -> dict:
    r = session.post(f"{BASE}/workflow-engine/templates", json=payload, timeout=30)
    if not r.ok:
        fail(f"create template '{payload.get('name')}' failed: HTTP {r.status_code}: {r.text[:500]}")
    return r.json()


def instantiate_template(template_id: int, instance_name: str) -> dict:
    r = session.post(
        f"{BASE}/workflow-engine/templates/{template_id}/instantiate",
        params={"name": instance_name},
        timeout=30,
    )
    if not r.ok:
        fail(f"instantiate template {template_id} failed: HTTP {r.status_code}: {r.text[:500]}")
    return r.json()


def validate_definition(def_id: int, expected_trigger: str, expected_nodes: int, expected_edges: int, ctx: str) -> None:
    d = fetch_definition(def_id)
    actual_trigger = d.get("trigger_event")
    nodes = d.get("nodes") or []
    edges = d.get("edges") or []
    if actual_trigger != expected_trigger:
        fail(f"{ctx}: trigger_event mismatch — expected '{expected_trigger}', got '{actual_trigger}'")
    if len(nodes) != expected_nodes:
        fail(f"{ctx}: node count mismatch — expected {expected_nodes}, got {len(nodes)}")
    if len(edges) != expected_edges:
        fail(f"{ctx}: edge count mismatch — expected {expected_edges}, got {len(edges)}")


def main() -> int:
    print(f"[seed-templates] catalog size = {len(CATALOG)}")
    if len(CATALOG) != 35:
        fail(f"CATALOG must have exactly 35 entries, found {len(CATALOG)}")

    login()
    defs_by_name = list_definitions()
    print(f"[seed-templates] {len(defs_by_name)} source definitions discovered")

    existing_templates = list_templates()
    print(f"[seed-templates] {len(existing_templates)} templates already exist")

    # Pre-flight: every CATALOG source must resolve to a real definition.
    missing = [src for src, _, _, _ in CATALOG if src not in defs_by_name]
    if missing:
        fail("missing source definitions (re-run scripts/seed_workflows.py first):\n  - " + "\n  - ".join(missing))
    print("[seed-templates] pre-flight ok — all 35 source definitions exist")

    inserted = backfilled = skipped_complete = 0

    for src_name, tpl_name, category, description in CATALOG:
        instance_name = f"{tpl_name}{INSTANCE_SUFFIX}"

        # Idempotency that protects the two-way invariant: if the template
        # exists but the instantiated live def is missing (e.g. previous run
        # crashed between create + instantiate), backfill the missing copy.
        if tpl_name in existing_templates:
            tpl = existing_templates[tpl_name]
            tpl_id = int(tpl["id"])
            mark_system_template(tpl_id)  # idempotent flag — re-runs heal pre-existing rows
            if instance_name in defs_by_name:
                skipped_complete += 1
                print(f"  [skip-complete] {tpl_name} (template #{tpl_id} + instance present)")
                continue
            print(f"  [backfill] {tpl_name} — template #{tpl_id} exists but instance missing")
            instance = instantiate_template(tpl_id, instance_name)
            new_def_id = int(instance["workflow_definition_id"])
            src_def = fetch_definition(int(defs_by_name[src_name]["id"]))
            validate_definition(
                new_def_id,
                expected_trigger=src_def.get("trigger_event"),
                expected_nodes=len(src_def.get("nodes") or []),
                expected_edges=len(src_def.get("edges") or []),
                ctx=f"backfilled instance def {new_def_id} for template '{tpl_name}'",
            )
            backfilled += 1
            print(f"  [ok] {category:25s} {tpl_name}  (backfilled live def #{new_def_id})")
            continue

        src_def_summary = defs_by_name[src_name]
        src_def = fetch_definition(int(src_def_summary["id"]))

        nodes = [_normalize_node(n) for n in (src_def.get("nodes") or [])]
        edges = [_normalize_edge(e) for e in (src_def.get("edges") or [])]
        trigger_event = src_def.get("trigger_event")
        if not trigger_event:
            fail(f"source definition '{src_name}' has empty trigger_event")
        if not nodes:
            fail(f"source definition '{src_name}' has no nodes")

        tpl_payload = {
            "name": tpl_name,
            "description": description,
            "category": category,
            "trigger_event": trigger_event,
            "trigger_conditions": src_def.get("trigger_conditions") or {},
            "definition_json": src_def.get("definition_json") or {},
            "nodes_json": nodes,
            "edges_json": edges,
            "tags": [category.lower().replace(" ", "-"), "system"],
        }
        tpl = create_template(tpl_payload)
        tpl_id = int(tpl["id"])
        mark_system_template(tpl_id)

        instance = instantiate_template(tpl_id, instance_name)
        new_def_id = int(instance["workflow_definition_id"])

        # Strict post-create validation — fail-fast if drift detected.
        validate_definition(
            new_def_id,
            expected_trigger=trigger_event,
            expected_nodes=len(nodes),
            expected_edges=len(edges),
            ctx=f"instantiated def {new_def_id} from template '{tpl_name}'",
        )

        inserted += 1
        print(f"  [ok] {category:25s} {tpl_name}  (template #{tpl_id} → live def #{new_def_id}, {len(nodes)} nodes / {len(edges)} edges)")

    # Summary
    print()
    print(f"[seed-templates] DONE — inserted={inserted}, backfilled-instances={backfilled}, skipped-complete={skipped_complete}")

    # Final acceptance check: every CATALOG entry must have BOTH a system
    # template AND its live instance present. Else fail.
    final_templates = list_templates()
    final_defs = list_definitions()
    integrity_errors: list[str] = []
    sys_count = 0
    by_cat: dict[str, int] = {}
    for src_name, tpl_name, category, _desc in CATALOG:
        instance_name = f"{tpl_name}{INSTANCE_SUFFIX}"
        if tpl_name not in final_templates:
            integrity_errors.append(f"missing template: {tpl_name}")
            continue
        tpl = final_templates[tpl_name]
        if not tpl.get("is_system_template"):
            integrity_errors.append(f"template '{tpl_name}' is_system_template=False (must be True)")
        else:
            sys_count += 1
        if instance_name not in final_defs:
            integrity_errors.append(f"missing live instance for: {tpl_name}")
        by_cat[category] = by_cat.get(category, 0) + 1
    if integrity_errors:
        fail("acceptance check failed:\n  - " + "\n  - ".join(integrity_errors))

    print(f"[seed-templates] acceptance ok — {sys_count}/35 catalog templates flagged is_system_template=True with matching live instances")
    print(f"[seed-templates] catalog category distribution:")
    for cat, cnt in sorted(by_cat.items()):
        print(f"  {cat:30s} {cnt}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
