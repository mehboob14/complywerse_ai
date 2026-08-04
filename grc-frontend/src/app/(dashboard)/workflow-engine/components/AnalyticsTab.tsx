'use client';

import { Activity, AlertTriangle, CheckCircle, Clock, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';
import { AnalyticsOverview, BottleneckItem, LiveInstance } from './types';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    waiting: 'bg-yellow-100 text-yellow-700',
    waiting_approval: 'bg-violet-100 text-violet-700',
    pending: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

type Tab = 'overview' | 'live';

export function AnalyticsTab() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AnalyticsOverview>({});
  const [bottlenecks, setBottlenecks] = useState<BottleneckItem[]>([]);
  const [liveInstances, setLiveInstances] = useState<LiveInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, btRes] = await Promise.all([
        workflowEngineApi.analytics.overview(),
        workflowEngineApi.analytics.bottlenecks(),
      ]);
      setOverview(ovRes.data || {});
      const btData = btRes.data;
      setBottlenecks(Array.isArray(btData) ? btData : (btData?.bottlenecks || btData?.items || []));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await workflowEngineApi.analytics.liveStatus();
      const liveData = res.data;
      setLiveInstances(Array.isArray(liveData) ? liveData : (liveData?.instances || liveData?.items || []));
      setLastRefresh(new Date());
    } catch {
      // silently fail
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else loadLive();
  }, [tab, loadOverview, loadLive]);

  // Auto-refresh live monitor every 30s
  useEffect(() => {
    if (tab !== 'live') return;
    const interval = setInterval(loadLive, 30000);
    return () => clearInterval(interval);
  }, [tab, loadLive]);

  const statCards = [
    { label: 'Total Executions', value: overview.total_instances ?? 0, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Completed', value: overview.completed ?? 0, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Running', value: overview.running ?? 0, icon: TrendingUp, color: 'text-cyan-600', bg: 'bg-cyan-50' },
    { label: 'Failed', value: overview.failed ?? 0, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
    { label: 'Waiting', value: overview.waiting ?? 0, icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Avg Duration', value: overview.avg_completion_minutes ? `${Math.round(overview.avg_completion_minutes)}m` : '—', icon: Zap, color: 'text-violet-600', bg: 'bg-violet-50' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex items-center gap-0 px-5 border-b border-gray-200 bg-white shrink-0">
        {[
          { key: 'overview' as Tab, label: 'Overview & Bottlenecks' },
          { key: 'live' as Tab, label: 'Live Monitor' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => tab === 'overview' ? loadOverview() : loadLive()}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-3 py-2"
        >
          <RefreshCw size={12} className={loading || liveLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Stat cards */}
            <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
              {statCards.map((s) => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-1 shadow-sm">
                  <div className={`${s.bg} rounded-lg p-2 mb-1`}>
                    <s.icon size={16} className={s.color} />
                  </div>
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] text-gray-500 text-center font-medium">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Bottlenecks table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-800">Step Bottlenecks</h3>
                  <p className="text-[11px] text-gray-400">Slowest steps by average duration</p>
                </div>
              </div>
              {loading ? (
                <div className="text-center py-10 text-xs text-gray-400">Loading...</div>
              ) : bottlenecks.length === 0 ? (
                <div className="text-center py-10 text-xs text-gray-400">
                  <Activity size={28} className="mx-auto mb-2 text-gray-200" />
                  No execution data yet. Run some workflows to see bottlenecks.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Step</th>
                        <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                        <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Avg Duration</th>
                        <th className="text-right px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Instances</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bottlenecks.map((b, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{b.node_key.replace(/_/g, ' ')}</td>
                          <td className="px-5 py-2.5 text-gray-500">{b.node_type}</td>
                          <td className="px-5 py-2.5 text-right font-semibold text-orange-600">{formatDuration(b.avg_duration_seconds)}</td>
                          <td className="px-5 py-2.5 text-right text-gray-600">{b.instance_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'live' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Active Workflow Instances</h3>
                <p className="text-[11px] text-gray-400">Last updated: {lastRefresh.toLocaleTimeString()} · Auto-refreshes every 30s</p>
              </div>
              <span className="text-[10px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-semibold">
                {liveInstances.filter(i => i.status === 'running').length} Running
              </span>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {liveLoading && liveInstances.length === 0 ? (
                <div className="text-center py-10 text-xs text-gray-400">Loading live instances...</div>
              ) : liveInstances.length === 0 ? (
                <div className="text-center py-10 text-xs text-gray-400">
                  <Activity size={28} className="mx-auto mb-2 text-gray-200" />
                  No active workflow instances
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Workflow</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Current Step</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Started</th>
                      <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveInstances.map((inst) => (
                      <tr key={inst.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-800">
                          {inst.workflow_name || `Instance #${inst.id}`}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={inst.status} />
                        </td>
                        <td className="px-5 py-3 text-gray-500">
                          {inst.current_node_key ? inst.current_node_key.replace(/_/g, ' ') : '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-500">{formatDate(inst.started_at)}</td>
                        <td className="px-5 py-3">
                          {inst.is_overdue ? (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">
                              <AlertTriangle size={9} />
                              Overdue
                            </span>
                          ) : (
                            <span className="text-[10px] text-green-600">On track</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
