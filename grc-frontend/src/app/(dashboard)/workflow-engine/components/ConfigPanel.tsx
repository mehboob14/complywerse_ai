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
  TIMER_KEYS,
  TRIGGER_KEYS,
} from './types';

type Props = {
  actorUsers: Array<{ id: number; display_name: string; email: string; username?: string }>;
  actorRoles: Array<{ id: number; name: string; description?: string }>;
  actionOptions: NodeOptionItem[];
  conditionPathOptions: Array<{ value: string; label: string }>;
  nodeConfigOptions: NodeConfigOptions;
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
  timeout_value: number;
  timeout_unit: 'hours' | 'days';
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
        timeout_value: 24,
        timeout_unit: 'hours',
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

  return (
    <div className="mt-1 space-y-3">
      {levels.map((lv, idx) => {
        const isLast = idx === levels.length - 1;
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

            {/* Escalation timeout (shown for all but last level) */}
            {!isLast && (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Field label="Escalate after">
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={lv.timeout_value || 24}
                      onChange={(e) =>
                        updateLevel(idx, { timeout_value: Number(e.target.value) || 24 })
                      }
                      placeholder="24"
                    />
                  </Field>
                </div>
                <div className="col-span-1">
                  <Field label="Unit">
                    <select
                      className={selectCls}
                      value={lv.timeout_unit || 'hours'}
                      onChange={(e) =>
                        updateLevel(idx, { timeout_unit: e.target.value as 'hours' | 'days' })
                      }
                    >
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </Field>
                </div>
              </div>
            )}
            {isLast && (
              <div className="text-[9px] text-gray-400 mt-1 italic">
                Final level — no further escalation
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

// ─── Node Config Body ─────────────────────────────────────────────────────────

function NodeConfigBody({
  node,
  nodeConfigText,
  actorUsers,
  actorRoles,
  actionOptions,
  conditionPathOptions,
  nodeConfigOptions,
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
  onUpdateNodeConfig: (field: string, value: unknown) => void;
  onSetNodeConfigText: (v: string) => void;
}) {
  const { nodeKey, nodeType, label, config } = node.data;
  const nodeContext = getNodeCatalogContext(nodeType, config, nodeKey);
  const contextLabel = formatWorkflowContextLabel(nodeContext);
  const relevantTriggerKeys = getRelevantTriggerKeys(nodeContext);
  const relevantConditionKeys = getRelevantConditionKeys(nodeContext);
  const relevantActionOptions = getRelevantActionOptions(actionOptions, nodeContext);
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
    ? (config.escalation_levels as Array<Record<string, unknown>>).map((lv, idx) => ({
        level: Number(lv.level || idx + 1),
        subject: String(lv.subject || ''),
        message: String(lv.message || ''),
        user_ids: Array.isArray(lv.user_ids) ? (lv.user_ids as Array<string | number>).map(Number).filter(Boolean) : [],
        role_ids: Array.isArray(lv.role_ids) ? (lv.role_ids as Array<string | number>).map(Number).filter(Boolean) : [],
        timeout_value: Number(lv.timeout_value || lv.timeout_hours || 24),
        timeout_unit: ((lv.timeout_unit as string) || 'hours') === 'days' ? 'days' : 'hours',
        escalation_mode: (lv.escalation_mode as EscalationLevel['escalation_mode']) || 'always',
        escalation_condition: (lv.escalation_condition as Record<string, unknown>) || {},
      }))
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
      <Field label="Label">
        <input
          className={inputCls}
          value={label}
          onChange={(e) => onUpdateNodeConfig('label', e.target.value)}
        />
      </Field>

      {/* Trigger-specific fields */}
      {nodeType === 'start' && (
        <>
          <SectionLabel label="Trigger Settings" />
          <Field label="Trigger Type">
            <select
              className={selectCls}
              value={(config?.trigger_type as string) || ''}
              onChange={(e) => onUpdateNodeConfig('trigger_type', e.target.value)}
            >
              <option value="">-- Select Trigger --</option>
              {relevantTriggerKeys.map((k) => (
                <option key={k} value={k}>
                  {NODE_TYPE_LABELS[k] || k.replace(/_/g, ' ')}
                </option>
              ))}
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
