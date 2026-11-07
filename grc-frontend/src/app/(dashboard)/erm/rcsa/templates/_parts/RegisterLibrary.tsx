'use client';

// The Registers half of the Templates library: the organisation's own Excel risk registers, each kept as a searchable list of items (the old "custom templates"). A row opens the register's
// workspace. Above the list, the items assigned to the person, each a link straight to that item. The server answers these routes only to people with the RCSA right: a refusal is said in
// words ("You don't have access to the registers") and is never drawn as an empty list. Uploading and deactivating are the risk team's.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Eye, FileUp, PowerOff } from 'lucide-react';
import { Button, ClampedText, EmptyState, ErrorState, Fact, FactList, Menu, NoAccessState, Notice, SectionCard, SidePanel, SkeletonRows, StatusPill, TitleLink, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { rcsaApi } from '@/lib/api';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { csvName, toCsv } from '@/lib/rcsa/csv';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { isForbidden, levelWord, retryUnlessRefused, scoreText } from '@/lib/rcsa/registerModel';
import { plural } from '@/lib/rcsa/templatesModel';
import { statusPill } from '@/lib/status';
import { registerLevel } from '@/lib/statuses/rcsa';
import { RcsaExplorer, type ExplorerFacet, type ExplorerQuick, type ExplorerSort } from '../../_parts/RcsaExplorer';
import { KEYS, useRcsaRights } from '../../_parts/rcsaData';
import { UploadRegisterSheet } from './LibrarySheets';
import { rowOf, uniqueOptions, type RenderHead } from './libraryShared';

export interface Register {
  id: number;
  name: string;
  description?: string | null;
  function_area?: string | null;
  original_filename?: string;
  sheet_name?: string | null;
  column_count: number;
  row_count: number;
  updated_at?: string;
}

interface Assigned {
  row_id: number;
  template_id: number;
  template_name: string;
  risk_id_text?: string | null;
  residual_overall_label?: string | null;
  residual_overall_score?: number | null;
  evidence_count: number;
  updated_at: string;
}

const AREA_NONE = 'No function area';
const areaOf = (r: Register): string => (r.function_area || '').trim() || AREA_NONE;

const FACETS: ExplorerFacet<Register>[] = [
  { key: 'area', label: 'Function area', values: (r) => [areaOf(r)], options: (rows) => uniqueOptions(rows, (r) => [areaOf(r)]), searchable: true, defaultOpen: true },
];
const QUICK: ExplorerQuick<Register>[] = [
  { key: 'filled', label: 'With items', test: (r) => r.row_count > 0 },
  { key: 'empty', label: 'No items yet', test: (r) => r.row_count === 0 },
];
const SORTS: ExplorerSort<Register>[] = [
  { key: 'name', value: (r) => r.name },
  { key: 'area', value: (r) => areaOf(r) },
  { key: 'items', value: (r) => r.row_count, firstDir: 'desc' },
  { key: 'updated', value: (r) => (r.updated_at ? new Date(r.updated_at.endsWith('Z') ? r.updated_at : `${r.updated_at}Z`).getTime() : null), firstDir: 'desc' },
];
const DEFAULT_SORT = { key: 'name', dir: 'asc' as const };

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

const COLUMNS: RecordColumn<Register>[] = [
  {
    key: 'name', header: 'Register', sortKey: 'name',
    cell: (row) => (
      <div className="flex min-w-0 flex-col gap-[2px]" onClick={stop}>
        <TitleLink href={`/erm/rcsa/custom-templates/${row.record.id}`} title={row.record.name} prefetch={false} />
        {row.record.description && <span dir="auto" title={row.record.description} className="line-clamp-1 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{row.record.description}</span>}
      </div>
    ),
  },
  { key: 'area', header: 'Function area', sortKey: 'area', fit: { px: 160, dropRank: 3 }, cell: (row) => <span className="line-clamp-2 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{areaOf(row.record)}</span> },
  { key: 'sheet', header: 'Sheet', fit: { px: 130, dropRank: 2 }, cell: (row) => <span className="line-clamp-1 text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{row.record.sheet_name || '—'}</span> },
  { key: 'columns', header: 'Columns', fit: { px: 92, dropRank: 1 }, cell: (row) => <span className="text-ds-body tabular-nums text-ds-fg">{formatCount(row.record.column_count)}</span> },
  { key: 'items', header: 'Items', sortKey: 'items', firstDir: 'desc', fit: { px: 92 }, cell: (row) => <span className="text-ds-body tabular-nums text-ds-fg">{formatCount(row.record.row_count)}</span> },
  { key: 'updated', header: 'Updated', sortKey: 'updated', firstDir: 'desc', fit: { px: 116 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-muted">{formatDate(row.record.updated_at)}</span> },
];

const card = (row: RecordRow<Register>) => (
  <div className="flex min-w-0 flex-col gap-[4px]">
    <span dir="auto" title={row.record.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.record.name}</span>
    <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px] text-ds-label text-ds-fg-muted">
      <span>{areaOf(row.record)}</span>
      <span>{plural(row.record.row_count, 'item')}</span>
    </span>
  </div>
);

const SHOWN = 5;

function AssignedToMe() {
  const q = useQuery({ queryKey: [...KEYS.registers, 'assigned'], retry: retryUnlessRefused, queryFn: async () => (await rcsaApi.customTemplates.listMyAssignments()).data as Assigned[] });
  const [all, setAll] = useState(false);
  if (q.isError && isForbidden(q.error)) return null;
  const items = q.data ?? [];
  const shown = all ? items : items.slice(0, SHOWN);
  // nothing assigned is the usual answer: one quiet line, not a card
  if (q.isSuccess && items.length === 0) return <p className="rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[10px] text-ds-body text-ds-fg-muted">Assigned to me: nothing is assigned to you.</p>;
  return (
    <SectionCard id="assigned-to-me" title="Assigned to me" meta={q.data ? plural(items.length, 'item') : undefined} info="Register items the risk team gave you to update. Open one to change its fields, add evidence or ask for an AI explanation.">
      {q.isLoading ? (
        <SkeletonRows rows={2} columns={3} label="Loading your items" />
      ) : q.isError ? (
        <ErrorState compact title="Couldn't load your items" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />
      ) : items.length === 0 ? null : (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((a) => {
              const pill = a.residual_overall_label ? statusPill(registerLevel, levelWord(a.residual_overall_label)) : null;
              return (
                <li key={a.row_id} className="flex min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-ds-border py-[6px] first:border-t-0">
                  <div className="min-w-0 flex-1 basis-[14rem]">
                    <TitleLink href={`/erm/rcsa/custom-templates/${a.template_id}?open=${a.row_id}`} title={(a.risk_id_text || '').trim() || 'Untitled item'} lines={1} prefetch={false} />
                    <span className="block truncate text-ds-label text-ds-fg-muted" title={a.template_name}>{a.template_name}</span>
                  </div>
                  <span className="flex flex-wrap items-center gap-[8px] text-ds-label text-ds-fg-muted">
                    {pill && <StatusPill size="sm" tone={pill.tone} label={`${pill.label}${scoreText(a.residual_overall_score) ? ` · ${scoreText(a.residual_overall_score)}` : ''}`} />}
                    <span>{a.evidence_count === 0 ? 'No evidence' : plural(a.evidence_count, 'evidence file')}</span>
                    <span>{`Updated ${formatDate(a.updated_at)}`}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {items.length > SHOWN && (
            <Button className="mt-[8px]" variant="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</Button>
          )}
        </>
      )}
    </SectionCard>
  );
}

const STATIC_FIT = { rail: true, list: null, compact: false, tight: false };

export function RegisterLibrary({ head }: { head: RenderHead }) {
  const router = useRouter();
  const { manage } = useRcsaRights();
  const { confirm, confirmDialog } = useConfirm();
  const list = useQuery({ queryKey: KEYS.registers, retry: retryUnlessRefused, queryFn: async () => (await rcsaApi.customTemplates.list(false)).data as Register[] });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const [uploading, setUploading] = useState(false);

  const deactivate = useReportedMutation({
    mutationFn: (r: Register) => rcsaApi.customTemplates.deactivate(r.id),
    success: (_, r) => `"${truncate(r.name, 60).text}" removed from the list`,
    failure: "The register wasn't removed",
    toast: 'always',
    retryable: false,
    invalidate: [KEYS.registers],
  });
  const askDeactivate = async (r: Register) => {
    const ok = await confirm({
      title: `Deactivate "${truncate(r.name, 60).text}"?`,
      message: `It leaves this list and can't be opened from here again. Its ${plural(r.row_count, 'item')} and their evidence are kept.`,
      confirmLabel: 'Deactivate register',
      tone: 'danger',
    });
    if (ok) deactivate.mutate(r);
  };

  if (list.isError && isForbidden(list.error)) {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        {head({ fit: STATIC_FIT })}
        <NoAccessState title="You don't have access to the registers" reason="Ask your administrator to give you access to RCSA registers." />
      </div>
    );
  }

  const menu = (r: Register): MenuItem[] => [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => router.push(`/erm/rcsa/custom-templates/${r.id}`) },
    { key: 'deactivate', label: 'Deactivate', icon: PowerOff, danger: true, hidden: !manage, onSelect: () => { void askDeactivate(r); } },
  ];

  const exportCsv = (shown: Register[]) => {
    saveBlob(new Blob([toCsv(
      ['Register', 'Function area', 'Sheet', 'Columns', 'Items', 'Updated'],
      shown.map((r) => [r.name, areaOf(r), r.sheet_name ?? '', r.column_count, r.row_count, formatDate(r.updated_at, { empty: '' })]),
    )], { type: 'text/csv;charset=utf-8' }), csvName('registers'));
  };

  const empty = (
    <EmptyState
      kind="firstUse"
      title="No registers yet"
      description={manage ? 'A register is your own Excel risk register kept as a list you can search, filter and give owners. Upload a workbook and its rows become items.' : 'A register is your own Excel risk register kept as a list you can search and filter. The risk team has not added one yet.'}
      action={manage ? <Button variant="primary" leftIcon={<FileUp aria-hidden />} onClick={() => setUploading(true)}>Upload an Excel register</Button> : undefined}
    />
  );

  return (
    <>
      <RcsaExplorer<Register>
        label="Registers"
        noun={{ one: 'register', other: 'registers' }}
        rows={rows}
        loading={list.isLoading}
        error={list.isError ? { message: errorMessage(list.error), onRetry: () => { void list.refetch(); } } : null}
        facets={FACETS}
        quick={QUICK}
        searchText={(r) => `${r.name} ${r.description ?? ''} ${areaOf(r)} ${r.sheet_name ?? ''}`}
        columns={COLUMNS}
        card={card}
        sorts={SORTS}
        defaultSort={DEFAULT_SORT}
        head={(fit) => head({
          fit,
          meta: list.isLoading || (list.isError && rows.length === 0) ? undefined : `${formatCount(rows.length)} ${rows.length === 1 ? 'register' : 'registers'}`,
          actions: manage ? <Button variant="primary" onClick={() => setUploading(true)} leftIcon={<FileUp aria-hidden />}>Upload an Excel register</Button> : undefined,
        })}
        notices={(
          <>
            {list.isError && rows.length > 0 && (
              <Notice tone="danger" title="Couldn't refresh the registers" action={<Button size="sm" onClick={() => { void list.refetch(); }}>Retry</Button>}>{`${errorMessage(list.error)} What is shown may be out of date.`}</Notice>
            )}
            <AssignedToMe />
          </>
        )}
        empty={empty}
        rowActions={(r) => <Menu label={`Actions for ${truncate(r.name, 60).text}`} iconOnly items={menu(r)} />}
        onExport={exportCsv}
        detail={(open, close) => (
          <SidePanel
            open={!!open}
            onClose={close}
            title={<span dir="auto" className="line-clamp-3 break-words" title={open?.name}>{open?.name}</span>}
            subtitle={open ? areaOf(open) : undefined}
            dockFrom={Infinity}
            width="md"
            restoreFocus={rowOf(open?.id ?? null)}
            footer={open && <div className="flex flex-wrap items-center gap-[8px]"><Button variant="primary" href={`/erm/rcsa/custom-templates/${open.id}`} rightIcon={<ArrowUpRight aria-hidden />}>Open register</Button></div>}
          >
            {open && (
              <div className="flex flex-col gap-[16px]">
                <ClampedText text={open.description} lines={4} />
                <FactList min={140}>
                  <Fact label="Function area">{areaOf(open)}</Fact>
                  <Fact label="Sheet">{open.sheet_name}</Fact>
                  <Fact label="Items">{formatCount(open.row_count)}</Fact>
                  <Fact label="Columns">{formatCount(open.column_count)}</Fact>
                  <Fact label="Updated">{formatDate(open.updated_at)}</Fact>
                </FactList>
              </div>
            )}
          </SidePanel>
        )}
      />
      <UploadRegisterSheet open={uploading} onClose={() => setUploading(false)} />
      {confirmDialog}
    </>
  );
}
