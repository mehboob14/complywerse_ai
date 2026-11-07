'use client';

/**
 * "Link a control / asset / evidence item / document": a right-hand sheet with a search box and the matches, in place of the popover that listed whole tables with no search state, no spinner
 * and no error. The records are read when the sheet opens (one request, with its own loading, empty and failed states and a Retry); the first 100 matches are drawn, and "Showing 100 of 412"
 * says there are more, so forty candidates never become a wall. Pressing a row links it at once (as it always did) and the sheet stays open for the next one: the row that is linked leaves
 * the list. A link that fails is said in words by the caller's mutation; nothing here assumes it worked.
 */
import { useMemo, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { ErrorState, Sheet, SkeletonRows, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';

export interface PickItem { value: string; label: string; sub?: string }

const SHOWN = 100;
const fold = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matchItems(items: readonly PickItem[], query: string, limit = SHOWN): { shown: PickItem[]; total: number } {
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
  const hit = terms.length === 0 ? items : items.filter((i) => { const t = fold(`${i.label} ${i.sub ?? ''}`); return terms.every((w) => t.includes(w)); });
  return { shown: hit.slice(0, limit), total: hit.length };
}

export interface LinkPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "Search controls" */
  searchLabel: string;
  items: readonly PickItem[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onPick: (value: string) => void;
  /** the value being linked right now */
  pending?: string | null;
  /** what to say when there is nothing to link at all ("Every control is already linked.") */
  empty: string;
}

export function LinkPicker({ open, onClose, title, searchLabel, items, loading, error, onRetry, onPick, pending = null, empty }: LinkPickerProps) {
  const [query, setQuery] = useState('');
  const { shown, total } = useMemo(() => matchItems(items, query), [items, query]);
  return (
    <Sheet open={open} onClose={() => { setQuery(''); onClose(); }} title={title} width="md" initialFocus="input[type=search]">
      <div className="flex flex-col gap-[12px]">
        <TextInput
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={searchLabel}
          placeholder={searchLabel}
          autoComplete="off"
          leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
        />
        {loading && <SkeletonRows rows={6} columns={2} label="Loading the list" />}
        {!loading && !!error && <ErrorState compact title="Couldn't load the list" message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />}
        {!loading && !error && items.length === 0 && <p role="status" className="m-0 text-ds-body text-ds-fg-muted">{empty}</p>}
        {!loading && !error && items.length > 0 && (
          <>
            <p role="status" className="m-0 text-ds-label text-ds-fg-muted">
              {total === 0 ? 'Nothing matches.' : total > shown.length ? `Showing ${formatCount(shown.length)} of ${formatCount(total)}. Search to narrow it down.` : `${formatCount(total)} ${total === 1 ? 'match' : 'matches'}`}
            </p>
            <ul className="m-0 list-none p-0">
              {shown.map((i) => (
                <li key={i.value} className="border-b border-ds-border last:border-b-0">
                  <button
                    type="button"
                    disabled={pending != null}
                    onClick={() => onPick(i.value)}
                    className="flex min-h-ds-control w-full items-center gap-[8px] rounded-ds-control px-[8px] py-[6px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-wait"
                  >
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{i.label}</span>
                      {i.sub && <span className="block break-words text-ds-label text-ds-fg-muted">{i.sub}</span>}
                    </span>
                    <span className="shrink-0 text-ds-label font-[600] text-ds-primary-text">
                      {pending === i.value ? <Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" /> : <><Check aria-hidden className="mr-[2px] inline h-[14px] w-[14px]" />Link</>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
