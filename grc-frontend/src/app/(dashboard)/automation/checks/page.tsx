'use client';

export const dynamic = 'force-dynamic';

import { Fragment, Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

type AwsConnection = {
  id: number;
  name: string;
  integration_type: string;
  status?: string | null;
};

type LastRun = {
  id: number;
  status: string;
  result_summary?: string | null;
  raw_output?: Record<string, unknown> | null;
  error_message?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
};

type CheckRow = {
  id: number;
  plugin_key: string;
  rule_id: string;
  title: string;
  description?: string | null;
  severity: string;
  runner_type: string;
  source?: string;
  last_run: LastRun | null;
};

const STATUS_STYLE: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-orange-100 text-orange-800',
  running: 'bg-blue-100 text-blue-800',
  pending: 'bg-blue-100 text-blue-800',
  skipped: 'bg-gray-100 text-gray-700',
};

const SEV_STYLE: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  low: 'bg-blue-50 text-blue-700 border-blue-200',
};

function AutomatedChecksInner() {
  const searchParams = useSearchParams();
  const controlFilter = searchParams.get('control') || '';
  const { toast } = useToast();
  const qc = useQueryClient();
  const [connectionId, setConnectionId] = useState<number | ''>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ['automation', 'soc2-connections'],
    queryFn: async () => {
      const res = await automationApi.listConnections();
      return (res.data?.connections || []) as AwsConnection[];
    },
  });

  const checksQuery = useQuery({
    queryKey: ['automation', 'soc2-checks', controlFilter],
    queryFn: async () => {
      const res = await automationApi.listChecks(
        controlFilter ? { control_id: controlFilter } : undefined,
      );
      return res.data as { count: number; checks: CheckRow[] };
    },
  });

  const connections = connectionsQuery.data || [];
  const checks = checksQuery.data?.checks || [];

  const activeConnectionId = useMemo(() => {
    if (connectionId !== '') return Number(connectionId);
    if (connections.length === 1) return connections[0].id;
    return null;
  }, [connectionId, connections]);

  const seedMutation = useMutation({
    mutationFn: async () => (await automationApi.seed()).data,
    onSuccess: (data) => {
      toast({ title: `Loaded ${data.upserted} checks`, type: 'success' });
      qc.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: (err: any) => {
      toast({ title: String(err?.response?.data?.detail || 'Refresh failed'), type: 'error' });
    },
  });

  const runOneMutation = useMutation({
    mutationFn: async ({ pluginId, cid }: { pluginId: number; cid?: number }) => {
      setRunningId(pluginId);
      return (await automationApi.runCheck(pluginId, cid)).data;
    },
    onSuccess: (data) => {
      const status = data?.run?.status || 'done';
      toast({
        title: `Check ${status}`,
        message: data?.run?.result_summary || data?.check?.title,
        type: status === 'passed' ? 'success' : 'error',
      });
      qc.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: (err: any) => {
      toast({
        title: String(err?.response?.data?.detail || err?.message || 'Run failed'),
        type: 'error',
      });
    },
    onSettled: () => setRunningId(null),
  });

  const runAllMutation = useMutation({
    mutationFn: async (cid: number) =>
      (await automationApi.runAll(cid, controlFilter || undefined)).data,
    onSuccess: (data) => {
      toast({
        title: 'Run all complete',
        message: `passed ${data.passed}, failed ${data.failed}, errors ${data.errors}`,
        type: data.failed || data.errors ? 'error' : 'success',
      });
      qc.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: (err: any) => {
      toast({
        title: String(err?.response?.data?.detail || err?.message || 'Run all failed'),
        type: 'error',
      });
    },
  });

  const requireConnection = (): number | null => {
    if (activeConnectionId == null) {
      toast({ title: 'Select an aws_readonly connection first', type: 'error' });
      return null;
    }
    if (connectionId === '') setConnectionId(activeConnectionId);
    return activeConnectionId;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Automated Checks</h1>
          <p className="mt-1 text-sm text-gray-600">
            Automated pass/fail checks for SOC 2 controls — AWS + SaaS connectors.
            {controlFilter ? (
              <>
                {' '}Filtered to <span className="font-mono font-semibold">{controlFilter}</span>.
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/automation/soc2-controls"
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Quantitative Controls
          </Link>
          <button
            type="button"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {seedMutation.isPending ? 'Refreshing…' : 'Refresh checks'}
          </button>
          <button
            type="button"
            onClick={() => {
              const cid = requireConnection();
              if (cid != null) runAllMutation.mutate(cid);
            }}
            disabled={runAllMutation.isPending || !checks.length}
            className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {runAllMutation.isPending ? 'Running all…' : 'Run all'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <label className="block text-sm font-medium text-gray-800">
          AWS connection (aws_readonly)
        </label>
        {connectionsQuery.isLoading && (
          <p className="text-sm text-gray-500">Loading connections…</p>
        )}
        {!connectionsQuery.isLoading && connections.length === 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No <code className="font-mono">aws_readonly</code> IntegrationConnection found.
            Configure one via Admin / Connectors (same credential used by CIS AWS plugins), then
            refresh this page.
          </div>
        )}
        {connections.length > 0 && (
          <select
            className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={activeConnectionId == null ? '' : String(activeConnectionId)}
            onChange={(e) =>
              setConnectionId(e.target.value ? Number(e.target.value) : '')
            }
          >
            <option value="">Select connection…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (#{c.id}
                {c.status ? ` · ${c.status}` : ''})
              </option>
            ))}
          </select>
        )}
        {controlFilter && (
          <Link href="/automation/checks" className="inline-block text-sm text-slate-700 underline">
            Clear control filter
          </Link>
        )}
      </div>

      {checksQuery.isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
          Loading checks…
        </div>
      )}

      {!checksQuery.isLoading && checks.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No checks found. Click <strong>Refresh checks</strong> to load them.
        </div>
      )}

      {checks.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Control</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Check</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Severity</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Last result</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checks.map((ch) => (
                <Fragment key={ch.id}>
                  <tr className="align-top">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{ch.rule_id}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{ch.title}</span>
                        {ch.source && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ch.source === 'connector' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'}`}>
                            {ch.source}
                          </span>
                        )}
                      </div>
                      {ch.description && (
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2">{ch.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${
                          SEV_STYLE[ch.severity] || SEV_STYLE.medium
                        }`}
                      >
                        {ch.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ch.last_run ? (
                        <div className="space-y-1">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              STATUS_STYLE[ch.last_run.status] || 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {ch.last_run.status}
                          </span>
                          <div className="text-xs text-gray-600 line-clamp-2">
                            {ch.last_run.result_summary || ch.last_run.error_message || '—'}
                          </div>
                          {ch.last_run.completed_at && (
                            <div className="text-[11px] text-gray-400">
                              {new Date(ch.last_run.completed_at).toLocaleString()}
                              {ch.last_run.duration_ms != null
                                ? ` · ${ch.last_run.duration_ms} ms`
                                : ''}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">Not run</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        onClick={() => setExpandedId(expandedId === ch.id ? null : ch.id)}
                      >
                        {expandedId === ch.id ? 'Hide' : 'Evidence'}
                      </button>
                      <button
                        type="button"
                        disabled={runningId === ch.id || runAllMutation.isPending}
                        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                        onClick={() => {
                          if (ch.source === 'connector') {
                            // Connectors use their own stored token — no AWS connection needed.
                            runOneMutation.mutate({ pluginId: ch.id });
                          } else {
                            const cid = requireConnection();
                            if (cid != null) runOneMutation.mutate({ pluginId: ch.id, cid });
                          }
                        }}
                      >
                        {runningId === ch.id ? 'Running…' : 'Run'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === ch.id && (
                    <tr>
                      <td colSpan={5} className="bg-slate-50 px-4 py-3">
                        <pre className="max-h-64 overflow-auto rounded border border-gray-200 bg-white p-3 text-[11px] text-gray-800">
                          {JSON.stringify(
                            {
                              result_summary: ch.last_run?.result_summary,
                              error_message: ch.last_run?.error_message,
                              raw_output: ch.last_run?.raw_output,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AutomatedChecksPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-gray-500">Loading automated checks…</div>
      }
    >
      <AutomatedChecksInner />
    </Suspense>
  );
}
