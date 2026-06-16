'use client';

import { useQuery } from '@tanstack/react-query';
import { enrichedDashboardApi } from '@/lib/api';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ComposedChart, Area,
} from 'recharts';
import {
  Shield,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  CalendarClock,
  Loader2,
} from 'lucide-react';

const COLORS = {
  effective: '#10b981',
  partial: '#f59e0b',
  ineffective: '#ef4444',
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-green-500/20 text-green-400',
};

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px',
};

function LoadingCard() {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 flex items-center justify-center">
      <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
    </div>
  );
}

export default function ControlTestingTab() {
  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['controlTestingSummary'],
    queryFn: () => enrichedDashboardApi.getControlTestingSummary().then(r => r.data),
  });

  const { data: deficiencyData, isLoading: deficiencyLoading } = useQuery({
    queryKey: ['controlDeficiencyTracker'],
    queryFn: () => enrichedDashboardApi.getControlDeficiencyTracker().then(r => r.data),
  });

  const { data: effectivenessData, isLoading: effectivenessLoading } = useQuery({
    queryKey: ['controlEffectivenessByType'],
    queryFn: () => enrichedDashboardApi.getControlEffectivenessByType().then(r => r.data),
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery({
    queryKey: ['controlUpcomingTests'],
    queryFn: () => enrichedDashboardApi.getControlUpcomingTests().then(r => r.data),
  });

  const passRate = summaryData?.pass_rate ?? 0;
  const testResults = summaryData?.test_results ?? { effective: 0, partial: 0, ineffective: 0 };
  const monthlyTrend = summaryData?.monthly_trend ?? [];

  const donutData = [
    { name: 'Effective', value: testResults.effective || 0, color: COLORS.effective },
    { name: 'Partial', value: testResults.partial || 0, color: COLORS.partial },
    { name: 'Ineffective', value: testResults.ineffective || 0, color: COLORS.ineffective },
  ].filter(d => d.value > 0);

  const deficiencies = [...(deficiencyData?.deficiencies ?? deficiencyData ?? [])].sort(
    (a: any, b: any) => (SEVERITY_ORDER[a.severity?.toLowerCase()] ?? 99) - (SEVERITY_ORDER[b.severity?.toLowerCase()] ?? 99)
  );

  const effectivenessByType = effectivenessData?.types ?? effectivenessData ?? [];

  const upcomingTests = upcomingData?.upcoming ?? upcomingData?.tests ?? [];
  const overdueTests = upcomingData?.overdue ?? [];

  function getDaysUntil(dateStr: string) {
    const now = new Date();
    const target = new Date(dateStr);
    return Math.ceil((target.getTime() - now.getTime()) / 86400000);
  }

  function getDateColor(dateStr: string) {
    const days = getDaysUntil(dateStr);
    if (days < 0) return 'text-red-400';
    if (days <= 7) return 'text-orange-400';
    if (days <= 30) return 'text-yellow-400';
    return 'text-green-400';
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {summaryLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-emerald-500/20 p-2">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Control Test Pass Rate</h3>
            </div>
            <div className="p-5 flex flex-col items-center">
              <div className="relative">
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie
                      data={donutData.length > 0 ? donutData : [{ name: 'No Data', value: 1, color: '#334155' }]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {(donutData.length > 0 ? donutData : [{ name: 'No Data', value: 1, color: '#334155' }]).map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white">{Math.round(passRate)}%</span>
                  <span className="text-xs text-slate-400">Pass Rate</span>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-4 mt-3">
                {[
                  { label: 'Effective', value: testResults.effective || 0, color: COLORS.effective },
                  { label: 'Partial', value: testResults.partial || 0, color: COLORS.partial },
                  { label: 'Ineffective', value: testResults.ineffective || 0, color: COLORS.ineffective },
                ].map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-slate-400">{d.label}</span>
                    <span className="text-white font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {summaryLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-blue-500/20 p-2">
                <Shield className="h-4 w-4 text-blue-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Test Results Monthly Trend</h3>
            </div>
            <div className="p-5">
              {monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                    <Bar dataKey="effective" stackId="a" fill={COLORS.effective} name="Effective" />
                    <Bar dataKey="partial" stackId="a" fill={COLORS.partial} name="Partial" />
                    <Bar dataKey="ineffective" stackId="a" fill={COLORS.ineffective} name="Ineffective" />
                    <Area type="monotone" dataKey="pass_rate" stroke="#8b5cf6" fill="none" strokeWidth={2} strokeDasharray="5 5" name="Pass Rate %" yAxisId={1} />
                    <YAxis yAxisId={1} orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} domain={[0, 100]} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Shield className="h-8 w-8 text-slate-500 mb-2" />
                  <p className="text-sm">No monthly trend data available</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {effectivenessLoading ? (
        <LoadingCard />
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Shield className="h-4 w-4 text-purple-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Control Effectiveness by Type</h3>
          </div>
          <div className="p-5">
            {effectivenessByType.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={effectivenessByType}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="type" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} domain={[0, 100]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                  <Bar dataKey="design_effectiveness" fill="#3b82f6" name="Design Effectiveness %" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="operating_effectiveness" fill="#10b981" name="Operating Effectiveness %" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Shield className="h-8 w-8 text-slate-500 mb-2" />
                <p className="text-sm">No effectiveness data by type available</p>
              </div>
            )}
          </div>
        </div>
      )}

      {deficiencyLoading ? (
        <LoadingCard />
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Deficiency Tracker</h3>
          </div>
          <div className="p-4">
            {deficiencies.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs border-b border-slate-700">
                      <th className="text-left py-2 px-3 font-medium">Control</th>
                      <th className="text-center py-2 px-3 font-medium">Severity</th>
                      <th className="text-center py-2 px-3 font-medium">Result</th>
                      <th className="text-left py-2 px-3 font-medium">Findings</th>
                      <th className="text-center py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deficiencies.map((d: any, idx: number) => {
                      const sevKey = (d.severity || 'medium').toLowerCase();
                      return (
                        <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                          <td className="py-2.5 px-3 text-slate-300">{d.control_name || d.control || d.name || `Control ${idx + 1}`}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_STYLES[sevKey] || SEVERITY_STYLES.medium}`}>
                              {d.severity || 'Medium'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`text-xs font-medium ${d.result === 'ineffective' ? 'text-red-400' : d.result === 'partial' ? 'text-yellow-400' : 'text-slate-300'}`}>
                              {d.result || d.test_result || 'N/A'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-xs max-w-[300px] truncate">{d.findings || d.description || '—'}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${d.status === 'open' ? 'bg-red-500/20 text-red-400' : d.status === 'remediated' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
                              {d.status || 'Open'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <CheckCircle className="h-8 w-8 text-slate-500 mb-2" />
                <p className="text-sm">No deficiencies found</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {upcomingLoading ? (
          <>
            <LoadingCard />
            <LoadingCard />
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
                <div className="rounded-lg bg-blue-500/20 p-2">
                  <CalendarClock className="h-4 w-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Upcoming Tests</h3>
              </div>
              <div className="p-4">
                {upcomingTests.length > 0 ? (
                  <div className="space-y-3">
                    {upcomingTests.slice(0, 8).map((test: any, idx: number) => {
                      const dateStr = test.scheduled_date || test.due_date || test.date;
                      const days = dateStr ? getDaysUntil(dateStr) : null;
                      return (
                        <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/30 transition-colors">
                          <div className="rounded-lg bg-blue-500/10 p-2">
                            <Clock className="h-4 w-4 text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{test.control_name || test.name || test.title || `Test ${idx + 1}`}</p>
                            <p className="text-xs text-slate-500">{test.control_type || test.type || 'Control Test'}</p>
                          </div>
                          {dateStr && (
                            <div className={`text-xs font-medium ${getDateColor(dateStr)}`}>
                              {days !== null && days >= 0 ? `${days}d` : 'Overdue'}
                              <div className="text-[10px] text-slate-500">{new Date(dateStr).toLocaleDateString()}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <CalendarClock className="h-8 w-8 text-slate-500 mb-2" />
                    <p className="text-sm">No upcoming tests scheduled</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
                <div className="rounded-lg bg-red-500/20 p-2">
                  <XCircle className="h-4 w-4 text-red-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Overdue Tests</h3>
              </div>
              <div className="p-4">
                {overdueTests.length > 0 ? (
                  <div className="space-y-3">
                    {overdueTests.slice(0, 8).map((test: any, idx: number) => {
                      const dateStr = test.scheduled_date || test.due_date || test.date;
                      const days = dateStr ? Math.abs(getDaysUntil(dateStr)) : null;
                      return (
                        <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/30 transition-colors">
                          <div className="rounded-lg bg-red-500/10 p-2">
                            <AlertTriangle className="h-4 w-4 text-red-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{test.control_name || test.name || test.title || `Test ${idx + 1}`}</p>
                            <p className="text-xs text-slate-500">{test.control_type || test.type || 'Control Test'}</p>
                          </div>
                          {dateStr && (
                            <div className="text-xs font-medium text-red-400">
                              {days}d overdue
                              <div className="text-[10px] text-slate-500">{new Date(dateStr).toLocaleDateString()}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                    <p className="text-sm">No overdue tests — all caught up!</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
