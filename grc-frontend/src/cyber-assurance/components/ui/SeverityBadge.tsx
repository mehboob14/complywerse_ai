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
  // Charter: light single-hue pills (bg-{tone}-50 text-{tone}-700), sanctioned
  // red→amber→green severity ramp; slate for info. No dark *-500/20 chips.
  critical: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    icon: AlertOctagon,
    label: 'Critical',
  },
  high: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    icon: ShieldAlert,
    label: 'High',
  },
  medium: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    icon: AlertTriangle,
    label: 'Medium',
  },
  low: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    icon: AlertCircle,
    label: 'Low',
  },
  info: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
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
