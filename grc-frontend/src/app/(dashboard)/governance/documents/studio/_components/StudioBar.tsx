'use client';

// One row of words with an icon and, on the right, its actions: the notes and bars of the Studio (Comply Agent is not connected; read only; the changes
// sent to the owner; a conflict on save; changes waiting; the document being written). Written with the design-system tokens only, so it reads the same
// in the page and in a dialog. The words take the room first (`basis-[16rem]`) and the actions wrap under them when there is not enough, so on a phone
// a sentence is never squeezed into a column of one word per line. The kit has no banner yet; this is the Studio's own (kit gap, see the audit).
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export type BarTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE: Record<BarTone, string> = {
  info: 'border-ds-border bg-ds-primary-soft',
  success: 'border-ds-border bg-ds-success-soft',
  warning: 'border-ds-border bg-ds-warning-soft',
  danger: 'border-ds-danger-border bg-ds-danger-soft',
  neutral: 'border-ds-border bg-ds-surface-subtle',
};
const ICON: Record<BarTone, string> = {
  info: 'text-ds-primary-text',
  success: 'text-ds-success',
  warning: 'text-ds-warning',
  danger: 'text-ds-danger',
  neutral: 'text-ds-fg-muted',
};

export function StudioBar({ tone = 'neutral', icon, role, label, note = false, actions, className, children }: {
  tone?: BarTone;
  /** a 16px icon element (a lucide icon); it takes the tone's colour */
  icon?: ReactNode;
  /** `status` is read out politely, `alert` at once; `region` needs a `label` */
  role?: 'status' | 'alert' | 'region';
  label?: string;
  /** a rounded note inside a page, instead of a full-width bar between two edges */
  note?: boolean;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      aria-label={label}
      className={clsx(
        'flex flex-wrap items-center gap-x-[12px] gap-y-[6px] text-ds-body text-ds-fg-body',
        note ? 'rounded-ds-card border px-[12px] py-[8px]' : 'shrink-0 border-b px-[12px] py-[6px] sm:px-[16px]',
        TONE[tone],
        className,
      )}
    >
      {icon && <span aria-hidden className={clsx('flex shrink-0 [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:[stroke-width:1.75]', ICON[tone])}>{icon}</span>}
      <div className="min-w-0 flex-1 basis-[16rem]">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-[8px]">{actions}</div>}
    </div>
  );
}
