'use client';

// The state of a page the signed-in person may not open: what happened (the title), why when the page knows (the reason) and where to go
// instead (the action, usually a link back drawn with the kit's Button). Presentational: it asks nobody anything, the page (or a guard) decides
// when to show it. It is a status, not an alert: nothing went wrong, the person was turned away, so a screen reader reads it where it finds it
// instead of interrupting. A failed request is an ErrorState, not this.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Lock } from 'lucide-react';

export interface NoAccessStateProps {
  /** default "You don't have access to this page" */
  title?: string;
  /** why, in words: "This page is for administrators." */
  reason?: string;
  /** where to go instead: <Button href="/dashboard">Back to dashboard</Button> */
  action?: ReactNode;
  className?: string;
}

export function NoAccessState({ title = "You don't have access to this page", reason, action, className }: NoAccessStateProps) {
  return (
    <div role="status" className={clsx('flex flex-col items-center rounded-ds-card border border-ds-border bg-ds-surface px-[24px] py-[40px] text-center', className)}>
      <span aria-hidden className="mb-3 grid h-[40px] w-[40px] place-items-center rounded-ds-card bg-ds-surface-hover text-ds-fg-muted">
        <Lock className="h-[20px] w-[20px]" strokeWidth={1.75} />
      </span>
      <p className="text-ds-section text-ds-fg">{title}</p>
      {reason && <p className="mt-1 max-w-[480px] break-words text-ds-body text-ds-fg-muted">{reason}</p>}
      {action && <div className="mt-[16px] flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
