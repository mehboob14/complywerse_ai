'use client';

/**
 * The filter bar of the documents library, controlled by its props: ONE row (search, the filter pills, and on the right the Views,
 * Columns, density and Export controls as icons), and, only while filtering, a line with how many match and what is filtered on as
 * chips that come off one by one. What each filter means lives in libraryModel.ts and the chips' and names' rules in libraryFiltersLogic.ts;
 * this file only draws and keeps what is not state of the page (which popover is open, the name being typed for a new view).
 * Colours are explicit hex classes on purpose: the platform's CSS repaints slate/white inside the dashboard and gives a bare <p>
 * its own size and colour (PITFALLS: grc-frontend UI). The popovers are portaled and fixed-positioned so no table or scroll
 * container clips them, and close on Escape, an outside click, a scroll elsewhere or a change of width.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Check, ChevronDown, Columns3, Download, Folder, Plus, Rows3, Rows4, Search, SlidersHorizontal, Table2, UserRound, X } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import {
  ATTESTATION_BUCKETS, ATTESTATION_LABEL, NO_FILTERS, REVIEW_BUCKETS, REVIEW_BUCKET_LABEL, filterCount, nextStatuses,
  type AttestationBucket, type Filters, type LibraryViewId, type ReviewBucket, type SavedView,
} from './libraryModel';
import type { Density } from './libraryPrefs';
import { exportTitle, filterChips, removeChip, resultText, validViewName, type FilterOptions } from './libraryFiltersLogic';

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
  /** built-in first, then the person's own (SavedView.builtIn) */
  views: SavedView[];
  activeViewId: string | null;
  onApplyView: (view: SavedView) => void;
  /** saves the CURRENT filters + sort under that name */
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
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
}

const REVIEW_ITEMS = REVIEW_BUCKETS.map((b) => ({ value: b as string, label: REVIEW_BUCKET_LABEL[b] }));

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
// Two traps of the platform's CSS (globals.css), for everything drawn inline (the popovers are portaled to <body>, outside both):
//  - `.bg-white` is forced with !important, which would beat any hover/on tint on the same element: an element whose background
//    changes never carries `bg-white` (a plain white one is spelled bg-[#fff]).
//  - `.governance-light button { font-size: .75rem }` beats an arbitrary size such as text-[13px] on a <button> or <input>; the
//    named sizes (text-sm = 13px, text-xs = 12px) are forced by `.compact-density` and win. So the text of a button is text-sm /
//    text-xs, like the shared dropdown's pills; text inside a <span> may use any size.
/** The buttons that sit among the shared dropdown's pills look like them. */
const PILL = `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs transition-colors ${FOCUS}`;
const PILL_IDLE = 'border-[#d5dbe1] bg-white text-[#1f2933] hover:border-[#9aa5b1]';
const PILL_APPLIED = 'border-[#0f766e] bg-white text-[#1f2933]';
const PILL_ON = 'border-[#0f766e] bg-[#f0fdfa] font-medium text-[#115e59]';
/** The small buttons of row 2. */
const TOOL = `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d5dbe1] bg-[#fff] px-2.5 text-sm font-medium text-[#26323d] transition-colors enabled:hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const SECTION = 'px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#586472]';
const QUIET = 'px-2 py-1.5 text-[12px] leading-4 text-[#586472]';

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
          className="fixed z-[70] overflow-y-auto rounded-xl border border-[#d5dbe1] bg-white text-[13px] text-[#26323d] shadow-elevated focus:outline-none"
        >
          {children({ close, refocus })}
        </div>,
        document.body,
      )}
    </>
  );
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-[#26323d] hover:bg-[#f3f6f8]">
      <input type="checkbox" checked={checked} onChange={onChange} className={`h-4 w-4 shrink-0 rounded border-[#9aa5b1] accent-[#0f766e] ${FOCUS}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  );
}

// ─── Views ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

function ViewsPanel({ views, activeViewId, canSave, onApply, onSave, onDelete, api }: {
  views: SavedView[];
  activeViewId: string | null;
  canSave: boolean;
  onApply: (view: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  api: PanelApi;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);               // an empty name is only complained about once Save was pressed
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const inputId = `${uid}-name`;
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
      <li key={v.id} className="flex items-center rounded-md hover:bg-[#f3f6f8]">
        <button
          type="button"
          aria-current={on ? 'true' : undefined}
          onClick={() => { onApply(v); api.close(); }}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${on ? 'font-medium text-[#115e59]' : 'text-[#26323d]'} ${FOCUS}`}
        >
          <Check aria-hidden strokeWidth={2} className={`h-4 w-4 shrink-0 ${on ? 'text-[#0f766e]' : 'invisible'}`} />
          <span className="min-w-0 flex-1 truncate">{v.name}</span>
        </button>
        {!v.builtIn && (
          <button
            type="button"
            aria-label={`Delete view “${v.name}”`}
            title="Delete view"
            onClick={() => { onDelete(v.id); api.refocus(); }}
            className={`mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#586472] hover:bg-[#fee4e2] hover:text-[#b42318] ${FOCUS}`}
          >
            <X aria-hidden strokeWidth={1.75} className="h-4 w-4" />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="p-2">
      <p className={SECTION}>Views</p>
      <ul>{builtIn.map(row)}</ul>
      <p className={SECTION}>My views</p>
      {own.length > 0 ? <ul>{own.map(row)}</ul> : <p className={QUIET}>None yet. Filter the library, then save the view here.</p>}
      {canSave && (
        <div className="mt-1.5 border-t border-[#e1e6eb] pt-1.5">
          {naming ? (
            <div className="space-y-1.5 px-2 pb-1">
              <label htmlFor={inputId} className="block text-[12px] font-medium text-[#26323d]">Name this view</label>
              <input
                id={inputId}
                ref={inputRef}
                type="text"
                value={name}
                autoComplete="off"
                placeholder="For example, Overdue policies"
                aria-invalid={showError}
                aria-describedby={showError ? errorId : undefined}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancel(); }       // cancels the name; the panel's own Escape then leaves it alone
                }}
                className={`h-9 w-full rounded-lg border bg-white px-2.5 text-[13px] text-[#1f2933] placeholder:text-[#586472] ${showError ? 'border-[#b42318]' : 'border-[#c3ccd5]'} ${FOCUS}`}
              />
              {showError && <p id={errorId} role="alert" className="text-[12px] leading-4 text-[#b42318]">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={cancel} className={`h-8 rounded-lg px-3 text-[13px] font-medium text-[#26323d] hover:bg-[#f3f6f8] ${FOCUS}`}>Cancel</button>
                <button type="button" onClick={save} className={`h-8 rounded-lg bg-[#0f766e] px-3 text-[13px] font-medium text-[#fff] hover:bg-[#115e59] ${FOCUS}`}>Save</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-[#0f766e] hover:bg-[#f0fdfa] ${FOCUS}`}
            >
              <Plus aria-hidden strokeWidth={2} className="h-4 w-4 shrink-0" />
              Save current view…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── The bar ─────────────────────────────────────────────────────────────────────────

/** An icon-only tool button: a square, named by aria-label and title. */
const ICON_TOOL = `${TOOL} w-8 justify-center px-0`;

export function LibraryFilters({
  filters, onChange, options, canFilterMine, shown, total, views, activeViewId, onApplyView, onSaveView, onDeleteView,
  columns, onToggleColumn, onResetColumns, density, onDensity, onExport, canExport, view, onView,
}: LibraryFiltersProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const filtering = filterCount(filters) > 0;
  const chips = filterChips(filters, options);
  const moreCount = filters.review.length + filters.attestation.length + filters.classifications.length;
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const namedView = activeView && activeView.id !== 'all' ? activeView : null;      // "All documents" is the plain state: no name on the button
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

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

  const pill = (title: string, items: FilterOptions['types'], selected: string[], onApply: (next: string[]) => void, extra: { forceSearch?: boolean; showAvatars?: boolean } = {}) => (
    <MultiSelectDropdown
      title={title}
      items={items}
      selectedValues={selected}
      onApply={onApply}
      multiSelect
      autoApply
      compact
      size="sm"
      showAvatars={extra.showAvatars ?? false}
      forceSearch={extra.forceSearch}
      className="shrink-0"
      triggerClassName="max-w-[14rem]"
    />
  );

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2 text-[13px] text-[#26323d]">
      {/* The count, for a screen reader (the header says it in words, the chips below when filtering) */}
      <span role="status" aria-live="polite" className="sr-only">{resultText(shown, total, filtering)}</span>

      {/* One row: the search, the pills, then (right) views, columns, density, export. It wraps on narrow screens; on a phone the pills scroll along one line. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-[200px] sm:max-w-[300px] sm:flex-1">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#586472]" />
          <input
            ref={searchRef}
            type="text"
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
            className={`h-8 w-full rounded-lg border border-[#c3ccd5] bg-white pl-9 pr-8 text-xs text-[#1f2933] text-ellipsis placeholder:text-[#586472] focus-visible:!border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]`}
          />
          {filters.search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { set({ search: '' }); searchRef.current?.focus(); }}
              className={`absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] ${FOCUS}`}
            >
              <X aria-hidden strokeWidth={1.75} className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="-m-0.5 flex items-center gap-2 overflow-x-auto p-0.5 scrollbar-thin sm:contents">
          {pill('Type', options.types, filters.types, (next) => set({ types: next }))}
          {pill('Status', options.statuses, filters.statuses, (next) => set({ statuses: nextStatuses(filters.statuses, next) }))}
          {pill('Owner', options.owners, filters.owners, (next) => set({ owners: next }), { forceSearch: true, showAvatars: true })}
          {pill('Department', options.departments, filters.departments, (next) => set({ departments: next }), { forceSearch: true })}
          {pill('Framework', options.frameworks, filters.frameworks, (next) => set({ frameworks: next }), { forceSearch: true })}

          <PopoverMenu
            title="Filters"
            label={moreCount > 0 ? `More filters, ${moreCount} applied` : 'More filters'}
            width={288}
            align="left"
            buttonClass={`${PILL} ${moreCount > 0 ? PILL_APPLIED : PILL_IDLE}`}
            button={(
              <>
                <SlidersHorizontal aria-hidden strokeWidth={1.75} className="h-3.5 w-3.5 shrink-0 text-[#586472]" />
                <span>Filters</span>
                {moreCount > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#ccfbf1] px-1.5 text-[11px] font-medium text-[#115e59]">{moreCount}</span>
                )}
              </>
            )}
          >
            {() => (
              <div className="space-y-2 p-2">
                <fieldset className="min-w-0">
                  <legend className={SECTION}>Review</legend>
                  {REVIEW_BUCKETS.map((b: ReviewBucket) => (
                    <CheckRow key={b} checked={filters.review.includes(b)} label={REVIEW_BUCKET_LABEL[b]} onChange={() => set({ review: toggle(filters.review, b) })} />
                  ))}
                </fieldset>
                <fieldset className="min-w-0">
                  <legend className={SECTION}>Attestation</legend>
                  {ATTESTATION_BUCKETS.map((b: AttestationBucket) => (
                    <CheckRow key={b} checked={filters.attestation.includes(b)} label={ATTESTATION_LABEL[b]} onChange={() => set({ attestation: toggle(filters.attestation, b) })} />
                  ))}
                </fieldset>
                <fieldset className="min-w-0">
                  <legend className={SECTION}>Classification</legend>
                  {options.classifications.length > 0 ? options.classifications.map((o) => (
                    <CheckRow key={o.value} checked={filters.classifications.includes(o.value)} label={o.label} onChange={() => set({ classifications: toggle(filters.classifications, o.value) })} />
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
              {filters.mine ? <Check aria-hidden strokeWidth={2} className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" /> : <UserRound aria-hidden strokeWidth={1.75} className="h-3.5 w-3.5 shrink-0 text-[#586472]" />}
              Mine
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* the layout: the register table, or a folder for each department (the same documents, the same filters) */}
          <div role="group" aria-label="Library layout" className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-[#c3ccd5] bg-[#fff] p-0.5">
            {([['table', Table2, 'Table'], ['folders', Folder, 'Folders']] as const).map(([value, Icon, name]) => {
              const on = view === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  title={value === 'table' ? 'One list of documents' : 'Documents in a folder for each department'}
                  onClick={() => { if (!on) onView(value); }}
                  className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs ${FOCUS} ${on ? 'bg-[#f0fdfa] font-medium text-[#115e59] ring-1 ring-inset ring-[#99d5cf]' : 'text-[#586472] hover:bg-[#f3f6f8]'}`}
                >
                  <Icon aria-hidden strokeWidth={1.75} className="h-4 w-4" />
                  {name}
                </button>
              );
            })}
          </div>

          <PopoverMenu
            title="Views"
            label={activeView ? `Views, current view ${activeView.name}` : 'Views'}
            width={300}
            align="right"
            buttonClass={namedView ? TOOL : ICON_TOOL}
            button={(
              <>
                <Bookmark aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0 text-[#586472]" />
                {namedView && <span className="max-w-[9rem] truncate">{namedView.name}</span>}
                {namedView && <ChevronDown aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0 text-[#586472]" />}
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
            buttonClass={ICON_TOOL}
            button={<Columns3 aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0 text-[#586472]" />}
          >
            {() => (
              <div className="p-2">
                <p className={SECTION}>Columns</p>
                {columns.map((c) => <CheckRow key={c.id} checked={c.visible} label={c.label} onChange={() => onToggleColumn(c.id)} />)}
                <p className={SECTION}>Rows</p>
                <div role="group" aria-label="Row density" className="mx-2 mb-1 inline-flex h-8 items-center gap-0.5 rounded-lg border border-[#c3ccd5] bg-white p-0.5">
                  {([['comfortable', Rows3, 'Comfortable'], ['compact', Rows4, 'Compact']] as const).map(([value, Icon, name]) => {
                    const on = density === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${name} rows`}
                        title={name}
                        onClick={() => onDensity(value)}
                        className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs ${FOCUS} ${on ? 'bg-[#f0fdfa] font-medium text-[#115e59] ring-1 ring-inset ring-[#99d5cf]' : 'text-[#586472] hover:bg-[#f3f6f8]'}`}
                      >
                        <Icon aria-hidden strokeWidth={1.75} className="h-4 w-4" />
                        {name}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 border-t border-[#e1e6eb] pt-1.5">
                  <button type="button" onClick={onResetColumns} className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-[#0f766e] hover:bg-[#f0fdfa] ${FOCUS}`}>
                    Reset
                  </button>
                </div>
              </div>
            )}
          </PopoverMenu>

          <button type="button" onClick={onExport} disabled={!canExport} title={exportTitle(shown, canExport)} aria-label="Export CSV" className={ICON_TOOL}>
            <Download aria-hidden strokeWidth={1.75} className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* Only while filtering: how many match, what is filtered on (each comes off by itself), and a way to drop them all */}
      {chips.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[13px] font-medium tabular-nums text-[#1f2933]">{shown} of {total}</span>
          <ul aria-label="Active filters" className="flex min-w-0 flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <li key={chip.key} className="inline-flex h-7 max-w-full items-center rounded-full border border-[#99d5cf] bg-[#f0fdfa] pl-2.5 pr-0.5 text-[12.5px] text-[#115e59]">
                <span className="min-w-0 truncate">{chip.label}</span>
                <button
                  type="button"
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={() => onChange(removeChip(filters, chip))}
                  className={`ml-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#115e59] hover:bg-[#ccfbf1] ${FOCUS}`}
                >
                  <X aria-hidden strokeWidth={2} className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => { onChange(NO_FILTERS); searchRef.current?.focus(); }}
                className={`h-7 rounded-md px-2 text-sm font-medium text-[#0f766e] hover:bg-[#f0fdfa] hover:text-[#115e59] ${FOCUS}`}
              >
                Clear
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
