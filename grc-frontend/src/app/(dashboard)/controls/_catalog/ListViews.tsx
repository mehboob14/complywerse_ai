'use client';

// The three flat views of the Catalog: All controls (a search, four filters, the source chips with their true counts, the register, a pager on the server's total), My work (the controls assigned
// to the signed-in person) and the internal controls. All controls keeps its filters in the address (catalogAddress.ts); what a filter asks of the server is catalogModel.listQuery.
import { useState } from 'react';
import { Boxes, ClipboardList, Plus, X } from 'lucide-react';
import { Button, DebouncedSearch, EmptyState, ErrorState, FilterChips, Pager, Select, type FilterChip } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { testResult, workProgress } from '@/lib/statuses/controls';
import { KpiTiles } from './HubBand';
import { useCatalogList, useDomainNames, useMyWork, type CatalogScope } from './catalogData';
import { PAGE_SIZE, PAGE_SIZES, SOURCES, internalQuery, isFiltered, listQuery, NO_LIST_FILTERS, type CatalogOverview, type CatalogRow, type ListFilters, type SourceFilter, type WorkStats } from './catalogModel';
import { ControlRegister } from './ControlRegister';
import { PagedRegister } from './PagedRegister';

const NOUN = { one: 'control', other: 'controls' };
const SOURCE_LABEL: Record<SourceFilter, string> = { all: 'All', framework: 'Framework', internal: 'Internal', normalized: 'Unified' };
const PROGRESS_OPTIONS = ['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'] as const;
const EFFECT_OPTIONS = ['effective', 'partially_effective', 'ineffective', 'not_tested'] as const;

export interface AllControlsProps {
  filters: ListFilters;
  page: number;
  scope: CatalogScope | undefined;
  onFilters: (patch: Partial<ListFilters>) => void;
  onPage: (page: number) => void;
  onOpenRow: (r: CatalogRow) => void;
}

export function AllControls({ filters, page, scope, onFilters, onPage, onOpenRow }: AllControlsProps) {
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const domains = useDomainNames();
  const q = useCatalogList(['flat'], listQuery(filters, page, pageSize));
  const list = q.data;
  const failed = q.isError && !list;
  const filtering = isFiltered(filters);
  const chips: FilterChip[] = SOURCES.map((k) => ({ key: k, label: SOURCE_LABEL[k], active: filters.source === k, count: list?.source_counts?.[k] ?? null }));
  const frameworkName = scope?.available.find((f) => String(f.id) === filters.framework)?.name;
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch label="Search controls by name or code" placeholder="Search controls" value={filters.q} onSearch={(v) => onFilters({ q: v })} loading={q.isFetching && !q.isPending} className="w-full sm:w-[260px]" />
        <Select aria-label="Framework" className="w-full sm:w-[200px]" value={filters.framework} onChange={(e) => onFilters({ framework: e.target.value })} placeholder="All frameworks">
          {(scope?.available ?? []).map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
          {filters.framework && !scope?.available.some((f) => String(f.id) === filters.framework) && <option value={filters.framework}>{`Framework ${filters.framework}`}</option>}
        </Select>
        <Select aria-label="Domain" className="w-full sm:w-[200px]" value={filters.domain} onChange={(e) => onFilters({ domain: e.target.value })} placeholder="All domains">
          {(domains.data?.domains ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          {filters.domain && !(domains.data?.domains ?? []).includes(filters.domain) && <option value={filters.domain}>{filters.domain}</option>}
        </Select>
        <Select aria-label="Progress" className="w-full sm:w-[160px]" value={filters.progress} onChange={(e) => onFilters({ progress: e.target.value })} placeholder="Any progress">
          {PROGRESS_OPTIONS.map((w) => <option key={w} value={w}>{statusPill(workProgress, w).label}</option>)}
        </Select>
        <Select aria-label="Effectiveness" className="w-full sm:w-[190px]" value={filters.effectiveness} onChange={(e) => onFilters({ effectiveness: e.target.value })} placeholder="Any effectiveness">
          {EFFECT_OPTIONS.map((w) => <option key={w} value={w}>{statusPill(testResult, w).label}</option>)}
        </Select>
        {filters.due && (
          <Button size="sm" rightIcon={<X aria-hidden />} onClick={() => onFilters({ due: '' })} title="Show controls whatever their test date">
            {filters.due === 'overdue' ? 'Overdue tests only' : 'With a test scheduled'}
          </Button>
        )}
        {filtering && <Button variant="link" onClick={() => onFilters({ ...NO_LIST_FILTERS })}>Clear filters</Button>}
      </div>
      <FilterChips label="Where the controls come from" chips={chips} onToggle={(k) => onFilters({ source: k as SourceFilter })} overflow="scroll" />
      {frameworkName && filters.framework && <p className="m-0 text-ds-label text-ds-fg-muted">{`Showing the controls of ${frameworkName}.`}</p>}
      {failed ? (
        <ErrorState title="Couldn’t load the controls" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : (
        <ControlRegister
          caption="All controls"
          rows={list?.items ?? []}
          showDomain
          loading={q.isPending}
          onOpen={onOpenRow}
          empty={filtering
            ? <EmptyState kind="noMatches" bare title="No controls match" description="Loosen a filter, or search for other words." onClearFilters={() => onFilters({ ...NO_LIST_FILTERS })} />
            : <EmptyState kind="firstUse" bare icon={Boxes} title="No controls in your catalog" description="Choose the frameworks of your catalog, or author an internal control." action={<Button variant="primary" href="/controls/configure-frameworks">Configure frameworks</Button>} />}
          footer={list && list.total > 0 ? (
            <Pager page={page} pageSize={pageSize} total={list.total} onPage={onPage} onPageSize={(n) => { setPageSize(n); onPage(1); }} pageSizes={PAGE_SIZES} noun={NOUN} />
          ) : undefined}
        />
      )}
    </div>
  );
}

export function MyWorkView({ onOpenRow }: { onOpenRow: (r: CatalogRow) => void }) {
  const q = useMyWork();
  const items = q.data?.items ?? [];
  const failed = q.isError && !q.data;
  if (failed) return <ErrorState title="Couldn’t load your work" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  return (
    <ControlRegister
      caption="Controls assigned to you"
      rows={items}
      showDomain
      loading={q.isPending}
      onOpen={onOpenRow}
      empty={<EmptyState kind="firstUse" bare icon={ClipboardList} title="Nothing is assigned to you" description="Controls someone assigns to you appear here." />}
      footer={items.length > 0 ? <p className="m-0 text-ds-label text-ds-fg-muted">{`${formatCount(q.data?.total ?? items.length)} ${items.length === 1 ? 'control' : 'controls'} assigned to you`}</p> : undefined}
    />
  );
}

export function InternalView({ ov, onNew, onOpenRow }: { ov: CatalogOverview | undefined; onNew: () => void; onOpenRow: (r: CatalogRow) => void }) {
  const stats: WorkStats | undefined = ov?.internal;
  return (
    <div className="flex flex-col gap-[16px]">
      <p className="m-0 text-ds-label text-ds-fg-muted">Your own controls, authored from the risk register: your first line of defence, apart from framework requirements.</p>
      {stats && <KpiTiles stats={stats} />}
      <PagedRegister
        caption="Internal controls"
        scopeKey={['internal']}
        buildQuery={(p, s) => internalQuery(p, s)}
        showDomain={false}
        onOpen={onOpenRow}
        empty={<EmptyState kind="firstUse" bare icon={Boxes} title="No internal controls yet" description="Author your first internal control from your risk register." action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onNew}>New internal control</Button>} />}
      />
    </div>
  );
}
