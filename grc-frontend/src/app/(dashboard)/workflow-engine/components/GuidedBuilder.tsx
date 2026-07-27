'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Guided Workflow Builder — the FIXED SHELL with a flexible interior.
//
//   [Start] → [Trigger Node(s)] → [Notification Node(s)] → [Escalation] → [End]
//
//  • Start / End      — UX-only anchors (no config).
//  • Trigger block    — 1+ platform-functionality nodes. OR logic: if ANY fires,
//                       the workflow runs. Config is derived from the underlying
//                       platform function (param schema).
//  • Notification block — In-App and/or Email. Optional, order-free.
//  • Escalation       — single node, hidden until ≥1 trigger is configured.
//                       Renders a SEPARATE config section per trigger, using a
//                       curated per-domain field set.
//
// Serializes to the same backend payload the engine already understands
// (nodes/edges) PLUS the new `trigger_events` OR-set.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Zap, Bell, Mail, ArrowUpCircle, Plus, Trash2, X, ChevronDown, Save,
  PlayCircle, StopCircle, Loader2, Search, AlertTriangle, Check, FileText,
} from 'lucide-react';
import { workflowEngineApi } from '@/lib/api';
import {
  formatNodeLabel,
  inferTriggerEventFromActionName,
  inferWorkflowDomainsFromModuleName,
  type NodeParamField,
  type NodeParamSchemas,
  type WorkflowDomain,
} from './types';

// ─── Curated per-domain escalation field templates (open-question #1: each
// trigger gets its own escalation type/fields) ───────────────────────────────
type EscFieldType = 'role' | 'number' | 'select' | 'text' | 'boolean';
type EscField = { name: string; label: string; type: EscFieldType; options?: string[]; help?: string };

const SEVERITY = ['low', 'medium', 'high', 'critical'];

const ESCALATION_DOMAIN_FIELDS: Partial<Record<WorkflowDomain, EscField[]>> = {
  risk: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'risk_level_threshold', label: 'Escalate at risk level', type: 'select', options: SEVERITY },
    { name: 'days_before_escalation', label: 'Days before escalation', type: 'number' },
    { name: 'reescalation_interval_days', label: 'Re-escalate every (days)', type: 'number' },
  ],
  compliance: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'assigned_reviewer', label: 'Assigned reviewer', type: 'role' },
    { name: 'deadline_threshold_days', label: 'Days before deadline', type: 'number' },
    { name: 'regulatory_flag', label: 'Flag as regulatory escalation', type: 'boolean' },
  ],
  evidence: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'assigned_reviewer', label: 'Assigned reviewer', type: 'role' },
    { name: 'overdue_threshold_days', label: 'Days overdue before escalation', type: 'number' },
  ],
  vulnerability: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'severity_threshold', label: 'Minimum severity', type: 'select', options: SEVERITY },
    { name: 'sla_overdue_days', label: 'SLA overdue by (days)', type: 'number' },
    { name: 'reescalation_interval_days', label: 'Re-escalate every (days)', type: 'number' },
  ],
  governance: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'assigned_reviewer', label: 'Assigned reviewer', type: 'role' },
    { name: 'overdue_threshold_days', label: 'Days overdue before escalation', type: 'number' },
    { name: 'committee_notify', label: 'Notify committee', type: 'boolean' },
  ],
  audit: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'finding_severity_threshold', label: 'Minimum finding severity', type: 'select', options: SEVERITY },
    { name: 'days_before_escalation', label: 'Days before escalation', type: 'number' },
  ],
  control: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'effectiveness_threshold', label: 'Escalate below effectiveness', type: 'select', options: ['ineffective', 'partially_effective', 'effective'] },
    { name: 'days_before_escalation', label: 'Days before escalation', type: 'number' },
  ],
  assets: [
    { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
    { name: 'criticality_threshold', label: 'Minimum criticality', type: 'select', options: SEVERITY },
    { name: 'days_before_escalation', label: 'Days before escalation', type: 'number' },
  ],
};

const ESCALATION_DEFAULT_FIELDS: EscField[] = [
  { name: 'escalate_to_role', label: 'Escalate to role', type: 'role' },
  { name: 'threshold', label: 'Escalation threshold', type: 'text' },
  { name: 'days_before_escalation', label: 'Days before escalation', type: 'number' },
  { name: 'reescalation_interval_days', label: 'Re-escalate every (days)', type: 'number' },
];

function escalationFieldsForDomain(domain: WorkflowDomain): EscField[] {
  return ESCALATION_DOMAIN_FIELDS[domain] || ESCALATION_DEFAULT_FIELDS;
}

// ─── Local builder state shapes ──────────────────────────────────────────────
type TriggerItem = {
  uid: string;
  // 'crud'  → a platform-function node (platform_action.…), event inferred.
  // 'event' → a curated platform event (e.g. evidence_uploaded); event IS the key.
  kind: 'crud' | 'event';
  key: string;               // platform-function node key OR curated event key
  label: string;
  module?: string;
  submodule?: string;
  domain: WorkflowDomain;
  triggerEvent: string;      // canonical event the backend matches on
  config: Record<string, unknown>;
};

type RoleChoice = { id: number; name: string };
type UserChoice = { id: number; label: string; email?: string };

type NotificationItem = {
  uid: string;
  channel: 'in_app' | 'email';
  roleIds: number[];         // selected role IDs
  userIds: number[];         // selected user IDs
  message: string;
  timing: 'immediate' | 'delayed';
  delayMinutes: number;
};

type CatalogPF = { key: string; label?: string; module?: string; submodule?: string };
type CatalogTrigger = { key: string; label?: string };
type CatalogResponse = {
  platform_functions?: Record<string, CatalogPF[]>;
  triggers?: CatalogTrigger[];
};

// Orchestration triggers that need their own scheduling/secret config — out of
// scope for the event-driven guided shell, so they're not offered as events.
const EXCLUDED_CURATED_TRIGGERS = new Set(['manual_trigger', 'schedule_recurring', 'webhook']);

// Bucket a curated event key into a display group + escalation domain so the
// picker can present platform events hierarchically alongside CRUD functions.
function curatedTriggerGroup(key: string): { group: string; domain: WorkflowDomain } {
  const k = (key || '').toLowerCase();
  if (k.startsWith('risk') || k.startsWith('kri') || k.startsWith('incident')) return { group: 'Risk Management', domain: 'risk' };
  if (k.startsWith('vulnerab') || k.startsWith('new_vulnerab')) return { group: 'Vulnerability Management', domain: 'vulnerability' };
  if (k.startsWith('evidence')) return { group: 'Compliance · Evidence', domain: 'evidence' };
  if (k.startsWith('framework') || k.startsWith('assessment') || k.startsWith('compliance') || k.startsWith('certification')) return { group: 'Compliance', domain: 'compliance' };
  if (k.startsWith('governance') || k.startsWith('policy') || k.startsWith('attestation') || k.startsWith('control')) return { group: 'Governance', domain: 'governance' };
  if (k.startsWith('audit')) return { group: 'Audit', domain: 'audit' };
  if (k.startsWith('asset')) return { group: 'Assets', domain: 'assets' };
  if (k.startsWith('issue')) return { group: 'Issue Management', domain: 'workflow' };
  if (k.startsWith('cis') || k.startsWith('agent') || k.startsWith('connection')) return { group: 'CIS / Agents', domain: 'compliance' };
  return { group: 'Other events', domain: 'workflow' };
}

// Template placeholders the backend resolves at send-time from the trigger
// event context (_build_template_context in action_handlers.py).
const TEMPLATE_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: '{{title}}', label: 'Record title' },
  { token: '{{resource_type}}', label: 'Record type' },
  { token: '{{resource_id}}', label: 'Record ID' },
  { token: '{{action}}', label: 'Action' },
  { token: '{{severity}}', label: 'Severity' },
  { token: '{{status}}', label: 'Status' },
  { token: '{{created_by_name}}', label: 'Triggered by' },
  { token: '{{event_timestamp}}', label: 'When' },
  { token: '{{workflow_name}}', label: 'Workflow name' },
];

// Ready-to-use message templates, surfaced per notification node. The ones
// matching the workflow's trigger domain are offered first.
const MESSAGE_TEMPLATES: { name: string; domains: WorkflowDomain[]; text: string }[] = [
  { name: 'Risk alert', domains: ['risk'], text: 'A risk "{{title}}" (severity: {{severity}}) was {{action}} by {{created_by_name}} on {{event_timestamp}}. Please review it in the platform.' },
  { name: 'Compliance / evidence', domains: ['compliance', 'evidence'], text: '{{resource_type}} "{{title}}" was {{action}} (status: {{status}}). Review is required for the "{{workflow_name}}" workflow.' },
  { name: 'Vulnerability', domains: ['vulnerability'], text: 'Vulnerability "{{title}}" (severity: {{severity}}) needs attention — current status {{status}}. Detected {{event_timestamp}}.' },
  { name: 'Governance / policy', domains: ['governance'], text: 'Governance item "{{title}}" was {{action}} by {{created_by_name}}. Action may be required.' },
  { name: 'Audit', domains: ['audit'], text: 'Audit activity: {{action}} on {{resource_type}} #{{resource_id}} by {{created_by_name}} ({{event_timestamp}}).' },
  { name: 'Issue', domains: ['workflow'], text: 'Issue "{{title}}" (severity: {{severity}}) — current status {{status}}. Please action it via "{{workflow_name}}".' },
  { name: 'Generic notice', domains: [], text: 'The "{{workflow_name}}" workflow ran: {{action}} on {{resource_type}} #{{resource_id}}. Please review this item.' },
];

// Order templates so the ones relevant to the active trigger domains lead.
function templatesForDomains(domains: WorkflowDomain[]): typeof MESSAGE_TEMPLATES {
  const set = new Set(domains);
  const relevant = MESSAGE_TEMPLATES.filter((t) => t.domains.some((d) => set.has(d)));
  const rest = MESSAGE_TEMPLATES.filter((t) => !relevant.includes(t));
  return [...relevant, ...rest];
}

let _uidCounter = 0;
const uid = (p: string) => `${p}_${++_uidCounter}`;

// ─── Component ───────────────────────────────────────────────────────────────
export default function GuidedBuilder({
  definitionId,
  onSaved,
  onClose,
}: {
  definitionId?: number | null;
  onSaved?: (id: number) => void;
  onClose?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [catalog, setCatalog] = useState<CatalogResponse>({});
  const [paramSchemas, setParamSchemas] = useState<NodeParamSchemas>({});
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [roleChoices, setRoleChoices] = useState<RoleChoice[]>([]);
  const [userChoices, setUserChoices] = useState<UserChoice[]>([]);

  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  // Per-trigger escalation config, keyed by trigger uid. null escalationEnabled
  // means "no escalation node".
  const [escalationEnabled, setEscalationEnabled] = useState(false);
  const [escalationConfig, setEscalationConfig] = useState<Record<string, Record<string, unknown>>>({});

  const [pickerOpen, setPickerOpen] = useState(false);

  // ─── Load catalog + (optionally) the definition being edited ──────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [catRes, schemaRes, rolesRes, usersRes] = await Promise.all([
          workflowEngineApi.catalog.nodeTypes(),
          workflowEngineApi.catalog.nodeParamSchemas(),
          workflowEngineApi.catalog.roles().catch(() => ({ data: [] })),
          workflowEngineApi.catalog.users().catch(() => ({ data: { users: [] } })),
        ]);
        if (cancelled) return;
        setCatalog((catRes.data as CatalogResponse) || {});
        setParamSchemas((schemaRes.data as NodeParamSchemas) || {});

        // Roles: keep {id,name} for the recipient picker, plus a name-only list
        // for the escalation / param-field role dropdowns.
        const rawRoles = rolesRes.data;
        const roleObjs: RoleChoice[] = Array.isArray(rawRoles)
          ? rawRoles.map((r: unknown) => {
              const o = r as { id?: number; name?: string; label?: string; value?: string };
              const nm = String(o?.name || o?.label || o?.value || (typeof r === 'string' ? r : ''));
              return { id: Number(o?.id ?? -1), name: nm };
            }).filter((r) => r.name)
          : [];
        setRoleChoices(roleObjs.filter((r) => r.id >= 0));
        setRoleOptions(roleObjs.map((r) => r.name).filter(Boolean));

        // Users for the recipient picker.
        const rawUsers = (usersRes.data as { users?: unknown[] })?.users || [];
        const userObjs: UserChoice[] = Array.isArray(rawUsers)
          ? rawUsers.map((u: unknown) => {
              const o = u as { id?: number; display_name?: string; username?: string; email?: string };
              return { id: Number(o?.id ?? -1), label: String(o?.display_name || o?.username || o?.email || `#${o?.id}`), email: o?.email };
            }).filter((u) => u.id >= 0)
          : [];
        setUserChoices(userObjs);

        if (definitionId) {
          const defRes = await workflowEngineApi.definitions.getById(definitionId);
          if (cancelled) return;
          hydrateFromDefinition(defRes.data as Record<string, unknown>);
        }
      } catch (e) {
        if (!cancelled) setError(extractErr(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionId]);

  // ─── Round-trip: rebuild guided state from a saved definition's nodes ──────
  const hydrateFromDefinition = useCallback((def: Record<string, unknown>) => {
    setName(String(def.name || ''));
    setDescription(String(def.description || ''));
    setIsActive(def.is_active !== false);
    const nodes = Array.isArray(def.nodes) ? (def.nodes as Array<Record<string, unknown>>) : [];
    const trg: TriggerItem[] = [];
    const notif: NotificationItem[] = [];
    let escCfg: Record<string, Record<string, unknown>> = {};
    let escOn = false;
    for (const n of nodes) {
      const cfg = (n.config as Record<string, unknown>) || {};
      const action = String(cfg.action_name || '');
      const eventName = String(cfg.event_name || '');
      const isEventTrigger = !!eventName && !action.startsWith('platform_action.');
      if (cfg.is_workflow_trigger || action.startsWith('platform_action.') || eventName) {
        const moduleName = (cfg.module as string) || undefined;
        if (isEventTrigger) {
          const grp = curatedTriggerGroup(eventName);
          trg.push({
            uid: uid('t'), kind: 'event', key: eventName,
            label: String(n.name || formatNodeLabel(eventName)),
            module: moduleName || grp.group, submodule: cfg.submodule as string | undefined,
            domain: grp.domain, triggerEvent: eventName, config: stripMeta(cfg),
          });
        } else {
          const ev = inferTriggerEventFromActionName(action) || String(n.node_key || action);
          trg.push({
            uid: uid('t'), kind: 'crud', key: action || String(n.node_key),
            label: String(n.name || formatNodeLabel(String(n.node_key))),
            module: moduleName, submodule: cfg.submodule as string | undefined,
            domain: inferWorkflowDomainsFromModuleName(moduleName)[0] || 'workflow',
            triggerEvent: ev, config: stripMeta(cfg),
          });
        }
      } else if (action === 'send_in_app_alert' || action === 'send_notification_email') {
        const toNums = (v: unknown): number[] =>
          Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
        notif.push({
          uid: uid('n'), channel: action === 'send_notification_email' ? 'email' : 'in_app',
          roleIds: toNums(cfg.role_ids ?? cfg.recipient_role_ids),
          userIds: toNums(cfg.user_ids ?? cfg.recipient_user_ids),
          message: String(cfg.message || cfg.message_template || cfg.body || ''),
          timing: cfg.delay_minutes ? 'delayed' : 'immediate', delayMinutes: Number(cfg.delay_minutes || 0),
        });
      } else if (action === 'escalate_to_management') {
        escOn = true;
        escCfg = (cfg.per_trigger as Record<string, Record<string, unknown>>) || {};
      }
    }
    setTriggers(trg);
    setNotifications(notif);
    setEscalationEnabled(escOn);
    // Re-key per-trigger escalation onto the freshly-generated uids by index.
    const byUid: Record<string, Record<string, unknown>> = {};
    const cfgValues = Object.values(escCfg);
    trg.forEach((t, i) => { byUid[t.uid] = cfgValues[i] || {}; });
    setEscalationConfig(byUid);
  }, []);

  // ─── Trigger management ────────────────────────────────────────────────────
  const addTrigger = useCallback((pf: CatalogPF, moduleName: string) => {
    const moduleLabel = pf.module || moduleName;
    const ev = inferTriggerEventFromActionName(pf.key);
    if (!ev) {
      setError(`"${pf.label || pf.key}" can't be used as a trigger (no platform event maps to it). Pick a Create / Update / Delete function.`);
      return;
    }
    const item: TriggerItem = {
      uid: uid('t'), kind: 'crud', key: pf.key, label: pf.label || formatNodeLabel(pf.key.split('.').pop() || pf.key),
      module: moduleLabel, submodule: pf.submodule,
      domain: inferWorkflowDomainsFromModuleName(moduleLabel)[0] || 'workflow',
      triggerEvent: ev, config: {},
    };
    setTriggers((prev) => [...prev, item]);
    setEscalationConfig((prev) => ({ ...prev, [item.uid]: {} }));
    setPickerOpen(false);
    setError(null);
  }, []);

  // Curated platform-event trigger — the event key IS the trigger event.
  const addEventTrigger = useCallback((trig: CatalogTrigger, group: string) => {
    const grp = curatedTriggerGroup(trig.key);
    const item: TriggerItem = {
      uid: uid('t'), kind: 'event', key: trig.key,
      label: trig.label || formatNodeLabel(trig.key),
      module: group || grp.group, submodule: 'Platform event',
      domain: grp.domain, triggerEvent: trig.key, config: {},
    };
    setTriggers((prev) => [...prev, item]);
    setEscalationConfig((prev) => ({ ...prev, [item.uid]: {} }));
    setPickerOpen(false);
    setError(null);
  }, []);

  const removeTrigger = useCallback((u: string) => {
    setTriggers((prev) => prev.filter((t) => t.uid !== u));
    setEscalationConfig((prev) => { const c = { ...prev }; delete c[u]; return c; });
  }, []);

  const setTriggerConfig = (u: string, field: string, value: unknown) =>
    setTriggers((prev) => prev.map((t) => (t.uid === u ? { ...t, config: { ...t.config, [field]: value } } : t)));

  // ─── Notification management ───────────────────────────────────────────────
  const addNotification = (channel: 'in_app' | 'email') =>
    setNotifications((prev) => [...prev, { uid: uid('n'), channel, roleIds: [], userIds: [], message: '', timing: 'immediate', delayMinutes: 0 }]);
  const removeNotification = (u: string) => setNotifications((prev) => prev.filter((n) => n.uid !== u));
  const patchNotification = (u: string, patch: Partial<NotificationItem>) =>
    setNotifications((prev) => prev.map((n) => (n.uid === u ? { ...n, ...patch } : n)));

  // ─── Escalation per-trigger config ─────────────────────────────────────────
  const setEscField = (triggerUid: string, field: string, value: unknown) =>
    setEscalationConfig((prev) => ({ ...prev, [triggerUid]: { ...(prev[triggerUid] || {}), [field]: value } }));

  // ─── Serialize the fixed shell to the backend node/edge payload ────────────
  const buildPayload = useCallback(() => {
    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    let y = 0;
    const push = (node: Record<string, unknown>) => { nodes.push({ position_x: 240, position_y: (y += 120), ...node }); };

    push({ node_key: 'start', node_type: 'start', name: 'Start', config: {}, is_start: true, position_x: 240, position_y: 0 });

    const triggerKeys: string[] = [];
    triggers.forEach((t, i) => {
      const key = `trigger_${i}`;
      triggerKeys.push(key);
      // CRUD triggers carry the platform_action key; curated event triggers
      // carry the event directly in event_name (no action to execute).
      const triggerCfg: Record<string, unknown> = t.kind === 'event'
        ? { event_name: t.key, is_workflow_trigger: true, module: t.module, submodule: t.submodule, ...t.config }
        : { action_name: t.key, is_workflow_trigger: true, module: t.module, submodule: t.submodule, ...t.config };
      push({ node_key: key, node_type: 'action', name: t.label, config: triggerCfg });
    });

    const notifKeys: string[] = [];
    notifications.forEach((n, i) => {
      const key = `notify_${i}`;
      notifKeys.push(key);
      push({
        node_key: key, node_type: 'action',
        name: n.channel === 'email' ? 'Email Notification' : 'In-App Notification',
        // The backend handlers (_send_notification_email / _send_in_app_alert)
        // read user_ids / role_ids and message — send those directly.
        config: {
          action_name: n.channel === 'email' ? 'send_notification_email' : 'send_in_app_alert',
          user_ids: n.userIds, role_ids: n.roleIds,
          message: n.message, message_template: n.message,
          delay_minutes: n.timing === 'delayed' ? n.delayMinutes : 0,
        },
      });
    });

    const hasEscalation = escalationEnabled && triggers.length > 0;
    if (hasEscalation) {
      const perTrigger: Record<string, Record<string, unknown>> = {};
      triggers.forEach((t) => { perTrigger[t.triggerEvent] = { trigger: t.key, ...(escalationConfig[t.uid] || {}) }; });
      push({ node_key: 'escalation', node_type: 'action', name: 'Escalation', config: { action_name: 'escalate_to_management', per_trigger: perTrigger } });
    }

    push({ node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true });

    // Linear chain through the shell: start → triggers… → notifications… → escalation? → end
    const chain = ['start', ...triggerKeys, ...notifKeys, ...(hasEscalation ? ['escalation'] : []), 'end'];
    for (let i = 0; i < chain.length - 1; i++) {
      edges.push({ source_node_key: chain[i], target_node_key: chain[i + 1], priority: 100 });
    }

    const triggerEvents = Array.from(new Set(triggers.map((t) => t.triggerEvent)));
    return {
      name: name.trim() || 'Untitled Workflow',
      description,
      trigger_event: triggerEvents[0] || 'manual.trigger',
      trigger_events: triggerEvents,
      is_active: isActive,
      trigger_conditions: {},
      definition_json: { shell: 'guided' },
      nodes,
      edges,
    };
  }, [triggers, notifications, escalationEnabled, escalationConfig, name, description, isActive]);

  const save = useCallback(async () => {
    if (triggers.length === 0) { setError('Add at least one trigger so the workflow knows when to run.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = buildPayload();
      const res = definitionId
        ? await workflowEngineApi.definitions.update(definitionId, payload)
        : await workflowEngineApi.definitions.create(payload);
      const id = (res.data as { id?: number })?.id ?? definitionId ?? undefined;
      if (id) onSaved?.(id);
    } catch (e) {
      setError('Save failed: ' + extractErr(e));
    } finally {
      setSaving(false);
    }
  }, [buildPayload, definitionId, triggers.length, onSaved]);

  const platformGroups = useMemo(() => Object.entries(catalog.platform_functions || {}), [catalog]);

  // Curated platform events grouped by domain (manual/schedule/webhook excluded).
  const eventGroups = useMemo<Array<[string, CatalogTrigger[]]>>(() => {
    const byGroup: Record<string, CatalogTrigger[]> = {};
    for (const t of catalog.triggers || []) {
      if (!t?.key || EXCLUDED_CURATED_TRIGGERS.has(t.key)) continue;
      const { group } = curatedTriggerGroup(t.key);
      (byGroup[group] ||= []).push(t);
    }
    return Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  // Domains of the configured triggers — used to surface the most relevant
  // ready-to-use message templates first on each notification node.
  const triggerDomains = useMemo(() => triggers.map((t) => t.domain), [triggers]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading builder…</div>;
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name…"
          className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        {onClose && (
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
        )}
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Workflow
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* The fixed shell, top-to-bottom */}
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 overflow-y-auto p-5">
        <ShellAnchor icon={<PlayCircle className="h-4 w-4" />} label="Start" tone="blue" hint="Entry point" />
        <Connector />

        {/* ── Trigger block ── */}
        <Zone title="Triggers" subtitle="Any one firing starts the workflow (OR)" icon={<Zap className="h-4 w-4 text-blue-600" />}>
          {triggers.map((t) => (
            <div key={t.uid} className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{t.label}</p>
                  <p className="text-[11px] text-slate-500">{t.module}{t.submodule ? ` / ${t.submodule}` : ''} · fires on <code className="text-blue-700">{t.triggerEvent}</code></p>
                </div>
                <button onClick={() => removeTrigger(t.uid)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <ParamFields fields={paramSchemas[t.key] || []} value={t.config} onChange={(f, v) => setTriggerConfig(t.uid, f, v)} roleOptions={roleOptions} />
            </div>
          ))}
          <button onClick={() => setPickerOpen(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-300 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50">
            <Plus className="h-3.5 w-3.5" /> Add Trigger
          </button>
        </Zone>
        <Connector />

        {/* ── Notification block (optional) ── */}
        <Zone title="Notifications" subtitle="Optional · In-App and/or Email · order doesn't matter" icon={<Bell className="h-4 w-4 text-emerald-600" />}>
          {notifications.map((n) => (
            <div key={n.uid} className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  {n.channel === 'email' ? <Mail className="h-3.5 w-3.5 text-emerald-600" /> : <Bell className="h-3.5 w-3.5 text-emerald-600" />}
                  {n.channel === 'email' ? 'Email Notification' : 'In-App Notification'}
                </span>
                <button onClick={() => removeNotification(n.uid)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Recipients (roles &amp; users — select any)">
                  <RecipientPicker
                    roleChoices={roleChoices} userChoices={userChoices}
                    roleIds={n.roleIds} userIds={n.userIds}
                    onChange={(roleIds, userIds) => patchNotification(n.uid, { roleIds, userIds })}
                  />
                </Field>
                <Field label="Timing">
                  <div className="flex items-center gap-2">
                    <select value={n.timing} onChange={(e) => patchNotification(n.uid, { timing: e.target.value as 'immediate' | 'delayed' })} className="rounded border border-slate-300 px-2 py-1 text-xs">
                      <option value="immediate">Immediate</option>
                      <option value="delayed">Delayed</option>
                    </select>
                    {n.timing === 'delayed' && (
                      <input type="number" min={0} value={n.delayMinutes} onChange={(e) => patchNotification(n.uid, { delayMinutes: Number(e.target.value) })} className="w-20 rounded border border-slate-300 px-2 py-1 text-xs" placeholder="min" />
                    )}
                  </div>
                </Field>
                <Field label="Message template" full>
                  <MessageEditor
                    value={n.message} domains={triggerDomains}
                    onChange={(v) => patchNotification(n.uid, { message: v })}
                  />
                </Field>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => addNotification('in_app')} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><Bell className="h-3.5 w-3.5" /> Add In-App</button>
            <button onClick={() => addNotification('email')} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><Mail className="h-3.5 w-3.5" /> Add Email</button>
          </div>
        </Zone>
        <Connector />

        {/* ── Escalation (hidden until ≥1 trigger; open-question #2: yes) ── */}
        <Zone title="Escalation" subtitle={triggers.length === 0 ? 'Add a trigger to configure escalation' : 'One per trigger context'} icon={<ArrowUpCircle className="h-4 w-4 text-violet-600" />}>
          {triggers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-3 text-center text-xs text-slate-400">
              Escalation unlocks once a trigger is configured.
            </div>
          ) : !escalationEnabled ? (
            <button onClick={() => setEscalationEnabled(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-violet-300 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50">
              <Plus className="h-3.5 w-3.5" /> Add Escalation
            </button>
          ) : (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">Escalation — configured per trigger</span>
                <button onClick={() => setEscalationEnabled(false)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-3">
                {triggers.map((t) => (
                  <div key={t.uid} className="rounded-md border border-violet-100 bg-white p-2.5">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">{t.label} <span className="text-slate-400">· {t.domain}</span></p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {escalationFieldsForDomain(t.domain).map((f) => (
                        <Field key={f.name} label={f.label}>
                          <EscInput field={f} value={(escalationConfig[t.uid] || {})[f.name]} onChange={(v) => setEscField(t.uid, f.name, v)} roleOptions={roleOptions} />
                        </Field>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Zone>
        <Connector />

        <ShellAnchor icon={<StopCircle className="h-4 w-4" />} label="End" tone="slate" hint="Exit point" />
      </div>

      {/* Trigger picker */}
      {pickerOpen && (
        <TriggerPicker
          crudGroups={platformGroups}
          eventGroups={eventGroups}
          onPickCrud={addTrigger}
          onPickEvent={addEventTrigger}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────
function ShellAnchor({ icon, label, hint, tone }: { icon: React.ReactNode; label: string; hint: string; tone: 'blue' | 'slate' }) {
  const c = tone === 'blue' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-slate-100 text-slate-600';
  return (
    <div className={`mx-auto flex w-40 items-center justify-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold ${c}`}>
      {icon} {label} <span className="text-[10px] font-normal opacity-60">{hint}</span>
    </div>
  );
}
function Connector() {
  return <div className="mx-auto h-5 w-px bg-slate-300" />;
}
function Zone({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</label>
      {children}
    </div>
  );
}

// ── Recipient multi-select (roles + users) ──────────────────────────────────
function RecipientChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
      <span className="max-w-[130px] truncate">{label}</span>
      <button type="button" onClick={onRemove} className="hover:text-emerald-950"><X className="h-2.5 w-2.5" /></button>
    </span>
  );
}
function RecipientRow({ label, sub, checked, onClick }: { label: string; sub?: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-emerald-50">
      <span className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border ${checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}{sub ? <span className="ml-1 text-[10px] text-slate-400">{sub}</span> : null}</span>
    </button>
  );
}
function RecipientPicker({ roleChoices, userChoices, roleIds, userIds, onChange }: {
  roleChoices: RoleChoice[]; userChoices: UserChoice[];
  roleIds: number[]; userIds: number[];
  onChange: (roleIds: number[], userIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const toggleRole = (id: number) => onChange(roleIds.includes(id) ? roleIds.filter((x) => x !== id) : [...roleIds, id], userIds);
  const toggleUser = (id: number) => onChange(roleIds, userIds.includes(id) ? userIds.filter((x) => x !== id) : [...userIds, id]);
  const selRoles = roleChoices.filter((r) => roleIds.includes(r.id));
  const selUsers = userChoices.filter((u) => userIds.includes(u.id));
  const fRoles = roleChoices.filter((r) => !ql || r.name.toLowerCase().includes(ql));
  const fUsers = userChoices.filter((u) => !ql || u.label.toLowerCase().includes(ql) || (u.email || '').toLowerCase().includes(ql));
  const count = roleIds.length + userIds.length;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-1 rounded border border-slate-300 px-2 py-1 text-left text-xs text-slate-600">
        <span className="truncate">{count ? `${count} recipient${count > 1 ? 's' : ''} selected` : 'Select roles / users…'}</span>
        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {count > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selRoles.map((r) => <RecipientChip key={`r${r.id}`} label={`◆ ${r.name}`} onRemove={() => toggleRole(r.id)} />)}
          {selUsers.map((u) => <RecipientChip key={`u${u.id}`} label={u.label} onRemove={() => toggleUser(u.id)} />)}
        </div>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-1.5">
            <div className="flex items-center gap-1 rounded border border-slate-200 px-1.5">
              <Search className="h-3 w-3 text-slate-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles or users…" className="w-full py-1 text-xs focus:outline-none" />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Roles</p>
            {fRoles.length === 0 && <p className="px-2 py-1 text-[11px] text-slate-400">No roles</p>}
            {fRoles.map((r) => <RecipientRow key={`r${r.id}`} label={r.name} checked={roleIds.includes(r.id)} onClick={() => toggleRole(r.id)} />)}
            <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Users</p>
            {fUsers.length === 0 && <p className="px-2 py-1 text-[11px] text-slate-400">No users</p>}
            {fUsers.map((u) => <RecipientRow key={`u${u.id}`} label={u.label} sub={u.email} checked={userIds.includes(u.id)} onClick={() => toggleUser(u.id)} />)}
          </div>
          <div className="border-t border-slate-100 p-1.5 text-right">
            <button type="button" onClick={() => setOpen(false)} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message template editor (placeholders + ready-to-use templates) ──────────
function MessageEditor({ value, domains, onChange }: {
  value: string; domains: WorkflowDomain[]; onChange: (v: string) => void;
}) {
  const [tplOpen, setTplOpen] = useState(false);
  const templates = templatesForDomains(domains);
  const insert = (token: string) => onChange((value ? value + (value.endsWith(' ') || value.endsWith('\n') ? '' : ' ') : '') + token);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <div className="relative">
          <button type="button" onClick={() => setTplOpen((o) => !o)} className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
            <FileText className="h-3 w-3" /> Templates <ChevronDown className={`h-3 w-3 transition-transform ${tplOpen ? 'rotate-180' : ''}`} />
          </button>
          {tplOpen && (
            <div className="absolute z-30 mt-1 max-h-60 w-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {templates.map((t) => (
                <button key={t.name} type="button" onClick={() => { onChange(t.text); setTplOpen(false); }} className="block w-full border-b border-slate-50 px-2 py-1.5 text-left last:border-0 hover:bg-emerald-50">
                  <span className="block text-[11px] font-medium text-slate-700">{t.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-slate-400">{t.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-[10px] text-slate-400">Insert:</span>
        {TEMPLATE_PLACEHOLDERS.map((p) => (
          <button key={p.token} type="button" title={p.label} onClick={() => insert(p.token)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-200">{p.token}</button>
        ))}
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" placeholder={'e.g. A risk "{{title}}" was {{action}} — please review.'} />
      <p className="text-[10px] text-slate-400">Placeholders like <code className="text-slate-500">{'{{title}}'}</code> are filled with live values when the workflow runs.</p>
    </div>
  );
}

// Render a platform-function param field (derived from the functionality).
function ParamFields({ fields, value, onChange, roleOptions }: {
  fields: NodeParamField[]; value: Record<string, unknown>; onChange: (f: string, v: unknown) => void; roleOptions: string[];
}) {
  if (!fields.length) return <p className="text-[11px] text-slate-400">No configuration — fires whenever this happens.</p>;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.name} label={f.label + (f.required ? ' *' : '')}>
          {f.enum && f.enum.length ? (
            <select value={String(value[f.name] ?? '')} onChange={(e) => onChange(f.name, e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="">Any</option>
              {f.enum.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'boolean' ? (
            <input type="checkbox" checked={!!value[f.name]} onChange={(e) => onChange(f.name, e.target.checked)} />
          ) : f.entity ? (
            <input value={String(value[f.name] ?? '')} onChange={(e) => onChange(f.name, e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" placeholder={`${f.entity} id…`} />
          ) : (
            <input type={f.type === 'integer' || f.type === 'number' ? 'number' : 'text'} value={String(value[f.name] ?? '')} onChange={(e) => onChange(f.name, e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" placeholder={f.label} />
          )}
        </Field>
      ))}
    </div>
  );
}

function EscInput({ field, value, onChange, roleOptions }: { field: EscField; value: unknown; onChange: (v: unknown) => void; roleOptions: string[] }) {
  if (field.type === 'role') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
        <option value="">Select role…</option>
        {roleOptions.map((r) => <option key={r} value={r}>{formatNodeLabel(r)}</option>)}
      </select>
    );
  }
  if (field.type === 'select') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
        <option value="">Select…</option>
        {(field.options || []).map((o) => <option key={o} value={o}>{formatNodeLabel(o)}</option>)}
      </select>
    );
  }
  if (field.type === 'boolean') {
    return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  }
  return (
    <input type={field.type === 'number' ? 'number' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" placeholder={field.label} />
  );
}

// Trigger picker modal. Two tabs:
//   • Events  — curated platform events (e.g. "Risk score exceeds threshold"),
//               grouped by domain.
//   • Actions — Create / Update / Delete platform functions, in a
//               Module → Submodule → Function hierarchy.
function TriggerPicker({ crudGroups, eventGroups, onPickCrud, onPickEvent, onClose }: {
  crudGroups: Array<[string, CatalogPF[]]>;
  eventGroups: Array<[string, CatalogTrigger[]]>;
  onPickCrud: (pf: CatalogPF, moduleName: string) => void;
  onPickEvent: (trig: CatalogTrigger, group: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'events' | 'actions'>(eventGroups.length ? 'events' : 'actions');
  const [openGroup, setOpenGroup] = useState<string | null>(eventGroups[0]?.[0] || null);
  const [openModule, setOpenModule] = useState<string | null>(crudGroups[0]?.[0] || null);
  const ql = q.trim().toLowerCase();

  const tabBtn = (id: 'events' | 'actions', label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >{label}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-10" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Add a trigger</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="flex gap-1 rounded-lg bg-slate-50 p-1">
            {tabBtn('events', `Platform events${eventGroups.length ? '' : ' (0)'}`)}
            {tabBtn('actions', 'Create / Update / Delete')}
          </div>
          <div className="flex items-center gap-2 rounded-md border border-slate-300 px-2">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'events' ? 'Search platform events…' : 'Search platform functions…'} className="w-full py-1.5 text-sm focus:outline-none" />
          </div>
          <p className="text-[11px] text-slate-400">
            {tab === 'events'
              ? 'Semantic events the platform raises (SLA breaches, thresholds, expiries, status changes). Any one starts the workflow.'
              : 'Records being created, edited or deleted across the platform. Each maps 1:1 to a system event.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {tab === 'events' ? (
            eventGroups.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400">No platform events available.</p>
            ) : (
              eventGroups.map(([group, items]) => {
                const filtered = items.filter((it) => !ql || (it.label || it.key).toLowerCase().includes(ql) || group.toLowerCase().includes(ql));
                if (!filtered.length) return null;
                const open = ql ? true : openGroup === group;
                return (
                  <div key={group} className="mb-1">
                    <button onClick={() => setOpenGroup(open ? null : group)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      {group} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="space-y-0.5 pb-1">
                        {filtered.map((it) => (
                          <button key={it.key} onClick={() => onPickEvent(it, group)} className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700">
                            <Zap className="h-3 w-3 flex-shrink-0 text-amber-500" />
                            <span className="flex-1 truncate">{it.label || formatNodeLabel(it.key)}</span>
                            <code className="text-[10px] text-slate-400">{it.key}</code>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            crudGroups.map(([moduleName, items]) => {
              const filtered = items.filter((it) => !ql || (it.label || it.key).toLowerCase().includes(ql) || moduleName.toLowerCase().includes(ql) || (it.submodule || '').toLowerCase().includes(ql));
              const triggerable = filtered.filter((it) => inferTriggerEventFromActionName(it.key));
              if (!triggerable.length) return null;
              const open = ql ? true : openModule === moduleName;
              // Sub-group by submodule for a Module → Submodule → Function tree.
              const bySub: Record<string, CatalogPF[]> = {};
              for (const it of triggerable) { (bySub[it.submodule || 'General'] ||= []).push(it); }
              const subEntries = Object.entries(bySub).sort(([a], [b]) => a.localeCompare(b));
              return (
                <div key={moduleName} className="mb-1">
                  <button onClick={() => setOpenModule(open ? null : moduleName)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <span>{formatNodeLabel(moduleName)} <span className="ml-1 text-[10px] font-normal text-slate-400">{triggerable.length}</span></span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="space-y-1 pb-1 pl-1">
                      {subEntries.map(([sub, fns]) => (
                        <div key={sub}>
                          <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{sub}</p>
                          <div className="space-y-0.5">
                            {fns.map((it) => (
                              <button key={it.key} onClick={() => onPickCrud(it, moduleName)} className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700">
                                <Zap className="h-3 w-3 flex-shrink-0 text-blue-500" />
                                <span className="flex-1 truncate">{it.label || formatNodeLabel(it.key.split('.').pop() || it.key)}</span>
                                <code className="text-[10px] text-slate-400">{inferTriggerEventFromActionName(it.key)}</code>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── utils ───────────────────────────────────────────────────────────────────
function stripMeta(cfg: Record<string, unknown>): Record<string, unknown> {
  const { action_name, is_workflow_trigger, module, submodule, domains, ...rest } = cfg;
  void action_name; void is_workflow_trigger; void module; void submodule; void domains;
  return rest;
}
function extractErr(e: unknown): string {
  const r = e as { response?: { data?: { detail?: string } }; message?: string };
  return r?.response?.data?.detail || r?.message || 'Unknown error';
}
