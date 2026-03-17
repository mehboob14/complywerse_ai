'use client';

import { Edge, Node } from '@xyflow/react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import React from 'react';
import {
  ACTION_KEYS,
  APPROVAL_KEYS,
  CONDITION_KEYS,
  FlowNodeData,
  TIMER_KEYS,
  TRIGGER_KEYS,
} from './types';

type Props = {
  actorUsers: Array<{ id: number; display_name: string; email: string; username?: string }>;
  actorRoles: Array<{ id: number; name: string; description?: string }>;
  actionOptions: Array<{ key: string; label: string; module?: string; submodule?: string }>;
  conditionPathOptions: Array<{ value: string; label: string }>;
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
            className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
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
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {selectedNode && (
          <NodeConfigBody
            node={selectedNode}
            nodeConfigText={nodeConfigText}
            actorUsers={actorUsers}
            actorRoles={actorRoles}
            actionOptions={actionOptions}
            conditionPathOptions={conditionPathOptions}
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
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 rounded-md transition-colors"
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

// ─── Node Config Body ─────────────────────────────────────────────────────────

function NodeConfigBody({
  node,
  nodeConfigText,
  actorUsers,
  actorRoles,
  actionOptions,
  conditionPathOptions,
  onUpdateNodeConfig,
  onSetNodeConfigText,
}: {
  node: Node<FlowNodeData>;
  nodeConfigText: string;
  actorUsers: Array<{ id: number; display_name: string; email: string; username?: string }>;
  actorRoles: Array<{ id: number; name: string; description?: string }>;
  actionOptions: Array<{ key: string; label: string; module?: string; submodule?: string }>;
  conditionPathOptions: Array<{ value: string; label: string }>;
  onUpdateNodeConfig: (field: string, value: unknown) => void;
  onSetNodeConfigText: (v: string) => void;
}) {
  const { nodeType, label, config } = node.data;
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
              {Array.from(TRIGGER_KEYS).map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          {(config?.trigger_type === 'risk_score_exceeds_threshold') && (
            <Field label="Threshold Value">
              <input
                type="number"
                className={inputCls}
                value={(config?.threshold as number) || 70}
                onChange={(e) => onUpdateNodeConfig('threshold', Number(e.target.value))}
              />
            </Field>
          )}
          {(config?.trigger_type === 'framework_deadline_approaching') && (
            <Field label="Framework Name / ID">
              <input
                className={inputCls}
                value={(config?.framework as string) || ''}
                onChange={(e) => onUpdateNodeConfig('framework', e.target.value)}
                placeholder="e.g., ISO 27001"
              />
            </Field>
          )}
          {(config?.trigger_type === 'schedule_recurring') && (
            <Field label="Cron Expression">
              <input
                className={inputCls}
                value={(config?.cron as string) || ''}
                onChange={(e) => onUpdateNodeConfig('cron', e.target.value)}
                placeholder="0 9 * * 1 (every Monday 9am)"
              />
            </Field>
          )}
          {(config?.trigger_type === 'webhook') && (
            <Field label="Webhook Secret (optional)">
              <input
                className={inputCls}
                value={(config?.webhook_secret as string) || ''}
                onChange={(e) => onUpdateNodeConfig('webhook_secret', e.target.value)}
                placeholder="HMAC secret for signature verification"
              />
            </Field>
          )}
          <Field label="Event Filter (optional)">
            <input
              className={inputCls}
              value={(config?.filter as string) || ''}
              onChange={(e) => onUpdateNodeConfig('filter', e.target.value)}
              placeholder="e.g., severity=critical"
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
              {Array.from(ACTION_KEYS).map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
              {actionOptions
                .filter((a) => !ACTION_KEYS.has(a.key))
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.module ? `${a.module}: ${a.label}` : a.label}
                  </option>
                ))}
              {!!(config?.action_name as string) && !ACTION_KEYS.has(config.action_name as string) && (
                <option value={config.action_name as string}>
                  {String(config.action_name)}
                </option>
              )}
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
          {config?.action_name === 'assign_control_owner' && (
            <Field label="Control ID">
              <input
                className={inputCls}
                value={(config?.control_id as string) || ''}
                onChange={(e) => onUpdateNodeConfig('control_id', e.target.value)}
                placeholder="Control ID to assign"
              />
            </Field>
          )}
          {config?.action_name === 'escalate_to_management' && (
            <>
              <SectionLabel label="Escalation Levels" />
              <div className="text-[9px] text-gray-500 mb-1">
                Configure who gets notified at each level and how long to wait before escalating to the next.
              </div>
              <EscalationLevelsConfig
                levels={selectedEscalateLevels}
                actorUsers={actorUsers}
                actorRoles={actorRoles}
                conditionPathOptions={conditionPathOptions}
                onChange={(levels) => onUpdateNodeConfig('escalation_levels', levels)}
              />
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
              {Array.from(CONDITION_KEYS).map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Condition Expression (JSON)">
            <textarea
              className={`${inputCls} h-20 font-mono text-[10px] resize-none`}
              value={nodeConfigText}
              onChange={(e) => onSetNodeConfigText(e.target.value)}
              placeholder='{"path": "trigger.severity", "operator": "eq", "value": "high"}'
            />
          </Field>
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
