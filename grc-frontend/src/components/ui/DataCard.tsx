'use client';

import { type ReactNode } from 'react';
import { type LucideIcon, AlertCircle, FileX } from 'lucide-react';
import { clsx } from 'clsx';

export interface DataCardProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  emptyIcon?: LucideIcon;
  error?: boolean;
  errorMessage?: string;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-slate-200" />
      <div className="h-4 w-1/2 rounded bg-slate-200" />
      <div className="h-4 w-2/3 rounded bg-slate-200" />
      <div className="h-4 w-1/3 rounded bg-slate-200" />
    </div>
  );
}

export function DataCard({
  title,
  subtitle,
  icon: Icon,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  loading = false,
  empty = false,
  emptyMessage = 'No data available',
  emptyIcon: EmptyIcon = FileX,
  error = false,
  errorMessage = 'Failed to load data',
  children,
  className,
  bodyClassName,
  noPadding = false,
}: DataCardProps) {
  const showContent = !loading && !empty && !error;

  return (
    <div
      className={clsx(
        'rounded-xl border border-slate-200 bg-white overflow-hidden',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <div className="text-primary-600 shrink-0" aria-hidden="true">
              <Icon size={16} />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-black truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-slate-500 truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {onAction && (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-black transition-colors shrink-0"
            aria-label={actionLabel}
          >
            {ActionIcon && <ActionIcon size={14} aria-hidden="true" />}
            {actionLabel && <span>{actionLabel}</span>}
          </button>
        )}
      </div>

      <div className={clsx(!noPadding && 'p-4', bodyClassName)}>
        {loading && <LoadingSkeleton />}

        {error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle size={24} className="text-rose-600 mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-rose-600">{errorMessage}</p>
            <p className="text-xs text-slate-500 mt-1">Please try again later</p>
          </div>
        )}

        {empty && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <EmptyIcon size={24} className="text-slate-500 mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-500">{emptyMessage}</p>
          </div>
        )}

        {showContent && children}
      </div>
    </div>
  );
}

export default DataCard;
