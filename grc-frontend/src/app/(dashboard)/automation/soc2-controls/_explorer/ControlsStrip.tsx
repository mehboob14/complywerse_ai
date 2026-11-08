'use client';

// The strip of the Controls pages: Controls | Coverage | Mapping review. The three are separate pages (every address kept), so the strip is a row of links, not a tab list: the page
// you are on is marked with aria-current and a line under it. It belongs to these three pages only (the control page `[code]` and the new-control form do not draw it), which is why it is
// a component the pages place and not the area's layout.
import Link from 'next/link';
import { clsx } from 'clsx';

export type ControlsSection = 'controls' | 'coverage' | 'review';

const SECTIONS: ReadonlyArray<{ id: ControlsSection; label: string; href: string }> = [
  { id: 'controls', label: 'Controls', href: '/automation/soc2-controls' },
  { id: 'coverage', label: 'Coverage', href: '/automation/soc2-controls/coverage' },
  { id: 'review', label: 'Mapping review', href: '/automation/soc2-controls/review' },
];

const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export function ControlsStrip({ current, className }: { current: ControlsSection; className?: string }) {
  return (
    <nav aria-label="Controls sections" className={clsx(STRIP, className)}>
      {SECTIONS.map((s) => (
        <Link
          key={s.id}
          href={s.href}
          prefetch={false}
          aria-current={s.id === current ? 'page' : undefined}
          className={clsx(TAB, s.id === current ? 'border-ds-primary text-ds-primary-text' : 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg')}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
