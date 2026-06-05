'use client';

// RelatedIssuesPanel
// ─────────────────────────────────────────────────────────────────────────
// Shared widget — drop onto ANY detail page to surface the Issues linked
// to that entity. Shows: count chips per severity, list of open issues
// (max 5), a "Show all" deep-link, and the existing <CreateIssueButton>
// pre-wired to the same source so users can raise a new issue inline.
//
// Used on: vuln detail, asset detail, frameworks journey detail, IS
// project detail, governance document detail (and any future detail page
// that touches one of the supported source types).

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bug, AlertCircle, ChevronRight, Inbox } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { CreateIssueButton } from './CreateIssueButton';

interface Issue {
  id: number;
  code: string | null;
  title: string;
  severity: string | null;
  workflow_state: string;
  status: string;
  sla_breached: boolean;
  target_closure_date: string | null;
  created_at: string | null;
}

interface BySourcePayload {
  source_type: string;
  source_id: number;
  open: Issue[];
  closed: Issue[];
  total_open: number;
  total_closed: number;
  critical_open: number;
}

interface Props {
  sourceType:
    | 'vulnerability'
    | 'risk'
    | 'asset'
    | 'control_framework'
    | 'control_parsed'
    | 'control_normalized'
    | 'control_internal'
    | 'evidence'
    | 'vendor'
    | 'is_project'
    | 'governance_document'
    | 'policy_statement';
  sourceId: number;
  /** Optional title (defaults to "Issues"). */
  title?: string;
  /** Optional inline create-button preset fields (forwarded to CreateIssueButton). */
  createFields?: Parameters<typeof CreateIssueButton>[0]['presetFields'];
  /** Smaller variant used inside nested tabs. */
  compact?: boolean;
}

const SEV_TONE: Record<string, string> = {
  critical: 'border-rose-300 bg-rose-50 text-rose-700',
  high: 'border-orange-300 bg-orange-50 text-orange-700',
  medium: 'border-amber-300 bg-amber-50 text-amber-700',
  low: 'border-blue-200 bg-blue-50 text-blue-700',
  informational: 'border-slate-200 bg-slate-50 text-slate-600',
};

const STATE_LABEL: Record<string, string> = {
  new: 'New',
  triage: 'Triage',
  in_progress: 'In Progress',
  resolution: 'Resolution',
  closure_review: 'Closure Review',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function RelatedIssuesPanel({
  sourceType, sourceId, title = 'Issues', createFields, compact = false,
}: Props) {
  const { data, isLoading } = useQuery<BySourcePayload>({
    queryKey: ['issues-by-source-panel', sourceType, sourceId],
    queryFn: async () => (await issuesApi.bySource(sourceType, sourceId)).data,
    staleTime: 15_000,
    enabled: !!sourceId,
  });

  const isControl = sourceType.startsWith('control_');
  // For the inline create button, only pass source types it actually supports.
  const createButtonSourceType: Parameters<typeof CreateIssueButton>[0]['sourceType'] | null =
    sourceType === 'evidence' || sourceType === 'vendor' || sourceType === 'is_project'
      ? null  // these aren't currently wired into the from-source pre-fill — show list-only
      : isControl
        ? (sourceType as 'control_framework' | 'control_parsed' | 'control_normalized' | 'control_internal')
        : (sourceType as 'vulnerability' | 'risk' | 'asset' | 'governance_document' | 'policy_statement');

  const showCreate = createButtonSourceType !== null;

  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${compact ? '' : ''}`}>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 ring-1 ring-rose-100">
            <Bug className="h-3.5 w-3.5 text-rose-600" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</h3>
          {data && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              {data.total_open}
            </span>
          )}
          {data && data.critical_open > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
              <AlertCircle className="h-2.5 w-2.5" />
              {data.critical_open} crit
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {showCreate && createButtonSourceType && (
            <CreateIssueButton
              sourceType={createButtonSourceType}
              sourceId={sourceId}
              label="New"
              variant="compact"
              presetFields={createFields}
            />
          )}
          {data && data.total_open > 0 && (
            <Link
              href={`/issues?source_type=${sourceType}&source_id=${sourceId}`}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      <div className="p-2">
        {isLoading ? (
          <div className="py-4 text-center text-[11px] text-slate-400">Loading…</div>
        ) : !data || data.total_open === 0 ? (
          <div className="flex flex-col items-center justify-center py-5 text-center">
            <Inbox className="mb-1 h-5 w-5 text-slate-300" />
            <p className="text-[11px] text-slate-500">No open issues linked to this item.</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {data.open.slice(0, 5).map((i) => {
              const sev = (i.severity || 'medium').toLowerCase();
              const tone = SEV_TONE[sev] || SEV_TONE.medium;
              return (
                <li key={i.id}>
                  <Link
                    href={`/issues/${i.id}`}
                    className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-slate-200 hover:bg-slate-50"
                  >
                    <span className={`rounded border px-1.5 py-px text-[9px] font-bold uppercase ${tone}`}>{sev}</span>
                    <span className="text-[11px] font-semibold text-slate-700 shrink-0">{i.code}</span>
                    <span className="text-[11px] text-slate-700 truncate flex-1" title={i.title}>{i.title}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">{STATE_LABEL[i.workflow_state] || i.workflow_state}</span>
                    {i.sla_breached && (
                      <span className="rounded bg-rose-50 px-1 text-[9px] font-bold uppercase text-rose-700 shrink-0">SLA</span>
                    )}
                  </Link>
                </li>
              );
            })}
            {data.open.length > 5 && (
              <li className="px-2 py-1 text-[10px] text-slate-500 text-center">
                +{data.open.length - 5} more
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
