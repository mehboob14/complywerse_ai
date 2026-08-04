'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle,
  AlertOctagon,
  User,
  Clock,
  Zap,
  ArrowLeft,
  Loader2,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';

interface KRIAlert {
  id: number;
  kri_id: number;
  kri_name: string;
  risk_id: number;
  risk_title: string;
  current_value: number;
  threshold_breached: string;
  green_threshold: number;
  amber_threshold: number;
  status: string;
  severity: string;
  triggered_at: string;
  owner: string;
  recommended_action: string;
}

interface KRISummary {
  total_alerts: number;
  critical_alerts: number;
  warning_alerts: number;
  total_kris_monitored: number;
  kris_in_breach: number;
  kris_healthy: number;
}

interface KRITriggersResponse {
  alerts: KRIAlert[];
  summary: KRISummary;
}

export default function KRITriggersPage() {
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  const { data, isLoading } = useQuery<KRITriggersResponse>({
    queryKey: ['erm-kri-triggers', severityFilter],
    queryFn: async () => {
      const params: { severity?: string } = {};
      if (severityFilter !== 'all') params.severity = severityFilter;
      const response = await ermApi.analytics.getKRITriggers(params);
      return response.data;
    },
  });

  const summary = data?.summary;
  const alerts = data?.alerts || [];

  const groupedAlerts = useMemo(() => {
    const critical = alerts.filter(a => a.severity === 'critical');
    const warning = alerts.filter(a => a.severity === 'warning');
    return { critical, warning };
  }, [alerts]);

  const healthRatio = summary ? summary.kris_healthy / (summary.total_kris_monitored || 1) : 0;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link
            href="/erm/analytics"
            className="rounded-lg p-2 text-slate-600 hover:bg-white hover:text-slate-900"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Automated KRI Triggers</h1>
            <p className="text-sm text-slate-600">Real-time alerts for Key Risk Indicator threshold breaches</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-slate-600" />
          <span className="text-sm text-slate-600">
            {summary?.total_alerts || 0} active alert{(summary?.total_alerts || 0) !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/20 p-2">
                <Activity className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Total KRIs Monitored</p>
                <p className="text-2xl font-bold text-slate-900">{summary.total_kris_monitored}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-500/20 p-2">
                <ShieldAlert className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600">KRIs In Breach</p>
                <p className="text-2xl font-bold text-red-400">{summary.kris_in_breach}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-500/20 p-2">
                <CheckCircle className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600">KRIs Healthy</p>
                <p className="text-2xl font-bold text-green-400">{summary.kris_healthy}</p>
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                <span>{summary.kris_healthy}/{summary.total_kris_monitored} Healthy</span>
                <span>{Math.round(healthRatio * 100)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${healthRatio * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-500/20 p-2">
                <AlertOctagon className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Critical Alerts</p>
                <p className="text-2xl font-bold text-red-400">{summary.critical_alerts}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/20 p-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-slate-600">Warning Alerts</p>
                <p className="text-2xl font-bold text-amber-400">{summary.warning_alerts}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <BarChart3 className="h-5 w-5 text-slate-600" />
        <label className="text-sm text-slate-600">Severity:</label>
        <MultiSelectDropdown
          title="Severity"
          items={[
            { value: 'all', label: 'All Severities' },
            { value: 'critical', label: 'Critical' },
            { value: 'warning', label: 'Warning' },
          ]}
          selectedValues={[severityFilter]}
          onApply={(values) => setSeverityFilter(values[0] || 'all')}
          multiSelect={false}
        />
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-slate-200 bg-white">
          <div className="rounded-full bg-green-500/20 p-4">
            <CheckCircle className="h-12 w-12 text-green-400" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">All KRIs are within acceptable thresholds</h3>
          <p className="mt-1 text-slate-600">No alerts to display. All monitored indicators are healthy.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedAlerts.critical.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-red-400" />
                <h2 className="text-lg font-semibold text-red-400">
                  Critical Alerts ({groupedAlerts.critical.length})
                </h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {groupedAlerts.critical.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            </div>
          )}

          {groupedAlerts.warning.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                <h2 className="text-lg font-semibold text-amber-400">
                  Warning Alerts ({groupedAlerts.warning.length})
                </h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {groupedAlerts.warning.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: KRIAlert }) {
  const isCritical = alert.severity === 'critical';
  const maxThreshold = Math.max(alert.green_threshold, alert.amber_threshold, alert.current_value) * 1.2 || 100;

  const greenWidth = (alert.green_threshold / maxThreshold) * 100;
  const amberWidth = (alert.amber_threshold / maxThreshold) * 100;
  const currentPosition = Math.min((alert.current_value / maxThreshold) * 100, 100);

  const triggeredDate = new Date(alert.triggered_at);
  const formattedDate = triggeredDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              isCritical
                ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
            }`}
          >
            {isCritical ? (
              <AlertOctagon className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {alert.severity.toUpperCase()}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
            {alert.threshold_breached} breached
          </span>
        </div>
        <span className="text-xs text-slate-500">#{alert.id}</span>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-900">{alert.kri_name}</h3>
        <div className="mt-1 flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-sm text-slate-600">{alert.risk_title}</span>
        </div>
      </div>

      <div className="rounded-lg bg-white/50 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-900">Current: {alert.current_value.toFixed(1)}</span>
          <span className="text-slate-600">|</span>
          <span className="text-green-400">Green: ≤{alert.green_threshold.toFixed(1)}</span>
          <span className="text-slate-600">|</span>
          <span className="text-amber-400">Amber: ≤{alert.amber_threshold.toFixed(1)}</span>
        </div>

        <div className="relative h-3 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-green-500/40"
            style={{ width: `${greenWidth}%` }}
          />
          <div
            className="absolute inset-y-0 rounded-full bg-amber-500/40"
            style={{ left: `${greenWidth}%`, width: `${amberWidth - greenWidth}%` }}
          />
          <div
            className="absolute inset-y-0 rounded-full bg-red-500/40"
            style={{ left: `${amberWidth}%`, width: `${100 - amberWidth}%` }}
          />
          <div
            className="absolute top-0 h-3 w-1 rounded-full bg-white shadow-lg shadow-white/20"
            style={{ left: `${currentPosition}%`, transform: 'translateX(-50%)' }}
          />
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-slate-600">
        <div className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" />
          <span>{formattedDate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <User className="h-4 w-4" />
          <span>{alert.owner}</span>
        </div>
      </div>

      {alert.recommended_action && (
        <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-3">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-indigo-400 mb-1">Recommended Action</p>
              <p className="text-sm text-slate-700">{alert.recommended_action}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
