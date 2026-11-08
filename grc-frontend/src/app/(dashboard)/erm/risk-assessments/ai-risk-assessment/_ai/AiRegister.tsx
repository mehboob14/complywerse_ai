'use client';

/**
 * Risk Management > Risk Assessments > AI System Risks. A register of the risks of the organisation's OWN AI and ML systems (a chatbot, a fraud model): what the system is, what could go
 * wrong, how likely and how bad, the controls and the plan, who owns it and when it is next reviewed. It is NOT an AI that assesses risks, which is what the old name, "AI Risk Assessment",
 * suggested; the AI here only drafts a mitigation plan, controls and a score for one entry, and says when it was the rules instead.
 *
 * The list is the kit's table (a card each on a phone) with counters that filter (not closed, high or critical, review overdue, a suggestion to check), a search and the category and status.
 * The score is on the area's one band system. A failed load is an error with Retry (the old page said "No AI risk entries"). The template and the workbook upload stay.
 */
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Download, FileSpreadsheet, Link2, Plus, Sparkles, Trash2, Upload, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, FilterChips, Menu, Notice, Pager, PersonChip, Select, SkeletonRows, StatusPill, TextInput, useAddressState, useConfirm, useNotify, useReportedMutation,
  type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { RecordTable, RowLead, type RecordColumn, type RecordItem, type RecordRow } from '@/components/records/RecordTable';
import { aiRiskAssessmentApi } from '@/lib/api';
import { authedFetch } from '@/lib/auth-fetch';
import { EMPTY, formatCount, formatDate, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { aiEntryStatus, residualWord } from '@/lib/statuses/riskAssessments';
import { riskLevel } from '@/lib/statuses/risk';
import { failureWords } from '../../../risks/_register/riskData';
import { useAssessmentRights } from '../../_register/assessmentData';
import { AiDrawer } from './AiDrawer';
import {
  AI_SCHEMA, CATEGORIES, NO_AI_FILTERS, QUICK_IDS, QUICK_LABEL, STATUSES, filterCount, filterEntries, filtersOf, filtersPatch, inQuick, isOverdue, isoToday, levelOf, nextSort, openIdOf, scoreOf, sortEntries,
  type AiAddress, type AiEntry, type SortKey,
} from './aiModel';

const KEY = ['ai-risk-assessment-entries'] as const;
const PAGE_SIZES = [25, 50, 100] as const;

const name = (e: AiEntry): string => e.ai_system_use_case?.trim() || e.risk_description?.trim() || 'An AI system';

function Score({ e }: { e: AiEntry }) {
  const s = scoreOf(e);
  if (s == null) return <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">Not scored</span></span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
      <StatusPill size="sm" {...statusPill(riskLevel, levelOf(e))} />
      <span className="whitespace-nowrap text-ds-label tabular-nums text-ds-fg-muted" title={`Likelihood ${e.likelihood ?? EMPTY}, impact ${e.impact ?? EMPTY}`}>{e.likelihood ?? EMPTY} × {e.impact ?? EMPTY} = {s}</span>
    </span>
  );
}

export function AiRegister() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { canWrite } = useAssessmentRights();
  const file = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useAddressState(AI_SCHEMA);
  const filters = filtersOf(address as AiAddress);
  const sort = (address as AiAddress).sort;
  const openId = openIdOf(address as AiAddress);
  const creating = (address as AiAddress).new;
  const today = isoToday();

  const list = useQuery({ queryKey: [...KEY], queryFn: async () => (await aiRiskAssessmentApi.list()).data as unknown as AiEntry[], retry: (n, e) => n < 3 && canRetry(e) });
  const people = useQuery({ queryKey: ['ai-risk-assessment-tenant-users'], queryFn: async () => (await aiRiskAssessmentApi.getTenantUsers()).data, staleTime: 5 * 60_000 });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const noList = list.isError && !list.data;
  const filtered = useMemo(() => filterEntries(rows, filters, today), [rows, filters, today]);   // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortEntries(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${filtered.length}|${sort.key}${sort.dir}|${pageSize}|${JSON.stringify(filters)}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pageClamped = Math.min(Math.max(1, pageNo), Math.max(1, Math.ceil(sorted.length / pageSize)));
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);
  const openEntry = openId ? rows.find((r) => r.id === openId) ?? null : null;
  const refresh = () => { void qc.invalidateQueries({ queryKey: [...KEY] }); void qc.invalidateQueries({ queryKey: ['erm-sections-overview'] }); };

  const setFilters = (f: typeof NO_AI_FILTERS) => setAddress(filtersPatch(f));
  const counts = useMemo(() => Object.fromEntries(QUICK_IDS.map((id) => [id, rows.filter((r) => inQuick(id, r, today)).length])) as Record<string, number>, [rows, today]);
  const chips: FilterChip[] = QUICK_IDS.map((id) => ({ key: id, label: QUICK_LABEL[id], count: counts[id], active: filters.quick === id }));

  const remove = useReportedMutation({
    mutationFn: (e: AiEntry) => aiRiskAssessmentApi.delete(e.id),
    success: { title: 'AI system risk deleted', message: 'A risk already added to the Risk Register stays there.' },
    failure: "Couldn't delete the AI system risk",
    invalidate: [[...KEY], ['erm-sections-overview']],
    onSuccess: (_d, e) => { if (openId === e.id) setAddress({ open: '' }); },
  });
  const bridge = useReportedMutation({
    mutationFn: (e: AiEntry) => aiRiskAssessmentApi.bridgeToRisk(e.id),
    success: (_d, e) => ({ title: 'Added to the Risk Register', message: `“${truncate(name(e), 60).text}” is there as a risk. Open it from its row.` }),
    failure: "Couldn't add it to the Risk Register",
    invalidate: [[...KEY], ['erm-risks-lean'], ['erm-risks-dashboard']],
  });
  const askDelete = async (e: AiEntry) => {
    if (await confirm({ title: `Delete “${truncate(name(e), 80).text}”?`, message: `${e.bridged_risk_id ? 'The risk already added to the Risk Register stays there. ' : ''}Its suggestion and evidence links go with it. It cannot be undone.`, confirmLabel: 'Delete', tone: 'danger' })) remove.mutate(e);
  };
  const askBridge = async (e: AiEntry) => {
    if (await confirm({ title: 'Add this AI system risk to the Risk Register?', message: 'A risk is created from it (its description, category, scores and status) and the two stay linked. You can edit the risk there. Doing it again does not make a second one.', confirmLabel: 'Add to the register' })) bridge.mutate(e);
  };

  // ── the workbook and the template ──
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{ imported: number; errors: Array<{ row: number }>; file: string } | null>(null);
  const [uploadFailure, setUploadFailure] = useState<string | null>(null);
  const upload = async (f: File) => {
    setUploading(true); setUploaded(null); setUploadFailure(null);
    try {
      const r = (await aiRiskAssessmentApi.upload(f)).data;
      setUploaded({ imported: r.summary.imported_count, errors: r.errors, file: r.summary.file_name });
      refresh();
      notify.success(`${formatCount(r.summary.imported_count)} ${r.summary.imported_count === 1 ? 'entry' : 'entries'} imported.`, { title: 'Workbook imported' });
    } catch (e) { setUploadFailure(errorMessage(e, 'The workbook could not be imported.')); } finally { setUploading(false); if (file.current) file.current.value = ''; }
  };
  const template = async () => {
    try {
      const res = await authedFetch(aiRiskAssessmentApi.templateUrl());
      if (!res.ok) throw new Error('refused');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = 'ai_system_risks_template.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { notify.error('The template could not be downloaded.', { title: 'Download failed', retry: () => { void template(); } }); }
  };

  // ── rows ──
  const columns: RecordColumn<AiEntry>[] = useMemo(() => [
    { key: 'name', header: 'AI system', sortKey: 'name', cell: (row: RecordRow<AiEntry>) => (
      <RowLead row={row}>
        <div className="min-w-0">
          <button type="button" onClick={() => setAddress({ open: String(row.record.id) })} title={name(row.record)} className="block max-w-full rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
            <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere] hover:text-ds-primary-text hover:underline">{name(row.record)}</span>
          </button>
          <p className="m-0 line-clamp-1 text-ds-label text-ds-fg-muted">{[row.record.risk_id_external, row.record.risk_description].filter(Boolean).join(' · ')}</p>
        </div>
      </RowLead>
    ) },
    { key: 'category', header: 'Category', fit: { px: 150, dropRank: 3 }, cell: (row) => <span className="line-clamp-2 text-ds-body text-ds-fg-body">{row.record.risk_category || EMPTY}</span> },
    { key: 'score', header: 'Score', sortKey: 'score', firstDir: 'desc', fit: { px: 190 }, cell: (row) => <Score e={row.record} /> },
    { key: 'residual', header: 'Residual', fit: { px: 100, dropRank: 2 }, cell: (row) => (row.record.residual_risk_level ? <StatusPill size="sm" {...statusPill(residualWord, row.record.residual_risk_level)} /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'owner', header: 'Owner', fit: { px: 68, dropRank: 4, wide: { px: 160, titleMin: 420 } }, cell: (row, look) => (row.record.risk_owner ? (look.wide ? <PersonChip name={row.record.risk_owner} /> : <span className="inline-flex" title={`Owner: ${row.record.risk_owner}`}><PersonChip name={row.record.risk_owner} className="[&>span:last-child]:sr-only" /></span>) : <span className="text-ds-body text-ds-fg-muted">{EMPTY}<span className="sr-only">No owner</span></span>) },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 150 }, cell: (row) => (
      <span className="flex flex-col items-start gap-[2px]">
        <StatusPill size="sm" {...statusPill(aiEntryStatus, row.record.status || 'Open')} />
        {isOverdue(row.record, today) && <span className="text-ds-label font-[600] text-ds-danger">Review overdue</span>}
        {row.record.bridged_risk_id && <Link href={`/erm/risks/${row.record.bridged_risk_id}`} className="inline-flex items-center gap-[2px] rounded-ds-control text-ds-label text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring"><Link2 aria-hidden className="h-[12px] w-[12px]" />In the Risk Register</Link>}
      </span>
    ) },
  ], [setAddress, today]);   // eslint-disable-line react-hooks/exhaustive-deps
  const items: RecordItem<AiEntry>[] = pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 }));
  const rowMenu = (e: AiEntry) => {
    const entries: MenuItem[] = [
      { key: 'open', label: 'Open', icon: Eye, onSelect: () => setAddress({ open: String(e.id) }) },
      { key: 'bridge', label: 'Add to the Risk Register', icon: Link2, hidden: !canWrite || !!e.bridged_risk_id, onSelect: () => { void askBridge(e); } },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canWrite, onSelect: () => { void askDelete(e); } },
    ];
    return <Menu label={`Actions for ${truncate(name(e), 60).text}`} iconOnly items={entries} />;
  };
  const label = routeFor('/erm/risk-assessments/ai-risk-assessment')?.label ?? 'AI System Risks';

  const body = (() => {
    if (noList) return <ErrorState {...failureWords(list.error, 'the AI system risks')} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />;
    if (list.isPending) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the AI system risks" /></div>;
    if (rows.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="firstUse" bare icon={Bot} title="No AI system risks yet" description="Record what could go wrong with each AI or ML system the organisation runs, or import the template workbook."
            action={canWrite ? <span className="flex flex-wrap justify-center gap-[8px]"><Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAddress({ new: true })}>New AI system risk</Button><Button leftIcon={<Upload aria-hidden />} onClick={() => file.current?.click()}>Import the template</Button></span> : undefined} />
        </div>
      );
    }
    if (filtered.length === 0) return <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind="noMatches" bare title="No AI system risks match" description="Loosen a filter, or search for other words." onClearFilters={() => setFilters(NO_AI_FILTERS)} /></div>;
    return (
      <>
        <RecordTable
          caption="AI system risks"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setAddress({ sort: nextSort(sort, key as SortKey) })}
          activeId={openEntry?.id ?? null}
          onActivate={(e) => setAddress({ open: String(e.id) })}
          actions={rowMenu}
          card={(row) => (
            <div className="flex min-w-0 flex-col gap-[4px]">
              <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{name(row.record)}</span>
              <span className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px]"><Score e={row.record} /><StatusPill size="sm" {...statusPill(aiEntryStatus, row.record.status || 'Open')} />{isOverdue(row.record, today) && <span className="text-ds-label font-[600] text-ds-danger">Review overdue</span>}</span>
            </div>
          )}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={{ one: 'AI system risk', other: 'AI system risks' }} />
      </>
    );
  })();

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={label}
        info="The risks of the AI and ML systems the organisation runs: what could go wrong, how likely and how bad, the controls and the plan. The AI can draft a plan for one entry; it does not assess anything by itself."
        meta={noList || list.isPending ? undefined : `${formatCount(rows.length)} ${rows.length === 1 ? 'AI system risk' : 'AI system risks'}`}
        actions={(
          <>
            <input ref={file} type="file" accept=".xlsx,.xls" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <Button leftIcon={<Download aria-hidden />} onClick={() => { void template(); }}>Template</Button>
            {canWrite && <Button leftIcon={<FileSpreadsheet aria-hidden />} loading={uploading} onClick={() => file.current?.click()}>Import</Button>}
            {canWrite && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAddress({ new: true })}>New AI system risk</Button>}
          </>
        )}
      />

      {uploadFailure && <Notice tone="danger" title="The workbook was not imported">{uploadFailure}</Notice>}
      {uploaded && (
        <Notice tone={uploaded.errors.length ? 'warning' : 'info'} title={`${formatCount(uploaded.imported)} ${uploaded.imported === 1 ? 'entry' : 'entries'} imported from ${uploaded.file}`} action={<Button variant="ghost" onClick={() => setUploaded(null)}>Dismiss</Button>}>
          {uploaded.errors.length > 0 ? `${formatCount(uploaded.errors.length)} ${uploaded.errors.length === 1 ? 'row' : 'rows'} could not be read: ${uploaded.errors.slice(0, 8).map((x) => `row ${x.row}`).join(', ')}${uploaded.errors.length > 8 ? ' and more' : ''}.` : 'Every row was read.'}
        </Notice>
      )}
      {list.isError && !noList && <ErrorState compact title="Couldn't refresh the list" message={`${errorMessage(list.error)} What is shown may be out of date.`} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}

      {!noList && !list.isPending && rows.length > 0 && (
        <>
          <FilterChips label="Counters" chips={chips} onToggle={(k) => setFilters({ ...filters, quick: filters.quick === k || k === 'all' ? 'all' : (k as typeof filters.quick) })} />
          <div role="search" aria-label="Search the AI system risks" className="flex flex-wrap items-center gap-[8px]">
            <TextInput type="search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} aria-label="Search by system, description, owner or reference" placeholder="Search AI system risks" autoComplete="off" className="min-w-[160px] max-w-[360px] flex-1" />
            <Select aria-label="Category" placeholder="All categories" className="w-[190px]" value={filters.category[0] ?? ''} onChange={(e) => setFilters({ ...filters, category: e.target.value ? [e.target.value] : [] })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <Select aria-label="Status" placeholder="All statuses" className="w-[160px]" value={filters.status[0] ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value ? [e.target.value] : [] })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
            {filterCount(filters) > 0 && <Button variant="link" onClick={() => setFilters(NO_AI_FILTERS)}>Clear filters</Button>}
            <span className="ml-auto text-ds-body text-ds-fg-muted">{formatCount(filtered.length)} of {formatCount(rows.length)}</span>
          </div>
        </>
      )}

      {body}

      <AiDrawer
        entry={openEntry}
        creating={creating}
        people={people.data ?? []}
        canWrite={canWrite}
        onClose={() => setAddress({ open: '', new: false })}
        onSaved={(e) => { refresh(); setAddress({ new: false, open: e && creating ? String(e.id) : '' }); }}
        refresh={refresh}
      />
      {confirmDialog}
    </div>
  );
}
