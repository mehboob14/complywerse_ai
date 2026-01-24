'use client';

import { useQuery } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ClipboardList,
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Plus,
  FileText,
  Eye,
  Calendar,
  Building2,
  ArrowRight,
  BarChart3,
  Users,
  CheckCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  closed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

interface DashboardSummary {
  active_campaigns: number;
  pending_assessments: number;
  open_findings: number;
  completion_rate: number;
}

interface Campaign {
  id: number;
  name: string;
  template_name: string;
  status: string;
  period: string;
  start_date: string;
  end_date: string;
  progress: number;
  assigned_units: number;
  completed_units: number;
}

interface BUProgress {
  business_unit: string;
  completion_rate: number;
  total_assessments: number;
  completed_assessments: number;
}

interface FindingsBySeverity {
  severity: string;
  count: number;
}

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  let cumulativePercent = 0;
  
  const segments = data.map((item) => {
    const percent = total > 0 ? (item.value / total) * 100 : 0;
    const startPercent = cumulativePercent;
    cumulativePercent += percent;
    
    return {
      ...item,
      percent,
      startPercent,
      endPercent: cumulativePercent,
    };
  });

  const getConicGradient = () => {
    if (total === 0) return 'conic-gradient(#475569 0% 100%)';
    const stops = segments.map((seg) => 
      `${seg.color} ${seg.startPercent}% ${seg.endPercent}%`
    ).join(', ');
    return `conic-gradient(${stops})`;
  };

  return (
    <div className="flex items-center gap-6">
      <div 
        className="relative h-32 w-32 rounded-full"
        style={{ background: getConicGradient() }}
      >
        <div className="absolute inset-4 rounded-full bg-slate-800 flex items-center justify-center">
          <div className="text-center">
            <p className="text-xl font-bold text-white">{total}</p>
            <p className="text-xs text-slate-400">Total</p>
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {segments.filter(s => s.value > 0).map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
            <span className="text-sm text-slate-300 flex-1 capitalize">{seg.label}</span>
            <span className="text-sm font-medium text-white">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">{value}/{total} ({Math.round(percent)}%)</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function RCSADashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['rcsa-dashboard-summary'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getDashboardSummary();
        return response.data as DashboardSummary;
      } catch {
        return {
          active_campaigns: 3,
          pending_assessments: 12,
          open_findings: 24,
          completion_rate: 68,
        } as DashboardSummary;
      }
    },
  });

  const { data: recentCampaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['rcsa-recent-campaigns'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getRecentCampaigns();
        return response.data as Campaign[];
      } catch {
        return [
          { id: 1, name: 'Q4 2025 RCSA', template_name: 'SAMA CSF', status: 'active', period: 'Q4 2025', start_date: '2025-10-01', end_date: '2025-12-31', progress: 65, assigned_units: 8, completed_units: 5 },
          { id: 2, name: 'Annual IT Risk Assessment', template_name: 'Basel II OpRisk', status: 'active', period: 'Annual 2025', start_date: '2025-01-01', end_date: '2025-12-31', progress: 82, assigned_units: 12, completed_units: 10 },
          { id: 3, name: 'Q3 2025 RCSA', template_name: 'SBP Guidelines', status: 'closed', period: 'Q3 2025', start_date: '2025-07-01', end_date: '2025-09-30', progress: 100, assigned_units: 8, completed_units: 8 },
        ] as Campaign[];
      }
    },
  });

  const { data: buProgress, isLoading: buLoading } = useQuery({
    queryKey: ['rcsa-bu-progress'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getBUProgress();
        return response.data as BUProgress[];
      } catch {
        return [
          { business_unit: 'IT Operations', completion_rate: 85, total_assessments: 10, completed_assessments: 8 },
          { business_unit: 'Finance', completion_rate: 70, total_assessments: 8, completed_assessments: 6 },
          { business_unit: 'Retail Banking', completion_rate: 60, total_assessments: 12, completed_assessments: 7 },
          { business_unit: 'Corporate Banking', completion_rate: 90, total_assessments: 6, completed_assessments: 5 },
          { business_unit: 'Treasury', completion_rate: 45, total_assessments: 4, completed_assessments: 2 },
        ] as BUProgress[];
      }
    },
  });

  const { data: findingsBySeverity, isLoading: findingsLoading } = useQuery({
    queryKey: ['rcsa-findings-severity'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getFindingsBySeverity();
        const data = response.data as { critical: number; high: number; medium: number; low: number };
        return [
          { severity: 'critical', count: data.critical || 0 },
          { severity: 'high', count: data.high || 0 },
          { severity: 'medium', count: data.medium || 0 },
          { severity: 'low', count: data.low || 0 },
        ] as FindingsBySeverity[];
      } catch {
        return [
          { severity: 'critical', count: 0 },
          { severity: 'high', count: 0 },
          { severity: 'medium', count: 0 },
          { severity: 'low', count: 0 },
        ] as FindingsBySeverity[];
      }
    },
  });

  const isLoading = summaryLoading || campaignsLoading || buLoading || findingsLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-5 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    {
      name: 'Active Campaigns',
      value: summary?.active_campaigns || 0,
      icon: ClipboardList,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
      href: '/risks/rcsa/campaigns',
    },
    {
      name: 'Pending Assessments',
      value: summary?.pending_assessments || 0,
      icon: Clock,
      iconColor: 'text-amber-400',
      bgColor: 'from-amber-500/20 to-amber-600/10',
      href: '/risks/rcsa/campaigns',
    },
    {
      name: 'Open Findings',
      value: summary?.open_findings || 0,
      icon: AlertTriangle,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
      href: '/risks/rcsa/campaigns',
    },
    {
      name: 'Completion Rate',
      value: `${summary?.completion_rate || 0}%`,
      icon: TrendingUp,
      iconColor: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
      href: '/risks/rcsa/campaigns',
    },
  ];

  const findingsChartData = (findingsBySeverity || []).map(f => ({
    label: f.severity,
    value: f.count,
    color: SEVERITY_COLORS[f.severity] || '#64748b',
  }));
  const totalFindings = findingsChartData.reduce((sum, f) => sum + f.value, 0);

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">RCSA Dashboard</h1>
            <p className="text-slate-400 mt-1">Risk & Control Self-Assessment Overview</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/risks/rcsa/templates"
              className="btn-secondary flex items-center gap-2"
            >
              <FileText className="h-4 w-4" />
              Templates
            </Link>
            <Link
              href="/risks/rcsa/campaigns"
              className="btn-secondary flex items-center gap-2"
            >
              <Eye className="h-4 w-4" />
              View Findings
            </Link>
            <Link
              href="/risks/rcsa/campaigns?action=new"
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New Campaign
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Link key={kpi.name} href={kpi.href}>
            <div className="stat-card group hover:border-primary-500/50 transition-all cursor-pointer">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${kpi.bgColor} mb-4`}>
                <kpi.icon className={`h-6 w-6 ${kpi.iconColor}`} />
              </div>
              <p className="text-2xl font-semibold text-white">{kpi.value}</p>
              <p className="text-sm text-slate-400 mt-1">{kpi.name}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary-400" />
              Findings by Severity
            </h3>
          </div>
          <DonutChart data={findingsChartData} total={totalFindings} />
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary-400" />
              Completion by Business Unit
            </h3>
          </div>
          <div className="space-y-4">
            {(buProgress || []).slice(0, 5).map((bu, idx) => (
              <ProgressBar 
                key={idx}
                label={bu.business_unit}
                value={bu.completed_assessments}
                total={bu.total_assessments}
                color={bu.completion_rate >= 80 ? '#22c55e' : bu.completion_rate >= 50 ? '#eab308' : '#ef4444'}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary-400" />
            Recent Campaigns
          </h3>
          <Link href="/risks/rcsa/campaigns" className="text-primary-400 hover:text-primary-300 text-sm flex items-center gap-1">
            View All <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Campaign</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Template</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Period</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Progress</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(recentCampaigns || []).map((campaign) => (
                <tr key={campaign.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                  <td className="py-3 px-4">
                    <p className="text-white font-medium">{campaign.name}</p>
                    <p className="text-slate-400 text-sm">{campaign.assigned_units} units assigned</p>
                  </td>
                  <td className="py-3 px-4 text-slate-300">{campaign.template_name}</td>
                  <td className="py-3 px-4 text-slate-300">{campaign.period}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[campaign.status]?.bg} ${STATUS_COLORS[campaign.status]?.text}`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary-500 rounded-full"
                          style={{ width: `${campaign.progress}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-400">{campaign.progress}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <Link 
                      href={`/risks/rcsa/campaigns/${campaign.id}`}
                      className="text-primary-400 hover:text-primary-300 text-sm"
                    >
                      View Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link href="/risks/rcsa/campaigns?action=new" className="card p-6 hover:border-primary-500/50 transition-all cursor-pointer group">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/20">
              <Plus className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="text-white font-medium group-hover:text-primary-400 transition-colors">New Campaign</p>
              <p className="text-sm text-slate-400">Start a new RCSA campaign</p>
            </div>
          </div>
        </Link>
        <Link href="/risks/rcsa/templates?action=new" className="card p-6 hover:border-primary-500/50 transition-all cursor-pointer group">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
              <FileText className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-white font-medium group-hover:text-primary-400 transition-colors">New Template</p>
              <p className="text-sm text-slate-400">Create custom RCSA template</p>
            </div>
          </div>
        </Link>
        <Link href="/risks/rcsa/campaigns" className="card p-6 hover:border-primary-500/50 transition-all cursor-pointer group">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
              <Eye className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-white font-medium group-hover:text-primary-400 transition-colors">View Findings</p>
              <p className="text-sm text-slate-400">Review all RCSA findings</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
