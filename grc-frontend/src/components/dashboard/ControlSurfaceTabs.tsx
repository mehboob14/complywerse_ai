'use client';

/**
 * The strip of the three control surfaces of the Compliance side: Catalog (the controls an organisation works), Library (the unified, de-duplicated controls across frameworks) and Assurance (how well
 * the controls are tested). Each is a page of its own with its own address, so the strip is a row of links, not a tab list: the page you are on is marked with aria-current and a line under it. It
 * sits under the page's head on /controls, /control-library and /control-library/assurance. (The Cyber Assurance area keeps its own copy of this component.)
 */
import Link from 'next/link';
import { clsx } from 'clsx';

export type ControlSurface = 'catalog' | 'library' | 'assurance';

const SURFACES: ReadonlyArray<{ id: ControlSurface; label: string; href: string; hint: string }> = [
  { id: 'catalog', label: 'Catalog', href: '/controls', hint: 'Work your controls: assign, test, attach evidence and certify' },
  { id: 'library', label: 'Library', href: '/control-library', hint: 'The unified controls across all frameworks' },
  { id: 'assurance', label: 'Assurance', href: '/control-library/assurance', hint: 'How well the controls are tested: tested, effective and on time' },
];

const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export default function ControlSurfaceTabs({ active, className }: { active: ControlSurface; className?: string }) {
  return (
    <nav aria-label="Control sections" className={clsx(STRIP, className)}>
      {SURFACES.map((s) => (
        <Link
          key={s.id}
          href={s.href}
          prefetch={false}
          title={s.hint}
          aria-current={s.id === active ? 'page' : undefined}
          className={clsx(TAB, s.id === active ? 'border-ds-primary text-ds-primary-text' : 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg')}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
