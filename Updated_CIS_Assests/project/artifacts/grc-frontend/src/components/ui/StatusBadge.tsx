'use client';

import {
  Circle,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  PauseCircle,
  PlayCircle,
  MinusCircle,
} from 'lucide-react';
import { clsx } from 'clsx';

export type StatusType =
  | 'open'
  | 'in_progress'
  | 'pending'
  | 'resolved'
  | 'closed'
  | 'verified'
  | 'rejected'
  | 'draft'
  | 'active'
  | 'inactive'
  | 'accepted'
  | 'overdue'
  | 'completed'
  | 'cancelled';

export interface StatusBadgeProps {
  status: StatusType | string;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  customLabel?: string;
}

const statusConfig: Record<string, {
  bg: string;
  text: string;
  border: string;
  icon: typeof Circle;
  label: string;
}> = {
  open: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    border: 'border-red-200',
    icon: Circle,
    label: 'Open',
  },
  in_progress: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-600',
    border: 'border-yellow-200',
    icon: PlayCircle,
    label: 'In Progress',
  },
  pending: {
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    border: 'border-amber-500/30',
    icon: Clock,
    label: 'Pending',
  },
  resolved: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    border: 'border-blue-200',
    icon: CheckCircle,
    label: 'Resolved',
  },
  closed: {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-500/30',
    icon: MinusCircle,
    label: 'Closed',
  },
  verified: {
    bg: 'bg-green-50',
    text: 'text-green-600',
    border: 'border-green-200',
    icon: CheckCircle,
    label: 'Verified',
  },
  rejected: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    border: 'border-red-200',
    icon: XCircle,
    label: 'Rejected',
  },
  draft: {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-500/30',
    icon: Circle,
    label: 'Draft',
  },
  active: {
    bg: 'bg-green-50',
    text: 'text-green-600',
    border: 'border-green-200',
    icon: PlayCircle,
    label: 'Active',
  },
  inactive: {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-500/30',
    icon: PauseCircle,
    label: 'Inactive',
  },
  accepted: {
    bg: 'bg-primary-50',
    text: 'text-primary-600',
    border: 'border-primary-200',
    icon: CheckCircle,
    label: 'Accepted',
  },
  overdue: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    border: 'border-red-200',
    icon: AlertCircle,
    label: 'Overdue',
  },
  completed: {
    bg: 'bg-green-50',
    text: 'text-green-600',
    border: 'border-green-200',
    icon: CheckCircle,
    label: 'Completed',
  },
  cancelled: {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-500/30',
    icon: XCircle,
    label: 'Cancelled',
  },
};

const defaultConfig = {
  bg: 'bg-slate-50',
  text: 'text-slate-600',
  border: 'border-slate-500/30',
  icon: Circle,
  label: 'Unknown',
};

const sizeConfig = {
  sm: { padding: 'px-1.5 py-0.5', text: 'text-xs', icon: 10, gap: 'gap-1' },
  md: { padding: 'px-2 py-0.5', text: 'text-xs', icon: 12, gap: 'gap-1.5' },
  lg: { padding: 'px-2.5 py-1', text: 'text-sm', icon: 14, gap: 'gap-1.5' },
};

export function StatusBadge({
  status,
  showIcon = true,
  size = 'md',
  className,
  customLabel,
}: StatusBadgeProps) {
  const normalizedStatus = status?.toLowerCase().replace(/\s+/g, '_');
  const config = statusConfig[normalizedStatus] || defaultConfig;
  const sizeStyle = sizeConfig[size];
  const Icon = config.icon;
  const displayLabel = customLabel || config.label;

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border font-medium',
        config.bg,
        config.text,
        config.border,
        sizeStyle.padding,
        sizeStyle.text,
        sizeStyle.gap,
        className
      )}
      role="status"
      aria-label={`Status: ${displayLabel}`}
    >
      {showIcon && <Icon size={sizeStyle.icon} aria-hidden="true" />}
      <span>{displayLabel}</span>
    </span>
  );
}

export default StatusBadge;
