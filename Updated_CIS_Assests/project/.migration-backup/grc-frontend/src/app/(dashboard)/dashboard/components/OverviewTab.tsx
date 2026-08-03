'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  FileText,
  Target,
  TrendingUp,
  CheckCircle,
  Activity,
  Calendar,
  ChevronRight,
  Flame,
  Shield,
} from 'lucide-react';
import {
  RiskHeatmap,
  TrendLine,
  ChartEmptyState,
} from '@/components/charts';
import { StatusBadge } from '@/components/ui';
import AIInsightsPanel from '@/components/dashboard/AIInsightsPanel';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend,
  BarChart, Bar,
} from 'recharts';
import EnhancedDashboardWidgets from './EnhancedDashboardWidgets';
import { formatTimeAgo, getActivityIcon, getActivityColorStyles, getUrgencyStyles } from './helpers';
import { UnifiedDashboard } from './types';

const CHART_TOOLTIP_STYLE = { backgroundColor: '#FFFFFF', border: '1px solid #DDE1E7', borderRadius: '8px', color: '#1A1A1A', fontSize: '12px' };

export default function OverviewTab({ data }: { data: UnifiedDashboard }) {
  const riskTrendLabels = data.kpis.risk_trend.map(t => ({ label: t.month, value: t.value }));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AIInsightsPanel />
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(155, 28, 28, 0.08)' }}>
              <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Risk Score Distribution</h3>
          </div>
          <div className="p-5 flex flex-col items-center">
            {(() => {
              const riskTotal = (data.risk.by_score_range.critical || 0) + (data.risk.by_score_range.high || 0) + (data.risk.by_score_range.medium || 0) + (data.risk.by_score_range.low || 0);
              const riskDonutData = [
                { name: 'Critical', value: data.risk.by_score_range.critical || 0, color: '#9B1C1C' },
                { name: 'High', value: data.risk.by_score_range.high || 0, color: '#92570E' },
                { name: 'Medium', value: data.risk.by_score_range.medium || 0, color: '#B8860B' },
                { name: 'Low', value: data.risk.by_score_range.low || 0, color: '#2D6A4F' },
              ].filter(d => d.value > 0);
              if (riskTotal === 0) return (
                <ChartEmptyState title="No risk data" description="Risks will appear once added" icon={<AlertTriangle className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />} />
              );
              return (
                <>
                  <div className="relative">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={riskDonutData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" strokeWidth={0}>
                          {riskDonutData.map((entry, index) => (
                            <Cell key={index} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{riskTotal}</span>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Total</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-center gap-2.5">
                    {riskDonutData.map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                        <span style={{ color: 'var(--color-muted)' }}>{d.name}</span>
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Target className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Framework Compliance Radar</h3>
          </div>
          <div className="p-5 flex justify-center">
            {data.compliance.framework_coverage.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={data.compliance.framework_coverage.slice(0, 8).map(fw => ({ framework: fw.short_code, score: fw.score, fullMark: 100 }))}>
                  <PolarGrid stroke="#DDE1E7" />
                  <PolarAngleAxis dataKey="framework" tick={{ fill: '#6B7280', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#6B7280', fontSize: 10 }} />
                  <Radar name="Compliance" dataKey="score" stroke="#1C2B3A" fill="#1C2B3A" fillOpacity={0.15} strokeWidth={2} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmptyState title="No framework data" description="Upload frameworks to see radar view" icon={<Target className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />} />
            )}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.08)' }}>
              <FileText className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Evidence Collection Trend</h3>
          </div>
          <div className="p-5">
            {data.kpis.evidence_trend && data.kpis.evidence_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.kpis.evidence_trend}>
                  <defs>
                    <linearGradient id="evidenceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2D6A4F" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#2D6A4F" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DDE1E7" />
                  <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={{ stroke: '#DDE1E7' }} />
                  <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={{ stroke: '#DDE1E7' }} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="value" stroke="#2D6A4F" fill="url(#evidenceGrad)" strokeWidth={2} name="Evidence Items" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmptyState title="No evidence trend data" description="Data will populate as evidence is collected" icon={<FileText className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />} />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
            <TrendingUp className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
          </div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Risk vs Compliance Dual Trend</h3>
        </div>
        <div className="p-5">
          {(data.kpis.compliance_trend.length > 0 || data.kpis.risk_trend.length > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.kpis.compliance_trend.map((ct, idx) => ({
                month: ct.month,
                compliance: ct.value,
                risk: data.kpis.risk_trend[idx]?.value ?? 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#DDE1E7" />
                <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={{ stroke: '#DDE1E7' }} />
                <YAxis tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={{ stroke: '#DDE1E7' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ color: '#6B7280', fontSize: '12px' }} />
                <Line type="monotone" dataKey="compliance" stroke="#1C2B3A" strokeWidth={2} dot={{ fill: '#1C2B3A', r: 3 }} name="Compliance %" />
                <Line type="monotone" dataKey="risk" stroke="#92570E" strokeWidth={2} dot={{ fill: '#92570E', r: 3 }} name="Risk Score" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState title="No trend data yet" description="Trends will populate over time" icon={<TrendingUp className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />} />
          )}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
            <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
          </div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Governance Health Scorecard</h3>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(() => {
              const publishedCount = data.governance.by_status?.published || data.governance.by_status?.Published || 0;
              const docHealthPct = data.governance.total_documents > 0 ? Math.round((publishedCount / data.governance.total_documents) * 100) : 0;
              const approvalPct = data.governance.total_documents > 0 ? Math.round(((data.governance.total_documents - data.governance.pending_approvals) / data.governance.total_documents) * 100) : 100;
              const reviewOverduePct = data.governance.total_documents > 0 ? Math.round((data.governance.overdue_reviews / data.governance.total_documents) * 100) : 0;
              const attestationPct = Math.round(data.attestations.completion_rate || 0);
              const gauges = [
                { label: 'Document Health', value: docHealthPct, subtitle: `${publishedCount} published`, color: docHealthPct >= 70 ? '#2D6A4F' : docHealthPct >= 40 ? '#92570E' : '#9B1C1C' },
                { label: 'Approval Pipeline', value: approvalPct, subtitle: `${data.governance.pending_approvals} pending`, color: approvalPct >= 80 ? '#2D6A4F' : approvalPct >= 50 ? '#92570E' : '#9B1C1C' },
                { label: 'Review Compliance', value: 100 - reviewOverduePct, subtitle: `${data.governance.overdue_reviews} overdue`, color: reviewOverduePct <= 10 ? '#2D6A4F' : reviewOverduePct <= 30 ? '#92570E' : '#9B1C1C' },
                { label: 'Attestation Coverage', value: attestationPct, subtitle: `${data.attestations.pending_responses} pending`, color: attestationPct >= 80 ? '#2D6A4F' : attestationPct >= 50 ? '#92570E' : '#9B1C1C' },
              ];
              return gauges.map((g, idx) => (
                <div key={idx} className="flex flex-col items-center p-4 rounded-xl" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <div className="relative w-20 h-20">
                    <svg viewBox="0 0 36 36" className="w-20 h-20 transform -rotate-90">
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="#DDE1E7" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke={g.color} strokeWidth="3" strokeDasharray={`${g.value * 0.974} 100`} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{g.value}%</span>
                    </div>
                  </div>
                  <span className="mt-2.5 text-center text-xs font-medium" style={{ color: 'var(--color-text)' }}>{g.label}</span>
                  <span className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{g.subtitle}</span>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(155, 28, 28, 0.08)' }}>
                <Flame className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Top Risks Summary</h3>
            </div>
          </div>
          <div className="p-4">
            {data.risk.heatmap.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <th className="text-left py-2 px-2 font-medium" style={{ color: 'var(--color-muted)' }}>Risk</th>
                      <th className="text-center py-2 px-2 font-medium" style={{ color: 'var(--color-muted)' }}>Likelihood</th>
                      <th className="text-center py-2 px-2 font-medium" style={{ color: 'var(--color-muted)' }}>Impact</th>
                      <th className="text-center py-2 px-2 font-medium" style={{ color: 'var(--color-muted)' }}>Score</th>
                      <th className="text-center py-2 px-2 font-medium" style={{ color: 'var(--color-muted)' }}>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.risk.heatmap
                      .map(h => ({ ...h, score: h.likelihood * h.impact }))
                      .sort((a, b) => b.score - a.score)
                      .slice(0, 5)
                      .map((item, idx) => {
                        const severity = item.score >= 20 ? 'Critical' : item.score >= 12 ? 'High' : item.score >= 6 ? 'Medium' : 'Low';
                        const sevStyles = item.score >= 20
                          ? { backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' }
                          : item.score >= 12
                          ? { backgroundColor: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' }
                          : item.score >= 6
                          ? { backgroundColor: 'rgba(146, 87, 14, 0.08)', color: 'var(--color-warning)' }
                          : { backgroundColor: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)' };
                        return (
                          <tr key={idx} className="transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="py-2.5 px-2" style={{ color: 'var(--color-text)' }}>Risk Zone {idx + 1}</td>
                            <td className="py-2.5 px-2 text-center" style={{ color: 'var(--color-text)' }}>{item.likelihood}</td>
                            <td className="py-2.5 px-2 text-center" style={{ color: 'var(--color-text)' }}>{item.impact}</td>
                            <td className="py-2.5 px-2 text-center font-semibold" style={{ color: 'var(--color-text)' }}>{item.score}</td>
                            <td className="py-2.5 px-2 text-center">
                              <span className="text-xs px-2 py-0.5 rounded" style={sevStyles}>{severity}</span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ChartEmptyState title="No risk data" description="Risks will appear once registered" icon={<AlertTriangle className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />} />
            )}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Shield className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Control Implementation Progress</h3>
          </div>
          <div className="p-5">
            {data.compliance.framework_coverage.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(180, data.compliance.framework_coverage.length * 38)}>
                <BarChart
                  data={data.compliance.framework_coverage.map(fw => ({
                    name: fw.short_code,
                    implemented: fw.implemented_controls,
                    gap: Math.max(0, fw.total_controls - fw.implemented_controls),
                  }))}
                  layout="vertical"
                  margin={{ left: 10, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#DDE1E7" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={{ stroke: '#DDE1E7' }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#6B7280', fontSize: 11 }} axisLine={{ stroke: '#DDE1E7' }} width={60} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#6B7280', fontSize: '12px' }} />
                  <Bar dataKey="implemented" stackId="a" fill="#2D6A4F" name="Implemented" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="gap" stackId="a" fill="#DDE1E7" name="Gap" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmptyState title="No framework data" description="Upload frameworks to see control implementation" icon={<Shield className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />} />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
                <Activity className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Recent Activity</h3>
            </div>
          </div>
          <div className="p-4">
            {data.recent_activity.length > 0 ? (
              <div className="space-y-3">
                {data.recent_activity.slice(0, 6).map((activity, idx) => {
                  const Icon = getActivityIcon(activity.type);
                  const colorStyles = getActivityColorStyles(activity.type);
                  return (
                    <Link
                      key={idx}
                      href={activity.link}
                      className="flex items-center gap-3 p-2 rounded-lg transition-colors group"
                    >
                      <div className="rounded-lg p-2" style={colorStyles}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate transition-colors" style={{ color: 'var(--color-text)' }}>
                          {activity.title}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {activity.action} • {formatTimeAgo(activity.timestamp)}
                        </p>
                      </div>
                      <StatusBadge status={activity.status} />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <ChartEmptyState
                title="No recent activity"
                description="Activity will appear here as you work with the system"
                icon={<Activity className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
              />
            )}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
                <Calendar className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upcoming Deadlines</h3>
            </div>
          </div>
          <div className="p-4">
            {data.upcoming_deadlines.length > 0 ? (
              <div className="space-y-3">
                {data.upcoming_deadlines.slice(0, 5).map((deadline, idx) => {
                  const urgencyStyles = getUrgencyStyles(deadline.urgency);
                  return (
                    <Link
                      key={idx}
                      href={deadline.link}
                      className="flex items-center gap-3 p-2 rounded-lg transition-colors group"
                    >
                      <div className="rounded-lg px-2 py-1 text-xs font-medium" style={{ ...urgencyStyles, border: `1px solid ${urgencyStyles.borderColor}` }}>
                        {deadline.days_remaining < 0
                          ? `${Math.abs(deadline.days_remaining)}d overdue`
                          : deadline.days_remaining === 0
                          ? 'Today'
                          : `${deadline.days_remaining}d`}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate transition-colors" style={{ color: 'var(--color-text)' }}>
                          {deadline.title}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {new Date(deadline.due_date).toLocaleDateString()}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 transition-colors" style={{ color: 'var(--color-muted)' }} />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <ChartEmptyState
                title="No upcoming deadlines"
                description="Deadlines will appear here as policies and mitigations are scheduled"
                icon={<Calendar className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
              />
            )}
          </div>
        </div>
      </div>

      <EnhancedDashboardWidgets />
    </div>
  );
}
