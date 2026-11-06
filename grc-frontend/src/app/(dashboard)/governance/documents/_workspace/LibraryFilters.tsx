'use client';

/**
 * The filter bar of the documents library, controlled by its props: ONE group of controls (search, the filter pills, and on the right the layout switch and the Views,
 * Columns and Export tools), and, only while filtering, a line with how many match and what is filtered on as chips that come off one by one. What each filter means lives in
 * libraryModel.ts, the chips' and names' rules in libraryFiltersLogic.ts and every number the bar states in libraryNumbers.ts (cut, it says "in the 1,000 loaded"); this file
 * only draws and keeps what is not state of the page (which popover is open, the name being typed for a new view).
 * On the design-system kit: the search is a TextInput, the tools are kit buttons, the layout switch a SegmentedControl, the lists are native checkboxes. The multi-select
 * PILLS have no kit equivalent yet: FilterPill is the library's own (a popover with checkbox rows and a search box, immediate like the shared dropdown it replaces here,
 * keyboard-correct: Escape and Tab close it and focus goes back to its button). The popovers are portaled and fixed-positioned so no table or scroll container clips them,
 * and close on Escape, an outside click, a scroll elsewhere or a change of width.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Check, ChevronDown, Columns3, Download, Plus, Search, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { Button, Checkbox, SegmentedControl, TextInput } from '@/components/ui/ds';
import { buttonClasses, iconButtonClasses } from '@/components/ui/ds/buttonStyles';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  ATTESTATION_BUCKETS, ATTESTATION_LABEL, NO_FILTERS, REVIEW_BUCKETS, REVIEW_BUCKET_LABEL, filterCount, nextStatuses,
  type AttestationBucket, type Filters, type LibraryViewId, type Option, type ReviewBucket, type SavedView,
} from './libraryModel';
import type { Density } from './libraryPrefs';
import { DEPARTMENT_FILTER_NOTE, EXPIRING_LABEL, filterChips, removeChip, validViewName, type FilterOptions } from './libraryFiltersLogic';
import { exportWords, resultLine, shownOf } from './libraryNumbers';

export type { FilterOptions } from './libraryFiltersLogic';

export interface ColumnChoice { id: string; label: string; visible: boolean }

export interface LibraryFiltersProps {
  filters: Filters;
  onChange: (next: Filters) => void;
  options: FilterOptions;
  /** false when the signed-in person is not known */
  canFilterMine: boolean;
  /** documents matching the filters */
  shown: number;
  /** documents in scope (without the filters) */
  total: number;
  /** how many documents the page loaded and how many exist: the words say "loaded" when they differ (libraryNumbers.ts) */
  listSize: { loaded: number; total: number | null | undefined };
  /** the list has not answered yet: no count is announced (it would say "0 documents") */
  loading?: boolean;
  /** built-in first, then the person's own (SavedView.builtIn) */
  views: SavedView[];
  activeViewId: string | null;
  onApplyView: (view: SavedView) => void;
  /** saves the CURRENT filters + sort under that name */
  onSaveView: (name: string) => void;
  /** the page asks before it deletes a view */
  onDeleteView: (view: SavedView) => void;
  /** the optional columns (the title and the actions are always on) */
  columns: ColumnChoice[];
  onToggleColumn: (id: string) => void;
  onResetColumns: () => void;
  density: Density;
  onDensity: (d: Density) => void;
  onExport: () => void;
  /** false when nothing matches */
  canExport: boolean;
  /** the layout: the register table, or a folder for each department */
  view: LibraryViewId;
  onView: (view: LibraryViewId) => void;
  /** how many documents the server names for the Attention filter (`?attn=`), said on its chip; null until it has answered */
  attentionTotal?: number | null;
}

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
/** The filter pills: a slim round button, 32px (44px on touch). */
const PILL = `inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap rounded-full border px-[12px] text-ds-label transition-colors ${FOCUS}`;
const PILL_IDLE = 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover';
const PILL_APPLIED = 'border-ds-primary bg-ds-surface text-ds-fg hover:bg-ds-surface-hover';
const PILL_ON = 'border-ds-primary bg-ds-primary-soft text-ds-primary-text';
const SECTION = 'px-[8px] pb-1 pt-2 text-ds-label font-[600] text-ds-fg-muted';
const QUIET = 'px-[8px] py-1.5 text-ds-label text-ds-fg-muted';
const LINK_ROW = `flex min-h-ds-control w-full items-center gap-2 rounded-ds-control px-[8px] text-left text-ds-body font-[600] text-ds-primary-text hover:bg-ds-primary-soft ${FOCUS}`;

const LAYOUT = [{ value: 'table', label: 'Table' }, { value: 'folders', label: 'Folders' }] as const;
const DENSITY = [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] as const;

const toggle = <T extends string>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

// ─── A popover that is never clipped ─────────────────────────────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Placed { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/** Under the button, or above it when there is more room there; never off screen. Chosen once, when it opens. */
function place(r: DOMRect, width: number, align: 'left' | 'right'): Placed {
  const w = Math.min(width, window.innerWidth - 16);
  const left = Math.max(8, Math.min(align === 'left' ? r.left : r.right - w, window.innerWidth - w - 8));
  const below = window.innerHeight - r.bottom - 14;
  const above = r.top - 14;
  return below >= 280 || below >= above
    ? { left, width: w, top: r.bottom + 6, maxHeight: Math.max(160, below) }
    : { left, width: w, bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(160, above) };
}

interface PanelApi {
  /** closes the panel and puts focus back on its button */
  close: () => void;
  /** puts focus on the panel itself, after the thing that had it went away (a deleted view) */
  refocus: () => void;
}

function PopoverMenu({ title, label, width, align = 'left', buttonClass, button, children }: {
  /** names the panel */
  title: string;
  /** names the button when its text alone does not */
  label?: string;
  width: number;
  align?: 'left' | 'right';
  buttonClass: string;
  button: ReactNode;
  children: (api: PanelApi) => ReactNode;
}) {
  const [at, setAt] = useState<Placed | null>(null);          // null while the panel is closed
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = at !== null;

  const close = useCallback(() => { setAt(null); buttonRef.current?.focus({ preventScroll: true }); }, []);
  const refocus = useCallback(() => panelRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    if (!open) return;
    const openedAtWidth = window.innerWidth;
    const away = () => setAt(null);                        // closing because the person went elsewhere: focus stays where they put it
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) away();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) close(); };
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) away(); };
    const onResize = () => { if (window.innerWidth !== openedAtWidth) away(); };      // a phone's keyboard changes the height only
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // the panel is at the end of the page for a screen reader and the Tab key, so focus moves into it when it opens
  useEffect(() => {
    if (open) (panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current)?.focus({ preventScroll: true });
  }, [open]);

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const here = document.activeElement;
    const leaving = e.shiftKey ? here === items[0] || here === panelRef.current : here === items[items.length - 1];
    if (!items.length || leaving) close();                 // focus goes back to the button and Tab carries on from there
  };

  const toggleOpen = () => {
    if (open) { setAt(null); return; }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAt(place(r, width, align));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label={label}
        title={label ?? title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={buttonClass}
      >
        {button}
      </button>
      {at && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={title}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          style={{ left: at.left, top: at.top, bottom: at.bottom, width: at.width, maxHeight: at.maxHeight }}
          className="fixed z-[70] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface text-ds-body text-ds-fg-body shadow-ds-pop focus-visible:outline-none"
        >
          {children({ close, refocus })}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── A multi-select pill ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A few words for the pill: "Type" while nothing is chosen, "Type · Policy" for one, "Type · 2" for more. */
function pillWords(title: string, items: readonly Option[], selected: readonly string[]): { text: string; label: string } {
  const names = items.filter((o) => selected.includes(o.value)).map((o) => o.label);
  if (selected.length === 0) return { text: title, label: `${title}, no filter` };
  const text = `${title} · ${names.length === 1 ? names[0] : selected.length}`;
  return { text, label: `${title}: ${names.length > 0 ? names.join(', ') : `${selected.length} chosen`}` };
}

/** The list inside a pill: a search box (always for people, departments and frameworks, which are long; else only past ten), a checkbox for each choice, Clear. */
function PillList({ title, items, selected, onApply, forceSearch, api }: {
  title: string; items: Option[]; selected: string[]; onApply: (next: string[]) => void; forceSearch: boolean; api: PanelApi;
}) {
  const [query, setQuery] = useState('');
  const searchable = forceSearch || items.length > 10;
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((o) => o.label.toLowerCase().includes(q) || (o.subLabel ?? '').toLowerCase().includes(q)) : items;
  return (
    <div role="group" aria-label={title} className="p-[8px]">
      {searchable && (
        <div className="pb-[8px]">
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }}
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            autoComplete="off"
            leftAdornment={<Search aria-hidden />}
          />
        </div>
      )}
      <div className="max-h-[256px] overflow-y-auto">
        {shown.length === 0 && <p className={QUIET}>No items found</p>}
        {shown.map((o) => (
          <Checkbox
            key={o.value}
            className="w-full rounded-ds-control px-[8px] hover:bg-ds-surface-hover"
            checked={selected.includes(o.value)}
            onChange={() => onApply(toggle(selected, o.value))}
            label={(
              <span className="block min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.subLabel && <span className="block truncate text-ds-label text-ds-fg-muted">{o.subLabel}</span>}
              </span>
            )}
          />
        ))}
      </div>
      {selected.length > 0 && (
        <div className="mt-[4px] border-t border-ds-border pt-[4px]">
          <button type="button" onClick={() => { onApply([]); api.refocus(); }} className={LINK_ROW}>Clear {title.toLowerCase()}</button>
        </div>
      )}
    </div>
  );
}

/** `info`: what the pill's (i) says, beside the pill (not inside it: a button cannot hold a button). */
function FilterPill({ title, items, selected, onApply, forceSearch = false, info }: {
  title: string; items: Option[]; selected: string[]; onApply: (next: string[]) => void; forceSearch?: boolean; info?: string;
}) {
  const words = pillWords(title, items, selected);
  const pill = (
    <PopoverMenu
      title={title}
      label={words.label}
      width={288}
      align="left"
      buttonClass={`${PILL} ${selected.length > 0 ? PILL_APPLIED : PILL_IDLE} max-w-[14rem]`}
      button={(
        <>
          <span className="min-w-0 truncate">{words.text}</span>
          <ChevronDown aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
        </>
      )}
    >
      {(api) => <PillList title={title} items={items} selected={selected} onApply={onApply} forceSearch={forceSearch} api={api} />}
    </PopoverMenu>
  );
  if (!info) return pill;
  return (
    <span className="inline-flex shrink-0 items-center gap-[2px]">
      {pill}
      <InfoTip text={info} label={`About the ${title.toLowerCase()} filter`} />
    </span>
  );
}

// ─── Views ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

function ViewsPanel({ views, activeViewId, canSave, onApply, onSave, onDelete, api }: {
  views: SavedView[];
  activeViewId: string | null;
  canSave: boolean;
  onApply: (view: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (view: SavedView) => void;
  api: PanelApi;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);               // an empty name is only complained about once Save was pressed
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const errorId = `${uid}-error`;
  const builtIn = views.filter((v) => v.builtIn);
  const own = views.filter((v) => !v.builtIn);
  const error = validViewName(name, own.map((v) => v.name));
  const showError = !!error && (tried || name.trim() !== '');

  useEffect(() => { if (naming) inputRef.current?.focus({ preventScroll: true }); }, [naming]);

  const cancel = () => { setNaming(false); setName(''); setTried(false); api.refocus(); };
  const save = () => {
    if (error) { setTried(true); inputRef.current?.focus({ preventScroll: true }); return; }
    onSave(name.trim());
    api.close();
  };

  const row = (v: SavedView) => {
    const on = v.id === activeViewId;
    return (
      <li key={v.id} className="flex items-center rounded-ds-control hover:bg-ds-surface-hover">
        <button
          type="button"
          aria-current={on ? 'true' : undefined}
          onClick={() => { onApply(v); api.close(); }}
          className={`flex min-h-ds-control min-w-0 flex-1 items-center gap-2 rounded-ds-control px-[8px] text-left text-ds-body ${on ? 'font-[600] text-ds-primary-text' : 'text-ds-fg-body'} ${FOCUS}`}
        >
          <Check aria-hidden strokeWidth={2} className={`h-[16px] w-[16px] shrink-0 ${on ? 'text-ds-primary-text' : 'invisible'}`} />
          <span className="min-w-0 flex-1 truncate">{v.name}</span>
        </button>
        {!v.builtIn && (
          <button
            type="button"
            aria-label={`Delete view “${v.name}”`}
            title="Delete view"
            onClick={() => { api.close(); onDelete(v); }}
            className={`mr-1 grid h-ds-control w-[var(--ds-control-h)] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-danger-soft hover:text-ds-danger ${FOCUS}`}
          >
            <X aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px]" />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="p-[8px]">
      <p className={SECTION}>Views</p>
      <ul>{builtIn.map(row)}</ul>
      <p className={SECTION}>My views</p>
      {own.length > 0 ? <ul>{own.map(row)}</ul> : <p className={QUIET}>None yet. Filter the library, then save the view here.</p>}
      {canSave && (
        <div className="mt-1.5 border-t border-ds-border pt-1.5">
          {naming ? (
            <div className="space-y-1.5 px-[8px] pb-1">
              <label htmlFor={`${uid}-name`} className="block text-ds-label font-[600] text-ds-fg-body">Name this view</label>
              <TextInput
                id={`${uid}-name`}
                ref={inputRef}
                type="text"
                value={name}
                autoComplete="off"
                placeholder="For example, Overdue policies"
                invalid={showError}
                aria-describedby={showError ? errorId : undefined}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancel(); }       // cancels the name; the panel's own Escape then leaves it alone
                }}
              />
              {showError && <p id={errorId} role="alert" className="text-ds-label text-ds-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={save}>Save</Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setNaming(true)} className={LINK_ROW}>
              <Plus aria-hidden strokeWidth={2} className="h-[16px] w-[16px] shrink-0" />
              Save current view…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── The bar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function LibraryFilters({
  filters, onChange, options, canFilterMine, shown, total, listSize, loading = false, views, activeViewId, onApplyView, onSaveView, onDeleteView,
  columns, onToggleColumn, onResetColumns, density, onDensity, onExport, canExport, view, onView, attentionTotal = null,
}: LibraryFiltersProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const filtering = filterCount(filters) > 0;
  const chips = filterChips(filters, options, { attentionTotal });
  const moreCount = filters.review.length + filters.attestation.length + filters.classifications.length + (filters.expiring ? 1 : 0);
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const namedView = activeView && activeView.id !== 'all' ? activeView : null;      // "All documents" is the plain state: no name on the button
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const words = exportWords({ shown, loaded: listSize.loaded, total: listSize.total, canExport });

  // "/" jumps to the search, unless the person is typing somewhere or a dialog is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest?.('[role="dialog"], [aria-modal="true"]'))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      {/* The count, for a screen reader (the header says it in words, the chips below when filtering) */}
      <span role="status" aria-live="polite" className="sr-only">{loading ? 'Loading the documents' : resultLine({ shown, scope: total, filtering, loaded: listSize.loaded, total: listSize.total })}</span>

      {/* One group: the search, the pills, then (right) layout, views, columns, export. It wraps on narrow screens. */}
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          ref={searchRef}
          className="w-full sm:min-w-[200px] sm:max-w-[300px] sm:flex-1"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search documents"
          aria-keyshortcuts="/"
          title="Searches title, code, owner, department, frameworks, tags and file name. Press / to jump here."
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search documents"
          leftAdornment={<Search aria-hidden />}
          rightAdornment={filters.search ? (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => { set({ search: '' }); searchRef.current?.focus(); }}
              className={`grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg ${FOCUS}`}
            >
              <X aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
            </button>
          ) : undefined}
        />

        {/* on a phone the pills are one line that scrolls along (four lines of pills would push the documents off the first screen); from 640px they join the bar */}
        <div className="-mx-[2px] flex min-w-0 max-w-full items-center gap-2 overflow-x-auto px-[2px] py-[2px] max-sm:w-full sm:contents">
        <FilterPill title="Type" items={options.types} selected={filters.types} onApply={(next) => set({ types: next })} />
        <FilterPill title="Status" items={options.statuses} selected={filters.statuses} onApply={(next) => set({ statuses: nextStatuses(filters.statuses, next) })} />
        <FilterPill title="Owner" items={options.owners} selected={filters.owners} onApply={(next) => set({ owners: next })} forceSearch />
        <FilterPill title="Department" items={options.departments} selected={filters.departments} onApply={(next) => set({ departments: next })} forceSearch info={DEPARTMENT_FILTER_NOTE} />
        <FilterPill title="Framework" items={options.frameworks} selected={filters.frameworks} onApply={(next) => set({ frameworks: next })} forceSearch />

        <PopoverMenu
          title="Filters"
          label={moreCount > 0 ? `More filters, ${moreCount} applied` : 'More filters'}
          width={288}
          align="left"
          buttonClass={`${PILL} ${moreCount > 0 ? PILL_APPLIED : PILL_IDLE}`}
          button={(
            <>
              <SlidersHorizontal aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
              <span>Filters</span>
              {moreCount > 0 && (
                <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-ds-primary-soft px-[6px] text-ds-label text-ds-primary-text">{moreCount}</span>
              )}
            </>
          )}
        >
          {() => (
            <div className="space-y-2 p-[8px]">
              <fieldset className="min-w-0">
                <legend className={SECTION}>Review</legend>
                {REVIEW_BUCKETS.map((b: ReviewBucket) => (
                  <Checkbox key={b} className="w-full rounded-ds-control px-[8px] hover:bg-ds-surface-hover" checked={filters.review.includes(b)} label={REVIEW_BUCKET_LABEL[b]} onChange={() => set({ review: toggle(filters.review, b) })} />
                ))}
              </fieldset>
              <fieldset className="min-w-0">
                <legend className={SECTION}>Expiry</legend>
                <Checkbox className="w-full rounded-ds-control px-[8px] hover:bg-ds-surface-hover" checked={filters.expiring} label={EXPIRING_LABEL} onChange={() => set({ expiring: !filters.expiring })} />
              </fieldset>
              <fieldset className="min-w-0">
                <legend className={SECTION}>Attestation</legend>
                {ATTESTATION_BUCKETS.map((b: AttestationBucket) => (
                  <Checkbox key={b} className="w-full rounded-ds-control px-[8px] hover:bg-ds-surface-hover" checked={filters.attestation.includes(b)} label={ATTESTATION_LABEL[b]} onChange={() => set({ attestation: toggle(filters.attestation, b) })} />
                ))}
              </fieldset>
              <fieldset className="min-w-0">
                <legend className={SECTION}>Classification</legend>
                {options.classifications.length > 0 ? options.classifications.map((o) => (
                  <Checkbox key={o.value} className="w-full rounded-ds-control px-[8px] hover:bg-ds-surface-hover" checked={filters.classifications.includes(o.value)} label={o.label} onChange={() => set({ classifications: toggle(filters.classifications, o.value) })} />
                )) : <p className={QUIET}>None set</p>}
              </fieldset>
            </div>
          )}
        </PopoverMenu>

        {canFilterMine && (
          <button
            type="button"
            aria-pressed={filters.mine}
            title="Only the documents you own or wrote"
            onClick={() => set({ mine: !filters.mine })}
            className={`${PILL} ${filters.mine ? PILL_ON : PILL_IDLE}`}
          >
            {filters.mine ? <Check aria-hidden strokeWidth={2} className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" /> : <UserRound aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />}
            Mine
          </button>
        )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* the layout: the register table, or a folder for each department (the same documents, the same filters) */}
          <SegmentedControl label="Library layout" name="library-layout" options={LAYOUT} value={view} onChange={onView} />

          <PopoverMenu
            title="Views"
            label={activeView ? `Views, current view ${activeView.name}` : 'Views'}
            width={300}
            align="right"
            buttonClass={namedView ? buttonClasses({ variant: 'secondary' }) : iconButtonClasses('secondary')}
            button={(
              <>
                <Bookmark aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0" />
                {namedView && <span className="max-w-[9rem] truncate">{namedView.name}</span>}
                {namedView && <ChevronDown aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0" />}
              </>
            )}
          >
            {(api) => (
              <ViewsPanel
                views={views}
                activeViewId={activeViewId}
                canSave={activeViewId === null && filtering}
                onApply={onApplyView}
                onSave={onSaveView}
                onDelete={onDeleteView}
                api={api}
              />
            )}
          </PopoverMenu>

          <PopoverMenu
            title="Columns and rows"
            width={248}
            align="right"
            buttonClass={iconButtonClasses('secondary')}
            button={<Columns3 aria-hidden strokeWidth={1.75} className="h-[16px] w-[16px] shrink-0" />}
          >
            {() => (
              <div className="p-[8px]">
                <p className={SECTION}>Columns</p>
                {columns.map((c) => <Checkbox key={c.id} className="w-full rounded-ds-control px-[8px] hover:bg-ds-surface-hover" checked={c.visible} label={c.label} onChange={() => onToggleColumn(c.id)} />)}
                <p className={SECTION}>Rows</p>
                <div className="px-[8px] pb-1">
                  <SegmentedControl label="Row density" name="library-density" options={DENSITY} value={density} onChange={onDensity} />
                </div>
                <div className="mt-1 border-t border-ds-border pt-1.5">
                  <button type="button" onClick={onResetColumns} className={LINK_ROW}>Reset</button>
                </div>
              </div>
            )}
          </PopoverMenu>

          <Button onClick={onExport} disabled={!canExport} title={words.title} leftIcon={<Download aria-hidden />}>{words.label}</Button>
        </div>
      </div>

      {/* Only while filtering: how many match, what is filtered on (each comes off by itself), and a way to drop them all */}
      {chips.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{shownOf({ shown, scope: total, loaded: listSize.loaded, total: listSize.total })}</span>
          <ul aria-label="Active filters" className="flex min-w-0 flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <li key={chip.key} className="inline-flex min-h-[28px] max-w-full items-center rounded-full border border-ds-primary bg-ds-primary-soft pl-[10px] pr-[2px] text-ds-label text-ds-primary-text">
                <span className="min-w-0 truncate">{chip.label}</span>
                <button
                  type="button"
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={() => onChange(removeChip(filters, chip))}
                  className={`ml-[2px] grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full text-ds-primary-text hover:bg-ds-surface ${FOCUS}`}
                >
                  <X aria-hidden strokeWidth={2} className="h-[14px] w-[14px]" />
                </button>
              </li>
            ))}
            <li>
              <Button size="sm" variant="link" onClick={() => { onChange(NO_FILTERS); searchRef.current?.focus(); }}>Clear</Button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
