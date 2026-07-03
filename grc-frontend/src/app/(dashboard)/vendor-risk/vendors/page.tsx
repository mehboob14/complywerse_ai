'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { vendorRiskApi, tenantApi, tpraApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Loader2,
  AlertCircle,
  Plus,
  Eye,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { SearchInput, MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import { StageProgress, stageNumberLabel } from '../_lib/lifecycleShared';

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
  lifecycle_stage?: string | null;
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

const titleCase = (s: string) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const getTierBadge = (tier: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border border-red-200',
    high: 'bg-orange-50 text-orange-700 border border-orange-200',
    medium: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
    low: 'bg-green-50 text-green-700 border border-green-200',
  };
  return styles[tier?.toLowerCase()] || 'bg-gray-50 text-gray-700 border border-gray-200';
};

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    active: 'bg-green-50 text-green-700 border border-green-200',
    under_review: 'bg-blue-50 text-blue-700 border border-blue-200',
    onboarding: 'bg-purple-50 text-purple-700 border border-purple-200',
    offboarded: 'bg-gray-50 text-gray-700 border border-gray-200',
    suspended: 'bg-red-50 text-red-700 border border-red-200',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-50 text-gray-700 border border-gray-200';
};

const getRatingBadge = (rating: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border border-red-200',
    high: 'bg-orange-50 text-orange-700 border border-orange-200',
    medium: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
    low: 'bg-green-50 text-green-700 border border-green-200',
  };
  return styles[rating?.toLowerCase()] || 'bg-gray-50 text-gray-700 border border-gray-200';
};

export default function VendorListPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:vendors:create');
  const canDelete =
    hasPermission('vendor_risk:vendors:delete') ||
    hasPermission('vendor_risk:vendors:edit');
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deletingVendorId, setDeletingVendorId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    tier: 'medium',
    status: 'active',
    data_access_level: 'internal',
    data_types_accessed: '',
    contract_value: '',
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
  // Intake (Stage 01) — start the TPRA lifecycle as soon as the vendor record exists.
  const [startLifecycle, setStartLifecycle] = useState(true);

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendors();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as Vendor[];
    },
    placeholderData: keepPreviousData,
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
      return res.data as { id: number; name: string };
    },
    onSuccess: async (created) => {
      // Stage 01 intake complete → optionally start the lifecycle so the vendor
      // enters the 11-stage TPRA flow immediately. Best-effort; never blocks create.
      if (startLifecycle && created?.id) {
        try { await tpraApi.initLifecycle(created.id); } catch { /* lifecycle can be started later from the vendor page */ }
      }
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendors-select'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-assessments-all'] });
      setShowModal(false);
      resetForm();
    },
    onError: (error: unknown, variables) => {
      // 409 = a possible duplicate relationship. Confirm and re-submit with override.
      const resp = (error as { response?: { status?: number; data?: { detail?: string } } })?.response;
      if (resp?.status === 409 && !(variables as { allow_duplicate?: boolean })?.allow_duplicate) {
        const detail = resp.data?.detail || 'A similar vendor may already exist.';
        if (window.confirm(`${detail}\n\nCreate this vendor anyway?`)) {
          createMutation.mutate({ ...(variables as Record<string, unknown>), allow_duplicate: true });
        }
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (vendorId: number) => {
      await vendorRiskApi.deleteVendor(vendorId);
    },
    onMutate: (vendorId) => {
      setDeletingVendorId(vendorId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendors-select'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-assessments-all'] });
    },
    onSettled: () => {
      setDeletingVendorId(null);
    },
  });

  const resetForm = () => {
    setFormData({
      name: '', description: '', tier: 'medium', status: 'active',
      data_access_level: 'internal', data_types_accessed: '', contract_value: '',
      primary_contact_email: '', primary_contact_name: '',
      primary_contact_phone: '', contract_start_date: '', contract_end_date: '',
      owner_id: '', services_provided: '', vendor_type: '', industry: '', website: '',
    });
    setStartLifecycle(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: formData.name,
      tier: formData.tier,
      status: formData.status,
      data_access_level: formData.data_access_level,
      services_provided: formData.services_provided ? formData.services_provided.split(',').map((s) => s.trim()).filter(Boolean) : [],
      data_types_accessed: formData.data_types_accessed ? formData.data_types_accessed.split(',').map((s) => s.trim()).filter(Boolean) : [],
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
    if (formData.contract_value !== '' && !Number.isNaN(Number(formData.contract_value))) payload.contract_value = Number(formData.contract_value);
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

  const handleDeleteVendor = (vendor: Vendor) => {
    const confirmed = window.confirm(
      `Delete vendor "${vendor.name}"? This removes related assessments, questionnaire responses, SLA records, and incidents.`
    );
    if (!confirmed) return;
    deleteMutation.mutate(vendor.id);
  };

  const tierItems = TIER_OPTIONS.map((t) => ({ value: t, label: titleCase(t) }));
  const statusItems = STATUS_OPTIONS.map((s) => ({ value: s, label: titleCase(s) }));
  const dataAccessItems = DATA_ACCESS_OPTIONS.map((d) => ({ value: d, label: titleCase(d) }));
  const userItems = (users ?? []).map((u) => ({
    value: String(u.id),
    label: u.display_name || u.username,
    subLabel: u.email,
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <PageLoader size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your third-party vendor inventory</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/vendor-risk/assessments"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Assessments
          </Link>
          <Link
            href="/vendor-risk/questionnaires"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Questionnaires
          </Link>
        </div>
      </div>

      {/* Filters / Search row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search vendors..."
            />
          </div>
          <MultiSelectDropdown
            title="Tier"
            items={tierItems}
            selectedValues={tierFilter !== 'all' ? [tierFilter] : []}
            onApply={(v) => setTierFilter(v[0] || 'all')}
            multiSelect={false}
          />
          <MultiSelectDropdown
            title="Status"
            items={statusItems}
            selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
            onApply={(v) => setStatusFilter(v[0] || 'all')}
            multiSelect={false}
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {canCreate && (
            <button
              onClick={() => setShowModal(true)}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Vendor
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden p-3 sm:p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Rating</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lifecycle</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data Access</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contract End</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
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
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StageProgress currentKey={vendor.lifecycle_stage} size="sm" />
                        <span className="text-[11px] text-gray-500">{stageNumberLabel(vendor.lifecycle_stage)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{vendor.data_access_level?.replace(/_/g, ' ') ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {vendor.contract_end_date ? new Date(vendor.contract_end_date).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {vendor.owner ? (typeof vendor.owner === 'object' ? vendor.owner.full_name : String(vendor.owner)) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/vendor-risk/vendors/${vendor.id}`} className="text-blue-600 hover:text-blue-800" title="View vendor">
                          <Eye className="h-4 w-4" />
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteVendor(vendor)}
                            disabled={deleteMutation.isPending && deletingVendorId === vendor.id}
                            className="text-red-500 hover:text-red-700 disabled:opacity-50"
                            title="Delete vendor"
                          >
                            {deleteMutation.isPending && deletingVendorId === vendor.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal (RightSlidePanel) */}
      <RightSlidePanel
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Add Vendor · Intake & Scoping"
        width="w-full max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="vendor-form"
              disabled={createMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Add Vendor'
              )}
            </button>
          </div>
        }
      >
        <form id="vendor-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-primary-100 bg-primary-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">Stage 01 · Intake &amp; Scoping</p>
            <p className="mt-1 text-xs text-gray-600">
              Capture the business need and the basic facts about the third party and the service before any work is committed.
              Exit criteria: a vendor record with a named owner, a defined service &amp; data scope, and a draft data classification.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-800 mb-1">Vendor Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Tier</label>
              <MultiSelectDropdown
                title="Tier"
                items={tierItems}
                selectedValues={formData.tier ? [formData.tier] : []}
                onApply={(v) => setFormData({ ...formData, tier: v[0] || 'medium' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select tier"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Draft data classification</label>
              <MultiSelectDropdown
                title="Draft data classification"
                items={dataAccessItems}
                selectedValues={formData.data_access_level ? [formData.data_access_level] : []}
                onApply={(v) => setFormData({ ...formData, data_access_level: v[0] || 'internal' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select classification"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Data types in scope</label>
              <input
                type="text"
                placeholder="Comma-separated, e.g., PII, PHI, Financial"
                value={formData.data_types_accessed}
                onChange={(e) => setFormData({ ...formData, data_types_accessed: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Vendor Type</label>
              <input
                type="text"
                placeholder="e.g., SaaS, Cloud, Consulting"
                value={formData.vendor_type}
                onChange={(e) => setFormData({ ...formData, vendor_type: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Industry</label>
              <input
                type="text"
                placeholder="e.g., Technology, Healthcare"
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Contact Name</label>
              <input
                type="text"
                value={formData.primary_contact_name}
                onChange={(e) => setFormData({ ...formData, primary_contact_name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Contact Email</label>
              <input
                type="email"
                value={formData.primary_contact_email}
                onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Contact Phone</label>
              <input
                type="text"
                value={formData.primary_contact_phone}
                onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Website</label>
              <input
                type="text"
                placeholder="https://..."
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Contract Start</label>
              <input
                type="date"
                value={formData.contract_start_date}
                onChange={(e) => setFormData({ ...formData, contract_start_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Contract End</label>
              <input
                type="date"
                value={formData.contract_end_date}
                onChange={(e) => setFormData({ ...formData, contract_end_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Annual spend / contract value</label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Estimated annual spend"
                value={formData.contract_value}
                onChange={(e) => setFormData({ ...formData, contract_value: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Owner</label>
              <MultiSelectDropdown
                title="Owner"
                items={userItems}
                selectedValues={formData.owner_id ? [String(formData.owner_id)] : []}
                onApply={(v) => setFormData({ ...formData, owner_id: v[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select owner"
                size="md"
                forceSearch
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-800 mb-1">Systems &amp; services in scope</label>
              <input
                type="text"
                placeholder="Comma-separated, e.g., Cloud Hosting, CRM, Payment Gateway"
                value={formData.services_provided}
                onChange={(e) => setFormData({ ...formData, services_provided: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={startLifecycle}
              onChange={(e) => setStartLifecycle(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-xs text-gray-600">
              <span className="font-medium text-gray-800">Start the TPRA lifecycle now</span> — opens a versioned assessment at
              Stage 01 so the vendor enters the 11-stage flow immediately. You can also start it later from the vendor page.
            </span>
          </label>
          {createMutation.isError && !((createMutation.error as { response?: { status?: number } })?.response?.status === 409) && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              Failed to create vendor. Please check the form and try again.
            </div>
          )}
        </form>
      </RightSlidePanel>
    </div>
  );
}
