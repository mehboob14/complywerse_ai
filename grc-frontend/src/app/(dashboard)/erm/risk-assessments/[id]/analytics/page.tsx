'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, ShieldCheck, Scale, Activity } from 'lucide-react';
import {
  BarChart,
  Bar,
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

const RATING_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#10b981',
};

const TREATMENT_COLORS: Record<string, string> = {
  accept: '#94a3b8',
  mitigate: '#3b82f6',
  transfer: '#a855f7',
  avoid: '#ef4444',
};

const EFFECTIVENESS_COLORS: Record<string, string> = {
  effective: '#10b981',
  partially_effective: '#f59e0b',
  ineffective: '#ef4444',
  unrated: '#94a3b8',
};

export default function AssessmentAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const assessmentId = Number(params?.id);

  const breakdownQuery = useQuery({
    queryKey: ['erm', 'risk-assessments', assessmentId, 'risk-breakdown'],
    queryFn: async () => (await ermApi.riskAssessments.getRiskBreakdown(assessmentId)).data,
    enabled: Number.isFinite(assessmentId),
  });

  if (breakdownQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading analytics…
      </div>
    );
  }

  const data = breakdownQuery.data;
  if (!data) {
    return <div className="py-12 text-center text-sm text-gray-500">No data available.</div>;
  }

  const ratingData = Object.entries(data.by_rating).map(([k, v]) => ({ name: k, value: v, key: k }));
  const treatmentData = Object.entries(data.by_treatment).map(([k, v]) => ({ name: k, value: v, key: k }));
  const effData = Object.entries(data.by_effectiveness).map(([k, v]) => ({
    name: k.replace('_', ' '),
    value: v,
    key: k,
  }));
  const scoreData = Object.entries(data.by_score_range).map(([k, v]) => ({
    name: k,
    value: v,
    key: k,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/erm/risk-assessments/${assessmentId}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Assessment
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{data.assessment_name}</h1>
        <p className="text-sm text-gray-500">
          Status: <span className="font-medium text-gray-700">{data.status}</span> ·{' '}
          {data.total_risks} risks assessed
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total risks" value={data.total_risks} accent="bg-gray-100 text-gray-700" />
        <Kpi label="Avg inherent" value={data.avg_inherent_score} accent="bg-orange-50 text-orange-700" />
        <Kpi label="Avg residual" value={data.avg_residual_score} accent="bg-blue-50 text-blue-700" />
        <Kpi label="Score reduction" value={data.score_reduction} accent="bg-emerald-50 text-emerald-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Risk rating distribution" icon={<Activity className="h-4 w-4 text-gray-500" />}>
          {ratingData.every((d) => d.value === 0) ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ratingData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>
                    {ratingData.map((d) => (
                      <Cell key={d.key} fill={RATING_COLORS[d.key] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="Treatment decisions" icon={<Scale className="h-4 w-4 text-gray-500" />}>
          {treatmentData.every((d) => d.value === 0) ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={treatmentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label>
                    {treatmentData.map((d) => (
                      <Cell key={d.key} fill={TREATMENT_COLORS[d.key] || '#94a3b8'} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="Control effectiveness" icon={<ShieldCheck className="h-4 w-4 text-gray-500" />}>
          {effData.every((d) => d.value === 0) ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={effData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value">
                    {effData.map((d) => (
                      <Cell key={d.key} fill={EFFECTIVENESS_COLORS[d.key] || '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="Score band distribution">
          {scoreData.every((d) => d.value === 0) ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={scoreData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value">
                    {scoreData.map((d) => (
                      <Cell key={d.key} fill={RATING_COLORS[d.key] || '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
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
