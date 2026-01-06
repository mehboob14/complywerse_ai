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
      <div className="h-4 w-3/4 rounded bg-slate-700" />
      <div className="h-4 w-1/2 rounded bg-slate-700" />
      <div className="h-4 w-2/3 rounded bg-slate-700" />
      <div className="h-4 w-1/3 rounded bg-slate-700" />
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
        'rounded-xl border border-slate-700 bg-surface-800 overflow-hidden',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <div className="rounded-lg bg-primary-500/20 p-1.5 text-primary-400 shrink-0" aria-hidden="true">
              <Icon size={16} />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-slate-400 truncate">{subtitle}</p>
            )}
          </div>
        </div>
        {onAction && (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700/50 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors shrink-0"
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
            <div className="rounded-full bg-danger-500/20 p-3 mb-3">
              <AlertCircle size={24} className="text-danger-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-danger-400">{errorMessage}</p>
            <p className="text-xs text-slate-500 mt-1">Please try again later</p>
          </div>
        )}

        {empty && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-slate-700 p-3 mb-3">
              <EmptyIcon size={24} className="text-slate-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-slate-400">{emptyMessage}</p>
          </div>
        )}

        {showContent && children}
      </div>
    </div>
  );
}

export default DataCard;
