'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, TrendingUp, Users, Loader2 } from 'lucide-react';
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

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  in_progress: '#f59e0b',
  under_review: '#a855f7',
  approved: '#10b981',
  closed: '#6b7280',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  under_review: 'Under review',
  approved: 'Approved',
  closed: 'Closed',
};

const TYPE_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

export default function RiskAssessmentsDashboardPage() {
  const dashQuery = useQuery({
    queryKey: ['erm', 'risk-assessments', 'dashboard'],
    queryFn: async () => (await ermApi.riskAssessments.getDashboard()).data,
  });

  if (dashQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading assessments dashboard…
      </div>
    );
  }

  const data = dashQuery.data;
  if (!data) {
    return <div className="py-12 text-center text-sm text-gray-500">No data available.</div>;
  }

  const statusEntries = Object.entries(data.by_status).filter(([, v]) => typeof v === 'number');
  const statusBarData = statusEntries.map(([k, v]) => ({
    name: STATUS_LABEL[k] || k,
    key: k,
    value: v,
  }));
  const typeData = Object.entries(data.by_type).map(([k, v]) => ({ name: k, value: v }));
  const methodologyData = Object.entries(data.by_methodology).map(([k, v]) => ({ name: k, value: v }));

  const inProgress = data.by_status.in_progress || 0;
  const approved = data.by_status.approved || 0;
  const underReview = data.by_status.under_review || 0;
  const closed = data.by_status.closed || 0;
  const draft = data.by_status.draft || 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/erm/risk-assessments"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Risk Assessments
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">Risk Assessments Dashboard</h1>
        <p className="text-sm text-gray-500">
          Status mix, throughput trend, methodologies and assessor workload.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Total" value={data.total} accent="bg-gray-100 text-gray-700" />
        <Kpi label="Draft" value={draft} accent="bg-slate-100 text-slate-700" />
        <Kpi label="In progress" value={inProgress} accent="bg-amber-50 text-amber-700" />
        <Kpi label="Under review" value={underReview} accent="bg-purple-50 text-purple-700" />
        <Kpi label="Approved" value={approved} accent="bg-emerald-50 text-emerald-700" />
        <Kpi label="Closed" value={closed} accent="bg-gray-100 text-gray-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<ClipboardCheck className="h-4 w-4 text-gray-500" />} title="Assessments by status">
          {statusBarData.every((d) => d.value === 0) ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusBarData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value">
                    {statusBarData.map((d) => (
                      <Cell key={d.key} fill={STATUS_COLORS[d.key] || '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section icon={<TrendingUp className="h-4 w-4 text-gray-500" />} title="Monthly throughput">
          {data.monthly_trend.length === 0 ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.monthly_trend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="Assessment type mix">
          {typeData.length === 0 ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>
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
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={methodologyData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>
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

      <Section icon={<Users className="h-4 w-4 text-gray-500" />} title="Top assessors by workload">
        {data.top_assessors.length === 0 ? (
          <Empty />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.top_assessors} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis dataKey="assessor" type="category" width={160} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-gray-600">
          <strong className="text-gray-900">{data.total_risks_assessed}</strong> risks have been
          assessed across all assessments — averaging{' '}
          <strong className="text-gray-900">{data.risks_per_assessment_avg}</strong> per assessment.
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${accent}`}>{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
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
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </header>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="py-8 text-center text-sm text-gray-500">No data yet.</div>;
}
