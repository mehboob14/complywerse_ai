'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Bug, ExternalLink } from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface VulnRow {
  id: number;
  cve_id?: string;
  title: string;
  severity?: string;
  status?: string;
  cvss_score?: number;
  epss_score?: number;
  kev_flag?: boolean;
  composite_priority?: number;
  affected_host?: string;
  due_date?: string;
}

export default function VulnerabilitiesTab({ frameworkId }: { frameworkId: string }) {
  const { data, isLoading, error } = useQuery<{ vulnerabilities: VulnRow[]; total: number }>({
    queryKey: ['auditor-vulnerabilities', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/vulnerabilities`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;
  const rows = data?.vulnerabilities || [];
  if (rows.length === 0) {
    return <TabEmpty title="No vulnerabilities on in-scope assets" hint="Vulnerabilities are sourced from assets whose compliance_scope includes this framework." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-2 text-left">Title / CVE</th>
            <th className="px-4 py-2 text-left">Severity</th>
            <th className="px-4 py-2 text-left">CVSS</th>
            <th className="px-4 py-2 text-left">EPSS</th>
            <th className="px-4 py-2 text-left">KEV</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-4 py-2 align-top">
                <div className="flex items-start gap-2">
                  <Bug className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-slate-900 line-clamp-1">{v.title}</p>
                    {v.cve_id && <p className="text-[10px] font-mono text-slate-500">{v.cve_id}</p>}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 align-top"><StatusPill value={v.severity} /></td>
              <td className="px-4 py-2 align-top text-xs">{typeof v.cvss_score === 'number' ? v.cvss_score.toFixed(1) : '—'}</td>
              <td className="px-4 py-2 align-top text-xs">{typeof v.epss_score === 'number' ? (v.epss_score * 100).toFixed(1) + '%' : '—'}</td>
              <td className="px-4 py-2 align-top text-xs">
                {v.kev_flag ? <span className="text-rose-600 font-semibold">KEV</span> : '—'}
              </td>
              <td className="px-4 py-2 align-top"><StatusPill value={v.status} /></td>
              <td className="px-4 py-2 align-top text-right">
                <Link href={`/vulnerabilities/${v.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
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
