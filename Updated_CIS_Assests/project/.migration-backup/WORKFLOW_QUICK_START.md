# Workflow Engine 2.0 - Quick Start Guide

## Getting Started in 5 Minutes

### Step 1: Start the Backend Server

```bash
cd backend
python main.py
# Server runs on http://localhost:8000
```

### Step 2: Verify Node Catalog

```bash
curl http://localhost:8000/grc/workflow-engine/catalog/nodes
```

You should see a response with 150+ nodes organized by module:

```json
{
  "version": "2.0.0",
  "triggers": [...],
  "controls": [...],
  "notifications": [...],
  "actions": {
    "Governance": [...],
    "Risk Management": [...],
    ...
  }
}
```

### Step 3: Configure Email Notifications (Optional)

```bash
curl -X POST http://localhost:8000/grc/workflow-engine/notifications/email-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Slug: your-tenant" \
  -d '{
    "config_name": "Primary SMTP",
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_username": "notifications@company.com",
    "smtp_password": "your-app-password",
    "from_email": "notifications@company.com",
    "from_name": "ComplyVerse GRC",
    "use_tls": true
  }'
```

### Step 4: Create Your First Workflow

#### Example: Document Approval Workflow

```bash
curl -X POST http://localhost:8000/grc/workflow-engine/definitions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Slug: your-tenant" \
  -d '{
    "name": "Document Approval Workflow",
    "description": "Requires CISO approval before publishing documents",
    "trigger_event": "document.created",
    "trigger_conditions": {
      "category": "Policy"
    },
    "is_active": true,
    "nodes": [
      {
        "node_key": "start_1",
        "node_id": "trigger.workflow_start",
        "display_name": "Document Created",
        "config": {},
        "position_x": 100,
        "position_y": 200
      },
      {
        "node_key": "approval_1",
        "node_id": "control.approval",
        "display_name": "CISO Approval",
        "config": {
          "approvers": ["role:3"],
          "approval_type": "single",
          "require_all": false,
          "timeout_hours": 48,
          "approval_message": "Please review this policy document for publication"
        },
        "position_x": 400,
        "position_y": 200
      },
      {
        "node_key": "publish_1",
        "node_id": "action.governance.documents.approve.publish_document",
        "display_name": "Publish Document",
        "config": {
          "param_mapping": {
            "document_id": "{{trigger.payload.document.id}}"
          }
        },
        "position_x": 700,
        "position_y": 200
      },
      {
        "node_key": "notify_approved",
        "node_id": "notification.combined",
        "display_name": "Notify Document Owner",
        "config": {
          "recipients": ["{{trigger.payload.document.owner_id}}"],
          "subject": "Document Approved and Published",
          "message_template": "Your document {{trigger.payload.document.name}} has been approved by {{approval_1.approver.name}} and published successfully.",
          "email_config_id": 1
        },
        "position_x": 1000,
        "position_y": 200
      },
      {
        "node_key": "escalate_1",
        "node_id": "control.escalation",
        "display_name": "Escalate to VP",
        "config": {
          "escalation_type": "timeout",
          "escalate_to": ["role:2"],
          "escalation_message": "Document approval timed out after 48 hours. Please review urgently.",
          "max_escalation_levels": 2
        },
        "position_x": 700,
        "position_y": 400
      },
      {
        "node_key": "notify_rejected",
        "node_id": "notification.combined",
        "display_name": "Notify Rejection",
        "config": {
          "recipients": ["{{trigger.payload.document.owner_id}}"],
          "subject": "Document Rejected",
          "message_template": "Your document {{trigger.payload.document.name}} was rejected. Reason: {{approval_1.rejection_comment}}",
          "email_config_id": 1
        },
        "position_x": 700,
        "position_y": 100
      }
    ],
    "edges": [
      {
        "edge_key": "edge_1",
        "source_node_key": "start_1",
        "target_node_key": "approval_1",
        "label": "Submitted"
      },
      {
        "edge_key": "edge_2",
        "source_node_key": "approval_1",
        "target_node_key": "publish_1",
        "source_handle": "approved",
        "label": "Approved"
      },
      {
        "edge_key": "edge_3",
        "source_node_key": "publish_1",
        "target_node_key": "notify_approved"
      },
      {
        "edge_key": "edge_4",
        "source_node_key": "approval_1",
        "target_node_key": "notify_rejected",
        "source_handle": "rejected",
        "label": "Rejected"
      },
      {
        "edge_key": "edge_5",
        "source_node_key": "approval_1",
        "target_node_key": "escalate_1",
        "source_handle": "timeout",
        "label": "Timeout"
      }
    ]
  }'
```

### Step 5: Test the Workflow

Trigger the workflow manually:

```bash
curl -X POST http://localhost:8000/grc/workflow-engine/executions/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Slug: your-tenant" \
  -d '{
    "workflow_definition_id": 1,
    "payload": {
      "document": {
        "id": 123,
        "name": "Information Security Policy v2.0",
        "category": "Policy",
        "owner_id": 456
      }
    }
  }'
```

Or publish an event:

```bash
curl -X POST http://localhost:8000/grc/workflow-engine/events/publish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Slug: your-tenant" \
  -d '{
    "event_name": "document.created",
    "payload": {
      "document": {
        "id": 123,
        "name": "Information Security Policy v2.0",
        "category": "Policy",
        "owner_id": 456
      }
    }
  }'
```

### Step 6: Check Approval Inbox

```bash
curl http://localhost:8000/grc/workflow-engine/executions/approvals/inbox \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Slug: your-tenant"
```

Response:

```json
[
  {
    "id": 1,
    "workflow_instance_id": 1,
    "workflow_name": "Document Approval Workflow",
    "node_key": "approval_1",
    "node_display_name": "CISO Approval",
    "approval_message": "Please review this policy document for publication",
    "status": "pending",
    "assigned_at": "2026-03-12T10:00:00Z",
    "due_at": "2026-03-14T10:00:00Z",
    "context": {
      "document": {
        "id": 123,
        "name": "Information Security Policy v2.0"
      }
    }
  }
]
```

### Step 7: Approve the Request

```bash
curl -X POST http://localhost:8000/grc/workflow-engine/executions/approvals/1/decision \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Slug: your-tenant" \
  -d '{
    "decision": "approve",
    "comment": "Policy looks good. Approved for publication."
  }'
```

## Common Workflow Patterns

### Pattern 1: Risk Escalation Workflow

When a high-severity risk is created, notify the security team and require director approval.

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌─────────┐
│  Risk    │───▶│   Notify     │───▶│   Director   │───▶│ Update  │
│ Created  │    │ Security Team│    │   Approval   │    │  Risk   │
└──────────┘    └──────────────┘    └───────┬──────┘    └─────────┘
                                             │
                                             │ Rejected
                                             ▼
                                     ┌──────────────┐
                                     │    Notify    │
                                     │  Risk Owner  │
                                     └──────────────┘
```

### Pattern 2: Evidence Assessment Workflow

When evidence is uploaded, run AI assessment and require review if confidence is low.

```
┌──────────┐    ┌───────────┐    ┌──────────────┐    ┌──────────┐
│ Evidence │───▶│    AI     │───▶│  Condition   │───▶│  Manual  │
│ Uploaded │    │ Assessment│    │ Low Confidence│    │  Review  │
└──────────┘    └───────────┘    └──────┬───────┘    └──────────┘
                                        │
                                        │ High Confidence
                                        ▼
                                 ┌──────────────┐
                                 │   Auto       │
                                 │   Approve    │
                                 └──────────────┘
```

### Pattern 3: Policy Exception Workflow

Multi-level approval for policy exceptions with automatic escalation.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│Exception │───▶│ Manager  │───▶│   CISO   │───▶│   VP     │───▶│ Approve  │
│Submitted │    │ Approval │    │ Approval │    │ Approval │    │Exception │
└──────────┘    └─────┬────┘    └─────┬────┘    └─────┬────┘    └──────────┘
                      │               │               │
                   Timeout         Timeout         Timeout
                      │               │               │
                      └───────────────┴───────────────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │  Escalate    │
                               │  to Board    │
                               └──────────────┘
```

### Pattern 4: Vulnerability Remediation Workflow

SLA-based escalation for vulnerability fixes.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐
│   Vuln   │───▶│  Assign  │───▶│   Wait   │───▶│ Check Status │
│ Created  │    │ to Team  │    │ 7 Days   │    │              │
└──────────┘    └──────────┘    └──────────┘    └──────┬───────┘
                                                        │
                                                     Fixed
                                                        │
                                                        ▼
                                                 ┌──────────┐
                                                 │  Close   │
                                                 │  Vuln    │
                                                 └──────────┘
                                                        ▲
                      ┌──────────────┐                 │
                      │  Escalate    │─────────────────┘
                      │  to Manager  │    Still Open
                      └──────────────┘
```

## Frontend Integration Example

### 1. Install Dependencies

```bash
cd grc-frontend
npm install reactflow @tanstack/react-query
```

### 2. Use in Your Component

```tsx
import { WorkflowBuilder } from "@/components/WorkflowBuilder";

export default function WorkflowBuilderPage() {
  return (
    <div className="h-screen">
      <WorkflowBuilder
        workflowId={workflowId}
        onSave={(id) => console.log("Saved workflow:", id)}
      />
    </div>
  );
}
```

### 3. View Approval Inbox

```tsx
import {
  useApprovalInbox,
  useMakeApprovalDecision,
} from "@/lib/workflowEngineApi";

export default function ApprovalInbox() {
  const { data: approvals, isLoading } = useApprovalInbox();
  const makeDecision = useMakeApprovalDecision();

  const handleApprove = (approvalId: number) => {
    makeDecision.mutate({
      approvalId,
      decision: "approve",
      comment: "Approved",
    });
  };

  return (
    <div>
      {approvals?.map((approval) => (
        <div key={approval.id}>
          <h3>{approval.workflow_name}</h3>
          <p>{approval.approval_message}</p>
          <button onClick={() => handleApprove(approval.id)}>Approve</button>
        </div>
      ))}
    </div>
  );
}
```

## Troubleshooting

### Issue: Catalog returns empty

**Solution**: Ensure `platform-capabilities.json` exists in the project root and is properly formatted.

### Issue: Email not sending

**Solution**:

1. Check email configuration with `/notifications/check-setup`
2. Test configuration with `/notifications/email-config/{id}/test`
3. Verify SMTP credentials and firewall settings

### Issue: Workflow not triggering

**Solution**:

1. Check workflow is active (`is_active: true`)
2. Verify event name matches exactly
3. Check trigger conditions match the payload

### Issue: Approval not showing in inbox

**Solution**:

1. Verify user has the assigned role
2. Check workflow instance status
3. Ensure approval node is configured correctly

## Next Steps

1. **Explore the Node Catalog**: Browse all 150+ available nodes
2. **Create Templates**: Build reusable workflow templates
3. **Set Up Notifications**: Configure email for your organization
4. **Train Users**: Share this guide with your team
5. **Monitor Performance**: Use the analytics endpoint to track workflow metrics

## Support

For questions or issues:

- Check [WORKFLOW_ENGINE_2.0.md](WORKFLOW_ENGINE_2.0.md) for detailed documentation
- Review [WORKFLOW_ENGINE_IMPLEMENTATION_SUMMARY.md](WORKFLOW_ENGINE_IMPLEMENTATION_SUMMARY.md) for architecture details
- Contact the engineering team for custom workflow requirements

Happy workflow building! 🚀
