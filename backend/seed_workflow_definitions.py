"""
Seed the 10 default workflow definitions per INTEGRATION_GUIDE.md § 9.
Run from backend/ directory:  python seed_workflow_definitions.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./grc_app.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
Session = sessionmaker(bind=engine)
db = Session()

from grc.models import WorkflowDefinition, WorkflowNode, WorkflowEdge, GRCUser, TenantUser

# ── resolve tenant id and a recipient user ────────────────────────────────────
tenant_user = db.query(TenantUser).first()
if not tenant_user:
    print("ERROR: No tenant users found in database. Please ensure a tenant exists.")
    db.close()
    sys.exit(1)

TENANT_ID = tenant_user.tenant_id

# Find first user for this tenant
first_user = db.query(GRCUser).join(
    TenantUser, TenantUser.user_id == GRCUser.id
).filter(TenantUser.tenant_id == TENANT_ID).first()

RECIPIENT_USER_ID = first_user.id if first_user else 1
RECIPIENT_EMAIL = first_user.email if first_user else "admin@example.com"

print(f"Seeding workflows for tenant_id={TENANT_ID}, recipient_user_id={RECIPIENT_USER_ID}, email={RECIPIENT_EMAIL}")

# ── workflow definitions to seed ──────────────────────────────────────────────
WORKFLOWS = [
    {"name": "risk_creation",              "trigger": "risk_created"},
    {"name": "anomaly creation",           "trigger": "vulnerability_created"},
    {"name": "risk_updated",               "trigger": "risk_updated"},
    {"name": "risk_deleted",               "trigger": "risk_deleted"},
    {"name": "vulnerability_updated",      "trigger": "vulnerability_updated"},
    {"name": "vulnerability_deleted",      "trigger": "vulnerability_deleted"},
    {"name": "policy_submitted_for_review","trigger": "policy_submitted_for_review"},
    {"name": "asset_created",              "trigger": "asset_created"},
    {"name": "asset_updated",              "trigger": "asset_updated"},
    {"name": "asset_deleted",              "trigger": "asset_deleted"},
]

seeded = 0
skipped = 0

for wf in WORKFLOWS:
    trigger = wf["trigger"]
    name = wf["name"]

    # Check if already seeded (by trigger_event + tenant_id)
    existing = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.tenant_id == TENANT_ID,
        WorkflowDefinition.trigger_event == trigger,
    ).first()
    if existing:
        print(f"  SKIP  {name!r:35s}  (trigger={trigger!r} already exists, id={existing.id})")
        skipped += 1
        continue

    email_node_key = f"send_email_{trigger}"
    alert_node_key = f"send_alert_{trigger}"

    email_cfg = {
        "action_name": "send_notification_email",
        "payload": {},
        "module": "Workflow Engine",
        "domains": ["shared"],
        "to": [RECIPIENT_EMAIL],
        "recipient_user_ids": [RECIPIENT_USER_ID],
        "subject": f"[{trigger}] {{{{title}}}}",
        "body": (
            f"Event: {trigger}\n\n"
            "Title: {{title}}\nStatus: {{status}}\nBy: {{created_by_name}}"
        ),
    }

    alert_cfg = {
        "action_name": "send_in_app_alert",
        "payload": {},
        "module": "Workflow Engine",
        "domains": ["shared"],
        "recipient_user_ids": [RECIPIENT_USER_ID],
        "alert_type": "info",
        "subject": trigger,
        "message": "{{title}} \u2014 {{status}}",
    }

    defn = WorkflowDefinition(
        tenant_id=TENANT_ID,
        name=name,
        trigger_event=trigger,
        is_active=True,
        description=f"Auto-fires on {trigger}",
        trigger_conditions={},
        definition_json={},
    )
    db.add(defn)
    db.flush()
    defn_id = defn.id

    nodes = [
        WorkflowNode(
            workflow_definition_id=defn_id,
            node_key="start",
            node_type="start",
            name="Start",
            is_start=True,
            is_terminal=False,
            config={"trigger_type": trigger, "module": "GRC", "domains": ["shared"]},
            position_x=350,
            position_y=30,
        ),
        WorkflowNode(
            workflow_definition_id=defn_id,
            node_key=email_node_key,
            node_type="action",
            name="Send Email",
            is_start=False,
            is_terminal=False,
            config=email_cfg,
            position_x=350,
            position_y=160,
        ),
        WorkflowNode(
            workflow_definition_id=defn_id,
            node_key=alert_node_key,
            node_type="action",
            name="In-App Alert",
            is_start=False,
            is_terminal=False,
            config=alert_cfg,
            position_x=350,
            position_y=290,
        ),
        WorkflowNode(
            workflow_definition_id=defn_id,
            node_key="end",
            node_type="end",
            name="End",
            is_start=False,
            is_terminal=True,
            config={"module": "Workflow Engine", "domains": ["workflow"]},
            position_x=350,
            position_y=420,
        ),
    ]
    db.add_all(nodes)
    db.flush()

    edges = [
        WorkflowEdge(
            workflow_definition_id=defn_id,
            source_node_key="start",
            target_node_key=email_node_key,
            condition={},
            priority=1,
        ),
        WorkflowEdge(
            workflow_definition_id=defn_id,
            source_node_key=email_node_key,
            target_node_key=alert_node_key,
            condition={},
            priority=1,
        ),
        WorkflowEdge(
            workflow_definition_id=defn_id,
            source_node_key=alert_node_key,
            target_node_key="end",
            condition={},
            priority=1,
        ),
    ]
    db.add_all(edges)
    db.commit()

    print(f"  SEEDED {name!r:35s}  trigger={trigger!r}  id={defn_id}")
    seeded += 1

print(f"\nDone. Seeded={seeded}  Skipped={skipped}")
db.close()
