'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Briefcase, ExternalLink } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface VendorRow {
  id: number;
  name: string;
  vendor_type?: string;
  criticality?: string;
  risk_tier?: string;
  status?: string;
  data_classification_access?: string;
  contract_expiry?: string;
  last_assessed_at?: string;
}

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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left">Vendor</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">Risk Tier</th>
            <th className="px-4 py-2 text-left">Data Access</th>
            <th className="px-4 py-2 text-left">Last Assessed</th>
            <th className="px-4 py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-2 align-top">
                <div className="flex items-start gap-2">
                  <Briefcase className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-900">{v.name}</span>
                </div>
              </td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{v.vendor_type || '—'}</td>
              <td className="px-4 py-2 align-top"><StatusPill value={v.risk_tier} /></td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{v.data_classification_access || '—'}</td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">
                {v.last_assessed_at ? new Date(v.last_assessed_at).toLocaleDateString() : '—'}
              </td>
              <td className="px-4 py-2 align-top text-right">
                <Link href={`/vendor-risk/${v.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
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
