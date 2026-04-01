'use client';

import { useState } from 'react';
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
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

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

const getTierBadge = (tier: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  };
  return styles[tier?.toLowerCase()] || 'bg-gray-100 text-gray-700';
};

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    approved: 'bg-green-100 text-green-700',
    reviewed: 'bg-indigo-100 text-indigo-700',
    submitted: 'bg-yellow-100 text-yellow-700',
    overdue: 'bg-red-100 text-red-700',
    pending: 'bg-yellow-100 text-yellow-700',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-100 text-gray-700';
};

const getRatingBadge = (rating: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  };
  return styles[rating?.toLowerCase()] || 'bg-gray-100 text-gray-700';
};

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
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Vendor Risk Management</h1>
          <p className="text-sm text-gray-500 mt-1">Third-party risk oversight and assessment tracking</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/vendor-risk/vendors"
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Building2 className="h-4 w-4" />
            All Vendors
          </Link>
          <Link
            href="/vendor-risk/assessments"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <FileCheck className="h-4 w-4" />
            Assessments
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Vendors</p>
              <p className="text-2xl font-semibold text-gray-900">{dashboard?.total_vendors ?? 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">High/Critical Tier</p>
              <p className="text-2xl font-semibold text-gray-900">{highCriticalCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-50">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Open Incidents</p>
              <p className="text-2xl font-semibold text-gray-900">{dashboard?.open_incidents ?? 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-50">
              <Calendar className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Expiring Contracts (30d)</p>
              <p className="text-2xl font-semibold text-gray-900">{dashboard?.expiring_contracts?.length ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Risk Score Cards */}
      {(dashboard?.avg_inherent_risk_score != null || dashboard?.avg_residual_risk_score != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-50">
                <Shield className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg Inherent Risk Score</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {dashboard?.avg_inherent_risk_score?.toFixed(1) ?? '-'}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-50">
                <TrendingUp className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg Residual Risk Score</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {dashboard?.avg_residual_risk_score?.toFixed(1) ?? '-'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tier Distribution Pie */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Vendor Tier Distribution</h3>
          {tierDistribution.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-gray-400">No vendor data</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={tierDistribution}
                    dataKey="count"
                    nameKey="tier"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, value }: any) => `${name}: ${value}`}
                  >
                    {tierDistribution.map((entry, idx) => (
                      <Cell key={idx} fill={TIER_COLORS[entry.tierKey?.toLowerCase()] || PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Status Distribution Bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Vendor Status Distribution</h3>
          {statusDistribution.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-gray-400">No vendor data</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Vendors" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Expiring Contracts */}
      {(dashboard?.expiring_contracts?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Expiring Contracts (Next 30 Days)</h3>
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
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getTierBadge(v.tier)}`}>
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
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Recent Assessments</h3>
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
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.vendor_name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{a.assessment_type?.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(a.status)}`}>
                        {a.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {a.risk_rating ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getRatingBadge(a.risk_rating)}`}>
                          {a.risk_rating}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
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
