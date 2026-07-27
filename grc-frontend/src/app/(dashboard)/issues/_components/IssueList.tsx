'use client';

// Filterable, sortable Enterprise Issue Log. Used as-is for the main Log
// tab and with a `defaultFilters` preset for the Contract Compliance tab.

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Search, Filter, AlertCircle, Loader2 } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { SeverityChip, StateChip, SourceChip, formatDate, daysFromNow, ISSUE_TYPES, CATEGORIES } from './shared';

interface IssueRow {
  id: number;
  code: string | null;
  title: string;
  severity: string | null;
  workflow_state: string;
  issue_type: string | null;
  category: string | null;
  impact: string | null;
  urgency: string | null;
  source_type: string | null;
  assignee: { id?: number; display_name?: string | null; email?: string | null } | null;
  target_closure_date: string | null;
  sla_breached: boolean;
  created_at: string;
}

interface Props {
  /** Pre-filter for the Contract Compliance tab. Merged with user filters. */
  defaultFilters?: {
    category?: string;
    issue_type?: string;
  };
}

export function IssueList({ defaultFilters }: Props) {
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [workflowState, setWorkflowState] = useState('');
  const [issueType, setIssueType] = useState(defaultFilters?.issue_type || '');
  const [category, setCategory] = useState(defaultFilters?.category || '');
  const [slaOnly, setSlaOnly] = useState(false);

  const params = useMemo(() => {
    const p: Record<string, unknown> = { limit: 200 };
    if (search.trim()) p.search = search.trim();
    if (severity) p.severity = severity;
    if (workflowState) p.workflow_state = workflowState;
    if (issueType) p.issue_type = issueType;
    if (category) p.category = category;
    if (slaOnly) p.sla_breached = true;
    return p;
  }, [search, severity, workflowState, issueType, category, slaOnly]);

  const { data, isLoading, error } = useQuery<{ items: IssueRow[]; total: number }>({
    queryKey: ['issues', params],
    queryFn: async () => (await issuesApi.list(params)).data,
    staleTime: 15_000,
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title / code / description…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-1.5 text-xs text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="informational">Informational</option>
        </select>
        <select value={workflowState} onChange={(e) => setWorkflowState(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
          <option value="">All states</option>
          <option value="new">New</option>
          <option value="triage">Triage</option>
          <option value="in_progress">In Progress</option>
          <option value="resolution">Resolution</option>
          <option value="closure_review">Closure Review</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
          <option value="">All types</option>
          {ISSUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button
          onClick={() => setSlaOnly((s) => !s)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${slaOnly ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          <Filter className="h-3 w-3" /> SLA breached
        </button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex h-[200px] items-center justify-center text-slate-400 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading issues…
        </div>
      ) : error ? (
        <div className="flex h-[200px] items-center justify-center text-rose-600">
          <AlertCircle className="h-4 w-4 mr-1.5" /> Failed to load issues.
        </div>
      ) : !data?.items.length ? (
        <div className="flex h-[200px] flex-col items-center justify-center text-center">
          <p className="text-sm font-medium text-slate-700">No issues match these filters.</p>
          <p className="mt-1 text-xs text-slate-500">Adjust the filters above or create a new issue.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Severity</th>
                <th className="px-3 py-2 font-semibold">State</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Assignee</th>
                <th className="px-3 py-2 font-semibold">Target</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const daysToTarget = daysFromNow(i.target_closure_date);
                return (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-[11px] font-semibold text-slate-700">
                      <Link href={`/issues/${i.id}`} className="hover:text-primary-700">{i.code || `#${i.id}`}</Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-800 max-w-[280px]">
                      <Link href={`/issues/${i.id}`} className="hover:text-primary-700">
                        <span className="font-medium block truncate" title={i.title}>{i.title}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2"><SeverityChip severity={i.severity} /></td>
                    <td className="px-3 py-2"><StateChip state={i.workflow_state} /></td>
                    <td className="px-3 py-2 text-[11px] text-slate-600">{i.issue_type ? i.issue_type.replace(/_/g, ' ') : '—'}</td>
                    <td className="px-3 py-2"><SourceChip sourceType={i.source_type} /></td>
                    <td className="px-3 py-2 text-[11px] text-slate-700">{i.assignee?.display_name || '—'}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-600">
                      {formatDate(i.target_closure_date)}
                      {i.sla_breached && (
                        <span className="ml-1.5 rounded bg-rose-50 px-1 text-[9px] font-semibold text-rose-700 uppercase">
                          {daysToTarget != null && daysToTarget < 0 ? `${-daysToTarget}d over` : 'breach'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data?.total != null && (
        <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-500">
          Showing {data.items.length} of {data.total} issues
        </div>
      )}
    </div>
  );
}
