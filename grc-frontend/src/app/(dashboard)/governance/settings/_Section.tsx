'use client';

// One card of the Governance settings page: a title with its (i), optionally a line of facts and the card's actions on the right.
import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';

export function Section({ id, title, info, meta, actions, children }: {
  id: string;
  title: string;
  info?: string;
  /** facts, not prose: "6 departments · 1 inactive" */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-2">
        <h2 id={`${id}-h`} className="text-[15px] font-semibold text-[#1f2933]">{title}</h2>
        {info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}
        {meta && <span className="ml-1 text-[13px] text-[#586472]">{meta}</span>}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
