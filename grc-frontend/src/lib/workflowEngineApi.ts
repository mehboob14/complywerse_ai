/**
 * Workflow Engine 2.0 - Frontend Types and API Client
 * 
 * This file contains all TypeScript types and API methods for the visual workflow builder
 */

import { apiClient } from './api';

// ==================== Node and Edge Types ====================

export type NodeCategory = "trigger" | "action" | "control" | "notification";

export type ActionType = 
  | "create" 
  | "read" 
  | "update" 
  | "delete" 
  | "assign" 
  | "approve"
  | "reject" 
  | "upload" 
  | "export" 
  | "trigger";

export interface NodeDefinition {
  node_id: string;
  node_type: string;
  category: NodeCategory;
  display_name: string;
  description: string;
  icon: string;
  color: string;
  module?: string;
  submodule?: string;
  config_schema: Record<string, any>;
  default_config: Record<string, any>;
  max_inputs: number;
  max_outputs: number;
  required_inputs: number;
  is_terminal: boolean;
  requires_user_action: boolean;
}

export interface NodeCatalog {
  version: string;
  generated_at: string;
  triggers: NodeDefinition[];
  controls: NodeDefinition[];
  notifications: NodeDefinition[];
  actions: Record<string, NodeDefinition[]>;
  summary?: {
    total_triggers: number;
    total_actions: number;
    total_controls: number;
    total_notifications: number;
    total_modules: number;
    total_nodes: number;
  };
}

export interface WorkflowNode {
  node_key: string;
  node_id: string;
  display_name: string;
  config: Record<string, any>;
  position_x: number;
  position_y: number;
}

export interface WorkflowEdge {
  edge_key: string;
  source_node_key: string;
  target_node_key: string;
  source_handle?: string;
  target_handle?: string;
  condition?: Record<string, any>;
  label?: string;
}

export interface WorkflowDefinition {
  id?: number;
  tenant_id?: number;
  name: string;
  description?: string;
  version?: number;
  is_active: boolean;
  trigger_event: string;
  trigger_conditions: Record<string, any>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: {
    zoom: number;
    x: number;
    y: number;
  };
  created_at?: string;
  updated_at?: string;
  created_by_id?: number;
}

// ==================== Notification Types ====================

export interface EmailConfig {
  id?: number;
  tenant_id?: number;
  config_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password?: string;
  from_email: string;
  from_name?: string;
  use_tls: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface NotificationSetupStatus {
  has_email_config: boolean;
  email_config_count: number;
  requires_setup: boolean;
  message: string;
}

// ==================== Execution Types ====================

export interface WorkflowInstance {
  id: number;
  workflow_definition_id: number;
  tenant_id: number;
  status: string;
  current_node_key?: string;
  trigger_event?: string;
  trigger_payload: Record<string, any>;
  context: Record<string, any>;
  correlation_id?: string;
  started_at: string;
  completed_at?: string;
  failed_at?: string;
  error_message?: string;
}

export interface ApprovalTask {
  id: number;
  workflow_instance_id: number;
  workflow_name: string;
  node_key: string;
  node_display_name: string;
  approval_message?: string;
  status: string;
  assigned_at: string;
  due_at?: string;
  context: Record<string, any>;
}

// ==================== Actor Types ====================

export interface ActorUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  type: "user";
  identifier: string;
}

export interface ActorRole {
  id: number;
  name: string;
  description?: string;
  user_count: number;
  type: "role";
  identifier: string;
}

export type Actor = ActorUser | ActorRole;

export interface EventType {
  name: string;
  description: string;
  module: string;
}

// ==================== Module Info ====================

export interface ModuleInfo {
  name: string;
  total_actions: number;
  action_breakdown: Record<ActionType, number>;
  color: string;
}

// ==================== API Client ====================

export const workflowEngineApi = {
  // ========== Catalog ==========
  
  /**
   * Get complete node catalog with optional filters
   */
  getNodeCatalog: (params?: {
    module?: string;
    category?: NodeCategory;
    search?: string;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.module) queryParams.append("module", params.module);
    if (params?.category) queryParams.append("category", params.category);
    if (params?.search) queryParams.append("search", params.search);
    
    return apiClient.get<NodeCatalog>(
      `/workflow-engine/catalog/nodes?${queryParams}`
    );
  },

  /**
   * Get specific node definition
   */
  getNodeDefinition: (nodeId: string) => {
    return apiClient.get<NodeDefinition>(
      `/workflow-engine/catalog/nodes/${encodeURIComponent(nodeId)}`
    );
  },

  /**
   * List all modules with action counts
   */
  listModules: () => {
    return apiClient.get<{ modules: ModuleInfo[]; total_modules: number }>(
      "/workflow-engine/catalog/modules"
    );
  },

  /**
   * List users that can be workflow actors
   */
  listActorUsers: (search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    return apiClient.get<ActorUser[]>(`/workflow-engine/catalog/actors/users${params}`);
  },

  /**
   * List roles that can be workflow actors
   */
  listActorRoles: () => {
    return apiClient.get<ActorRole[]>("/workflow-engine/catalog/actors/roles");
  },

  /**
   * List available event types for triggers
   */
  listEventTypes: () => {
    return apiClient.get<{ events: EventType[]; total: number }>(
      "/workflow-engine/catalog/event-types"
    );
  },

  // ========== Notifications ==========

  /**
   * Configure email settings (one-time setup)
   */
  createEmailConfig: (config: Omit<EmailConfig, "id" | "tenant_id" | "is_active" | "created_at" | "updated_at">) => {
    return apiClient.post<EmailConfig>("/workflow-engine/notifications/email-config", config);
  },

  /**
   * List email configurations
   */
  listEmailConfigs: () => {
    return apiClient.get<EmailConfig[]>("/workflow-engine/notifications/email-config");
  },

  /**
   * Get specific email configuration
   */
  getEmailConfig: (configId: number) => {
    return apiClient.get<EmailConfig>(`/workflow-engine/notifications/email-config/${configId}`);
  },

  /**
   * Update email configuration
   */
  updateEmailConfig: (configId: number, updates: Partial<EmailConfig>) => {
    return apiClient.patch<EmailConfig>(
      `/workflow-engine/notifications/email-config/${configId}`,
      updates
    );
  },

  /**
   * Delete email configuration
   */
  deleteEmailConfig: (configId: number) => {
    return apiClient.delete(`/workflow-engine/notifications/email-config/${configId}`);
  },

  /**
   * Test email configuration
   */
  testEmailConfig: (configId: number, testEmail: string) => {
    return apiClient.post<{ success: boolean; message: string }>(
      `/workflow-engine/notifications/email-config/${configId}/test?test_email=${encodeURIComponent(testEmail)}`
    );
  },

  /**
   * Check notification setup status
   */
  checkNotificationSetup: () => {
    return apiClient.get<NotificationSetupStatus>(
      "/workflow-engine/notifications/check-setup"
    );
  },

  // ========== Workflow Definitions ==========

  /**
   * Create new workflow definition
   */
  createWorkflow: (workflow: Omit<WorkflowDefinition, "id" | "tenant_id" | "version" | "created_at" | "updated_at">) => {
    return apiClient.post<WorkflowDefinition>("/workflow-engine/definitions", workflow);
  },

  /**
   * Update workflow definition
   */
  updateWorkflow: (id: number, updates: Partial<WorkflowDefinition>) => {
    return apiClient.patch<WorkflowDefinition>(`/workflow-engine/definitions/${id}`, updates);
  },

  /**
   * Get workflow definition
   */
  getWorkflow: (id: number) => {
    return apiClient.get<WorkflowDefinition>(`/workflow-engine/definitions/${id}`);
  },

  /**
   * List workflow definitions
   */
  listWorkflows: (params?: { is_active?: boolean; trigger_event?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.is_active !== undefined) queryParams.append("is_active", String(params.is_active));
    if (params?.trigger_event) queryParams.append("trigger_event", params.trigger_event);
    
    return apiClient.get<WorkflowDefinition[]>(
      `/workflow-engine/definitions?${queryParams}`
    );
  },

  /**
   * Delete workflow definition
   */
  deleteWorkflow: (id: number) => {
    return apiClient.delete(`/workflow-engine/definitions/${id}`);
  },

  /**
   * Activate/deactivate workflow
   */
  toggleWorkflow: (id: number, isActive: boolean) => {
    return apiClient.patch<WorkflowDefinition>(`/workflow-engine/definitions/${id}`, {
      is_active: isActive
    });
  },

  // ========== Executions ==========

  /**
   * Trigger workflow by event
   */
  publishEvent: (event: {
    event_name: string;
    payload: Record<string, any>;
    correlation_id?: string;
  }) => {
    return apiClient.post("/workflow-engine/events/publish", event);
  },

  /**
   * Manually trigger workflow
   */
  triggerWorkflow: (workflowId: number, payload: Record<string, any>) => {
    return apiClient.post("/workflow-engine/executions/trigger", {
      workflow_definition_id: workflowId,
      payload,
    });
  },

  /**
   * Get workflow instances
   */
  listInstances: (params?: {
    workflow_definition_id?: number;
    status?: string;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.workflow_definition_id) {
      queryParams.append("workflow_definition_id", String(params.workflow_definition_id));
    }
    if (params?.status) queryParams.append("status", params.status);
    if (params?.limit) queryParams.append("limit", String(params.limit));
    
    return apiClient.get<WorkflowInstance[]>(
      `/workflow-engine/executions/instances?${queryParams}`
    );
  },

  /**
   * Get workflow instance details
   */
  getInstance: (instanceId: number) => {
    return apiClient.get<WorkflowInstance>(`/workflow-engine/executions/instances/${instanceId}`);
  },

  /**
   * Get approval inbox for current user
   */
  getApprovalInbox: () => {
    return apiClient.get<ApprovalTask[]>("/workflow-engine/executions/approvals/inbox");
  },

  /**
   * Make approval decision
   */
  makeApprovalDecision: (approvalId: number, decision: "approve" | "reject", comment?: string) => {
    return apiClient.post(`/workflow-engine/executions/approvals/${approvalId}/decision`, {
      decision,
      comment,
    });
  },
};

// ==================== React Query Hooks ====================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const useNodeCatalog = (filters?: Parameters<typeof workflowEngineApi.getNodeCatalog>[0]) => {
  return useQuery({
    queryKey: ["workflow-catalog", filters],
    queryFn: () => workflowEngineApi.getNodeCatalog(filters),
  });
};

export const useModules = () => {
  return useQuery({
    queryKey: ["workflow-modules"],
    queryFn: () => workflowEngineApi.listModules(),
  });
};

export const useActorUsers = (search?: string) => {
  return useQuery({
    queryKey: ["workflow-actor-users", search],
    queryFn: () => workflowEngineApi.listActorUsers(search),
  });
};

export const useActorRoles = () => {
  return useQuery({
    queryKey: ["workflow-actor-roles"],
    queryFn: () => workflowEngineApi.listActorRoles(),
  });
};

export const useEventTypes = () => {
  return useQuery({
    queryKey: ["workflow-event-types"],
    queryFn: () => workflowEngineApi.listEventTypes(),
  });
};

export const useNotificationSetup = () => {
  return useQuery({
    queryKey: ["workflow-notification-setup"],
    queryFn: () => workflowEngineApi.checkNotificationSetup(),
  });
};

export const useEmailConfigs = () => {
  return useQuery({
    queryKey: ["workflow-email-configs"],
    queryFn: () => workflowEngineApi.listEmailConfigs(),
  });
};

export const useWorkflows = (filters?: Parameters<typeof workflowEngineApi.listWorkflows>[0]) => {
  return useQuery({
    queryKey: ["workflows", filters],
    queryFn: () => workflowEngineApi.listWorkflows(filters),
  });
};

export const useWorkflow = (id: number) => {
  return useQuery({
    queryKey: ["workflow", id],
    queryFn: () => workflowEngineApi.getWorkflow(id),
    enabled: id > 0,
  });
};

export const useApprovalInbox = () => {
  return useQuery({
    queryKey: ["workflow-approval-inbox"],
    queryFn: () => workflowEngineApi.getApprovalInbox(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
};

// ==================== Mutations ====================

export const useCreateWorkflow = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: workflowEngineApi.createWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};

export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: Partial<WorkflowDefinition> }) =>
      workflowEngineApi.updateWorkflow(id, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["workflow", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};

export const useDeleteWorkflow = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: workflowEngineApi.deleteWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
};

export const useCreateEmailConfig = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: workflowEngineApi.createEmailConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-email-configs"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-notification-setup"] });
    },
  });
};

export const useTestEmailConfig = () => {
  return useMutation({
    mutationFn: ({ configId, testEmail }: { configId: number; testEmail: string }) =>
      workflowEngineApi.testEmailConfig(configId, testEmail),
  });
};

export const useTriggerWorkflow = () => {
  return useMutation({
    mutationFn: ({ workflowId, payload }: { workflowId: number; payload: Record<string, any> }) =>
      workflowEngineApi.triggerWorkflow(workflowId, payload),
  });
};

export const useMakeApprovalDecision = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      approvalId, 
      decision, 
      comment 
    }: { 
      approvalId: number; 
      decision: "approve" | "reject"; 
      comment?: string 
    }) =>
      workflowEngineApi.makeApprovalDecision(approvalId, decision, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-approval-inbox"] });
    },
  });
};

// ==================== Utility Functions ====================

/**
 * Format node display name with module/submodule context
 */
export const formatNodeDisplayName = (node: NodeDefinition): string => {
  if (node.module && node.submodule) {
    return `${node.module} > ${node.submodule} > ${node.display_name}`;
  }
  return node.display_name;
};

/**
 * Get node color for visual display
 */
export const getNodeColor = (node: NodeDefinition): string => {
  return node.color || "#6B7280";
};

/**
 * Validate node connections
 */
export const canConnectNodes = (
  source: NodeDefinition,
  target: NodeDefinition,
  existingEdges: WorkflowEdge[]
): { canConnect: boolean; reason?: string } => {
  // Check if target already has max inputs
  const targetIncomingCount = existingEdges.filter(e => e.target_node_key === target.node_id).length;
  if (targetIncomingCount >= target.max_inputs) {
    return { canConnect: false, reason: "Target node has reached maximum inputs" };
  }
  
  // Check if source already has max outputs
  const sourceOutgoingCount = existingEdges.filter(e => e.source_node_key === source.node_id).length;
  if (sourceOutgoingCount >= source.max_outputs) {
    return { canConnect: false, reason: "Source node has reached maximum outputs" };
  }
  
  return { canConnect: true };
};

/**
 * Generate unique node key
 */
export const generateNodeKey = (nodeId: string, existingKeys: string[]): string => {
  const baseKey = nodeId.split(".").pop() || "node";
  let counter = 1;
  let key = `${baseKey}_${counter}`;
  
  while (existingKeys.includes(key)) {
    counter++;
    key = `${baseKey}_${counter}`;
  }
  
  return key;
};

/**
 * Generate unique edge key
 */
export const generateEdgeKey = (sourceKey: string, targetKey: string, existingKeys: string[]): string => {
  let counter = 1;
  let key = `${sourceKey}_to_${targetKey}`;
  
  while (existingKeys.includes(key)) {
    counter++;
    key = `${sourceKey}_to_${targetKey}_${counter}`;
  }
  
  return key;
};
