'use client';

import {
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeTypes,
  Position,
  ReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';

type FlowNodeData = {
  nodeKey: string;
  nodeType: 'start' | 'action' | 'condition' | 'approval' | 'timer' | 'end' | 'subworkflow';
  label: string;
  config: Record<string, unknown>;
  isStart?: boolean;
  isTerminal?: boolean;
};

type WorkflowDefinition = {
  id: number;
  name: string;
  description?: string;
  trigger_event: string;
  trigger_conditions: Record<string, unknown>;
  definition_json: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  is_active: boolean;
  version: number;
};

type ActorUser = { id: number; display_name?: string; username?: string; email?: string };
type ActorRole = { id: number; name: string; member_count?: number };
type SenderProfile = { id: string; name: string; fromEmail: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPassword: string };
type MessageTemplate = { id: string; name: string; subject: string; body: string };

type PaletteItem = { key: string; label: string; group: 'trigger' | 'action' | 'condition' | 'approval' | 'timer' | 'control'; module?: string };

const TRIGGERS: PaletteItem[] = [
  { key: 'governance.policy_draft.created', label: 'Policy Draft Created', group: 'trigger', module: 'governance' },
  { key: 'governance.documents.file_uploaded', label: 'Governance Doc Uploaded', group: 'trigger', module: 'governance' },
  { key: 'evidence.items.uploaded', label: 'Evidence Uploaded', group: 'trigger', module: 'evidence' },
  { key: 'manual.trigger', label: 'Manual Trigger', group: 'trigger', module: 'general' },
];

const ACTIONS: PaletteItem[] = [
  { key: 'send_notification_email', label: 'Send Email', group: 'action' },
  { key: 'create_risk_entry', label: 'Create Risk Entry', group: 'action' },
  { key: 'update_compliance_status', label: 'Update Compliance Status', group: 'action' },
  { key: 'call_webhook_api', label: 'Call Webhook', group: 'action' },
];

const APPROVALS: PaletteItem[] = [
  { key: 'single', label: 'Single Approver', group: 'approval' },
  { key: 'quorum', label: 'Quorum Approval', group: 'approval' },
  { key: 'multi_level', label: 'Multi-Level Approval', group: 'approval' },
];

const TIMERS: PaletteItem[] = [
  { key: 'wait_duration', label: 'Wait Duration', group: 'timer' },
  { key: 'sla_countdown', label: 'SLA / Escalation Timer', group: 'timer' },
];

const CONDITION_GROUPS: Record<string, Array<{ key: string; label: string }>> = {
  governance: [
    { key: 'doc_type_is', label: 'Document Type Is' },
    { key: 'policy_classification_is', label: 'Policy Classification Is' },
    { key: 'policy_status_is', label: 'Policy Status Is' },
  ],
  compliance: [
    { key: 'assessment_status_is', label: 'Assessment Status Is' },
    { key: 'control_gap_exists', label: 'Control Gap Exists' },
  ],
  risk: [
    { key: 'risk_score_gt', label: 'Risk Score Greater Than' },
    { key: 'risk_category_is', label: 'Risk Category Is' },
    { key: 'severity_is', label: 'Severity Is' },
  ],
  evidence: [
    { key: 'evidence_type_is', label: 'Evidence Type Is' },
    { key: 'evidence_age_gt_days', label: 'Evidence Age > Days' },
  ],
};

const DEFAULT_TEMPLATES: MessageTemplate[] = [
  { id: 'approval-request', name: 'Approval Request', subject: 'Action Required: Approval Needed', body: '<p>You have a pending approval request.</p>' },
  { id: 'approved-submitter', name: 'Approved Notification', subject: 'Your document has been approved', body: '<p>Your document was approved.</p>' },
  { id: 'escalation', name: 'Escalation Alert', subject: 'Escalation: Approval overdue', body: '<p>This request has been escalated due to timeout.</p>' },
];

const nodeTypes: NodeTypes = {
  workflowNode: ({ data }: { data: FlowNodeData }) => {
    const color = data.nodeType === 'start' ? 'border-blue-600' : data.nodeType === 'approval' ? 'border-violet-600' : data.nodeType === 'condition' ? 'border-amber-500' : data.nodeType === 'timer' ? 'border-cyan-600' : data.nodeType === 'end' ? 'border-gray-500' : 'border-emerald-600';
    return (
      <div className={`relative min-w-[260px] rounded-xl border-2 ${color} bg-white px-4 py-3 shadow-md`}>
        <Handle type="target" position={Position.Top} id="in" className="h-2.5 w-2.5 !bg-gray-600" />
        {data.nodeType === 'condition' ? (
          <>
            <Handle type="source" position={Position.Right} id="out_true" className="h-2.5 w-2.5 !bg-emerald-600" />
            <Handle type="source" position={Position.Bottom} id="out_false" className="h-2.5 w-2.5 !bg-rose-600" />
          </>
        ) : (
          <Handle type="source" position={Position.Bottom} id="out" className="h-2.5 w-2.5 !bg-blue-600" />
        )}
        <div className="text-[11px] uppercase tracking-wider text-gray-500">{data.nodeType}</div>
        <div className="text-base font-semibold text-black">{data.label}</div>
        <div className="text-[11px] text-gray-600">{data.nodeKey}</div>
      </div>
    );
  },
};

function WorkflowEngineAdminContent() {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);

  const [users, setUsers] = useState<ActorUser[]>([]);
  const [roles, setRoles] = useState<ActorRole[]>([]);
  const [senderProfiles, setSenderProfiles] = useState<SenderProfile[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>(DEFAULT_TEMPLATES);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerEvent, setTriggerEvent] = useState('manual.trigger');
  const [isActive, setIsActive] = useState(true);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) || null, [edges, selectedEdgeId]);

  const [newSender, setNewSender] = useState<SenderProfile>({ id: '', name: '', fromEmail: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPassword: '' });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const loadAll = async () => {
    const [defs, actorUsers, actorRoles] = await Promise.all([
      workflowEngineApi.definitions.list(),
      workflowEngineApi.catalog.users(),
      workflowEngineApi.catalog.roles(),
    ]);
    setDefinitions((defs.data || []) as WorkflowDefinition[]);
    setUsers(((actorUsers.data || {}).users || []) as ActorUser[]);
    setRoles(((actorRoles.data || {}).roles || []) as ActorRole[]);
  };

  useEffect(() => { loadAll(); }, []);

  const setNodeConfig = (nodeId: string, patch: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, config: { ...(n.data.config || {}), ...patch } } } : n));
  };

  const setNodeLabel = (nodeId: string, label: string) => {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, label } } : n));
  };

  const addNode = (item: PaletteItem) => {
    const point = reactFlowInstance ? reactFlowInstance.screenToFlowPosition({ x: 400, y: 260 }) : { x: 260, y: 200 };
    if (item.group === 'trigger') {
      const existing = nodes.find((n) => n.data.nodeType === 'start');
      if (existing) {
        setNodeLabel(existing.id, item.label);
        setNodeConfig(existing.id, { trigger_event: item.key });
        setTriggerEvent(item.key);
        setSelectedNodeId(existing.id);
        return;
      }
    }

    const id = `${item.key.replace(/\./g, '_')}_${Date.now()}`;
    const nodeType: FlowNodeData['nodeType'] = item.group === 'trigger' ? 'start' : item.group === 'action' ? 'action' : item.group === 'condition' ? 'condition' : item.group === 'approval' ? 'approval' : item.group === 'timer' ? 'timer' : item.key === 'end' ? 'end' : 'subworkflow';
    const config: Record<string, unknown> =
      nodeType === 'start' ? { trigger_event: item.key } :
      nodeType === 'approval' ? { approval_type: item.key, required_approvals: 1, timeout_days: 14, on_timeout: 'escalate', approver_user_ids: [], approver_role_ids: [], escalation_user_ids: [], escalation_role_ids: [] } :
      nodeType === 'action' ? { action_name: item.key, user_ids: [], role_ids: [] } :
      nodeType === 'timer' ? { timer_kind: item.key, wait_seconds: 3600 } :
      nodeType === 'condition' ? { condition_key: item.key, expected_value: '' } : {};

    setNodes((prev) => [...prev, { id, type: 'workflowNode', position: point, data: { nodeKey: id, nodeType, label: item.label, config, isStart: nodeType === 'start', isTerminal: nodeType === 'end' } }]);
    if (nodeType === 'start') setTriggerEvent(item.key);
  };

  const onConnect = useCallback((connection: Connection) => {
    const condition = connection.sourceHandle === 'out_true' ? { path: 'step.condition_result', operator: 'eq', value: true, _label: 'true' } : connection.sourceHandle === 'out_false' ? { path: 'step.condition_result', operator: 'eq', value: false, _label: 'false' } : {};
    setEdges((prev) => addEdge({ ...connection, id: `${connection.source}-${connection.target}-${Date.now()}`, markerEnd: { type: MarkerType.ArrowClosed }, data: { condition, priority: 1 } }, prev));
  }, [setEdges]);

  const onDropCanvas = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/workflow-item');
    if (!raw) return;
    addNode(JSON.parse(raw) as PaletteItem);
  };

  const onDragOverCanvas = (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; };

  const nodeIncomingOutgoing = () => {
    const incoming: Record<string, number> = {};
    const outgoing: Record<string, number> = {};
    nodes.forEach((n) => { incoming[n.id] = 0; outgoing[n.id] = 0; });
    edges.forEach((e) => {
      if (e.target in incoming) incoming[e.target] += 1;
      if (e.source in outgoing) outgoing[e.source] += 1;
    });
    return { incoming, outgoing };
  };

  const validateWorkflow = (): string[] => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Workflow name is required.');
    const starts = nodes.filter((n) => n.data.nodeType === 'start');
    const ends = nodes.filter((n) => n.data.nodeType === 'end');
    if (starts.length !== 1) errors.push('Exactly one trigger node is required.');
    if (ends.length < 1) errors.push('At least one end node is required.');

    const { incoming, outgoing } = nodeIncomingOutgoing();
    nodes.forEach((n) => {
      if (n.data.nodeType !== 'start' && (incoming[n.id] || 0) === 0) errors.push(`Node "${n.data.label}" has no incoming connection.`);
      if (n.data.nodeType !== 'end' && (outgoing[n.id] || 0) === 0) errors.push(`Node "${n.data.label}" has no outgoing connection.`);

      const cfg = n.data.config || {};
      if (n.data.nodeType === 'approval') {
        const approverUsers = (cfg.approver_user_ids as number[] | undefined) || [];
        const approverRoles = (cfg.approver_role_ids as number[] | undefined) || [];
        if (!approverUsers.length && !approverRoles.length) errors.push(`Approval node "${n.data.label}" must have approver users or roles.`);
      }
      if (n.data.nodeType === 'action' && String(cfg.action_name || '') === 'send_notification_email') {
        const usersCfg = (cfg.user_ids as number[] | undefined) || [];
        const rolesCfg = (cfg.role_ids as number[] | undefined) || [];
        const includeTrigger = Boolean(cfg.include_trigger_user);
        if (!usersCfg.length && !rolesCfg.length && !includeTrigger) errors.push(`Email node "${n.data.label}" must target at least one user/role.`);
        if (!String(cfg.sender_profile_id || '')) errors.push(`Email node "${n.data.label}" must have sender profile.`);
      }
      if (n.data.nodeType === 'condition') {
        const outCount = edges.filter((e) => e.source === n.id).length;
        if (outCount < 2) errors.push(`Condition node "${n.data.label}" must have two branches (true/false).`);
      }
    });
    return Array.from(new Set(errors));
  };

  const serializePayload = () => {
    const positions: Record<string, { x: number; y: number }> = {};
    return {
      name,
      description,
      trigger_event: triggerEvent,
      is_active: isActive,
      trigger_conditions: {},
      definition_json: {
        sender_profiles: senderProfiles,
        message_templates: templates,
        canvas: { positions: nodes.reduce((acc, n) => { positions[n.id] = { x: n.position.x, y: n.position.y }; acc[n.id] = positions[n.id]; return acc; }, {} as Record<string, { x: number; y: number }>) },
      },
      nodes: nodes.map((n) => ({ node_key: n.id, node_type: n.data.nodeType, name: n.data.label, config: n.data.config || {}, is_start: n.data.nodeType === 'start', is_terminal: n.data.nodeType === 'end' })),
      edges: edges.map((e) => ({ source_node_key: e.source, target_node_key: e.target, condition: ((e.data as Record<string, unknown>)?.condition || {}) as Record<string, unknown>, priority: Number((e.data as Record<string, unknown>)?.priority || 1) })),
    };
  };

  const saveWorkflow = async () => {
    const errors = validateWorkflow();
    setValidationErrors(errors);
    if (errors.length) return;

    const payload = serializePayload();
    if (selectedId) {
      await workflowEngineApi.definitions.update(selectedId, payload);
    } else {
      await workflowEngineApi.definitions.create(payload);
    }
    await loadAll();
  };

  const loadDefinition = (definition: WorkflowDefinition) => {
    setSelectedId(definition.id);
    setName(definition.name);
    setDescription(definition.description || '');
    setTriggerEvent(definition.trigger_event || 'manual.trigger');
    setIsActive(Boolean(definition.is_active));

    const defJson = (definition.definition_json || {}) as Record<string, unknown>;
    setSenderProfiles(((defJson.sender_profiles as SenderProfile[] | undefined) || []));
    setTemplates(((defJson.message_templates as MessageTemplate[] | undefined) || DEFAULT_TEMPLATES));

    const positions = (((defJson.canvas as Record<string, unknown>)?.positions || {}) as Record<string, { x?: number; y?: number }>);
    const flowNodes: Node<FlowNodeData>[] = (definition.nodes || []).map((raw, i) => {
      const nodeKey = String(raw.node_key || `node_${i}`);
      const nodeType = String(raw.node_type || 'action') as FlowNodeData['nodeType'];
      return {
        id: nodeKey,
        type: 'workflowNode',
        position: { x: Number(positions[nodeKey]?.x ?? (180 + (i % 4) * 270)), y: Number(positions[nodeKey]?.y ?? (120 + Math.floor(i / 4) * 170)) },
        data: { nodeKey, nodeType, label: String(raw.name || nodeKey), config: (raw.config || {}) as Record<string, unknown>, isStart: Boolean(raw.is_start), isTerminal: Boolean(raw.is_terminal) },
      };
    });

    const flowEdges: Edge[] = (definition.edges || []).map((raw, i) => ({
      id: `${raw.source_node_key}-${raw.target_node_key}-${i}`,
      source: String(raw.source_node_key || ''),
      target: String(raw.target_node_key || ''),
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { condition: (raw.condition || {}) as Record<string, unknown>, priority: Number(raw.priority || 1) },
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
    setValidationErrors([]);
  };

  const resetDraft = () => {
    setSelectedId(null);
    setName('');
    setDescription('');
    setTriggerEvent('manual.trigger');
    setIsActive(true);
    setNodes([]);
    setEdges([]);
    setValidationErrors([]);
  };

  const updateActivation = async (item: WorkflowDefinition, nextActive: boolean) => {
    await workflowEngineApi.definitions.update(item.id, {
      name: item.name,
      description: item.description,
      trigger_event: item.trigger_event,
      trigger_conditions: item.trigger_conditions || {},
      definition_json: item.definition_json || {},
      is_active: nextActive,
    });
    await loadAll();
  };

  const parseMultiSelectIds = (e: React.ChangeEvent<HTMLSelectElement>) => Array.from(e.target.selectedOptions).map((o) => Number(o.value));

  const selectedNodeConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;

  return (
    <div className="space-y-5 p-6 bg-slate-50 min-h-screen">
      <div className="bg-white border border-gray-300 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black">Workflow Builder</h1>
            <p className="text-gray-700 text-sm">n8n-style guided builder with dropdowns and validation for non-technical users.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={resetDraft} className="px-3 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">New</button>
            <button onClick={saveWorkflow} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">{selectedId ? 'Update Workflow' : 'Create Workflow'}</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-1 space-y-4">
          <div className="bg-white border border-gray-300 rounded-xl p-3">
            <h3 className="font-semibold text-black mb-2">Workflow List</h3>
            <div className="space-y-2 max-h-[280px] overflow-auto">
              {definitions.map((d) => (
                <div key={d.id} className={`border rounded p-2 ${selectedId === d.id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                  <button onClick={() => loadDefinition(d)} className="w-full text-left">
                    <div className="text-sm font-medium text-black">{d.name}</div>
                    <div className="text-xs text-gray-600">{d.trigger_event}</div>
                  </button>
                  <button onClick={() => updateActivation(d, !d.is_active)} className={`mt-2 w-full text-xs rounded px-2 py-1 ${d.is_active ? 'border border-amber-500 text-amber-700' : 'border border-emerald-600 text-emerald-700'}`}>
                    {d.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-300 rounded-xl p-3">
            <h3 className="font-semibold text-black mb-2">Basic Info</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow Name" className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-2" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full border border-gray-300 rounded px-2 py-1 text-sm min-h-[80px] mb-2" />
            <input value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="Trigger Event" className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-2" />
            <label className="text-sm text-gray-700 flex items-center gap-2"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active</label>
          </div>

          <div className="bg-white border border-gray-300 rounded-xl p-3">
            <h3 className="font-semibold text-black mb-2">Email Sender Profiles</h3>
            <input value={newSender.name} onChange={(e) => setNewSender((s) => ({ ...s, name: e.target.value }))} placeholder="Profile Name" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-1" />
            <input value={newSender.fromEmail} onChange={(e) => setNewSender((s) => ({ ...s, fromEmail: e.target.value }))} placeholder="From Email" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-1" />
            <input value={newSender.smtpHost} onChange={(e) => setNewSender((s) => ({ ...s, smtpHost: e.target.value }))} placeholder="SMTP Host" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-1" />
            <div className="grid grid-cols-2 gap-1 mb-1">
              <input value={newSender.smtpPort} onChange={(e) => setNewSender((s) => ({ ...s, smtpPort: Number(e.target.value || 587) }))} placeholder="Port" className="border border-gray-300 rounded px-2 py-1 text-xs" />
              <input value={newSender.smtpUser} onChange={(e) => setNewSender((s) => ({ ...s, smtpUser: e.target.value }))} placeholder="SMTP User" className="border border-gray-300 rounded px-2 py-1 text-xs" />
            </div>
            <input type="password" value={newSender.smtpPassword} onChange={(e) => setNewSender((s) => ({ ...s, smtpPassword: e.target.value }))} placeholder="SMTP Password" className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-2" />
            <button
              onClick={() => {
                if (!newSender.name || !newSender.fromEmail || !newSender.smtpHost || !newSender.smtpUser || !newSender.smtpPassword) return;
                setSenderProfiles((prev) => [...prev, { ...newSender, id: `sender_${Date.now()}` }]);
                setNewSender({ id: '', name: '', fromEmail: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpPassword: '' });
              }}
              className="w-full border border-blue-600 text-blue-600 rounded px-2 py-1 text-xs"
            >Add Sender</button>
            <div className="mt-2 space-y-1 max-h-[120px] overflow-auto">
              {senderProfiles.map((s) => <div key={s.id} className="text-xs border border-gray-200 rounded p-1 bg-slate-50">{s.name} ({s.fromEmail})</div>)}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 bg-white border border-gray-300 rounded-xl p-3">
          <div className="text-sm font-semibold text-black mb-2">Canvas</div>
          <div className="h-[700px] border border-gray-200 rounded" onDrop={onDropCanvas} onDragOver={onDragOverCanvas}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
              onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
              onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
              nodeTypes={nodeTypes}
              fitView
            >
              <MiniMap className="bg-white" pannable zoomable />
              <Controls />
              <Background gap={20} size={1} color="#e5e7eb" />
            </ReactFlow>
          </div>
          {validationErrors.length > 0 ? (
            <div className="mt-3 border border-rose-300 bg-rose-50 rounded p-2">
              <div className="text-sm font-semibold text-rose-700">Fix before saving</div>
              <ul className="text-xs text-rose-700 list-disc pl-5">
                {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="xl:col-span-1 space-y-4">
          <div className="bg-white border border-gray-300 rounded-xl p-3">
            <h3 className="font-semibold text-black mb-2">Node Palette</h3>
            <div className="space-y-2 max-h-[220px] overflow-auto">
              <div className="text-xs font-semibold text-gray-700">Triggers</div>
              {TRIGGERS.map((t) => (
                <button key={t.key} draggable onDragStart={(e) => e.dataTransfer.setData('application/workflow-item', JSON.stringify(t))} onClick={() => addNode(t)} className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50">{t.label}</button>
              ))}
              <div className="text-xs font-semibold text-gray-700">Approvals</div>
              {APPROVALS.map((a) => (
                <button key={a.key} draggable onDragStart={(e) => e.dataTransfer.setData('application/workflow-item', JSON.stringify(a))} onClick={() => addNode(a)} className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50">{a.label}</button>
              ))}
              <div className="text-xs font-semibold text-gray-700">Actions</div>
              {ACTIONS.map((a) => (
                <button key={a.key} draggable onDragStart={(e) => e.dataTransfer.setData('application/workflow-item', JSON.stringify(a))} onClick={() => addNode(a)} className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50">{a.label}</button>
              ))}
              <div className="text-xs font-semibold text-gray-700">Timers</div>
              {TIMERS.map((t) => (
                <button key={t.key} draggable onDragStart={(e) => e.dataTransfer.setData('application/workflow-item', JSON.stringify(t))} onClick={() => addNode(t)} className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50">{t.label}</button>
              ))}
              <div className="text-xs font-semibold text-gray-700">Conditions By Module</div>
              {Object.entries(CONDITION_GROUPS).map(([module, items]) => (
                <div key={module} className="border border-gray-200 rounded p-2 bg-slate-50">
                  <div className="text-[11px] font-semibold uppercase text-gray-700 mb-1">{module}</div>
                  {items.map((c) => {
                    const it: PaletteItem = { key: c.key, label: c.label, group: 'condition', module };
                    return <button key={c.key} draggable onDragStart={(e) => e.dataTransfer.setData('application/workflow-item', JSON.stringify(it))} onClick={() => addNode(it)} className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs bg-white hover:bg-gray-50 mb-1">{c.label}</button>;
                  })}
                </div>
              ))}
              <button onClick={() => addNode({ key: 'end', label: 'End', group: 'control' })} className="w-full text-left border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50">End Node</button>
            </div>
          </div>

          <div className="bg-white border border-gray-300 rounded-xl p-3">
            <h3 className="font-semibold text-black mb-2">Inspector</h3>
            {!selectedNode ? <p className="text-xs text-gray-600">Select a node to configure.</p> : (
              <div className="space-y-2">
                <input value={selectedNode.data.label} onChange={(e) => setNodeLabel(selectedNode.id, e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />

                {selectedNode.data.nodeType === 'approval' ? (
                  <>
                    <label className="text-xs text-gray-700">Approval Type</label>
                    <select value={String(selectedNodeConfig.approval_type || 'single')} onChange={(e) => setNodeConfig(selectedNode.id, { approval_type: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
                      {APPROVALS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                    <label className="text-xs text-gray-700">Approver Users</label>
                    <select multiple value={((selectedNodeConfig.approver_user_ids as number[] | undefined) || []).map(String)} onChange={(e) => setNodeConfig(selectedNode.id, { approver_user_ids: parseMultiSelectIds(e) })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs h-20">
                      {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username || `User ${u.id}`}</option>)}
                    </select>
                    <label className="text-xs text-gray-700">Approver Roles</label>
                    <select multiple value={((selectedNodeConfig.approver_role_ids as number[] | undefined) || []).map(String)} onChange={(e) => setNodeConfig(selectedNode.id, { approver_role_ids: parseMultiSelectIds(e) })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs h-20">
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <label className="text-xs text-gray-700">Escalation After (days)</label>
                    <input type="number" min={1} value={Number(selectedNodeConfig.timeout_days || 14)} onChange={(e) => setNodeConfig(selectedNode.id, { timeout_days: Number(e.target.value || 14) })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                    <label className="text-xs text-gray-700">Escalation Users</label>
                    <select multiple value={((selectedNodeConfig.escalation_user_ids as number[] | undefined) || []).map(String)} onChange={(e) => setNodeConfig(selectedNode.id, { escalation_user_ids: parseMultiSelectIds(e), on_timeout: 'escalate' })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs h-20">
                      {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username || `User ${u.id}`}</option>)}
                    </select>
                    <label className="text-xs text-gray-700">Escalation Roles</label>
                    <select multiple value={((selectedNodeConfig.escalation_role_ids as number[] | undefined) || []).map(String)} onChange={(e) => setNodeConfig(selectedNode.id, { escalation_role_ids: parseMultiSelectIds(e), on_timeout: 'escalate' })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs h-20">
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </>
                ) : null}

                {selectedNode.data.nodeType === 'action' ? (
                  <>
                    <label className="text-xs text-gray-700">Action</label>
                    <select value={String(selectedNodeConfig.action_name || 'send_notification_email')} onChange={(e) => setNodeConfig(selectedNode.id, { action_name: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
                      {ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                    {String(selectedNodeConfig.action_name || 'send_notification_email') === 'send_notification_email' ? (
                      <>
                        <label className="text-xs text-gray-700">Sender Profile</label>
                        <select value={String(selectedNodeConfig.sender_profile_id || '')} onChange={(e) => setNodeConfig(selectedNode.id, { sender_profile_id: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
                          <option value="">Select sender</option>
                          {senderProfiles.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.fromEmail})</option>)}
                        </select>
                        <label className="text-xs text-gray-700">Message Template</label>
                        <select
                          value={String(selectedNodeConfig.template_id || '')}
                          onChange={(e) => {
                            const tpl = templates.find((t) => t.id === e.target.value);
                            setNodeConfig(selectedNode.id, { template_id: e.target.value, subject: tpl?.subject || '', body_html: tpl?.body || '' });
                          }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        >
                          <option value="">Select template</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        <label className="text-xs text-gray-700">Subject</label>
                        <input value={String(selectedNodeConfig.subject || '')} onChange={(e) => setNodeConfig(selectedNode.id, { subject: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                        <label className="text-xs text-gray-700">Body</label>
                        <textarea value={String(selectedNodeConfig.body_html || '')} onChange={(e) => setNodeConfig(selectedNode.id, { body_html: e.target.value })} className="w-full min-h-[80px] border border-gray-300 rounded px-2 py-1 text-xs" />
                        <label className="text-xs text-gray-700">Recipient Users</label>
                        <select multiple value={((selectedNodeConfig.user_ids as number[] | undefined) || []).map(String)} onChange={(e) => setNodeConfig(selectedNode.id, { user_ids: parseMultiSelectIds(e) })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs h-20">
                          {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username || `User ${u.id}`}</option>)}
                        </select>
                        <label className="text-xs text-gray-700">Recipient Roles</label>
                        <select multiple value={((selectedNodeConfig.role_ids as number[] | undefined) || []).map(String)} onChange={(e) => setNodeConfig(selectedNode.id, { role_ids: parseMultiSelectIds(e) })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs h-20">
                          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <label className="text-xs text-gray-700 flex items-center gap-2"><input type="checkbox" checked={Boolean(selectedNodeConfig.include_trigger_user)} onChange={(e) => setNodeConfig(selectedNode.id, { include_trigger_user: e.target.checked })} /> Include triggering user</label>
                      </>
                    ) : null}
                  </>
                ) : null}

                {selectedNode.data.nodeType === 'condition' ? (
                  <>
                    <label className="text-xs text-gray-700">Condition Module</label>
                    <select value={String(selectedNodeConfig.module || 'governance')} onChange={(e) => setNodeConfig(selectedNode.id, { module: e.target.value, condition_key: CONDITION_GROUPS[e.target.value]?.[0]?.key || '' })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
                      {Object.keys(CONDITION_GROUPS).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <label className="text-xs text-gray-700">Condition</label>
                    <select value={String(selectedNodeConfig.condition_key || '')} onChange={(e) => setNodeConfig(selectedNode.id, { condition_key: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs">
                      {(CONDITION_GROUPS[String(selectedNodeConfig.module || 'governance')] || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <label className="text-xs text-gray-700">Expected Value</label>
                    <input value={String(selectedNodeConfig.expected_value || '')} onChange={(e) => setNodeConfig(selectedNode.id, { expected_value: e.target.value })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                  </>
                ) : null}

                {selectedNode.data.nodeType === 'timer' ? (
                  <>
                    <label className="text-xs text-gray-700">Wait Seconds</label>
                    <input type="number" min={0} value={Number(selectedNodeConfig.wait_seconds || 3600)} onChange={(e) => setNodeConfig(selectedNode.id, { wait_seconds: Number(e.target.value || 3600) })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                  </>
                ) : null}
              </div>
            )}

            {selectedEdge ? (
              <div className="mt-3 border-t pt-3">
                <div className="text-xs font-semibold text-gray-700 mb-1">Selected Edge</div>
                <input value={String((selectedEdge.data as Record<string, unknown>)?.priority || 1)} onChange={(e) => setEdges((prev) => prev.map((ed) => ed.id === selectedEdge.id ? { ...ed, data: { ...(ed.data as Record<string, unknown>), priority: Number(e.target.value || 1) } } : ed))} className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-1" />
                <select
                  value={String(((selectedEdge.data as Record<string, unknown>)?.condition as Record<string, unknown> | undefined)?._label || 'always')}
                  onChange={(e) => {
                    const next = e.target.value;
                    const condition = next === 'always' ? {} : next === 'true' ? { path: 'step.condition_result', operator: 'eq', value: true, _label: 'true' } : next === 'false' ? { path: 'step.condition_result', operator: 'eq', value: false, _label: 'false' } : { _label: next };
                    setEdges((prev) => prev.map((ed) => ed.id === selectedEdge.id ? { ...ed, data: { ...(ed.data as Record<string, unknown>), condition } } : ed));
                  }}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                >
                  <option value="always">Always</option>
                  <option value="true">True branch</option>
                  <option value="false">False branch</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowEngineAdminPage() {
  return (
    <ReactFlowProvider>
      <WorkflowEngineAdminContent />
    </ReactFlowProvider>
  );
}
