'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorRiskApi, tenantApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Building2,
  Loader2,
  AlertCircle,
  Search,
  Plus,
  X,
  Eye,
  Shield,
  Filter,
  Calendar,
  User,
  Database,
} from 'lucide-react';
import Link from 'next/link';

interface Vendor {
  id: number;
  name: string;
  tier: string;
  status: string;
  inherent_risk_score: number | null;
  residual_risk_score: number | null;
  risk_rating: string | null;
  data_access_level: string;
  contract_end_date: string | null;
  owner: { id: number; full_name: string; email: string } | null;
  owner_id: number | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  description: string | null;
  services_provided: string[] | null;
  created_at: string;
}

interface UserOption {
  id: number;
  username: string;
  display_name: string | null;
  email: string;
}

const TIER_OPTIONS = ['critical', 'high', 'medium', 'low'];
const STATUS_OPTIONS = ['active', 'under_review', 'onboarding', 'offboarded', 'suspended'];
const DATA_ACCESS_OPTIONS = ['confidential', 'restricted', 'internal', 'public', 'none'];

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
    active: 'bg-green-100 text-green-700',
    under_review: 'bg-blue-100 text-blue-700',
    onboarding: 'bg-purple-100 text-purple-700',
    offboarded: 'bg-gray-100 text-gray-600',
    suspended: 'bg-red-100 text-red-700',
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

export default function VendorListPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:vendors:create');
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    tier: 'medium',
    status: 'active',
    data_access_level: 'internal',
    primary_contact_email: '',
    primary_contact_name: '',
    primary_contact_phone: '',
    contract_start_date: '',
    contract_end_date: '',
    owner_id: '',
    services_provided: '',
    vendor_type: '',
    industry: '',
    website: '',
  });

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendors();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as Vendor[];
    },
  });

  const { data: users } = useQuery({
    queryKey: ['tenant-users'],
    queryFn: async () => {
      const res = await tenantApi.getTenantUsers();
      return (res.data ?? []) as UserOption[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.createVendor(data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendors-select'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-dashboard'] });
      setShowModal(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setFormData({
      name: '', description: '', tier: 'medium', status: 'active',
      data_access_level: 'internal', primary_contact_email: '', primary_contact_name: '',
      primary_contact_phone: '', contract_start_date: '', contract_end_date: '',
      owner_id: '', services_provided: '', vendor_type: '', industry: '', website: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: formData.name,
      tier: formData.tier,
      status: formData.status,
      data_access_level: formData.data_access_level,
      services_provided: formData.services_provided ? formData.services_provided.split(',').map((s) => s.trim()) : [],
    };
    if (formData.description) payload.description = formData.description;
    if (formData.primary_contact_name) payload.primary_contact_name = formData.primary_contact_name;
    if (formData.primary_contact_email) payload.primary_contact_email = formData.primary_contact_email;
    if (formData.primary_contact_phone) payload.primary_contact_phone = formData.primary_contact_phone;
    if (formData.vendor_type) payload.vendor_type = formData.vendor_type;
    if (formData.industry) payload.industry = formData.industry;
    if (formData.website) payload.website = formData.website;
    if (formData.contract_start_date) payload.contract_start_date = formData.contract_start_date;
    if (formData.contract_end_date) payload.contract_end_date = formData.contract_end_date;
    if (formData.owner_id) payload.owner_id = Number(formData.owner_id);

    createMutation.mutate(payload);
  };

  const filtered = useMemo(() => {
    if (!vendors) return [];
    return vendors.filter((v) => {
      const matchSearch = !searchTerm || v.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchTier = tierFilter === 'all' || v.tier?.toLowerCase() === tierFilter;
      const matchStatus = statusFilter === 'all' || v.status?.toLowerCase() === statusFilter;
      return matchSearch && matchTier && matchStatus;
    });
  }, [vendors, searchTerm, tierFilter, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your third-party vendor inventory</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Vendor
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search vendors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Tiers</option>
          {TIER_OPTIONS.map((t) => (
            <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Rating</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data Access</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contract End</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    No vendors found
                  </td>
                </tr>
              ) : (
                filtered.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/vendor-risk/vendors/${vendor.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                        {vendor.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getTierBadge(vendor.tier)}`}>
                        {vendor.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(vendor.status)}`}>
                        {vendor.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {vendor.risk_rating ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getRatingBadge(vendor.risk_rating)}`}>
                          {vendor.risk_rating}
                        </span>
                      ) : vendor.inherent_risk_score != null ? (
                        <span className="text-sm font-medium text-gray-900">{vendor.inherent_risk_score.toFixed(1)}</span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{vendor.data_access_level?.replace(/_/g, ' ') ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {vendor.contract_end_date ? new Date(vendor.contract_end_date).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {vendor.owner ? (typeof vendor.owner === 'object' ? vendor.owner.full_name : String(vendor.owner)) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/vendor-risk/vendors/${vendor.id}`} className="text-blue-600 hover:text-blue-800">
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="flex h-[70vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Add Vendor</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
              <div className="grid flex-1 gap-4 overflow-y-auto p-6 md:grid-cols-2">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tier</label>
                  <select
                    value={formData.tier}
                    onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TIER_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data Access Level</label>
                  <select
                    value={formData.data_access_level}
                    onChange={(e) => setFormData({ ...formData, data_access_level: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {DATA_ACCESS_OPTIONS.map((d) => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Type</label>
                  <input
                    type="text"
                    placeholder="e.g., SaaS, Cloud, Consulting"
                    value={formData.vendor_type}
                    onChange={(e) => setFormData({ ...formData, vendor_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                  <input
                    type="text"
                    placeholder="e.g., Technology, Healthcare"
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                  <input
                    type="text"
                    value={formData.primary_contact_name}
                    onChange={(e) => setFormData({ ...formData, primary_contact_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                  <input
                    type="email"
                    value={formData.primary_contact_email}
                    onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    value={formData.primary_contact_phone}
                    onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract Start</label>
                  <input
                    type="date"
                    value={formData.contract_start_date}
                    onChange={(e) => setFormData({ ...formData, contract_start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contract End</label>
                  <input
                    type="date"
                    value={formData.contract_end_date}
                    onChange={(e) => setFormData({ ...formData, contract_end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
                  <select
                    value={formData.owner_id}
                    onChange={(e) => setFormData({ ...formData, owner_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select owner...</option>
                    {(users ?? []).map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Services Provided</label>
                  <input
                    type="text"
                    placeholder="Comma-separated, e.g., Cloud Hosting, Security"
                    value={formData.services_provided}
                    onChange={(e) => setFormData({ ...formData, services_provided: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              {createMutation.isError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg md:col-span-2">
                  Failed to create vendor. Please check the form and try again.
                </div>
              )}
              <div className="flex justify-end gap-3 border-t border-gray-200 p-6 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Add Vendor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
