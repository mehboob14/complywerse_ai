'use client';

/**
 * Document Attestation — the campaigns for published documents. A campaign's link lets anyone acknowledge the document with name,
 * org-domain email, designation and signature. The page is a one-line header, one slim search bar and one register card; a campaign
 * opens in a dialog (its link, its acknowledgments) from a click on its row or from the ⋯ menu.
 * Colours are explicit hex on purpose: the platform CSS repaints slate/white inside the dashboard and gives a bare <td>/<p> its own
 * size and colour (PITFALLS: grc-frontend UI).
 */
import { useId, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Ban, Check, ClipboardCheck, Copy, ExternalLink, Eye, Loader2, Plus, Search, SearchX, Users, X } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { AnimatedModal, InfoTip, PageLoader } from '@/components/ui';
import SignatureSeal from '@/components/governance/SignatureSeal';
import { DocPageHeader } from '@/components/governance/DocPageHeader';
import { BTN, BTN_PRIMARY } from '@/components/governance/docUi';
import { RowActionsMenu } from '../_workspace/RowActionsMenu';
// what the page decides (the name a row shows, how coverage reads, the search, the counts, the times) is in _logic.ts, with its tests
import { coverageOf, countLabel, filterCampaigns, fmtDate, fmtWhen, ownName } from './_logic';

type Acknowledgment = {
  id: number;
  name: string;
  email: string;
  designation?: string | null;
  acknowledged_at?: string;
  has_signature?: boolean;
  esign_id?: number | null;
  esign_fingerprint?: string | null;
  signature_data_url?: string | null;
  signature_url?: string | null;
};

type Campaign = {
  id: number;
  document_id: number;
  document_title?: string;
  name: string;
  message?: string;
  due_date?: string;
  status: string;
  public_token: string;
  public_url?: string;
  acknowledgment_count: number;
  active_domain_users?: number;
  allowed_email_domain?: string | null;
  attestation_percent: number | null;
  progress_label?: string | null;
  created_at?: string;
  acknowledgments?: Acknowledgment[];
  /** may change or close it: whoever may change its document (the server refuses the others) */
  can_manage?: boolean;
};

type PublishedDoc = {
  id: number;
  title: string;
  status: string;
  current_version?: string;
};

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
// the dialogs are portaled out of the dashboard, so these need no workaround for its CSS
const FIELD = `block w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-2 text-[13px] text-[#1f2933] placeholder:text-[#586472] ${FOCUS}`;
const LABEL = 'mb-1 block text-[13px] font-medium text-[#26323d]';
const ICON = `inline-grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#586472] hover:bg-[#eef2f6] hover:text-[#1f2933] disabled:opacity-50 ${FOCUS}`;
const DANGER = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#f1b5ae] bg-[#fff] px-3 text-sm font-medium text-[#b42318] hover:bg-[#fef3f2] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const ALERT = 'flex items-start gap-2 rounded-lg border border-[#f1b5ae] bg-[#fef3f2] px-3 py-2 text-[13px] text-[#7a1616]';
// A table cell paints its own opaque background (the dashboard stripes the rows), has a hairline under it, and the ROW sets the
// height (the dashboard forces 7px of padding above and below every cell).
const CELL = 'border-b border-[#e1e6eb] bg-[#fff] px-[12px] align-middle group-hover/row:bg-[#f7f9fb]';
// where a click on a row is not a click on the row
const CONTROLS = 'a, button, input, select, textarea, label, [role="menu"], [role="dialog"]';

const STATUS_TONE: Record<string, string> = {
  active: 'bg-[#ecfdf5] text-[#047857]',
  closed: 'bg-[#eef2f6] text-[#586472]',
  draft: 'bg-[#fffbeb] text-[#b45309]',
};

function StatusChip({ status }: { status?: string }) {
  const tone = STATUS_TONE[(status || '').toLowerCase()] || 'bg-[#eef2f6] text-[#586472]';
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium capitalize ${tone}`}>{status || '—'}</span>;
}

/** A thin bar and "83% · 10/12"; a screen reader and the tooltip get the words (coverageOf says what, this draws it). */
function Coverage({ c }: { c: Campaign }) {
  const view = coverageOf(c);
  if (!view) {
    return (
      <span className="text-[13px] text-[#586472]" title="No active users on the email domain yet">
        <span aria-hidden>—</span>
        <span className="sr-only">Not measured: no active users on the email domain yet</span>
      </span>
    );
  }
  return (
    <span role="img" aria-label={view.words} title={view.words} className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[#e1e6eb]">
        <span className="block h-full rounded-full" style={{ width: `${view.width}%`, background: view.colour }} />
      </span>
      <span className="whitespace-nowrap text-xs tabular-nums text-[#26323d]">{view.text}</span>
    </span>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="border-b border-[#d5dbe1] px-[12px] text-left align-middle !bg-[#f3f6f8]">
      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-[#586472]">{children}</span>
    </th>
  );
}

export default function DocumentAttestationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data: campaignsData, isLoading } = useQuery({
    queryKey: ['doc-attest-campaigns'],
    queryFn: async () => (await governanceApi.listDocAttestationCampaigns()).data as { items: Campaign[]; can_create_for?: number[] },
  });

  const { data: publishedDocs = [] } = useQuery({
    queryKey: ['gov-docs-published-attest'],
    queryFn: async () => {
      const res = await governanceApi.getDocuments({ status: 'published', limit: 500 } as Record<string, unknown>);
      const raw = res.data as any;
      const items = (raw?.items || raw || []) as PublishedDoc[];
      return items.filter((d) => (d.status || '').toLowerCase() === 'published');
    },
  });

  const campaigns = campaignsData?.items || [];
  // a campaign is started for a published document the person may change (its owner, its author, the edit right)
  const attestable = useMemo(() => {
    const ids = new Set(campaignsData?.can_create_for || []);
    return publishedDocs.filter((d) => ids.has(d.id));
  }, [campaignsData, publishedDocs]);
  const canCreate = (campaignsData?.can_create_for?.length ?? 0) > 0;
  const filtered = useMemo(() => filterCampaigns(campaigns, search), [campaigns, search]);

  const detailQuery = useQuery({
    queryKey: ['doc-attest-campaign', detailId],
    queryFn: async () => (await governanceApi.getDocAttestationCampaign(detailId!)).data as Campaign,
    enabled: detailId != null,
  });

  const closeMut = useMutation({
    mutationFn: (id: number) => governanceApi.updateDocAttestationCampaign(id, { status: 'closed' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-attest-campaigns'] });
      qc.invalidateQueries({ queryKey: ['gov-docs-coverage'] });
      if (detailId) qc.invalidateQueries({ queryKey: ['doc-attest-campaign', detailId] });
      toast({ type: 'success', title: 'Campaign closed' });
    },
    onError: (e: any) =>
      toast({ type: 'error', title: 'Could not close', message: e?.response?.data?.detail || 'Try again' }),
  });

  const copyLink = async (c: Campaign) => {
    const url = c.public_url || `${window.location.origin}/attest/${c.public_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ type: 'success', title: 'Link copied' });
    } catch {
      toast({ type: 'error', title: 'Copy failed', message: url });
    }
  };

  // closing cannot be undone from here: ask first
  const askClose = (id: number) => {
    if (window.confirm('Close this attestation? People will no longer be able to acknowledge via the link.')) closeMut.mutate(id);
  };

  // a click on the row (not on a control in it, not the end of selecting text) opens the campaign; so do Enter and Space on the row
  const peek = (e: MouseEvent<HTMLTableRowElement>, id: number) => {
    if ((e.target as HTMLElement).closest(CONTROLS) || window.getSelection()?.toString()) return;
    setDetailId(id);
  };
  const peekKey = (e: KeyboardEvent<HTMLTableRowElement>, id: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailId(id); }
  };

  const none = campaigns.length === 0;

  return (
    <div className="governance-light space-y-4">
      <DocPageHeader
        title="Attestation"
        info="Share a link for people to review a published document and acknowledge it with name, email, designation, and signature."
        meta={isLoading ? undefined : countLabel(filtered.length, campaigns.length, search.trim() !== '')}
        actions={canCreate ? (
          <button type="button" onClick={() => setShowCreate(true)} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> New attestation
          </button>
        ) : undefined}
      />

      <div className="relative w-full sm:max-w-[300px]">
        <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#586472]" />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search campaigns"
          title="Searches the campaign and document names"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search campaigns"
          className="h-8 w-full rounded-lg border border-[#c3ccd5] bg-white pl-9 pr-8 text-xs text-[#1f2933] text-ellipsis placeholder:text-[#586472] focus-visible:!border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => setSearch('')}
            className={`absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] ${FOCUS}`}
          >
            <X aria-hidden strokeWidth={1.75} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <section className="min-w-0">
        <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#d5dbe1] bg-white">
          {!isLoading && filtered.length === 0 ? (
            <div className="mx-auto flex min-h-[10rem] max-w-sm flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              {none ? <ClipboardCheck className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden /> : <SearchX className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />}
              <h3 className="text-[15px] font-semibold text-[#1f2933]">{none ? 'No campaigns yet' : 'No match'}</h3>
              {none && !canCreate && <p className="text-[13px] text-[#586472]">Owners, authors and editors start them.</p>}
              {none && canCreate && (
                <button type="button" onClick={() => setShowCreate(true)} className={BTN_PRIMARY}>
                  <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> New attestation
                </button>
              )}
              {!none && <button type="button" onClick={() => setSearch('')} className={BTN}>Clear search</button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] table-fixed !border-separate border-spacing-0 text-left">
                <caption className="sr-only">{isLoading ? 'Loading the campaigns' : 'Attestation campaigns'}</caption>
                <colgroup>
                  <col />
                  <col style={{ width: 112 }} />
                  <col style={{ width: 232 }} />
                  <col style={{ width: 88 }} />
                </colgroup>
                <thead>
                  <tr className="h-10">
                    <Th>Document</Th>
                    <Th>Status</Th>
                    <Th>Coverage</Th>
                    <Th><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody aria-busy={isLoading || undefined}>
                  {isLoading
                    ? Array.from({ length: 5 }, (_, i) => (
                        <tr key={i} aria-hidden className="h-11">
                          {['60%', '56px', '120px', '40px'].map((w, j) => (
                            <td key={j} className={CELL}>
                              <span className="block h-3.5 animate-pulse rounded bg-[#e1e6eb] motion-reduce:animate-none" style={{ width: w }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    : filtered.map((c) => {
                        const own = ownName(c);
                        const title = c.document_title || `Document #${c.document_id}`;
                        const copied = copiedId === c.id;
                        return (
                          <tr
                            key={c.id}
                            tabIndex={0}
                            onClick={(e) => peek(e, c.id)}
                            onKeyDown={(e) => peekKey(e, c.id)}
                            className="group/row h-11 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0f766e]"
                          >
                            <td className={CELL}>
                              <div className="min-w-0 leading-tight">
                                <Link
                                  href={`/governance/documents/${c.document_id}`}
                                  title={title}
                                  className={`block truncate rounded-sm text-[13px] font-medium text-[#1f2933] hover:text-[#0f766e] hover:underline ${FOCUS}`}
                                >
                                  {title}
                                </Link>
                                {own && (
                                  <button
                                    type="button"
                                    onClick={() => setDetailId(c.id)}
                                    title={own}
                                    className={`block max-w-full truncate rounded-sm text-left text-xs text-[#586472] hover:text-[#0f766e] ${FOCUS}`}
                                  >
                                    {own}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className={CELL}><StatusChip status={c.status} /></td>
                            <td className={CELL}><Coverage c={c} /></td>
                            <td className={CELL}>
                              <div className="flex items-center justify-end gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => copyLink(c)}
                                  aria-label={copied ? 'Link copied' : 'Copy link'}
                                  title={copied ? 'Copied' : 'Copy link'}
                                  className={ICON}
                                >
                                  {copied ? <Check className="h-4 w-4 text-[#047857]" strokeWidth={2} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                                </button>
                                <RowActionsMenu
                                  actions={[
                                    { key: 'details', label: 'Details', icon: Eye, onClick: () => setDetailId(c.id) },
                                    { key: 'close', label: 'Close campaign', icon: Ban, variant: 'danger', onClick: () => askClose(c.id), hidden: !(c.status === 'active' && c.can_manage) },
                                  ]}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {showCreate && (
        <CreateCampaignModal
          documents={attestable}
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['doc-attest-campaigns'] });
            qc.invalidateQueries({ queryKey: ['gov-docs-coverage'] });
            setDetailId(c.id);
            toast({
              type: 'success',
              title: 'Attestation created',
              message: 'Share the external link with your organization.',
            });
          }}
        />
      )}

      {detailId != null && (
        <CampaignDetailModal
          campaign={detailQuery.data}
          loading={detailQuery.isLoading}
          copied={copiedId === detailId}
          onClose={() => setDetailId(null)}
          onCopy={() => detailQuery.data && copyLink(detailQuery.data)}
          onCloseCampaign={
            detailQuery.data?.status === 'active' && detailQuery.data.can_manage
              ? () => askClose(detailQuery.data!.id)
              : undefined
          }
          closing={closeMut.isPending}
        />
      )}
    </div>
  );
}

function CreateCampaignModal({
  documents,
  onClose,
  onCreated,
}: {
  documents: PublishedDoc[];
  onClose: () => void;
  onCreated: (c: Campaign) => void;
}) {
  const uid = useId();
  const [documentId, setDocumentId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error('Select a published document');
      const res = await governanceApi.createDocAttestationCampaign({
        document_id: Number(documentId),
        name: name || undefined,
        message: message || undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        activate: true,
      });
      return res.data as Campaign;
    },
    onSuccess: onCreated,
    onError: (e: any) => {
      const d = e?.response?.data?.detail;
      setError(typeof d === 'string' ? d : e?.message || 'Could not create attestation');
    },
  });

  const canSubmit = !!documentId && !mut.isPending;

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="New attestation"
      headerAccessory={(
        <InfoTip
          align="end"
          label="About new attestation"
          text="Choose a published document. Its link lets anyone acknowledge it with name, organisation email, designation and signature. Name, due date and message are optional."
        />
      )}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN} disabled={mut.isPending}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            className={BTN_PRIMARY}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            Create
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-5">
        <div>
          <label htmlFor={`${uid}-doc`} className={LABEL}>
            Document <span className="text-[#b42318]">*</span>
          </label>
          <select
            id={`${uid}-doc`}
            className={FIELD}
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value ? Number(e.target.value) : '')}
            autoFocus
          >
            <option value="">Select a document…</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.current_version ? ` (v${d.current_version})` : ''}
              </option>
            ))}
          </select>
          {documents.length === 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-[#92400e]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              No published documents. Publish one first.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-name`} className={LABEL}>Name</label>
            <input
              id={`${uid}-name`}
              className={FIELD}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 acknowledgment"
            />
          </div>
          <div>
            <label htmlFor={`${uid}-due`} className={LABEL}>Due date</label>
            <input
              id={`${uid}-due`}
              type="date"
              className={FIELD}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor={`${uid}-msg`} className="text-[13px] font-medium text-[#26323d]">Message</label>
            <InfoTip label="About the message" text="People see this message on the acknowledgment page that the link opens." />
          </div>
          <textarea
            id={`${uid}-msg`}
            className={FIELD}
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Please review this policy and acknowledge that you have read it."
          />
        </div>

        {error && (
          <div role="alert" className={ALERT}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}

const DT = 'text-xs text-[#586472]';

function CampaignDetailModal({
  campaign,
  loading,
  copied,
  onClose,
  onCopy,
  onCloseCampaign,
  closing,
}: {
  campaign?: Campaign;
  loading: boolean;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCloseCampaign?: () => void;
  closing?: boolean;
}) {
  const [sigPreview, setSigPreview] = useState<{ name: string; url: string } | null>(null);
  const acks = campaign?.acknowledgments || [];
  const count = campaign?.acknowledgment_count ?? acks.length;
  const publicUrl = campaign?.public_url || (campaign ? `/attest/${campaign.public_token}` : '');
  const own = campaign ? ownName(campaign) : '';
  const docTitle = campaign ? campaign.document_title || `Document #${campaign.document_id}` : '';

  return (
    <>
      <AnimatedModal
        isOpen
        onClose={onClose}
        size="xl"
        title={own || docTitle || 'Attestation'}
        subtitle={own ? docTitle : undefined}
        headerAccessory={campaign ? (
          <Link href={`/governance/documents/${campaign.document_id}`} aria-label="Open document" title="Open document" className={ICON}>
            <ExternalLink className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </Link>
        ) : undefined}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            {onCloseCampaign ? (
              <button type="button" onClick={onCloseCampaign} disabled={closing} className={DANGER}>
                {closing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Close campaign
              </button>
            ) : <span />}
            <button type="button" onClick={onClose} className={BTN}>
              Done
            </button>
          </div>
        }
      >
        {loading || !campaign ? (
          <PageLoader className="h-48" />
        ) : (
          <div className="space-y-4 px-5 py-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-[#d5dbe1] p-3 sm:grid-cols-4">
              <div>
                <dt className={DT}>Status</dt>
                <dd className="mt-1"><StatusChip status={campaign.status} /></dd>
              </div>
              <div>
                <dt className={DT}>Coverage</dt>
                <dd className="mt-2"><Coverage c={campaign} /></dd>
              </div>
              <div>
                <dt className={DT}>Domain</dt>
                <dd className="mt-1 truncate font-mono text-[13px] text-[#1f2933]" title="Only people with this email domain can acknowledge">
                  {campaign.allowed_email_domain ? `@${campaign.allowed_email_domain}` : '—'}
                </dd>
              </div>
              {campaign.due_date && (
                <div>
                  <dt className={DT}>Due</dt>
                  <dd className="mt-1 text-[13px] text-[#1f2933]">{fmtDate(campaign.due_date)}</dd>
                </div>
              )}
            </dl>

            <section className="rounded-xl border border-[#d5dbe1] p-3">
              <div className="mb-2 flex items-center gap-1">
                <h3 className="text-[13px] font-semibold text-[#1f2933]">Link</h3>
                <InfoTip label="About the link" text="Anyone with this link can review the document and acknowledge it. No app login is required." />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-[#e1e6eb] bg-[#f3f6f8] px-3 py-2 font-mono text-xs text-[#26323d]">
                  {publicUrl}
                </code>
                <button type="button" onClick={onCopy} className={BTN}>
                  {copied ? <Check className="h-4 w-4 text-[#047857]" strokeWidth={2} aria-hidden /> : <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {publicUrl.startsWith('http') && (
                  <a href={publicUrl} target="_blank" rel="noreferrer" className={BTN}>
                    <ExternalLink className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Open
                  </a>
                )}
              </div>
              {campaign.message && (
                <>
                  <p className={`mt-3 ${DT}`}>Message</p>
                  <p className="mt-1 rounded-lg bg-[#f3f6f8] px-3 py-2 text-[13px] text-[#26323d]">{campaign.message}</p>
                </>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-[#586472]" strokeWidth={1.75} aria-hidden />
                <h3 className="text-[13px] font-semibold text-[#1f2933]">Acknowledgments</h3>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#eef2f6] px-1.5 text-xs font-medium tabular-nums text-[#26323d]">{count}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-[#d5dbe1]">
                <div className="max-h-80 overflow-auto">
                  <table className="min-w-full text-left">
                    <thead className="sticky top-0">
                      <tr className="h-9 bg-[#f3f6f8]">
                        {['Name', 'Email', 'Designation', 'Signed', 'Signature'].map((h) => (
                          <th key={h} scope="col" className="bg-[#f3f6f8] px-3 text-left align-middle">
                            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-[#586472]">{h}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {acks.map((a) => {
                        const sigUrl = a.signature_data_url || null;
                        return (
                          <tr key={a.id} className="h-11 border-t border-[#e1e6eb] hover:bg-[#f7f9fb]">
                            <td className="px-3 align-middle text-[13px] font-medium text-[#1f2933]">{a.name}</td>
                            <td className="px-3 align-middle text-[13px] text-[#26323d]">{a.email}</td>
                            <td className="px-3 align-middle text-[13px] text-[#26323d]">{a.designation || '—'}</td>
                            <td className="whitespace-nowrap px-3 align-middle text-[13px] tabular-nums text-[#586472]">
                              {fmtWhen(a.acknowledged_at)}
                            </td>
                            <td className="px-3 py-1 align-middle">
                              {sigUrl ? (
                                <button
                                  type="button"
                                  onClick={() => setSigPreview({ name: a.name, url: sigUrl })}
                                  className={`inline-flex items-center overflow-hidden rounded-lg border border-[#d5dbe1] bg-[#fff] hover:border-[#0f766e] ${FOCUS}`}
                                  title="View signature"
                                  aria-label={`View the signature of ${a.name}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={sigUrl} alt="" className="h-9 w-24 object-contain p-0.5" />
                                </button>
                              ) : (
                                <span className="text-[13px] text-[#586472]">—</span>
                              )}
                              {a.esign_id && a.esign_fingerprint && <SignatureSeal id={a.esign_id} fingerprint={a.esign_fingerprint} thumb={false} />}
                            </td>
                          </tr>
                        );
                      })}
                      {acks.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-8 text-center">
                            <Users className="mx-auto h-6 w-6 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
                            <p className="mt-2 text-[13px] font-medium text-[#26323d]">No acknowledgments yet</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        )}
      </AnimatedModal>

      {sigPreview && (
        <AnimatedModal isOpen onClose={() => setSigPreview(null)} size="md" title={sigPreview.name} subtitle="Signature">
          <div className="px-5 py-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sigPreview.url}
              alt={`Signature of ${sigPreview.name}`}
              className="max-h-72 w-full rounded-xl border border-[#d5dbe1] bg-[#fff] object-contain p-4"
            />
          </div>
        </AnimatedModal>
      )}
    </>
  );
}
