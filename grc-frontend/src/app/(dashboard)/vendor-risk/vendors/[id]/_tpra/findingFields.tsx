'use client';

// The four small form pieces the Signals panel (another group's) still draws its forms with, kept exactly as they were when the finding sheets moved to the kit (FindingDialogs re-exports them, so
// its import does not change). When the Signals panel moves to the kit this file goes.
import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';

// Explicit hex: the platform CSS repaints slate/white and sizes bare form controls (PITFALLS 31, 100). Used by the Signals panel only; the sheets below use the kit.
export const FIELD = 'w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 py-2 text-sm text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
export const LABEL = 'mb-1 flex items-center gap-1 text-[13px] font-medium text-[#26323d]';
const OPTIONAL = <span className="font-normal text-[#64707e]">(optional)</span>;

/** A labelled field; `tip` is the (i) that holds the explanation. (Kept for the Signals panel.) */
export function Field({ id, label, optional, tip, children }: { id: string; label: string; optional?: boolean; tip?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label} {optional && OPTIONAL}
        {tip && <InfoTip text={tip} label={`About ${label}`} />}
      </label>
      {children}
    </div>
  );
}

/** A tick in a card: a choice that deserves a line of its own ("Holds the approval gate"). (Kept for the Signals panel.) */
export function CheckCard({ checked, onChange, title, note, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; note: string; disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] px-3 py-2.5">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0f766e]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-[13px] font-medium text-[#1f2933]">{title}</span>
        <span className="block text-[12px] leading-4 text-[#586472]">{note}</span>
      </span>
    </label>
  );
}
