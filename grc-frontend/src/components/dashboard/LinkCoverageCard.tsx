'use client';

/**
 * CTEM Phase 2.5 — link coverage: the progress meter for the assurance story.
 *
 * Automated evidence can only reach controls that are LINKED to findings, so
 * this card shows coverage honestly and offers the bulk suggest→review→accept
 * flow: preview computes what the curated CWE/threat crosswalk would create
 * (zero writes), a human accepts, and every accepted link carries auto:cwe
 * provenance an auditor can distinguish from manually curated links — the
 * same suggest-confirm philosophy as the CRQM PoS prefill.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { controlAssuranceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { AlertTriangle, CheckCircle, Link2, Loader2, Sparkles } from 'lucide-react';

const TIER_LABELS: Record<string, { label: string; cls: string }> = {
  tested_effective: { label: 'Tested effective', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  tested_failed: { label: 'Test failed', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  remediation_verified: { label: 'Remediation verified', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  stale: { label: 'Stale', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  attested_only: { label: 'Attested only', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

export default function LinkCoverageCard() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vulnerabilities:vulnerability_register:edit');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [acceptResult, setAcceptResult] = useState<any>(null);

  const { data: summary } = useQuery({
    queryKey: ['assurance-evidence-summary'],
    queryFn: async () => (await controlAssuranceApi.evidenceSummary()).data,
  });

  const previewMutation = useMutation({
    mutationFn: async () => (await controlAssuranceApi.bulkAutomapPreview()).data,
    onSuccess: (data) => { setPreview(data); setAcceptResult(null); setError(null); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Preview failed'),
  });

  const acceptMutation = useMutation({
    mutationFn: async () => (await controlAssuranceApi.bulkAutomapAccept()).data,
    onSuccess: (data) => {
      setAcceptResult(data);
      setPreview(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['assurance-evidence-summary'] });
    },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Bulk mapping failed'),
  });

  const cov = summary?.coverage;
  const tiers: Record<string, number> = summary?.tiers || {};

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Link2 className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
          Automated evidence &amp; link coverage
        </h2>
        {canEdit && (
          <button
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary-300 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
          >
            {previewMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5" />}
            Preview suggested links
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500 max-w-3xl">
        Scanner closures and retests can only produce effectiveness evidence for controls
        LINKED to findings — coverage below is the honest progress meter, not a hidden gap.
        Suggestions come from the curated CWE/threat crosswalk; nothing is written until
        you accept, and accepted links keep auto-provenance auditors can distinguish.
      </p>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {cov && (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ['Controls with linked findings', cov.controls_with_linked_findings],
            ['Controls with evidence', cov.controls_with_evidence],
            ['Parsed framework controls', cov.total_parsed_framework_controls],
            ['Internal controls', cov.total_internal_controls],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-center">
              <p className="text-base font-bold text-slate-900 tabular-nums">{v as number}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {Object.keys(tiers).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {Object.entries(tiers).map(([tier, count]) => {
            const t = TIER_LABELS[tier] || TIER_LABELS.attested_only;
            return (
              <span key={tier} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${t.cls}`}>
                {t.label}: {count}
              </span>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-lg border border-primary-200 bg-primary-50/40 p-3 text-xs space-y-2">
          <p className="font-medium text-slate-800">
            {preview.projected_new_links} new link(s) across {preview.findings_gaining_links} finding(s) —{' '}
            {preview.controls_newly_evidence_eligible} control(s) newly evidence-eligible
            (the coverage number above will rise by exactly this),{' '}
            {Math.max((preview.controls_receiving_links || 0) - (preview.controls_newly_evidence_eligible || 0), 0)}{' '}
            already-linked control(s) receiving additional links.
          </p>
          <p className="text-slate-600">
            Why: {preview.basis_counts?.cwe_specific || 0} finding(s) match the CWE crosswalk ·{' '}
            {preview.basis_counts?.vuln_mgmt_rule || 0} carry a CVE (vuln-management controls apply) ·{' '}
            {preview.basis_counts?.kev_rule || 0} are KEV-listed (incident-response controls apply).
          </p>
          {(preview.frameworks || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {preview.frameworks.map((f: any) => (
                <span key={f.framework} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                  {f.framework}: +{f.projected_links} links / {f.controls} controls
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-500">{preview.provenance_note}</p>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending || preview.projected_new_links === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
            >
              {acceptMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle className="h-3.5 w-3.5" />}
              Accept {preview.projected_new_links} suggested link(s)
            </button>
            <button onClick={() => setPreview(null)} className="text-[11px] text-slate-400 hover:text-slate-600">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {acceptResult && (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          Accepted: {acceptResult.links_added} link(s) added, {acceptResult.links_kept} kept,{' '}
          {acceptResult.stale_removed} stale removed across {acceptResult.findings_processed} finding(s).
          {acceptResult.coverage_after && (
            <> Coverage now: {acceptResult.coverage_after.controls_with_linked_findings} control(s) with linked findings.</>
          )}
        </p>
      )}
    </div>
  );
}
