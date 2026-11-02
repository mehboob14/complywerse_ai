'use client';

import { PageLoader } from '@/cyber-assurance/components/ui';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { advisoriesApi } from '@/cyber-assurance/lib/api';
import {
  AlertCircle, ArrowLeft, ExternalLink, Loader2, Plus, Trash2, CheckCircle2, Play,
} from 'lucide-react';
import {
  AdvisoryView,
  SeverityBadge,
  StatusBadge,
  ExtractionPipeline,
  FlowStrip,
  HistoryTimeline,
  RichText,
  VulnCard,
  MatchReport,
  MatchReportData,
  RegionPicker,
} from '../_components/ui';

interface EditableCve {
  cve_id: string;
  affected_product: string;
  affected_versions: string;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// What to call the "entered the system" date, by how the advisory arrived.
// Feeds are synced, not ingested/parsed, so the KEV/RSS case reads "Synced".
const ENTRY_LABEL: Record<string, string> = {
  upload: 'Uploaded',
  scrape: 'Ingested',
  api: 'Synced',
  manual: 'Added',
};

// Absolute date with year; '—' when absent.
function fmtDate(at?: string | null): string {
  if (!at) return '—';
  const dt = new Date(at);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Uploads are labelled by their parsed issuer (external_id prefix), not a generic
// "Uploaded document"; synced advisories keep their source name.
function sourceLabel(a: AdvisoryView): string {
  if (a.origin === 'upload') {
    const ext = (a.external_id || '').trim();
    const issuer = ext.replace(/\d.*$/, '').replace(/[-_.:\s]+$/, '').trim();
    return issuer || ext || 'Uploaded document';
  }
  return a.source_name || 'Unknown source';
}

export default function AdvisoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const { data: advisory, isLoading, error } = useQuery({
    queryKey: ['advisory', id],
    queryFn: async () => {
      const response = await advisoriesApi.getById(id);
      return response.data as AdvisoryView;
    },
    enabled: Number.isFinite(id),
  });

  const isPending = advisory?.status === 'pending';

  const [reviewCves, setReviewCves] = useState<EditableCve[]>([]);
  const [severity, setSeverity] = useState('critical');

  // Seed the review editor from the extracted CVEs once the pending advisory loads.
  useEffect(() => {
    if (advisory && isPending) {
      setReviewCves(
        (advisory.cves ?? []).map((c) => ({
          cve_id: c.cve_id,
          affected_product: c.affected_product ?? '',
          affected_versions: c.affected_versions ?? '',
        })),
      );
      setSeverity(advisory.severity || 'critical');
    }
  }, [advisory, isPending]);

  const [report, setReport] = useState<MatchReportData | null>(null);
  const [reportSessionId, setReportSessionId] = useState<number | null>(null);
  // Pick specific CVEs to match, or match the whole advisory when none are picked.
  const [selCve, setSelCve] = useState<Set<number>>(new Set());
  const toggleCve = (cid: number) => setSelCve((p) => {
    const n = new Set(p); if (n.has(cid)) n.delete(cid); else n.add(cid); return n;
  });
  const matchMutation = useMutation({
    mutationFn: () => advisoriesApi.match(
      selCve.size > 0 ? { cve_ids: Array.from(selCve), mode: 'all' } : { advisory_ids: [id], mode: 'all' }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['advisory', id] });
      queryClient.invalidateQueries({ queryKey: ['advisories'] });
      setReport(res.data.report as MatchReportData);
      setReportSessionId(res.data.session_id ?? null);
    },
  });
  const downloadReport = async (fmt: 'csv' | 'json') => {
    if (reportSessionId === null) return;
    try {
      const res = await advisoriesApi.downloadMatchSession(reportSessionId, fmt);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `match-session-${reportSessionId}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const confirmMutation = useMutation({
    mutationFn: () =>
      advisoriesApi.confirm(id, {
        severity,
        cves: reviewCves
          .filter((c) => c.cve_id.trim())
          .map((c) => ({
            cve_id: c.cve_id.trim(),
            affected_product: c.affected_product.trim() || undefined,
            affected_versions: c.affected_versions.trim() || undefined,
          })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advisory', id] });
      queryClient.invalidateQueries({ queryKey: ['advisories'] });
    },
  });

  const updateCve = (idx: number, field: keyof EditableCve, value: string) => {
    setReviewCves((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <PageLoader size="md" />
      </div>
    );
  }

  if (error || !advisory) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Advisory not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <button
        onClick={() => router.push('/cyber-assurance/advisories')}
        className="flex items-center gap-1.5 text-sm cw-text-muted hover:cw-text-default"
      >
        <ArrowLeft size={16} /> Advisories
      </button>

      <div className="cw-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">
              Advisory{advisory.region && advisory.region !== 'Unclassified' ? ` · ${advisory.region}` : ''}
            </p>
            {advisory.region === 'Unclassified' && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-yellow-700">Region not detected —</span>
                <RegionPicker advisoryId={advisory.id} current={advisory.region} />
              </div>
            )}
            <h1 className="mt-1 text-base font-semibold leading-snug cw-text-default">{advisory.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={advisory.severity} />
              <StatusBadge status={advisory.status} />
              {advisory.url && (
                <a href={advisory.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline">
                  <ExternalLink size={12} /> Source
                </a>
              )}
            </div>
          </div>
        </div>

        {advisory.summary && <div className="mt-3"><RichText text={advisory.summary} /></div>}

        {advisory.flow && (
          <div className="mt-3">
            <h3 className="mb-2 text-sm font-semibold cw-text-default">Lifecycle</h3>
            <FlowStrip flow={advisory.flow} />
          </div>
        )}

        {!isPending && (
          <>
            {/* Metadata as compact cards (dashboard/inventory style), not a table. */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {([
                ['Published', fmtDate(advisory.published_at)],
                // Updated == Synced for a feed, so show one date: "Last synced".
                [ENTRY_LABEL[advisory.origin ?? ''] ?? 'Last synced',
                  fmtDate(advisory.origin === 'upload' || advisory.origin === 'manual'
                    ? advisory.created_at : advisory.updated_at)],
                ['CVEs', String(advisory.cve_count)],
                ['Assets affected', `${advisory.asset_affected_count} / ${advisory.asset_total_count}`],
                ['Source', sourceLabel(advisory)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide cw-text-muted">{label}</p>
                  <p className="mt-0.5 truncate text-sm font-semibold cw-text-default" title={value}>{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] cw-text-muted">
              ID <span className="font-mono cw-text-default">{advisory.external_id || '—'}</span>
            </p>
          </>
        )}
      </div>

      {isPending ? (
        <div className="cw-card space-y-3 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-yellow-600" />
            <h2 className="text-sm font-semibold cw-text-default">Review extracted CVEs</h2>
          </div>
          <p className="text-xs leading-relaxed cw-text-muted">
            These CVEs were read from the document by the multi-stage parser (see the pipeline above —
            the vision stage recovers CVEs the text layer misses in tables). Check them, fill in product
            and versions, then confirm to start tracking and matching against your assets.
          </p>

          <div className="flex items-center gap-2.5">
            <label className="text-[11px] font-semibold cw-text-muted">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs cw-text-default"
            >
              {SEVERITIES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>

          <div className="space-y-2">
            {reviewCves.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={c.cve_id}
                  onChange={(e) => updateCve(idx, 'cve_id', e.target.value)}
                  placeholder="CVE-0000-0000"
                  className="w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-mono cw-text-default"
                />
                <input
                  value={c.affected_product}
                  onChange={(e) => updateCve(idx, 'affected_product', e.target.value)}
                  placeholder="product (e.g. php)"
                  className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs cw-text-default"
                />
                <input
                  value={c.affected_versions}
                  onChange={(e) => updateCve(idx, 'affected_versions', e.target.value)}
                  placeholder="versions (e.g. < 8.2.35)"
                  className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs cw-text-default"
                />
                <button
                  onClick={() => setReviewCves((prev) => prev.filter((_, i) => i !== idx))}
                  className="rounded-lg p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:text-red-600"
                  title="Remove"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setReviewCves((prev) => [...prev, { cve_id: '', affected_product: '', affected_versions: '' }])}
              className="btn-secondary flex items-center gap-1 text-xs"
            >
              <Plus size={14} /> Add CVE
            </button>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || !reviewCves.some((c) => c.cve_id.trim())}
              className="btn-primary flex items-center gap-2"
            >
              {confirmMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Confirm &amp; track
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="cw-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold cw-text-default">Vulnerabilities in this advisory</h2>
                <p className="mt-0.5 text-[11px] cw-text-muted">
                  The CVEs this advisory warns about — tick any to match just those, or run the match on all of them.
                </p>
              </div>
              <button onClick={() => matchMutation.mutate()} disabled={matchMutation.isPending}
                className="btn-primary flex shrink-0 items-center gap-2 text-sm">
                {matchMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {selCve.size > 0 ? `Match ${selCve.size} CVE${selCve.size === 1 ? '' : 's'}` : 'Run match'}
              </button>
            </div>
            {(advisory.cves ?? []).length > 0 && (
              <div className="mt-2 flex items-center gap-3 text-[11px] cw-text-muted">
                <button onClick={() => setSelCve(new Set((advisory.cves ?? []).map((c) => c.id)))}
                  className="hover:cw-text-default">Select all</button>
                {selCve.size > 0 && (
                  <button onClick={() => setSelCve(new Set())} className="hover:cw-text-default">Clear</button>
                )}
              </div>
            )}
            <div className="mt-3 space-y-2">
              {(advisory.cves ?? []).length === 0 ? (
                <p className="text-xs cw-text-muted">No CVEs on this advisory.</p>
              ) : (
                (advisory.cves ?? []).map((cve) => (
                  <VulnCard key={cve.id} cve={cve}
                    selected={selCve.has(cve.id)} onToggleSelect={() => toggleCve(cve.id)} />
                ))
              )}
            </div>
          </div>
          {report && (
            <div className="cw-card p-3">
              <MatchReport report={report} title="Match report"
                onBack={() => setReport(null)}
                onDownload={reportSessionId !== null ? downloadReport : undefined} />
            </div>
          )}
        </div>
      )}

      {advisory.history && advisory.history.length > 0 && (
        <HistoryTimeline events={advisory.history} />
      )}

      {advisory.extraction && <ExtractionPipeline report={advisory.extraction} />}
    </div>
  );
}
