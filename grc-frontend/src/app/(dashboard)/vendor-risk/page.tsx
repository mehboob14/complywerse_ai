'use client';


import { PageLoader } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { vendorRiskApi } from '@/lib/api';
import {
  Building2,
  AlertTriangle,
  Clock,
  FileCheck,
  Loader2,
  AlertCircle,
  Shield,
  TrendingUp,
  Users,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';

interface VendorDashboard {
  total_vendors: number;
  by_tier: Record<string, number>;
  by_status: Record<string, number>;
  expiring_contracts: Array<{
    id: number;
    name: string;
    tier: string;
    contract_end_date: string | null;
  }>;
  avg_inherent_risk_score: number | null;
  avg_residual_risk_score: number | null;
  recent_assessments: Array<{
    id: number;
    vendor_id: number;
    vendor_name: string | null;
    assessment_type: string;
    status: string;
    risk_rating: string | null;
    created_at: string | null;
  }>;
  open_incidents: number;
}

const TIER_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6b7280'];

// Softer tone-based badges, consistent with the rest of the platform
// (compliance / risks / certifications). Heavy solid-tone pills were
// visually loud against the data-dense rows on this page.
const getTierBadge = (tier: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return styles[tier?.toLowerCase()] || 'bg-gray-100 text-gray-600 border-gray-200';
};

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600 border-gray-200',
    in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    reviewed: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    submitted: 'bg-amber-50 text-amber-700 border-amber-200',
    overdue: 'bg-red-50 text-red-700 border-red-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-100 text-gray-600 border-gray-200';
};

const getRatingBadge = (rating: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return styles[rating?.toLowerCase()] || 'bg-gray-100 text-gray-600 border-gray-200';
};

function DistributionRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500"><span className="font-semibold text-slate-900">{value}</span> • {percent}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function VendorRiskDashboardPage() {
  const { data: dashboard, isLoading, error } = useQuery({
    queryKey: ['vendor-dashboard'],
    queryFn: async () => {
      const res = await vendorRiskApi.getDashboard();
      return res.data as VendorDashboard;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <PageLoader size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p>Failed to load vendor risk dashboard</p>
      </div>
    );
  }

  // Transform by_tier dict to array for charts
  const tierDistribution = Object.entries(dashboard?.by_tier ?? {}).map(([tier, count]) => ({
    tier: tier.charAt(0).toUpperCase() + tier.slice(1),
    tierKey: tier,
    count,
  }));

  // Transform by_status dict to array for display
  const statusDistribution = Object.entries(dashboard?.by_status ?? {}).map(([status, count]) => ({
    status: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    statusKey: status,
    count,
  }));

  // Compute high/critical count from by_tier
  const highCriticalCount = (dashboard?.by_tier?.critical ?? 0) + (dashboard?.by_tier?.high ?? 0);

  const totalTierCount = tierDistribution.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const totalStatusCount = statusDistribution.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const leadTier = [...tierDistribution].sort((a, b) => Number(b.count) - Number(a.count))[0];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Vendor Risk Management</h1>
          <p className="text-sm text-gray-500 mt-1">Third-party risk oversight and assessment tracking</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Link
            href="/vendor-risk/vendors"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Building2 className="h-4 w-4" />
            All Vendors
          </Link>
          <Link
            href="/vendor-risk/assessments"
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium"
          >
            <FileCheck className="h-4 w-4" />
            Assessments
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white">
              <Building2 className="h-5 w-5 text-blue-700" />
            </div>
            <div>
              <p className="text-sm text-blue-700">Total Vendors</p>
              <p className="text-2xl font-semibold text-slate-900">{dashboard?.total_vendors ?? 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white">
              <AlertTriangle className="h-5 w-5 text-red-700" />
            </div>
            <div>
              <p className="text-sm text-red-700">High/Critical Tier</p>
              <p className="text-2xl font-semibold text-slate-900">{highCriticalCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white">
              <AlertTriangle className="h-5 w-5 text-yellow-700" />
            </div>
            <div>
              <p className="text-sm text-yellow-700">Open Incidents</p>
              <p className="text-2xl font-semibold text-slate-900">{dashboard?.open_incidents ?? 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white">
              <Calendar className="h-5 w-5 text-orange-700" />
            </div>
            <div>
              <p className="text-sm text-orange-700">Expiring Contracts (30d)</p>
              <p className="text-2xl font-semibold text-slate-900">{dashboard?.expiring_contracts?.length ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Score Cards */}
      {(dashboard?.avg_inherent_risk_score != null || dashboard?.avg_residual_risk_score != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white">
                <Shield className="h-5 w-5 text-purple-700" />
              </div>
              <div>
                <p className="text-sm text-purple-700">Avg Inherent Risk Score</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {dashboard?.avg_inherent_risk_score?.toFixed(1) ?? '-'}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white">
                <TrendingUp className="h-5 w-5 text-indigo-700" />
              </div>
              <div>
                <p className="text-sm text-indigo-700">Avg Residual Risk Score</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {dashboard?.avg_residual_risk_score?.toFixed(1) ?? '-'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Tier Exposure Ladder</h3>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600">
              {leadTier ? `${leadTier.tier} leads` : 'No data'}
            </span>
          </div>
          {tierDistribution.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">No vendor data</div>
          ) : (
            <div className="space-y-3">
              {tierDistribution.map((item) => (
                <DistributionRow
                  key={item.tier}
                  label={item.tier}
                  value={Number(item.count || 0)}
                  total={totalTierCount}
                  color={TIER_COLORS[item.tierKey?.toLowerCase()] || '#64748b'}
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Status Pipeline</h3>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600">
              {totalStatusCount} vendors
            </span>
          </div>
          {statusDistribution.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">No vendor data</div>
          ) : (
            <div className="space-y-3">
              {statusDistribution.map((item, idx) => (
                <DistributionRow
                  key={item.status}
                  label={item.status}
                  value={Number(item.count || 0)}
                  total={totalStatusCount}
                  color={PIE_COLORS[idx % PIE_COLORS.length]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expiring Contracts */}
      {(dashboard?.expiring_contracts?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-3 sm:px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-slate-900">Expiring Contracts (Next 30 Days)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expiry Date</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(dashboard?.expiring_contracts ?? []).map((v) => (
                  <tr key={v.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/vendor-risk/vendors/${v.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                        {v.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getTierBadge(v.tier)}`}>
                        {v.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {v.contract_end_date ? new Date(v.contract_end_date).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Assessments */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Recent Assessments</h3>
          <Link href="/vendor-risk/assessments" className="text-xs text-blue-600 hover:text-blue-800">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Rating</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(dashboard?.recent_assessments ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                    No recent assessments
                  </td>
                </tr>
              ) : (
                (dashboard?.recent_assessments ?? []).map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{a.vendor_name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{a.assessment_type?.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getStatusBadge(a.status)}`}>
                        {a.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {a.risk_rating ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getRatingBadge(a.risk_rating)}`}>
                          {a.risk_rating}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {a.created_at ? new Date(a.created_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
