'use client';

// Notice: a banner above a list or a card that says something about what is below it: the list is cut, a source is missing, saving is off.
// A tone (info, warning, danger), an optional title in bold, the line under it, and an optional action (a Button or a link) that drops below the
// words on a narrow screen. Information speaks politely (`role="status"`), a warning or a danger assertively (`role="alert"`); `role` overrides
// that for a notice that is on the page from the moment it loads. The tone is also an icon, so it never rests on colour alone.
//
//   <Notice tone="warning" title="Showing 100 of 174 exceptions">Search, sort and the export use these 100 only.</Notice>
//
// It says nothing when it has nothing to say (no title, no line and no action). Tokens and arbitrary values only (kit rules).
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, AlertTriangle, Info, type LucideIcon } from 'lucide-react';
import { noticeRole, type NoticeRole, type NoticeTone } from './noticeModel';

export type { NoticeTone };

export interface NoticeProps {
  /** what kind of notice it is; also its icon and its live-region role */
  tone?: NoticeTone;
  /** the bold first line: what is the case ("Showing 100 of 174 exceptions") */
  title?: string;
  /** the line under the title (or the only line when there is no title) */
  children?: ReactNode;
  /** what the person can do about it: a Button or a link, drawn after the words */
  action?: ReactNode;
  /** replaces the tone's icon (an info circle, a warning triangle, a danger circle) */
  icon?: LucideIcon;
  /** `status` is polite, `alert` assertive; the default follows the tone (info is a status, warning and danger are alerts) */
  role?: NoticeRole;
  /** layout only (margin, width) */
  className?: string;
}

const TONES: Record<NoticeTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'border-ds-border bg-ds-info-soft', icon: 'text-ds-info', Icon: Info },
  warning: { box: 'border-ds-border bg-ds-warning-soft', icon: 'text-ds-warning', Icon: AlertTriangle },
  danger: { box: 'border-ds-danger-border bg-ds-danger-soft', icon: 'text-ds-danger', Icon: AlertCircle },
};

export function Notice({ tone = 'info', title, children, action, icon, role, className }: NoticeProps) {
  const hasLine = children !== undefined && children !== null && children !== false && children !== '';
  if (!title && !hasLine && !action) return null;
  const { box, icon: iconColour, Icon: ToneIcon } = TONES[tone];
  const Icon = icon ?? ToneIcon;
  return (
    <div role={noticeRole(tone, role)} className={clsx('flex flex-wrap items-start gap-x-[12px] gap-y-[8px] rounded-ds-card border px-[12px] py-[8px]', box, className)}>
      {/* the icon and the words are one item that asks for 12rem and takes the rest, so a long action drops under them instead of squeezing them */}
      <div className="flex min-w-0 flex-1 basis-[12rem] items-start gap-[8px]">
        <Icon aria-hidden strokeWidth={1.75} className={clsx('mt-[2px] h-[16px] w-[16px] shrink-0', iconColour)} />
        <div className="min-w-0">
          {title && <p className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{title}</p>}
          {hasLine && <div className="text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
