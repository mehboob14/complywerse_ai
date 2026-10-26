'use client';

/**
 * Every framework a document is mapped to, as a list: A to Z, with a search box once there are more than a handful (the popover
 * behind a table cell's "+N" and the drawer's Frameworks tab are the same list). With `onPick`, a row is a button that filters the
 * library by that framework; `active` says which ones it already filters by.
 */
import { useId, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { categoryTint } from './lib';
import { FRAMEWORK_SEARCH_FROM, frameworkList, type FrameworkInfo } from './libraryModel';

export function FrameworkList({ ids, info, active, onPick, maxHeight = 260, autoFocus = false }: {
  ids: readonly number[];
  info: Record<string, FrameworkInfo>;
  active?: readonly string[];
  onPick?: (id: number) => void;
  /** px; the list scrolls inside it */
  maxHeight?: number;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const total = new Set(ids).size;
  const rows = frameworkList(ids, info, query);
  const searchable = total > FRAMEWORK_SEARCH_FROM;
  return (
    <div className="text-[#26323d]">
      {searchable && (
        <div className="relative mb-2">
          <label htmlFor={searchId} className="sr-only">Search the {total} frameworks</label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#586472]" strokeWidth={1.75} aria-hidden />
          <input
            id={searchId}
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${total} frameworks`}
            className="w-full rounded-md border border-[#c3ccd5] bg-white py-1.5 pl-8 pr-2 text-[13px] text-[#1f2933] placeholder:text-[#586472] focus:border-[#0f766e] focus:outline-none focus:ring-1 focus:ring-[#0f766e]"
          />
        </div>
      )}
      <ul style={{ maxHeight }} className="space-y-0.5 overflow-y-auto pr-0.5" aria-label={`${total} frameworks`}>
        {rows.map((c) => {
          const tint = categoryTint(c.label);
          const on = !!active?.includes(String(c.id));
          // a framework with its own short label shows it as a chip beside the full name; one without (the name IS the label) shows the
          // full name as a tinted tag that wraps, never cut off: this list is where the whole name is read
          const own = c.name !== c.label;
          const tag = c.known ? tint.soft : 'bg-slate-100 text-slate-600';
          const body = (
            <>
              {own
                ? <span className={`mt-px inline-flex min-w-[3.25rem] max-w-[7rem] shrink-0 items-center justify-center truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tag}`}>{c.label}</span>
                : null}
              <span className={own ? 'min-w-0 flex-1 break-words text-[13px] leading-5 text-[#26323d]' : `min-w-0 break-words rounded-md px-1.5 py-0.5 text-[12px] font-semibold leading-4 ${tag}`}>{c.name}</span>
              {on && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0f766e]" strokeWidth={2} aria-label="Already filtering by this" />}
            </>
          );
          return (
            <li key={c.id}>
              {onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  title={`Show the documents mapped to ${c.label}`}
                  className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[#eef2f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
                >
                  {body}
                </button>
              ) : (
                <div className="flex w-full items-start gap-2 px-1.5 py-1">{body}</div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-1.5 py-3 text-center text-[13px] text-[#586472]">No framework matches “{query}”.</li>}
      </ul>
      {searchable && query && rows.length > 0 && <p className="mt-1.5 px-1.5 text-[11px] text-[#586472]">{rows.length} of {total}</p>}
    </div>
  );
}

export default FrameworkList;
