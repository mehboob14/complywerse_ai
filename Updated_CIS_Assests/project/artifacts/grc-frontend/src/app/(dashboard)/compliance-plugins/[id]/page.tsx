import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi, assetsApi } from '@/lib/api';

type Plugin = {
  id: number;
  plugin_key: string;
  benchmark: string;
  rule_id: string;
  title: string;
  description?: string | null;
  rationale?: string | null;
  remediation?: string | null;
  severity: string;
  runner_type: string;
  enabled: boolean;
  is_builtin: boolean;
  source_url?: string | null;
  check_definition?: Record<string, unknown>;
  schedule_cron?: string | null;
};

type Run = {
  id: number;
  status: string;
  result_summary?: string | null;
  result_detail?: string | null;
  remediation_shown?: string | null;
  evidence_hash?: string | null;
  evidence_snapshot?: Record<string, unknown> | null;
  duration_ms?: number | null;
  triggered_by: string;
  triggered_by_user?: { id: number; name: string; email?: string | null; initial: string } | null;
  triggered_by_user_id?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  asset_name?: string | null;
  connection_name?: string | null;
};

type Mapping = {
  id: number;
  framework_control_id?: number | null;
  normalized_control_id?: number | null;
  framework_name?: string | null;
  control_code?: string | null;
  weight?: number | null;
};

const SEV: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};
const RUN_STATUS: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-gray-200 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-700',
  skipped: 'bg-yellow-100 text-yellow-800',
};

export default function CompliancePluginDetailPage() {
  const params = useParams<{ id: string }>();
  const pluginId = Number(params.id);
  const qc = useQueryClient();
  const [scheduleDraft, setScheduleDraft] = useState<string>('');

  const pluginQ = useQuery({
    queryKey: ['compliance-plugin.detail', pluginId],
    queryFn: async () => (await compliancePluginsApi.get(pluginId)).data as Plugin,
    enabled: !!pluginId,
  });
  const runsQ = useQuery({
    queryKey: ['compliance-plugin.runs', pluginId],
    queryFn: async () => (await compliancePluginsApi.listRuns({ plugin_id: pluginId })).data as { runs: Run[] },
    enabled: !!pluginId,
  });
  const mappingsQ = useQuery({
    queryKey: ['compliance-plugin.mappings', pluginId],
    queryFn: async () => (await compliancePluginsApi.listControlMappings(pluginId)).data as { mappings: Mapping[] },
    enabled: !!pluginId,
    retry: false,
  });

  const plugin = pluginQ.data;
  const runs = runsQ.data?.runs ?? [];
  const mappings = mappingsQ.data?.mappings ?? [];

  const summary = useMemo(() => {
    const totals = { passed: 0, failed: 0, error: 0, other: 0 };
    for (const r of runs) {
      if (r.status === 'passed') totals.passed += 1;
      else if (r.status === 'failed') totals.failed += 1;
      else if (r.status === 'error') totals.error += 1;
      else totals.other += 1;
    }
    return totals;
  }, [runs]);

  // Bucket the last 14 days of runs into a sparkline-style time series of
  // pass/fail/error counts. Buckets are sorted oldest → newest left to right.
  const timeSeries = useMemo(() => {
    const buckets: Record<string, { day: string; passed: number; failed: number; error: number }> = {};
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { day: key.slice(5), passed: 0, failed: 0, error: 0 };
    }
    for (const r of runs) {
      if (!r.started_at) continue;
      const key = r.started_at.slice(0, 10);
      const b = buckets[key];
      if (!b) continue;
      if (r.status === 'passed') b.passed += 1;
      else if (r.status === 'failed') b.failed += 1;
      else if (r.status === 'error') b.error += 1;
    }
    return Object.values(buckets);
  }, [runs]);

  const scheduleM = useMutation({
    mutationFn: (cron: string | null) =>
      compliancePluginsApi.updateSchedule(pluginId, cron),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-plugin.detail', pluginId] });
    },
  });

  const scopeQ = useQuery({
    queryKey: ['compliance-plugin.scope', pluginId],
    queryFn: async () => (await compliancePluginsApi.getAssetScope(pluginId)).data as { mode: 'all' | 'include' | 'exclude'; asset_ids: number[] },
    enabled: !!pluginId,
  });
  const assetsQ = useQuery({
    queryKey: ['assets.all'],
    queryFn: async () => (await assetsApi.getAll()).data as Array<{ id: number; name: string }>,
    staleTime: 60_000,
  });
  const [scopeMode, setScopeMode] = useState<'all' | 'include' | 'exclude'>('all');
  const [scopeIds, setScopeIds] = useState<number[]>([]);
  useEffect(() => {
    if (scopeQ.data) {
      setScopeMode(scopeQ.data.mode);
      setScopeIds(scopeQ.data.asset_ids);
    }
  }, [scopeQ.data]);
  const scopeM = useMutation({
    mutationFn: () => compliancePluginsApi.updateAssetScope(pluginId, scopeMode, scopeIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance-plugin.scope', pluginId] }),
  });

  if (!pluginId) return <div className="p-6">Invalid plugin id</div>;
  if (pluginQ.isLoading) return <div className="p-6 text-gray-500">Loading plugin…</div>;
  if (pluginQ.isError || !plugin) {
    return (
      <div className="p-6">
        <Link href="/compliance/plugins" className="text-blue-600 hover:underline">← Back to plugins</Link>
        <div className="mt-4 text-red-600">Plugin not found.</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/compliance/plugins" className="text-sm text-blue-600 hover:underline">
          ← Back to plugin library
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-mono">{plugin.benchmark}</span>
              <span>·</span>
              <span className="font-mono">{plugin.rule_id}</span>
            </div>
            <h1 className="text-xl font-semibold mt-1">{plugin.title}</h1>
            <div className="mt-2 flex gap-2">
              <span className={`px-2 py-0.5 text-xs rounded border ${SEV[plugin.severity] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                {plugin.severity}
              </span>
              <span className="px-2 py-0.5 text-xs rounded border bg-gray-50 text-gray-700 border-gray-200">
                {plugin.runner_type}
              </span>
              {plugin.is_builtin && (
                <span className="px-2 py-0.5 text-xs rounded border bg-blue-50 text-blue-700 border-blue-200">
                  built-in
                </span>
              )}
              <span className={`px-2 py-0.5 text-xs rounded border ${plugin.enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                {plugin.enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
          </div>
          {plugin.source_url && (
            <a
              href={plugin.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              CIS source ↗
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total runs" value={runs.length} />
        <Stat label="Passed" value={summary.passed} tone="green" />
        <Stat label="Failed" value={summary.failed} tone="red" />
        <Stat label="Errors" value={summary.error} tone="gray" />
      </div>

      <Section title="Run history (last 14 days)">
        <RunHistoryChart data={timeSeries} />
      </Section>

      <Section title="Schedule">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-700">Cadence:</label>
          <select
            data-testid="schedule-select"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={scheduleDraft || (plugin.schedule_cron ?? '')}
            onChange={(e) => setScheduleDraft(e.target.value)}
          >
            <option value="">— none (manual only) —</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button
            data-testid="schedule-save"
            disabled={scheduleM.isPending}
            onClick={() => scheduleM.mutate((scheduleDraft || (plugin.schedule_cron ?? '')) || null)}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {scheduleM.isPending ? 'Saving…' : 'Save schedule'}
          </button>
          <span className="text-xs text-gray-500">
            Current: <span className="font-mono">{plugin.schedule_cron || 'manual'}</span>
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Scheduled runs require a tenant-level integration connection of the matching runner type. SSH plugins are skipped pending per-asset binding.
        </p>
      </Section>

      <Section title="Asset scope">
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="scope-mode"
                data-testid="scope-mode-all"
                checked={scopeMode === 'all'}
                onChange={() => setScopeMode('all')}
              />
              All eligible assets
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="scope-mode"
                data-testid="scope-mode-include"
                checked={scopeMode === 'include'}
                onChange={() => setScopeMode('include')}
              />
              Include only
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="scope-mode"
                data-testid="scope-mode-exclude"
                checked={scopeMode === 'exclude'}
                onChange={() => setScopeMode('exclude')}
              />
              Exclude listed
            </label>
            <button
              data-testid="scope-save"
              disabled={scopeM.isPending}
              onClick={() => scopeM.mutate()}
              className="ml-auto px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {scopeM.isPending ? 'Saving…' : 'Save scope'}
            </button>
          </div>
          {scopeMode !== 'all' && (
            <div className="border rounded p-2 max-h-48 overflow-auto">
              {(assetsQ.data ?? []).length === 0 ? (
                <div className="text-xs text-gray-500">No assets yet — add assets first to scope plugin runs.</div>
              ) : (
                (assetsQ.data ?? []).map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm py-0.5">
                    <input
                      type="checkbox"
                      data-testid={`scope-asset-${a.id}`}
                      checked={scopeIds.includes(a.id)}
                      onChange={(e) => {
                        if (e.target.checked) setScopeIds((ids) => [...ids, a.id]);
                        else setScopeIds((ids) => ids.filter((x) => x !== a.id));
                      }}
                    />
                    <span>{a.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
          <p className="text-xs text-gray-500">
            <span className="font-medium">Include only</span> runs the plugin against just the selected assets.{' '}
            <span className="font-medium">Exclude listed</span> runs it against every eligible asset except those checked.
          </p>
        </div>
      </Section>

      <Section title="Description">
        <p className="text-sm text-gray-700">{plugin.description || '—'}</p>
      </Section>
      <Section title="Rationale">
        <p className="text-sm text-gray-700">{plugin.rationale || '—'}</p>
      </Section>
      <Section title="Remediation">
        <pre className="text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap">{plugin.remediation || '—'}</pre>
      </Section>
      <Section title="Check definition">
        <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">{JSON.stringify(plugin.check_definition || {}, null, 2)}</pre>
      </Section>

      <Section title={`Mapped controls (${mappings.length})`}>
        {mappingsQ.isLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : mappings.length === 0 ? (
          <div className="text-sm text-gray-500">No control mappings yet. Map this plugin to a framework control to cascade pass/fail into compliance scoring.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr><th className="text-left py-1">Framework</th><th className="text-left py-1">Control</th><th className="text-left py-1">Weight</th></tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                <tr key={m.id} className="border-t">
                  <td className="py-1.5">{m.framework_name || (m.normalized_control_id ? `Normalized #${m.normalized_control_id}` : (m.framework_control_id ? `FC #${m.framework_control_id}` : '—'))}</td>
                  <td className="py-1.5 font-mono">{m.control_code || '—'}</td>
                  <td className="py-1.5">{m.weight ?? 1.0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`Run history (${runs.length})`}>
        {runsQ.isLoading ? (
          <div className="text-sm text-gray-500">Loading runs…</div>
        ) : runs.length === 0 ? (
          <div className="text-sm text-gray-500">No runs yet. Execute this plugin against an asset or connection to capture evidence.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left py-1">Status</th>
                <th className="text-left py-1">Started</th>
                <th className="text-left py-1">Target</th>
                <th className="text-left py-1">Triggered</th>
                <th className="text-left py-1">Duration</th>
                <th className="text-left py-1">Evidence hash</th>
                <th className="text-left py-1">Summary</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1.5">
                    <span className={`px-2 py-0.5 text-xs rounded ${RUN_STATUS[r.status] || 'bg-gray-100 text-gray-700'}`}>{r.status}</span>
                  </td>
                  <td className="py-1.5 text-xs text-gray-600">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
                  <td className="py-1.5 text-xs">
                    {r.connection_name && <div>conn: {r.connection_name}</div>}
                    {r.asset_name && <div>asset: {r.asset_name}</div>}
                    {!r.connection_name && !r.asset_name && '—'}
                  </td>
                  <td className="py-1.5 text-xs text-gray-600">
                    {r.triggered_by_user ? (
                      <span
                        className="inline-flex items-center gap-1.5"
                        title={`${r.triggered_by_user.name}${r.triggered_by_user.email ? ` · ${r.triggered_by_user.email}` : ''}\nTrigger type: ${r.triggered_by}`}
                      >
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">
                          {r.triggered_by_user.initial}
                        </span>
                        <span className="text-xs text-gray-800">{r.triggered_by_user.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px]">⚙</span>
                        {r.triggered_by}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-xs text-gray-600">{r.duration_ms != null ? `${r.duration_ms} ms` : '—'}</td>
                  <td className="py-1.5 text-xs font-mono text-gray-600" title={r.evidence_hash ?? ''}>{r.evidence_hash ? r.evidence_hash.slice(0, 12) + '…' : '—'}</td>
                  <td className="py-1.5 text-xs text-gray-700 max-w-md">{r.result_summary || r.error_message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-white">
      <div className="px-4 py-2 border-b text-sm font-medium text-gray-700">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function RunHistoryChart({ data }: { data: Array<{ day: string; passed: number; failed: number; error: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.passed + d.failed + d.error));
  return (
    <div data-testid="run-history-chart" className="flex items-end gap-1 h-32">
      {data.map((d) => {
        const total = d.passed + d.failed + d.error;
        const heightPct = (total / max) * 100;
        return (
          <div key={d.day} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={`${d.day} · ✓${d.passed} ✗${d.failed} ⚠${d.error}`}>
            <div className="w-full flex flex-col-reverse" style={{ height: `${heightPct}%`, minHeight: total > 0 ? '4px' : '0px' }}>
              {d.passed > 0 && <div style={{ flex: d.passed }} className="bg-green-500" />}
              {d.failed > 0 && <div style={{ flex: d.failed }} className="bg-red-500" />}
              {d.error > 0 && <div style={{ flex: d.error }} className="bg-gray-400" />}
            </div>
            <div className="text-[10px] text-gray-500 truncate w-full text-center">{d.day}</div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' | 'gray' }) {
  const cls =
    tone === 'green' ? 'text-green-700' :
    tone === 'red' ? 'text-red-700' :
    tone === 'gray' ? 'text-gray-700' : 'text-gray-900';
  return (
    <div className="border rounded-lg bg-white p-4">
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
