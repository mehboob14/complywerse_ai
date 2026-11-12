'use client';

// The shell of a record explorer (the Facet explorer of the UX revamp): a rail of facets with live counts beside the records, quick-view chips above them, a search, a view switch
// (List / Folders / Board ...), the filters that are on as chips, the records, a floating bulk bar and a details panel that opens over the list. It lays the parts out and carries the
// keyboard layer; WHAT the facets, columns, rows, views and bulk actions are is the page's configuration (records/types of the props below), so another module can plug in its own.
// A "skip" link lets the keyboard pass the rail.
// Where the filters live is the page's choice (`railPlacement`): "side" (the default, what every register has) is the rail beside the list; "top" is a bar above the list (TopFilterBar:
// one button per group that opens its options, nested where the group is a tree) so the list has the whole width, and a phone-sized explorer keeps its Filters button and sheet.
// The room decides the layout, not the window: the explorer measures its OWN box (useContainerWidth) and explorerFit says whether the rail has room beside a list worth reading or is a
// Filters button that opens it as a sheet, whether the chips scroll sideways, and whether the toolbar can afford its words. A page that wants the same answer for its own buttons takes
// `head` and `actions` as functions of the fit. Nothing here is as tall as the window: the page scrolls.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button, FilterChips, IconButton, SegmentedControl, Sheet, TextInput, type FilterChip, type SegmentedOption } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { FacetRail, type FacetGroupView } from './FacetRail';
import { MIN_LIST_WITH_RAIL, RAIL_WIDTH, fitExplorer, fitExplorerTop, type ExplorerFit } from './explorerFit';
import { TopFilterBar } from './TopFilterBar';
import { useContainerWidth } from './useContainerWidth';

type WithFit = ReactNode | ((fit: ExplorerFit) => ReactNode);

export interface RecordExplorerProps {
  /** names the regions: "Documents" */
  label: string;
  noun: { one: string; other: string };
  /** the page head */
  head: WithFit;
  /** an error or a notice above the explorer */
  notices?: ReactNode;
  /** the quick-view chips above the records; a page whose filters do it all (the library) leaves them out and no row is drawn */
  quick?: FilterChip[];
  onQuick?: (key: string) => void;
  quickLabel?: string;
  /** after the chips: the Views menu */
  quickExtra?: ReactNode;
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  searchRef: RefObject<HTMLInputElement>;
  views?: { label: string; name: string; options: readonly SegmentedOption[]; value: string; onChange: (value: string) => void };
  /** the right of the toolbar: Sort, Export */
  actions?: WithFit;
  groups: FacetGroupView[];
  onToggle: (group: string, value: string) => void;
  onClear: (group: string) => void;
  onClearAll: () => void;
  /** how many filters are on (the count on the Filters button) */
  filtering: number;
  /** above the groups: "Clear all" and a check such as "Mine" */
  railHead?: ReactNode;
  /** how many records match: the foot of the filter sheet says "Show N documents" */
  shown: number;
  /** the filters that are on, as chips */
  applied: ReactNode;
  body: ReactNode;
  bulk?: WithFit;
  /** the details panel */
  detail?: ReactNode;
  /** the rail waits (the data has not arrived) */
  ready: boolean;
  /** the narrowest list worth drawing beside the rail (default: what the Documents list needs); not read when the filters are on top */
  minList?: number;
  /** where the filters are: a rail beside the list ("side", the default) or a bar above it ("top": the list takes the whole width) */
  railPlacement?: 'side' | 'top';
}

const noop = (): void => {};

export function RecordExplorer({
  label, noun, head, notices, quick, onQuick, quickLabel, quickExtra, search, onSearch, searchLabel, searchRef, views, actions, groups, onToggle, onClear, onClearAll, filtering,
  railHead, shown, applied, body, bulk, detail, ready, minList = MIN_LIST_WITH_RAIL, railPlacement = 'side',
}: RecordExplorerProps) {
  const uid = useId();
  const bodyId = `${uid}-body`;
  const bodyRef = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(false);
  const width = useContainerWidth(root);
  const railWas = useRef(true);
  const onTop = railPlacement === 'top';
  const fit = onTop ? fitExplorerTop(width) : fitExplorer(width, railWas.current, minList);
  railWas.current = fit.rail;
  const put = (x: WithFit) => (typeof x === 'function' ? x(fit) : x);
  // the filters are a rail beside the list, a bar above it, or (a phone's room) a Filters button that opens them as a sheet
  const bar = onTop && !fit.compact;
  const button = onTop ? fit.compact : !fit.rail;
  useEffect(() => { if (!button) setSheet(false); }, [button]);         // the room grew a rail or a bar: the sheet that held its place closes
  const waiting = <p role="status" className="px-[12px] py-[8px] text-ds-label text-ds-fg-muted">The filters, with their counts, appear when the {noun.other} have loaded.</p>;
  const rail = ready ? <FacetRail groups={groups} onToggle={onToggle} onClear={onClear} idPrefix="rail" /> : waiting;
  return (
    <div ref={root} className="flex min-w-0 flex-col gap-[12px]" role="region" aria-label={label}>
      {/* with the rail beside the list or the bar above it there are filters to skip; behind a button there are none */}
      {(fit.rail || bar) && (
        <a
          href={`#${bodyId}`}
          onClick={(e) => {
            e.preventDefault();
            // past the filters to the first record (its title); with no record, to the list itself
            const first = bodyRef.current?.querySelector<HTMLElement>('[data-record-row] a[href], [data-record-row] button, [data-folder-row] button');
            (first ?? bodyRef.current)?.focus();
          }}
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:z-[60] focus-visible:rounded-ds-control focus-visible:border focus-visible:border-ds-primary focus-visible:bg-ds-surface focus-visible:px-[12px] focus-visible:py-[8px] focus-visible:text-ds-body focus-visible:font-[600] focus-visible:text-ds-primary-text focus-visible:shadow-ds-ring focus-visible:outline-none"
        >
          {`Skip the filters, go to the ${noun.other}`}
        </a>
      )}
      {put(head)}
      {notices}
      <div className="grid min-w-0 gap-[16px]" style={{ gridTemplateColumns: fit.rail ? `${RAIL_WIDTH}px minmax(0,1fr)` : 'minmax(0,1fr)' }}>
        {fit.rail && (
          <aside aria-label="Filters" className="min-w-0">
            <div className="rounded-ds-card border border-ds-border bg-ds-surface">
              <div className="flex items-center gap-[8px] border-b border-ds-border px-[12px] py-[6px]">
                <h2 className="m-0 flex-1 !text-ds-body !font-[600] !text-ds-fg">Filters</h2>
                {railHead}
                {filtering > 0 && <Button variant="link" size="sm" onClick={onClearAll}>Clear all</Button>}
              </div>
              {rail}
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-col gap-[8px]">
          {((quick && quick.length > 0) || quickExtra) && (
            <div className="flex min-w-0 items-start gap-[8px]">
              {/* a phone-sized explorer keeps the chips on one line that scrolls sideways (the records are what the screen is for); with more room they wrap */}
              <FilterChips label={quickLabel ?? 'Quick views'} chips={quick ?? []} onToggle={onQuick ?? noop} overflow={fit.compact ? 'scroll' : 'wrap'} className="min-w-0 flex-1" />
              {quickExtra}
            </div>
          )}
          <div role="search" aria-label={`Search the ${noun.other}`} className="flex min-w-0 flex-wrap items-center gap-[8px]">
            <TextInput
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              aria-label={searchLabel}
              placeholder={`Search ${noun.other}`}
              autoComplete="off"
              className="min-w-[160px] max-w-[360px] flex-1"
              leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
              rightAdornment={search ? <IconButton label="Clear the search" onClick={() => { onSearch(''); searchRef.current?.focus(); }}><X aria-hidden /></IconButton> : undefined}
            />
            {button && (
              <Button leftIcon={<SlidersHorizontal aria-hidden />} aria-haspopup="dialog" onClick={() => setSheet(true)}>
                {filtering > 0 ? `Filters (${filtering})` : 'Filters'}
              </Button>
            )}
            {views && <SegmentedControl label={views.label} name={views.name} options={views.options} value={views.value} onChange={views.onChange} />}
            <div className="ml-auto flex items-center gap-[8px]">{put(actions)}</div>
          </div>
          {bar && <TopFilterBar groups={groups} onToggle={onToggle} onClear={onClear} onClearAll={onClearAll} filtering={filtering} clearAll={!applied} railHead={railHead} ready={ready} waiting={waiting} idPrefix="top" />}
          {applied}
          <div id={bodyId} ref={bodyRef} tabIndex={-1} className="min-w-0 focus-visible:outline-none">{body}</div>
        </div>
      </div>

      {put(bulk)}
      {detail}
      <Sheet
        open={sheet && button}
        onClose={() => setSheet(false)}
        title="Filters"
        padded={false}
        actions={filtering > 0 ? <Button variant="link" size="sm" onClick={onClearAll}>Clear all</Button> : undefined}
        footer={<Button variant="primary" fullWidth onClick={() => setSheet(false)}>{`Show ${formatCount(shown)} ${shown === 1 ? noun.one : noun.other}`}</Button>}
      >
        {/* with the filters on top the sheet is the same nested groups, and holds the check the bar starts with (the side rail's sheet never had it) */}
        {sheet && ready && onTop && railHead && <div className="border-b border-ds-border px-[8px] py-[2px]">{railHead}</div>}
        {sheet && ready && <FacetRail groups={groups} onToggle={onToggle} onClear={onClear} idPrefix="sheet" nested={onTop} />}
      </Sheet>
    </div>
  );
}
