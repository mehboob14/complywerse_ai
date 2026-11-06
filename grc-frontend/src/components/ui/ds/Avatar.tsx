'use client';

// A person as round initials in a colour that is theirs on every page (the same name, the same tint: src/lib/people.ts, shared with the vendor
// kit). Beside the name (a PersonChip) it is decoration and hidden from a screen reader; alone it is an image that carries the name.
// Initials are 12px (the text floor), so the 20px size shows one letter; the 24 and 32px sizes show two.
import { clsx } from 'clsx';
import { initials, tintFor } from '@/lib/people';

const SIZE = {
  20: 'h-[20px] w-[20px]',
  24: 'h-[24px] w-[24px]',
  32: 'h-[32px] w-[32px]',
} as const;

export type AvatarSize = keyof typeof SIZE;

export interface AvatarProps {
  /** a missing name draws a quiet grey "?" that a screen reader skips */
  name?: string | null;
  size?: AvatarSize;
  /** the name is written beside the avatar: hide the avatar from a screen reader rather than say it twice */
  decorative?: boolean;
  className?: string;
}

export function Avatar({ name, size = 24, decorative = false, className }: AvatarProps) {
  const who = (name ?? '').trim();
  const { tint, text } = tintFor(who);
  return (
    <span
      {...(decorative || !who ? { 'aria-hidden': true } : { role: 'img', 'aria-label': who })}
      dir="auto"
      style={{ background: tint, color: text }}
      className={clsx('inline-flex shrink-0 select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-full text-ds-label', SIZE[size], className)}
    >
      {initials(who, size === 20 ? 1 : 2)}
    </span>
  );
}
