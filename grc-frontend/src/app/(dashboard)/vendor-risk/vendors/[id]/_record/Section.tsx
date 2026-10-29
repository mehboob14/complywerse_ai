'use client';

// A heading over a panel that brings its own frame (the signals, the outside-in view): the same look as a kit Panel's title, without a
// second border round the first.
import { useId, type ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';

export default function Section({ title, info, action, children }: { title: string; info?: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5">
          <h2 id={id} className="text-[15px] font-semibold leading-6 text-[#1f2933]">{title}</h2>
          {info && <InfoTip text={info} label={`About ${title}`} />}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
