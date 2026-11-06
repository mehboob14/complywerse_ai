'use client';

// DebouncedSearch: a search box for a list the page asks for (the library, a register, a facet): the person types, and the list is asked ONCE, after a short quiet
// (300 ms), not for every letter. Enter asks at once; Escape, with text in the box, clears it and asks for everything (and is taken: a panel around the box
// stays open; with the box empty Escape is not its key); the clear button does the same and keeps focus in the box. The box shows what was typed; the page holds
// the query that was asked (`value`, e.g. in the address) and may change it by itself (a "Clear filters" button): the box then shows the page's query, but never
// overwrites letters typed after the last ask. `loading` turns the magnifier into a spinner while the list is being asked. Rules: searchModel.ts.
//
//   <DebouncedSearch label="Search documents" value={q} onSearch={setQ} loading={fetching} />
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { IconButton } from './Button';
import { TextInput } from './TextInput';
import { SEARCH_DELAY, clearName, escapeClears, pageChangedQuery, queryOf, shouldAsk } from './searchModel';

export interface DebouncedSearchProps {
  /** The query the list was asked with now: the page holds it (state, the address). When the page changes it by itself the box shows it. */
  value: string;
  /** The person stopped typing (after `delay`), pressed Enter, or cleared the box: the query to ask for, without the spaces at either end ("" is everything). */
  onSearch: (query: string) => void;
  /** Names the box for a screen reader ("Search documents") and its clear button ("Clear search documents"). */
  label: string;
  /** What the empty box says. */
  placeholder?: string;
  /** Milliseconds of quiet before the list is asked. */
  delay?: number;
  /** The list is being asked: the magnifier becomes a spinner and the box says it is busy. */
  loading?: boolean;
  /** Layout only (width, margin). */
  className?: string;
}

const NO_NATIVE_CLEAR = '[&_input::-webkit-search-cancel-button]:hidden';

export function DebouncedSearch({ value, onSearch, label, placeholder, delay = SEARCH_DELAY, loading = false, className }: DebouncedSearchProps) {
  const [draft, setDraft] = useState(value);
  const asked = useRef(queryOf(value));                                              // the query the list was last asked with, by this box or by the page
  const latest = useRef(onSearch);
  latest.current = onSearch;                                                          // a timer started a render ago must still call the page's current handler
  const input = useRef<HTMLInputElement>(null);

  const ask = (text: string) => {
    const query = queryOf(text);
    asked.current = query;
    latest.current(query);
  };

  // the page changed its query by itself (cleared the filters, followed a link): show it; its echo of this box's own ask is not a change
  useEffect(() => {
    if (pageChangedQuery(value, asked.current)) {
      asked.current = queryOf(value);
      setDraft(value);
    }
  }, [value]);

  // the quiet time: ask once, for what is in the box then. Enter (or Escape, or the clear button) may have asked for it already while the timer ran: look again
  // when it fires, or the same query would be asked twice
  useEffect(() => {
    if (!shouldAsk(draft, asked.current)) return undefined;
    const timer = setTimeout(() => { if (shouldAsk(draft, asked.current)) ask(draft); }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ask` only reads refs
  }, [draft, delay]);

  const clear = () => {
    setDraft('');
    if (shouldAsk('', asked.current)) ask('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();                                                             // not a form's submit
      if (shouldAsk(draft, asked.current)) ask(draft);
    } else if (e.key === 'Escape' && escapeClears(draft)) {
      e.preventDefault();                                                             // taken: a panel or dialog around the box must not close too
      e.stopPropagation();
      clear();
    }
  };

  return (
    <TextInput
      ref={input}
      type="search"
      inputMode="search"
      enterKeyHint="search"
      autoComplete="off"
      aria-label={label}
      aria-busy={loading || undefined}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      leftAdornment={loading ? <Loader2 aria-hidden className="animate-spin" /> : <Search aria-hidden />}
      rightAdornment={draft ? <IconButton label={clearName(label)} onClick={() => { clear(); input.current?.focus(); }}><X aria-hidden /></IconButton> : undefined}
      style={draft ? { paddingRight: 'calc(var(--ds-control-h) + 8px)' } : undefined}
      className={`${NO_NATIVE_CLEAR} ${className ?? ''}`.trim()}
    />
  );
}
