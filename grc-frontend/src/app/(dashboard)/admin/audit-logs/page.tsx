'use client';

export const dynamic = 'force-dynamic';

// Administration > Audit log: who did what, where and when, across the platform. A register whose filters live on the server (the log is append-only and large), kept in the
// address so a link, a reload and Back land where the person was: Person, Module, Sub-module, Action and Dates. A row opens in a Sheet that says what happened in a sentence,
// what changed old -> new in words, and keeps the technical details behind a control (AuditSheet). The filtered set can be exported as CSV (up to 5,000 rows, said so).
// The rules (filters, request, module placement, CSV) are auditModel.ts. A late answer for an older filter never replaces a newer one (the query is keyed by the filter).
import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { apiClient, adminApi } from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { auditAction } from '@/lib/statuses/adminAuditAi';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, Notice, Pager, PersonChip, RegisterTable, Select, StatusPill, TextInput, useAddressState, useNotify,
  type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { rowCountText } from '@/components/ui/ds/tableModel';
import { AuditSheet } from './AuditSheet';
import {
  activeFilterCount, AUDIT_SCHEMA, auditCsv, deriveModuleContext, enrichDescription, EXPORT_CAP, EXPORT_PAGE, exportFileName, exportPlan, filterKey, PAGE_SIZE, personOptions,
  PRESETS, queryOf, uniqueRows, type AuditFilters, type AuditLogEntry, type PresetKey,
} from './auditModel';

const PAGE = 'flex flex-col gap-[16px]';
const BAR = 'flex flex-wrap items-center gap-[8px]';
const NOUN = { one: 'record', other: 'records' } as const;

interface Page { logs: AuditLogEntry[]; total: number }
interface FilterLists { actions: string[]; modules: string[]; submodules?: Record<string, string[]> }

export default function AuditLogPage() {
  const notify = useNotify();
  const [state, set] = useAddressState(AUDIT_SCHEMA);
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const now = useRef(new Date());                                 // the days the presets stand for are the days of this visit; reload to move on

  const filters: AuditFilters = state;
  const query = useMemo(() => queryOf(filters, now.current), [filters]);

  const log = useQuery({
    queryKey: ['admin-audit-logs', filterKey(query)],
    queryFn: async ({ signal }) => (await apiClient.get<Page>('/admin/audit-logs', { params: query, signal })).data,
    placeholderData: keepPreviousData,
  });
  const lists = useQuery({
    queryKey: ['admin-audit-filters'],
    queryFn: async () => (await adminApi.getAuditLogFilters()).data as FilterLists,
    staleTime: 300_000,
  });
  // whom the log can be narrowed to: the users this viewer may list; a viewer who may not list users still gets the people on the page (personOptions)
  const users = useQuery({
    queryKey: ['admin-audit-people'],
    queryFn: async () => (await adminApi.getUsers()).data as Array<{ id: number; display_name?: string | null; username?: string | null }>,
    staleTime: 300_000,
    retry: false,
  });

  const rows = log.data?.logs ?? [];
  const total = log.data?.total ?? 0;
  const people = useMemo(() => personOptions(Array.isArray(users.data) ? users.data : [], rows), [users.data, rows]);
  const subs = (filters.module && lists.data?.submodules?.[filters.module]) || [];
  const narrowed = activeFilterCount(filters);
  const failure = log.isError ? { message: errorMessage(log.error, 'The audit log could not be loaded.'), onRetry: canRetry(log.error) ? () => { void log.refetch(); } : undefined } : null;

  const pick = (patch: Partial<AuditFilters>) => set({ ...patch, page: 1 });
  const clear = () => set({ action: '', module: '', submodule: '', person: '', range: 'all', from: '', to: '', page: 1 });

  const runExport = async () => {
    const plan = exportPlan(total);
    if (plan.rows === 0 || exporting) return;
    setExporting(true);
    try {
      const got: AuditLogEntry[] = [];
      for (let i = 0; i < plan.requests; i += 1) {
        const page = (await apiClient.get<Page>('/admin/audit-logs', { params: queryOf(filters, now.current, { limit: EXPORT_PAGE, offset: i * EXPORT_PAGE }) })).data;
        got.push(...page.logs);
        if (page.logs.length < EXPORT_PAGE) break;
      }
      const unique = uniqueRows(got).slice(0, plan.rows);
      const url = URL.createObjectURL(new Blob([auditCsv(unique)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = exportFileName(new Date()); document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify.success(plan.capped ? `Saved the newest ${formatCount(unique.length)} of ${formatCount(total)} records. Narrow the filters to export the rest.`
        : `Saved ${formatCount(unique.length)} ${unique.length === 1 ? 'record' : 'records'}`);
    } catch (e) {
      notify.error(e, { title: 'The export did not finish', fallback: 'Nothing was saved. Try again.', retry: canRetry(e) ? () => { void runExport(); } : undefined });
    } finally {
      setExporting(false);
    }
  };

  const columns: RegisterColumn<AuditLogEntry>[] = [
    { key: 'when', header: 'When', card: 'meta', cell: (l) => <span className="whitespace-nowrap text-ds-body text-ds-fg">{formatDateTime(l.timestamp)}</span> },
    { key: 'who', header: 'Who', card: 'meta', cell: (l) => <PersonChip name={l.user_name} emptyLabel="Unknown person" /> },
    { key: 'action', header: 'What was done', card: 'meta', cell: (l) => <StatusPill size="sm" {...statusPill(auditAction, l.action)} /> },
    {
      key: 'module', header: 'Where', priority: 2, card: 'meta',
      cell: (l) => {
        const ctx = deriveModuleContext(l);
        return (
          <span className="block min-w-0 max-w-[200px]">
            <span className="block truncate text-ds-body text-ds-fg" title={ctx.module}>{ctx.module}</span>
            {ctx.submodule && <span className="block truncate text-ds-label text-ds-fg-muted" title={ctx.submodule}>{ctx.submodule}</span>}
          </span>
        );
      },
      cardCell: (l) => { const ctx = deriveModuleContext(l); return ctx.submodule ? `${ctx.module} › ${ctx.submodule}` : ctx.module; },
    },
    { key: 'what', header: 'What happened', isRowHeader: true, cell: (l) => <span className="line-clamp-2 min-w-[220px] text-ds-body text-ds-fg" title={enrichDescription(l)}>{enrichDescription(l)}</span> },
  ];

  const none = rows.length === 0 && !log.isLoading;
  return (
    <div className={PAGE}>
      <PageHeader
        variant="page"
        title="Audit log"
        info="A record of what people do on the platform: who did what, where, and when. Entries cannot be edited or removed."
        meta={log.data ? `${formatCount(total)} ${total === 1 ? 'record' : 'records'}${narrowed ? ' match' : ''}` : undefined}
        actions={(
          <Button leftIcon={<Download aria-hidden />} loading={exporting} disabled={!log.data || total === 0} onClick={() => { void runExport(); }}>
            Export CSV
          </Button>
        )}
      />

      <div className={BAR} role="group" aria-label="Filter the audit log">
        <Select aria-label="Person" className="w-[200px]" value={filters.person} onChange={(e) => pick({ person: e.target.value })}>
          <option value="">All people</option>
          {people.map((p) => <option key={p.id} value={String(p.id)}>{p.label}</option>)}
          {filters.person && !people.some((p) => String(p.id) === filters.person) && <option value={filters.person}>Person {filters.person}</option>}
        </Select>
        <Select aria-label="Module" className="w-[200px]" value={filters.module} onChange={(e) => pick({ module: e.target.value, submodule: '' })}>
          <option value="">All modules</option>
          {(lists.data?.modules ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          {filters.module && !(lists.data?.modules ?? []).includes(filters.module) && <option value={filters.module}>{filters.module}</option>}
        </Select>
        {subs.length > 0 && (
          <Select aria-label="Sub-module" className="w-[200px]" value={filters.submodule} onChange={(e) => pick({ submodule: e.target.value })}>
            <option value="">All sub-modules</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
        <Select aria-label="What was done" className="w-[170px]" value={filters.action} onChange={(e) => pick({ action: e.target.value })}>
          <option value="">Any action</option>
          {(lists.data?.actions ?? []).map((a) => <option key={a} value={a}>{auditAction.label(a)}</option>)}
          {filters.action && !(lists.data?.actions ?? []).includes(filters.action) && <option value={filters.action}>{auditAction.label(filters.action)}</option>}
        </Select>
        <Select aria-label="Dates" className="w-[160px]" value={filters.from || filters.to ? 'custom' : filters.range} onChange={(e) => pick({ range: e.target.value as PresetKey, from: '', to: '' })}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          {(filters.from || filters.to) && <option value="custom">Chosen days</option>}
        </Select>
        <TextInput type="date" aria-label="From day" className="w-[150px]" value={filters.from} max={filters.to || undefined} onChange={(e) => pick({ from: e.target.value, range: 'all' })} />
        <TextInput type="date" aria-label="To day" className="w-[150px]" value={filters.to} min={filters.from || undefined} onChange={(e) => pick({ to: e.target.value, range: 'all' })} />
        {narrowed > 0 && <Button variant="link" onClick={clear}>Clear filters</Button>}
      </div>

      {lists.isError && (
        <Notice tone="warning" title="Some filters could not be loaded" action={<Button size="sm" onClick={() => { void lists.refetch(); }}>Try again</Button>}>
          The lists of modules and actions did not arrive. The log below is still complete.
        </Notice>
      )}
      {log.isFetching && !log.isLoading && !log.isError && <p className="sr-only" role="status">Updating the audit log</p>}

      <RegisterTable
        caption="Audit log"
        columns={columns}
        rows={rows}
        getRowId={(l) => l.id}
        selectedId={open?.id ?? null}
        onRowActivate={setOpen}
        cardTitle={(l) => <span className="line-clamp-3 text-ds-body font-[600] text-ds-fg">{enrichDescription(l)}</span>}
        loading={log.isLoading}
        error={failure}
        empty={none && (
          <EmptyState
            bare
            kind={narrowed ? 'noMatches' : 'firstUse'}
            title={narrowed ? 'No record matches these filters' : 'Nothing has been recorded yet'}
            description={narrowed ? 'Widen the dates or clear a filter.' : 'What people do on the platform appears here as it happens.'}
            onClearFilters={narrowed ? clear : undefined}
          />
        )}
        footer={log.data ? (
          <div className="flex flex-col gap-[8px]">
            {total > PAGE_SIZE ? (
              <Pager page={filters.page} pageSize={PAGE_SIZE} total={total} onPage={(page) => set({ page })} noun={NOUN} />
            ) : (
              <span className="text-ds-body text-ds-fg-muted">{rowCountText({ shown: rows.length, total, noun: NOUN.one, plural: NOUN.other })}</span>
            )}
            {total > EXPORT_CAP && <span className="text-ds-label text-ds-fg-muted">An export saves the newest {formatCount(EXPORT_CAP)} records. Narrow the filters to export fewer.</span>}
          </div>
        ) : undefined}
      />

      <AuditSheet log={open} onClose={() => setOpen(null)} />
    </div>
  );
}
