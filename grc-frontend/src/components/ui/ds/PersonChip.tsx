'use client';

// A person: their avatar and their name. No person yet reads "Unassigned" in muted text (a missing owner is information, not an empty cell).
// A name that does not fit is cut with an ellipsis and carries its full text in a `title` only then.
import { clsx } from 'clsx';
import { UNASSIGNED } from '@/lib/format';
import { Avatar, type AvatarSize } from './Avatar';
import { useClipped } from './useClipped';

export interface PersonChipProps {
  name?: string | null;
  size?: AvatarSize;
  /** shown when there is no name (default "Unassigned") */
  emptyLabel?: string;
  className?: string;
}

export function PersonChip({ name, size = 24, emptyLabel = UNASSIGNED, className }: PersonChipProps) {
  const who = (name ?? '').trim();
  const [word, clipped] = useClipped<HTMLSpanElement>();
  if (!who) return <span className={clsx('whitespace-nowrap text-ds-body text-ds-fg-muted', className)}>{emptyLabel}</span>;
  return (
    <span title={clipped ? who : undefined} className={clsx('inline-flex min-w-0 max-w-full items-center gap-2', className)}>
      <Avatar name={who} size={size} decorative />
      <span ref={word} dir="auto" className="min-w-0 truncate text-ds-body text-ds-fg-body">{who}</span>
    </span>
  );
}
