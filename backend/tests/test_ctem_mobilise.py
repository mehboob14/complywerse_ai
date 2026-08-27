"""CTEM in-platform mobilise — hermetic.

Assigning a dangerous finding must: stamp an owner, create a recommended
plan (so the mobilised counter sees it), open a workflow approval, and stay
idempotent. Approving the task advances the plan to `approved`, NEVER
`verified` — that stays the scanner path.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    ApprovalRequest, CtemScope, GRCUser, ITAsset, Vulnerability,
    VulnerabilityAssetLink, VulnRemediationPlan, WorkflowAuditLog,
    WorkflowDefinition, WorkflowEngineStep, WorkflowInstance,
    WorkflowNotification,
)
from grc.services import ctem_mobilise as mob

TENANT = 1


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://")
    for m in (
        GRCUser, ITAsset, Vulnerability, VulnerabilityAssetLink, CtemScope,
        VulnRemediationPlan, WorkflowDefinition, WorkflowInstance,
        WorkflowEngineStep, ApprovalRequest, WorkflowAuditLog, WorkflowNotification,
    ):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    monkeypatch.setattr(mob, "_notify", lambda *a, **k: None)
    _seed(s)
    yield s
    s.close()


def _seed(db):
    db.add_all([
        GRCUser(id=7, username="owner", email="owner@t.test", display_name="Owner", is_active=True),
        GRCUser(id=8, username="fixer", email="fixer@t.test", display_name="Fixer", is_active=True),
        GRCUser(id=9, username="boss", email="boss@t.test", display_name="Boss", is_active=True),
        ITAsset(id=1, tenant_id=TENANT, name="pay-1", asset_type="server", status="active"),
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="V-10", title="SQL injection",
                      severity="high", status="open"),
        VulnerabilityAssetLink(vulnerability_id=10, asset_id=1),
        CtemScope(id=3, tenant_id=TENANT, name="Payments",
                  membership_rule={"asset_ids": [1]}, created_by=7),
    ])
    db.commit()


def _scope(db):
    return db.query(CtemScope).get(3)


def test_mobilise_assigns_creates_plan_and_approval(db):
    scope = _scope(db)
    r = mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, approver_user_id=9, actor_user_id=7,
    )
    db.commit()
    assert r["created"] is True
    assert r["approval_request_id"]
    vuln = db.query(Vulnerability).get(10)
    assert vuln.assigned_to == 8
    assert vuln.status == "in_progress"
    plan = db.query(VulnRemediationPlan).one()
    assert plan.status == "recommended"
    assert plan.source == "workflow"
    inst = db.query(WorkflowInstance).one()
    assert inst.status == "running"
    assert inst.trigger_event == mob.TRIGGER
    appr = db.query(ApprovalRequest).one()
    assert appr.status == "pending"
    assert appr.approver_user_id == 9
    assert (appr.request_metadata or {}).get("kind") == mob.KIND


def test_mobilise_without_approver_creates_no_approval(db):
    # DEFAULT flow: Assign fix = pick ONE responsible person. With no approver the
    # assignment stands on its own — owner stamp + recommended plan + in_progress +
    # a workflow TASK owned by the fixer — and NO approval is created. Approval is
    # an optional gate, never required and never the close.
    scope = _scope(db)
    r = mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, actor_user_id=7,   # no approver_user_id
    )
    db.commit()
    assert r["created"] is True
    assert r["approval_request_id"] is None
    assert r["approver_user_id"] is None
    vuln = db.query(Vulnerability).get(10)
    assert vuln.assigned_to == 8
    assert vuln.status == "in_progress"
    assert db.query(VulnRemediationPlan).one().status == "recommended"
    assert db.query(ApprovalRequest).count() == 0
    step = db.query(WorkflowEngineStep).one()
    assert step.assigned_to_user_id == 8       # the FIXER owns the task, not an approver
    assert step.node_type == "task"


def test_mobilise_is_idempotent_while_running(db):
    scope = _scope(db)
    r1 = mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, approver_user_id=9, actor_user_id=7,
    )
    db.commit()
    r2 = mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, approver_user_id=9, actor_user_id=7,
    )
    db.commit()
    assert r2["created"] is False
    assert r2["workflow_instance_id"] == r1["workflow_instance_id"]
    assert db.query(WorkflowInstance).count() == 1
    assert db.query(ApprovalRequest).count() == 1


def test_out_of_scope_finding_is_refused(db):
    scope = _scope(db)
    db.add(Vulnerability(id=99, tenant_id=TENANT, vuln_id="V-99", title="out",
                         severity="high", status="open"))
    db.commit()
    with pytest.raises(mob.MobiliseError) as ei:
        mob.mobilise_finding(
            db, tenant_id=TENANT, scope=scope, vuln_id=99,
            assignee_user_id=8, approver_user_id=9, actor_user_id=7,
        )
    assert ei.value.status_code == 409


def test_approval_advances_plan_to_approved_never_verified(db):
    scope = _scope(db)
    r = mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, approver_user_id=9, actor_user_id=7,
    )
    db.commit()
    approval = db.query(ApprovalRequest).get(r["approval_request_id"])
    approval.status = "approved"
    actor = db.query(GRCUser).get(9)
    mob.apply_approval_decision(db, approval, actor)
    db.commit()
    plan = db.query(VulnRemediationPlan).one()
    assert plan.status == "approved"
    assert plan.verified_at is None
    assert plan.approved_by_name == "Boss"
    inst = db.query(WorkflowInstance).one()
    assert inst.status == "completed"


def test_rejection_does_not_approve_the_plan(db):
    scope = _scope(db)
    r = mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, approver_user_id=9, actor_user_id=7,
    )
    db.commit()
    approval = db.query(ApprovalRequest).get(r["approval_request_id"])
    approval.status = "rejected"
    mob.apply_approval_decision(db, approval, SimpleNamespace(id=9, display_name="Boss", username="boss"))
    db.commit()
    assert db.query(VulnRemediationPlan).one().status == "recommended"
    assert db.query(WorkflowInstance).one().status == "failed"


def test_non_ctem_approval_is_a_noop(db):
    # A generic workflow approval must not be treated as a CTEM decision.
    dummy = SimpleNamespace(
        request_metadata={"kind": "other"},
        status="approved",
        workflow_instance_id=None,
        workflow_step_id=None,
        tenant_id=TENANT,
    )
    mob.apply_approval_decision(db, dummy, SimpleNamespace(id=9, display_name="Boss"))
    assert db.query(VulnRemediationPlan).count() == 0


def test_assignment_self_clears_when_scanner_closes_the_finding(db):
    # Owner rule: the CTEM Mobilise count follows the FINDING, not a button.
    # An assignment counts while the finding is open; when a Nessus re-scan
    # verifies the fix (status auto_closed_fixed), the finding leaves the open
    # scope and the assignment drops out of the count BY ITSELF — no second
    # close, no manual completion of the workflow instance.
    from grc.services.ctem_scopes import _cc_mobilise, scope_vulnerability_ids
    scope = _scope(db)
    mob.mobilise_finding(
        db, tenant_id=TENANT, scope=scope, vuln_id=10,
        assignee_user_id=8, actor_user_id=7,   # one person, no approver
    )
    db.commit()

    open_ids = scope_vulnerability_ids(db, TENANT, scope.membership_rule)
    assert 10 in open_ids
    assert _cc_mobilise(db, TENANT, open_ids)["assignments"] == 1

    # The scanner verifies the fix — the ONLY thing that closes a finding.
    db.query(Vulnerability).filter(Vulnerability.id == 10).update(
        {"status": "auto_closed_fixed"}, synchronize_session=False)
    db.commit()

    open_ids_after = scope_vulnerability_ids(db, TENANT, scope.membership_rule)
    assert 10 not in open_ids_after                                   # left the open scope
    assert _cc_mobilise(db, TENANT, open_ids_after)["assignments"] == 0  # count self-cleared
    # …and it cleared via the finding's status, NOT by touching the workflow:
    # the instance is still there, still running.
    assert db.query(WorkflowInstance).filter(WorkflowInstance.status == "running").count() == 1
