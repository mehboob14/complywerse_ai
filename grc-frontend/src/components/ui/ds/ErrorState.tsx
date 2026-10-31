'use client';

// A view that could not load or save. Say what failed (the title) and, when the server said why, that too (the message, already cleaned of
// anything a person should not see); offer Retry only when trying again can help. `compact` is the row version for the inside of a card.
// It is an alert: it is read out as it appears.
import { clsx } from 'clsx';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './Button';

export interface ErrorStateProps {
  /** what failed (default "Couldn't load this") */
  title?: string;
  /** why, in words: the server's detail after it has been through safeDetail */
  message?: string;
  /** shows the Retry button */
  onRetry?: () => void;
  /** a row without a frame, for the inside of a card */
  compact?: boolean;
  className?: string;
}

export function ErrorState({ title = "Couldn't load this", message, onRetry, compact = false, className }: ErrorStateProps) {
  const retry = onRetry && <Button leftIcon={<RotateCw aria-hidden />} onClick={onRetry}>Retry</Button>;
  if (compact) {
    return (
      <div role="alert" className={clsx('flex flex-wrap items-start gap-[12px] p-3', className)}>
        <AlertTriangle aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-danger" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-ds-body font-medium text-ds-fg">{title}</p>
          {message && <p className="mt-1 break-words text-ds-body text-ds-fg-muted">{message}</p>}
        </div>
        {retry}
      </div>
    );
  }
  return (
    <div role="alert" className={clsx('flex flex-col items-center rounded-ds-card border border-ds-border bg-ds-surface px-[24px] py-[40px] text-center', className)}>
      <span aria-hidden className="mb-3 grid h-[40px] w-[40px] place-items-center rounded-ds-card bg-ds-danger-soft text-ds-danger">
        <AlertTriangle className="h-[20px] w-[20px]" strokeWidth={1.75} />
      </span>
      <p className="text-ds-section text-ds-fg">{title}</p>
      {message && <p className="mt-1 max-w-[480px] break-words text-ds-body text-ds-fg-muted">{message}</p>}
      {retry && <div className="mt-[16px]">{retry}</div>}
    </div>
  );
}
