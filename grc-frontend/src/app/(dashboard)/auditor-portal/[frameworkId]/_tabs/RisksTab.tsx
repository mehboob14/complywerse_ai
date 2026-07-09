'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface RiskRow {
  id: number;
  title: string;
  category?: string;
  risk_sub_category?: string;
  status?: string;
  inherent_score?: number;
  residual_score?: number;
  risk_appetite?: string;
  source_type?: string;
  due_date?: string;
}

export default function RisksTab({ frameworkId }: { frameworkId: string }) {
  const { data, isLoading, error } = useQuery<{ risks: RiskRow[]; total: number; framework_short_code: string | null }>({
    queryKey: ['auditor-risks', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/risks`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const rows = data?.risks || [];
  if (rows.length === 0) {
    return (
      <TabEmpty
        title="No risks tied to this framework"
        hint={data?.framework_short_code
          ? `Risks must have register_type = "${data.framework_short_code}" to appear here.`
          : 'No framework short_code resolved; cannot match risk register entries.'}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left">Risk</th>
            <th className="px-4 py-2 text-left">Category</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Inherent</th>
            <th className="px-4 py-2 text-left">Residual</th>
            <th className="px-4 py-2 text-left">Source</th>
            <th className="px-4 py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-2 align-top">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-900 line-clamp-2">{r.title}</span>
                </div>
              </td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">
                {r.category}{r.risk_sub_category && <span className="text-slate-400"> / {r.risk_sub_category}</span>}
              </td>
              <td className="px-4 py-2 align-top"><StatusPill value={r.status} /></td>
              <td className="px-4 py-2 align-top text-xs">{r.inherent_score?.toFixed?.(1) ?? '—'}</td>
              <td className="px-4 py-2 align-top text-xs">{r.residual_score?.toFixed?.(1) ?? '—'}</td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{r.source_type || '—'}</td>
              <td className="px-4 py-2 align-top text-right">
                <Link href={`/erm/risks/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
                  Open <ExternalLink className="h-3 w-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
