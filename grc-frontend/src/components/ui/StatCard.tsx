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
    icon: 'text-primary-600',
    border: 'border-slate-200',
    glow: 'hover:shadow-card-hover hover:border-slate-300',
  },
  success: {
    icon: 'text-success-600',
    border: 'border-slate-200',
    glow: 'hover:shadow-card-hover hover:border-slate-300',
  },
  warning: {
    icon: 'text-warning-600',
    border: 'border-slate-200',
    glow: 'hover:shadow-card-hover hover:border-slate-300',
  },
  danger: {
    icon: 'text-danger-600',
    border: 'border-slate-200',
    glow: 'hover:shadow-card-hover hover:border-slate-300',
  },
  info: {
    icon: 'text-info-600',
    border: 'border-slate-200',
    glow: 'hover:shadow-card-hover hover:border-slate-300',
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
          'rounded-xl border bg-white p-4 animate-pulse',
          styles.border,
          className
        )}
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-20 rounded bg-slate-200" />
            <div className="h-7 w-16 rounded bg-slate-200" />
            <div className="h-3 w-24 rounded bg-slate-200" />
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
        'rounded-xl border bg-white p-4 text-left transition-all duration-200',
        styles.border,
        styles.glow,
        isClickable && 'cursor-pointer active:scale-[0.98]',
        className
      )}
      {...(isClickable && { type: 'button', 'aria-label': `View details for ${title}` })}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={clsx(styles.icon)} aria-hidden="true">
            <Icon size={20} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-600 truncate">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-bold text-black">{value}</p>
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
            <p className="mt-1 text-xs text-slate-600 truncate">{subtitle}</p>
          )}
        </div>
      </div>
    </Component>
  );
}

export default StatCard;
