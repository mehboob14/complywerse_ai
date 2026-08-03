'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { CheckCircle2, XCircle, Clock, FileText } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty } from './shared';

interface AuditEntry {
  id: number;
  user_id?: number;
  action: string;
  resource_type: string;
  resource_id?: number;
  changes?: Record<string, unknown> | null;
  timestamp: string;
}

export default function AuditTrailTab({ frameworkId }: { frameworkId: string }) {
  const { data, isLoading, error } = useQuery<{ audit_trail: AuditEntry[]; total: number }>({
    queryKey: ['auditor-audit-trail', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/audit-trail`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const rows = data?.audit_trail || [];
  if (rows.length === 0) {
    return <TabEmpty title="No audit trail entries yet" hint="Approvals, rejections, and other framework-scoped actions appear here once they occur." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">
        {rows.map((e) => {
          const isApproved = e.action.toLowerCase().includes('approved');
          const isRejected = e.action.toLowerCase().includes('rejected');
          const Icon = isApproved ? CheckCircle2 : isRejected ? XCircle : Clock;
          const tone = isApproved ? 'text-emerald-600' : isRejected ? 'text-rose-600' : 'text-slate-500';
          const remarks = (e.changes && typeof e.changes === 'object' && 'remarks' in e.changes)
            ? String((e.changes as Record<string, unknown>).remarks || '')
            : '';
          return (
            <li key={e.id} className="p-4 hover:bg-slate-50/60">
              <div className="flex items-start gap-3">
                <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-900">{e.action}</span>
                    <span className="text-xs text-slate-500">on</span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                      <FileText className="h-3 w-3" />
                      {e.resource_type}
                      {e.resource_id ? ` #${e.resource_id}` : ''}
                    </span>
                  </div>
                  {remarks && (
                    <p className="text-xs text-slate-600 mt-1 italic">&quot;{remarks}&quot;</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-1">
                    {new Date(e.timestamp).toLocaleString()}
                    {e.user_id ? ` • user #${e.user_id}` : ''}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
