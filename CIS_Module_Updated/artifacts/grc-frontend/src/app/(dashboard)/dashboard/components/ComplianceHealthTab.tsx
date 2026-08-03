'use client';

import { useQuery } from '@tanstack/react-query';
import { enrichedDashboardApi } from '@/lib/api';
import {
  Shield,
  CheckCircle,
  ClipboardCheck,
  FileCheck,
  AlertTriangle,
  Archive,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  RadialBarChart,
  RadialBar,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

const TOOLTIP_STYLE = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px',
};

function LoadingCard() {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 flex items-center justify-center min-h-[200px]">
      <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
    </div>
  );
}

function getPostureBadgeColor(level: string) {
  switch (level?.toLowerCase()) {
    case 'strong':
    case 'excellent':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'good':
    case 'adequate':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'moderate':
    case 'fair':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'weak':
    case 'poor':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    default:
      return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  }
}

function getScoreColor(score: number) {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export default function ComplianceHealthTab() {
  const postureQuery = useQuery({
    queryKey: ['compliance-health-posture'],
    queryFn: () => enrichedDashboardApi.getCompliancePosture().then(r => r.data),
  });

  const controlEffQuery = useQuery({
    queryKey: ['compliance-health-control-effectiveness'],
    queryFn: () => enrichedDashboardApi.getControlEffectiveness().then(r => r.data),
  });

  const auditQuery = useQuery({
    queryKey: ['compliance-health-audit-readiness'],
    queryFn: () => enrichedDashboardApi.getAuditReadiness().then(r => r.data),
  });

  const attestationQuery = useQuery({
    queryKey: ['compliance-health-attestation-status'],
    queryFn: () => enrichedDashboardApi.getAttestationStatus().then(r => r.data),
  });

  const exceptionQuery = useQuery({
    queryKey: ['compliance-health-exception-aging'],
    queryFn: () => enrichedDashboardApi.getExceptionAging().then(r => r.data),
  });

  const evidenceQuery = useQuery({
    queryKey: ['compliance-health-evidence-status'],
    queryFn: () => enrichedDashboardApi.getEvidenceStatus().then(r => r.data),
  });

  const posture = postureQuery.data;
  const controlEff = controlEffQuery.data;
  const audit = auditQuery.data;
  const attestation = attestationQuery.data;
  const exceptionAging = exceptionQuery.data;
  const evidence = evidenceQuery.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {postureQuery.isLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-blue-500/20 p-2">
                <Shield className="h-4 w-4 text-blue-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Compliance Posture</h3>
            </div>
            <div className="p-5 flex flex-col items-center">
              <div className="relative w-32 h-32 mb-4">
                <svg viewBox="0 0 36 36" className="w-32 h-32 transform -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="#334155" strokeWidth="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.5"
                    fill="none"
                    stroke={getScoreColor(posture?.overall_score ?? 0)}
                    strokeWidth="3"
                    strokeDasharray={`${(posture?.overall_score ?? 0) * 0.974} 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white">{posture?.overall_score ?? 0}%</span>
                </div>
              </div>
              {posture?.posture_level && (
                <span className={`text-xs px-3 py-1 rounded-full border font-medium ${getPostureBadgeColor(posture.posture_level)}`}>
                  {posture.posture_level}
                </span>
              )}
            </div>
          </div>
        )}

        {postureQuery.isLoading ? (
          <LoadingCard />
        ) : (
          <div className="lg:col-span-2 rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-emerald-500/20 p-2">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Per-Framework Compliance</h3>
            </div>
            <div className="p-5">
              {posture?.frameworks && posture.frameworks.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(200, (posture.frameworks.length || 1) * 45)}>
                  <BarChart
                    data={posture.frameworks.map((fw: any) => ({
                      name: fw.short_code || fw.name || fw.framework_name,
                      score: fw.score ?? fw.compliance_score ?? 0,
                    }))}
                    layout="vertical"
                    margin={{ left: 10, right: 30 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} width={80} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => [`${value}%`, 'Score']} />
                    <Bar dataKey="score" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <Shield className="h-8 w-8 mb-2" />
                  <p className="text-sm">No framework data available</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {controlEffQuery.isLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-purple-500/20 p-2">
                <ClipboardCheck className="h-4 w-4 text-purple-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Control Effectiveness</h3>
            </div>
            <div className="p-5">
              {controlEff ? (
                <div className="flex items-center justify-around">
                  {[
                    { label: 'Design', rawValue: controlEff.design_effectiveness ?? controlEff.design ?? 0, color: '#8b5cf6' },
                    { label: 'Operating', rawValue: controlEff.operating_effectiveness ?? controlEff.operating ?? 0, color: '#06b6d4' },
                  ].map((item) => {
                    let effectiveVal = 0;
                    if (typeof item.rawValue === 'number') {
                      effectiveVal = item.rawValue;
                    } else if (item.rawValue && typeof item.rawValue === 'object') {
                      const obj = item.rawValue as any;
                      const total = (obj.effective || 0) + (obj.partially_effective || 0) + (obj.ineffective || 0) + (obj.not_tested || 0);
                      effectiveVal = total > 0 ? Math.round(((obj.effective || 0) / total) * 100) : 0;
                    }
                    const donutData = [
                      { name: 'Effective', value: effectiveVal },
                      { name: 'Gap', value: 100 - effectiveVal },
                    ];
                    return (
                      <div key={item.label} className="flex flex-col items-center">
                        <div className="relative">
                          <ResponsiveContainer width={140} height={140}>
                            <PieChart>
                              <Pie
                                data={donutData}
                                cx="50%"
                                cy="50%"
                                innerRadius={42}
                                outerRadius={60}
                                dataKey="value"
                                strokeWidth={0}
                                startAngle={90}
                                endAngle={-270}
                              >
                                <Cell fill={item.color} />
                                <Cell fill="#334155" />
                              </Pie>
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-bold text-white">{effectiveVal}%</span>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-slate-300 mt-2">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <ClipboardCheck className="h-8 w-8 mb-2" />
                  <p className="text-sm">No control effectiveness data</p>
                </div>
              )}
              {controlEff?.breakdown && Array.isArray(controlEff.breakdown) && controlEff.breakdown.length > 0 && (
                <div className="mt-4 space-y-2">
                  {controlEff.breakdown.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">{item.category || item.type || item.name}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-slate-700 rounded-full h-2">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${item.effectiveness ?? item.score ?? 0}%`,
                              backgroundColor: getScoreColor(item.effectiveness ?? item.score ?? 0),
                            }}
                          />
                        </div>
                        <span className="text-slate-300 w-10 text-right">{item.effectiveness ?? item.score ?? 0}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {auditQuery.isLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-cyan-500/20 p-2">
                <FileCheck className="h-4 w-4 text-cyan-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Audit Readiness</h3>
            </div>
            <div className="p-5">
              {audit ? (
                <div className="flex flex-col items-center">
                  <div className="relative w-28 h-28 mb-4">
                    <svg viewBox="0 0 36 36" className="w-28 h-28 transform -rotate-90">
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="#334155" strokeWidth="3" />
                      <circle
                        cx="18"
                        cy="18"
                        r="15.5"
                        fill="none"
                        stroke={getScoreColor(audit.readiness_score ?? audit.score ?? 0)}
                        strokeWidth="3"
                        strokeDasharray={`${(audit.readiness_score ?? audit.score ?? 0) * 0.974} 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold text-white">{audit.readiness_score ?? audit.score ?? 0}%</span>
                      <span className="text-[10px] text-slate-400">Ready</span>
                    </div>
                  </div>
                  {audit.components && Array.isArray(audit.components) && (
                    <div className="w-full space-y-3 mt-2">
                      {audit.components.map((comp: any, idx: number) => (
                        <div key={idx}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-400">{comp.name || comp.component}</span>
                            <span className="text-slate-300">{comp.score ?? comp.readiness ?? 0}%</span>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${comp.score ?? comp.readiness ?? 0}%`,
                                backgroundColor: getScoreColor(comp.score ?? comp.readiness ?? 0),
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <FileCheck className="h-8 w-8 mb-2" />
                  <p className="text-sm">No audit readiness data</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {attestationQuery.isLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-amber-500/20 p-2">
                <CheckCircle className="h-4 w-4 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Attestation Status</h3>
            </div>
            <div className="p-5">
              {attestation?.campaigns && Array.isArray(attestation.campaigns) && attestation.campaigns.length > 0 ? (
                <div className="space-y-4">
                  {attestation.campaigns.map((campaign: any, idx: number) => (
                    <div key={idx}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-300 truncate mr-2">{campaign.name || campaign.campaign_name}</span>
                        <span className="text-slate-400 whitespace-nowrap">{campaign.completion_rate ?? campaign.completion ?? 0}%</span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-2.5">
                        <div
                          className="h-2.5 rounded-full transition-all"
                          style={{
                            width: `${campaign.completion_rate ?? campaign.completion ?? 0}%`,
                            backgroundColor: getScoreColor(campaign.completion_rate ?? campaign.completion ?? 0),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <CheckCircle className="h-8 w-8 mb-2" />
                  <p className="text-sm">No attestation campaigns</p>
                </div>
              )}
              {attestation && (attestation.overall_completion !== undefined || attestation.completion_rate !== undefined) && (
                <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between">
                  <span className="text-sm text-slate-400">Overall Completion</span>
                  <span className="text-lg font-bold text-white">{attestation.overall_completion ?? attestation.completion_rate ?? 0}%</span>
                </div>
              )}
            </div>
          </div>
        )}

        {exceptionQuery.isLoading ? (
          <LoadingCard />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
              <div className="rounded-lg bg-red-500/20 p-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Exception Aging</h3>
            </div>
            <div className="p-5">
              {exceptionAging ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart
                    data={[
                      {
                        bucket: 'Aging',
                        '0-30 days': exceptionAging['0_30'] ?? exceptionAging.bucket_0_30 ?? exceptionAging['0-30'] ?? 0,
                        '31-60 days': exceptionAging['31_60'] ?? exceptionAging.bucket_31_60 ?? exceptionAging['31-60'] ?? 0,
                        '61-90 days': exceptionAging['61_90'] ?? exceptionAging.bucket_61_90 ?? exceptionAging['61-90'] ?? 0,
                        '90+ days': exceptionAging['90_plus'] ?? exceptionAging.bucket_90_plus ?? exceptionAging['90+'] ?? 0,
                      },
                    ]}
                    margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="bucket" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                    <Bar dataKey="0-30 days" stackId="a" fill="#10b981" />
                    <Bar dataKey="31-60 days" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="61-90 days" stackId="a" fill="#f97316" />
                    <Bar dataKey="90+ days" stackId="a" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                  <AlertTriangle className="h-8 w-8 mb-2" />
                  <p className="text-sm">No exception aging data</p>
                </div>
              )}
              {exceptionAging?.buckets && Array.isArray(exceptionAging.buckets) && (
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {exceptionAging.buckets.map((b: any, idx: number) => (
                    <div key={idx} className="rounded-lg bg-slate-900/50 border border-slate-700 p-3 text-center">
                      <div className="text-lg font-bold text-white">{b.count ?? 0}</div>
                      <div className="text-[10px] text-slate-400">{b.label || b.range}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {evidenceQuery.isLoading ? (
        <LoadingCard />
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-indigo-500/20 p-2">
              <Archive className="h-4 w-4 text-indigo-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Evidence Collection</h3>
          </div>
          <div className="p-5">
            {evidence ? (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="flex flex-col items-center">
                  <div className="relative">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Mapped', value: evidence.mapped ?? evidence.mapped_count ?? 0 },
                            { name: 'Unmapped', value: evidence.unmapped ?? evidence.unmapped_count ?? 0 },
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={68}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          <Cell fill="#10b981" />
                          <Cell fill="#475569" />
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-bold text-white">
                        {(evidence.mapped ?? evidence.mapped_count ?? 0) + (evidence.unmapped ?? evidence.unmapped_count ?? 0)}
                      </span>
                      <span className="text-[10px] text-slate-400">Total</span>
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                      <span className="text-slate-400">Mapped</span>
                      <span className="text-white font-medium">{evidence.mapped ?? evidence.mapped_count ?? 0}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                      <span className="text-slate-400">Unmapped</span>
                      <span className="text-white font-medium">{evidence.unmapped ?? evidence.unmapped_count ?? 0}</span>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Total Evidence', value: evidence.total ?? evidence.total_count ?? '-', color: 'text-blue-400' },
                    { label: 'Collection Rate', value: evidence.collection_rate != null ? `${evidence.collection_rate}%` : '-', color: 'text-emerald-400' },
                    { label: 'Velocity', value: evidence.collection_velocity ?? evidence.velocity ?? '-', color: 'text-purple-400' },
                    { label: 'Pending Review', value: evidence.pending_review ?? evidence.pending ?? '-', color: 'text-amber-400' },
                    { label: 'Expired', value: evidence.expired ?? evidence.expired_count ?? '-', color: 'text-red-400' },
                    { label: 'Auto-Collected', value: evidence.auto_collected ?? '-', color: 'text-cyan-400' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-slate-900/50 border border-slate-700 p-4">
                      <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                      <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-slate-500">
                <Archive className="h-8 w-8 mb-2" />
                <p className="text-sm">No evidence data available</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}