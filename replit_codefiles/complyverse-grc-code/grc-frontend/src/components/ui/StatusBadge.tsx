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
  bgColor: string;
  textColor: string;
  borderColor: string;
  icon: typeof Circle;
  label: string;
}> = {
  open: {
    bgColor: 'rgba(155, 28, 28, 0.1)',
    textColor: 'var(--color-danger)',
    borderColor: 'rgba(155, 28, 28, 0.2)',
    icon: Circle,
    label: 'Open',
  },
  in_progress: {
    bgColor: 'rgba(146, 87, 14, 0.1)',
    textColor: 'var(--color-warning)',
    borderColor: 'rgba(146, 87, 14, 0.2)',
    icon: PlayCircle,
    label: 'In Progress',
  },
  pending: {
    bgColor: 'rgba(146, 87, 14, 0.1)',
    textColor: 'var(--color-warning)',
    borderColor: 'rgba(146, 87, 14, 0.2)',
    icon: Clock,
    label: 'Pending',
  },
  resolved: {
    bgColor: 'rgba(28, 43, 58, 0.08)',
    textColor: 'var(--color-base)',
    borderColor: 'rgba(28, 43, 58, 0.15)',
    icon: CheckCircle,
    label: 'Resolved',
  },
  closed: {
    bgColor: 'var(--color-subtle)',
    textColor: 'var(--color-muted)',
    borderColor: 'var(--color-border)',
    icon: MinusCircle,
    label: 'Closed',
  },
  verified: {
    bgColor: 'rgba(45, 106, 79, 0.1)',
    textColor: 'var(--color-success)',
    borderColor: 'rgba(45, 106, 79, 0.2)',
    icon: CheckCircle,
    label: 'Verified',
  },
  rejected: {
    bgColor: 'rgba(155, 28, 28, 0.1)',
    textColor: 'var(--color-danger)',
    borderColor: 'rgba(155, 28, 28, 0.2)',
    icon: XCircle,
    label: 'Rejected',
  },
  draft: {
    bgColor: 'var(--color-subtle)',
    textColor: 'var(--color-muted)',
    borderColor: 'var(--color-border)',
    icon: Circle,
    label: 'Draft',
  },
  active: {
    bgColor: 'rgba(45, 106, 79, 0.1)',
    textColor: 'var(--color-success)',
    borderColor: 'rgba(45, 106, 79, 0.2)',
    icon: PlayCircle,
    label: 'Active',
  },
  inactive: {
    bgColor: 'var(--color-subtle)',
    textColor: 'var(--color-muted)',
    borderColor: 'var(--color-border)',
    icon: PauseCircle,
    label: 'Inactive',
  },
  accepted: {
    bgColor: 'rgba(28, 43, 58, 0.08)',
    textColor: 'var(--color-base)',
    borderColor: 'rgba(28, 43, 58, 0.15)',
    icon: CheckCircle,
    label: 'Accepted',
  },
  overdue: {
    bgColor: 'rgba(155, 28, 28, 0.1)',
    textColor: 'var(--color-danger)',
    borderColor: 'rgba(155, 28, 28, 0.2)',
    icon: AlertCircle,
    label: 'Overdue',
  },
  completed: {
    bgColor: 'rgba(45, 106, 79, 0.1)',
    textColor: 'var(--color-success)',
    borderColor: 'rgba(45, 106, 79, 0.2)',
    icon: CheckCircle,
    label: 'Completed',
  },
  cancelled: {
    bgColor: 'var(--color-subtle)',
    textColor: 'var(--color-muted)',
    borderColor: 'var(--color-border)',
    icon: XCircle,
    label: 'Cancelled',
  },
};

const defaultConfig = {
  bgColor: 'var(--color-subtle)',
  textColor: 'var(--color-muted)',
  borderColor: 'var(--color-border)',
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
        sizeStyle.padding,
        sizeStyle.text,
        sizeStyle.gap,
        className
      )}
      style={{
        backgroundColor: config.bgColor,
        color: config.textColor,
        borderColor: config.borderColor,
      }}
      role="status"
      aria-label={`Status: ${displayLabel}`}
    >
      {showIcon && <Icon size={sizeStyle.icon} aria-hidden="true" />}
      <span>{displayLabel}</span>
    </span>
  );
}

export default StatusBadge;
