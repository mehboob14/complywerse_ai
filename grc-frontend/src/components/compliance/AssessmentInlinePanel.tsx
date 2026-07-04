'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  FileText,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Minus,
} from 'lucide-react';

interface InlineItem {
  id: number;
  item_number: string;
  area_domain: string | null;
  control_description: string | null;
  compliance_status: string;
  gaps_identified: string | null;
  proposed_solution: string | null;
  responsible_party: string | null;
  timeline: string | null;
  priority: string | null;
  evidence_reference: string | null;
  remarks: string | null;
}

interface InlineResponse {
  id: number;
  name: string;
  assessment_format?: string;
  items_by_domain: Record<string, InlineItem[]>;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string; icon: typeof CheckCircle }> = {
  complied: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', label: 'Complied', icon: CheckCircle },
  partially_complied: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', label: 'Partial', icon: AlertTriangle },
  not_complied: { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', label: 'Not Complied', icon: XCircle },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200', label: 'In Progress', icon: Clock },
  na: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', label: 'N/A', icon: Minus },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  critical: { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', dot: 'bg-rose-500', label: 'Critical' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500', label: 'High' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-500', label: 'Medium' },
  low: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500', label: 'Low' },
};

function scoreBarColor(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function getDomainDisplayName(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (!normalized || normalized === 'uncategorized') return 'Requirements';
  return domain;
}

function getAuditMasterDomainGroup(domain: string): string {
  const value = (domain || '').trim();
  if (!value) return 'Uncategorized';
  const separatorIndex = value.indexOf(' - ');
  if (separatorIndex <= 0) return value;
  return value.slice(0, separatorIndex).trim() || value;
}

function formatTimeline(timeline: string | null): string {
  if (!timeline) return '—';
  const parsed = new Date(timeline);
  if (Number.isNaN(parsed.getTime())) return timeline;
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Nested read-only accordion for one assessment, rendered inline in the
 * assessments list: domains → items table (inventory-style) → item detail
 * table. Heavy editing / evidence / AI live on the full detail page, linked
 * via "Open full editor".
 */
export default function AssessmentInlinePanel({
  assessmentId,
  assessmentFormat,
}: {
  assessmentId: number;
  assessmentFormat?: string;
}) {
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const { data, isLoading, error } = useQuery<InlineResponse>({
    queryKey: ['assessment-inline', assessmentId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}`)).data,
    staleTime: 30_000,
  });

  const isAuditMaster = (assessmentFormat || data?.assessment_format) === 'ubl_audit_master_tracking';

  const domainEntries = useMemo(() => {
    const byDomain = data?.items_by_domain || {};
    const rawDomains = Object.keys(byDomain);
    if (!isAuditMaster) {
      return rawDomains.map((domain) => ({ key: domain, name: getDomainDisplayName(domain), items: byDomain[domain] || [] }));
    }
    const grouped: Record<string, InlineItem[]> = {};
    for (const domain of rawDomains) {
      const groupKey = getAuditMasterDomainGroup(domain);
      if (!grouped[groupKey]) grouped[groupKey] = [];
      grouped[groupKey].push(...(byDomain[domain] || []));
    }
    return Object.entries(grouped).map(([groupKey, items]) => ({ key: groupKey, name: getDomainDisplayName(groupKey), items }));
  }, [data, isAuditMaster]);

  const toggleDomain = (key: string) =>
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleItem = (id: number) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="px-4 py-6 text-center text-sm text-slate-500">Failed to load assessment details.</div>;
  }

  if (domainEntries.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No assessment items found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{domainEntries.length} domains</p>
        <Link
          href={`/compliance/assessments/${assessmentId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
        >
          Open full editor <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {domainEntries.map((domainEntry) => {
        const domain = domainEntry.key;
        const items = domainEntry.items;
        const isDomainOpen = expandedDomains.has(domain);
        const complied = items.filter((i) => i.compliance_status === 'complied').length;
        const pct = items.length > 0 ? Math.round((complied / items.length) * 100) : 0;

        return (
          <div key={domain} className="overflow-hidden rounded-lg border border-slate-200">
            {/* Domain header (level 2 accordion) */}
            <button
              type="button"
              onClick={() => toggleDomain(domain)}
              aria-expanded={isDomainOpen}
              className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500">
                  {isDomainOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <span className="truncate text-sm font-semibold text-slate-800">{domainEntry.name}</span>
                <span className="shrink-0 text-xs text-slate-400">({items.length} items)</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                  <div className={`h-full ${scoreBarColor(pct)}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-9 text-right text-xs font-medium text-slate-500">{pct}%</span>
              </div>
            </button>

            {/* Items table (level 3) */}
            {isDomainOpen && (
              <div className="overflow-x-auto border-t border-slate-200 bg-white">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '40px' }} />
                    <col style={{ width: '52px' }} />
                    <col />
                    <col className="hidden lg:table-column" style={{ width: '150px' }} />
                    <col className="hidden lg:table-column" style={{ width: '120px' }} />
                    <col style={{ width: '132px' }} />
                    <col className="hidden md:table-column" style={{ width: '104px' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">Control</th>
                      <th className="hidden px-2 py-2 lg:table-cell">Responsible</th>
                      <th className="hidden px-2 py-2 lg:table-cell">Timeline</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="hidden px-2 py-2 md:table-cell">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const st = STATUS_STYLES[item.compliance_status] || STATUS_STYLES.in_progress;
                      const StatusIcon = st.icon;
                      const p = PRIORITY_STYLES[(item.priority || '').toLowerCase()];
                      const isItemOpen = expandedItems.has(item.id);
                      return (
                        <Fragment key={item.id}>
                          <tr
                            className="cursor-pointer align-top transition-colors hover:bg-slate-50"
                            onClick={() => toggleItem(item.id)}
                          >
                            <td className="px-2 py-2.5">
                              <span className="flex h-6 w-6 items-center justify-center rounded text-slate-400">
                                {isItemOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </span>
                            </td>
                            <td className="truncate px-2 py-2.5 font-mono text-xs text-slate-400">{item.item_number}</td>
                            <td className="px-2 py-2.5">
                              <p className="line-clamp-2 text-sm leading-snug text-slate-800">{item.control_description}</p>
                            </td>
                            <td className="hidden truncate px-2 py-2.5 text-xs text-slate-600 lg:table-cell" title={item.responsible_party || undefined}>
                              {item.responsible_party || '—'}
                            </td>
                            <td className="hidden truncate px-2 py-2.5 text-xs text-slate-600 lg:table-cell">{formatTimeline(item.timeline)}</td>
                            <td className="px-2 py-2.5">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.bg} ${st.text} ${st.border}`}>
                                <StatusIcon className="h-3 w-3 shrink-0" /> <span className="truncate">{st.label}</span>
                              </span>
                            </td>
                            <td className="hidden px-2 py-2.5 md:table-cell">
                              {p ? (
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${p.bg} ${p.text} ${p.border}`}>
                                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.dot}`} />
                                  {p.label}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>

                          {/* Item detail (level 4) — TABLE, not a form */}
                          {isItemOpen && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={7} className="px-3 pb-3 pt-1">
                                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                  <table className="w-full table-fixed text-sm">
                                    <colgroup>
                                      <col style={{ width: '180px' }} />
                                      <col />
                                    </colgroup>
                                    <tbody className="divide-y divide-slate-100">
                                      <DetailRow label="Control / Audit Point" value={item.control_description} wrap />
                                      <DetailRow label="Responsible Party" value={item.responsible_party} />
                                      <DetailRow label="Timeline" value={formatTimeline(item.timeline)} />
                                      <DetailRow
                                        label="Priority"
                                        value={p ? p.label : item.priority}
                                        capitalize
                                      />
                                      <DetailRow label="Area / Domain" value={item.area_domain} />
                                      <DetailRow label="Remarks" value={item.remarks} wrap />
                                      <DetailRow label="Gaps Identified" value={item.gaps_identified} wrap muted="No gaps recorded" />
                                      <DetailRow label="Proposed Solution" value={item.proposed_solution} wrap muted="No proposed solution" />
                                      <DetailRow label="Evidence Reference" value={item.evidence_reference} />
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({
  label,
  value,
  wrap,
  capitalize,
  muted,
}: {
  label: string;
  value: string | null | undefined;
  wrap?: boolean;
  capitalize?: boolean;
  muted?: string;
}) {
  const hasValue = value !== null && value !== undefined && String(value).trim() !== '';
  return (
    <tr className="align-top">
      <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">{label}</th>
      <td className={`px-3 py-2 text-sm text-slate-700 ${wrap ? 'whitespace-pre-line' : 'truncate'} ${capitalize ? 'capitalize' : ''}`}>
        {hasValue ? value : <span className="italic text-slate-400">{muted || '—'}</span>}
      </td>
    </tr>
  );
}
