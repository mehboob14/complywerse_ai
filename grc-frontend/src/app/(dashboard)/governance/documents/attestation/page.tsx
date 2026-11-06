'use client';

// Document Attestation: the campaigns for published documents. A campaign's link lets anyone acknowledge the document with name, org-domain email,
// designation and signature; the page lists the campaigns, opens one in a drawer (its link, its acknowledgements) and starts new ones. On the
// design-system kit (components/ui/ds): PageHeader variant="page", RegisterTable (a table from 768px, cards below), Pager, Menu, StatusPill, drawers that
// ask "Discard changes?", useConfirm for closing a campaign and useReportedMutation for what it writes. Coverage is the server's (unique acknowledgements
// over active users on the email domain: _logic.ts coverageOf, _Coverage.tsx) and acknowledgements are counted nowhere but here and there.
// The server lists the newest 200 campaigns and carries no total: when the list is full the page says it is cut (_logic.ts cutNotice).
//   _CampaignDetail.tsx  one campaign (drawer)      _CreateCampaign.tsx  start one (drawer)
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ClipboardCheck, Copy, Eye, Plus, Search, X } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { attestationStatus, statusPill } from '@/lib/status';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, IconButton, Menu, Pager, RegisterTable, StatusPill, TextInput, useConfirm, useNotify, useReportedMutation,
  type MenuItem, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ListNotice } from '@/components/governance/ListNotice';
import { countLabel, cutNotice, dayText, filterCampaigns, isCut, ownName, pageOf, sortCampaigns } from './_logic';
import { Coverage } from './_Coverage';
import { CampaignDetailDrawer } from './_CampaignDetail';
import { CreateCampaignDrawer } from './_CreateCampaign';
import type { Campaign, PublishedDoc } from './_types';

const PAGE_SIZES = [25, 50, 100];
const CLOSE_NOTE = 'People can no longer acknowledge through the link. Every signed acknowledgement is kept.';

export default function DocumentAttestationPage() {
  const notify = useNotify();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ['doc-attest-campaigns'],
    queryFn: async () => (await governanceApi.listDocAttestationCampaigns()).data as { items: Campaign[]; can_create_for?: number[] },
    retry: (n, e) => n < 2 && canRetry(e),                          // a refusal (403) is not tried again: it is said at once
  });
  const campaigns = list.data?.items ?? [];
  // a campaign is started for a published document the person may change (its owner, its author, the edit right)
  const canCreate = (list.data?.can_create_for?.length ?? 0) > 0;
  // the published documents are needed only by the one who can start a campaign
  const published = useQuery({
    queryKey: ['gov-docs-published-attest'],
    queryFn: async () => {
      const res = await governanceApi.getDocuments({ status: 'published', limit: 500 } as Record<string, unknown>);
      const raw = res.data as any;
      const items = (raw?.items || raw || []) as PublishedDoc[];
      return items.filter((d) => (d.status || '').toLowerCase() === 'published');
    },
    enabled: canCreate,
  });
  const attestable = useMemo(() => {
    const ids = new Set(list.data?.can_create_for || []);
    return (published.data ?? []).filter((d) => ids.has(d.id));
  }, [list.data, published.data]);

  const failed = list.isError && !list.data;
  const cut = isCut(campaigns.length);
  const searching = search.trim() !== '';
  const matches = useMemo(() => filterCampaigns(campaigns, search), [campaigns, search]);
  const sorted = useMemo(() => sortCampaigns(matches, sort), [matches, sort]);
  const shown = pageOf(sorted, pageNo, pageSize);                    // a page that is not there any more (a search shrank the list) is brought inside the pages
  const notice = failed || list.isLoading ? null : cutNotice(campaigns.length);

  const closeMut = useReportedMutation({
    mutationFn: (id: number) => governanceApi.updateDocAttestationCampaign(id, { status: 'closed' }),
    success: 'Campaign closed',
    failure: 'Not closed',
    invalidate: [['doc-attest-campaigns'], ['gov-docs-coverage']],
    onSuccess: (_r, id) => { void qc.invalidateQueries({ queryKey: ['doc-attest-campaign', id] }); },
  });
  // closing cannot be undone from here: ask first
  const askClose = async (c: Pick<Campaign, 'id'>) => {
    if (await confirm({ title: 'Close this attestation?', message: CLOSE_NOTE, confirmLabel: 'Close campaign', tone: 'danger' })) closeMut.mutate(c.id);
  };

  const copyLink = async (c: Pick<Campaign, 'id' | 'public_url' | 'public_token'>) => {
    const url = c.public_url || `${window.location.origin}/attest/${c.public_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(c.id);
      window.setTimeout(() => setCopiedId(null), 2000);
      notify.success('Link copied');
    } catch {
      notify.error(url, { title: 'Copy failed' });
    }
  };

  const titleOf = (c: Campaign) => c.document_title || `Document #${c.document_id}`;
  const actionsOf = (c: Campaign) => {
    const copied = copiedId === c.id;
    const items: MenuItem[] = [
      { key: 'details', label: 'Details', icon: Eye, onSelect: () => setDetailId(c.id) },
      { key: 'close', label: 'Close campaign', icon: Ban, danger: true, onSelect: () => { void askClose(c); }, hidden: !(c.status === 'active' && c.can_manage) },
    ];
    return (
      <div className="flex items-center justify-end gap-[2px]">
        <IconButton label={copied ? 'Link copied' : 'Copy link'} onClick={() => { void copyLink(c); }}>{copied ? <Check aria-hidden /> : <Copy aria-hidden />}</IconButton>
        <Menu label={`Actions for ${truncate(titleOf(c), 60).text}`} iconOnly items={items} />
      </div>
    );
  };
  const nameOf = (c: Campaign) => {
    const own = ownName(c);
    return (
      <div className="min-w-0">
        {/* the clamp is on the span and the link is only as wide as its words: a click anywhere else on the row opens the campaign */}
        <span className="line-clamp-2 font-[600]">
          <Link href={`/governance/documents/${c.document_id}`} title={titleOf(c)} className="rounded-ds-control text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
            {titleOf(c)}
          </Link>
        </span>
        {own && <span className="line-clamp-2 text-ds-label font-normal text-ds-fg-muted" title={own}>{own}</span>}
      </div>
    );
  };

  const columns: RegisterColumn<Campaign>[] = [
    { key: 'document', header: 'Document', isRowHeader: true, sortable: true, cell: nameOf },
    { key: 'status', header: 'Status', sortable: true, width: 'w-[116px]', card: 'meta', cell: (c) => <StatusPill size="sm" {...statusPill(attestationStatus, c.status)} /> },
    { key: 'coverage', header: 'Coverage', sortable: true, width: 'w-[220px]', card: 'meta', cell: (c) => <Coverage c={c} /> },
    {
      key: 'due', header: 'Due', priority: 2, sortable: true, width: 'w-[112px]', card: 'meta',
      cell: (c) => <span className={`whitespace-nowrap tabular-nums ${c.due_date ? '' : 'text-ds-fg-muted'}`}>{dayText(c.due_date)}</span>,
    },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[96px]', cell: actionsOf },
  ];

  const none = campaigns.length === 0;
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setShowCreate(true)}>New attestation</Button>;
  const empty = none ? (
    <EmptyState kind="firstUse" bare icon={ClipboardCheck} title="No campaigns yet" info={canCreate ? undefined : 'Owners, authors and editors start them.'} action={canCreate ? add : undefined} />
  ) : (
    <EmptyState kind="noMatches" bare title="No match" onClearFilters={() => setSearch('')} />
  );

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Attestation"
        info="Share a link for people to review a published document and acknowledge it with name, email, designation, and signature."
        meta={failed || list.isLoading ? undefined : countLabel(matches.length, campaigns.length, searching, cut)}
        actions={canCreate ? add : undefined}
      />

      {notice && <ListNotice title={notice.title}>{notice.detail}</ListNotice>}

      <TextInput
        className="w-full sm:w-[300px]"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search campaigns"
        placeholder="Search campaigns"
        title="Searches the campaign and document names"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPageNo(1); }}
        leftAdornment={<Search aria-hidden />}
        rightAdornment={search ? (
          <button type="button" aria-label="Clear search" title="Clear search" onClick={() => { setSearch(''); setPageNo(1); }}
            className="grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
            <X aria-hidden strokeWidth={1.75} className="h-[14px] w-[14px]" />
          </button>
        ) : undefined}
      />

      <RegisterTable<Campaign>
        caption="Attestation campaigns"
        columns={columns}
        rows={shown.rows}
        getRowId={(c) => c.id}
        sort={sort}
        onSortChange={(next) => { setSort(next); setPageNo(1); }}
        onRowActivate={(c) => setDetailId(c.id)}
        selectedId={detailId}
        loading={list.isLoading}
        error={failed ? { message: `Could not load the campaigns. ${errorMessage(list.error)}`, onRetry: canRetry(list.error) ? () => { void list.refetch(); } : undefined } : null}
        empty={empty}
        cardTitle={(c) => (
          <div className="flex items-start justify-between gap-[8px]">
            <div className="min-w-0 flex-1">{nameOf(c)}</div>
            {actionsOf(c)}
          </div>
        )}
        footer={sorted.length > 0 ? (
          <Pager page={shown.range.page} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={(n) => { setPageSize(n); setPageNo(1); }} pageSizes={PAGE_SIZES}
            noun={cut ? 'loaded campaigns' : 'campaigns'} />
        ) : undefined}
      />

      {showCreate && (
        <CreateCampaignDrawer
          documents={attestable}
          onClose={() => setShowCreate(false)}
          onCreated={(c) => { setShowCreate(false); setDetailId(c.id); }}
        />
      )}
      {detailId != null && (
        <CampaignDetailDrawer
          key={detailId}
          id={detailId}
          copied={copiedId === detailId}
          closing={closeMut.isPending}
          onCopy={(c) => { void copyLink(c); }}
          onAskClose={(c) => { void askClose(c); }}
          onClose={() => setDetailId(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
