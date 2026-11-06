"""The workflow engine's "Publish policy" action publishes only an approved document, the way the Publish button does (the version in
force, everyone asked to acknowledge it, the document's audit row); anything else fails the step and the run with the reason.
In-memory SQLite, the lifecycle tests' organisation."""
from types import SimpleNamespace

import pytest

import grc.models as m
from grc.modules.workflow_engine.services.action_handlers import ActionRefused, WorkflowActionHandlers as H

from test_document_lifecycle import _secret, doc, obligations, world  # noqa: F401  (fixtures)

FLOW = SimpleNamespace(id=1, name="Publish approved policies", created_by_id=7)       # Adam Admin built it


def test_the_workflow_publishes_only_an_approved_document_and_the_way_publish_does(world):
    with world.factory() as db:
        run = SimpleNamespace(id=1, tenant_id=1, trigger_payload={})
        with pytest.raises(ActionRefused, match="only an approved document is published, and it is draft"):
            H._publish_policy(db, run, FLOW, {"document_id": 5})
        with pytest.raises(ActionRefused, match="no document to publish"):
            H._publish_policy(db, run, FLOW, {})
        assert doc(db).status == "draft" and db.query(m.DocumentAuditLog).count() == 0

        doc(db).status = "approved"
        db.commit()
        out = H._publish_policy(db, run, FLOW, {"resource_type": "grc_governance_documents", "resource_id": 5})
        db.commit()
        assert out == {"action": "publish_policy", "document_id": 5, "status": "published"}
        d = doc(db)
        assert (d.status, d.published_version, d.published_by) == ("published", "1.0", 7)
        row = db.query(m.DocumentAuditLog).filter_by(document_id=5, action="published").one()
        assert row.performed_by == 7 and row.action_details == 'Document published by the workflow "Publish approved policies"'
        assert {o.user_id for o in obligations(db, "acknowledgement")} == {1, 2, 3, 4, 5, 6, 7}   # everyone active is asked
        with pytest.raises(ActionRefused, match="already published"):                           # a second run publishes nothing again
            H._publish_policy(db, run, FLOW, {"document_id": 5})


def test_a_refused_publish_fails_the_workflow_run_and_says_why(world, monkeypatch):
    monkeypatch.setenv("WORKFLOW_QUEUE_BACKEND", "memory")
    from grc.modules.workflow_engine.services.runtime import WorkflowRuntime

    with world.factory() as db:
        db.add(m.WorkflowDefinition(id=1, tenant_id=1, name=FLOW.name, trigger_event="manual", created_by_id=7))
        db.add(m.WorkflowNode(workflow_definition_id=1, node_key="publish", node_type="action", name="Publish",
                              config={"action_name": "publish_policy", "document_id": 5}))
        db.add(m.WorkflowInstance(id=1, tenant_id=1, workflow_definition_id=1, status="running", current_node_key="publish"))
        db.commit()
        runtime = WorkflowRuntime()
        monkeypatch.setattr(runtime, "_notify_webhooks", lambda *a, **k: None)          # it would open the real tenant database
        runtime._run_instance(db, 1)
        db.commit()
        run = db.get(m.WorkflowInstance, 1)
        assert run.status == "failed" and '"Access policy" was not published' in run.error_message
        step = db.query(m.WorkflowEngineStep).one()
        assert step.status == "failed" and "only an approved document is published" in step.output_payload["error"]
        failed = db.query(m.WorkflowAuditLog).filter_by(event_type="step.failed").one()
        assert "only an approved document is published" in failed.message
        assert doc(db).status == "draft" and db.query(m.DocumentAuditLog).count() == 0
