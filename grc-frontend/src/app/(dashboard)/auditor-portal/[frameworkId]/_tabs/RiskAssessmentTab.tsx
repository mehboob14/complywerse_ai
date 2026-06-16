'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { ClipboardList, ExternalLink, AlertTriangle, CheckCircle2, Clock, Octagon } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface RiskAssessmentRow {
  id: number;
  name: string;
  description: string | null;
  status: string;
  framework_id: number | null;
  uploaded_framework_id: number | null;
  created_at: string;
  updated_at: string;
  questions: { total: number; not_started: number; in_progress: number; completed: number; blocked: number };
  completion_pct: number;
}

export default function RiskAssessmentTab({ frameworkId }: { frameworkId: string }) {
  const { data, isLoading, error } = useQuery<{ assessments: RiskAssessmentRow[]; total: number }>({
    queryKey: ['auditor-risk-assessments', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/risk-assessments`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;

  const rows = data?.assessments || [];
  if (rows.length === 0) {
    return (
      <TabEmpty
        title="No risk assessments started"
        hint="Once a framework-driven risk assessment (PCI TRA, ISO 27005, NIST 800-30, SOC 2 TSC) is opened for this framework, it will appear here for the auditor to verify."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((a) => {
        const q = a.questions;
        const completedPct = q.total ? (q.completed / q.total) * 100 : 0;
        const inProgressPct = q.total ? (q.in_progress / q.total) * 100 : 0;
        const blockedPct = q.total ? (q.blocked / q.total) * 100 : 0;
        return (
          <div
            key={a.id}
            className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <ClipboardList className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-900">{a.name}</h3>
                  <StatusPill value={a.status} />
                </div>
                {a.description && (
                  <p className="mt-1 text-xs text-slate-600 line-clamp-2 max-w-3xl">{a.description}</p>
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  Last updated {new Date(a.updated_at).toLocaleDateString()}
                </p>
              </div>
              <Link
                href={`/erm/risk-assessments/framework/${a.id}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 flex-shrink-0"
              >
                Open <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            {/* Question progress strip — visual at-a-glance so the
                auditor can see how far the questionnaire has been
                worked without opening it. */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                <span>Questionnaire progress</span>
                <span className="font-semibold text-slate-900 tabular-nums">{a.completion_pct}%</span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                {completedPct > 0 && <div className="bg-emerald-500" style={{ width: `${completedPct}%` }} />}
                {inProgressPct > 0 && <div className="bg-amber-500" style={{ width: `${inProgressPct}%` }} />}
                {blockedPct > 0 && <div className="bg-rose-500" style={{ width: `${blockedPct}%` }} />}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-slate-700">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Completed <span className="font-semibold text-slate-900 tabular-nums">{q.completed}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-slate-700">
                  <Clock className="h-3 w-3 text-amber-600" />
                  In progress <span className="font-semibold text-slate-900 tabular-nums">{q.in_progress}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-slate-700">
                  <Octagon className="h-3 w-3 text-rose-600" />
                  Blocked <span className="font-semibold text-slate-900 tabular-nums">{q.blocked}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-slate-700">
                  <AlertTriangle className="h-3 w-3 text-slate-500" />
                  Not started <span className="font-semibold text-slate-900 tabular-nums">{q.not_started}</span>
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-slate-500">
                  {q.total} total questions
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
