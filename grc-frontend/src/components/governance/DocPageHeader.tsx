'use client';

/**
 * The head of every page of the Documents area (the library, Attestation, Exceptions, Settings, the AI Studio start page): the
 * title, a short line of facts when there are any ("44 documents · updated 5 d ago"), an (i) for whatever the page used to explain
 * in a sentence, and the page's actions on the right. One line high; the tab above already says where the person is.
 */
import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';

export function DocPageHeader({ title, meta, info, actions }: {
  title: string;
  /** facts, not prose: counts, "updated 5 d ago" */
  meta?: ReactNode;
  /** the explanation, shown from the (i) */
  info?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <h1 className="text-[20px] font-semibold leading-8 text-[#1f2933]">{title}</h1>
        {info && <InfoTip text={info} label={`About ${title}`} />}
        {meta && <span className="text-[13px] text-[#586472]">{meta}</span>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export default DocPageHeader;
