'use client';

/**
 * A small (i) that holds the explanation a page used to print as a sentence: hover or focus shows it, a tap toggles it, Escape
 * closes it. For text that helps the person who wonders; text that prevents a mistake stays on the page.
 */
import { useId, useState } from 'react';
import { Info } from 'lucide-react';

export function InfoTip({ text, label = 'More information', align = 'start', className = '' }: {
  text: string;
  /** what a screen reader says for the button */
  label?: string;
  /** which edge of the (i) the note lines up with: 'end' keeps it on screen near the right edge */
  align?: 'start' | 'end';
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        className="grid h-5 w-5 place-items-center rounded-full text-[#7b8794] hover:text-[#26323d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute top-full z-40 mt-1 w-64 rounded-lg border border-[#d5dbe1] bg-[#fff] px-2.5 py-2 text-left text-[12px] font-normal normal-case leading-4 tracking-normal text-[#26323d] shadow-elevated ${align === 'end' ? 'right-0' : 'left-0'} ${open ? 'block' : 'hidden group-hover:block group-focus-within:block'}`}
      >
        {text}
      </span>
    </span>
  );
}

export default InfoTip;
