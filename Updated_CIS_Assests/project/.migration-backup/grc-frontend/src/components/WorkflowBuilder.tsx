/**
 * Workflow Builder - Example React Components
 * 
 * This file contains example components for implementing the visual workflow builder
 * using ReactFlow library for the canvas
 */

"use client";

import React, { useState, useCallback, useMemo } from "react";
import ReactFlow, {
  Node,
  Edge,
  Connection,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  MiniMap,
  Background,
  Panel,
  NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import { 
  useNodeCatalog, 
  useWorkflow, 
  useCreateWorkflow,
  useUpdateWorkflow,
  NodeDefinition,
  WorkflowNode,
  WorkflowEdge,
  generateNodeKey,
  generateEdgeKey,
} from "@/lib/workflowEngineApi";

// ==================== Custom Node Components ====================

interface CustomNodeProps {
  data: {
    label: string;
    icon: string;
    color: string;
    category: string;
    onConfigure: () => void;
  };
  selected: boolean;
}

const TriggerNode: React.FC<CustomNodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-lg bg-white ${
        selected ? "border-blue-500" : "border-gray-300"
      }`}
      style={{ borderColor: selected ? "#3B82F6" : data.color }}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">{data.icon}</span>
        <div>
          <div className="font-semibold text-sm">{data.label}</div>
          <div className="text-xs text-gray-500">Trigger</div>
        </div>
      </div>
    </div>
  );
};

const ActionNode: React.FC<CustomNodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-lg bg-white ${
        selected ? "border-blue-500" : "border-gray-300"
      }`}
      style={{ borderLeftColor: data.color, borderLeftWidth: "4px" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{data.icon}</span>
          <div>
            <div className="font-semibold text-sm">{data.label}</div>
            <div className="text-xs text-gray-500">{data.category}</div>
          </div>
        </div>
        <button
          onClick={data.onConfigure}
          className="text-gray-400 hover:text-blue-500 text-sm"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
};

const ApprovalNode: React.FC<CustomNodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-lg bg-green-50 ${
        selected ? "border-green-500" : "border-green-300"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">✓</span>
        <div>
          <div className="font-semibold text-sm">{data.label}</div>
          <div className="text-xs text-green-600">Approval Required</div>
        </div>
      </div>
      <div className="flex gap-2 text-xs">
        <div className="px-2 py-1 bg-green-200 rounded text-green-800">Approved</div>
        <div className="px-2 py-1 bg-red-200 rounded text-red-800">Rejected</div>
      </div>
    </div>
  );
};

const NotificationNode: React.FC<CustomNodeProps> = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 shadow-lg bg-blue-50 ${
        selected ? "border-blue-500" : "border-blue-300"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">{data.icon}</span>
        <div>
          <div className="font-semibold text-sm">{data.label}</div>
          <div className="text-xs text-blue-600">Notification</div>
        </div>
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  approval: ApprovalNode,
  notification: NotificationNode,
};

// ==================== Node Palette Component ====================

interface NodePaletteProps {
  onNodeDragStart: (nodeDefinition: NodeDefinition) => void;
}

const NodePalette: React.FC<NodePaletteProps> = ({ onNodeDragStart }) => {
  const { data: catalog, isLoading } = useNodeCatalog();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const filteredCatalog = useMemo(() => {
    if (!catalog) return null;
    
    if (!searchTerm) return catalog;

    const search = searchTerm.toLowerCase();
    return {
      ...catalog,
      actions: Object.fromEntries(
        Object.entries(catalog.actions).map(([module, nodes]) => [
          module,
          nodes.filter(
            (node) =>
              node.display_name.toLowerCase().includes(search) ||
              node.description.toLowerCase().includes(search)
          ),
        ]).filter(([_, nodes]) => nodes.length > 0)
      ),
    };
  }, [catalog, searchTerm]);

  const toggleModule = (moduleName: string) => {
    const newExpanded = new Set(expandedModules);
    if (newExpanded.has(moduleName)) {
      newExpanded.delete(moduleName);
    } else {
      newExpanded.add(moduleName);
    }
    setExpandedModules(newExpanded);
  };

  if (isLoading) {
    return <div className="p-4">Loading nodes...</div>;
  }

  if (!filteredCatalog) {
    return <div className="p-4">No nodes available</div>;
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 h-full overflow-y-auto">
      <div className="p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
        <h3 className="font-semibold text-lg mb-3">Workflow Nodes</h3>
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>

      {/* Triggers */}
      <div className="p-4 border-b border-gray-200">
        <h4 className="font-semibold text-sm mb-2 text-gray-700">Triggers</h4>
        {filteredCatalog.triggers.map((node) => (
          <div
            key={node.node_id}
            draggable
            onDragStart={() => onNodeDragStart(node)}
            className="p-3 mb-2 border border-gray-300 rounded-lg cursor-move hover:border-blue-500 hover:bg-blue-50"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{node.icon}</span>
              <div className="text-sm font-medium">{node.display_name}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Control Flow */}
      <div className="p-4 border-b border-gray-200">
        <h4 className="font-semibold text-sm mb-2 text-gray-700">Control Flow</h4>
        {filteredCatalog.controls.map((node) => (
          <div
            key={node.node_id}
            draggable
            onDragStart={() => onNodeDragStart(node)}
            className="p-3 mb-2 border border-gray-300 rounded-lg cursor-move hover:border-green-500 hover:bg-green-50"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{node.icon}</span>
              <div className="text-sm font-medium">{node.display_name}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Notifications */}
      <div className="p-4 border-b border-gray-200">
        <h4 className="font-semibold text-sm mb-2 text-gray-700">Notifications</h4>
        {filteredCatalog.notifications.map((node) => (
          <div
            key={node.node_id}
            draggable
            onDragStart={() => onNodeDragStart(node)}
            className="p-3 mb-2 border border-gray-300 rounded-lg cursor-move hover:border-blue-500 hover:bg-blue-50"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{node.icon}</span>
              <div className="text-sm font-medium">{node.display_name}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Modules */}
      {Object.entries(filteredCatalog.actions).map(([moduleName, nodes]) => (
        <div key={moduleName} className="border-b border-gray-200">
          <button
            onClick={() => toggleModule(moduleName)}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h4 className="font-semibold text-sm text-gray-700">{moduleName}</h4>
            <span className="text-gray-500">
              {expandedModules.has(moduleName) ? "▼" : "▶"}
            </span>
          </button>
          
          {expandedModules.has(moduleName) && (
            <div className="p-4 pt-0">
              {nodes.map((node) => (
                <div
                  key={node.node_id}
                  draggable
                  onDragStart={() => onNodeDragStart(node)}
                  className="p-3 mb-2 border border-gray-300 rounded-lg cursor-move hover:border-gray-500 hover:bg-gray-50"
                  style={{ borderLeftColor: node.color, borderLeftWidth: "3px" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{node.icon}</span>
                    <div>
                      <div className="text-sm font-medium">{node.display_name}</div>
                      <div className="text-xs text-gray-500">{node.submodule}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ==================== Main Workflow Builder Component ====================

interface WorkflowBuilderProps {
  workflowId?: number;
  onSave?: (workflowId: number) => void;
}

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({ workflowId, onSave }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [draggedNodeDef, setDraggedNodeDef] = useState<NodeDefinition | null>(null);

  const { data: workflow } = useWorkflow(workflowId || 0);
  const createMutation = useCreateWorkflow();
  const updateMutation = useUpdateWorkflow();

  // Load existing workflow
  React.useEffect(() => {
    if (workflow) {
      // Convert workflow nodes to ReactFlow nodes
      const flowNodes: Node[] = workflow.nodes.map((node) => ({
        id: node.node_key,
        type: getCategoryType(node.node_id),
        position: { x: node.position_x, y: node.position_y },
        data: {
          label: node.display_name,
          ...node.config,
        },
      }));

      // Convert workflow edges to ReactFlow edges
      const flowEdges: Edge[] = workflow.edges.map((edge) => ({
        id: edge.edge_key,
        source: edge.source_node_key,
        target: edge.target_node_key,
        sourceHandle: edge.source_handle,
        targetHandle: edge.target_handle,
        label: edge.label,
      }));

      setNodes(flowNodes);
      setEdges(flowEdges);
    }
  }, [workflow, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!draggedNodeDef) return;

      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      };

      const newNodeKey = generateNodeKey(
        draggedNodeDef.node_id,
        nodes.map((n) => n.id)
      );

      const newNode: Node = {
        id: newNodeKey,
        type: getCategoryType(draggedNodeDef.node_id),
        position,
        data: {
          label: draggedNodeDef.display_name,
          icon: draggedNodeDef.icon,
          color: draggedNodeDef.color,
          category: draggedNodeDef.category,
          nodeDefinition: draggedNodeDef,
          onConfigure: () => setSelectedNode(newNode),
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setDraggedNodeDef(null);
    },
    [draggedNodeDef, nodes, setNodes]
  );

  const handleSave = async () => {
    // Convert ReactFlow nodes/edges back to workflow format
    const workflowNodes: WorkflowNode[] = nodes.map((node) => ({
      node_key: node.id,
      node_id: node.data.nodeDefinition.node_id,
      display_name: node.data.label,
      config: node.data.config || {},
      position_x: node.position.x,
      position_y: node.position.y,
    }));

    const workflowEdges: WorkflowEdge[] = edges.map((edge) => ({
      edge_key: edge.id,
      source_node_key: edge.source,
      target_node_key: edge.target,
      source_handle: edge.sourceHandle || undefined,
      target_handle: edge.targetHandle || undefined,
      label: edge.label as string | undefined,
    }));

    if (workflowId) {
      await updateMutation.mutateAsync({
        id: workflowId,
        updates: { nodes: workflowNodes, edges: workflowEdges },
      });
    } else {
      const result = await createMutation.mutateAsync({
        name: "New Workflow",
        trigger_event: "manual",
        trigger_conditions: {},
        is_active: false,
        nodes: workflowNodes,
        edges: workflowEdges,
      });
      onSave?.(result.id!);
    }
  };

  return (
    <div className="flex h-screen">
      <NodePalette onNodeDragStart={setDraggedNodeDef} />
      
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background />
          
          <Panel position="top-right" className="bg-white p-4 rounded-lg shadow-lg">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save Workflow
            </button>
          </Panel>
        </ReactFlow>
      </div>

      {selectedNode && (
        <div className="w-96 bg-white border-l border-gray-200 p-4">
          <h3 className="font-semibold text-lg mb-4">Node Configuration</h3>
          {/* Node configuration form would go here */}
          <button
            onClick={() => setSelectedNode(null)}
            className="mt-4 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

// Helper function to determine node type based on category
function getCategoryType(nodeId: string): string {
  if (nodeId.startsWith("trigger.")) return "trigger";
  if (nodeId.startsWith("control.approval")) return "approval";
  if (nodeId.startsWith("control.")) return "action";
  if (nodeId.startsWith("notification.")) return "notification";
  return "action";
}
