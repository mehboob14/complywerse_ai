'use client';

import { type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

export type MetricBadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'critical' | 'high' | 'medium' | 'low';

export interface MetricBadgeProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  variant?: MetricBadgeVariant;
  className?: string;
}

const variantStyles: Record<MetricBadgeVariant, { bg: string; text: string; border: string }> = {
  default: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-600',
    border: 'border-slate-300',
  },
  success: {
    bg: 'bg-success-500/10',
    text: 'text-success-400',
    border: 'border-success-500/30',
  },
  warning: {
    bg: 'bg-warning-500/10',
    text: 'text-warning-400',
    border: 'border-warning-500/30',
  },
  danger: {
    bg: 'bg-danger-500/10',
    text: 'text-danger-400',
    border: 'border-danger-500/30',
  },
  info: {
    bg: 'bg-info-500/10',
    text: 'text-info-400',
    border: 'border-info-500/30',
  },
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    border: 'border-red-200',
  },
  high: {
    bg: 'bg-orange-50',
    text: 'text-orange-600',
    border: 'border-orange-500/30',
  },
  medium: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-600',
    border: 'border-yellow-200',
  },
  low: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    border: 'border-blue-200',
  },
};

export function MetricBadge({
  label,
  value,
  icon: Icon,
  variant = 'default',
  className,
}: MetricBadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
        styles.bg,
        styles.text,
        styles.border,
        className
      )}
    >
      {Icon && <Icon size={12} aria-hidden="true" />}
      <span className="text-slate-600">{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export default MetricBadge;
