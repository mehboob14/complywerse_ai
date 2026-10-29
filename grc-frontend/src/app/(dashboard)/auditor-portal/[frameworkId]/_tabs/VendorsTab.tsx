'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';
import { Briefcase, ExternalLink } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface VendorRow {
  id: number;
  name: string;
  vendor_type?: string | null;
  risk_tier?: string | null;
  risk_rating?: string | null;
  residual_risk_score?: number | null;
  status?: string;
  data_classification_access?: string | null;
  last_assessed_at?: string | null;
  next_reassessment_date?: string | null;
  owner?: { id: number; name: string } | null;
  archived_at?: string | null;
}

const day = (value?: string | null) => parseUtc(value)?.toLocaleDateString() ?? '—';

export default function VendorsTab({ frameworkId }: { frameworkId: string }) {
  const { data, isLoading, error } = useQuery<{ vendors: VendorRow[]; total: number }>({
    queryKey: ['auditor-vendors', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/vendors`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const rows = data?.vendors || [];
  if (rows.length === 0) {
    return <TabEmpty title="No active vendors" hint="No active vendors are recorded for this tenant." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left">Vendor</th>
            <th className="px-4 py-2 text-left">Tier</th>
            <th className="px-4 py-2 text-left">Rating</th>
            <th className="px-4 py-2 text-left">Residual</th>
            <th className="px-4 py-2 text-left">Data Access</th>
            <th className="px-4 py-2 text-left">Last Assessed</th>
            <th className="px-4 py-2 text-left">Next Review</th>
            <th className="px-4 py-2 text-left">Owner</th>
            <th className="px-4 py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-2 align-top">
                <div className="flex items-start gap-2">
                  <Briefcase className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-slate-900">{v.name}</span>
                    {v.vendor_type && <div className="text-xs text-slate-500">{v.vendor_type}</div>}
                    {v.archived_at && (
                      <div className="mt-1 text-[11px] font-medium text-amber-700">Archived {day(v.archived_at)}</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 align-top"><StatusPill value={v.risk_tier} /></td>
              <td className="px-4 py-2 align-top"><StatusPill value={v.risk_rating} /></td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{v.residual_risk_score?.toFixed?.(1) ?? '—'}</td>
              <td className="px-4 py-2 align-top text-xs text-slate-600 capitalize">{v.data_classification_access || '—'}</td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{day(v.last_assessed_at)}</td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{day(v.next_reassessment_date)}</td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{v.owner?.name || '—'}</td>
              <td className="px-4 py-2 align-top text-right">
                <Link href={`/vendor-risk/vendors/${v.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
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
