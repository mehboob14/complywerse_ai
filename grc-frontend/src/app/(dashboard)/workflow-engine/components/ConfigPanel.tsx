'use client';

import { Edge, Node } from '@xyflow/react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import React from 'react';
import {
  ACTION_KEYS,
  APPROVAL_KEYS,
  CONDITION_KEYS,
  formatWorkflowContextLabel,
  FlowNodeData,
  getNodeCatalogContext,
  getRelevantActionOptions,
  getRelevantConditionKeys,
  getRelevantTriggerKeys,
  NODE_TYPE_LABELS,
  NodeConfigOptions,
  NodeOptionItem,
  NodeParamField,
  NodeParamSchemas,
  TIMER_KEYS,
} from './types';
import { workflowEngineApi } from '@/lib/api';

type Props = {
  actorUsers: Array<{ id: number; display_name: string; email: string; username?: string }>;
  actorRoles: Array<{ id: number; name: string; description?: string }>;
  actionOptions: NodeOptionItem[];
  conditionPathOptions: Array<{ value: string; label: string }>;
  nodeConfigOptions: NodeConfigOptions;
  nodeParamSchemas: NodeParamSchemas;
  selectedNode: Node<FlowNodeData> | undefined;
  selectedEdge: Edge | undefined;
  nodeConfigText: string;
  edgeConditionText: string;
  edgeLabel: string;
  edgePriority: number;
  onUpdateNodeConfig: (field: string, value: unknown) => void;
  onApplyNodeConfig: () => void;
  onApplyEdgeConfig: () => void;
  onSetNodeConfigText: (v: string) => void;
  onSetEdgeConditionText: (v: string) => void;
  onSetEdgeLabel: (v: string) => void;
  onSetEdgePriority: (v: number) => void;
  onDeleteSelected: () => void;
  onClose: () => void;
  locked?: boolean;
};

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mt-3 mb-1">
      {label}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <label className="block text-[10px] font-medium text-gray-600 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

type MultiOption = {
  value: number;
  label: string;
  subtitle?: string;
};

function CheckboxMultiSelect({
  options,
  selectedValues,
  onChange,
  placeholder,
  emptyMessage,
  maxHeightClass = 'max-h-52',
}: {
  options: MultiOption[];
  selectedValues: number[];
  onChange: (values: number[]) => void;
  placeholder: string;
  emptyMessage: string;
  maxHeightClass?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  const selectedSet = React.useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedLabels = React.useMemo(
    () => options.filter((o) => selectedSet.has(o.value)).map((o) => o.label),
    [options, selectedSet]
  );

  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(', ')
        : `${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2}`;

  const toggleValue = (value: number) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((v) => v !== value));
      return;
    }
    onChange([...selectedValues, value]);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((s) => !s)}
        className="w-full text-left text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white hover:bg-gray-50"
      >
        <span className={selectedValues.length === 0 ? 'text-gray-400' : 'text-gray-800'}>{summary}</span>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {options.length === 0 ? (
            <div className="px-2 py-2 text-[10px] text-gray-400">{emptyMessage}</div>
          ) : (
            <div className={`overflow-y-auto p-1 ${maxHeightClass}`}>
              {options.map((opt) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleValue(opt.value)}
                    />
                    <span className="min-w-0">
                      <span className="block text-xs text-gray-800 truncate">{opt.label}</span>
                      {opt.subtitle && (
                        <span className="block text-[10px] text-gray-500 truncate">{opt.subtitle}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="border-t border-gray-100 px-2 py-1.5 flex items-center justify-between">
            <span className="text-[10px] text-gray-500">{selectedValues.length} selected</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[10px] text-blue-600 hover:text-blue-700 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white';
const selectCls =
  'w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white';

export function ConfigPanel({
  actorUsers,
  actorRoles,
  actionOptions,
  conditionPathOptions,
  nodeConfigOptions,
  nodeParamSchemas,
  selectedNode,
  selectedEdge,
  nodeConfigText,
  edgeConditionText,
  edgeLabel,
  edgePriority,
  onUpdateNodeConfig,
  onApplyNodeConfig,
  onApplyEdgeConfig,
  onSetNodeConfigText,
  onSetEdgeConditionText,
  onSetEdgeLabel,
  onSetEdgePriority,
  onDeleteSelected,
  onClose,
  locked = false,
}: Props) {
  if (!selectedNode && !selectedEdge) {
    return (
      <div className="flex flex-col h-full bg-white border-l border-gray-200 items-center justify-center p-4">
        <div className="text-center text-gray-400">
          <div className="text-3xl mb-2">↖</div>
          <div className="text-xs font-medium">Select a node or edge</div>
          <div className="text-[10px] mt-1 text-gray-300">to configure its properties</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 bg-gray-50">
        <span className="text-xs font-bold text-gray-700">
          {selectedNode ? 'Node Config' : 'Edge Config'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onDeleteSelected}
            disabled={locked}
            className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={`flex-1 overflow-y-auto px-3 py-3 ${locked ? 'pointer-events-none opacity-60' : ''}`}>
        {selectedNode && (
          <NodeConfigBody
            node={selectedNode}
            nodeConfigText={nodeConfigText}
            actorUsers={actorUsers}
            actorRoles={actorRoles}
            actionOptions={actionOptions}
            conditionPathOptions={conditionPathOptions}
            nodeConfigOptions={nodeConfigOptions}
            nodeParamSchemas={nodeParamSchemas}
            onUpdateNodeConfig={onUpdateNodeConfig}
            onSetNodeConfigText={onSetNodeConfigText}
          />
        )}
        {selectedEdge && (
          <EdgeConfigBody
            edge={selectedEdge}
            edgeConditionText={edgeConditionText}
            edgeLabel={edgeLabel}
            edgePriority={edgePriority}
            onSetEdgeConditionText={onSetEdgeConditionText}
            onSetEdgeLabel={onSetEdgeLabel}
            onSetEdgePriority={onSetEdgePriority}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-gray-200">
        <button
          onClick={selectedNode ? onApplyNodeConfig : onApplyEdgeConfig}
          disabled={locked}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save size={12} />
          Apply Changes
        </button>
      </div>
    </div>
  );
}

// ─── Multi-Level Escalation Config ───────────────────────────────────────────

type EscalationLevel = {
  level: number;
  subject: string;
  message: string;
  user_ids: number[];
  role_ids: number[];
  // Wait before escalating to the next level — days AND hours can both be set
  // (e.g. 2 days + 6 hours). Kept alongside the legacy timeout_value/unit so
  // older saved workflows still load.
  wait_days: number;
  wait_hours: number;
  timeout_value?: number;
  timeout_unit?: 'hours' | 'days';
  escalation_mode?: 'always' | 'if_unresolved_timeout' | 'on_condition';
  escalation_condition?: Record<string, unknown>;
};

function EscalationLevelsConfig({
  levels,
  actorUsers,
  actorRoles,
  conditionPathOptions,
  onChange,
}: {
  levels: EscalationLevel[];
  actorUsers: Array<{ id: number; display_name: string; email: string }>;
  actorRoles: Array<{ id: number; name: string }>;
  conditionPathOptions: Array<{ value: string; label: string }>;
  onChange: (levels: EscalationLevel[]) => void;
}) {
  const [editingConditionIndex, setEditingConditionIndex] = React.useState<number | null>(null);

  const updateLevel = (idx: number, patch: Partial<EscalationLevel>) => {
    const next = levels.map((l, i) => (i === idx ? { ...l, ...patch } : l));
    onChange(next);
  };

  const addLevel = () => {
    const nextNum = levels.length + 1;
    onChange([
      ...levels,
      {
        level: nextNum,
        subject: '',
        message: '',
        user_ids: [],
        role_ids: [],
        wait_days: 1,
        wait_hours: 0,
        escalation_mode: 'always',
        escalation_condition: {},
      },
    ]);
  };

  const removeLevel = (idx: number) => {
    const next = levels
      .filter((_, i) => i !== idx)
      .map((l, i) => ({ ...l, level: i + 1 }));
    onChange(next);
  };

  if (levels.length === 0) {
    return (
      <div className="mt-1">
        <div className="text-[10px] text-gray-400 mb-1">No escalation levels configured.</div>
        <button
          type="button"
          onClick={addLevel}
          className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-medium"
        >
          <Plus size={11} /> Add Level 1
        </button>
      </div>
    );
  }

  // Compact "when does each level fire" preview so the timing is visible at a
  // glance without expanding every level. Delays are relative to the previous
  // level (Level 1 is relative to when the workflow reaches the node).
  const fmtDelay = (d: number, h: number) => {
    if (!d && !h) return 'immediately';
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    return `after ${parts.join(' ')}`;
  };

  return (
    <div className="mt-1 space-y-3">
      {levels.length > 0 && (
        <div className="rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5 text-[9px] text-blue-800">
          <span className="font-semibold">Timeline:</span>{' '}
          {levels.map((lv, i) => (
            <span key={i}>
              {i > 0 && <span className="text-blue-300"> → </span>}
              L{lv.level} {fmtDelay(Number(lv.wait_days) || 0, Number(lv.wait_hours) || 0)}
            </span>
          ))}
        </div>
      )}
      {levels.map((lv, idx) => {
        const escalationMode = lv.escalation_mode || 'always';
        return (
          <div key={idx} className="border border-gray-200 rounded-md p-2 bg-slate-50">
            {/* Level header */}
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">
                Level {lv.level}{lv.level === 1 ? ' — Initial Alert' : ' — Escalation'}
              </span>
              {levels.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLevel(idx)}
                  className="p-0.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
                  title="Remove this level"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>

            {/* Alert Subject */}
            <Field label="Alert Subject">
              <input
                className={inputCls}
                value={lv.subject}
                onChange={(e) => updateLevel(idx, { subject: e.target.value })}
                placeholder={`Level ${lv.level} alert subject`}
              />
            </Field>

            {/* Alert Message */}
            <Field label="Alert Message">
              <textarea
                className={`${inputCls} h-14 resize-none`}
                value={lv.message}
                onChange={(e) => updateLevel(idx, { message: e.target.value })}
                placeholder="Describe the situation or action required..."
              />
            </Field>

            {/* Target Users */}
            <Field label="Notify Users">
              <CheckboxMultiSelect
                options={actorUsers.map((u) => ({
                  value: u.id,
                  label: u.display_name,
                  subtitle: u.email,
                }))}
                selectedValues={lv.user_ids || []}
                onChange={(vals) => updateLevel(idx, { user_ids: vals })}
                placeholder="Select users"
                emptyMessage="No tenant users found"
                maxHeightClass="max-h-28"
              />
            </Field>

            {/* Target Roles */}
            <Field label="Notify Roles">
              <CheckboxMultiSelect
                options={actorRoles.map((r) => ({
                  value: r.id,
                  label: r.name,
                }))}
                selectedValues={lv.role_ids || []}
                onChange={(vals) => updateLevel(idx, { role_ids: vals })}
                placeholder="Select roles"
                emptyMessage="No tenant roles found"
                maxHeightClass="max-h-24"
              />
            </Field>

            <Field label="Escalate Rule">
              <select
                className={selectCls}
                value={escalationMode}
                onChange={(e) =>
                  updateLevel(idx, {
                    escalation_mode: e.target.value as EscalationLevel['escalation_mode'],
                  })
                }
              >
                <option value="always">Always escalate at this level</option>
                <option value="if_unresolved_timeout">Escalate only if unresolved after timeout</option>
                <option value="on_condition">Escalate only when condition is met</option>
              </select>
            </Field>

            {escalationMode === 'on_condition' && (
              <>
                <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] text-blue-800">
                  Path: <span className="font-semibold">{String((lv.escalation_condition || {}).path || 'not set')}</span>
                  {'  '}| Operator: <span className="font-semibold">{String((lv.escalation_condition || {}).operator || 'eq')}</span>
                  {'  '}| Value: <span className="font-semibold">{String((lv.escalation_condition || {}).value || '')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingConditionIndex(idx)}
                  className="mt-1 text-[10px] font-medium text-blue-700 hover:text-blue-800"
                >
                  Configure Condition Path / Operator / Value
                </button>
              </>
            )}

            {/* WHEN this level fires — the delay before it, measured from the
                previous level (or from when the workflow reaches this node for
                Level 1). Shown for EVERY level so timing is always configurable,
                including a single-level escalation. 0 = fire immediately. */}
            <div className="text-[9px] font-medium text-gray-600 mt-1 mb-0.5">
              {lv.level === 1
                ? 'Send this alert after — from when the workflow reaches this node'
                : `Escalate to Level ${lv.level} after — from Level ${lv.level - 1}`}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Days">
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={lv.wait_days ?? 0}
                  onChange={(e) =>
                    updateLevel(idx, { wait_days: Math.max(0, Number(e.target.value) || 0) })
                  }
                  placeholder="0"
                />
              </Field>
              <Field label="Hours">
                <input
                  type="number"
                  min={0}
                  max={23}
                  className={inputCls}
                  value={lv.wait_hours ?? 0}
                  onChange={(e) =>
                    updateLevel(idx, { wait_hours: Math.max(0, Number(e.target.value) || 0) })
                  }
                  placeholder="0"
                />
              </Field>
            </div>
            {(Number(lv.wait_days) || 0) === 0 && (Number(lv.wait_hours) || 0) === 0 && (
              <div className="text-[9px] text-amber-600 mt-0.5">
                {lv.level === 1
                  ? '0 days + 0 hours — fires immediately when reached.'
                  : '0 days + 0 hours — escalates immediately after the previous level.'}
              </div>
            )}
          </div>
        );
      })}

      {/* Add level button */}
      {levels.length < 6 && (
        <button
          type="button"
          onClick={addLevel}
          className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-medium mt-1"
        >
          <Plus size={11} /> Add Level {levels.length + 1}
        </button>
      )}

      {editingConditionIndex !== null && levels[editingConditionIndex] && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <span className="text-xs font-semibold text-gray-800">
                Level {levels[editingConditionIndex].level} Condition
              </span>
              <button
                type="button"
                className="text-xs text-gray-500 hover:text-gray-700"
                onClick={() => setEditingConditionIndex(null)}
              >
                Close
              </button>
            </div>

            <div className="p-4 space-y-3">
              <Field label="Condition Path">
                <select
                  className={selectCls}
                  value={String((levels[editingConditionIndex].escalation_condition || {}).path || '')}
                  onChange={(e) =>
                    updateLevel(editingConditionIndex, {
                      escalation_condition: {
                        ...(levels[editingConditionIndex].escalation_condition || {}),
                        path: e.target.value,
                      },
                    })
                  }
                >
                  <option value="">Select path</option>
                  {conditionPathOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Operator">
                  <select
                    className={selectCls}
                    value={String((levels[editingConditionIndex].escalation_condition || {}).operator || 'eq')}
                    onChange={(e) =>
                      updateLevel(editingConditionIndex, {
                        escalation_condition: {
                          ...(levels[editingConditionIndex].escalation_condition || {}),
                          operator: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="eq">Equals</option>
                    <option value="neq">Not equals</option>
                    <option value="gt">Greater than</option>
                    <option value="gte">Greater/equal</option>
                    <option value="lt">Less than</option>
                    <option value="lte">Less/equal</option>
                    <option value="exists">Exists</option>
                    <option value="not_exists">Not exists</option>
                  </select>
                </Field>

                <Field label="Value">
                  <input
                    className={inputCls}
                    value={String((levels[editingConditionIndex].escalation_condition || {}).value || '')}
                    onChange={(e) =>
                      updateLevel(editingConditionIndex, {
                        escalation_condition: {
                          ...(levels[editingConditionIndex].escalation_condition || {}),
                          value: e.target.value,
                        },
                      })
                    }
                    placeholder="critical"
                  />
                </Field>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared helper ────────────────────────────────────────────────────────────
function toLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Trigger Sub-Config ───────────────────────────────────────────────────────
function TriggerSubConfig({
  config,
  nodeConfigOptions,
  onUpdate,
  inputCls,
  selectCls,
}: {
  config: Record<string, unknown>;
  nodeConfigOptions: NodeConfigOptions;
  onUpdate: (field: string, value: unknown) => void;
  inputCls: string;
  selectCls: string;
}) {
  const tt = (config?.trigger_type as string) || '';
  const {
    frameworks,
    risk_categories,
    risk_statuses,
    risk_levels,
    risk_register_types,
    risk_sub_categories,
    compliance_statuses,
    vulnerability_severities,
    policy_categories,
    audit_types,
    finding_severities,
    kri_categories,
    evidence_categories,
    asset_types,
    asset_criticality_levels,
  } = nodeConfigOptions;

  const FwSelect = ({
    field = 'framework_id',
    label = 'Framework',
    anyLabel = '-- Any framework --',
  }: {
    field?: string;
    label?: string;
    anyLabel?: string;
  }) => (
    <Field label={label}>
      <select
        className={selectCls}
        value={String((config?.[field] as number) || '')}
        onChange={(e) => onUpdate(field, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{anyLabel}</option>
        {frameworks.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.version ? ` (${f.version})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );

  const DaysInput = ({
    field,
    label,
    placeholder = '30',
  }: {
    field: string;
    label: string;
    placeholder?: string;
  }) => (
    <Field label={label}>
      <input
        type="number"
        className={inputCls}
        min={1}
        value={(config?.[field] as number) || ''}
        onChange={(e) => onUpdate(field, e.target.value ? Number(e.target.value) : null)}
        placeholder={placeholder}
      />
    </Field>
  );

  if (['framework_deadline_approaching', 'evidence_expires', 'certification_expiry_approaching'].includes(tt)) {
    return (
      <>
        <FwSelect />
        <DaysInput field="days_before" label="Days before deadline" placeholder="30" />
      </>
    );
  }
  if (tt === 'control_review_due') {
    return (
      <>
        <FwSelect label="Framework (optional)" />
        <DaysInput field="days_before" label="Days before review due" placeholder="14" />
      </>
    );
  }
  if (tt === 'framework_evidence_complete') {
    return (
      <>
        <FwSelect />
        <Field label="Minimum coverage threshold (%)">
          <input
            type="number"
            className={inputCls}
            min={1}
            max={100}
            value={(config?.coverage_threshold as number) || 100}
            onChange={(e) => onUpdate('coverage_threshold', Number(e.target.value) || 100)}
            placeholder="100"
          />
        </Field>
      </>
    );
  }
  if (tt === 'assessment_status_change') {
    return (
      <>
        <FwSelect />
        <Field label="From status (optional)">
          <select
            className={selectCls}
            value={(config?.from_status as string) || ''}
            onChange={(e) => onUpdate('from_status', e.target.value)}
          >
            <option value="">-- Any --</option>
            {compliance_statuses.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To status">
          <select
            className={selectCls}
            value={(config?.to_status as string) || ''}
            onChange={(e) => onUpdate('to_status', e.target.value)}
          >
            <option value="">-- Any --</option>
            {compliance_statuses.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }
  if (tt === 'compliance_gap_detected') {
    return <FwSelect anyLabel="-- Any framework --" />;
  }
  if (['evidence_uploaded', 'evidence_approved'].includes(tt)) {
    return (
      <>
        <FwSelect label="Framework (optional filter)" anyLabel="-- Any framework --" />
        <Field label="Evidence category (optional)">
          <select
            className={selectCls}
            value={(config?.evidence_category as string) || ''}
            onChange={(e) => onUpdate('evidence_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {evidence_categories.map((c) => (
              <option key={c} value={c}>
                {toLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }
  if (['risk_created', 'risk_updated', 'risk_status_changed', 'risk_score_exceeds_threshold'].includes(tt)) {
    return (
      <>
        <Field label="Risk category (optional filter)">
          <select
            className={selectCls}
            value={(config?.risk_category as string) || ''}
            onChange={(e) => onUpdate('risk_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {risk_categories.map((c) => (
              <option key={c} value={c}>
                {toLabel(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Register type (optional filter)">
          <select
            className={selectCls}
            value={(config?.register_type as string) || ''}
            onChange={(e) => onUpdate('register_type', e.target.value)}
          >
            <option value="">-- Any register type --</option>
            {(risk_register_types || []).map((r) => (
              <option key={r} value={r}>
                {toLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sub-category (optional filter)">
          <select
            className={selectCls}
            value={(config?.risk_sub_category as string) || ''}
            onChange={(e) => onUpdate('risk_sub_category', e.target.value)}
          >
            <option value="">-- Any sub-category --</option>
            {(risk_sub_categories || []).map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minimum risk level">
          <select
            className={selectCls}
            value={(config?.min_risk_level as string) || ''}
            onChange={(e) => onUpdate('min_risk_level', e.target.value)}
          >
            <option value="">-- Any level --</option>
            {risk_levels.map((l) => (
              <option key={l} value={l}>
                {toLabel(l)}
              </option>
            ))}
          </select>
        </Field>
        {tt === 'risk_score_exceeds_threshold' && (
          <Field label="Score threshold (0–100)">
            <input
              type="number"
              className={inputCls}
              min={0}
              max={100}
              value={(config?.threshold as number) ?? 70}
              onChange={(e) => onUpdate('threshold', Number(e.target.value))}
            />
          </Field>
        )}
        {tt === 'risk_status_changed' && (
          <>
            <Field label="From status">
              <select
                className={selectCls}
                value={(config?.from_status as string) || ''}
                onChange={(e) => onUpdate('from_status', e.target.value)}
              >
                <option value="">-- Any --</option>
                {risk_statuses.map((s) => (
                  <option key={s} value={s}>
                    {toLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To status">
              <select
                className={selectCls}
                value={(config?.to_status as string) || ''}
                onChange={(e) => onUpdate('to_status', e.target.value)}
              >
                <option value="">-- Any --</option>
                {risk_statuses.map((s) => (
                  <option key={s} value={s}>
                    {toLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </>
    );
  }
  if (['vulnerability_created', 'vulnerability_updated', 'new_vulnerability_detected', 'vulnerability_sla_breach', 'vulnerability_sla_warning'].includes(tt)) {
    return (
      <>
        <Field label="Minimum severity">
          <select
            className={selectCls}
            value={(config?.min_severity as string) || ''}
            onChange={(e) => onUpdate('min_severity', e.target.value)}
          >
            <option value="">-- Any severity --</option>
            {vulnerability_severities.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        {tt === 'vulnerability_sla_warning' && (
          <DaysInput field="warn_days_before" label="Warn when SLA within (days)" placeholder="7" />
        )}
      </>
    );
  }
  if (['policy_submitted_for_review', 'policy_review_due', 'policy_approved'].includes(tt)) {
    return (
      <>
        <Field label="Policy category (optional filter)">
          <select
            className={selectCls}
            value={(config?.policy_category as string) || ''}
            onChange={(e) => onUpdate('policy_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {policy_categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        {tt === 'policy_review_due' && (
          <DaysInput field="days_before" label="Warn days before review due" placeholder="14" />
        )}
      </>
    );
  }
  if (tt === 'audit_finding_created') {
    return (
      <>
        <Field label="Finding severity (optional filter)">
          <select
            className={selectCls}
            value={(config?.min_severity as string) || ''}
            onChange={(e) => onUpdate('min_severity', e.target.value)}
          >
            <option value="">-- Any severity --</option>
            {finding_severities.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Audit type (optional filter)">
          <select
            className={selectCls}
            value={(config?.audit_type as string) || ''}
            onChange={(e) => onUpdate('audit_type', e.target.value)}
          >
            <option value="">-- Any type --</option>
            {audit_types.map((a) => (
              <option key={a} value={a}>
                {toLabel(a)}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }
  if (tt === 'kri_breach') {
    return (
      <>
        <Field label="KRI category (optional)">
          <select
            className={selectCls}
            value={(config?.kri_category as string) || ''}
            onChange={(e) => onUpdate('kri_category', e.target.value)}
          >
            <option value="">-- Any --</option>
            {kri_categories.map((c) => (
              <option key={c} value={c}>
                {toLabel(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Breach threshold">
          <input
            type="number"
            className={inputCls}
            value={(config?.threshold as number) || ''}
            onChange={(e) => onUpdate('threshold', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g., 100"
          />
        </Field>
      </>
    );
  }
  if (tt === 'incident_reported') {
    return (
      <Field label="Minimum severity">
        <select
          className={selectCls}
          value={(config?.min_severity as string) || ''}
          onChange={(e) => onUpdate('min_severity', e.target.value)}
        >
          <option value="">-- Any severity --</option>
          {['critical', 'high', 'medium', 'low'].map((s) => (
            <option key={s} value={s}>
              {toLabel(s)}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (tt === 'attestation_overdue') {
    return (
      <DaysInput field="overdue_threshold_days" label="Overdue threshold (days)" placeholder="1" />
    );
  }
  if (['asset_created', 'asset_updated', 'asset_deleted'].includes(tt)) {
    if (tt === 'asset_deleted') return null;
    return (
      <>
        <Field label="Asset type (optional filter)">
          <select
            className={selectCls}
            value={(config?.asset_type as string) || ''}
            onChange={(e) => onUpdate('asset_type', e.target.value)}
          >
            <option value="">-- Any type --</option>
            {(asset_types && asset_types.length > 0
              ? asset_types
              : ['server', 'workstation', 'network_device', 'database', 'application', 'cloud_service', 'storage', 'endpoint', 'iot_device', 'virtual_machine']
            ).map((t) => (
              <option key={t} value={t}>
                {toLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minimum criticality (optional filter)">
          <select
            className={selectCls}
            value={(config?.min_criticality as string) || ''}
            onChange={(e) => onUpdate('min_criticality', e.target.value)}
          >
            <option value="">-- Any criticality --</option>
            {(asset_criticality_levels && asset_criticality_levels.length > 0
              ? asset_criticality_levels
              : ['critical', 'high', 'medium', 'low']
            ).map((c) => (
              <option key={c} value={c}>
                {toLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }
  if (tt === 'schedule_recurring') {
    return (
      <>
        <Field label="Cron expression">
          <input
            className={inputCls}
            value={(config?.cron as string) || ''}
            onChange={(e) => onUpdate('cron', e.target.value)}
            placeholder="0 9 * * 1"
          />
        </Field>
        <div className="text-[9px] text-gray-400 -mt-1 mb-1.5 leading-relaxed">
          Examples:{' '}
          <span className="font-mono">0 9 * * 1</span> = Mon 9am &nbsp;|&nbsp;{' '}
          <span className="font-mono">0 0 1 * *</span> = 1st of month
        </div>
      </>
    );
  }
  if (tt === 'webhook') {
    return (
      <Field label="Webhook secret (HMAC, optional)">
        <input
          className={inputCls}
          value={(config?.webhook_secret as string) || ''}
          onChange={(e) => onUpdate('webhook_secret', e.target.value)}
          placeholder="HMAC signing secret"
        />
      </Field>
    );
  }
  return null;
}

// ─── Action Sub-Config ────────────────────────────────────────────────────────
function ActionSubConfig({
  config,
  nodeConfigOptions,
  actorUsers,
  actorRoles,
  conditionPathOptions,
  selectedEscalateLevels,
  selectedRecipientUserIds,
  selectedRecipientRoleIds,
  onUpdate,
  inputCls,
  selectCls,
}: {
  config: Record<string, unknown>;
  nodeConfigOptions: NodeConfigOptions;
  actorUsers: Array<{ id: number; display_name: string; email: string }>;
  actorRoles: Array<{ id: number; name: string }>;
  conditionPathOptions: Array<{ value: string; label: string }>;
  selectedEscalateLevels: EscalationLevel[];
  selectedRecipientUserIds: string[];
  selectedRecipientRoleIds: string[];
  onUpdate: (field: string, value: unknown) => void;
  inputCls: string;
  selectCls: string;
}) {
  const actionName = (config?.action_name as string) || '';
  const {
    frameworks,
    risk_categories,
    risk_statuses,
    risk_treatment_types,
    compliance_statuses,
    vulnerability_severities,
    vulnerability_statuses,
    policy_categories,
    audit_types,
    finding_severities,
    control_effectiveness_levels,
    evidence_categories,
    report_types,
    remediation_priorities,
  } = nodeConfigOptions;

  const FwSelect = ({
    field = 'framework_id',
    label = 'Framework',
    anyLabel = '-- Select framework --',
  }: {
    field?: string;
    label?: string;
    anyLabel?: string;
  }) => (
    <Field label={label}>
      <select
        className={selectCls}
        value={String((config?.[field] as number) || '')}
        onChange={(e) => onUpdate(field, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{anyLabel}</option>
        {frameworks.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.version ? ` (${f.version})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );

  const UserMulti = ({
    field,
    label,
    placeholder = 'Select users',
  }: {
    field: string;
    label: string;
    placeholder?: string;
  }) => (
    <Field label={label}>
      <CheckboxMultiSelect
        options={actorUsers.map((u) => ({ value: u.id, label: u.display_name, subtitle: u.email }))}
        selectedValues={Array.isArray(config?.[field]) ? (config[field] as number[]) : []}
        onChange={(vals) => onUpdate(field, vals)}
        placeholder={placeholder}
        emptyMessage="No tenant users found"
      />
    </Field>
  );

  const RoleMulti = ({
    field,
    label,
    placeholder = 'Select roles',
  }: {
    field: string;
    label: string;
    placeholder?: string;
  }) => (
    <Field label={label}>
      <CheckboxMultiSelect
        options={actorRoles.map((r) => ({ value: r.id, label: r.name }))}
        selectedValues={Array.isArray(config?.[field]) ? (config[field] as number[]) : []}
        onChange={(vals) => onUpdate(field, vals)}
        placeholder={placeholder}
        emptyMessage="No tenant roles found"
      />
    </Field>
  );

  if (actionName === 'send_notification_email') {
    return (
      <>
        <Field label="To (direct email, optional)">
          <input
            className={inputCls}
            value={(config?.to as string) || ''}
            onChange={(e) => onUpdate('to', e.target.value)}
            placeholder="user@example.com"
          />
        </Field>
        <Field label="Recipient Users">
          <CheckboxMultiSelect
            options={actorUsers.map((u) => ({ value: u.id, label: u.display_name, subtitle: u.email }))}
            selectedValues={selectedRecipientUserIds.map(Number)}
            onChange={(vals) => onUpdate('recipient_user_ids', vals)}
            placeholder="Select users"
            emptyMessage="No tenant users found"
          />
        </Field>
        <Field label="Recipient Roles">
          <CheckboxMultiSelect
            options={actorRoles.map((r) => ({ value: r.id, label: r.name }))}
            selectedValues={selectedRecipientRoleIds.map(Number)}
            onChange={(vals) => onUpdate('recipient_role_ids', vals)}
            placeholder="Select roles"
            emptyMessage="No tenant roles found"
          />
        </Field>
        <Field label="Subject">
          <input
            className={inputCls}
            value={(config?.subject as string) || ''}
            onChange={(e) => onUpdate('subject', e.target.value)}
            placeholder="Workflow notification"
          />
        </Field>
        <Field label="Message Body">
          <textarea
            className={`${inputCls} h-16 resize-none`}
            value={(config?.body as string) || ''}
            onChange={(e) => onUpdate('body', e.target.value)}
            placeholder="Email body text..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'escalate_to_management') {
    return (
      <>
        <SectionLabel label="Escalation Levels" />
        <div className="text-[9px] text-gray-500 mb-1">
          Configure who gets notified at each level and how long to wait before escalating further.
        </div>
        <EscalationLevelsConfig
          levels={selectedEscalateLevels}
          actorUsers={actorUsers}
          actorRoles={actorRoles}
          conditionPathOptions={conditionPathOptions}
          onChange={(levels) => onUpdate('escalation_levels', levels)}
        />
      </>
    );
  }

  if (actionName === 'request_evidence_upload') {
    return (
      <>
        <Field label="Frameworks">
          <CheckboxMultiSelect
            options={frameworks.map((f) => ({
              value: f.id,
              label: `${f.name}${f.version ? ` (${f.version})` : ''}`,
            }))}
            selectedValues={Array.isArray(config?.framework_ids) ? (config.framework_ids as number[]) : []}
            onChange={(vals) => onUpdate('framework_ids', vals)}
            placeholder="Select frameworks"
            emptyMessage="No frameworks found"
          />
        </Field>
        <Field label="Evidence category (optional)">
          <select
            className={selectCls}
            value={(config?.evidence_category as string) || ''}
            onChange={(e) => onUpdate('evidence_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {evidence_categories.map((c) => (
              <option key={c} value={c}>
                {toLabel(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Request message">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.message as string) || ''}
            onChange={(e) => onUpdate('message', e.target.value)}
            placeholder="Please upload evidence for the listed requirements..."
          />
        </Field>
        <UserMulti field="notify_user_ids" label="Notify users" />
        <RoleMulti field="notify_role_ids" label="Notify roles" />
      </>
    );
  }

  if (actionName === 'request_evidence_review') {
    return (
      <>
        <FwSelect label="Framework (optional filter)" anyLabel="-- Any framework --" />
        <UserMulti field="reviewer_user_ids" label="Reviewer users" />
        <RoleMulti field="reviewer_role_ids" label="Reviewer roles" />
        <Field label="Review deadline (days from now)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.review_deadline_days as number) || ''}
            onChange={(e) =>
              onUpdate('review_deadline_days', e.target.value ? Number(e.target.value) : null)
            }
            placeholder="7"
          />
        </Field>
        <Field label="Review instructions (optional)">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.instructions as string) || ''}
            onChange={(e) => onUpdate('instructions', e.target.value)}
            placeholder="Please verify the attached evidence against..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'approve_evidence' || actionName === 'reject_evidence') {
    const isReject = actionName === 'reject_evidence';
    return (
      <>
        <FwSelect label="Framework (optional filter)" anyLabel="-- Any framework --" />
        <Field label="Evidence category (optional)">
          <select
            className={selectCls}
            value={(config?.evidence_category as string) || ''}
            onChange={(e) => onUpdate('evidence_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {evidence_categories.map((category) => (
              <option key={category} value={category}>
                {toLabel(category)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isReject ? 'Reviewer notes' : 'Approval notes'}>
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder={isReject ? 'Return reason and required revisions...' : 'Approved by automated workflow...'}
          />
        </Field>
        <UserMulti field="notify_user_ids" label="Notify users" />
        <RoleMulti field="notify_role_ids" label="Notify roles" />
      </>
    );
  }

  if (actionName === 'generate_report') {
    return (
      <>
        <Field label="Report type">
          <select
            className={selectCls}
            value={(config?.report_type as string) || ''}
            onChange={(e) => onUpdate('report_type', e.target.value)}
          >
            <option value="">-- Select report type --</option>
            {report_types.map((r) => (
              <option key={r} value={r}>
                {toLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <FwSelect label="Framework (optional filter)" anyLabel="-- All frameworks --" />
        <UserMulti field="recipient_user_ids" label="Send report to (users)" />
        <RoleMulti field="recipient_role_ids" label="Send report to (roles)" />
      </>
    );
  }

  if (actionName === 'update_compliance_status') {
    return (
      <>
        <FwSelect />
        <Field label="New status">
          <select
            className={selectCls}
            value={(config?.new_status as string) || ''}
            onChange={(e) => onUpdate('new_status', e.target.value)}
          >
            <option value="">-- Select status --</option>
            {compliance_statuses.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes / reason (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Status updated by automated workflow..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'start_compliance_assessment') {
    return (
      <>
        <FwSelect />
        <Field label="Assessment type">
          <select
            className={selectCls}
            value={(config?.assessment_type as string) || 'full'}
            onChange={(e) => onUpdate('assessment_type', e.target.value)}
          >
            <option value="full">Full assessment</option>
            <option value="delta">Delta review</option>
            <option value="evidence_refresh">Evidence refresh</option>
          </select>
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign to users" />
        <RoleMulti field="assignee_role_ids" label="Assign to roles" />
      </>
    );
  }

  if (actionName === 'close_compliance_gap') {
    return (
      <>
        <FwSelect label="Framework (optional filter)" anyLabel="-- Any framework --" />
        <Field label="Closure type">
          <select
            className={selectCls}
            value={(config?.closure_type as string) || ''}
            onChange={(e) => onUpdate('closure_type', e.target.value)}
          >
            <option value="">-- Select type --</option>
            <option value="remediated">Remediated</option>
            <option value="accepted_risk">Accepted Risk</option>
            <option value="compensating_control">Compensating Control</option>
          </select>
        </Field>
        <Field label="Closure notes template">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.notes_template as string) || ''}
            onChange={(e) => onUpdate('notes_template', e.target.value)}
            placeholder="Gap closed via automated remediation workflow..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'link_evidence_to_control') {
    return (
      <>
        <FwSelect label="Framework" anyLabel="-- Select framework --" />
        <Field label="Evidence category (optional)">
          <select
            className={selectCls}
            value={(config?.evidence_category as string) || ''}
            onChange={(e) => onUpdate('evidence_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {evidence_categories.map((category) => (
              <option key={category} value={category}>
                {toLabel(category)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Linking notes (optional)">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Link matched evidence to the relevant controls..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'assign_control_owner') {
    return (
      <>
        <FwSelect label="Framework (optional filter)" anyLabel="-- Any framework --" />
        <Field label="Assign to user">
          <select
            className={selectCls}
            value={String((config?.assignee_user_id as number) || '')}
            onChange={(e) =>
              onUpdate('assignee_user_id', e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">-- Select user --</option>
            {actorUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name} ({u.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assign to role (optional)">
          <select
            className={selectCls}
            value={String((config?.assignee_role_id as number) || '')}
            onChange={(e) =>
              onUpdate('assignee_role_id', e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">-- Select role --</option>
            {actorRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (actionName === 'create_risk_entry') {
    return (
      <>
        <Field label="Risk category">
          <select
            className={selectCls}
            value={(config?.risk_category as string) || 'operational'}
            onChange={(e) => onUpdate('risk_category', e.target.value)}
          >
            {risk_categories.map((c) => (
              <option key={c} value={c}>
                {toLabel(c)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Initial likelihood (1–5)">
            <input
              type="number"
              className={inputCls}
              min={1}
              max={5}
              value={(config?.likelihood as number) || 3}
              onChange={(e) => onUpdate('likelihood', Number(e.target.value))}
            />
          </Field>
          <Field label="Initial impact (1–5)">
            <input
              type="number"
              className={inputCls}
              min={1}
              max={5}
              value={(config?.impact as number) || 3}
              onChange={(e) => onUpdate('impact', Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Risk title template">
          <input
            className={inputCls}
            value={(config?.title_template as string) || ''}
            onChange={(e) => onUpdate('title_template', e.target.value)}
            placeholder="Risk identified: {{trigger.title}}"
          />
        </Field>
        <UserMulti field="owner_user_ids" label="Assign risk owner" />
      </>
    );
  }

  if (actionName === 'update_risk_status') {
    return (
      <>
        <Field label="New risk status">
          <select
            className={selectCls}
            value={(config?.new_status as string) || ''}
            onChange={(e) => onUpdate('new_status', e.target.value)}
          >
            <option value="">-- Select status --</option>
            {risk_statuses.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Treatment type">
          <select
            className={selectCls}
            value={(config?.treatment_type as string) || ''}
            onChange={(e) => onUpdate('treatment_type', e.target.value)}
          >
            <option value="">-- Select treatment --</option>
            {risk_treatment_types.map((t) => (
              <option key={t} value={t}>
                {toLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status update notes">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Status updated by automated workflow..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'assign_risk_owner') {
    return (
      <>
        <Field label="Assign to user">
          <select
            className={selectCls}
            value={String((config?.assignee_user_id as number) || '')}
            onChange={(e) => onUpdate('assignee_user_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">-- Select user --</option>
            {actorUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name} ({user.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assign to role (optional)">
          <select
            className={selectCls}
            value={String((config?.assignee_role_id as number) || '')}
            onChange={(e) => onUpdate('assignee_role_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">-- Select role --</option>
            {actorRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={Boolean(config?.notify_assignee)}
            onChange={(e) => onUpdate('notify_assignee', e.target.checked)}
          />
          Notify assignee
        </label>
      </>
    );
  }

  if (actionName === 'trigger_risk_review') {
    return (
      <>
        <FwSelect label="Framework (optional scope)" anyLabel="-- Any framework --" />
        <Field label="Review due in (days)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.due_days as number) || ''}
            onChange={(e) => onUpdate('due_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="14"
          />
        </Field>
        <UserMulti field="reviewer_user_ids" label="Reviewer users" />
        <RoleMulti field="reviewer_role_ids" label="Reviewer roles" />
      </>
    );
  }

  if (actionName === 'create_remediation_task') {
    return (
      <>
        <Field label="Task title template">
          <input
            className={inputCls}
            value={(config?.title_template as string) || ''}
            onChange={(e) => onUpdate('title_template', e.target.value)}
            placeholder="Remediate: {{trigger.title}}"
          />
        </Field>
        <Field label="Priority">
          <select
            className={selectCls}
            value={(config?.priority as string) || 'high'}
            onChange={(e) => onUpdate('priority', e.target.value)}
          >
            {remediation_priorities.map((p) => (
              <option key={p} value={p}>
                {toLabel(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due in (days from trigger)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.due_days as number) || ''}
            onChange={(e) => onUpdate('due_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="30"
          />
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign to users" />
        <RoleMulti field="assignee_role_ids" label="Assign to roles" />
      </>
    );
  }

  if (actionName === 'assign_vulnerability_owner') {
    return (
      <>
        <Field label="Target severity (optional filter)">
          <select
            className={selectCls}
            value={(config?.target_severity as string) || ''}
            onChange={(e) => onUpdate('target_severity', e.target.value)}
          >
            <option value="">-- Any severity --</option>
            {vulnerability_severities.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign to users" />
        <RoleMulti field="assignee_role_ids" label="Assign to roles" />
        <Field label="Assignment notes (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Assigned via automated workflow..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_vulnerability_status') {
    return (
      <>
        <Field label="Target severity (optional filter)">
          <select
            className={selectCls}
            value={(config?.target_severity as string) || ''}
            onChange={(e) => onUpdate('target_severity', e.target.value)}
          >
            <option value="">-- Any severity --</option>
            {vulnerability_severities.map((severity) => (
              <option key={severity} value={severity}>
                {toLabel(severity)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="New status">
          <select
            className={selectCls}
            value={(config?.new_status as string) || ''}
            onChange={(e) => onUpdate('new_status', e.target.value)}
          >
            <option value="">-- Select status --</option>
            {vulnerability_statuses.map((status) => (
              <option key={status} value={status}>
                {toLabel(status)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Update notes">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Status updated by automated workflow..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'create_vulnerability_entry') {
    return (
      <>
        <Field label="Title template">
          <input
            className={inputCls}
            value={(config?.title_template as string) || ''}
            onChange={(e) => onUpdate('title_template', e.target.value)}
            placeholder="Vulnerability detected: {{trigger.title}}"
          />
        </Field>
        <Field label="Severity">
          <select
            className={selectCls}
            value={(config?.severity as string) || 'medium'}
            onChange={(e) => onUpdate('severity', e.target.value)}
          >
            {vulnerability_severities.map((severity) => (
              <option key={severity} value={severity}>
                {toLabel(severity)}
              </option>
            ))}
          </select>
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign to users" />
      </>
    );
  }

  if (actionName === 'create_policy_review_task') {
    return (
      <>
        <Field label="Policy category (optional filter)">
          <select
            className={selectCls}
            value={(config?.policy_category as string) || ''}
            onChange={(e) => onUpdate('policy_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {policy_categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <UserMulti field="reviewer_user_ids" label="Reviewer users" />
        <RoleMulti field="reviewer_role_ids" label="Reviewer roles" />
        <Field label="Review due in (days from trigger)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.due_days as number) || ''}
            onChange={(e) => onUpdate('due_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="14"
          />
        </Field>
      </>
    );
  }

  if (actionName === 'publish_policy') {
    return (
      <>
        <Field label="Policy category (optional filter)">
          <select
            className={selectCls}
            value={(config?.policy_category as string) || ''}
            onChange={(e) => onUpdate('policy_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {policy_categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        <UserMulti field="distribution_user_ids" label="Notify users" />
        <RoleMulti field="distribution_role_ids" label="Notify roles" />
        <Field label="Notification message">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.message as string) || ''}
            onChange={(e) => onUpdate('message', e.target.value)}
            placeholder="The policy has been published and is available for review."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'submit_policy_exception' || actionName === 'approve_policy_exception') {
    const isApproval = actionName === 'approve_policy_exception';
    return (
      <>
        <Field label="Policy category (optional filter)">
          <select
            className={selectCls}
            value={(config?.policy_category as string) || ''}
            onChange={(e) => onUpdate('policy_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {policy_categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isApproval ? 'Approval notes' : 'Justification'}>
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.justification as string) || ''}
            onChange={(e) => onUpdate('justification', e.target.value)}
            placeholder={isApproval ? 'Approved with noted business exception...' : 'Business reason for this exception...'}
          />
        </Field>
        <UserMulti field={isApproval ? 'notify_user_ids' : 'approver_user_ids'} label={isApproval ? 'Notify users' : 'Approver users'} />
        <RoleMulti field={isApproval ? 'notify_role_ids' : 'approver_role_ids'} label={isApproval ? 'Notify roles' : 'Approver roles'} />
      </>
    );
  }

  if (actionName === 'request_attestation') {
    return (
      <>
        <Field label="Policy category (optional filter)">
          <select
            className={selectCls}
            value={(config?.policy_category as string) || ''}
            onChange={(e) => onUpdate('policy_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {policy_categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        <FwSelect label="Framework (optional scope)" anyLabel="-- Any framework --" />
        <Field label="Attestation due in (days)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.deadline_days as number) || ''}
            onChange={(e) => onUpdate('deadline_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="10"
          />
        </Field>
        <UserMulti field="assignee_user_ids" label="Attesting users" />
        <RoleMulti field="assignee_role_ids" label="Attesting roles" />
      </>
    );
  }

  if (actionName === 'create_audit_finding') {
    return (
      <>
        <Field label="Audit type">
          <select
            className={selectCls}
            value={(config?.audit_type as string) || ''}
            onChange={(e) => onUpdate('audit_type', e.target.value)}
          >
            <option value="">-- Select type --</option>
            {audit_types.map((a) => (
              <option key={a} value={a}>
                {toLabel(a)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Finding severity">
          <select
            className={selectCls}
            value={(config?.severity as string) || 'medium'}
            onChange={(e) => onUpdate('severity', e.target.value)}
          >
            {finding_severities.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Finding description template">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.description_template as string) || ''}
            onChange={(e) => onUpdate('description_template', e.target.value)}
            placeholder="Finding: {{trigger.title}}"
          />
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign to" />
      </>
    );
  }

  if (actionName === 'create_audit_plan') {
    return (
      <>
        <Field label="Audit type">
          <select
            className={selectCls}
            value={(config?.audit_type as string) || ''}
            onChange={(e) => onUpdate('audit_type', e.target.value)}
          >
            <option value="">-- Select type --</option>
            {audit_types.map((auditType) => (
              <option key={auditType} value={auditType}>
                {toLabel(auditType)}
              </option>
            ))}
          </select>
        </Field>
        <FwSelect label="Framework (optional scope)" anyLabel="-- Any framework --" />
        <Field label="Start in (days)">
          <input
            type="number"
            className={inputCls}
            min={0}
            value={(config?.start_date_offset_days as number) || ''}
            onChange={(e) => onUpdate('start_date_offset_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="7"
          />
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign auditors" />
      </>
    );
  }

  if (actionName === 'close_audit_finding') {
    return (
      <>
        <Field label="Finding severity (optional filter)">
          <select
            className={selectCls}
            value={(config?.severity as string) || ''}
            onChange={(e) => onUpdate('severity', e.target.value)}
          >
            <option value="">-- Any severity --</option>
            {finding_severities.map((severity) => (
              <option key={severity} value={severity}>
                {toLabel(severity)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Closure notes">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Finding closed by automated workflow..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'assign_auditor') {
    return (
      <>
        <Field label="Audit type (optional filter)">
          <select
            className={selectCls}
            value={(config?.audit_type as string) || ''}
            onChange={(e) => onUpdate('audit_type', e.target.value)}
          >
            <option value="">-- Any audit type --</option>
            {audit_types.map((auditType) => (
              <option key={auditType} value={auditType}>
                {toLabel(auditType)}
              </option>
            ))}
          </select>
        </Field>
        <UserMulti field="assignee_user_ids" label="Assign auditor users" />
        <RoleMulti field="assignee_role_ids" label="Assign auditor roles" />
      </>
    );
  }

  if (actionName === 'update_control_effectiveness') {
    return (
      <>
        <FwSelect label="Framework (optional scope)" anyLabel="-- Any framework --" />
        <Field label="Effectiveness rating">
          <select
            className={selectCls}
            value={(config?.effectiveness_level as string) || ''}
            onChange={(e) => onUpdate('effectiveness_level', e.target.value)}
          >
            <option value="">-- Select rating --</option>
            {control_effectiveness_levels.map((level) => (
              <option key={level} value={level}>
                {toLabel(level)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Evidence notes">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.evidence_notes as string) || ''}
            onChange={(e) => onUpdate('evidence_notes', e.target.value)}
            placeholder="Why this control rating changed..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'set_control_not_applicable') {
    return (
      <>
        <FwSelect label="Framework (optional scope)" anyLabel="-- Any framework --" />
        <Field label="Justification">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.justification as string) || ''}
            onChange={(e) => onUpdate('justification', e.target.value)}
            placeholder="Explain why this control is not applicable..."
          />
        </Field>
        <UserMulti field="approval_user_ids" label="Approval users" />
        <RoleMulti field="approval_role_ids" label="Approval roles" />
      </>
    );
  }

  if (actionName === 'send_in_app_alert') {
    return (
      <>
        <Field label="Recipient Users">
          <CheckboxMultiSelect
            options={actorUsers.map((u) => ({ value: u.id, label: u.display_name, subtitle: u.email }))}
            selectedValues={selectedRecipientUserIds.map(Number)}
            onChange={(vals) => onUpdate('recipient_user_ids', vals)}
            placeholder="Select users"
            emptyMessage="No tenant users found"
          />
        </Field>
        <Field label="Recipient Roles">
          <CheckboxMultiSelect
            options={actorRoles.map((r) => ({ value: r.id, label: r.name }))}
            selectedValues={selectedRecipientRoleIds.map(Number)}
            onChange={(vals) => onUpdate('recipient_role_ids', vals)}
            placeholder="Select roles"
            emptyMessage="No tenant roles found"
          />
        </Field>
        <Field label="Alert type">
          <select
            className={selectCls}
            value={(config?.notification_type as string) || 'info'}
            onChange={(e) => onUpdate('notification_type', e.target.value)}
          >
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error / Urgent</option>
          </select>
        </Field>
        <Field label="Subject">
          <input
            className={inputCls}
            value={(config?.subject as string) || ''}
            onChange={(e) => onUpdate('subject', e.target.value)}
            placeholder="Workflow alert: {{workflow_name}}"
          />
        </Field>
        <Field label="Message">
          <textarea
            className={`${inputCls} h-16 resize-none`}
            value={(config?.message as string) || ''}
            onChange={(e) => onUpdate('message', e.target.value)}
            placeholder="Alert details..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'call_webhook_api') {
    return (
      <>
        <Field label="URL">
          <input
            className={inputCls}
            value={(config?.url as string) || ''}
            onChange={(e) => onUpdate('url', e.target.value)}
            placeholder="https://api.example.com/webhook"
          />
        </Field>
        <Field label="HTTP method">
          <select
            className={selectCls}
            value={(config?.method as string) || 'POST'}
            onChange={(e) => onUpdate('method', e.target.value)}
          >
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
          </select>
        </Field>
        <Field label="Headers (JSON)">
          <textarea
            className={`${inputCls} h-14 font-mono text-[10px] resize-none`}
            value={(config?.headers as string) || ''}
            onChange={(e) => onUpdate('headers', e.target.value)}
            placeholder={'{"Authorization": "Bearer TOKEN"}'}
          />
        </Field>
        <Field label="Body template (JSON)">
          <textarea
            className={`${inputCls} h-14 font-mono text-[10px] resize-none`}
            value={(config?.body_template as string) || ''}
            onChange={(e) => onUpdate('body_template', e.target.value)}
            placeholder={'{"event": "{{trigger.type}}", "id": "{{trigger.id}}"}'}
          />
        </Field>
      </>
    );
  }

  // ── KRI management ─────────────────────────────────────────────────────────
  if (actionName === 'create_kri') {
    return (
      <>
        <SectionLabel label="KRI Details" />
        <Field label="Linked risk ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.risk_id as number) || ''}
            onChange={(e) => onUpdate('risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 42"
          />
        </Field>
        <Field label="KRI name">
          <input
            className={inputCls}
            value={(config?.name as string) || ''}
            onChange={(e) => onUpdate('name', e.target.value)}
            placeholder="Operational loss frequency"
          />
        </Field>
        <Field label="Metric type">
          <select
            className={selectCls}
            value={(config?.metric_type as string) || 'numeric'}
            onChange={(e) => onUpdate('metric_type', e.target.value)}
          >
            {['numeric', 'percentage', 'boolean', 'rating'].map((t) => (
              <option key={t} value={t}>{toLabel(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Unit (optional)">
          <input
            className={inputCls}
            value={(config?.unit as string) || ''}
            onChange={(e) => onUpdate('unit', e.target.value)}
            placeholder="incidents, %, USD"
          />
        </Field>
        <SectionLabel label="Thresholds" />
        <Field label="Green threshold (≤)">
          <input
            type="number"
            className={inputCls}
            value={(config?.green_threshold as number) ?? ''}
            onChange={(e) => onUpdate('green_threshold', e.target.value ? Number(e.target.value) : null)}
            placeholder="5"
          />
        </Field>
        <Field label="Amber threshold (≤)">
          <input
            type="number"
            className={inputCls}
            value={(config?.amber_threshold as number) ?? ''}
            onChange={(e) => onUpdate('amber_threshold', e.target.value ? Number(e.target.value) : null)}
            placeholder="10"
          />
        </Field>
        <Field label="Threshold direction">
          <select
            className={selectCls}
            value={(config?.threshold_direction as string) || 'lower_is_better'}
            onChange={(e) => onUpdate('threshold_direction', e.target.value)}
          >
            <option value="lower_is_better">Lower is better</option>
            <option value="higher_is_better">Higher is better</option>
          </select>
        </Field>
        <Field label="Measurement frequency">
          <select
            className={selectCls}
            value={(config?.frequency as string) || 'monthly'}
            onChange={(e) => onUpdate('frequency', e.target.value)}
          >
            {['daily', 'weekly', 'monthly', 'quarterly', 'annual'].map((f) => (
              <option key={f} value={f}>{toLabel(f)}</option>
            ))}
          </select>
        </Field>
        <Field label="KRI owner ID (optional)">
          <input
            type="number"
            className={inputCls}
            value={(config?.owner_id as number) || ''}
            onChange={(e) => onUpdate('owner_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="User ID"
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_kri_value') {
    return (
      <>
        <Field label="KRI ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.kri_id as number) || ''}
            onChange={(e) => onUpdate('kri_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 7"
          />
        </Field>
        <Field label="Measured value">
          <input
            type="number"
            className={inputCls}
            value={(config?.value as number) ?? ''}
            onChange={(e) => onUpdate('value', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 8.5"
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Source of measurement..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'resolve_kri_breach') {
    return (
      <>
        <Field label="KRI ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.kri_id as number) || ''}
            onChange={(e) => onUpdate('kri_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 7"
          />
        </Field>
        <Field label="Resolution notes">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Root cause addressed and KRI returned to green..."
          />
        </Field>
      </>
    );
  }

  // ── Incident management ────────────────────────────────────────────────────
  if (actionName === 'create_incident') {
    return (
      <>
        <SectionLabel label="Incident Details" />
        <Field label="Title">
          <input
            className={inputCls}
            value={(config?.title as string) || ''}
            onChange={(e) => onUpdate('title', e.target.value)}
            placeholder="System outage caused by process failure"
          />
        </Field>
        <Field label="Severity">
          <select
            className={selectCls}
            value={(config?.severity as string) || 'medium'}
            onChange={(e) => onUpdate('severity', e.target.value)}
          >
            {['critical', 'high', 'medium', 'low'].map((s) => (
              <option key={s} value={s}>{toLabel(s)}</option>
            ))}
          </select>
        </Field>
        <Field label="Linked risk ID (optional)">
          <input
            type="number"
            className={inputCls}
            value={(config?.risk_id as number) || ''}
            onChange={(e) => onUpdate('risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="Risk ID"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.description as string) || ''}
            onChange={(e) => onUpdate('description', e.target.value)}
            placeholder="Initial incident description..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_incident_status') {
    return (
      <>
        <Field label="Incident ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.incident_id as number) || ''}
            onChange={(e) => onUpdate('incident_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 15"
          />
        </Field>
        <Field label="New status">
          <select
            className={selectCls}
            value={(config?.status as string) || 'investigating'}
            onChange={(e) => onUpdate('status', e.target.value)}
          >
            {['open', 'investigating', 'contained', 'resolved', 'closed'].map((s) => (
              <option key={s} value={s}>{toLabel(s)}</option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (actionName === 'assign_incident_owner') {
    return (
      <>
        <Field label="Incident ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.incident_id as number) || ''}
            onChange={(e) => onUpdate('incident_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 15"
          />
        </Field>
        <Field label="Assignee user ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.assignee_user_id as number) || ''}
            onChange={(e) => onUpdate('assignee_user_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="User ID"
          />
        </Field>
      </>
    );
  }

  if (actionName === 'close_incident') {
    return (
      <>
        <Field label="Incident ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.incident_id as number) || ''}
            onChange={(e) => onUpdate('incident_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 15"
          />
        </Field>
        <Field label="Lessons learned">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.lessons_learned as string) || ''}
            onChange={(e) => onUpdate('lessons_learned', e.target.value)}
            placeholder="What went wrong, what worked well..."
          />
        </Field>
        <Field label="Corrective actions">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.corrective_actions as string) || ''}
            onChange={(e) => onUpdate('corrective_actions', e.target.value)}
            placeholder="Steps taken to prevent recurrence..."
          />
        </Field>
      </>
    );
  }

  // ── Mitigation plans ───────────────────────────────────────────────────────
  if (actionName === 'create_mitigation_plan') {
    return (
      <>
        <SectionLabel label="Mitigation Plan Details" />
        <Field label="Linked risk ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.risk_id as number) || ''}
            onChange={(e) => onUpdate('risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 42"
          />
        </Field>
        <Field label="Plan title">
          <input
            className={inputCls}
            value={(config?.title as string) || ''}
            onChange={(e) => onUpdate('title', e.target.value)}
            placeholder="Implement access control improvements"
          />
        </Field>
        <Field label="Action type">
          <select
            className={selectCls}
            value={(config?.action_type as string) || 'mitigate'}
            onChange={(e) => onUpdate('action_type', e.target.value)}
          >
            {['mitigate', 'accept', 'transfer', 'avoid'].map((t) => (
              <option key={t} value={t}>{toLabel(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select
            className={selectCls}
            value={(config?.priority as string) || 'medium'}
            onChange={(e) => onUpdate('priority', e.target.value)}
          >
            {['critical', 'high', 'medium', 'low'].map((p) => (
              <option key={p} value={p}>{toLabel(p)}</option>
            ))}
          </select>
        </Field>
        <Field label="Owner user ID (optional)">
          <input
            type="number"
            className={inputCls}
            value={(config?.owner_id as number) || ''}
            onChange={(e) => onUpdate('owner_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="User ID"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.description as string) || ''}
            onChange={(e) => onUpdate('description', e.target.value)}
            placeholder="Detailed plan steps..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_mitigation_status') {
    return (
      <>
        <Field label="Mitigation ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.mitigation_id as number) || ''}
            onChange={(e) => onUpdate('mitigation_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 8"
          />
        </Field>
        <Field label="New status">
          <select
            className={selectCls}
            value={(config?.status as string) || 'in_progress'}
            onChange={(e) => onUpdate('status', e.target.value)}
          >
            {['open', 'in_progress', 'completed', 'cancelled', 'on_hold'].map((s) => (
              <option key={s} value={s}>{toLabel(s)}</option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (actionName === 'link_risk_to_mitigation') {
    return (
      <>
        <Field label="Risk ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.risk_id as number) || ''}
            onChange={(e) => onUpdate('risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 42"
          />
        </Field>
        <Field label="Mitigation ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.mitigation_id as number) || ''}
            onChange={(e) => onUpdate('mitigation_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 8"
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Reason for linking..."
          />
        </Field>
      </>
    );
  }

  // ── RCSA ───────────────────────────────────────────────────────────────────
  if (actionName === 'initiate_rcsa') {
    return (
      <>
        <SectionLabel label="RCSA Campaign" />
        <Field label="Campaign name">
          <input
            className={inputCls}
            value={(config?.campaign_name as string) || ''}
            onChange={(e) => onUpdate('campaign_name', e.target.value)}
            placeholder="Q1 2026 RCSA"
          />
        </Field>
        <Field label="Period type">
          <select
            className={selectCls}
            value={(config?.period_type as string) || 'quarterly'}
            onChange={(e) => onUpdate('period_type', e.target.value)}
          >
            {['quarterly', 'semi_annual', 'annual', 'adhoc'].map((p) => (
              <option key={p} value={p}>{toLabel(p)}</option>
            ))}
          </select>
        </Field>
        <Field label="Period label (optional)">
          <input
            className={inputCls}
            value={(config?.period_label as string) || ''}
            onChange={(e) => onUpdate('period_label', e.target.value)}
            placeholder="Q1 2026"
          />
        </Field>
      </>
    );
  }

  if (actionName === 'submit_rcsa_results') {
    return (
      <>
        <Field label="Assessment ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.assessment_id as number) || ''}
            onChange={(e) => onUpdate('assessment_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 5"
          />
        </Field>
        <Field label="Notes (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.notes as string) || ''}
            onChange={(e) => onUpdate('notes', e.target.value)}
            placeholder="Submission notes..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'review_rcsa') {
    return (
      <>
        <Field label="Assessment ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.assessment_id as number) || ''}
            onChange={(e) => onUpdate('assessment_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 5"
          />
        </Field>
        <Field label="Reviewer user ID (optional)">
          <input
            type="number"
            className={inputCls}
            value={(config?.reviewer_id as number) || ''}
            onChange={(e) => onUpdate('reviewer_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="User ID"
          />
        </Field>
      </>
    );
  }

  // ── Risk reviews ───────────────────────────────────────────────────────────
  if (actionName === 'schedule_risk_review') {
    return (
      <>
        <Field label="Risk ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.risk_id as number) || ''}
            onChange={(e) => onUpdate('risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 42"
          />
        </Field>
        <Field label="Review cycle">
          <select
            className={selectCls}
            value={(config?.review_cycle as string) || 'quarterly'}
            onChange={(e) => onUpdate('review_cycle', e.target.value)}
          >
            {['monthly', 'quarterly', 'semi_annual', 'annual', 'adhoc'].map((c) => (
              <option key={c} value={c}>{toLabel(c)}</option>
            ))}
          </select>
        </Field>
        <Field label="Due in (days from trigger)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.due_days as number) || 90}
            onChange={(e) => onUpdate('due_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="90"
          />
        </Field>
      </>
    );
  }

  if (actionName === 'complete_risk_review') {
    return (
      <>
        <Field label="Review ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.review_id as number) || ''}
            onChange={(e) => onUpdate('review_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 3"
          />
        </Field>
        <Field label="Findings">
          <textarea
            className={`${inputCls} h-14 resize-none`}
            value={(config?.findings as string) || ''}
            onChange={(e) => onUpdate('findings', e.target.value)}
            placeholder="Key findings from this review cycle..."
          />
        </Field>
        <Field label="Recommendations (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.recommendations as string) || ''}
            onChange={(e) => onUpdate('recommendations', e.target.value)}
            placeholder="Suggested next steps..."
          />
        </Field>
      </>
    );
  }

  // ── Risk assessments ───────────────────────────────────────────────────────
  if (actionName === 'create_risk_assessment') {
    return (
      <>
        <SectionLabel label="Assessment Details" />
        <Field label="Assessment name">
          <input
            className={inputCls}
            value={(config?.name as string) || ''}
            onChange={(e) => onUpdate('name', e.target.value)}
            placeholder="Annual IT Risk Assessment 2026"
          />
        </Field>
        <Field label="Assessment type">
          <select
            className={selectCls}
            value={(config?.assessment_type as string) || 'periodic'}
            onChange={(e) => onUpdate('assessment_type', e.target.value)}
          >
            {['periodic', 'event_driven', 'continuous', 'pre_project', 'regulatory'].map((t) => (
              <option key={t} value={t}>{toLabel(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Methodology (optional)">
          <select
            className={selectCls}
            value={(config?.methodology as string) || ''}
            onChange={(e) => onUpdate('methodology', e.target.value)}
          >
            <option value="">-- Select --</option>
            {['qualitative', 'quantitative', 'hybrid', 'iso31000', 'nist_rmf', 'fair'].map((m) => (
              <option key={m} value={m}>{toLabel(m)}</option>
            ))}
          </select>
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.description as string) || ''}
            onChange={(e) => onUpdate('description', e.target.value)}
            placeholder="Scope and objectives..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_risk_assessment_status') {
    return (
      <>
        <Field label="Assessment ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.assessment_id as number) || ''}
            onChange={(e) => onUpdate('assessment_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 12"
          />
        </Field>
        <Field label="New status">
          <select
            className={selectCls}
            value={(config?.status as string) || 'in_progress'}
            onChange={(e) => onUpdate('status', e.target.value)}
          >
            {['draft', 'in_progress', 'review', 'approved', 'closed'].map((s) => (
              <option key={s} value={s}>{toLabel(s)}</option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (actionName === 'assign_risk_assessor') {
    return (
      <>
        <Field label="Assessment ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.assessment_id as number) || ''}
            onChange={(e) => onUpdate('assessment_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 12"
          />
        </Field>
        <Field label="Assessor user ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.assessor_id as number) || ''}
            onChange={(e) => onUpdate('assessor_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="User ID"
          />
        </Field>
      </>
    );
  }

  // ── Internal controls ──────────────────────────────────────────────────────
  if (actionName === 'create_internal_control') {
    return (
      <>
        <SectionLabel label="Control Details" />
        <Field label="Control name">
          <input
            className={inputCls}
            value={(config?.name as string) || ''}
            onChange={(e) => onUpdate('name', e.target.value)}
            placeholder="Privileged access review"
          />
        </Field>
        <Field label="Control ID / code">
          <input
            className={inputCls}
            value={(config?.control_id as string) || ''}
            onChange={(e) => onUpdate('control_id', e.target.value)}
            placeholder="IC-IT-001"
          />
        </Field>
        <Field label="Control type">
          <select
            className={selectCls}
            value={(config?.control_type as string) || 'preventive'}
            onChange={(e) => onUpdate('control_type', e.target.value)}
          >
            {['preventive', 'detective', 'corrective', 'directive', 'compensating'].map((t) => (
              <option key={t} value={t}>{toLabel(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Control nature">
          <select
            className={selectCls}
            value={(config?.control_nature as string) || 'manual'}
            onChange={(e) => onUpdate('control_nature', e.target.value)}
          >
            {['manual', 'automated', 'hybrid'].map((n) => (
              <option key={n} value={n}>{toLabel(n)}</option>
            ))}
          </select>
        </Field>
        <Field label="Category (optional)">
          <input
            className={inputCls}
            value={(config?.category as string) || ''}
            onChange={(e) => onUpdate('category', e.target.value)}
            placeholder="Access Management"
          />
        </Field>
        <Field label="Priority">
          <select
            className={selectCls}
            value={(config?.priority as string) || 'medium'}
            onChange={(e) => onUpdate('priority', e.target.value)}
          >
            {['critical', 'high', 'medium', 'low'].map((p) => (
              <option key={p} value={p}>{toLabel(p)}</option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (actionName === 'test_internal_control') {
    return (
      <>
        <Field label="Control ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.control_id as number) || ''}
            onChange={(e) => onUpdate('control_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 3"
          />
        </Field>
        <Field label="Test type">
          <select
            className={selectCls}
            value={(config?.test_type as string) || 'operating'}
            onChange={(e) => onUpdate('test_type', e.target.value)}
          >
            {['design', 'operating', 'walkthrough', 'inquiry', 'observation', 'reperformance'].map((t) => (
              <option key={t} value={t}>{toLabel(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Result">
          <select
            className={selectCls}
            value={(config?.result as string) || 'effective'}
            onChange={(e) => onUpdate('result', e.target.value)}
          >
            {['effective', 'partially_effective', 'ineffective', 'not_tested'].map((r) => (
              <option key={r} value={r}>{toLabel(r)}</option>
            ))}
          </select>
        </Field>
        <Field label="Findings (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.findings as string) || ''}
            onChange={(e) => onUpdate('findings', e.target.value)}
            placeholder="Observations from testing..."
          />
        </Field>
        <Field label="Recommendations (optional)">
          <textarea
            className={`${inputCls} h-10 resize-none`}
            value={(config?.recommendations as string) || ''}
            onChange={(e) => onUpdate('recommendations', e.target.value)}
            placeholder="Suggested improvements..."
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_control_test_result') {
    return (
      <>
        <Field label="Test ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.test_id as number) || ''}
            onChange={(e) => onUpdate('test_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 21"
          />
        </Field>
        <Field label="Result">
          <select
            className={selectCls}
            value={(config?.result as string) || 'effective'}
            onChange={(e) => onUpdate('result', e.target.value)}
          >
            {['effective', 'partially_effective', 'ineffective', 'not_tested'].map((r) => (
              <option key={r} value={r}>{toLabel(r)}</option>
            ))}
          </select>
        </Field>
        <Field label="Management response (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.management_response as string) || ''}
            onChange={(e) => onUpdate('management_response', e.target.value)}
            placeholder="Management's response to findings..."
          />
        </Field>
      </>
    );
  }

  // ── Risk appetite ──────────────────────────────────────────────────────────
  if (actionName === 'set_risk_appetite') {
    return (
      <>
        <SectionLabel label="Risk Appetite" />
        <Field label="Risk category">
          <select
            className={selectCls}
            value={(config?.category as string) || 'operational'}
            onChange={(e) => onUpdate('category', e.target.value)}
          >
            {['operational', 'financial', 'compliance', 'reputational', 'strategic', 'technology', 'third_party'].map((c) => (
              <option key={c} value={c}>{toLabel(c)}</option>
            ))}
          </select>
        </Field>
        <Field label="Appetite level">
          <select
            className={selectCls}
            value={(config?.appetite_level as string) || 'moderate'}
            onChange={(e) => onUpdate('appetite_level', e.target.value)}
          >
            {['averse', 'minimal', 'cautious', 'open', 'moderate', 'aggressive'].map((l) => (
              <option key={l} value={l}>{toLabel(l)}</option>
            ))}
          </select>
        </Field>
        <Field label="Max acceptable score (optional)">
          <input
            type="number"
            className={inputCls}
            min={0}
            max={25}
            value={(config?.max_acceptable_score as number) ?? ''}
            onChange={(e) => onUpdate('max_acceptable_score', e.target.value ? Number(e.target.value) : null)}
            placeholder="12"
          />
        </Field>
      </>
    );
  }

  if (actionName === 'update_risk_tolerance') {
    return (
      <>
        <Field label="Risk category">
          <select
            className={selectCls}
            value={(config?.category as string) || 'operational'}
            onChange={(e) => onUpdate('category', e.target.value)}
          >
            {['operational', 'financial', 'compliance', 'reputational', 'strategic', 'technology', 'third_party'].map((c) => (
              <option key={c} value={c}>{toLabel(c)}</option>
            ))}
          </select>
        </Field>
        <Field label="Tolerance threshold (numeric)">
          <input
            type="number"
            className={inputCls}
            min={0}
            value={(config?.tolerance_threshold as number) ?? ''}
            onChange={(e) => onUpdate('tolerance_threshold', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 8"
          />
        </Field>
        <Field label="Max acceptable score (optional)">
          <input
            type="number"
            className={inputCls}
            min={0}
            max={25}
            value={(config?.max_acceptable_score as number) ?? ''}
            onChange={(e) => onUpdate('max_acceptable_score', e.target.value ? Number(e.target.value) : null)}
            placeholder="12"
          />
        </Field>
      </>
    );
  }

  // ── Risk dependencies ──────────────────────────────────────────────────────
  if (actionName === 'add_risk_dependency') {
    return (
      <>
        <SectionLabel label="Risk Dependency" />
        <Field label="Source risk ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.source_risk_id as number) || ''}
            onChange={(e) => onUpdate('source_risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 42"
          />
        </Field>
        <Field label="Target risk ID">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.target_risk_id as number) || ''}
            onChange={(e) => onUpdate('target_risk_id', e.target.value ? Number(e.target.value) : null)}
            placeholder="e.g. 56"
          />
        </Field>
        <Field label="Dependency type">
          <select
            className={selectCls}
            value={(config?.dependency_type as string) || 'causes'}
            onChange={(e) => onUpdate('dependency_type', e.target.value)}
          >
            {['causes', 'exacerbates', 'mitigates', 'correlated', 'triggers'].map((t) => (
              <option key={t} value={t}>{toLabel(t)}</option>
            ))}
          </select>
        </Field>
        <Field label="Impact factor (0.0 – 2.0)">
          <input
            type="number"
            className={inputCls}
            min={0}
            max={2}
            step={0.1}
            value={(config?.impact_factor as number) ?? 1.0}
            onChange={(e) => onUpdate('impact_factor', e.target.value ? Number(e.target.value) : 1.0)}
            placeholder="1.0"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={`${inputCls} h-12 resize-none`}
            value={(config?.description as string) || ''}
            onChange={(e) => onUpdate('description', e.target.value)}
            placeholder="Nature of this dependency..."
          />
        </Field>
      </>
    );
  }

  return null;
}

// ─── Condition Sub-Config ─────────────────────────────────────────────────────
function ConditionSubConfig({
  config,
  nodeConfigOptions,
  actorRoles,
  nodeConfigText,
  onUpdate,
  onSetNodeConfigText,
  inputCls,
  selectCls,
}: {
  config: Record<string, unknown>;
  nodeConfigOptions: NodeConfigOptions;
  actorRoles: Array<{ id: number; name: string }>;
  nodeConfigText: string;
  onUpdate: (field: string, value: unknown) => void;
  onSetNodeConfigText: (v: string) => void;
  inputCls: string;
  selectCls: string;
}) {
  const kind = (config?.condition_kind as string) || '';
  const {
    frameworks,
    risk_levels,
    compliance_statuses,
    vulnerability_severities,
    policy_categories,
    policy_statuses,
  } = nodeConfigOptions;

  const FwSelect = ({
    field = 'framework_id',
    label = 'Framework',
    anyLabel = '-- Any framework --',
  }: {
    field?: string;
    label?: string;
    anyLabel?: string;
  }) => (
    <Field label={label}>
      <select
        className={selectCls}
        value={String((config?.[field] as number) || '')}
        onChange={(e) => onUpdate(field, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{anyLabel}</option>
        {frameworks.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.version ? ` (${f.version})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );

  const OpSelect = ({
    field = 'operator',
    label = 'Comparison',
    options,
  }: {
    field?: string;
    label?: string;
    options: Array<{ value: string; label: string }>;
  }) => (
    <Field label={label}>
      <select
        className={selectCls}
        value={(config?.[field] as string) || options[0]?.value || ''}
        onChange={(e) => onUpdate(field, e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );

  if (kind === 'check_risk_level') {
    return (
      <>
        <Field label="Risk level to check">
          <select
            className={selectCls}
            value={(config?.risk_level as string) || 'high'}
            onChange={(e) => onUpdate('risk_level', e.target.value)}
          >
            {risk_levels.map((l) => (
              <option key={l} value={l}>
                {toLabel(l)}
              </option>
            ))}
          </select>
        </Field>
        <OpSelect
          field="operator"
          label="Match rule"
          options={[
            { value: 'at_least', label: 'At least this level (≥)' },
            { value: 'exact', label: 'Exactly this level (=)' },
          ]}
        />
        <div className="text-[9px] text-gray-400 -mt-1">
          Level order: Critical &gt; High &gt; Medium &gt; Low
        </div>
      </>
    );
  }

  if (kind === 'check_compliance_status') {
    return (
      <>
        <FwSelect />
        <Field label="Expected status">
          <select
            className={selectCls}
            value={(config?.expected_status as string) || ''}
            onChange={(e) => onUpdate('expected_status', e.target.value)}
          >
            <option value="">-- Select status --</option>
            {compliance_statuses.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <OpSelect
          field="operator"
          label="Match when status is"
          options={[
            { value: 'eq', label: 'Exactly this status' },
            { value: 'neq', label: 'Not this status' },
          ]}
        />
      </>
    );
  }

  if (kind === 'check_evidence_age') {
    return (
      <>
        <FwSelect label="Framework (optional)" anyLabel="-- Any framework --" />
        <Field label="Age threshold (days)">
          <input
            type="number"
            className={inputCls}
            min={1}
            value={(config?.age_days as number) || ''}
            onChange={(e) => onUpdate('age_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="90"
          />
        </Field>
        <OpSelect
          field="operator"
          label="Condition"
          options={[
            { value: 'older_than', label: 'Older than threshold' },
            { value: 'newer_than', label: 'Newer than threshold' },
          ]}
        />
      </>
    );
  }

  if (kind === 'check_evidence_completeness') {
    return (
      <>
        <FwSelect />
        <Field label="Minimum coverage (%)">
          <input
            type="number"
            className={inputCls}
            min={0}
            max={100}
            value={(config?.min_coverage_pct as number) ?? 80}
            onChange={(e) => onUpdate('min_coverage_pct', Number(e.target.value))}
            placeholder="80"
          />
        </Field>
        <div className="text-[9px] text-gray-400 -mt-1">
          Branches True if coverage ≥ threshold, False otherwise
        </div>
      </>
    );
  }

  if (kind === 'check_framework_coverage') {
    return (
      <>
        <FwSelect />
        <Field label="Minimum coverage (%)">
          <input
            type="number"
            className={inputCls}
            min={0}
            max={100}
            value={(config?.min_coverage_pct as number) ?? 90}
            onChange={(e) => onUpdate('min_coverage_pct', Number(e.target.value))}
            placeholder="90"
          />
        </Field>
      </>
    );
  }

  if (kind === 'check_vulnerability_severity') {
    return (
      <>
        <Field label="Severity to check">
          <select
            className={selectCls}
            value={(config?.severity as string) || 'high'}
            onChange={(e) => onUpdate('severity', e.target.value)}
          >
            {vulnerability_severities.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <OpSelect
          field="operator"
          label="Match rule"
          options={[
            { value: 'at_least', label: 'At least this severity (≥)' },
            { value: 'exact', label: 'Exactly this severity (=)' },
          ]}
        />
      </>
    );
  }

  if (kind === 'check_policy_status') {
    return (
      <>
        <Field label="Policy category (optional)">
          <select
            className={selectCls}
            value={(config?.policy_category as string) || ''}
            onChange={(e) => onUpdate('policy_category', e.target.value)}
          >
            <option value="">-- Any category --</option>
            {policy_categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expected policy status">
          <select
            className={selectCls}
            value={(config?.expected_status as string) || ''}
            onChange={(e) => onUpdate('expected_status', e.target.value)}
          >
            <option value="">-- Select status --</option>
            {policy_statuses.map((s) => (
              <option key={s} value={s}>
                {toLabel(s)}
              </option>
            ))}
          </select>
        </Field>
      </>
    );
  }

  if (kind === 'check_approval_status') {
    return (
      <Field label="Expected approval status">
        <select
          className={selectCls}
          value={(config?.expected_status as string) || 'approved'}
          onChange={(e) => onUpdate('expected_status', e.target.value)}
        >
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="pending">Pending</option>
          <option value="escalated">Escalated</option>
        </select>
      </Field>
    );
  }

  if (kind === 'check_user_role') {
    return (
      <Field label="Required role">
        <select
          className={selectCls}
          value={String((config?.required_role_id as number) || '')}
          onChange={(e) =>
            onUpdate('required_role_id', e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">-- Select role --</option>
          {actorRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (kind === 'evaluate_business_unit') {
    return (
      <Field label="Business unit name">
        <input
          className={inputCls}
          value={(config?.business_unit as string) || ''}
          onChange={(e) => onUpdate('business_unit', e.target.value)}
          placeholder="Enter exact business unit name"
        />
      </Field>
    );
  }

  // expression_builder or unknown: show JSON expression editor
  return (
    <>
      <Field label="Condition expression (JSON)">
        <textarea
          className={`${inputCls} h-20 font-mono text-[10px] resize-none`}
          value={nodeConfigText}
          onChange={(e) => onSetNodeConfigText(e.target.value)}
          placeholder='{"path": "trigger.severity", "operator": "eq", "value": "high"}'
        />
      </Field>
      <div className="text-[9px] text-gray-400 -mt-1">
        Paths: trigger.*, context.*, step.output.*
      </div>
    </>
  );
}

// ─── Dynamic platform-function param fields ──────────────────────────────────
// Searchable picker that loads real records (documents, controls, risks, …)
// for an object-reference config field. Also accepts a raw id or a
// {{trigger.id}} expression typed directly.
function RecordPicker({
  entity, value, onChange, inputCls,
}: {
  entity: string;
  value: unknown;
  onChange: (v: unknown) => void;
  inputCls: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Array<{ id: number; label: string }>>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await workflowEngineApi.catalog.lookup(entity, q);
        const list = (res.data as { results?: Array<{ id: number; label: string }> })?.results || [];
        if (active) setResults(list);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [entity, q, open]);

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={`Pick a ${entity}… or {{trigger.id}}`}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-52 overflow-auto">
          <input
            autoFocus
            className="w-full text-xs border-b border-gray-100 px-2 py-1.5 focus:outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${entity}…`}
          />
          {loading ? (
            <div className="px-2 py-1.5 text-[10px] text-gray-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-gray-400">No matches</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { onChange(r.id); setOpen(false); setQ(''); }}
                className="block w-full text-left px-2 py-1.5 text-xs hover:bg-indigo-50"
              >
                <span className="text-gray-800">{r.label}</span>{' '}
                <span className="text-gray-400">#{r.id}</span>
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="block w-full text-center px-2 py-1 text-[10px] text-gray-400 border-t border-gray-100 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// Renders one node parameter as the right control: enum → dropdown,
// entity → record picker, boolean → checkbox, array → CSV, else text.
function DynamicParamField({
  field, value, onChange, inputCls, selectCls,
}: {
  field: NodeParamField;
  value: unknown;
  onChange: (v: unknown) => void;
  inputCls: string;
  selectCls: string;
}) {
  const labelText = `${field.label}${field.required ? ' *' : ''}`;
  const strVal = value === undefined || value === null ? '' : String(value);

  let control: React.ReactNode;
  if (field.enum && field.enum.length > 0) {
    control = (
      <select className={selectCls} value={strVal} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select —</option>
        {field.enum.map((opt) => (
          <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
        ))}
      </select>
    );
  } else if (field.entity) {
    control = <RecordPicker entity={field.entity} value={value} onChange={onChange} inputCls={inputCls} />;
  } else if (field.type === 'boolean') {
    control = (
      <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={value === true || value === 'true'}
          onChange={(e) => onChange(e.target.checked)}
        />
        Enabled
      </label>
    );
  } else if (field.type === 'array') {
    const arrText = Array.isArray(value) ? (value as unknown[]).join(', ') : strVal;
    control = (
      <input
        className={inputCls}
        value={arrText}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        placeholder="comma-separated values"
      />
    );
  } else {
    control = (
      <input
        className={inputCls}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          field.format === 'date'
            ? 'YYYY-MM-DD'
            : field.location === 'path'
              ? '{{trigger.id}} or a specific id'
              : ''
        }
      />
    );
  }

  return <Field label={labelText}>{control}</Field>;
}

// ─── Node Config Body ─────────────────────────────────────────────────────────

function NodeConfigBody({
  node,
  nodeConfigText,
  actorUsers,
  actorRoles,
  actionOptions,
  conditionPathOptions,
  nodeConfigOptions,
  nodeParamSchemas,
  onUpdateNodeConfig,
  onSetNodeConfigText,
}: {
  node: Node<FlowNodeData>;
  nodeConfigText: string;
  actorUsers: Array<{ id: number; display_name: string; email: string; username?: string }>;
  actorRoles: Array<{ id: number; name: string; description?: string }>;
  actionOptions: NodeOptionItem[];
  conditionPathOptions: Array<{ value: string; label: string }>;
  nodeConfigOptions: NodeConfigOptions;
  nodeParamSchemas: NodeParamSchemas;
  onUpdateNodeConfig: (field: string, value: unknown) => void;
  onSetNodeConfigText: (v: string) => void;
}) {
  const { nodeKey, nodeType, label, config, isFirstAfterStart, triggerStatus, inferredTriggerEvent } = node.data;
  const nodeContext = getNodeCatalogContext(nodeType, config, nodeKey);
  const contextLabel = formatWorkflowContextLabel(nodeContext);
  const relevantTriggerKeys = getRelevantTriggerKeys(nodeContext);
  const relevantConditionKeys = getRelevantConditionKeys(nodeContext);
  const relevantActionOptions = getRelevantActionOptions(actionOptions, nodeContext);
  // Platform-function nodes get input fields derived from their real API
  // endpoint (path/query/body params) instead of the generic action picker.
  const _actionName = (config?.action_name as string) || '';
  const isPlatformAction = _actionName.startsWith('platform_action.');
  const platformParamFields: NodeParamField[] = isPlatformAction ? (nodeParamSchemas[_actionName] || []) : [];
  const selectedUserIds = Array.isArray(config?.approver_user_ids)
    ? (config.approver_user_ids as Array<string | number>).map(String)
    : [];
  const selectedRoleIds = Array.isArray(config?.approver_role_ids)
    ? (config.approver_role_ids as Array<string | number>).map(String)
    : [];
  const selectedRecipientUserIds = Array.isArray(config?.recipient_user_ids)
    ? (config.recipient_user_ids as Array<string | number>).map(String)
    : [];
  const selectedRecipientRoleIds = Array.isArray(config?.recipient_role_ids)
    ? (config.recipient_role_ids as Array<string | number>).map(String)
    : [];
  const selectedEscalateLevels: EscalationLevel[] = Array.isArray(config?.escalation_levels)
    ? (config.escalation_levels as Array<Record<string, unknown>>).map((lv, idx) => {
        // Back-compat: derive days/hours from a legacy timeout_value + unit when
        // the new wait_days/wait_hours fields aren't present on an older config.
        const hasNewWait = lv.wait_days !== undefined || lv.wait_hours !== undefined;
        const legacyVal = Number(lv.timeout_value || lv.timeout_hours || 0);
        const legacyUnit = ((lv.timeout_unit as string) || 'hours') === 'days' ? 'days' : 'hours';
        const waitDays = hasNewWait
          ? Math.max(0, Number(lv.wait_days) || 0)
          : (legacyUnit === 'days' ? legacyVal : 0);
        const waitHours = hasNewWait
          ? Math.max(0, Number(lv.wait_hours) || 0)
          : (legacyUnit === 'hours' ? legacyVal : 0);
        return {
          level: Number(lv.level || idx + 1),
          subject: String(lv.subject || ''),
          message: String(lv.message || ''),
          user_ids: Array.isArray(lv.user_ids) ? (lv.user_ids as Array<string | number>).map(Number).filter(Boolean) : [],
          role_ids: Array.isArray(lv.role_ids) ? (lv.role_ids as Array<string | number>).map(Number).filter(Boolean) : [],
          wait_days: waitDays,
          wait_hours: waitHours,
          escalation_mode: (lv.escalation_mode as EscalationLevel['escalation_mode']) || 'always',
          escalation_condition: (lv.escalation_condition as Record<string, unknown>) || {},
        };
      })
    : [];

  return (
    <>
      <SectionLabel label="Node Info" />
      <Field label="Node Type">
        <div className="text-xs text-gray-700 font-medium capitalize">{nodeType}</div>
      </Field>
      <Field label="Business Context">
        <div className="text-xs text-gray-600">{contextLabel}</div>
      </Field>
      {/* Label is editable for functional nodes only. Start/End are fixed
          markers, so renaming them adds no value and just clutters the panel. */}
      {nodeType !== 'start' && nodeType !== 'end' && (
        <Field label="Label">
          <input
            className={inputCls}
            value={label}
            onChange={(e) => onUpdateNodeConfig('label', e.target.value)}
          />
        </Field>
      )}

      {/* First-after-Start trigger banner — shows the inferred event when the node
          is trigger-eligible, or a clear warning otherwise. Suppressed for explicit
          trigger nodes (handled by the dedicated "Triggers When" block below). */}
      {isFirstAfterStart && nodeType !== 'start' && nodeType !== 'end' && (
        triggerStatus === 'valid' ? (
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2 leading-snug flex items-start gap-1.5">
            <span className="text-amber-600 mt-px">⚡</span>
            <span>
              <strong className="font-semibold">This node is the workflow trigger.</strong>{' '}
              When the system performs this action, the workflow will run automatically.
              {inferredTriggerEvent && (
                <> Trigger event: <code className="font-mono text-[10px] bg-amber-100 px-1 rounded">{inferredTriggerEvent}</code>.</>
              )}
            </span>
          </div>
        ) : (
          <div className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mb-2 leading-snug flex items-start gap-1.5">
            <span className="text-red-600 mt-px">⚠</span>
            <span>
              <strong className="font-semibold">Not a valid trigger.</strong>{' '}
              The first node after Start must be a Trigger or a Platform Function CRUD action
              that maps to a system event. Replace this node, or insert a Trigger before it.
            </span>
          </div>
        )
      )}

      {/* Trigger-specific fields. The default Start node (nodeKey === 'start')
          is a plain entry marker with no event picker — keeping it clean.
          (Legacy workflows that stored a dedicated trigger node still expose
          the picker so their event remains editable.) */}
      {nodeType === 'start' && nodeKey !== 'start' && (
        <>
          <SectionLabel label="Triggers When" />
          <p className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-1.5 mb-2 leading-snug">
            When someone performs this action in the platform, the entire workflow runs automatically.
          </p>
          <Field label="Event">
            <select
              className={selectCls}
              value={(config?.trigger_type as string) || ''}
              onChange={(e) => onUpdateNodeConfig('trigger_type', e.target.value)}
            >
              <option value="">— Choose an event —</option>
              <optgroup label="Evidence &amp; Compliance">
                {['evidence_uploaded','evidence_approved','evidence_expires','framework_deadline_approaching','framework_evidence_complete','assessment_status_change','compliance_gap_detected','certification_expiry_approaching']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Risk">
                {['risk_created','risk_updated','risk_deleted','risk_status_changed','risk_score_exceeds_threshold','kri_breach','incident_reported']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Vulnerability">
                {['vulnerability_created','vulnerability_updated','vulnerability_deleted','new_vulnerability_detected','vulnerability_sla_breach','vulnerability_sla_warning']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Governance &amp; Policy">
                {['policy_submitted_for_review','policy_review_due','policy_approved','control_review_due','attestation_overdue']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Governance Documents">
                {['governance_document_created','governance_document_expires','governance_document_published']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Audit">
                {['audit_finding_created','audit_finding_updated','audit_finding_closed']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="IT Assets">
                {['asset_created','asset_updated','asset_deleted']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Control Library">
                {['control_group_created','control_group_updated','control_group_deleted']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
              <optgroup label="Scheduled">
                {['schedule_recurring','webhook']
                  .filter(k => relevantTriggerKeys.includes(k))
                  .map(k => <option key={k} value={k}>{NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}</option>)}
              </optgroup>
            </select>
          </Field>
          {/* ─── Dynamic trigger sub-config ─────────────────────────────── */}
          {TriggerSubConfig({ config, nodeConfigOptions, onUpdate: onUpdateNodeConfig, inputCls, selectCls })}

          <Field label="Scope / description (optional)">
            <input
              className={inputCls}
              value={(config?.filter as string) || ''}
              onChange={(e) => onUpdateNodeConfig('filter', e.target.value)}
              placeholder="e.g., scope=production, team=security"
            />
          </Field>
        </>
      )}

      {/* Action fields */}
      {nodeType === 'action' && (
        <>
          <SectionLabel label="Action Settings" />

          {isPlatformAction ? (
            <>
              <Field label="Function">
                <div className="text-xs font-medium text-gray-700 leading-snug">{label}</div>
              </Field>
              {platformParamFields.length === 0 ? (
                <p className="text-[10px] text-gray-400 leading-snug">
                  This action runs on the triggering record and needs no extra inputs.
                </p>
              ) : (
                <div className="space-y-0.5">
                  <p className="text-[10px] text-gray-400 leading-snug mb-1">
                    Set this action&apos;s inputs. Leave blank to inherit from the trigger, or use an expression like {'{{trigger.id}}'}.
                  </p>
                  {platformParamFields.map((f) => (
                    <DynamicParamField
                      key={`${f.location}:${f.name}`}
                      field={f}
                      value={config?.[f.name]}
                      onChange={(v) => onUpdateNodeConfig(f.name, v)}
                      inputCls={inputCls}
                      selectCls={selectCls}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
          <>
          <Field label="Action Type">
            <select
              className={selectCls}
              value={(config?.action_name as string) || ''}
              onChange={(e) => onUpdateNodeConfig('action_name', e.target.value)}
            >
              <option value="">-- Select Action --</option>
              {relevantActionOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.module ? `${option.module}: ${option.label}` : option.label}
                </option>
              ))}
            </select>
          </Field>
          {config?.action_name === 'send_notification_email' && (
            <>
              <Field label="To (direct email, optional)">
                <input
                  className={inputCls}
                  value={(config?.to as string) || ''}
                  onChange={(e) => onUpdateNodeConfig('to', e.target.value)}
                  placeholder="user@example.com"
                />
              </Field>
              <Field label="Recipient Users (tenant)">
                <CheckboxMultiSelect
                  options={actorUsers.map((u) => ({
                    value: u.id,
                    label: u.display_name,
                    subtitle: u.email,
                  }))}
                  selectedValues={selectedRecipientUserIds.map(Number)}
                  onChange={(vals) => onUpdateNodeConfig('recipient_user_ids', vals)}
                  placeholder="Select users"
                  emptyMessage="No tenant users found"
                />
              </Field>
              <Field label="Recipient Roles (tenant)">
                <CheckboxMultiSelect
                  options={actorRoles.map((r) => ({ value: r.id, label: r.name }))}
                  selectedValues={selectedRecipientRoleIds.map(Number)}
                  onChange={(vals) => onUpdateNodeConfig('recipient_role_ids', vals)}
                  placeholder="Select roles"
                  emptyMessage="No tenant roles found"
                />
              </Field>
              <Field label="Subject">
                <input
                  className={inputCls}
                  value={(config?.subject as string) || ''}
                  onChange={(e) => onUpdateNodeConfig('subject', e.target.value)}
                  placeholder="Workflow notification"
                />
              </Field>
              <Field label="Message Body">
                <textarea
                  className={`${inputCls} h-16 resize-none`}
                  value={(config?.body as string) || ''}
                  onChange={(e) => onUpdateNodeConfig('body', e.target.value)}
                  placeholder="Email body text..."
                />
              </Field>
            </>
          )}
          {/* ─── Dynamic action sub-config ──────────────────────────────── */}
          {ActionSubConfig({
            config,
            nodeConfigOptions,
            actorUsers,
            actorRoles,
            conditionPathOptions,
            selectedEscalateLevels,
            selectedRecipientUserIds,
            selectedRecipientRoleIds,
            onUpdate: onUpdateNodeConfig,
            inputCls,
            selectCls,
          })}
          </>
          )}
        </>
      )}

      {/* Condition fields */}
      {nodeType === 'condition' && (
        <>
          <SectionLabel label="Condition Settings" />
          <Field label="Condition Type">
            <select
              className={selectCls}
              value={(config?.condition_kind as string) || ''}
              onChange={(e) => onUpdateNodeConfig('condition_kind', e.target.value)}
            >
              <option value="">-- Select Condition --</option>
              {relevantConditionKeys.map((k) => (
                <option key={k} value={k}>
                  {NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          {/* ─── Dynamic condition sub-config ────────────────────────── */}
          {ConditionSubConfig({
            config,
            nodeConfigOptions,
            actorRoles,
            nodeConfigText,
            onUpdate: onUpdateNodeConfig,
            onSetNodeConfigText,
            inputCls,
            selectCls,
          })}
        </>
      )}

      {/* Approval fields */}
      {nodeType === 'approval' && (
        <>
          <SectionLabel label="Approval Settings" />
          <Field label="Approval Type">
            <select
              className={selectCls}
              value={(config?.approval_type as string) || 'single'}
              onChange={(e) => onUpdateNodeConfig('approval_type', e.target.value)}
            >
              {Array.from(APPROVAL_KEYS).map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Approver Users (tenant)">
            <CheckboxMultiSelect
              options={actorUsers.map((u) => ({
                value: u.id,
                label: u.display_name,
                subtitle: u.email,
              }))}
              selectedValues={selectedUserIds.map(Number)}
              onChange={(vals) => onUpdateNodeConfig('approver_user_ids', vals)}
              placeholder="Select approver users"
              emptyMessage="No tenant users found"
            />
          </Field>
          <Field label="Approver Roles (tenant)">
            <CheckboxMultiSelect
              options={actorRoles.map((r) => ({ value: r.id, label: r.name }))}
              selectedValues={selectedRoleIds.map(Number)}
              onChange={(vals) => onUpdateNodeConfig('approver_role_ids', vals)}
              placeholder="Select approver roles"
              emptyMessage="No tenant roles found"
            />
          </Field>
          {config?.approval_type === 'quorum' && (
            <Field label="Required Approvals (quorum)">
              <input
                type="number"
                className={inputCls}
                min={1}
                value={(config?.required_approvals as number) || 1}
                onChange={(e) => onUpdateNodeConfig('required_approvals', Number(e.target.value))}
              />
            </Field>
          )}
          <SectionLabel label="SLA & Escalation" />
          <Field label="SLA Duration (seconds)">
            <input
              type="number"
              className={inputCls}
              value={(config?.timeout_seconds as number) || 86400}
              onChange={(e) => onUpdateNodeConfig('timeout_seconds', Number(e.target.value))}
              placeholder="86400 = 24 hours"
            />
          </Field>
          <Field label="On Timeout">
            <select
              className={selectCls}
              value={(config?.on_timeout as string) || 'escalate'}
              onChange={(e) => onUpdateNodeConfig('on_timeout', e.target.value)}
            >
              <option value="escalate">Escalate</option>
              <option value="auto_approve">Auto-Approve</option>
              <option value="auto_reject">Auto-Reject</option>
            </select>
          </Field>
          <Field label="Delegate to User (on timeout)">
            <select
              className={selectCls}
              value={String((config?.delegate_to_user_id as number) || '')}
              onChange={(e) =>
                onUpdateNodeConfig(
                  'delegate_to_user_id',
                  e.target.value ? Number(e.target.value) : null
                )
              }
            >
              <option value="">-- None --</option>
              {actorUsers.length === 0 && (
                <option value="" disabled>
                  No tenant users found
                </option>
              )}
              {actorUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.email})
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {/* Timer fields */}
      {nodeType === 'timer' && (
        <>
          <SectionLabel label="Timer Settings" />
          <Field label="Timer Type">
            <select
              className={selectCls}
              value={(config?.timer_kind as string) || 'wait_duration'}
              onChange={(e) => onUpdateNodeConfig('timer_kind', e.target.value)}
            >
              {Array.from(TIMER_KEYS).map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          {config?.timer_kind !== 'wait_until_date' && (
            <Field label="Wait Duration (seconds)">
              <input
                type="number"
                className={inputCls}
                value={(config?.wait_seconds as number) || 3600}
                onChange={(e) => onUpdateNodeConfig('wait_seconds', Number(e.target.value))}
                placeholder="3600 = 1 hour"
              />
            </Field>
          )}
          {config?.timer_kind === 'wait_until_date' && (
            <Field label="Wait Until (ISO date or token)">
              <input
                className={inputCls}
                value={(config?.wait_until as string) || ''}
                onChange={(e) => onUpdateNodeConfig('wait_until', e.target.value)}
                placeholder="2025-12-31T00:00:00Z"
              />
            </Field>
          )}
          {config?.timer_kind === 'sla_countdown' && (
            <Field label="Escalation Action">
              <input
                className={inputCls}
                value={(config?.escalation_action as string) || ''}
                onChange={(e) => onUpdateNodeConfig('escalation_action', e.target.value)}
                placeholder="e.g., send_notification_email"
              />
            </Field>
          )}
        </>
      )}

      {/* Subworkflow fields */}
      {nodeType === 'subworkflow' && (
        <>
          <SectionLabel label="Sub-Workflow Settings" />
          <Field label="Workflow Definition ID">
            <input
              type="number"
              className={inputCls}
              value={(config?.workflow_definition_id as number) || ''}
              onChange={(e) =>
                onUpdateNodeConfig(
                  'workflow_definition_id',
                  e.target.value ? Number(e.target.value) : null
                )
              }
              placeholder="ID of the sub-workflow"
            />
          </Field>
        </>
      )}

      {/* Raw JSON for advanced users */}
      {nodeType !== 'condition' && (
        <>
          <SectionLabel label="Advanced (Raw JSON Config)" />
          <Field label="">
            <textarea
              className={`${inputCls} h-24 font-mono text-[10px] resize-none`}
              value={nodeConfigText}
              onChange={(e) => onSetNodeConfigText(e.target.value)}
            />
          </Field>
        </>
      )}
    </>
  );
}

function EdgeConfigBody({
  edge,
  edgeConditionText,
  edgeLabel,
  edgePriority,
  onSetEdgeConditionText,
  onSetEdgeLabel,
  onSetEdgePriority,
}: {
  edge: Edge;
  edgeConditionText: string;
  edgeLabel: string;
  edgePriority: number;
  onSetEdgeConditionText: (v: string) => void;
  onSetEdgeLabel: (v: string) => void;
  onSetEdgePriority: (v: number) => void;
}) {
  return (
    <>
      <SectionLabel label="Edge Info" />
      <Field label="Source → Target">
        <div className="text-xs text-gray-600">
          {edge.source} → {edge.target}
        </div>
      </Field>
      <SectionLabel label="Edge Settings" />
      <Field label="Label">
        <input
          className={inputCls}
          value={edgeLabel}
          onChange={(e) => onSetEdgeLabel(e.target.value)}
          placeholder="e.g., approved, true, on_timeout"
        />
      </Field>
      <Field label="Priority">
        <input
          type="number"
          className={inputCls}
          value={edgePriority}
          onChange={(e) => onSetEdgePriority(Number(e.target.value))}
          min={1}
        />
      </Field>
      <Field label="Condition (JSON, optional)">
        <textarea
          className={`${inputCls} h-20 font-mono text-[10px] resize-none`}
          value={edgeConditionText}
          onChange={(e) => onSetEdgeConditionText(e.target.value)}
          placeholder='{"path": "output.status", "operator": "eq", "value": "approved"}'
        />
      </Field>
    </>
  );
}
