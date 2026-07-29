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
  ClipboardCheck, Plus, Loader2, Link2, Copy, Check, X, Users, ExternalLink,
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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Attestation</h1>
          <p className="text-sm text-slate-500">
            Create an attestation for a published document, share the external link, and track acknowledgments.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" /> New attestation
        </button>
      </div>

      <div className="flex items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns…" className="max-w-xs" />
      </div>

      {isLoading ? (
        <PageLoader className="h-64" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">No attestation campaigns yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Start with a published document, then share the external acknowledgment link.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" /> Create attestation
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Coverage</th>
                <th className="px-4 py-3">Link</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <button onClick={() => setDetailId(c.id)} className="font-medium text-slate-900 hover:text-primary-700">
                      {c.name}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/governance/documents/${c.document_id}`} className="text-slate-600 hover:text-primary-700">
                      {c.document_title || `Document #${c.document_id}`}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                        c.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : c.status === 'closed'
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{pctLabel(c)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => copyLink(c)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white"
                      title="Copy external link"
                    >
                      {copiedId === c.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      Copy link
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => setDetailId(c.id)} className="text-xs font-medium text-primary-700 hover:underline">
                        Details
                      </button>
                      {c.status === 'active' && (
                        <button
                          onClick={() => closeMut.mutate(c.id)}
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
            toast({ type: 'success', title: 'Attestation created', message: 'Share the external link with your organization.' });
          }}
        />
      )}

      {detailId != null && (
        <CampaignDetailModal
          campaign={detailQuery.data}
          loading={detailQuery.isLoading}
          onClose={() => setDetailId(null)}
          onCopy={() => detailQuery.data && copyLink(detailQuery.data)}
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
    onError: (e: any) => setError(e?.response?.data?.detail || e?.message || 'Create failed'),
  });

  return (
    <AnimatedModal isOpen onClose={onClose} title="New attestation" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Choose a published document. You will get an external link anyone can open — they acknowledge with
          name, organization email, designation, and signature (no app login).
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Published document</label>
          <select
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Select…</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}{d.current_version ? ` (v${d.current_version})` : ''}
              </option>
            ))}
          </select>
          {documents.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">No published documents found. Publish a document first.</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Campaign name (optional)</label>
          <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 policy acknowledgment" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Due date (optional)</label>
            <input type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Message (optional)</label>
          <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please review and acknowledge this policy." />
        </div>
        {error && <p className="text-sm text-rose-600">{typeof error === 'string' ? error : JSON.stringify(error)}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            disabled={mut.isPending}
            onClick={() => { setError(null); mut.mutate(); }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create &amp; get link
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}

function CampaignDetailModal({
  campaign,
  loading,
  onClose,
  onCopy,
}: {
  campaign?: Campaign;
  loading: boolean;
  onClose: () => void;
  onCopy: () => void;
}) {
  const [sigPreview, setSigPreview] = useState<{ name: string; url: string } | null>(null);
  const acks = campaign?.acknowledgments || [];
  const count = campaign?.acknowledgment_count ?? acks.length;

  return (
    <AnimatedModal isOpen onClose={onClose} title={campaign?.name || 'Campaign'} size="xl">
      {loading || !campaign ? (
        <PageLoader className="h-40" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Link href={`/governance/documents/${campaign.document_id}`} className="inline-flex items-center gap-1 text-primary-700 hover:underline">
              {campaign.document_title || 'Open document'} <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <span>·</span>
            <span className="font-medium text-slate-800">{pctLabel(campaign)}</span>
            <span>·</span>
            <span className="capitalize">{campaign.status}</span>
            {campaign.allowed_email_domain && (
              <>
                <span>·</span>
                <span className="font-mono text-xs text-slate-500">@{campaign.allowed_email_domain}</span>
              </>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">External link</p>
                <p className="mt-1 truncate font-mono text-xs text-slate-700">
                  {campaign.public_url || `/attest/${campaign.public_token}`}
                </p>
              </div>
              <button onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                <Link2 className="h-3.5 w-3.5" /> Copy link
              </button>
            </div>
            {campaign.message && <p className="mt-2 text-sm text-slate-600">{campaign.message}</p>}
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <Users className="h-4 w-4" /> Acknowledgments
              <span className="font-normal text-slate-500">
                ({count} {count === 1 ? 'person' : 'people'} acknowledged)
              </span>
            </h3>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Designation</th>
                    <th className="px-3 py-2">Signed at</th>
                    <th className="px-3 py-2">Signature</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {acks.map((a) => {
                    const sigUrl = a.signature_data_url || null;
                    return (
                      <tr key={a.id}>
                        <td className="px-3 py-2 font-medium text-slate-800">{a.name}</td>
                        <td className="px-3 py-2 text-slate-600">{a.email}</td>
                        <td className="px-3 py-2 text-slate-600">{a.designation || '—'}</td>
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatWhen(a.acknowledged_at)}</td>
                        <td className="px-3 py-2">
                          {sigUrl ? (
                            <button
                              type="button"
                              onClick={() => setSigPreview({ name: a.name, url: sigUrl })}
                              className="inline-flex items-center overflow-hidden rounded border border-slate-200 bg-white hover:ring-2 hover:ring-primary-200"
                              title="View signature"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={sigUrl} alt={`Signature of ${a.name}`} className="h-8 w-20 object-contain" />
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
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                        No acknowledgments yet. Share the external link to collect them.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={onClose} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <X className="h-4 w-4" /> Close
            </button>
          </div>

          {sigPreview && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
              onClick={() => setSigPreview(null)}
            >
              <div
                className="max-w-lg rounded-xl bg-white p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="mb-2 text-sm font-medium text-slate-800">Signature — {sigPreview.name}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sigPreview.url} alt="" className="max-h-64 w-full rounded border border-slate-200 bg-white object-contain" />
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSigPreview(null)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AnimatedModal>
  );
}
