"""
Node type definitions for the visual workflow builder.
Each node represents an action that can be performed in the GRC platform.
"""

from enum import Enum
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field


class NodeCategory(str, Enum):
    """Categories for organizing nodes"""
    TRIGGER = "trigger"
    ACTION = "action"
    CONTROL = "control"
    NOTIFICATION = "notification"


class NodeType(str, Enum):
    """Node types in the workflow"""
    # Trigger nodes
    TRIGGER_START = "trigger.start"
    
    # Action nodes (generated from platform-capabilities.json)
    ACTION_CREATE = "action.create"
    ACTION_UPDATE = "action.update"
    ACTION_DELETE = "action.delete"
    ACTION_ASSIGN = "action.assign"
    ACTION_APPROVE = "action.approve"
    ACTION_REJECT = "action.reject"
    ACTION_UPLOAD = "action.upload"
    ACTION_EXPORT = "action.export"
    ACTION_TRIGGER = "action.trigger"
    ACTION_READ = "action.read"
    
    # Control flow nodes
    CONTROL_APPROVAL = "control.approval"
    CONTROL_ESCALATION = "control.escalation"
    CONTROL_CONDITION = "control.condition"
    CONTROL_PARALLEL = "control.parallel"
    CONTROL_WAIT = "control.wait"
    
    # Notification nodes
    NOTIFICATION_EMAIL = "notification.email"
    NOTIFICATION_IN_APP = "notification.in_app"
    NOTIFICATION_COMBINED = "notification.combined"


class ActionType(str, Enum):
    """Action types from platform"""
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    ASSIGN = "assign"
    APPROVE = "approve"
    REJECT = "reject"
    UPLOAD = "upload"
    EXPORT = "export"
    TRIGGER = "trigger"


class NodeConfigSchema(BaseModel):
    """Base configuration schema for nodes"""
    pass


class TriggerNodeConfig(NodeConfigSchema):
    """Configuration for trigger nodes"""
    event_name: str = Field(..., description="Event that triggers the workflow")
    conditions: Dict[str, Any] = Field(default_factory=dict, description="Conditions to match")


class ActionNodeConfig(NodeConfigSchema):
    """Configuration for action nodes"""
    module: str = Field(..., description="Module name (e.g., 'Governance', 'Risk Management')")
    submodule: str = Field(..., description="Submodule name (e.g., 'Documents', 'Risk Register')")
    action_type: ActionType = Field(..., description="Type of action")
    functionality_name: str = Field(..., description="Full functionality name")
    endpoint: str = Field(..., description="API endpoint to call")
    param_mapping: Dict[str, str] = Field(default_factory=dict, description="Maps workflow context to endpoint params")
    payload_template: Dict[str, Any] = Field(default_factory=dict, description="Template for request body")


class ApprovalNodeConfig(NodeConfigSchema):
    """Configuration for approval nodes"""
    approval_type: str = Field("single", description="'single' or 'multi' approval")
    approvers: List[str] = Field(default_factory=list, description="List of user IDs or role names")
    require_all: bool = Field(False, description="If true, all approvers must approve")
    timeout_hours: Optional[int] = Field(None, description="Hours before escalation")
    approval_message: Optional[str] = Field(None, description="Message to show approvers")


class EscalationNodeConfig(NodeConfigSchema):
    """Configuration for escalation nodes"""
    escalation_type: str = Field("timeout", description="'timeout', 'rejection', or 'manual'")
    escalate_to: List[str] = Field(default_factory=list, description="User IDs or roles to escalate to")
    escalation_message: str = Field(..., description="Message to include in escalation")
    max_escalation_levels: int = Field(3, description="Maximum escalation levels")


class NotificationNodeConfig(NodeConfigSchema):
    """Configuration for notification nodes"""
    notification_type: str = Field("combined", description="'email', 'in_app', or 'combined'")
    recipients: List[str] = Field(default_factory=list, description="User IDs or role names")
    subject: str = Field(..., description="Notification subject/title")
    message_template: str = Field(..., description="Message body with {{variable}} placeholders")
    
    # Email specific (required for one-time setup)
    email_config_id: Optional[int] = Field(None, description="Reference to EmailConfiguration")
    
    # Conditionally send
    send_on_condition: Optional[Dict[str, Any]] = Field(None, description="Only send if condition met")


class ConditionNodeConfig(NodeConfigSchema):
    """Configuration for conditional branching"""
    conditions: List[Dict[str, Any]] = Field(..., description="List of conditions to evaluate")
    default_path: str = Field("reject", description="Path to take if no condition matches")


class WaitNodeConfig(NodeConfigSchema):
    """Configuration for wait/delay nodes"""
    wait_type: str = Field("duration", description="'duration', 'until_date', or 'until_event'")
    duration_minutes: Optional[int] = Field(None, description="Minutes to wait")
    wait_until_date: Optional[str] = Field(None, description="ISO date to wait until")
    wait_for_event: Optional[str] = Field(None, description="Event name to wait for")


class NodeDefinition(BaseModel):
    """Definition of a node type in the catalog"""
    node_id: str = Field(..., description="Unique node identifier")
    node_type: NodeType = Field(..., description="Type of node")
    category: NodeCategory = Field(..., description="Node category")
    display_name: str = Field(..., description="Human-readable name")
    description: str = Field(..., description="Description of what the node does")
    icon: str = Field(..., description="Icon name or emoji")
    color: str = Field(..., description="Color for UI display")
    
    # Module organization
    module: Optional[str] = Field(None, description="Module this node belongs to")
    submodule: Optional[str] = Field(None, description="Submodule this node belongs to")
    
    # Configuration
    config_schema: Dict[str, Any] = Field(default_factory=dict, description="JSON schema for config")
    default_config: Dict[str, Any] = Field(default_factory=dict, description="Default configuration")
    
    # Connection rules
    max_inputs: int = Field(1, description="Maximum incoming connections")
    max_outputs: int = Field(1, description="Maximum outgoing connections")
    required_inputs: int = Field(1, description="Required incoming connections")
    
    # Metadata
    is_terminal: bool = Field(False, description="Whether this ends the workflow")
    requires_user_action: bool = Field(False, description="Whether this pauses for user action")


class NodeCatalog(BaseModel):
    """Complete catalog of available nodes"""
    version: str = Field(..., description="Catalog version")
    generated_at: str = Field(..., description="Generation timestamp")
    
    # Organized by category
    triggers: List[NodeDefinition] = Field(default_factory=list)
    actions: Dict[str, List[NodeDefinition]] = Field(default_factory=dict, description="Actions grouped by module")
    controls: List[NodeDefinition] = Field(default_factory=list)
    notifications: List[NodeDefinition] = Field(default_factory=list)
    
    def get_node_by_id(self, node_id: str) -> Optional[NodeDefinition]:
        """Find a node definition by ID"""
        # Check triggers
        for node in self.triggers:
            if node.node_id == node_id:
                return node
        
        # Check actions
        for module_nodes in self.actions.values():
            for node in module_nodes:
                if node.node_id == node_id:
                    return node
        
        # Check controls
        for node in self.controls:
            if node.node_id == node_id:
                return node
        
        # Check notifications
        for node in self.notifications:
            if node.node_id == node_id:
                return node
        
        return None


# Predefined control flow nodes
CONTROL_FLOW_NODES = [
    NodeDefinition(
        node_id="control.approval",
        node_type=NodeType.CONTROL_APPROVAL,
        category=NodeCategory.CONTROL,
        display_name="Approval",
        description="Request approval from users or roles before proceeding",
        icon="✓",
        color="#10B981",
        config_schema={
            "type": "object",
            "properties": {
                "approvers": {"type": "array", "items": {"type": "string"}},
                "approval_type": {"type": "string", "enum": ["single", "multi"]},
                "require_all": {"type": "boolean"},
                "timeout_hours": {"type": "integer"}
            },
            "required": ["approvers"]
        },
        default_config={"approval_type": "single", "require_all": False},
        max_outputs=2,  # Approved and Rejected paths
        requires_user_action=True
    ),
    NodeDefinition(
        node_id="control.escalation",
        node_type=NodeType.CONTROL_ESCALATION,
        category=NodeCategory.CONTROL,
        display_name="Escalation",
        description="Escalate to higher authority when conditions are met",
        icon="⬆",
        color="#F59E0B",
        config_schema={
            "type": "object",
            "properties": {
                "escalate_to": {"type": "array", "items": {"type": "string"}},
                "escalation_message": {"type": "string"},
                "escalation_type": {"type": "string", "enum": ["timeout", "rejection", "manual"]}
            },
            "required": ["escalate_to", "escalation_message"]
        },
        default_config={"escalation_type": "timeout", "max_escalation_levels": 3}
    ),
    NodeDefinition(
        node_id="control.condition",
        node_type=NodeType.CONTROL_CONDITION,
        category=NodeCategory.CONTROL,
        display_name="Condition",
        description="Branch workflow based on conditions",
        icon="?",
        color="#8B5CF6",
        config_schema={
            "type": "object",
            "properties": {
                "conditions": {"type": "array"},
                "default_path": {"type": "string"}
            },
            "required": ["conditions"]
        },
        default_config={"default_path": "reject"},
        max_outputs=10  # Multiple conditional branches
    ),
    NodeDefinition(
        node_id="control.wait",
        node_type=NodeType.CONTROL_WAIT,
        category=NodeCategory.CONTROL,
        display_name="Wait",
        description="Pause workflow for a duration or until a condition",
        icon="⏱",
        color="#6B7280",
        config_schema={
            "type": "object",
            "properties": {
                "wait_type": {"type": "string", "enum": ["duration", "until_date", "until_event"]},
                "duration_minutes": {"type": "integer"},
                "wait_until_date": {"type": "string"},
                "wait_for_event": {"type": "string"}
            }
        },
        default_config={"wait_type": "duration", "duration_minutes": 60}
    )
]

# Predefined notification nodes
NOTIFICATION_NODES = [
    NodeDefinition(
        node_id="notification.email",
        node_type=NodeType.NOTIFICATION_EMAIL,
        category=NodeCategory.NOTIFICATION,
        display_name="Email Notification",
        description="Send email notifications to users",
        icon="📧",
        color="#3B82F6",
        config_schema={
            "type": "object",
            "properties": {
                "recipients": {"type": "array", "items": {"type": "string"}},
                "subject": {"type": "string"},
                "message_template": {"type": "string"},
                "email_config_id": {"type": "integer"}
            },
            "required": ["recipients", "subject", "message_template"]
        },
        default_config={}
    ),
    NodeDefinition(
        node_id="notification.in_app",
        node_type=NodeType.NOTIFICATION_IN_APP,
        category=NodeCategory.NOTIFICATION,
        display_name="In-App Notification",
        description="Send in-app notifications to users",
        icon="🔔",
        color="#8B5CF6",
        config_schema={
            "type": "object",
            "properties": {
                "recipients": {"type": "array", "items": {"type": "string"}},
                "subject": {"type": "string"},
                "message_template": {"type": "string"}
            },
            "required": ["recipients", "subject", "message_template"]
        },
        default_config={}
    ),
    NodeDefinition(
        node_id="notification.combined",
        node_type=NodeType.NOTIFICATION_COMBINED,
        category=NodeCategory.NOTIFICATION,
        display_name="Email + In-App Notification",
        description="Send both email and in-app notifications",
        icon="📬",
        color="#06B6D4",
        config_schema={
            "type": "object",
            "properties": {
                "recipients": {"type": "array", "items": {"type": "string"}},
                "subject": {"type": "string"},
                "message_template": {"type": "string"},
                "email_config_id": {"type": "integer"}
            },
            "required": ["recipients", "subject", "message_template"]
        },
        default_config={}
    )
]
