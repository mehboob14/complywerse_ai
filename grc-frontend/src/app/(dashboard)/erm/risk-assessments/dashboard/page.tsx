'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ClipboardCheck, TrendingUp, Users, Loader2, BookOpen,
  Plus, ListChecks, BarChart3,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
  CartesianGrid,
} from 'recharts';
import { ermApi } from '@/lib/api';

// ---------------------------------------------------------------------------
// Manual-assessment styling (RiskAssessment lifecycle: draft → in_progress
// → under_review → approved → closed)
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  in_progress: '#f59e0b',
  under_review: '#64748b',
  approved: '#10b981',
  closed: '#475569',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  under_review: 'Under review',
  approved: 'Approved',
  closed: 'Closed',
};

// Framework-assessment styling (FrameworkRiskAssessment lifecycle:
// in_progress → completed → archived)
const FW_STATUS_COLORS: Record<string, string> = {
  in_progress: '#f59e0b',
  completed: '#10b981',
  archived: '#475569',
};
const FW_STATUS_LABEL: Record<string, string> = {
  in_progress: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
};

const TYPE_COLORS = ['#1ed4b0', '#17b898', '#10b981', '#f59e0b', '#64748b', '#0e9384'];

export default function RiskAssessmentsDashboardPage() {
  const dashQuery = useQuery({
    queryKey: ['erm', 'risk-assessments', 'dashboard'],
    queryFn: async () => (await ermApi.riskAssessments.getDashboard()).data,
  });

  if (dashQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading assessments dashboard…
      </div>
    );
  }

  const data = dashQuery.data;
  if (!data) {
    return <div className="py-12 text-center text-sm text-slate-500">No data available.</div>;
  }

  // ---- Manual (RiskAssessment) ----
  const statusEntries = Object.entries(data.by_status).filter(([, v]) => typeof v === 'number');
  const statusBarData = statusEntries.map(([k, v]) => ({
    name: STATUS_LABEL[k] || k,
    key: k,
    value: v,
  }));
  const typeData = Object.entries(data.by_type).map(([k, v]) => ({ name: k, value: v }));
  const methodologyData = Object.entries(data.by_methodology).map(([k, v]) => ({ name: k, value: v }));

  // ---- Framework (FrameworkRiskAssessment) ----
  const fw = data.frameworks;
  const fwStatusBarData = Object.entries(fw.by_status).map(([k, v]) => ({
    name: FW_STATUS_LABEL[k] || k,
    key: k,
    value: v as number,
  }));

  const combinedTotal = data.combined_total;
  const hasAnyData = combinedTotal > 0;

  return (
    <div className="space-y-6">
      {/* Header + cross-page nav */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/erm"
            className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            title="Back to ERM"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </Link>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Assessments — Dashboard</h1>
            <p className="text-sm text-slate-500">
              Combined view of manual risk assessments and framework-driven assessments.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/erm/risk-assessments/list"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ListChecks size={16} />
            Manual assessments
          </Link>
          <Link
            href="/erm/risk-assessments/framework"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <BookOpen size={16} />
            Framework assessments
          </Link>
          <Link
            href="/erm/risk-assessments/framework"
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
          >
            <Plus size={16} strokeWidth={1.75} />
            New framework assessment
          </Link>
        </div>
      </div>

      {/* Headline KPI strip — pulls from BOTH sources so a tenant who only
          uses one flow still sees their real numbers. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="All assessments" value={combinedTotal} accent="bg-primary-50 text-primary-700" emphasis />
        <Kpi label="Manual" value={data.total} accent="bg-slate-100 text-slate-700" />
        <Kpi label="Framework" value={fw.total} accent="bg-slate-100 text-slate-700" />
        <Kpi label="Risks assessed (manual)" value={data.total_risks_assessed} accent="bg-emerald-50 text-emerald-700" />
        <Kpi label="Framework questions" value={fw.questions_total} accent="bg-amber-50 text-amber-700" />
      </div>

      {!hasAnyData && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No risk assessments yet. Start a{' '}
          <Link href="/erm/risk-assessments/framework" className="font-medium text-primary-700 hover:underline">
            framework-driven assessment
          </Link>{' '}
          or a{' '}
          <Link href="/erm/risk-assessments/list" className="font-medium text-primary-700 hover:underline">
            manual assessment
          </Link>{' '}
          to populate this dashboard.
        </div>
      )}

      {/* ---- Framework Assessments section (typically the larger one) ---- */}
      {fw.total > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <BookOpen className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            <h2 className="text-base font-semibold text-slate-900">Framework Assessments</h2>
            <span className="text-xs text-slate-500">({fw.total} total)</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="In progress" value={fw.by_status.in_progress || 0} accent="bg-amber-50 text-amber-700" />
            <Kpi label="Completed" value={fw.by_status.completed || 0} accent="bg-emerald-50 text-emerald-700" />
            <Kpi label="Archived" value={fw.by_status.archived || 0} accent="bg-slate-100 text-slate-700" />
            <Kpi label="Avg questions / assessment" value={fw.questions_per_assessment_avg} accent="bg-primary-50 text-primary-700" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section icon={<ClipboardCheck className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="Framework assessments by status">
              {fwStatusBarData.every((d) => d.value === 0) ? (
                <Empty />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fwStatusBarData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value">
                        {fwStatusBarData.map((d) => (
                          <Cell key={d.key} fill={FW_STATUS_COLORS[d.key] || '#1ed4b0'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section icon={<TrendingUp className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="Framework throughput (monthly)">
              {fw.monthly_trend.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={fw.monthly_trend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#1ed4b0" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section icon={<BarChart3 className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="By framework">
              {fw.by_framework.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={fw.by_framework}
                      layout="vertical"
                      margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis dataKey="framework" type="category" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1ed4b0" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section icon={<Users className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="Top creators">
              {fw.top_creators.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={fw.top_creators}
                      layout="vertical"
                      margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis dataKey="creator" type="category" width={180} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1ed4b0" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>
          </div>
        </>
      )}

      {/* ---- Manual Assessments section ---- */}
      {data.total > 0 && (
        <>
          <div className="flex items-center gap-2 pt-4">
            <ListChecks className="h-4 w-4 text-slate-600" strokeWidth={1.75} />
            <h2 className="text-base font-semibold text-slate-900">Manual Risk Assessments</h2>
            <span className="text-xs text-slate-500">({data.total} total)</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Kpi label="Draft" value={data.by_status.draft || 0} accent="bg-slate-100 text-slate-700" />
            <Kpi label="In progress" value={data.by_status.in_progress || 0} accent="bg-amber-50 text-amber-700" />
            <Kpi label="Under review" value={data.by_status.under_review || 0} accent="bg-slate-100 text-slate-700" />
            <Kpi label="Approved" value={data.by_status.approved || 0} accent="bg-emerald-50 text-emerald-700" />
            <Kpi label="Closed" value={data.by_status.closed || 0} accent="bg-slate-100 text-slate-700" />
            <Kpi label="Avg risks / assessment" value={data.risks_per_assessment_avg} accent="bg-primary-50 text-primary-700" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section icon={<ClipboardCheck className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="Manual assessments by status">
              {statusBarData.every((d) => d.value === 0) ? (
                <Empty />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusBarData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value">
                        {statusBarData.map((d) => (
                          <Cell key={d.key} fill={STATUS_COLORS[d.key] || '#1ed4b0'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section icon={<TrendingUp className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="Manual throughput (monthly)">
              {data.monthly_trend.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.monthly_trend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#17b898" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section title="Assessment type mix">
              {typeData.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                        {typeData.map((_, i) => (
                          <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>

            <Section title="Methodology mix">
              {methodologyData.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={methodologyData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                        {methodologyData.map((_, i) => (
                          <Cell key={i} fill={TYPE_COLORS[(i + 2) % TYPE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Section>
          </div>

          <Section icon={<Users className="h-4 w-4 text-slate-500" strokeWidth={1.75} />} title="Top assessors by workload (manual)">
            {data.top_assessors.length === 0 ? (
              <Empty />
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.top_assessors} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis dataKey="assessor" type="category" width={160} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#1ed4b0" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  emphasis,
}: {
  label: string;
  value: number;
  accent: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-lg border ${emphasis ? 'border-primary-200 bg-primary-50/50' : 'border-slate-200 bg-white'} p-3 shadow-sm`}>
      <div className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${accent}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${emphasis ? 'text-primary-900' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </header>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="py-8 text-center text-sm text-slate-500">No data yet.</div>;
}
