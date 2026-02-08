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
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: Circle,
    label: 'Open',
  },
  in_progress: {
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
    icon: PlayCircle,
    label: 'In Progress',
  },
  pending: {
    bg: 'bg-amber-500/20',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    icon: Clock,
    label: 'Pending',
  },
  resolved: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
    icon: CheckCircle,
    label: 'Resolved',
  },
  closed: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
    icon: MinusCircle,
    label: 'Closed',
  },
  verified: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: CheckCircle,
    label: 'Verified',
  },
  rejected: {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: XCircle,
    label: 'Rejected',
  },
  draft: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
    icon: Circle,
    label: 'Draft',
  },
  active: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: PlayCircle,
    label: 'Active',
  },
  inactive: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
    icon: PauseCircle,
    label: 'Inactive',
  },
  accepted: {
    bg: 'bg-primary-500/20',
    text: 'text-primary-600',
    border: 'border-primary-500/30',
    icon: CheckCircle,
    label: 'Accepted',
  },
  overdue: {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: AlertCircle,
    label: 'Overdue',
  },
  completed: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: CheckCircle,
    label: 'Completed',
  },
  cancelled: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
    icon: XCircle,
    label: 'Cancelled',
  },
};

const defaultConfig = {
  bg: 'bg-slate-500/20',
  text: 'text-slate-400',
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
