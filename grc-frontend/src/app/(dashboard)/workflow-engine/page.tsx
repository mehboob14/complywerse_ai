'use client';

import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  MiniMap,
  MarkerType,
  Node,
  ReactFlow,
  ReactFlowInstance,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';

import { AIPanel } from './components/AIPanel';
import { AnalyticsTab } from './components/AnalyticsTab';
import { ApprovalsTab } from './components/ApprovalsTab';
import { ConfigPanel } from './components/ConfigPanel';
import { nodeTypes } from './components/CustomNodes';
import { NodePalette } from './components/NodePalette';
import { SchedulesTab } from './components/SchedulesTab';
import { SYSTEM_TEMPLATES, TemplatesModal } from './components/TemplatesModal';
import { TopToolbar } from './components/TopToolbar';
import { VersionDrawer } from './components/VersionDrawer';
import {
  ACTION_KEYS,
  APPROVAL_KEYS,
  AISuggestion,
  AnalyticsOverview,
  BackendEdge,
  BackendNode,
  CONDITION_KEYS,
  EMPTY_NODE_CONFIG_OPTIONS,
  enrichWorkflowNodeConfig,
  formatWorkflowContextLabel,
  FlowNodeData,
  getCatalogContextForKey,
  NodeConfigOptions,
  NodeOptionItem,
  PaletteItem,
  TIMER_KEYS,
  TRIGGER_EVENT_MAP,
  TRIGGER_KEYS,
  WorkflowDefinition,
  WorkflowTemplate,
  WorkflowVersion,
} from './components/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeBackendNode(node: BackendNode): FlowNodeData {
  let nodeType = node.node_type || 'action';
  if (node.is_start || TRIGGER_KEYS.has(node.node_key)) nodeType = 'start';
  if (node.is_terminal || node.node_key === 'end') nodeType = 'end';
  const config = enrichWorkflowNodeConfig(nodeType, (node.config as Record<string, unknown>) || {}, node.node_key);
  return {
    nodeKey: node.node_key,
    nodeType,
    label:
      node.name ||
      (config?.action_name as string) ||
      (config?.trigger_type as string) ||
      node.node_key,
    config,
    module: typeof config.module === 'string' ? config.module : undefined,
    submodule: typeof config.submodule === 'string' ? config.submodule : undefined,
    domains: Array.isArray(config.domains) ? (config.domains as FlowNodeData['domains']) : undefined,
    isStart: node.is_start,
    isTerminal: node.is_terminal,
  };
}

function defaultConfigForGroup(group: string): Record<string, unknown> {
  if (group === 'triggers') return { trigger_type: '' };
  if (group === 'actions' || group === 'platform_functions') return { action_name: '', payload: {} };
  if (group === 'conditions') return { condition_kind: '', condition: { path: 'trigger.severity', operator: 'eq', value: 'high' } };
  if (group === 'approvals') return { approval_type: 'single', approver_user_ids: [], required_approvals: 1, timeout_seconds: 86400, on_timeout: 'escalate' };
  if (group === 'timers') return { timer_kind: 'wait_duration', wait_seconds: 3600 };
  return {};
}

function triggerEventForNodeConfig(config: Record<string, unknown>): string {
  const t = config?.trigger_type as string;
  return TRIGGER_EVENT_MAP[t] || 'manual.trigger';
}

function getEdgeLabel(edge: Edge): string {
  if (typeof edge.label === 'string') return edge.label;
  const cond = (edge.data as Record<string, unknown>)?.condition as Record<string, unknown>;
  return (cond?._label as string) || '';
}

function extractApiErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      if (resp.data && typeof resp.data === 'object') {
        const data = resp.data as Record<string, unknown>;
        if (typeof data.detail === 'string') return data.detail;
        if (Array.isArray(data.detail)) return data.detail.map((d: Record<string, unknown>) => d.msg).join(', ');
      }
    }
    if (typeof e.message === 'string') return e.message;
  }
  return String(error);
}


type CatalogItem = NodeOptionItem & { functionality_name?: string };
type CatalogResponse = {
  triggers?: CatalogItem[];
  actions?: CatalogItem[];
  conditions?: CatalogItem[];
  approvals?: CatalogItem[];
  timers?: CatalogItem[];
  platform_functions?: Record<string, CatalogItem[]>;
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTitleCase(input: string): string {
  return input
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function normalizePlatformFunctionLabel(item: CatalogItem, moduleNameFallback?: string): string {
  const rawBase = (item.functionality_name || item.label || '').trim();
  const moduleName = (item.module || moduleNameFallback || '').trim();
  const submoduleName = (item.submodule || '').trim();

  let label = rawBase;

  // Remove common prefixed forms: "Module / Submodule: Name", "Module - Name", "Submodule: Name"
  const modulePrefix = moduleName ? `${escapeRegExp(moduleName)}\s*[/|:>\-]+\s*` : '';
  const submodulePrefix = submoduleName ? `${escapeRegExp(submoduleName)}\s*[/|:>\-]+\s*` : '';

  if (modulePrefix) {
    label = label.replace(new RegExp(`^${modulePrefix}`, 'i'), '');
  }
  if (submodulePrefix) {
    label = label.replace(new RegExp(`^${submodulePrefix}`, 'i'), '');
  }
  if (modulePrefix && submodulePrefix) {
    label = label.replace(new RegExp(`^${modulePrefix}${submodulePrefix}`, 'i'), '');
  }

  // If still in "X / Y / Z" form, use only the most specific tail segment.
  if (label.includes('/')) {
    const parts = label
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      label = parts[parts.length - 1];
    }
  }

  if (label.includes(':')) {
    const parts = label
      .split(':')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      label = parts[parts.length - 1];
    }
  }

  label = label.replace(/\s+/g, ' ').trim();
  if (!label) {
    const keyTail = item.key.split('.').pop() || item.key;
    return toTitleCase(keyTail.replace(/[^a-zA-Z0-9_\s-]/g, ' '));
  }

  return label;
}

function buildPalette(catalog: CatalogResponse): PaletteItem[] {
  const defaults: PaletteItem[] = [
    ...Array.from(TRIGGER_KEYS).map((k) => {
      const context = getCatalogContextForKey(k);
      return {
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: '',
        group: 'triggers' as const,
        module: context.module,
        submodule: context.submodule,
      };
    }),
    ...Array.from(ACTION_KEYS).map((k) => {
      const context = getCatalogContextForKey(k);
      return {
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: '',
        group: 'actions' as const,
        module: context.module,
        submodule: context.submodule,
      };
    }),
    ...Array.from(CONDITION_KEYS).map((k) => {
      const context = getCatalogContextForKey(k);
      return {
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: '',
        group: 'conditions' as const,
        module: context.module,
        submodule: context.submodule,
      };
    }),
    ...Array.from(APPROVAL_KEYS).map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), description: '', group: 'approvals' as const })),
    ...Array.from(TIMER_KEYS).map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), description: '', group: 'timers' as const })),
    { key: 'subworkflow', label: 'Sub-Workflow', description: '', group: 'control' },
    { key: 'end', label: 'End', description: '', group: 'control' },
  ];

  const seen = new Set(defaults.map((d) => d.key));
  const extras: PaletteItem[] = [];

  const flatGroups: Array<{ group: PaletteItem['group']; items: CatalogItem[] }> = [
    { group: 'triggers', items: catalog.triggers || [] },
    { group: 'actions', items: catalog.actions || [] },
    { group: 'conditions', items: catalog.conditions || [] },
    { group: 'approvals', items: catalog.approvals || [] },
    { group: 'timers', items: catalog.timers || [] },
  ];

  for (const grp of flatGroups) {
    for (const item of grp.items) {
      if (grp.group === 'actions' && item.key.startsWith('platform_action.')) {
        continue;
      }
      if (!seen.has(item.key)) {
        extras.push({ key: item.key, label: item.label, description: '', group: grp.group, module: item.module, submodule: item.submodule });
        seen.add(item.key);
      }
    }
  }

  for (const [moduleName, items] of Object.entries(catalog.platform_functions || {})) {
    for (const item of items) {
      if (!seen.has(item.key)) {
        extras.push({
          key: item.key,
          label: normalizePlatformFunctionLabel(item, moduleName),
          description: '',
          group: 'platform_functions',
          module: item.module || moduleName,
          submodule: item.submodule,
        });
        seen.add(item.key);
      }
    }
  }

  return [...defaults, ...extras];
}

function normalizeActorUsers(payload: unknown): Array<{ id: number; username?: string; email: string; display_name: string }> {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { users?: unknown[] })?.users)
      ? (payload as { users: unknown[] }).users
      : [];

  const users: Array<{ id: number; username?: string; email: string; display_name: string }> = [];
  for (const raw of list) {
    const u = raw as Record<string, unknown>;
    const id = Number(u.id);
    const email = String(u.email || '');
    if (!id || !email) continue;
    const displayName = String(u.display_name || u.full_name || u.username || email || 'User');
    const username = u.username ? String(u.username) : undefined;
    users.push({ id, email, display_name: displayName, username });
  }
  return users;
}

function normalizeActorRoles(payload: unknown): Array<{ id: number; name: string; description?: string }> {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { roles?: unknown[] })?.roles)
      ? (payload as { roles: unknown[] }).roles
      : [];

  const roles: Array<{ id: number; name: string; description?: string }> = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id);
    const name = String(r.name || '');
    if (!id || !name) continue;
    const description = r.description ? String(r.description) : undefined;
    roles.push({ id, name, description });
  }
  return roles;
}

function toFlowNodes(rawNodes: BackendNode[], definitionJson: Record<string, unknown>): Node<FlowNodeData>[] {
  const positions = (definitionJson?.canvas as Record<string, unknown>)?.positions as Record<string, { x: number; y: number }> || {};
  const COLS = 3;
  const GAP_X = 220;
  const GAP_Y = 130;
  return rawNodes.map((n, idx) => {
    const data = normalizeBackendNode(n);
    const pos = positions[n.node_key] || (n.position_x != null && n.position_y != null
      ? { x: n.position_x, y: n.position_y }
      : n.x != null && n.y != null
        ? { x: n.x, y: n.y }
        : { x: (idx % COLS) * GAP_X + 40, y: Math.floor(idx / COLS) * GAP_Y + 40 });
    return {
      id: n.node_key,
      type: 'workflowNode',
      position: pos,
      data,
    };
  });
}

function configWithPaletteContext(item: Pick<PaletteItem, 'key' | 'module' | 'submodule'>, nodeType: string, config: Record<string, unknown>) {
  return enrichWorkflowNodeConfig(
    nodeType,
    {
      ...config,
      ...(item.module ? { module: item.module } : {}),
      ...(item.submodule ? { submodule: item.submodule } : {}),
    },
    item.key,
  );
}

function toFlowEdges(rawEdges: BackendEdge[]): Edge[] {
  return rawEdges.map((e, idx) => ({
    id: `${e.source_node_key}-${e.target_node_key}-${idx}`,
    source: e.source_node_key,
    target: e.target_node_key,
    sourceHandle: e.condition?._handle as string || 'out',
    label: (e.condition?._label as string) || '',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
    style: { stroke: '#64748b', strokeWidth: 1.5 },
    data: { condition: e.condition, priority: e.priority },
  }));
}

// ─── Inner Component (needs ReactFlow context) ──────────────────────────────

function WorkflowEngineContent() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // ─── State ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse>({});
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [overview, setOverview] = useState<AnalyticsOverview>({});
  const [actorUsers, setActorUsers] = useState<Array<{ id: number; username?: string; email: string; display_name: string }>>([]);
  const [actorRoles, setActorRoles] = useState<Array<{ id: number; name: string; description?: string }>>([]); 
  const [nodeConfigOptions, setNodeConfigOptions] = useState<NodeConfigOptions>(EMPTY_NODE_CONFIG_OPTIONS);
  const [emailConfigCount, setEmailConfigCount] = useState(0);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [optimizationTips, setOptimizationTips] = useState<string[]>([]);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Workflow fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerEvent, setTriggerEvent] = useState('manual.trigger');
  const [isActive, setIsActive] = useState(true);
  const [triggerConditionsText, setTriggerConditionsText] = useState('{}');
  const [definitionJsonText, setDefinitionJsonText] = useState('{}');

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);

  // Inspector state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeConfigText, setNodeConfigText] = useState('{}');
  const [edgeConditionText, setEdgeConditionText] = useState('{}');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgePriority, setEdgePriority] = useState(1);

  // UI state
  const [activeTab, setActiveTab] = useState<'builder' | 'workflows' | 'analytics' | 'approvals' | 'schedules'>('builder');
  const [showVersions, setShowVersions] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAI, setShowAI] = useState(false);

  // ─── Derived values ─────────────────────────────────────────────────────────
  const palette = useMemo(() => buildPalette(catalog), [catalog]);
  const actionOptions = useMemo(
    () => palette.filter((p) => p.group === 'actions' || p.group === 'platform_functions'),
    [palette]
  );
  const conditionPathOptions = useMemo(
    () => {
      const base = [
        { value: 'trigger.severity', label: 'trigger.severity' },
        { value: 'trigger.event_name', label: 'trigger.event_name' },
        { value: 'context.resolved', label: 'context.resolved' },
        { value: 'instance.status', label: 'instance.status' },
      ];
      const nodeDerived = nodes.map((n) => ({
        value: `context.node.${n.id}.status`,
        label: `${n.data.label} (${n.id})`,
      }));
      return [...base, ...nodeDerived];
    },
    [nodes]
  );
  const selectedDefinition = useMemo(() => definitions.find((d) => d.id === selectedId), [definitions, selectedId]);
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId), [edges, selectedEdgeId]);

  // ─── Data loading ────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [defsRes, catalogRes, templatesRes, overviewRes] = await Promise.all([
        workflowEngineApi.definitions.list(),
        workflowEngineApi.catalog.nodeTypes(),
        workflowEngineApi.templates.list(),
        workflowEngineApi.analytics.overview(),
      ]);
      setDefinitions(defsRes.data || []);
      setCatalog(catalogRes.data || {});
      setTemplates(templatesRes.data || []);
      setOverview(overviewRes.data || {});

      // Fetch actor users/roles from the workflow-engine catalog (tenant-scoped).
      try {
        const [catalogUsersRes, catalogRolesRes] = await Promise.all([
          workflowEngineApi.catalog.users(),
          workflowEngineApi.catalog.roles(),
        ]);
        setActorUsers(normalizeActorUsers(catalogUsersRes.data));
        setActorRoles(normalizeActorRoles(catalogRolesRes.data));
      } catch {
        // silently ignore; dropdowns will show empty state
      }

      try {
        const configOptsRes = await workflowEngineApi.catalog.nodeConfigOptions();
        const d = configOptsRes.data as NodeConfigOptions;
        if (d && Array.isArray(d.frameworks)) setNodeConfigOptions(d);
      } catch {
        // silently ignore; config panel will fall back to empty defaults
      }

      try {
        const configOptsRes = await workflowEngineApi.catalog.nodeConfigOptions();
        const data = configOptsRes.data as NodeConfigOptions;
        if (data && data.frameworks) setNodeConfigOptions(data);
      } catch {
        // silently ignore; config panel will use empty defaults
      }

      try {
        const setupRes = await workflowEngineApi.notifications.checkSetup();
        setEmailConfigCount(Number(setupRes.data?.email_config_count || 0));
      } catch {
        setEmailConfigCount(0);
      }
    } catch (e) {
      console.error('Failed to load workflow data:', e);
    } finally {
      setLoading(false);
    }
    // Fire-and-forget AI suggestions
    workflowEngineApi.ai.suggestions().then((r) => {
      const d = r.data;
      setAiSuggestions(Array.isArray(d) ? d : (d?.suggestions || []));
    }).catch(() => {});
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Populate form when selection changes
  useEffect(() => {
    if (!selectedDefinition) return;
    setName(selectedDefinition.name || '');
    setDescription(selectedDefinition.description || '');
    setTriggerEvent(selectedDefinition.trigger_event || 'manual.trigger');
    setIsActive(selectedDefinition.is_active ?? true);
    setTriggerConditionsText(JSON.stringify(selectedDefinition.trigger_conditions || {}, null, 2));
    setDefinitionJsonText(JSON.stringify(selectedDefinition.definition_json || {}, null, 2));
    const rawNodes = (selectedDefinition.nodes || []) as BackendNode[];
    const rawEdges = (selectedDefinition.edges || []) as BackendEdge[];
    setNodes(toFlowNodes(rawNodes, selectedDefinition.definition_json as Record<string, unknown>));
    setEdges(toFlowEdges(rawEdges));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [selectedDefinition, setNodes, setEdges]);

  // Sync inspector when selectedNode changes
  useEffect(() => {
    if (selectedNode) {
      setNodeConfigText(JSON.stringify(selectedNode.data.config || {}, null, 2));
    }
  }, [selectedNode]);

  // Sync inspector when selectedEdge changes
  useEffect(() => {
    if (selectedEdge) {
      const cond = (selectedEdge.data as Record<string, unknown>)?.condition as Record<string, unknown> || {};
      const { _label, ...rest } = cond;
      setEdgeConditionText(JSON.stringify(rest, null, 2));
      setEdgeLabel((_label as string) || getEdgeLabel(selectedEdge));
      setEdgePriority(((selectedEdge.data as Record<string, unknown>)?.priority as number) || 1);
    }
  }, [selectedEdge]);

  // ─── Reset draft ─────────────────────────────────────────────────────────────
  const resetDraft = useCallback(() => {
    setSelectedId(null);
    setName('');
    setDescription('');
    setTriggerEvent('manual.trigger');
    setIsActive(true);
    setTriggerConditionsText('{}');
    setDefinitionJsonText('{}');
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    const startConfig = enrichWorkflowNodeConfig('start', { trigger_type: 'manual_trigger' }, 'start');
    const startNode: Node<FlowNodeData> = { id: 'start', type: 'workflowNode', position: { x: 200, y: 60 }, data: { nodeKey: 'start', nodeType: 'start', label: 'Start', config: startConfig, module: typeof startConfig.module === 'string' ? startConfig.module : undefined, submodule: typeof startConfig.submodule === 'string' ? startConfig.submodule : undefined, domains: Array.isArray(startConfig.domains) ? (startConfig.domains as FlowNodeData['domains']) : undefined, isStart: true } };
    const endNode: Node<FlowNodeData> = { id: 'end', type: 'workflowNode', position: { x: 200, y: 240 }, data: { nodeKey: 'end', nodeType: 'end', label: 'End', config: {}, isTerminal: true } };
    setNodes([startNode, endNode]);
    setEdges([{ id: 'start-end', source: 'start', target: 'end', sourceHandle: 'out', animated: true, markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' }, style: { stroke: '#64748b', strokeWidth: 1.5 }, data: {} }]);
  }, [setNodes, setEdges]);

  useEffect(() => { if (nodes.length === 0 && edges.length === 0) resetDraft(); }, []); // eslint-disable-line

  // ─── Canvas serialization ─────────────────────────────────────────────────
  const serializeCanvas = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => { positions[n.id] = n.position; });
    const serializedNodes: BackendNode[] = nodes.map((n) => ({
      node_key: n.id,
      node_type: n.data.nodeType,
      name: n.data.label,
      config: n.data.config,
      is_start: n.data.isStart || n.data.nodeType === 'start',
      is_terminal: n.data.isTerminal || n.data.nodeType === 'end',
    }));
    const serializedEdges: BackendEdge[] = edges.map((e) => ({
      source_node_key: e.source,
      target_node_key: e.target,
      condition: { ...((e.data as Record<string, unknown>)?.condition as Record<string, unknown> || {}), _label: getEdgeLabel(e), _handle: e.sourceHandle || undefined },
      priority: ((e.data as Record<string, unknown>)?.priority as number) || 1,
      source_handle: e.sourceHandle || undefined,
      target_handle: e.targetHandle || undefined,
      label: getEdgeLabel(e),
    }));
    return { nodes: serializedNodes, edges: serializedEdges, positions };
  }, [nodes, edges]);

  const buildPayload = useCallback(() => {
    const { nodes: serializedNodes, edges: serializedEdges, positions } = serializeCanvas();
    let teConds: Record<string, unknown> = {};
    try { teConds = JSON.parse(triggerConditionsText); } catch { /* ignore */ }
    let defJson: Record<string, unknown> = {};
    try { defJson = JSON.parse(definitionJsonText); } catch { /* ignore */ }
    const startNode = nodes.find((n) => n.data.isStart || n.data.nodeType === 'start');
    const computedTriggerEvent = startNode ? triggerEventForNodeConfig(startNode.data.config) : triggerEvent;
    return {
      name: name || 'Untitled Workflow',
      description,
      trigger_event: computedTriggerEvent,
      is_active: isActive,
      trigger_conditions: teConds,
      definition_json: { ...defJson, canvas: { positions } },
      nodes: serializedNodes,
      edges: serializedEdges,
    };
  }, [serializeCanvas, triggerConditionsText, definitionJsonText, nodes, triggerEvent, name, description, isActive]);

  // ─── CRUD operations ─────────────────────────────────────────────────────────
  const saveDefinition = useCallback(async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (selectedId) {
        await workflowEngineApi.definitions.update(selectedId, payload);
      } else {
        const res = await workflowEngineApi.definitions.create(payload);
        const newId = res.data?.id as number | undefined;
        if (newId) setSelectedId(newId);
      }
      await loadAll();
    } catch (e) {
      alert('Save failed: ' + extractApiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [buildPayload, selectedId, loadAll]);

  const deleteDefinition = useCallback(async () => {
    if (!selectedId) return;
    if (!confirm('Delete this workflow? This cannot be undone.')) return;
    await workflowEngineApi.definitions.delete(selectedId);
    await loadAll();
    resetDraft();
  }, [selectedId, loadAll, resetDraft]);

  const configureEmailSettings = useCallback(async () => {
    const configName = window.prompt('Email config name', 'default');
    if (!configName) return;
    const smtpHost = window.prompt('SMTP host', 'smtp.gmail.com');
    if (!smtpHost) return;
    const smtpPortRaw = window.prompt('SMTP port', '587');
    const smtpUsername = window.prompt('SMTP username', '');
    if (!smtpUsername) return;
    const smtpPassword = window.prompt('SMTP password', '');
    if (!smtpPassword) return;
    const fromEmail = window.prompt('From email', smtpUsername);
    if (!fromEmail) return;
    const fromName = window.prompt('From name', 'ComplyVerse') || 'ComplyVerse';

    try {
      await workflowEngineApi.notifications.createEmailConfig({
        config_name: configName,
        smtp_host: smtpHost,
        smtp_port: Number(smtpPortRaw || '587') || 587,
        smtp_username: smtpUsername,
        smtp_password: smtpPassword,
        from_email: fromEmail,
        from_name: fromName,
        use_tls: true,
      });
      await loadAll();
      alert('Email configuration saved');
    } catch (e) {
      alert('Email setup failed: ' + extractApiErrorMessage(e));
    }
  }, [loadAll]);

  const testEmailSettings = useCallback(async () => {
    try {
      const listRes = await workflowEngineApi.notifications.listEmailConfigs();
      const configs = listRes.data || [];
      if (!configs.length) {
        alert('No email config found. Please configure SMTP first.');
        return;
      }
      const targetEmail = window.prompt('Send test email to', actorUsers[0]?.email || '');
      if (!targetEmail) return;
      const configId = Number(configs[0].id);
      await workflowEngineApi.notifications.testEmailConfig(configId, targetEmail);
      alert('Test email sent');
    } catch (e) {
      alert('Email test failed: ' + extractApiErrorMessage(e));
    }
  }, [actorUsers]);

  const triggerSelected = useCallback(async (workflowDefinitionId?: number | unknown) => {
    const targetId = typeof workflowDefinitionId === 'number' ? workflowDefinitionId : selectedId;
    if (!targetId) return;
    const triggerEvent = window.prompt('Trigger event for simulation', 'manual.trigger') ?? 'manual.trigger';
    const payloadInput = window.prompt('Simulation payload JSON', '{}');
    if (payloadInput === null) return;
    let payloadJson: Record<string, unknown> = {};
    try {
      payloadJson = JSON.parse(payloadInput || '{}');
    } catch {
      alert('Invalid simulation payload JSON');
      return;
    }
    try {
      await workflowEngineApi.executions.trigger({ workflow_definition_id: targetId, trigger_event: triggerEvent || 'manual.trigger', payload: payloadJson });
      alert('Workflow triggered successfully');
    } catch (e) {
      alert('Trigger failed: ' + extractApiErrorMessage(e));
    }
  }, [selectedId]);

  // ─── Version history ─────────────────────────────────────────────────────────
  const loadVersions = useCallback(async () => {
    if (!selectedId) return;
    setVersionsLoading(true);
    try {
      const res = await workflowEngineApi.definitions.listVersions(selectedId);
      setVersions(res.data || []);
    } catch { /* ignore */ }
    finally { setVersionsLoading(false); }
  }, [selectedId]);

  const handleShowVersions = useCallback(() => {
    setShowVersions(true);
    loadVersions();
  }, [loadVersions]);

  const handleRollback = useCallback(async (versionId: number) => {
    if (!selectedId) return;
    if (!confirm('Restore this version? The current version will be overwritten.')) return;
    try {
      await workflowEngineApi.definitions.rollback(selectedId, versionId);
      await loadAll();
      setShowVersions(false);
    } catch (e) {
      alert('Rollback failed: ' + extractApiErrorMessage(e));
    }
  }, [selectedId, loadAll]);

  // ─── Template actions ─────────────────────────────────────────────────────────
  const handleUseTemplate = useCallback(async (templateId: number) => {
    if (templateId < 0) {
      // System template — load full workflow graph into canvas
      const tpl = SYSTEM_TEMPLATES.find((t) => t.id === templateId);
      if (tpl && tpl.nodes_json && tpl.edges_json) {
        setSelectedId(null);
        setName(tpl.name);
        setDescription(tpl.description || '');
        setTriggerEvent(tpl.trigger_event || 'manual.trigger');
        setIsActive(true);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setNodes(toFlowNodes(tpl.nodes_json, {}));
        setEdges(toFlowEdges(tpl.edges_json));
        setTimeout(() => fitView({ padding: 0.15 }), 120);
      } else {
        resetDraft();
      }
      setShowTemplates(false);
      return;
    }
    try {
      const res = await workflowEngineApi.templates.instantiate(templateId, 'New from Template');
      await loadAll();
      const newId = res.data?.id;
      if (newId) setSelectedId(newId);
    } catch (e) {
      alert('Failed to use template: ' + extractApiErrorMessage(e));
    }
    setShowTemplates(false);
  }, [loadAll, resetDraft]);

  // ─── AI operations ────────────────────────────────────────────────────────────
  const generateFromNaturalLanguage = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    try {
      const res = await workflowEngineApi.ai.naturalLanguage({ prompt: aiPrompt });
      const data = res.data;
      if (data?.nodes && data?.edges) {
        const rawNodes = data.nodes as BackendNode[];
        const rawEdges = data.edges as BackendEdge[];
        // Clear existing selection and load AI-generated graph
        setSelectedId(null);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setName(data.name || `AI: ${aiPrompt.slice(0, 60)}`);
        setDescription(data.description || '');
        setTriggerEvent(data.trigger_event || 'manual.trigger');
        setIsActive(true);
        setNodes(toFlowNodes(rawNodes, {}));
        setEdges(toFlowEdges(rawEdges));
        setShowAI(false);
        setTimeout(() => fitView({ padding: 0.15 }), 120);
      } else {
        alert('AI returned an incomplete response. Please try again.');
      }
    } catch (e) {
      console.error('AI generation error:', e);
      alert('AI generation failed: ' + extractApiErrorMessage(e));
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, setNodes, setEdges, fitView]);

  const runOptimization = useCallback(async () => {
    if (!selectedId) return;
    setAiGenerating(true);
    try {
      const res = await workflowEngineApi.ai.optimize({ workflow_definition_id: selectedId });
      const raw = res.data?.suggestions || [];
      // Backend returns [{type, title, description, priority}] or legacy string[]
      const tips: string[] = raw.map((s: unknown) =>
        typeof s === 'string' ? s : `[${(s as Record<string, string>).priority?.toUpperCase() || 'INFO'}] ${(s as Record<string, string>).title}: ${(s as Record<string, string>).description}`
      );
      setOptimizationTips(tips);
    } catch { /* ignore */ }
    finally { setAiGenerating(false); }
  }, [selectedId]);

  const handleUseSuggestion = useCallback((suggestion: AISuggestion) => {
    // Build nodes & edges — use provided ones or generate from category/trigger
    let rawNodes: BackendNode[] = suggestion.suggested_nodes || [];
    let rawEdges: BackendEdge[] = suggestion.suggested_edges || [];

    if (rawNodes.length === 0) {
      // Generate a sensible default workflow based on category
      const trigger = suggestion.trigger_event || 'manual_trigger';
      const cat = (suggestion.category || '').toLowerCase();

      const startNode: BackendNode = { node_key: 'start', node_type: 'start', name: suggestion.title, is_start: true, config: { trigger_type: trigger }, x: 350, y: 30 };
      const endNode: BackendNode = { node_key: 'end', node_type: 'end', name: 'End', is_terminal: true, config: {}, x: 350, y: 0 };

      if (cat.includes('risk')) {
        rawNodes = [
          startNode,
          { node_key: 'check_risk', node_type: 'condition', name: 'Evaluate Risk Level', config: { condition_type: 'check_risk_level' }, x: 350, y: 160 },
          { node_key: 'escalate', node_type: 'action', name: 'Escalate to Management', config: { action_name: 'escalate_to_management' }, x: 100, y: 300 },
          { node_key: 'notify', node_type: 'action', name: 'Send Notification', config: { action_name: 'send_notification_email', subject: suggestion.title }, x: 600, y: 300 },
          { node_key: 'approval', node_type: 'approval', name: 'Manager Approval', config: { approval_type: 'single', timeout_hours: 24 }, x: 350, y: 440 },
          { node_key: 'evidence', node_type: 'action', name: 'Request Evidence', config: { action_name: 'request_evidence_upload' }, x: 350, y: 570 },
          { node_key: 'report', node_type: 'action', name: 'Generate Report', config: { action_name: 'generate_report' }, x: 350, y: 700 },
          { ...endNode, y: 830 },
        ];
        rawEdges = [
          { source_node_key: 'start', target_node_key: 'check_risk' },
          { source_node_key: 'check_risk', target_node_key: 'escalate', condition: { _label: 'Critical / High', _handle: 'condition-true' } },
          { source_node_key: 'check_risk', target_node_key: 'notify', condition: { _label: 'Medium / Low', _handle: 'condition-false' } },
          { source_node_key: 'escalate', target_node_key: 'approval' },
          { source_node_key: 'notify', target_node_key: 'approval' },
          { source_node_key: 'approval', target_node_key: 'evidence', condition: { _label: 'Approved' } },
          { source_node_key: 'evidence', target_node_key: 'report' },
          { source_node_key: 'report', target_node_key: 'end' },
        ];
      } else if (cat.includes('incident')) {
        rawNodes = [
          startNode,
          { node_key: 'check_severity', node_type: 'condition', name: 'Check Severity', config: { condition_type: 'check_risk_level' }, x: 350, y: 160 },
          { node_key: 'escalate', node_type: 'action', name: 'Escalate to Management', config: { action_name: 'escalate_to_management' }, x: 100, y: 300 },
          { node_key: 'assign_owner', node_type: 'action', name: 'Assign Incident Owner', config: { action_name: 'assign_control_owner' }, x: 600, y: 300 },
          { node_key: 'collect_evidence', node_type: 'action', name: 'Collect Evidence', config: { action_name: 'request_evidence_upload' }, x: 350, y: 440 },
          { node_key: 'notify', node_type: 'action', name: 'Send Resolution Notice', config: { action_name: 'send_notification_email', subject: 'Incident Resolved' }, x: 350, y: 570 },
          { ...endNode, y: 700 },
        ];
        rawEdges = [
          { source_node_key: 'start', target_node_key: 'check_severity' },
          { source_node_key: 'check_severity', target_node_key: 'escalate', condition: { _label: 'Critical', _handle: 'condition-true' } },
          { source_node_key: 'check_severity', target_node_key: 'assign_owner', condition: { _label: 'Normal', _handle: 'condition-false' } },
          { source_node_key: 'escalate', target_node_key: 'collect_evidence' },
          { source_node_key: 'assign_owner', target_node_key: 'collect_evidence' },
          { source_node_key: 'collect_evidence', target_node_key: 'notify' },
          { source_node_key: 'notify', target_node_key: 'end' },
        ];
      } else if (cat.includes('evidence')) {
        rawNodes = [
          startNode,
          { node_key: 'check_age', node_type: 'condition', name: 'Check Evidence Age', config: { condition_type: 'check_evidence_age', max_days: 90 }, x: 350, y: 160 },
          { node_key: 'request_upload', node_type: 'action', name: 'Request New Evidence', config: { action_name: 'request_evidence_upload' }, x: 350, y: 300 },
          { node_key: 'sla', node_type: 'timer', name: 'SLA Countdown (48h)', config: { timer_type: 'sla_countdown', duration_hours: 48 }, x: 350, y: 440 },
          { node_key: 'escalate', node_type: 'action', name: 'Escalate Overdue', config: { action_name: 'escalate_to_management' }, x: 350, y: 570 },
          { ...endNode, y: 700 },
        ];
        rawEdges = [
          { source_node_key: 'start', target_node_key: 'check_age' },
          { source_node_key: 'check_age', target_node_key: 'request_upload', condition: { _label: 'Expired / Expiring', _handle: 'condition-true' } },
          { source_node_key: 'check_age', target_node_key: 'end', condition: { _label: 'Valid', _handle: 'condition-false' } },
          { source_node_key: 'request_upload', target_node_key: 'sla' },
          { source_node_key: 'sla', target_node_key: 'escalate' },
          { source_node_key: 'escalate', target_node_key: 'end' },
        ];
      } else if (cat.includes('audit')) {
        rawNodes = [
          startNode,
          { node_key: 'create_finding', node_type: 'action', name: 'Create Audit Scope', config: { action_name: 'create_audit_finding' }, x: 350, y: 160 },
          { node_key: 'approval', node_type: 'approval', name: 'Audit Plan Approval', config: { approval_type: 'multi_level', levels: ['Audit Manager', 'CAE'] }, x: 350, y: 300 },
          { node_key: 'assign', node_type: 'action', name: 'Assign Auditors', config: { action_name: 'assign_control_owner' }, x: 350, y: 440 },
          { node_key: 'evidence', node_type: 'action', name: 'Request Workpapers', config: { action_name: 'request_evidence_upload' }, x: 350, y: 570 },
          { node_key: 'report', node_type: 'action', name: 'Generate Audit Report', config: { action_name: 'generate_report' }, x: 350, y: 700 },
          { ...endNode, y: 830 },
        ];
        rawEdges = [
          { source_node_key: 'start', target_node_key: 'create_finding' },
          { source_node_key: 'create_finding', target_node_key: 'approval' },
          { source_node_key: 'approval', target_node_key: 'assign', condition: { _label: 'Approved' } },
          { source_node_key: 'assign', target_node_key: 'evidence' },
          { source_node_key: 'evidence', target_node_key: 'report' },
          { source_node_key: 'report', target_node_key: 'end' },
        ];
      } else if (cat.includes('policy') || cat.includes('access')) {
        rawNodes = [
          startNode,
          { node_key: 'notify', node_type: 'action', name: 'Notify Stakeholders', config: { action_name: 'send_notification_email', subject: suggestion.title }, x: 350, y: 160 },
          { node_key: 'approval', node_type: 'approval', name: 'Review & Approve', config: { approval_type: 'multi_level', levels: ['Dept Head', 'CISO'] }, x: 350, y: 300 },
          { node_key: 'check_approval', node_type: 'condition', name: 'Check Outcome', config: { condition_type: 'check_approval_status' }, x: 350, y: 440 },
          { node_key: 'publish', node_type: 'action', name: 'Publish & Distribute', config: { action_name: 'send_notification_email', subject: `${suggestion.title} — Approved` }, x: 100, y: 570 },
          { node_key: 'reject', node_type: 'action', name: 'Rejection Notice', config: { action_name: 'send_notification_email', subject: `${suggestion.title} — Rejected` }, x: 600, y: 570 },
          { node_key: 'report', node_type: 'action', name: 'Generate Report', config: { action_name: 'generate_report' }, x: 350, y: 700 },
          { ...endNode, y: 830 },
        ];
        rawEdges = [
          { source_node_key: 'start', target_node_key: 'notify' },
          { source_node_key: 'notify', target_node_key: 'approval' },
          { source_node_key: 'approval', target_node_key: 'check_approval' },
          { source_node_key: 'check_approval', target_node_key: 'publish', condition: { _label: 'Approved', _handle: 'condition-true' } },
          { source_node_key: 'check_approval', target_node_key: 'reject', condition: { _label: 'Rejected', _handle: 'condition-false' } },
          { source_node_key: 'publish', target_node_key: 'report' },
          { source_node_key: 'reject', target_node_key: 'report' },
          { source_node_key: 'report', target_node_key: 'end' },
        ];
      } else {
        // Generic fallback workflow
        rawNodes = [
          startNode,
          { node_key: 'notify', node_type: 'action', name: 'Send Notification', config: { action_name: 'send_notification_email', subject: suggestion.title }, x: 350, y: 160 },
          { node_key: 'approval', node_type: 'approval', name: 'Manager Approval', config: { approval_type: 'single', timeout_hours: 24 }, x: 350, y: 300 },
          { node_key: 'action', node_type: 'action', name: 'Execute Action', config: { action_name: 'assign_control_owner' }, x: 350, y: 440 },
          { node_key: 'report', node_type: 'action', name: 'Generate Report', config: { action_name: 'generate_report' }, x: 350, y: 570 },
          { ...endNode, y: 700 },
        ];
        rawEdges = [
          { source_node_key: 'start', target_node_key: 'notify' },
          { source_node_key: 'notify', target_node_key: 'approval' },
          { source_node_key: 'approval', target_node_key: 'action', condition: { _label: 'Approved' } },
          { source_node_key: 'action', target_node_key: 'report' },
          { source_node_key: 'report', target_node_key: 'end' },
        ];
      }
    }

    setSelectedId(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNodes(toFlowNodes(rawNodes, {}));
    setEdges(toFlowEdges(rawEdges));
    setName(suggestion.title);
    setDescription(suggestion.description || '');
    setTriggerEvent(suggestion.trigger_event || 'manual.trigger');
    setIsActive(true);
    setShowAI(false);
    setTimeout(() => fitView({ padding: 0.15 }), 120);
  }, [setNodes, setEdges, fitView]);

  // ─── Canvas event handlers ────────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) => {
      const isTrueHandle = connection.sourceHandle === 'out_true';
      const isFalseHandle = connection.sourceHandle === 'out_false';
      const label = isTrueHandle ? 'true' : isFalseHandle ? 'false' : '';
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            label,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
            style: { stroke: isTrueHandle ? '#22c55e' : isFalseHandle ? '#ef4444' : '#64748b', strokeWidth: 1.5 },
            data: { condition: { _label: label, _handle: connection.sourceHandle }, priority: 1 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragStart = useCallback((event: React.DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData('application/workflow-node', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDropCanvas = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!reactFlowInstance || !reactFlowWrapper.current) return;
      const raw = event.dataTransfer.getData('application/workflow-node');
      if (!raw) return;
      const item: PaletteItem = JSON.parse(raw);
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      const nodeKey = `${item.key}_${Date.now()}`;
      const isStart = item.group === 'triggers';
      const isEnd = item.key === 'end';
      const nodeType = isStart ? 'start' : isEnd ? 'end' : item.group === 'conditions' ? 'condition' : item.group === 'approvals' ? 'approval' : item.group === 'timers' ? 'timer' : item.key === 'subworkflow' ? 'subworkflow' : 'action';
      let config = { ...defaultConfigForGroup(item.group) };
      if (isStart) config.trigger_type = item.key;
      if (nodeType === 'action') config.action_name = item.key;
      if (nodeType === 'condition') config.condition_kind = item.key;
      if (nodeType === 'approval') config.approval_type = item.key;
      if (nodeType === 'timer') config.timer_kind = item.key;
      config = configWithPaletteContext(item, nodeType, config);
      const newNode: Node<FlowNodeData> = {
        id: nodeKey,
        type: 'workflowNode',
        position,
        data: {
          nodeKey,
          nodeType,
          label: item.label,
          config,
          module: typeof config.module === 'string' ? config.module : undefined,
          submodule: typeof config.submodule === 'string' ? config.submodule : undefined,
          domains: Array.isArray(config.domains) ? (config.domains as FlowNodeData['domains']) : undefined,
          isStart,
          isTerminal: isEnd,
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const onDragOverCanvas = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const updateSelectedNode = useCallback(
    (field: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          if (field === 'label') return { ...n, data: { ...n.data, label: value as string } };
          let nextConfig = { ...n.data.config, [field]: value };
          if (['trigger_type', 'action_name', 'condition_kind', 'approval_type', 'timer_kind', 'module', 'submodule'].includes(field)) {
            nextConfig = enrichWorkflowNodeConfig(n.data.nodeType, nextConfig, n.id);
          }
          return {
            ...n,
            data: {
              ...n.data,
              config: nextConfig,
              module: typeof nextConfig.module === 'string' ? nextConfig.module : undefined,
              submodule: typeof nextConfig.submodule === 'string' ? nextConfig.submodule : undefined,
              domains: Array.isArray(nextConfig.domains) ? (nextConfig.domains as FlowNodeData['domains']) : undefined,
            },
          };
        })
      );
    },
    [selectedNodeId, setNodes]
  );

  const applyNodeConfig = useCallback(() => {
    try {
      const parsed = JSON.parse(nodeConfigText);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const nextConfig = enrichWorkflowNodeConfig(n.data.nodeType, parsed, n.id);
          return {
            ...n,
            data: {
              ...n.data,
              config: nextConfig,
              module: typeof nextConfig.module === 'string' ? nextConfig.module : undefined,
              submodule: typeof nextConfig.submodule === 'string' ? nextConfig.submodule : undefined,
              domains: Array.isArray(nextConfig.domains) ? (nextConfig.domains as FlowNodeData['domains']) : undefined,
            },
          };
        })
      );
    } catch {
      alert('Invalid JSON in config');
    }
  }, [nodeConfigText, selectedNodeId, setNodes]);

  const applyEdgeConfig = useCallback(() => {
    try {
      const parsed = JSON.parse(edgeConditionText);
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== selectedEdgeId) return e;
          return { ...e, label: edgeLabel, data: { condition: { ...parsed, _label: edgeLabel }, priority: edgePriority } };
        })
      );
    } catch {
      alert('Invalid JSON in edge condition');
    }
  }, [edgeConditionText, edgeLabel, edgePriority, selectedEdgeId, setEdges]);

  const deleteSelected = useCallback(() => {
    if (selectedNodeId) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    } else if (selectedEdgeId) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }, [selectedNodeId, selectedEdgeId, setNodes, setEdges]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-sm text-gray-400">Loading Workflow Engine...</div>
      </div>
    );
  }

  const TABS = [
    { key: 'builder' as const, label: 'Builder' },
    { key: 'workflows' as const, label: 'Workflows' },
    { key: 'analytics' as const, label: 'Analytics' },
    { key: 'approvals' as const, label: 'Approvals' },
    { key: 'schedules' as const, label: 'Schedules & Webhooks' },
  ];

  const sortedDefinitions = [...definitions].sort((a, b) =>
    (new Date(b.updated_at || '').getTime() || 0) - (new Date(a.updated_at || '').getTime() || 0)
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div>
          <h1 className="text-base font-bold text-gray-900">Workflow Engine</h1>
          <p className="text-[11px] text-gray-500">Build, automate, and monitor GRC workflows</p>
        </div>
        {/* Tab nav */}
        <div className="flex items-center gap-0 ml-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeTab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {/* Overview stats */}
        {[
          { label: 'Total', value: overview.total_instances ?? 0, color: 'text-gray-700' },
          { label: 'Completed', value: overview.completed ?? 0, color: 'text-green-600' },
          { label: 'Running', value: overview.running ?? 0, color: 'text-blue-600' },
          { label: 'Failed', value: overview.failed ?? 0, color: 'text-red-500' },
          { label: 'Waiting', value: overview.waiting ?? 0, color: 'text-yellow-600' },
        ].map((stat) => (
          <div key={stat.label} className="text-center px-3 border-l border-gray-100 first:border-0">
            <div className={`text-base font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">{stat.label}</div>
          </div>
        ))}
      </div>

      {activeTab === 'workflows' && (
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800">Email Notification Setup</div>
              <div className="text-xs text-gray-500">Active SMTP configs: {emailConfigCount}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={configureEmailSettings}
                className="text-xs px-3 py-1.5 border border-blue-300 text-blue-700 rounded bg-blue-50 hover:bg-blue-100"
              >
                Configure SMTP
              </button>
              <button
                onClick={testEmailSettings}
                className="text-xs px-3 py-1.5 border border-green-300 text-green-700 rounded bg-green-50 hover:bg-green-100"
              >
                Send Test Email
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-800">
              Saved Workflows ({sortedDefinitions.length})
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Trigger</th>
                  <th className="text-left px-4 py-2">Version</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Updated</th>
                  <th className="text-left px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedDefinitions.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-800">{d.name}</td>
                    <td className="px-4 py-2 text-gray-600">{d.trigger_event}</td>
                    <td className="px-4 py-2 text-gray-600">v{d.version}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {d.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{d.updated_at ? new Date(d.updated_at).toLocaleString() : '-'}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedId(d.id);
                            setActiveTab('builder');
                          }}
                          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => triggerSelected(d.id)}
                          className="text-xs px-2 py-1 border border-green-300 text-green-700 rounded bg-green-50 hover:bg-green-100"
                        >
                          Test
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sortedDefinitions.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-gray-400" colSpan={6}>
                      No workflows saved yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Non-builder tabs */}
      {activeTab === 'analytics' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <AnalyticsTab />
        </div>
      )}
      {activeTab === 'approvals' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ApprovalsTab />
        </div>
      )}
      {activeTab === 'schedules' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SchedulesTab definitions={definitions} />
        </div>
      )}

      {/* Builder tab (hidden when other tab active, to preserve state) */}
      <div className={activeTab === 'builder' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>

      {/* Toolbar */}
      <TopToolbar
        definitions={definitions}
        selectedId={selectedId}
        selectedDefinition={selectedDefinition}
        name={name}
        isActive={isActive}
        saving={saving}
        onSelectDefinition={setSelectedId}
        onNameChange={setName}
        onToggleActive={() => setIsActive((v) => !v)}
        onSave={saveDefinition}
        onTrigger={() => triggerSelected()}
        onDelete={deleteDefinition}
        onNewWorkflow={resetDraft}
        onShowVersions={handleShowVersions}
        onShowTemplates={() => setShowTemplates(true)}
        onShowAI={() => setShowAI((v) => !v)}
        onFitView={() => fitView({ padding: 0.1 })}
        onZoomIn={() => zoomIn()}
        onZoomOut={() => zoomOut()}
      />

      {/* 3-panel body */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Left: Node Palette */}
        <div className="w-48 shrink-0 flex flex-col min-h-0">
          <NodePalette
            palette={palette}
            onDragStart={onDragStart}
            onAddNode={(item) => {
              // Click-to-add: place in center of canvas
              const nodeKey = `${item.key}_${Date.now()}`;
              const isStart = item.group === 'triggers';
              const isEnd = item.key === 'end';
              const nodeType = isStart ? 'start' : isEnd ? 'end' : item.group === 'conditions' ? 'condition' : item.group === 'approvals' ? 'approval' : item.group === 'timers' ? 'timer' : item.key === 'subworkflow' ? 'subworkflow' : 'action';
              let config = { ...defaultConfigForGroup(item.group) };
              if (isStart) config.trigger_type = item.key;
              if (nodeType === 'action') config.action_name = item.key;
              if (nodeType === 'condition') config.condition_kind = item.key;
              config = configWithPaletteContext(item, nodeType, config);
              setNodes((nds) => [...nds, {
                id: nodeKey,
                type: 'workflowNode',
                position: { x: 250, y: 150 + nds.length * 100 },
                data: {
                  nodeKey,
                  nodeType,
                  label: item.label,
                  config,
                  module: typeof config.module === 'string' ? config.module : undefined,
                  submodule: typeof config.submodule === 'string' ? config.submodule : undefined,
                  domains: Array.isArray(config.domains) ? (config.domains as FlowNodeData['domains']) : undefined,
                  isStart,
                  isTerminal: isEnd,
                },
              }]);
            }}
          />
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 min-w-0 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDropCanvas}
            onDragOver={onDragOverCanvas}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            className="bg-slate-50"
          >
            <MiniMap
              nodeStrokeWidth={2}
              className="!bg-white !border !border-gray-200 !rounded-lg"
              maskColor="rgba(0,0,0,0.04)"
            />
            <Controls className="!bg-white !border !border-gray-200 !rounded-lg" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
          </ReactFlow>

          {/* Empty state */}
          {nodes.length <= 2 && edges.length <= 1 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-gray-300">
                <div className="text-4xl mb-2">⟵</div>
                <div className="text-sm font-medium">Drag nodes from the palette</div>
                <div className="text-xs mt-1">or use the AI panel to generate a workflow</div>
              </div>
            </div>
          )}

          {/* Version drawer overlay */}
          {showVersions && (
            <VersionDrawer
              versions={versions}
              loading={versionsLoading}
              onClose={() => setShowVersions(false)}
              onRollback={handleRollback}
            />
          )}

          {/* AI panel overlay */}
          {showAI && (
            <AIPanel
              onClose={() => setShowAI(false)}
              aiPrompt={aiPrompt}
              aiGenerating={aiGenerating}
              aiSuggestions={aiSuggestions}
              optimizationTips={optimizationTips}
              onPromptChange={setAiPrompt}
              onGenerate={generateFromNaturalLanguage}
              onOptimize={runOptimization}
              onUseSuggestion={handleUseSuggestion}
              hasSelectedWorkflow={!!selectedId}
            />
          )}
        </div>

        {/* Right: Config Panel */}
        <div className="w-60 shrink-0 flex flex-col min-h-0">
          <ConfigPanel
            actorUsers={actorUsers}
            actorRoles={actorRoles}
            actionOptions={actionOptions}
            conditionPathOptions={conditionPathOptions}
            nodeConfigOptions={nodeConfigOptions}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            nodeConfigText={nodeConfigText}
            edgeConditionText={edgeConditionText}
            edgeLabel={edgeLabel}
            edgePriority={edgePriority}
            onUpdateNodeConfig={updateSelectedNode}
            onApplyNodeConfig={applyNodeConfig}
            onApplyEdgeConfig={applyEdgeConfig}
            onSetNodeConfigText={setNodeConfigText}
            onSetEdgeConditionText={setEdgeConditionText}
            onSetEdgeLabel={setEdgeLabel}
            onSetEdgePriority={setEdgePriority}
            onDeleteSelected={deleteSelected}
            onClose={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
          />
        </div>
      </div>

      {/* Templates modal */}
      {showTemplates && (
        <TemplatesModal
          templates={templates}
          onClose={() => setShowTemplates(false)}
          onUse={handleUseTemplate}
        />
      )}
      </div>{/* end builder tab wrapper */}
    </div>
  );
}

// ─── Root Export ──────────────────────────────────────────────────────────────

export default function WorkflowEngineAdminPage() {
  return (
    <ReactFlowProvider>
      <WorkflowEngineContent />
    </ReactFlowProvider>
  );
}
