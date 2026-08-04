'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Users,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  Activity,
  TrendingUp,
} from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type ViewMode = 'calendar' | 'utilization' | 'conflicts';

export default function CapacityPlanningPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [selectedQuarter, setSelectedQuarter] = useState<number | undefined>(undefined);

  const { data: calendarData, isLoading: calendarLoading } = useQuery({
    queryKey: ['capacity-calendar', year, selectedQuarter],
    queryFn: () => auditApi.capacity.getCalendar({ year, quarter: selectedQuarter }).then(r => r.data),
  });

  const { data: utilizationData, isLoading: utilizationLoading } = useQuery({
    queryKey: ['capacity-utilization', year],
    queryFn: () => auditApi.capacity.getUtilization({ year }).then(r => r.data),
  });

  const { data: conflictsData, isLoading: conflictsLoading } = useQuery({
    queryKey: ['capacity-conflicts', year],
    queryFn: () => auditApi.capacity.getConflicts({ year }).then(r => r.data),
  });

  const months = calendarData?.months || MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const auditors = calendarData?.auditors || [];
  const utilization = utilizationData?.utilization || [];
  const summary = utilizationData?.summary || {};
  const conflicts = conflictsData?.conflicts || [];

  const getUtilColor = (pct: number) => {
    if (pct > 100) return 'text-rose-400';
    if (pct > 80) return 'text-amber-400';
    if (pct > 50) return 'text-emerald-400';
    return 'text-slate-600';
  };

  const getUtilBg = (pct: number) => {
    if (pct > 100) return 'bg-rose-500';
    if (pct > 80) return 'bg-amber-500';
    if (pct > 50) return 'bg-emerald-500';
    return 'bg-slate-500';
  };

  const getSeverityBadge = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };
    return colors[severity] || colors.warning;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/audit" className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-all">
            <ArrowLeft className="h-4 w-4 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Capacity Planning</h1>
            <p className="text-slate-600 mt-1">Auditor allocations, utilization & conflict management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-all">
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <span className="text-lg font-semibold text-slate-900 px-3">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-all">
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{summary.total_auditors || auditors.length || 0}</p>
          <p className="text-sm text-slate-600 mt-1">Total Auditors</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{summary.team_utilization_pct || 0}%</p>
          <p className="text-sm text-slate-600 mt-1">Team Utilization</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-lg bg-rose-500/20 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
            </div>
            {(conflicts.length > 0) && (
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
            )}
          </div>
          <p className="text-2xl font-bold text-slate-900">{conflicts.length}</p>
          <p className="text-sm text-slate-600 mt-1">Over-Allocated</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{summary.total_budget_hours || 0}</p>
          <p className="text-sm text-slate-600 mt-1">Total Budget Hours</p>
        </div>
      </div>

      <div className="flex gap-2">
        {([
          { key: 'calendar' as ViewMode, icon: Calendar, label: 'Calendar' },
          { key: 'utilization' as ViewMode, icon: BarChart3, label: 'Utilization' },
          { key: 'conflicts' as ViewMode, icon: AlertTriangle, label: 'Conflicts' },
        ]).map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setViewMode(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === key
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {key === 'conflicts' && conflicts.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-rose-500/20 text-rose-400">{conflicts.length}</span>
            )}
          </button>
        ))}

        <div className="ml-auto flex gap-1">
          {[1, 2, 3, 4].map(q => (
            <button
              key={q}
              onClick={() => setSelectedQuarter(selectedQuarter === q ? undefined : q)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                selectedQuarter === q
                  ? 'bg-purple-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              Q{q}
            </button>
          ))}
          {selectedQuarter && (
            <button
              onClick={() => setSelectedQuarter(undefined)}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
            >
              Full Year
            </button>
          )}
        </div>
      </div>

      {viewMode === 'calendar' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Auditor Allocation Timeline</h2>
            <p className="text-sm text-slate-600">Monthly engagement allocation by auditor</p>
          </div>
          {calendarLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : auditors.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No auditor allocations found for {year}</p>
              <p className="text-sm text-slate-500 mt-1">Assign team members to engagements to see capacity data</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left p-3 text-xs font-medium text-slate-600 uppercase tracking-wider min-w-[180px] sticky left-0 bg-white z-10">
                      Auditor
                    </th>
                    {months.map((m: string) => (
                      <th key={m} className="text-center p-3 text-xs font-medium text-slate-600 uppercase tracking-wider min-w-[100px]">
                        {MONTHS[parseInt(m.split('-')[1]) - 1]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditors.map((auditor: any) => (
                    <tr key={auditor.user_id} className="border-b border-slate-200/30 hover:bg-slate-100/20">
                      <td className="p-3 sticky left-0 bg-white z-10">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <span className="text-xs font-bold text-blue-400">
                              {(auditor.user_name || '?').charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900 truncate max-w-[120px]">{auditor.user_name}</p>
                            <p className="text-xs text-slate-500">{auditor.allocations?.length || 0} engagements</p>
                          </div>
                        </div>
                      </td>
                      {months.map((m: string) => {
                        const monthAllocations = auditor.allocations?.filter((a: any) =>
                          a.months?.includes(m)
                        ) || [];
                        const hours = auditor.monthly_hours?.[m] || 0;
                        return (
                          <td key={m} className="p-2">
                            {monthAllocations.length > 0 ? (
                              <div className="space-y-1">
                                {monthAllocations.map((alloc: any, idx: number) => (
                                  <div
                                    key={idx}
                                    className="rounded px-2 py-1 text-[10px] font-medium truncate"
                                    style={{ backgroundColor: `${alloc.color}30`, color: alloc.color, borderLeft: `3px solid ${alloc.color}` }}
                                    title={`${alloc.engagement_title} (${alloc.availability_percent}%)`}
                                  >
                                    {alloc.engagement_title?.substring(0, 15)}
                                  </div>
                                ))}
                                <div className="text-[10px] text-slate-500 text-center">{Math.round(hours)}h</div>
                              </div>
                            ) : (
                              <div className="h-6 rounded bg-slate-100/20" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {viewMode === 'utilization' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Auditor Utilization</h2>
            <p className="text-sm text-slate-600">Budget vs actual hours per auditor</p>
          </div>
          {utilizationLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : utilization.length === 0 ? (
            <div className="p-12 text-center">
              <BarChart3 className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-600">No utilization data available for {year}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {utilization.map((u: any) => (
                <div key={u.user_id} className="p-4 hover:bg-slate-100/20 transition-all">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-400">
                          {(u.user_name || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{u.user_name}</p>
                        <p className="text-xs text-slate-500">
                          {u.active_engagements} active · {u.engagement_count} total engagements
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className={`text-lg font-bold ${getUtilColor(u.budget_utilization_pct)}`}>
                          {u.budget_utilization_pct}%
                        </p>
                        <p className="text-xs text-slate-500">Budget Util.</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-slate-700">{u.actual_utilization_pct}%</p>
                        <p className="text-xs text-slate-500">Actual Util.</p>
                      </div>
                      {u.is_over_allocated && (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          Over-allocated
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-600">Budget Hours</span>
                        <span className="text-xs text-slate-700">{u.total_budget_hours}h / {u.available_hours}h</span>
                      </div>
                      <div className="h-2 w-full bg-white/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${getUtilBg(u.budget_utilization_pct)}`}
                          style={{ width: `${Math.min(u.budget_utilization_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-600">Actual Hours</span>
                        <span className="text-xs text-slate-700">{u.total_actual_hours}h / {u.available_hours}h</span>
                      </div>
                      <div className="h-2 w-full bg-white/50 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all bg-blue-500"
                          style={{ width: `${Math.min(u.actual_utilization_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === 'conflicts' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="p-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Allocation Conflicts</h2>
            <p className="text-sm text-slate-600">Auditors with overlapping or excessive assignments</p>
          </div>
          {conflictsLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : conflicts.length === 0 ? (
            <div className="p-12 text-center">
              <Activity className="h-12 w-12 text-emerald-500/50 mx-auto mb-3" />
              <p className="text-emerald-400 font-medium">No conflicts detected</p>
              <p className="text-sm text-slate-500 mt-1">All auditors are within allocation limits</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {conflicts.map((conflict: any) => (
                <div key={conflict.user_id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-rose-500/20 flex items-center justify-center">
                        <AlertTriangle className="h-5 w-5 text-rose-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{conflict.user_name}</p>
                        <p className="text-xs text-slate-500">{conflict.active_engagements} active engagements</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-rose-400">{conflict.total_allocation_pct}%</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getSeverityBadge(conflict.severity)}`}>
                        {conflict.severity}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2 ml-13">
                    {conflict.engagements?.map((eng: any) => (
                      <div
                        key={eng.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-white/50 border border-slate-200/30"
                      >
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-blue-400" />
                          <span className="text-sm text-slate-700">{eng.title}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-500">
                            {eng.start ? new Date(eng.start).toLocaleDateString() : '—'} → {eng.end ? new Date(eng.end).toLocaleDateString() : '—'}
                          </span>
                          <span className="text-xs font-medium text-amber-400">{eng.availability_pct}%</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            eng.status === 'fieldwork' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                            eng.status === 'planning' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                            eng.status === 'reporting' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
                            'bg-slate-500/20 text-slate-600 border-slate-500/30'
                          }`}>
                            {eng.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
