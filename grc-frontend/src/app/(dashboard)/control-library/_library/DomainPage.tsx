'use client';

// A control domain of the Library (/control-library/[id]): the controls the frameworks bring to one topic, as normalized sets (the same requirement shared by several frameworks), standalone controls
// (unique to one framework) and, framework by framework, every control that sits here. "Build your view" scopes it to some frameworks (?fw=A,B, carried over from the library); the figures follow it.
// What is on screen is domainModel.ts; a set opens in a Sheet (SetSheet).
import { useId, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileStack, FileText, GitMerge, Library, Shield } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  AccordionRow, ChipList, DebouncedSearch, EmptyState, ErrorState, MultiSelect, Pager, RegisterTable, SegmentedControl, Select, SkeletonRows, StatTile, TabPanel, Tabs, useAddressState,
  type RegisterColumn,
} from '@/components/ui/ds';
import { listOf } from '@/lib/addressState';
import apiClient from '@/lib/api';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { frameworkChoices, membersOfPicked, searchFw, searchSets, searchStandalone, setFrameworks, viewOf, type Rich, type SetT } from './domainModel';
import { SetSheet } from './SetSheet';

const SCHEMA = { fw: listOf() };
const TABS = ['sets', 'standalone', 'byframework'] as const;
type TabKey = (typeof TABS)[number];
const SIZES = [12, 24, 48, 96] as const;

function SetCard({ s, picked, onOpen }: { s: SetT; picked: readonly string[]; onOpen: () => void }) {
  const fws = setFrameworks(s, picked);
  return (
    <button type="button" onClick={onOpen} className="flex h-full min-h-[44px] w-full flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
      <span className="flex items-center justify-between gap-[8px] text-ds-label text-ds-fg-muted">
        <span className="inline-flex items-center gap-[4px] font-[600] text-ds-primary-text"><GitMerge aria-hidden className="h-[12px] w-[12px]" />Normalized</span>
        <span className="tabular-nums">{picked.length ? `${formatCount(membersOfPicked(s, picked))} of ${formatCount(s.member_count)}` : `${formatCount(s.member_count)} frameworks`}</span>
      </span>
      <span className="line-clamp-3 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.normalized_title}</span>
      <span className="text-ds-label text-ds-fg-body">{fws.slice(0, 6).join(' · ')}{fws.length > 6 ? ` · +${fws.length - 6}` : ''}</span>
      <span className="mt-auto flex gap-[16px] border-t border-ds-border pt-[8px] text-ds-label tabular-nums text-ds-fg-muted">
        <span className="inline-flex items-center gap-[4px]"><FileText aria-hidden className="h-[12px] w-[12px]" />{`${formatCount(s.normalized_evidence.length)} evidence`}</span>
        <span className="inline-flex items-center gap-[4px]"><FileStack aria-hidden className="h-[12px] w-[12px]" />{`${formatCount(s.normalized_artifacts.length)} artifacts`}</span>
      </span>
    </button>
  );
}

function Controls({ items, empty }: { items: Array<{ key: string; code: string; title: string; note: string | null; onOpen?: () => void }>; empty: string }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  if (items.length === 0) return <p className="m-0 rounded-ds-card border border-dashed border-ds-border p-[12px] text-ds-body text-ds-fg-muted">{empty}</p>;
  const shown = items.slice((Math.min(page, Math.ceil(items.length / size)) - 1) * size, Math.min(page, Math.ceil(items.length / size)) * size);
  return (
    <div className="flex flex-col gap-[8px]">
      <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
        {shown.map((c) => {
          const inner = (
            <>
              <span className="flex flex-wrap items-center gap-[8px]">
                <span className="rounded-ds-control bg-ds-surface-hover px-[6px] font-mono text-ds-label text-ds-fg-body">{c.code}</span>
                {c.note && <span className="text-ds-label text-ds-fg-muted">{c.note}</span>}
              </span>
              <span className="mt-[4px] block text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.title}</span>
            </>
          );
          return (
            <li key={c.key}>
              {c.onOpen
                ? <button type="button" onClick={c.onOpen} className="block min-h-[44px] w-full rounded-ds-card border border-ds-border bg-ds-surface p-[12px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">{inner}</button>
                : <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">{inner}</div>}
            </li>
          );
        })}
      </ul>
      <Pager page={Math.min(page, Math.ceil(items.length / size))} pageSize={size} total={items.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} pageSizes={[25, 50, 100]} noun={{ one: 'control', other: 'controls' }} />
    </div>
  );
}

export function DomainPage() {
  const params = useParams();
  const id = params?.id as string;
  const uid = useId();
  const [address, setAddress] = useAddressState(SCHEMA);
  const picked = address.fw;
  const [tab, setTab] = useState<TabKey>('sets');
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<'grid' | 'table'>('grid');
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(24);
  const [openSet, setOpenSet] = useState<SetT | null>(null);
  const [stdFw, setStdFw] = useState('');
  const [byFwPick, setByFwPick] = useState('');

  const rich = useQuery({ queryKey: ['control-group-rich', id], enabled: !!id, retry: (failures, e) => failures < 2 && canRetry(e), queryFn: async () => (await apiClient.get(`/control-library/groups/${id}/rich`)).data as Rich });
  const data = rich.data;
  const view = useMemo(() => (data ? viewOf(data, picked) : null), [data, picked]);
  const choices = useMemo(() => (data ? frameworkChoices(data) : { all: [], absent: [] }), [data]);

  if (rich.isError && !data) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Control domain" back={{ href: '/control-library', label: 'All control domains' }} />
        <ErrorState title="Couldn’t load this domain" message={errorMessage(rich.error)} onRetry={canRetry(rich.error) ? () => { void rich.refetch(); } : undefined} />
      </div>
    );
  }
  if (!data || !view) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Control domain" back={{ href: '/control-library', label: 'All control domains' }} />
        <SkeletonRows rows={8} columns={3} label="Loading the domain" />
      </div>
    );
  }

  const fwTotal = data.framework_count + (data.absent_frameworks?.length ?? 0);
  const sets = searchSets(view.sets, q);
  const pages = Math.max(1, Math.ceil(sets.length / pageSize));
  const pageSets = sets.slice((Math.min(pageNo, pages) - 1) * pageSize, Math.min(pageNo, pages) * pageSize);
  const stdFwActive = view.standaloneByFw.some(([f]) => f === stdFw) ? stdFw : (view.standaloneByFw[0]?.[0] ?? '');
  const stdList = searchStandalone(view.standaloneByFw.find(([f]) => f === stdFwActive)?.[1] ?? [], q);
  const byFwActive = view.byFw.some(([f]) => f === byFwPick) ? byFwPick : (view.byFw[0]?.[0] ?? '');
  const byFwList = searchFw(view.byFw.find(([f]) => f === byFwActive)?.[1] ?? [], q);
  const fwAll = view.byFw.find(([f]) => f === byFwActive)?.[1] ?? [];
  const inSets = fwAll.filter((c) => c.set).length;
  const setByTitle = (title: string | null) => (title ? data.sets.find((s) => s.normalized_title === title) ?? null : null);

  const setColumns: RegisterColumn<SetT>[] = [
    { key: 'title', header: 'Normalized requirement', isRowHeader: true, cell: (s) => <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.normalized_title}</span> },
    { key: 'fws', header: 'Frameworks', priority: 2, card: 'meta', cell: (s) => { const f = setFrameworks(s, picked); return <span className="text-ds-label text-ds-fg-body">{f.slice(0, 5).join(' · ')}{f.length > 5 ? ` · +${f.length - 5}` : ''}</span>; } },
    { key: 'n', header: picked.length ? 'In your view' : 'Frameworks', align: 'right', card: 'meta', cardLabel: 'Frameworks', cell: (s) => <span className="tabular-nums text-ds-body">{picked.length ? `${membersOfPicked(s, picked)}/${s.member_count}` : formatCount(s.member_count)}</span> },
    { key: 'ev', header: 'Evidence', priority: 3, align: 'right', card: 'meta', cell: (s) => <span className="tabular-nums text-ds-body">{formatCount(s.normalized_evidence.length)}</span> },
    { key: 'art', header: 'Artifacts', priority: 3, align: 'right', card: 'meta', cell: (s) => <span className="tabular-nums text-ds-body">{formatCount(s.normalized_artifacts.length)}</span> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={data.domain}
        back={{ href: '/control-library', label: 'All control domains' }}
        info={`${data.controls_in} controls from ${data.framework_count} frameworks are grouped under this domain: ${data.normalized_sets} requirements normalized across frameworks, ${data.standalone} unique to a single framework.`}
        meta={view.filterOn ? `Filtered to ${formatCount(picked.length)} ${picked.length === 1 ? 'framework' : 'frameworks'} · ${formatCount(view.sets.length)} sets · ${formatCount(view.standalone.length)} standalone` : undefined}
        chips={<ChipList items={view.bannerFrameworks.map((f) => f)} label="Frameworks in this domain" shown={6} />}
      />

      <div className="grid grid-cols-2 gap-[12px] md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Controls grouped" value={formatCount(view.stats.controls)} note={view.filterOn ? `In your ${picked.length}-framework view` : 'Under this domain'} />
        <StatTile label="Frameworks represented" value={view.filterOn ? formatCount(Number(view.stats.frameworks)) : `${formatCount(data.framework_count)} of ${formatCount(fwTotal)}`} note={view.filterOn ? 'Selected frameworks here' : data.absent_frameworks.length > 0 ? `${formatCount(data.absent_frameworks.length)} have no controls of this type` : 'All frameworks represented'} />
        <StatTile label="Normalized sets" value={formatCount(view.stats.sets)} note="Same requirement, once" />
        <StatTile label="Standalone" value={formatCount(view.stats.standalone)} note="Unique to one framework" />
        <StatTile label="Normalized evidence" value={formatCount(view.stats.evidence)} note={view.filterOn ? 'In your view' : 'Across all sets'} />
        <StatTile label="Artifacts" value={formatCount(view.stats.artifacts)} note={view.filterOn ? 'In your view' : 'Across sets and standalone'} />
      </div>

      {!view.filterOn && choices.all.length > 0 && data.absent_frameworks.length > 0 && (
        <AccordionRow title="Framework coverage in this domain" lead={<Building2 aria-hidden className="h-[16px] w-[16px] text-ds-primary-text" />} meta={`${formatCount(data.framework_count)} of ${formatCount(fwTotal)} frameworks represented · ${formatCount(data.absent_frameworks.length)} not here`} region={false}>
          <div className="flex flex-col gap-[8px] p-[12px]">
            <p className="m-0 text-ds-label text-ds-fg-muted">{`The other ${formatCount(data.absent_frameworks.length)} have no ${data.domain.toLowerCase()}-type controls: that is not missing coverage, their controls live in the domains that match their control types.`}</p>
            <RegisterTable
              caption="Frameworks with no controls in this domain"
              columns={[
                { key: 'fw', header: 'Framework', isRowHeader: true, cell: (a) => <span className="text-ds-body font-[600] text-ds-fg">{a.fw}</span> },
                { key: 'n', header: 'Covered in', align: 'right', card: 'meta', cell: (a) => <span className="tabular-nums">{`${formatCount(a.n)} domains`}</span> },
                { key: 'where', header: 'Domains where its controls live', priority: 2, card: 'meta', cell: (a) => <span className="text-ds-label text-ds-fg-body">{a.where || '—'}</span> },
              ] satisfies RegisterColumn<{ fw: string; n: number; where: string }>[]}
              rows={data.absent_frameworks.slice().sort((a, b) => (b.present_in_count ?? 0) - (a.present_in_count ?? 0)).map((a) => ({ fw: a.name, n: a.present_in_count ?? 0, where: (a.present_in ?? []).join(', ') }))}
              getRowId={(a) => a.fw}
              cardTitle={(a) => <span className="text-ds-body font-[600] text-ds-fg">{a.fw}</span>}
            />
          </div>
        </AccordionRow>
      )}

      <div className="flex flex-wrap items-center gap-[8px]">
        <MultiSelect label="Frameworks" showLabel options={choices.all.map((f) => ({ value: f, label: f }))} value={picked} onChange={(next) => { setAddress({ fw: next }); setPageNo(1); }} placeholder="All frameworks" className="w-full sm:w-[260px]" />
        <DebouncedSearch label={tab === 'sets' ? 'Search sets or frameworks' : tab === 'standalone' ? 'Search standalone controls' : 'Search controls'} placeholder="Search" value={q} onSearch={(v) => { setQ(v); setPageNo(1); }} className="w-full sm:w-[240px]" />
        {tab === 'sets' && <SegmentedControl label="Layout" name={`${uid}-layout`} options={[{ value: 'grid', label: 'Cards' }, { value: 'table', label: 'Table' }]} value={layout} onChange={(v) => setLayout(v as 'grid' | 'table')} className="ml-auto" />}
      </div>

      <Tabs
        tabs={[{ key: 'sets', label: 'Normalized sets', count: view.sets.length }, { key: 'standalone', label: 'Standalone', count: view.standalone.length }, { key: 'byframework', label: 'By framework', count: view.byFw.length }]}
        value={tab}
        onChange={(k) => { setTab(k as TabKey); setPageNo(1); }}
        ariaLabel="Domain views"
        countFormat="exact"
      >
        <TabPanel tabKey="sets" className="pt-[16px]">
          {sets.length === 0 ? (
            <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind={q || view.filterOn ? 'noMatches' : 'firstUse'} bare icon={Library} title={q ? 'No sets match your search' : view.filterOn ? 'No normalized set involves the selected frameworks' : 'No cross-framework sets'} description={q ? 'Search for other words.' : view.filterOn ? 'Add more frameworks to your view.' : 'Every control here is unique to one framework.'} onClearFilters={q ? () => setQ('') : view.filterOn ? () => setAddress({ fw: [] }) : undefined} /></div>
          ) : (
            <div className="flex flex-col gap-[8px]">
              {layout === 'table'
                ? <RegisterTable caption="Normalized sets" columns={setColumns} rows={pageSets} getRowId={(s) => s.set_id} onRowActivate={setOpenSet} cardTitle={(s) => <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.normalized_title}</span>} />
                : <ul className="m-0 grid list-none grid-cols-1 gap-[12px] p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{pageSets.map((s) => <li key={s.set_id}><SetCard s={s} picked={picked} onOpen={() => setOpenSet(s)} /></li>)}</ul>}
              <Pager page={Math.min(pageNo, pages)} pageSize={pageSize} total={sets.length} onPage={setPageNo} onPageSize={(n) => { setPageSize(n); setPageNo(1); }} pageSizes={SIZES} noun={{ one: 'set', other: 'sets' }} />
            </div>
          )}
        </TabPanel>
        <TabPanel tabKey="standalone" lazy className="pt-[16px]">
          {view.standaloneByFw.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No standalone controls match the current view.</p> : (
            <div className="flex flex-col gap-[8px]">
              <Select aria-label="Framework" className="w-full sm:w-[320px]" value={stdFwActive} onChange={(e) => setStdFw(e.target.value)}>
                {view.standaloneByFw.map(([f, list]) => <option key={f} value={f}>{`${f} (${list.length})`}</option>)}
              </Select>
              <p className="m-0 text-ds-label text-ds-fg-muted">{`Only in ${stdFwActive}: no equivalent in any other framework, so they are grouped here and not normalized into a set. Open one for its evidence and artifacts, or to upload evidence.`}</p>
              <Controls
                items={stdList.map((s, i) => ({ key: `${s.set_id}-${i}`, code: s.members[0]?.control_id ?? '', title: s.members[0]?.original_title ?? '', note: `${formatCount(s.normalized_evidence?.length || 0)} evidence · ${formatCount(s.normalized_artifacts?.length || 0)} artifacts`, onOpen: () => setOpenSet(s) }))}
                empty="No standalone controls match your search."
              />
            </div>
          )}
        </TabPanel>
        <TabPanel tabKey="byframework" lazy className="pt-[16px]">
          {view.byFw.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No frameworks match the current view.</p> : (
            <div className="flex flex-col gap-[8px]">
              <Select aria-label="Framework" className="w-full sm:w-[320px]" value={byFwActive} onChange={(e) => setByFwPick(e.target.value)}>
                {view.byFw.map(([f, list]) => <option key={f} value={f}>{`${f} (${list.length})`}</option>)}
              </Select>
              <p className="m-0 text-ds-label text-ds-fg-muted">{`Every ${byFwActive} control grouped under ${data.domain}: ${formatCount(inSets)} are merged into a cross-framework set, ${formatCount(fwAll.length - inSets)} are unique to ${byFwActive}.`}</p>
              <Controls
                items={byFwList.map((c, i) => ({ key: `${c.control_id}-${i}`, code: c.control_id, title: c.title, note: c.set ? `In set: ${c.set}` : 'Standalone', onOpen: setByTitle(c.set) ? () => setOpenSet(setByTitle(c.set)) : undefined }))}
                empty="No controls match your search."
              />
            </div>
          )}
        </TabPanel>
      </Tabs>

      <SetSheet key={openSet?.set_id ?? 'none'} set={openSet} domain={data.domain} picked={picked} onClose={() => setOpenSet(null)} />
    </div>
  );
}
