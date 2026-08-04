'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Bug,
  Calendar,
  CheckCircle,
  ChevronRight,
  Circle,
  Clock,
  ClipboardList,
  FileText,
  GitBranch,
  Globe,
  Link,
  Play,
  Shield,
  Square,
  ThumbsUp,
  TriangleAlert,
  Upload,
  User,
  UserCheck,
  Webhook,
  Zap,
} from 'lucide-react';
import { FlowNodeData, NODE_CANVAS_COLORS, NODE_ICON_COLORS, STATUS_COLORS } from './types';

import { LucideIcon } from 'lucide-react';

const NODE_ICONS: Record<string, LucideIcon> = {
  // Triggers
  framework_deadline_approaching: Calendar,
  risk_score_exceeds_threshold: AlertTriangle,
  evidence_expires: FileText,
  new_vulnerability_detected: Bug,
  policy_review_due: BookOpen,
  incident_reported: TriangleAlert,
  kri_breach: Zap,
  assessment_status_change: ClipboardList,
  manual_trigger: Play,
  schedule_recurring: Clock,
  webhook: Webhook,
  // Actions
  create_risk_entry: AlertTriangle,
  request_evidence_upload: Upload,
  assign_control_owner: UserCheck,
  send_notification_email: Bell,
  generate_report: FileText,
  update_compliance_status: Shield,
  create_audit_finding: ClipboardList,
  escalate_to_management: ChevronRight,
  call_webhook_api: Globe,
  // Conditions
  check_risk_level: GitBranch,
  check_user_role: User,
  check_compliance_status: Shield,
  check_evidence_age: Clock,
  check_approval_status: CheckCircle,
  evaluate_business_unit: GitBranch,
  expression_builder: GitBranch,
  // Approvals
  single: ThumbsUp,
  multi_level: UserCheck,
  quorum: CheckCircle,
  // Timers
  wait_duration: Clock,
  wait_until_date: Calendar,
  sla_countdown: Clock,
  // Control
  subworkflow: Link,
  end: Square,
  start: Circle,
};

function getNodeCategory(nodeType: string, config: Record<string, unknown>): string {
  if (nodeType === 'start') {
    const triggerType = config?.trigger_type as string;
    return triggerType || nodeType;
  }
  if (nodeType === 'action') return (config?.action_name as string) || nodeType;
  if (nodeType === 'condition') return (config?.condition_kind as string) || nodeType;
  if (nodeType === 'approval') return (config?.approval_type as string) || nodeType;
  if (nodeType === 'timer') return (config?.timer_kind as string) || nodeType;
  return nodeType;
}

function getNodeColorClass(nodeType: string): string {
  return NODE_CANVAS_COLORS[nodeType] || 'border-gray-300 bg-white';
}

function getIconColorClass(nodeType: string): string {
  return NODE_ICON_COLORS[nodeType] || 'text-gray-500';
}

function getIconComponent(nodeType: string, config: Record<string, unknown>): LucideIcon {
  const category = getNodeCategory(nodeType, config);
  return NODE_ICONS[category] || NODE_ICONS[nodeType] || Circle;
}

export function humanizeTriggerEvent(raw: string): string {
  const parts = raw.replace(/_/g, ' ').split('.');
  const verb = parts[parts.length - 1] || '';
  const entity = parts.slice(0, -1).join(' › ');
  const verbMap: Record<string, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    trigger: 'AI / System Action',
    upload: 'Uploaded',
    approve: 'Approved',
    reject: 'Rejected',
  };
  const friendlyVerb = verbMap[verb.trim()] || verb;
  if (!entity) return friendlyVerb;
  const titleEntity = entity.split(' › ').map(p =>
    p.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  ).join(' › ');
  return `${titleEntity} › ${friendlyVerb}`;
}

function humanizeActionName(raw: string): string {
  if (raw.startsWith('platform_action.')) {
    const parts = raw.split('.');
    const tail = parts[parts.length - 1] || '';
    return tail.replace(/_/g, ' ');
  }
  return raw.replace(/_/g, ' ');
}

export function WorkflowNodeCard({ data }: { data: FlowNodeData }) {
  const {
    nodeKey, nodeType, label, config, isTerminal, isStart, executionStatus,
    isFirstAfterStart, triggerStatus, inferredTriggerEvent,
  } = data;
  const isStartPlaceholder = nodeKey === 'start';
  const isCondition = nodeType === 'condition';
  const isApproval = nodeType === 'approval';
  const isEnd = isTerminal || nodeType === 'end';

  const colorClass = getNodeColorClass(nodeType);
  const iconColorClass = getIconColorClass(nodeType);
  const IconComponent = getIconComponent(nodeType, config || {});

  const statusBadge: React.ReactNode = executionStatus ? (
    <span
      className={`absolute -top-2 -right-2 text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${STATUS_COLORS[executionStatus as string] || ''}`}
    >
      {String(executionStatus)}
    </span>
  ) : null;

  // Highlight the node that acts as the implicit trigger (first node after Start).
  // Only applies to non-start, non-end nodes — Start and dedicated trigger cards already self-render.
  const showTriggerOverlay = isFirstAfterStart && !isStartPlaceholder && nodeType !== 'start' && !isEnd;
  const triggerRingClass = showTriggerOverlay
    ? (triggerStatus === 'invalid'
        ? 'ring-2 ring-red-400 ring-offset-1'
        : 'ring-2 ring-amber-400 ring-offset-1')
    : '';

  return (
    <div
      className={`relative border-2 rounded-lg bg-white shadow-sm min-w-[140px] max-w-[180px] ${colorClass} ${triggerRingClass} transition-all duration-150 hover:shadow-md`}
    >
      {showTriggerOverlay && (
        triggerStatus === 'invalid' ? (
          <span
            data-testid="node-trigger-invalid"
            title="This node runs first after Start, but it cannot be used as a trigger. Replace it with a Create / Update / Delete platform function, or insert a dedicated trigger node."
            className="absolute -top-2 -left-2 text-[9px] px-1.5 py-0.5 rounded-full border border-red-400 bg-red-50 text-red-700 font-bold flex items-center gap-0.5"
          >
            <TriangleAlert size={9} /> Not a trigger
          </span>
        ) : (
          <span
            data-testid="node-trigger-valid"
            title={`This node fires the workflow on event: ${inferredTriggerEvent || ''}`}
            className="absolute -top-2 -left-2 text-[9px] px-1.5 py-0.5 rounded-full border border-amber-400 bg-amber-50 text-amber-800 font-bold flex items-center gap-0.5"
          >
            <Zap size={9} /> Trigger
          </span>
        )
      )}
      {statusBadge}

      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="!w-3 !h-3 !border-2 !border-gray-400 !bg-white"
      />

      {/* Node body */}
      <div className="px-3 py-2.5">
        {/* Icon + type label row */}
        <div className="flex items-center gap-1.5 mb-1">
          <IconComponent size={13} className={iconColorClass} />
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
            {nodeType === 'start'
              ? 'Trigger'
              : nodeType === 'action' && typeof config?.action_name === 'string' && (config.action_name as string).startsWith('platform_action.')
                ? '⚡ Platform Function'
                : nodeType}
          </span>
        </div>

        {/* Node label */}
        <div className="text-xs font-semibold text-gray-800 leading-tight truncate">{String(label)}</div>

        {/* Config summary */}
        {nodeType === 'start' && !isStartPlaceholder && (
          typeof config?.trigger_type === 'string' && config.trigger_type ? (
            <div className="text-[9px] text-emerald-600 font-semibold mt-0.5 truncate">
              ⚡ {humanizeTriggerEvent(config.trigger_type as string)}
            </div>
          ) : (
            <div className="text-[9px] text-amber-500 font-semibold mt-0.5">
              ⚠ Select event type
            </div>
          )
        )}
        {isStartPlaceholder && (
          <div className="text-[9px] text-gray-400 mt-0.5">Connect any ⚡ node ↓</div>
        )}
        {nodeType === 'action' && typeof config?.action_name === 'string' && (
          <div className="text-[9px] text-gray-400 mt-0.5 truncate">{humanizeActionName(config.action_name as string)}</div>
        )}
        {nodeType === 'approval' && typeof config?.approval_type === 'string' && (
          <div className="text-[9px] text-gray-400 mt-0.5 truncate">{config.approval_type.replace(/_/g, ' ')}</div>
        )}
        {nodeType === 'timer' && typeof config?.timer_kind === 'string' && (
          <div className="text-[9px] text-gray-400 mt-0.5 truncate">{config.timer_kind.replace(/_/g, ' ')}</div>
        )}

        {/* Condition branch labels */}
        {isCondition && (
          <div className="flex justify-between mt-1.5">
            <span className="text-[8px] text-emerald-600 font-semibold">✓ True</span>
            <span className="text-[8px] text-red-500 font-semibold">✗ False</span>
          </div>
        )}
      </div>

      {/* Output handles */}
      {!isEnd && (
        <>
          {isCondition ? (
            <>
              <Handle
                type="source"
                position={Position.Bottom}
                id="out_true"
                style={{ left: '30%' }}
                className="!w-3 !h-3 !border-2 !border-emerald-500 !bg-emerald-100"
                title="True branch"
              />
              <Handle
                type="source"
                position={Position.Bottom}
                id="out_false"
                style={{ left: '70%' }}
                className="!w-3 !h-3 !border-2 !border-red-500 !bg-red-100"
                title="False branch"
              />
              {/* Hidden fallback handle for legacy edges that reference sourceHandle="out".
                  Moved to Top (off the routing path) so it doesn't conflict with the
                  visible Bottom True/False handles. */}
              <Handle
                type="source"
                position={Position.Top}
                id="out"
                style={{ display: 'none' }}
              />
            </>
          ) : isApproval ? (
            <>
              <Handle
                type="source"
                position={Position.Bottom}
                id="approved"
                style={{ left: '30%' }}
                className="!w-3 !h-3 !border-2 !border-emerald-500 !bg-emerald-100"
                title="Approved branch"
              />
              <Handle
                type="source"
                position={Position.Bottom}
                id="rejected"
                style={{ left: '70%' }}
                className="!w-3 !h-3 !border-2 !border-red-500 !bg-red-100"
                title="Rejected branch"
              />
              {/* Legacy fallback hidden off-route, same pattern as condition. */}
              <Handle
                type="source"
                position={Position.Top}
                id="out"
                style={{ display: 'none' }}
              />
            </>
          ) : (
            <Handle
              type="source"
              position={Position.Bottom}
              id="out"
              className="!w-3 !h-3 !border-2 !border-gray-400 !bg-white"
            />
          )}
        </>
      )}
    </div>
  );
}

export const nodeTypes = {
  workflowNode: WorkflowNodeCard,
};
