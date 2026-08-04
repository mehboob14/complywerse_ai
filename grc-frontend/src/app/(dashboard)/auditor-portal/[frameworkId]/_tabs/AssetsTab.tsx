'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Server, ExternalLink } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface AssetRow {
  id: number;
  name: string;
  host_name?: string;
  ip_address?: string;
  asset_type?: string;
  criticality?: string;
  status?: string;
  vendor?: string;
  compliance_scope?: string[];
  cde_environment?: string | boolean;
}

export default function AssetsTab({ frameworkId }: { frameworkId: string }) {
  const { data, isLoading, error } = useQuery<{ assets: AssetRow[]; total: number }>({
    queryKey: ['auditor-assets', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/assets`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const rows = data?.assets || [];
  if (rows.length === 0) {
    return <TabEmpty title="No assets in scope for this framework" hint="Assets must include the framework short-code in their compliance_scope to appear here." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left">Asset</th>
            <th className="px-4 py-2 text-left">Host / IP</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">Criticality</th>
            <th className="px-4 py-2 text-left">Scope</th>
            <th className="px-4 py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-2 align-top">
                <div className="flex items-start gap-2">
                  <Server className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-900 line-clamp-1">{a.name}</span>
                </div>
              </td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">
                {a.host_name || a.ip_address || '—'}
              </td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">{a.asset_type || '—'}</td>
              <td className="px-4 py-2 align-top"><StatusPill value={a.criticality} /></td>
              <td className="px-4 py-2 align-top text-xs text-slate-600">
                {Array.isArray(a.compliance_scope) ? a.compliance_scope.join(', ') : '—'}
              </td>
              <td className="px-4 py-2 align-top text-right">
                <Link href={`/assets/${a.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
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
