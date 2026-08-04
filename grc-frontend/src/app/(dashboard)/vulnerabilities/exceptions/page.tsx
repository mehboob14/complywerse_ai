'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileCheck, Filter, Loader2 } from 'lucide-react';
import { vulnManagementApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';

const STATES = ['all', 'requested', 'approved', 'denied', 'expired', 'revoked'] as const;
type State = (typeof STATES)[number];

const STATE_STYLES: Record<string, string> = {
  requested: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  denied: 'border-rose-200 bg-rose-50 text-rose-800',
  expired: 'border-orange-200 bg-orange-50 text-orange-800',
  revoked: 'border-slate-300 bg-slate-100 text-slate-700',
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'text-rose-700',
  high: 'text-amber-700',
  medium: 'text-blue-700',
  low: 'text-slate-700',
  info: 'text-slate-500',
};

export default function ExceptionsQueuePage() {
  const [state, setState] = useState<State>('requested');

  const { data, isLoading } = useQuery({
    queryKey: ['exception-queue', state],
    queryFn: () => vulnManagementApi.vulnerabilities.exceptionQueue({
      state: state === 'all' ? undefined : state,
      limit: 100,
    }).then((r) => r.data),
  });

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-card">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <FileCheck size={16} />
            Exceptions queue
          </h2>
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-slate-400" />
            {STATES.map((s) => (
              <button
                key={s}
                onClick={() => setState(s)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors capitalize ${
                  state === s
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {isLoading ? (
            <PageLoader className="h-32" />
          ) : !data || data.rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              No exceptions in {state === 'all' ? 'any state' : `state '${state}'`}.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-3">
                {data.total} total in {state === 'all' ? 'any state' : `state '${state}'`}. Showing {data.rows.length}.
              </p>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2">Vuln</th>
                    <th className="text-left">CVE</th>
                    <th className="text-left">Severity</th>
                    <th className="text-left">Priority</th>
                    <th className="text-left">State</th>
                    <th className="text-left">Requested</th>
                    <th className="text-left">Expires</th>
                    <th className="text-left">Justification</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2">
                        <Link
                          href={`/vulnerabilities/${r.id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {r.vuln_id}
                        </Link>
                        <span className="block text-xs text-slate-600 max-w-xs truncate">
                          {r.title}
                        </span>
                      </td>
                      <td className="text-xs font-mono text-slate-600">{r.cve_id || '—'}</td>
                      <td className={`text-xs capitalize ${SEVERITY_STYLES[r.severity] || ''}`}>{r.severity}</td>
                      <td className="text-xs text-slate-700">
                        {r.composite_priority != null ? Number(r.composite_priority).toFixed(1) : '—'}
                      </td>
                      <td>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${STATE_STYLES[r.exception_status] || ''}`}>
                          {r.exception_status}
                        </span>
                      </td>
                      <td className="text-xs text-slate-600">
                        {r.exception_requested_at
                          ? new Date(r.exception_requested_at).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="text-xs text-slate-600">
                        {r.exception_expires_at
                          ? new Date(r.exception_expires_at).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="text-xs text-slate-700 max-w-xs">
                        <span className="line-clamp-2">
                          {r.exception_justification || ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
