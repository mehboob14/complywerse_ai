'use client';

/**
 * Document Attestation — create/manage campaigns for published documents.
 * External link lets anyone acknowledge with name, org-domain email,
 * designation, and signature.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Plus, Loader2, Link2, Copy, Check, Users, ExternalLink,
  AlertCircle, Eye,
} from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { AnimatedModal, PageLoader, SearchInput } from '@/components/ui';

type Acknowledgment = {
  id: number;
  name: string;
  email: string;
  designation?: string | null;
  acknowledged_at?: string;
  has_signature?: boolean;
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
};

type PublishedDoc = {
  id: number;
  title: string;
  status: string;
  current_version?: string;
};

const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

const labelClass = 'mb-1 block text-sm font-medium text-slate-800';

const helperClass = 'mt-1 text-xs text-slate-500';

const btnSecondary =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50';

const btnSecondaryLg =
  'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50';

const btnPrimaryLg =
  'cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50';

function pctLabel(c: Campaign) {
  if (c.attestation_percent == null) return '—';
  const count = c.acknowledgment_count ?? 0;
  return `${c.attestation_percent}% · ${count} acknowledged`;
}

function formatWhen(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status || '').toLowerCase();
  const tones: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    closed: 'bg-slate-100 text-slate-600',
    draft: 'bg-amber-50 text-amber-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tones[s] || 'bg-slate-100 text-slate-600'}`}>
      {status || '—'}
    </span>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-[11px] font-semibold text-white">
        {n}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
    </div>
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
    queryFn: async () => (await governanceApi.listDocAttestationCampaigns()).data as { items: Campaign[] },
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
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) =>
      `${c.name} ${c.document_title || ''}`.toLowerCase().includes(q)
    );
  }, [campaigns, search]);

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

  return (
    <div className="governance-light space-y-4">
      {/* Dense toolbar — Documents-style */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">Attestation</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Share a link for people to review a published document and acknowledge it with name, email, designation, and signature.
          </p>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className={btnPrimaryLg}>
          <Plus className="h-4 w-4" /> New attestation
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by campaign or document…" className="max-w-sm" />
        <span className="text-xs text-slate-500">
          {filtered.length} campaign{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <PageLoader className="h-64" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-slate-800">No attestation campaigns yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Pick a published document, create an attestation, then copy the external link for people to acknowledge.
          </p>
          <button type="button" onClick={() => setShowCreate(true)} className={`${btnPrimaryLg} mt-5`}>
            <Plus className="h-4 w-4" /> Create attestation
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attestation register</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Campaign</th>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Coverage</th>
                  <th className="px-4 py-3">External link</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetailId(c.id)}
                        className="text-left font-medium text-slate-900 hover:text-primary-700"
                      >
                        {c.name}
                      </button>
                      {c.allowed_email_domain && (
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">@{c.allowed_email_domain}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/governance/documents/${c.document_id}`}
                        className="text-slate-600 hover:text-primary-700"
                      >
                        {c.document_title || `Document #${c.document_id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{pctLabel(c)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => copyLink(c)}
                        className={btnSecondary}
                        title="Copy external link"
                      >
                        {copiedId === c.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedId === c.id ? 'Copied' : 'Copy link'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailId(c.id)}
                          className="text-xs font-medium text-primary-700 hover:underline"
                        >
                          Details
                        </button>
                        {c.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Close this attestation? People will no longer be able to acknowledge via the link.')) {
                                closeMut.mutate(c.id);
                              }
                            }}
                            className="text-xs text-slate-500 hover:text-rose-600"
                          >
                            Close
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateCampaignModal
          documents={publishedDocs}
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
          onClose={() => setDetailId(null)}
          onCopy={() => detailQuery.data && copyLink(detailQuery.data)}
          onCloseCampaign={
            detailQuery.data?.status === 'active'
              ? () => {
                  if (window.confirm('Close this attestation? People will no longer be able to acknowledge via the link.')) {
                    closeMut.mutate(detailQuery.data!.id);
                  }
                }
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
      subtitle="Pick a published document, then share the external acknowledgment link"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondaryLg} disabled={mut.isPending}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            className={btnPrimaryLg}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create &amp; get link
          </button>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-5">
        <ol className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
          {[
            { n: '1', t: 'Choose document', d: 'Must already be published.' },
            { n: '2', t: 'Create link', d: 'Anyone with the link can open it.' },
            { n: '3', t: 'Collect acks', d: 'Name, org email, designation, signature.' },
          ].map((s) => (
            <li key={s.n} className="flex gap-2.5">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-semibold text-white">
                {s.n}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">{s.t}</p>
                <p className="text-[11px] leading-snug text-slate-500">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>

        <section>
          <StepLabel n={1} label="Document" />
          <label className={labelClass}>
            Published document <span className="text-rose-500">*</span>
          </label>
          <select
            className={fieldClass}
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value ? Number(e.target.value) : '')}
            autoFocus
          >
            <option value="">Select a published document…</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.current_version ? ` (v${d.current_version})` : ''}
              </option>
            ))}
          </select>
          {documents.length === 0 ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No published documents found. Publish a document under Documents first.
            </p>
          ) : (
            <p className={helperClass}>Only published documents can be attested.</p>
          )}
        </section>

        <section>
          <StepLabel n={2} label="Optional details" />
          <div className="space-y-3">
            <div>
              <label className={labelClass}>
                Campaign name <span className="text-xs font-normal text-slate-400">(optional)</span>
              </label>
              <input
                className={fieldClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q3 policy acknowledgment"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>
                  Due date <span className="text-xs font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="date"
                  className={fieldClass}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>
                Message shown on the link <span className="text-xs font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                className={fieldClass}
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Please review this policy and acknowledge that you have read it."
              />
              <p className={helperClass}>People see this message on the external acknowledgment page.</p>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}

function CampaignDetailModal({
  campaign,
  loading,
  onClose,
  onCopy,
  onCloseCampaign,
  closing,
}: {
  campaign?: Campaign;
  loading: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCloseCampaign?: () => void;
  closing?: boolean;
}) {
  const [sigPreview, setSigPreview] = useState<{ name: string; url: string } | null>(null);
  const acks = campaign?.acknowledgments || [];
  const count = campaign?.acknowledgment_count ?? acks.length;
  const publicUrl = campaign?.public_url || (campaign ? `/attest/${campaign.public_token}` : '');

  return (
    <>
      <AnimatedModal
        isOpen
        onClose={onClose}
        size="xl"
        title={campaign?.name || 'Attestation details'}
        subtitle={
          campaign
            ? `${campaign.document_title || 'Document'} · ${pctLabel(campaign)}`
            : 'Loading campaign…'
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {campaign && (
                <button type="button" onClick={onCopy} className={btnSecondaryLg}>
                  <Link2 className="h-4 w-4" /> Copy external link
                </button>
              )}
              {onCloseCampaign && (
                <button
                  type="button"
                  onClick={onCloseCampaign}
                  disabled={closing}
                  className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {closing && <Loader2 className="h-4 w-4 animate-spin" />}
                  Close campaign
                </button>
              )}
            </div>
            <button type="button" onClick={onClose} className={btnSecondaryLg}>
              Done
            </button>
          </div>
        }
      >
        {loading || !campaign ? (
          <PageLoader className="h-48" />
        ) : (
          <div className="space-y-5 px-5 py-5">
            {/* Summary strip */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</p>
                <div className="mt-1.5">
                  <StatusBadge status={campaign.status} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Coverage</p>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{pctLabel(campaign)}</p>
                {campaign.active_domain_users != null && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    vs {campaign.active_domain_users} active user
                    {campaign.active_domain_users === 1 ? '' : 's'} on domain
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email domain</p>
                <p className="mt-1.5 font-mono text-sm font-medium text-slate-800">
                  {campaign.allowed_email_domain ? `@${campaign.allowed_email_domain}` : '—'}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">Only this domain can acknowledge</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                href={`/governance/documents/${campaign.document_id}`}
                className="inline-flex items-center gap-1.5 font-medium text-primary-700 hover:underline"
              >
                Open document <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              {campaign.due_date && (
                <span className="text-slate-500">· Due {formatWhen(campaign.due_date)}</span>
              )}
            </div>

            {/* External link card */}
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">External acknowledgment link</p>
              <p className="mt-1 text-sm text-slate-600">
                Anyone with this link can review the document and acknowledge — no app login required.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                  {publicUrl}
                </code>
                <button type="button" onClick={onCopy} className={btnSecondary}>
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
                {publicUrl.startsWith('http') && (
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={btnSecondary}
                  >
                    <Eye className="h-3.5 w-3.5" /> Open
                  </a>
                )}
              </div>
              {campaign.message && (
                <p className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {campaign.message}
                </p>
              )}
            </section>

            {/* Acknowledgments */}
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Users className="h-4 w-4 text-slate-500" />
                Acknowledgments
                <span className="font-normal text-slate-500">
                  ({count} {count === 1 ? 'person' : 'people'})
                </span>
              </h3>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="max-h-80 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5">Name</th>
                        <th className="px-3 py-2.5">Email</th>
                        <th className="px-3 py-2.5">Designation</th>
                        <th className="px-3 py-2.5">Signed at</th>
                        <th className="px-3 py-2.5">Signature</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {acks.map((a) => {
                        const sigUrl = a.signature_data_url || null;
                        return (
                          <tr key={a.id} className="hover:bg-slate-50/80">
                            <td className="px-3 py-2.5 font-medium text-slate-900">{a.name}</td>
                            <td className="px-3 py-2.5 text-slate-600">{a.email}</td>
                            <td className="px-3 py-2.5 text-slate-600">{a.designation || '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                              {formatWhen(a.acknowledged_at)}
                            </td>
                            <td className="px-3 py-2.5">
                              {sigUrl ? (
                                <button
                                  type="button"
                                  onClick={() => setSigPreview({ name: a.name, url: sigUrl })}
                                  className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white hover:ring-2 hover:ring-primary-200"
                                  title="View signature"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={sigUrl}
                                    alt={`Signature of ${a.name}`}
                                    className="h-9 w-24 object-contain p-0.5"
                                  />
                                </button>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {acks.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-10 text-center">
                            <Users className="mx-auto h-6 w-6 text-slate-300" />
                            <p className="mt-2 text-sm font-medium text-slate-700">No acknowledgments yet</p>
                            <p className="mt-1 text-xs text-slate-500">
                              Copy the external link and share it so people can acknowledge.
                            </p>
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
        <AnimatedModal
          isOpen
          onClose={() => setSigPreview(null)}
          size="md"
          title={`Signature — ${sigPreview.name}`}
          subtitle="Digital signature captured on acknowledgment"
          footer={
            <div className="flex justify-end">
              <button type="button" onClick={() => setSigPreview(null)} className={btnSecondaryLg}>
                Close
              </button>
            </div>
          }
        >
          <div className="px-5 py-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sigPreview.url}
              alt=""
              className="max-h-72 w-full rounded-xl border border-slate-200 bg-white object-contain p-4"
            />
          </div>
        </AnimatedModal>
      )}
    </>
  );
}
