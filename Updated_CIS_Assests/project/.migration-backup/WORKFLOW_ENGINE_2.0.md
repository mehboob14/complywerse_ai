# Workflow Engine 2.0 - Visual Node-Based Builder

## Overview

The redesigned Workflow Engine provides a visual, drag-and-drop workflow builder where users can create automation flows by connecting nodes that represent actions from across the GRC platform.

## Key Features

### 1. **Dynamic Node Catalog**

- Automatically generated from `platform-capabilities.json`
- Every action (create, update, delete, assign, approve, etc.) becomes a draggable node
- Organized by module and submodule for easy discovery
- 100+ action nodes covering all 9 GRC modules

### 2. **Control Flow Nodes**

- **Approval Node**: Request approval from users or roles before proceeding
  - Single or multi-level approvals
  - Timeout-based escalation
  - Approve/Reject paths
- **Escalation Node**: Escalate to higher authority
  - Timeout-based escalation
  - Rejection-based escalation
  - Multi-level escalation chains
- **Condition Node**: Branch workflow based on conditions
  - Multiple conditional paths
  - Default fallback path
- **Wait Node**: Pause workflow execution
  - Duration-based (minutes/hours/days)
  - Date-based (wait until specific date)
  - Event-based (wait for external event)

### 3. **Notification System**

- **Email Notifications**: Send emails via SMTP
  - One-time SMTP configuration
  - Template-based messages with variables
  - Multiple recipients (users or roles)
- **In-App Notifications**: Create notifications in user's inbox
  - Real-time updates
  - Notification bell icon
- **Combined Notifications**: Send both email and in-app

### 4. **Visual Workflow Builder**

- Drag-and-drop interface
- Real-time connection validation
- Auto-save functionality
- Canvas zooming and panning
- Node configuration panels

## API Structure

### Node Catalog Endpoints

#### Get Complete Node Catalog

```
GET /grc/workflow-engine/catalog/nodes
Query params:
  - module: Filter by module name
  - category: Filter by category (trigger, action, control, notification)
  - search: Search node names and descriptions

Response:
{
  "version": "2.0.0",
  "generated_at": "2026-03-12T...",
  "triggers": [...],
  "controls": [...],
  "notifications": [...],
  "actions": {
    "Governance": [...],
    "Risk Management": [...],
    ...
  },
  "summary": {
    "total_nodes": 150,
    "total_modules": 9
  }
}
```

#### Get Specific Node Definition

```
GET /grc/workflow-engine/catalog/nodes/{node_id}

Response:
{
  "node_id": "action.governance.documents.create.create_document",
  "node_type": "action.create",
  "category": "action",
  "display_name": "Create document",
  "description": "Create action in Governance > Documents",
  "icon": "➕",
  "color": "#8B5CF6",
  "module": "Governance",
  "submodule": "Documents",
  "config_schema": {...},
  "default_config": {...},
  "max_inputs": 1,
  "max_outputs": 1
}
```

#### List Modules

```
GET /grc/workflow-engine/catalog/modules

Response:
{
  "modules": [
    {
      "name": "Governance",
      "total_actions": 25,
      "action_breakdown": {
        "create": 8,
        "update": 6,
        "delete": 4,
        "approve": 4,
        "reject": 3
      },
      "color": "#8B5CF6"
    },
    ...
  ]
}
```

#### List Actor Users/Roles

```
GET /grc/workflow-engine/catalog/actors/users?search=john
GET /grc/workflow-engine/catalog/actors/roles

Use these to populate approval/escalation/notification recipient selectors
```

#### List Event Types

```
GET /grc/workflow-engine/catalog/event-types

Returns all events that can trigger workflows:
{
  "events": [
    {"name": "risk.created", "description": "Risk created", "module": "Risk Management"},
    {"name": "document.published", "description": "Document published", "module": "Governance"},
    ...
  ]
}
```

### Notification Configuration

#### Configure Email (One-Time Setup)

```
POST /grc/workflow-engine/notifications/email-config
{
  "config_name": "Primary SMTP",
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_username": "notifications@company.com",
  "smtp_password": "***",
  "from_email": "notifications@company.com",
  "from_name": "ComplyVerse GRC",
  "use_tls": true
}
```

#### Test Email Configuration

```
POST /grc/workflow-engine/notifications/email-config/{config_id}/test?test_email=user@company.com
```

#### Check Notification Setup

```
GET /grc/workflow-engine/notifications/check-setup

Response:
{
  "has_email_config": true,
  "email_config_count": 1,
  "requires_setup": false,
  "message": "Email notifications configured"
}
```

### Workflow Definition Endpoints

#### Create Workflow

```
POST /grc/workflow-engine/definitions
{
  "name": "Risk Approval Workflow",
  "description": "Requires manager approval for high-severity risks",
  "trigger_event": "risk.created",
  "trigger_conditions": {
    "severity": {"$in": ["high", "critical"]}
  },
  "is_active": true,
  "nodes": [
    {
      "node_key": "start_1",
      "node_id": "trigger.workflow_start",
      "display_name": "Risk Created",
      "config": {},
      "position_x": 100,
      "position_y": 100
    },
    {
      "node_key": "approval_1",
      "node_id": "control.approval",
      "display_name": "Manager Approval",
      "config": {
        "approvers": ["role:5"],
        "approval_type": "single",
        "timeout_hours": 24,
        "approval_message": "Please review this high-severity risk"
      },
      "position_x": 400,
      "position_y": 100
    },
    {
      "node_key": "notify_1",
      "node_id": "notification.combined",
      "display_name": "Notify Risk Owner",
      "config": {
        "recipients": ["{{risk.owner_id}}"],
        "subject": "Risk {{risk.title}} Approved",
        "message_template": "Your risk has been approved by {{approver.name}}",
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
      "target_node_key": "approval_1"
    },
    {
      "edge_key": "edge_2",
      "source_node_key": "approval_1",
      "target_node_key": "notify_1",
      "source_handle": "approved",
      "label": "Approved"
    }
  ],
  "viewport": {
    "zoom": 1.0,
    "x": 0,
    "y": 0
  }
}
```

#### Update Workflow

```
PATCH /grc/workflow-engine/definitions/{id}
- Supports partial updates
- Increments version number
- Creates version history entry
```

#### List Workflows

```
GET /grc/workflow-engine/definitions
Query params:
  - is_active: true/false
  - trigger_event: filter by event
```

#### Get Workflow Detail

```
GET /grc/workflow-engine/definitions/{id}
- Returns full definition with nodes and edges
```

### Workflow Execution

#### Trigger by Event

```
POST /grc/workflow-engine/events/publish
{
  "event_name": "risk.created",
  "payload": {
    "risk": {
      "id": 123,
      "title": "Data breach risk",
      "severity": "high",
      "owner_id": 456
    }
  }
}
```

#### Manual Trigger

```
POST /grc/workflow-engine/executions/trigger
{
  "workflow_definition_id": 1,
  "payload": {...}
}
```

#### Get Approval Inbox

```
GET /grc/workflow-engine/executions/approvals/inbox
- Returns pending approvals for current user
```

#### Approve/Reject

```
POST /grc/workflow-engine/executions/approvals/{approval_id}/decision
{
  "decision": "approve",
  "comment": "Looks good"
}
```

## Node Configuration Examples

### Action Node (Create Document)

```json
{
  "node_key": "create_doc_1",
  "node_id": "action.governance.documents.create.create_document",
  "display_name": "Create Policy Document",
  "config": {
    "param_mapping": {
      "document_id": "{{context.document_id}}"
    },
    "payload_template": {
      "name": "{{policy.name}}",
      "category": "Policy",
      "content": "{{policy.content}}"
    },
    "store_response_as": "created_document"
  }
}
```

### Approval Node

```json
{
  "node_key": "approval_1",
  "node_id": "control.approval",
  "display_name": "CISO Approval",
  "config": {
    "approval_type": "single",
    "approvers": ["user:25", "role:3"],
    "require_all": false,
    "timeout_hours": 48,
    "approval_message": "Please review this policy for publication"
  }
}
```

### Escalation Node

```json
{
  "node_key": "escalate_1",
  "node_id": "control.escalation",
  "display_name": "Escalate to VP",
  "config": {
    "escalation_type": "timeout",
    "escalate_to": ["role:2"],
    "escalation_message": "Approval request timed out after 48 hours",
    "max_escalation_levels": 2
  }
}
```

### Notification Node

```json
{
  "node_key": "notify_1",
  "node_id": "notification.combined",
  "display_name": "Notify Stakeholders",
  "config": {
    "notification_type": "combined",
    "recipients": ["{{document.owner_id}}", "role:4"],
    "subject": "Document {{document.name}} Published",
    "message_template": "The document has been approved and published by {{approver.name}}",
    "email_config_id": 1
  }
}
```

### Condition Node

```json
{
  "node_key": "condition_1",
  "node_id": "control.condition",
  "display_name": "Check Risk Severity",
  "config": {
    "conditions": [
      {
        "path": "approved",
        "condition": {
          "field": "risk.severity",
          "operator": "in",
          "value": ["high", "critical"]
        }
      },
      {
        "path": "rejected",
        "condition": {
          "field": "risk.severity",
          "operator": "in",
          "value": ["low", "medium"]
        }
      }
    ],
    "default_path": "rejected"
  }
}
```

## Database Schema

### WorkflowDefinition

- `id`: Primary key
- `tenant_id`: Multi-tenant isolation
- `name`: Workflow name
- `description`: Optional description
- `version`: Version number (auto-incremented)
- `is_active`: Active flag
- `trigger_event`: Event name that triggers this workflow
- `trigger_conditions`: JSON conditions for filtering events
- `viewport`: Canvas state (zoom, pan)

### WorkflowNode

- `id`: Primary key
- `workflow_definition_id`: Foreign key
- `node_key`: Unique key within workflow
- `node_id`: Node type ID from catalog
- `display_name`: Display name for this instance
- `config`: JSON configuration
- `position_x`, `position_y`: Canvas position

### WorkflowEdge

- `id`: Primary key
- `workflow_definition_id`: Foreign key
- `edge_key`: Unique edge identifier
- `source_node_key`, `target_node_key`: Node connections
- `source_handle`, `target_handle`: For multi-output nodes
- `condition`: Conditional logic
- `label`: Display label

### WorkflowEmailConfiguration

- `id`: Primary key
- `tenant_id`: Multi-tenant isolation
- `config_name`: Configuration name
- `smtp_host`, `smtp_port`: SMTP settings
- `smtp_username`, `smtp_password`: Credentials
- `from_email`, `from_name`: Sender info
- `use_tls`: TLS flag

### WorkflowNotification

- `id`: Primary key
- `tenant_id`, `user_id`: Recipient
- `workflow_instance_id`: Associated workflow run
- `subject`, `message`: Notification content
- `is_read`, `read_at`: Read tracking

## Frontend Integration

### React Component Structure

```
WorkflowBuilder/
  ├── WorkflowCanvas.tsx         # Main ReactFlow canvas
  ├── NodePalette.tsx            # Sidebar with draggable nodes
  ├── NodeConfigPanel.tsx        # Configuration panel for selected node
  ├── WorkflowToolbar.tsx        # Save, activate, test buttons
  └── nodes/
      ├── TriggerNode.tsx
      ├── ActionNode.tsx
      ├── ApprovalNode.tsx
      ├── NotificationNode.tsx
      └── ConditionNode.tsx
```

### Example API Usage (TypeScript)

```typescript
// Fetch node catalog
const catalog = await api.get('/grc/workflow-engine/catalog/nodes');

// Create workflow
const workflow = await api.post('/grc/workflow-engine/definitions', {
  name: 'My Workflow',
  trigger_event: 'risk.created',
  nodes: [...],
  edges: [...]
});

// Test workflow
await api.post('/grc/workflow-engine/executions/trigger', {
  workflow_definition_id: workflow.id,
  payload: {...}
});
```

## UI/UX Best Practices

### Node Organization

- **Module Groups**: Collapsible sidebar sections by module
- **Search**: Real-time search across all nodes
- **Favorites**: Pin frequently used nodes to top
- **Recent**: Show recently used nodes

### Canvas Interaction

- **Drag & Drop**: Drag nodes from palette to canvas
- **Auto-Connect**: Smart connection suggestions
- **Validation**: Real-time validation (max inputs/outputs)
- **Minimap**: Overview of entire workflow
- **Undo/Redo**: Action history

### Node Configuration

- **Modal/Sidebar**: Configuration panel on node select
- **Smart Defaults**: Pre-fill common configurations
- **Validation**: Inline field validation
- **Context Help**: Tooltips and examples

### Visual Feedback

- **Node Colors**: Color-code by module
- **Edge Labels**: Show conditions on edges
- **Status Indicators**: Active/inactive workflows
- **Execution Overlay**: Highlight current node during execution

## Migration from Old System

Existing workflows can be migrated by:

1. Reading old `definition_json` field
2. Converting to new node/edge format
3. Mapping old node types to new catalog IDs
4. Creating equivalent configurations

Contact the engineering team for migration scripts.

## Next Steps

1. **Frontend Implementation**: Build React components using ReactFlow
2. **Execution Engine**: Implement runtime execution logic
3. **Testing**: Create comprehensive test workflows
4. **Documentation**: User-facing documentation and tutorials
5. **Templates**: Pre-built workflow templates for common scenarios
