'use client';

// The frame of every Advanced Analytics tool: the kit's page head (named for the tool, as the sidebar and the top bar name it) and the strip of tools. The strip is links - each tool is
// a page with its own address - so it is a navigation landmark, not a tab list: the open tool is `aria-current="page"`, Tab walks the links, and a link opens in a new tab like any other.
import Link from 'next/link';
import { clsx } from 'clsx';
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { TOOLS } from './tools';

const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const OPEN = 'border-ds-primary text-ds-primary-text';
const SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';

export function AnalyticsFrame({ tool, children, actions, meta }: { tool: string; children: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) {
  const current = TOOLS.find((t) => t.key === tool) ?? TOOLS[0];
  const title = routeFor(current.href)?.label ?? current.label;
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <PageHeader variant="page" title={title} info={current.blurb} meta={meta} actions={actions} />
      <nav aria-label="Analytics tools" className={STRIP}>
        {TOOLS.map((t) => {
          const open = t.key === current.key;
          return <Link key={t.key} href={t.href} aria-current={open ? 'page' : undefined} className={clsx(TAB, open ? OPEN : SHUT)}>{t.label}</Link>;
        })}
      </nav>
      {children}
    </div>
  );
}
