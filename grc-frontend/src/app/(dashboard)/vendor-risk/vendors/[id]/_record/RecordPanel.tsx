'use client';

// The card every panel of the record sits in: the kit's SectionCard with the props the panels have always passed (title, a count, an explanation behind an (i), an action on the right, a
// line under the title). It stands where the vendor module's own `Panel` stood, so a panel moves to the kit by changing one import. (SectionCard asks for an `id`; this makes one.)
import { useId, type ReactNode } from 'react';
import { SectionCard } from '@/components/ui/ds';

export default function RecordPanel({ title, count, description, action, info, children }: {
  title: string;
  count?: number;
  /** a line under the title; the panels use it for what the card counts */
  description?: string;
  action?: ReactNode;
  info?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <SectionCard id={`panel-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`} title={title} info={info} meta={count != null ? <span className="tabular-nums">{count}</span> : undefined} actions={action}>
      {description && <p className="mb-[12px] text-ds-body text-ds-fg-muted">{description}</p>}
      {children}
    </SectionCard>
  );
}
