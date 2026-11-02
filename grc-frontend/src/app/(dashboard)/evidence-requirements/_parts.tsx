'use client';

// Small pieces of the requirements page: a long text that shows its first lines and opens, a list that shows its first items and says how many more, and
// the label-over-value fact of the details panel. Kit tokens and arbitrary values only (the platform CSS repaints the named utilities in the shell).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/ds';

export const MUTED = 'text-ds-fg-muted';

/** A block of text, four lines of it and "Show more" only when there is more (measured: the lines depend on the width). The whole value stays in the page. */
export function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p ref={ref} dir="auto" className={`whitespace-pre-line break-words text-ds-body text-ds-fg-body ${open ? '' : 'line-clamp-4'}`}>{text}</p>
      {(long || open) && <Button variant="link" size="sm" className="mt-[2px]" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</Button>}
    </div>
  );
}

/** The first `shown` items of a list and a button that says how many more there are (the rule for related records: the first few and "+N" that opens the rest). */
export function ItemList({ items, shown = 6, marker }: { items: readonly string[]; shown?: number; marker: 'check' | 'dot' }) {
  const [all, setAll] = useState(false);
  const visible = all ? items : items.slice(0, shown);
  const rest = items.length - visible.length;
  return (
    <div>
      <ul className="flex flex-col gap-[4px]">
        {visible.map((item, i) => (
          <li key={i} className="flex items-start gap-[8px] text-ds-body text-ds-fg-body">
            {marker === 'check'
              ? <Check aria-hidden strokeWidth={1.75} className="mt-[3px] h-[14px] w-[14px] shrink-0 text-ds-success" />
              : <span aria-hidden className="mt-[1px] shrink-0 text-ds-primary-text">•</span>}
            <span className="min-w-0 break-words" dir="auto">{item}</span>
          </li>
        ))}
      </ul>
      {(rest > 0 || all) && items.length > shown && (
        <Button variant="link" size="sm" className="mt-[4px]" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${rest} more`}</Button>
      )}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={`text-ds-label ${MUTED}`}>{label}</dt>
      <dd className="mt-[2px] min-w-0 break-words text-ds-body text-ds-fg">{children}</dd>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-[6px] !text-ds-body !font-[600] !text-ds-fg">{title}</h3>
      {children}
    </section>
  );
}
