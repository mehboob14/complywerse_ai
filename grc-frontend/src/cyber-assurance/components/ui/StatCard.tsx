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

  const cardContent = (
    <div className="flex items-start gap-2.5">
      {Icon && (
        <div className={clsx(styles.icon)} aria-hidden="true">
          <Icon size={18} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-600 truncate">{title}</p>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <p className="text-xl font-bold text-black">{value}</p>
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
          <p className="mt-0.5 text-xs text-slate-600 truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div
        className={clsx(
          'animate-pulse rounded-xl border bg-white p-3.5',
          styles.border,
          className
        )}
      >
        <div className="flex items-start gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-20 rounded bg-slate-200" />
            <div className="h-6 w-16 rounded bg-slate-200" />
            <div className="h-3 w-24 rounded bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`View details for ${title}`}
        className={clsx(
          'rounded-xl border bg-white p-3.5 text-left transition-all duration-200',
          styles.border,
          styles.glow,
          'cursor-pointer active:scale-[0.98]',
          className
        )}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div
      className={clsx(
        'rounded-xl border bg-white p-3.5 text-left transition-all duration-200',
        styles.border,
        styles.glow,
        className
      )}
    >
      {cardContent}
    </div>
  );
}

export default StatCard;
