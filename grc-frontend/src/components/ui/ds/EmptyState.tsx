'use client';

// Nothing to show, and what to do about it. Two cases that must not read alike: `firstUse` (there is nothing yet: say how to start, with the
// one action that fills it) and `noMatches` (there is data but the filters or the search leave none: offer to clear them). No page-specific
// words live here; the page passes the title, the hint and the action.
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Inbox, SearchX, type LucideIcon } from 'lucide-react';
import { InfoTip } from '../InfoTip';
import { Button } from './Button';

export type EmptyStateKind = 'noMatches' | 'firstUse';

export interface EmptyStateProps {
  kind: EmptyStateKind;
  title: string;
  description?: string;
  /** what the state used to explain in a sentence, shown from an (i) beside the title (instead of a `description` on a page that prints labels, not sentences) */
  info?: string;
  /** default: a magnifier for `noMatches`, an inbox for `firstUse` */
  icon?: LucideIcon;
  /** the one primary action: what fills the page ("Add a document"), a button or link drawn with the kit's classes */
  action?: ReactNode;
  /** `noMatches` only: shows a "Clear filters" button that calls this */
  onClearFilters?: () => void;
  /** up to three short hints; more are left out */
  tips?: readonly string[];
  /** no frame, for a card that already has one */
  bare?: boolean;
  className?: string;
}

const MAX_TIPS = 3;

export function EmptyState({ kind, title, description, info, icon, action, onClearFilters, tips, bare = false, className }: EmptyStateProps) {
  const Icon = icon ?? (kind === 'noMatches' ? SearchX : Inbox);
  const hints = (tips ?? []).slice(0, MAX_TIPS);
  const clear = kind === 'noMatches' ? onClearFilters : undefined;
  return (
    <div className={clsx('flex flex-col items-center px-[24px] py-[40px] text-center', !bare && 'rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface', className)}>
      <span aria-hidden className="mb-3 grid h-[40px] w-[40px] place-items-center rounded-ds-card bg-ds-surface-hover text-ds-fg-muted">
        <Icon className="h-[20px] w-[20px]" strokeWidth={1.75} />
      </span>
      {info ? (
        <div className="flex items-center justify-center gap-[4px]">
          <p className="text-ds-section text-ds-fg">{title}</p>
          <InfoTip text={info} label={`About ${title.toLowerCase()}`} />
        </div>
      ) : (
        <p className="text-ds-section text-ds-fg">{title}</p>
      )}
      {description && <p className="mt-1 max-w-[420px] text-ds-body text-ds-fg-muted">{description}</p>}
      {hints.length > 0 && (
        <ul className="mt-[12px] max-w-[420px] space-y-1 text-left">
          {hints.map((tip, i) => (
            <li key={i} className="flex gap-2 text-ds-label text-ds-fg-muted">
              <span aria-hidden>•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
      {(action || clear) && (
        <div className="mt-[16px] flex flex-wrap items-center justify-center gap-2">
          {action}
          {clear && <Button onClick={clear}>Clear filters</Button>}
        </div>
      )}
    </div>
  );
}
