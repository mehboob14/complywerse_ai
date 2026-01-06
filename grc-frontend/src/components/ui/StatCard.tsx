'use client';

import { type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { TrendIndicator, type TrendDirection } from './TrendIndicator';

export type StatCardVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  variant?: StatCardVariant;
  trend?: {
    direction: TrendDirection;
    value: number;
    inverted?: boolean;
  };
  onClick?: () => void;
  className?: string;
  loading?: boolean;
}

const variantStyles: Record<StatCardVariant, { icon: string; border: string; glow: string }> = {
  default: {
    icon: 'bg-primary-500/20 text-primary-400',
    border: 'border-slate-700',
    glow: 'hover:border-primary-500/50 hover:shadow-glow-sm',
  },
  success: {
    icon: 'bg-success-500/20 text-success-400',
    border: 'border-slate-700',
    glow: 'hover:border-success-500/50 hover:shadow-[0_0_10px_-3px_rgba(34,197,94,0.3)]',
  },
  warning: {
    icon: 'bg-warning-500/20 text-warning-400',
    border: 'border-slate-700',
    glow: 'hover:border-warning-500/50 hover:shadow-[0_0_10px_-3px_rgba(245,158,11,0.3)]',
  },
  danger: {
    icon: 'bg-danger-500/20 text-danger-400',
    border: 'border-slate-700',
    glow: 'hover:border-danger-500/50 hover:shadow-[0_0_10px_-3px_rgba(239,68,68,0.3)]',
  },
  info: {
    icon: 'bg-info-500/20 text-info-400',
    border: 'border-slate-700',
    glow: 'hover:border-info-500/50 hover:shadow-[0_0_10px_-3px_rgba(6,182,212,0.3)]',
  },
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'default',
  trend,
  onClick,
  className,
  loading = false,
}: StatCardProps) {
  const styles = variantStyles[variant];
  const isClickable = !!onClick;

  if (loading) {
    return (
      <div
        className={clsx(
          'rounded-xl border bg-surface-800 p-4 animate-pulse',
          styles.border,
          className
        )}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-slate-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-20 rounded bg-slate-700" />
            <div className="h-7 w-16 rounded bg-slate-700" />
            <div className="h-3 w-24 rounded bg-slate-700" />
          </div>
        </div>
      </div>
    );
  }

  const Component = isClickable ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={clsx(
        'rounded-xl border bg-surface-800 p-4 text-left transition-all duration-200',
        styles.border,
        styles.glow,
        isClickable && 'cursor-pointer active:scale-[0.98]',
        className
      )}
      {...(isClickable && { type: 'button', 'aria-label': `View details for ${title}` })}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={clsx('rounded-lg p-2.5', styles.icon)} aria-hidden="true">
            <Icon size={20} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-400 truncate">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-white">{value}</p>
            {trend && (
              <TrendIndicator
                direction={trend.direction}
                value={trend.value}
                inverted={trend.inverted}
                size="sm"
              />
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-500 truncate">{subtitle}</p>
          )}
        </div>
      </div>
    </Component>
  );
}

export default StatCard;
