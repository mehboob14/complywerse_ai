'use client';

import { AlertTriangle, AlertCircle, Info, AlertOctagon, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SeverityBadgeProps {
  severity: SeverityLevel;
  showIcon?: boolean;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const severityConfig: Record<SeverityLevel, {
  bg: string;
  text: string;
  border: string;
  icon: typeof AlertCircle;
  label: string;
}> = {
  critical: {
    bg: 'bg-severity-critical/20',
    text: 'text-red-600',
    border: 'border-red-200',
    icon: AlertOctagon,
    label: 'Critical',
  },
  high: {
    bg: 'bg-severity-high/20',
    text: 'text-orange-600',
    border: 'border-orange-500/30',
    icon: ShieldAlert,
    label: 'High',
  },
  medium: {
    bg: 'bg-severity-medium/20',
    text: 'text-yellow-600',
    border: 'border-yellow-200',
    icon: AlertTriangle,
    label: 'Medium',
  },
  low: {
    bg: 'bg-severity-low/20',
    text: 'text-blue-600',
    border: 'border-blue-200',
    icon: AlertCircle,
    label: 'Low',
  },
  info: {
    bg: 'bg-severity-info/20',
    text: 'text-slate-600',
    border: 'border-slate-500/30',
    icon: Info,
    label: 'Info',
  },
};

const sizeConfig = {
  sm: { padding: 'px-1.5 py-0.5', text: 'text-xs', icon: 10, gap: 'gap-1' },
  md: { padding: 'px-2 py-0.5', text: 'text-xs', icon: 12, gap: 'gap-1.5' },
  lg: { padding: 'px-2.5 py-1', text: 'text-sm', icon: 14, gap: 'gap-1.5' },
};

export function SeverityBadge({
  severity,
  showIcon = true,
  showLabel = true,
  size = 'md',
  className,
}: SeverityBadgeProps) {
  const config = severityConfig[severity] || severityConfig.info;
  const sizeStyle = sizeConfig[size];
  const Icon = config.icon;

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
      aria-label={`Severity: ${config.label}`}
    >
      {showIcon && <Icon size={sizeStyle.icon} aria-hidden="true" />}
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

export default SeverityBadge;
