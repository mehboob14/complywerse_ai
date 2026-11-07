'use client';

// The Questionnaires half of the Templates library: every question template the organisation can run a campaign from (the ones the platform provides and the ones it made), as a register on
// the facet explorer. A row opens the questionnaire's workspace; the menu clones, downloads or deletes. The server refuses to delete a questionnaire a campaign uses and one the platform
// provides, so the menu says so beside the item instead of letting the person find out. Making, cloning, uploading and deleting are the risk team's (the rights of the Worklist); everyone
// who can open RCSA can read and download.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Copy, Download, Eye, FileUp, Plus, Trash2 } from 'lucide-react';
import { Button, ClampedText, EmptyState, Fact, FactList, Menu, Notice, SidePanel, StatusPill, TitleLink, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { rcsaApi } from '@/lib/api';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { csvName, toCsv } from '@/lib/rcsa/csv';
import { saveBlob } from '@/lib/rcsa/saveBlob';
import { deleteBlock, inUseText, plural, templateFileName, whoOf } from '@/lib/rcsa/templatesModel';
import { RcsaExplorer, type ExplorerFacet, type ExplorerQuick, type ExplorerSort } from '../../_parts/RcsaExplorer';
import { KEYS, fetchAll, useRcsaRights } from '../../_parts/rcsaData';
import { CloneSheet, NewQuestionnaireSheet, UploadQuestionnaireSheet } from './LibrarySheets';
import { rowOf, uniqueOptions, type RenderHead } from './libraryShared';

export interface Tpl {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  source?: string;
  version?: string;
  is_system_template?: boolean;
  question_count: number;
  campaign_count?: number;
  updated_at?: string;
}

const CATEGORY_NONE = 'Not categorised';
const categoryOf = (t: Tpl): string => (t.category || '').trim() || CATEGORY_NONE;

const FACETS: ExplorerFacet<Tpl>[] = [
  { key: 'category', label: 'Category', values: (t) => [categoryOf(t)], options: (rows) => uniqueOptions(rows, (t) => [categoryOf(t)]), searchable: true, defaultOpen: true },
  { key: 'who', label: 'Who', values: (t) => [t.is_system_template ? 'provided' : 'yours'], options: (rows) => uniqueOptions(rows, (t) => [t.is_system_template ? 'provided' : 'yours'], (v) => (v === 'provided' ? 'Provided' : 'Yours')), defaultOpen: true },
  { key: 'use', label: 'In use', values: (t) => [(t.campaign_count ?? 0) > 0 ? 'used' : 'unused'], options: () => [{ value: 'used', label: 'Used by a campaign' }, { value: 'unused', label: 'Not used' }], defaultOpen: true },
];
const QUICK: ExplorerQuick<Tpl>[] = [
  { key: 'used', label: 'In use', test: (t) => (t.campaign_count ?? 0) > 0 },
  { key: 'unused', label: 'Not used', test: (t) => (t.campaign_count ?? 0) === 0 },
];
const SORTS: ExplorerSort<Tpl>[] = [
  { key: 'name', value: (t) => t.name },
  { key: 'category', value: (t) => categoryOf(t) },
  { key: 'questions', value: (t) => t.question_count, firstDir: 'desc' },
  { key: 'use', value: (t) => t.campaign_count ?? 0, firstDir: 'desc' },
  { key: 'updated', value: (t) => (t.updated_at ? new Date(t.updated_at.endsWith('Z') ? t.updated_at : `${t.updated_at}Z`).getTime() : null), firstDir: 'desc' },
];
const DEFAULT_SORT = { key: 'name', dir: 'asc' as const };

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function NameCell({ row }: { row: RecordRow<Tpl> }) {
  const t = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[2px]" onClick={stop}>
      <TitleLink href={`/erm/rcsa/templates/${t.id}`} title={t.name} prefetch={false} />
      {t.description && <span dir="auto" title={t.description} className="line-clamp-1 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{t.description}</span>}
    </div>
  );
}

function UseText({ t }: { t: Tpl }) {
  return <span className={(t.campaign_count ?? 0) > 0 ? 'text-ds-body text-ds-fg' : 'text-ds-body text-ds-fg-muted'}>{inUseText(t.campaign_count)}</span>;
}

const COLUMNS: RecordColumn<Tpl>[] = [
  { key: 'name', header: 'Questionnaire', sortKey: 'name', cell: (row) => <NameCell row={row} /> },
  { key: 'category', header: 'Category', sortKey: 'category', fit: { px: 160, dropRank: 3 }, cell: (row) => <span className="line-clamp-2 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{categoryOf(row.record)}</span> },
  { key: 'questions', header: 'Questions', sortKey: 'questions', firstDir: 'desc', fit: { px: 104, dropRank: 2 }, cell: (row) => <span className="text-ds-body tabular-nums text-ds-fg">{formatCount(row.record.question_count)}</span> },
  { key: 'use', header: 'In use', sortKey: 'use', firstDir: 'desc', fit: { px: 124 }, cell: (row) => <UseText t={row.record} /> },
  { key: 'who', header: 'Who', fit: { px: 100, dropRank: 1 }, cell: (row) => <StatusPill size="sm" tone="neutral" label={whoOf(row.record)} /> },
  { key: 'updated', header: 'Updated', sortKey: 'updated', firstDir: 'desc', fit: { px: 116 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-muted">{formatDate(row.record.updated_at)}</span> },
];

const card = (row: RecordRow<Tpl>) => {
  const t = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={t.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{t.name}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        <span>{categoryOf(t)}</span>
        <span>{plural(t.question_count, 'question')}</span>
        <span>{inUseText(t.campaign_count)}</span>
        <StatusPill size="sm" tone="neutral" label={whoOf(t)} />
      </span>
    </div>
  );
};

export function QuestionnaireLibrary({ head }: { head: RenderHead }) {
  const router = useRouter();
  const { manage } = useRcsaRights();
  const { confirm, confirmDialog } = useConfirm();
  const list = useQuery({ queryKey: KEYS.templates, queryFn: () => fetchAll<Tpl>('/erm/rcsa/templates') });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const [making, setMaking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cloning, setCloning] = useState<Tpl | null>(null);

  const download = useReportedMutation({
    mutationFn: async (t: Tpl) => {
      const r = await rcsaApi.downloadTemplate(t.id);
      saveBlob(new Blob([r.data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), templateFileName(t.name));
    },
    failure: "The questionnaire couldn't be downloaded",
    fallback: 'Try again in a moment.',
    toast: 'errors',
  });
  const remove = useReportedMutation({
    mutationFn: (t: Tpl) => rcsaApi.deleteTemplate(t.id),
    success: (_, t) => `Deleted "${truncate(t.name, 60).text}"`,
    failure: "The questionnaire wasn't deleted",
    toast: 'always',
    retryable: false,
    invalidate: [KEYS.templates],
  });
  const askDelete = async (t: Tpl) => {
    const ok = await confirm({
      title: `Delete "${truncate(t.name, 60).text}"?`,
      message: `Its ${plural(t.question_count, 'question')} ${t.question_count === 1 ? 'is' : 'are'} deleted with it. This cannot be undone.`,
      confirmLabel: 'Delete questionnaire',
      tone: 'danger',
    });
    if (ok) remove.mutate(t);
  };

  const menu = (t: Tpl) => {
    const block = deleteBlock(t);
    const items: MenuItem[] = [
      { key: 'open', label: 'Open', icon: Eye, onSelect: () => router.push(`/erm/rcsa/templates/${t.id}`) },
      { key: 'clone', label: 'Clone', icon: Copy, onSelect: () => setCloning(t), hidden: !manage },
      { key: 'download', label: 'Download', icon: Download, onSelect: () => download.mutate(t) },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !manage, disabled: !!block, reason: block ?? undefined, onSelect: () => { void askDelete(t); } },
    ];
    return items;
  };

  const exportCsv = (shown: Tpl[]) => {
    const body = toCsv(
      ['Questionnaire', 'Category', 'Questions', 'Campaigns using it', 'Who', 'Version', 'Updated'],
      shown.map((t) => [t.name, categoryOf(t), t.question_count, t.campaign_count ?? 0, whoOf(t), t.version ?? '', formatDate(t.updated_at, { empty: '' })]),
    );
    saveBlob(new Blob([body], { type: 'text/csv;charset=utf-8' }), csvName('questionnaires'));
  };

  const buttons = (compact: boolean) => manage ? (
    <>
      <Button onClick={() => setUploading(true)} leftIcon={<FileUp aria-hidden />} title="Upload a questionnaire from a spreadsheet"><span className={compact ? 'sr-only' : undefined}>Upload</span></Button>
      <Button variant="primary" onClick={() => setMaking(true)} leftIcon={<Plus aria-hidden />}>New questionnaire</Button>
    </>
  ) : undefined;

  const empty = (
    <EmptyState
      kind="firstUse"
      title="No questionnaires yet"
      description={manage ? 'A questionnaire is the set of questions assessors answer in a campaign. Upload a spreadsheet of questions or write your own.' : 'A questionnaire is the set of questions assessors answer in a campaign. The risk team has not added one yet.'}
      action={manage ? <div className="flex flex-wrap justify-center gap-[8px]"><Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setMaking(true)}>New questionnaire</Button><Button leftIcon={<FileUp aria-hidden />} onClick={() => setUploading(true)}>Upload a spreadsheet</Button></div> : undefined}
    />
  );

  return (
    <>
      <RcsaExplorer<Tpl>
        label="Questionnaires"
        noun={{ one: 'questionnaire', other: 'questionnaires' }}
        rows={rows}
        loading={list.isLoading}
        error={list.isError ? { message: errorMessage(list.error), onRetry: () => { void list.refetch(); } } : null}
        facets={FACETS}
        quick={QUICK}
        searchText={(t) => `${t.name} ${t.description ?? ''} ${categoryOf(t)}`}
        columns={COLUMNS}
        card={card}
        sorts={SORTS}
        defaultSort={DEFAULT_SORT}
        head={(fit) => head({ fit, meta: list.isLoading || (list.isError && rows.length === 0) ? undefined : `${formatCount(rows.length)} ${rows.length === 1 ? 'questionnaire' : 'questionnaires'}`, actions: buttons(fit.compact) })}
        notices={list.isError && rows.length > 0 ? (
          <Notice tone="danger" title="Couldn't refresh the questionnaires" action={<Button size="sm" onClick={() => { void list.refetch(); }}>Retry</Button>}>{`${errorMessage(list.error)} What is shown may be out of date.`}</Notice>
        ) : undefined}
        empty={empty}
        rowActions={(t) => <Menu label={`Actions for ${truncate(t.name, 60).text}`} iconOnly items={menu(t)} />}
        onExport={exportCsv}
        detail={(open, close) => (
          <SidePanel
            open={!!open}
            onClose={close}
            title={<span dir="auto" className="line-clamp-3 break-words" title={open?.name}>{open?.name}</span>}
            subtitle={open ? whoOf(open) : undefined}
            dockFrom={Infinity}
            width="md"
            restoreFocus={rowOf(open?.id ?? null)}
            footer={open && (
              <div className="flex flex-wrap items-center gap-[8px]">
                <Button variant="primary" href={`/erm/rcsa/templates/${open.id}`} rightIcon={<ArrowUpRight aria-hidden />}>Open</Button>
                {manage && <Button leftIcon={<Copy aria-hidden />} onClick={() => setCloning(open)}>Clone</Button>}
                <Button leftIcon={<Download aria-hidden />} onClick={() => download.mutate(open)}>Download</Button>
              </div>
            )}
          >
            {open && (
              <div className="flex flex-col gap-[16px]">
                <ClampedText text={open.description} lines={4} />
                <FactList min={140}>
                  <Fact label="Category">{categoryOf(open)}</Fact>
                  <Fact label="Questions">{formatCount(open.question_count)}</Fact>
                  <Fact label="Version">{open.version}</Fact>
                  <Fact label="In use">{inUseText(open.campaign_count)}</Fact>
                  <Fact label="Who">{whoOf(open)}</Fact>
                  <Fact label="Updated">{formatDate(open.updated_at)}</Fact>
                </FactList>
                {(open.campaign_count ?? 0) > 0 && (
                  <p className="text-ds-body text-ds-fg-muted">{`Used by ${plural(open.campaign_count as number, 'campaign')}. Removing a question from it deletes the answers already given to that question.`}</p>
                )}
              </div>
            )}
          </SidePanel>
        )}
      />
      <NewQuestionnaireSheet open={making} onClose={() => setMaking(false)} />
      <UploadQuestionnaireSheet open={uploading} onClose={() => setUploading(false)} />
      <CloneSheet open={!!cloning} template={cloning} onClose={() => setCloning(null)} />
      {confirmDialog}
    </>
  );
}
