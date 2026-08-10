'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { vulnManagementApi, controlAssuranceApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import {
  ArrowLeft,
  AlertCircle,
  Shield,
  Sparkles,
  ExternalLink,
  Bug,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Framework-control detail page
// ---------------------------------------------------------------------------
// The compliance side of the "every vuln tells you which control is failing,
// and every control tells you which vulns are its evidence" loop. Reached
// by clicking the framework chip or control code on a vuln's Controls tab.
//
// All data comes from one endpoint —
//   GET /vuln-management/framework-controls/{id}/vulnerability-evidence
// — which returns the control header + summary + items in a single payload.

interface ControlHeader {
  id: number;
  code: string;
  name: string;
  statement?: string | null;
  control_objective?: string | null;
  framework_short_code?: string | null;
  framework_name?: string | null;
}

interface EvidenceSummary {
  open_count: number;
  kev_count: number;
  max_composite_priority: number;
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

interface EvidenceItem {
  id: number;
  vuln_id?: string | null;
  title: string;
  cve_id?: string | null;
  cwe_id?: string | null;
  severity?: string | null;
  status?: string | null;
  kev_flag: boolean;
  composite_priority?: number | null;
  public_exploit_count?: number | null;
  source?: 'manual' | 'auto_cwe' | string | null;
  auto_cwe?: string | null;
  compliance_impact?: string | null;
  link_id: number;
  link_created_at?: string | null;
}

interface EvidenceResponse {
  control: ControlHeader;
  summary: EvidenceSummary;
  items: EvidenceItem[];
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-rose-50 border-rose-200',     text: 'text-rose-700',    label: 'Critical' },
  high:     { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-700', label: 'High' },
  medium:   { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'Medium' },
  low:      { bg: 'bg-emerald-50 border-emerald-200',   text: 'text-emerald-700',   label: 'Low' },
  info:     { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600',  label: 'Info' },
};

const RESOLVED_STATUSES = new Set([
  'resolved', 'remediated', 'verified', 'closed',
  'accepted', 'false_positive', 'auto_closed_decommissioned',
]);

// CTEM Phase 2 — automated-assurance tier styling (derived server-side from
// closure/retest evidence; basis sentence rides in the tooltip).
const ASSURANCE_PILL: Record<string, { cls: string; label: string }> = {
  tested_effective: { cls: 'border-emerald-300 bg-emerald-50 text-emerald-700', label: 'Tested effective' },
  tested_failed: { cls: 'border-rose-300 bg-rose-50 text-rose-700', label: 'Test failed' },
  remediation_verified: { cls: 'border-sky-300 bg-sky-50 text-sky-700', label: 'Remediation verified' },
  stale: { cls: 'border-amber-300 bg-amber-50 text-amber-700', label: 'Stale' },
  attested_only: { cls: 'border-slate-200 bg-slate-50 text-slate-500', label: 'Attested only' },
};

function severityBadge(sev?: string | null) {
  const k = (sev || 'info').toLowerCase();
  const s = SEVERITY_STYLES[k] || SEVERITY_STYLES.info;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

export default function FrameworkControlDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const controlId = Number(params?.id);
  // `?type=parsed` (default) targets ParsedFrameworkControl (where the
  // upload-seeded frameworks live); `?type=legacy` targets the older
  // FrameworkControl chain. Determined by which FK the link row carries.
  const controlType: 'parsed' | 'legacy' =
    searchParams?.get('type') === 'legacy' ? 'legacy' : 'parsed';
  const [includeResolved, setIncludeResolved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['framework-control-evidence', controlId, controlType, includeResolved],
    queryFn: async () => {
      const res = await vulnManagementApi.controlLinks.listEvidenceForControl(
        controlId, includeResolved, controlType,
      );
      return res.data as EvidenceResponse;
    },
    enabled: Number.isFinite(controlId) && controlId > 0,
  });

  // CTEM Phase 2 — automated effectiveness evidence (parsed controls carry
  // the vuln links today; legacy-type pages simply skip the panel).
  const { data: assurance } = useQuery({
    queryKey: ['control-assurance-evidence', controlId, controlType],
    queryFn: async () =>
      (await controlAssuranceApi.controlEvidence('parsed_framework_control', controlId)).data,
    enabled: Number.isFinite(controlId) && controlId > 0 && controlType === 'parsed',
  });

  if (!Number.isFinite(controlId) || controlId <= 0) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Invalid control id.
        </div>
      </div>
    );
  }
  if (isLoading) return <PageLoader className="h-64" />;
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Failed to load framework control. The control may not exist or you may not have access.
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { control, summary, items } = data;

  return (
    <div className="px-3 sm:px-6 py-4 space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={12} />
          Back
        </button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {control.framework_short_code && (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                  {control.framework_short_code}
                </span>
              )}
              <span className="text-xs font-mono text-slate-600">{control.code}</span>
            </div>
            <h1 className="text-lg font-semibold text-slate-900 leading-snug">
              {control.name}
            </h1>
            {control.framework_name && (
              <p className="text-xs text-slate-500 mt-0.5">{control.framework_name}</p>
            )}
          </div>
        </div>
      </div>

      {/* CTEM Phase 2 — automated assurance: tier + dated evidence rows */}
      {assurance && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
              Automated assurance
            </h2>
            {(() => {
              const pill = ASSURANCE_PILL[assurance.tier] || ASSURANCE_PILL.attested_only;
              return (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill.cls}`}>
                  {pill.label}
                  {assurance.last_tested_at && ` · ${new Date(assurance.last_tested_at).toLocaleDateString()}`}
                </span>
              );
            })()}
          </div>
          <p className="mt-1 text-xs text-slate-500">{assurance.basis}</p>
          {(assurance.evidence || []).length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100">
              {assurance.evidence.slice(0, 8).map((e: any) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="text-slate-700">
                    {e.source_type === 'scanner_closure' ? 'Scanner-verified closure' : 'Finding retest'}
                    {e.details?.scan_name ? ` · ${e.details.scan_name}` : ''}
                    {e.details?.vuln_id ? ` · ${e.details.vuln_id}` : ''}
                    {Array.isArray(e.details?.link_basis) && e.details.link_basis.includes('kev_rule') && (
                      <span
                        className="ml-1.5 inline-flex rounded-full bg-amber-50 px-1.5 py-0 text-[10px] font-semibold text-amber-700"
                        title="This control was linked by the KEV always-applicable rule — the closure proves the finding was fixed, which is weaker evidence for an incident-response control than for a patch-management one. Discount accordingly."
                      >
                        via KEV rule
                      </span>
                    )}
                    {Array.isArray(e.details?.link_basis) && !e.details.link_basis.includes('kev_rule')
                      && e.details.link_basis.includes('vuln_mgmt_rule') && !e.details.link_basis.includes('cwe_crosswalk') && (
                      <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-semibold text-slate-500"
                        title="Linked by the always-applicable vulnerability-management rule (any CVE-bearing finding).">
                        via vuln-mgmt rule
                      </span>
                    )}
                  </span>
                  <span className="shrink-0">
                    <span className={`mr-2 inline-flex rounded-full px-1.5 py-0 text-[10px] font-semibold uppercase ${
                      e.result === 'pass' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}>
                      {e.result}
                    </span>
                    <span className="text-slate-400">
                      {e.tested_at ? new Date(e.tested_at).toLocaleDateString() : '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(assurance.evidence || []).length === 0 && (
            <p className="mt-2 text-xs text-slate-400">
              No automated evidence yet — it accrues when a re-scan verifiably closes a linked
              finding or a retest is logged against one.
            </p>
          )}
        </div>
      )}

      {/* Description */}
      {(control.statement || control.control_objective) && (
        <div className="cw-card p-4 space-y-2">
          {control.statement && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Statement
              </p>
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                {control.statement}
              </p>
            </div>
          )}
          {control.control_objective && control.control_objective !== control.statement && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Control Objective
              </p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {control.control_objective}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Vulnerability Evidence section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-rose-600" />
              Vulnerability Evidence
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              {includeResolved
                ? 'Every vulnerability linked to this control, including historical / resolved rows.'
                : 'Open vulnerabilities currently failing this control. Closing them lifts the control out of non-compliant status.'}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            Include resolved
          </label>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="cw-card p-3 border-l-4 border-l-slate-400">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {includeResolved ? 'Total' : 'Open'}
            </p>
            <p className="text-xl font-bold text-slate-900 mt-1">{summary.open_count}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">vulnerabilities linked</p>
          </div>
          <div className={`cw-card p-3 border-l-4 ${summary.kev_count > 0 ? 'border-l-red-500' : 'border-l-slate-300'}`}>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Actively Exploited
            </p>
            <p className={`text-xl font-bold mt-1 ${summary.kev_count > 0 ? 'text-rose-700' : 'text-slate-400'}`}>
              {summary.kev_count}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">CISA KEV-listed</p>
          </div>
          <div className="cw-card p-3 border-l-4 border-l-orange-400">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Max Priority
            </p>
            <p className="text-xl font-bold text-orange-700 mt-1">
              {summary.max_composite_priority > 0
                ? summary.max_composite_priority.toFixed(2)
                : '—'}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">composite, 0–10</p>
          </div>
          <div className="cw-card p-3 border-l-4 border-l-amber-400">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Severity Mix
            </p>
            <div className="flex flex-wrap gap-1">
              {(['critical','high','medium','low','info'] as const).map((k) => {
                const n = summary.by_severity[k] ?? 0;
                if (n === 0) return null;
                const s = SEVERITY_STYLES[k];
                return (
                  <span
                    key={k}
                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold ${s.bg} ${s.text}`}
                  >
                    {n} {s.label}
                  </span>
                );
              })}
              {summary.open_count === 0 && (
                <span className="text-[10px] text-slate-400">—</span>
              )}
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="cw-card overflow-hidden">
          {items.length === 0 ? (
            <div className="p-8 text-center">
              <Bug className="mx-auto h-7 w-7 text-emerald-500 mb-2" />
              <p className="text-sm text-slate-700 font-medium">
                {includeResolved
                  ? 'No vulnerabilities have ever been linked to this control.'
                  : 'No open vulnerabilities are currently linked to this control.'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {includeResolved
                  ? 'This control has a clean audit trail across the full lookup window.'
                  : 'This control is not currently failing because of any tracked vulnerability.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">Title</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">CVE</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">Severity</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-600">Priority</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">CWE</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">Source</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600">Status</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((it) => {
                    const isAuto = it.source === 'auto_cwe';
                    const resolved = RESOLVED_STATUSES.has((it.status || '').toLowerCase());
                    return (
                      <tr key={it.link_id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-sm">
                          <Link
                            href={`/vulnerabilities/${it.id}`}
                            className="text-slate-900 hover:text-primary-600 hover:underline font-medium"
                          >
                            {it.title}
                          </Link>
                          {it.kev_flag && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-rose-50 px-1.5 py-0 text-[9px] font-bold text-rose-700 border border-rose-200">
                              KEV
                            </span>
                          )}
                          {it.vuln_id && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{it.vuln_id}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-600">
                          {it.cve_id || '—'}
                        </td>
                        <td className="px-3 py-2">{severityBadge(it.severity)}</td>
                        <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          {typeof it.composite_priority === 'number'
                            ? it.composite_priority.toFixed(2)
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-600">
                          {it.cwe_id || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {isAuto ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700"
                              title={`Auto-mapped from ${it.auto_cwe || 'vulnerability-management rules'}`}
                            >
                              <Sparkles size={9} />
                              Auto{it.auto_cwe ? ` • ${it.auto_cwe}` : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {resolved ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              {it.status || 'resolved'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                              {it.status || 'open'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/vulnerabilities/${it.id}`}
                            className="text-slate-400 hover:text-primary-600"
                            title="Open vulnerability"
                          >
                            <ExternalLink size={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer hint — explains how rows get here. */}
        <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-600 flex items-start gap-2">
          <AlertCircle size={14} className="text-slate-500 flex-shrink-0 mt-0.5" />
          <div>
            Rows arrive here in two ways: <strong>Auto</strong> — the CWE auto-mapper linked
            them when an open vulnerability of that CWE was enriched; <strong>Manual</strong> —
            a vulnerability owner explicitly linked this control through the vuln&apos;s Controls tab.
            Deleting a link from the vuln&apos;s Controls tab also removes it here.
          </div>
        </div>
      </div>
    </div>
  );
}
