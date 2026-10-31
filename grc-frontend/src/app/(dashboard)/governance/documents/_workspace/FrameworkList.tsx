'use client';

/**
 * Every framework a document is mapped to, as a list: A to Z, with a search box once there are more than a handful (the popover
 * behind a table cell's "+N" and the details panel's Frameworks tab are the same list). With `onPick`, a row is a button that filters the
 * library by that framework; `active` says which ones it already filters by. On the design-system tokens, 12px at the least.
 */
import { useId, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { TextInput } from '@/components/ui/ds';
import { chipStyle } from './atoms';
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
    <div className="text-ds-fg-body">
      {searchable && (
        <div className="mb-2">
          <label htmlFor={searchId} className="sr-only">Search the {total} frameworks</label>
          <TextInput
            id={searchId}
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${total} frameworks`}
            leftAdornment={<Search aria-hidden />}
          />
        </div>
      )}
      <ul style={{ maxHeight }} className="space-y-0.5 overflow-y-auto pr-0.5" aria-label={`${total} frameworks`}>
        {rows.map((c) => {
          const on = !!active?.includes(String(c.id));
          // a framework with its own short label shows it as a chip beside the full name; one without (the name IS the label) shows the
          // full name as a tinted tag that wraps, never cut off: this list is where the whole name is read
          const own = c.known && c.name !== c.label;          // an id the list does not know is just "Framework #12", once
          const body = (
            <>
              {own
                ? <span style={chipStyle(c.label, c.known)} className="mt-px inline-flex min-w-[3.25rem] max-w-[7rem] shrink-0 items-center justify-center truncate rounded-ds-control border px-[6px] py-[2px] text-ds-label">{c.label}</span>
                : null}
              <span
                style={own ? undefined : chipStyle(c.label, c.known)}
                className={own ? 'min-w-0 flex-1 break-words text-ds-body text-ds-fg-body' : 'min-w-0 break-words rounded-ds-control border px-[6px] py-[2px] text-ds-label'}
              >
                {c.name}
              </span>
              {on && <Check className="mt-0.5 h-[16px] w-[16px] shrink-0 text-ds-primary-text" strokeWidth={2} aria-label="Already filtering by this" />}
            </>
          );
          return (
            <li key={c.id}>
              {onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  title={`Show the documents mapped to ${c.label}`}
                  className="flex min-h-ds-control w-full items-start gap-2 rounded-ds-control px-[6px] py-[4px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
                >
                  {body}
                </button>
              ) : (
                <div className="flex w-full items-start gap-2 px-[6px] py-[4px]">{body}</div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-[6px] py-3 text-center text-ds-body text-ds-fg-muted">No framework matches “{query}”.</li>}
      </ul>
      {searchable && query && rows.length > 0 && <p className="mt-1.5 px-[6px] text-ds-label text-ds-fg-muted">{rows.length} of {total}</p>}
    </div>
  );
}

export default FrameworkList;
