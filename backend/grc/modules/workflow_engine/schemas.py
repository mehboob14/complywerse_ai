from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class WorkflowNodeIn(BaseModel):
    node_key: str
    node_type: str
    name: str
    config: Dict[str, Any] = Field(default_factory=dict)
    position_x: int = 0
    position_y: int = 0
    is_start: bool = False
    is_terminal: bool = False


class WorkflowEdgeIn(BaseModel):
    source_node_key: str
    target_node_key: str
    condition: Dict[str, Any] = Field(default_factory=dict)
    priority: int = 100


class WorkflowDefinitionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_event: str
    trigger_conditions: Dict[str, Any] = Field(default_factory=dict)
    definition_json: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    nodes: List[WorkflowNodeIn] = Field(default_factory=list)
    edges: List[WorkflowEdgeIn] = Field(default_factory=list)


class WorkflowDefinitionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_event: Optional[str] = None
    trigger_conditions: Optional[Dict[str, Any]] = None
    definition_json: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    nodes: Optional[List[WorkflowNodeIn]] = None
    edges: Optional[List[WorkflowEdgeIn]] = None


class WorkflowDefinitionResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    version: int
    is_active: bool
    trigger_event: str
    trigger_conditions: Dict[str, Any]
    definition_json: Dict[str, Any]
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class TriggerEventRequest(BaseModel):
    event_name: str
    tenant_id: Optional[int] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    correlation_id: Optional[str] = None


class TriggerExecutionRequest(BaseModel):
    workflow_definition_id: int
    payload: Dict[str, Any] = Field(default_factory=dict)
    correlation_id: Optional[str] = None


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    comment: Optional[str] = None


class WorkflowInstanceResponse(BaseModel):
    id: int
    workflow_definition_id: int
    tenant_id: int
    status: str
    current_node_key: Optional[str]
    trigger_event: Optional[str]
    trigger_payload: Dict[str, Any]
    context: Dict[str, Any]
    correlation_id: Optional[str]
    started_at: datetime
    completed_at: Optional[datetime]
    failed_at: Optional[datetime]
    error_message: Optional[str]


class WorkflowTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    trigger_event: str
    trigger_conditions: Dict[str, Any] = Field(default_factory=dict)
    definition_json: Dict[str, Any] = Field(default_factory=dict)
    nodes_json: List[Dict[str, Any]] = Field(default_factory=list)
    edges_json: List[Dict[str, Any]] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)


class WorkflowTemplateResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    category: Optional[str]
    trigger_event: str
    trigger_conditions: Dict[str, Any]
    definition_json: Dict[str, Any]
    nodes_json: List[Dict[str, Any]]
    edges_json: List[Dict[str, Any]]
    tags: List[str]
    is_system_template: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WorkflowVersionResponse(BaseModel):
    id: int
    workflow_definition_id: int
    tenant_id: int
    version_number: int
    name: str
    description: Optional[str]
    trigger_event: str
    trigger_conditions: Dict[str, Any]
    definition_json: Dict[str, Any]
    nodes_json: List[Dict[str, Any]]
    edges_json: List[Dict[str, Any]]
    change_summary: Optional[str]
    created_at: datetime


class WorkflowScheduleCreate(BaseModel):
    workflow_definition_id: int
    name: str
    schedule_type: str = Field(default="interval", pattern="^(interval|once)$")
    interval_minutes: Optional[int] = None
    run_at: Optional[datetime] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class WorkflowScheduleResponse(BaseModel):
    id: int
    tenant_id: int
    workflow_definition_id: int
    name: str
    schedule_type: str
    interval_minutes: Optional[int]
    run_at: Optional[datetime]
    next_run_at: Optional[datetime]
    payload: Dict[str, Any]
    is_active: bool
    last_run_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class WorkflowWebhookCreate(BaseModel):
    name: str
    event_name: str
    callback_url: Optional[str] = None
    secret: Optional[str] = None
    is_active: bool = True


class WorkflowWebhookResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    token: str
    event_name: str
    callback_url: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WorkflowNaturalLanguageRequest(BaseModel):
    prompt: str
    target_trigger_event: Optional[str] = None


class WorkflowOptimizationRequest(BaseModel):
    workflow_definition_id: int
    include_sla_analysis: bool = True


class IntelligentRoutingRequest(BaseModel):
    tenant_id: Optional[int] = None
    task_type: str
    business_unit_id: Optional[int] = None
    preferred_role: Optional[str] = None


class WorkflowAnomalyRequest(BaseModel):
    lookback_hours: int = 72
    runtime_threshold_minutes: int = 60
