'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  Shield,
  Loader2,
  Search,
  Plus,
  X,
  Edit2,
  Trash2,
  Key,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

interface InternalControl {
  id: number;
  control_id: string;
  name: string;
  description?: string;
  category?: string;
  sub_category?: string;
  control_type?: string;
  control_nature?: string;
  department_id?: number;
  owner_id?: number;
  frequency?: string;
  regulatory_source?: string;
  effective_date?: string;
  review_date?: string;
  status: string;
  workflow_status?: string;
  design_effectiveness?: string;
  operating_effectiveness?: string;
  priority?: string;
  is_key_control: boolean;
  created_at: string;
  department?: { id: number; name: string };
  owner?: { id: number; email: string; display_name?: string };
}

const CONTROL_CATEGORIES = [
  'Operations',
  'Financial',
  'IT Security',
  'AML/CFT',
  'Credit Risk',
  'Customer Service',
];

const CONTROL_TYPES = [
  { value: 'preventive', label: 'Preventive' },
  { value: 'detective', label: 'Detective' },
  { value: 'corrective', label: 'Corrective' },
];

const CONTROL_NATURES = [
  { value: 'manual', label: 'Manual' },
  { value: 'automated', label: 'Automated' },
  { value: 'it_dependent_manual', label: 'IT-Dependent Manual' },
];

const FREQUENCIES = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'ad_hoc', label: 'Ad Hoc' },
];

const PRIORITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Draft' },
  pending_approval: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'Pending Approval' },
  active: { bg: 'bg-green-50', text: 'text-green-600', label: 'Active' },
  inactive: { bg: 'bg-red-50', text: 'text-red-600', label: 'Inactive' },
  rejected: { bg: 'bg-red-50', text: 'text-red-600', label: 'Rejected' },
};

const EFFECTIVENESS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  effective: { bg: 'bg-green-50', text: 'text-green-600', label: 'Effective' },
  partially_effective: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'Partially Effective' },
  ineffective: { bg: 'bg-red-50', text: 'text-red-600', label: 'Ineffective' },
  not_tested: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Not Tested' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.draft;
}

function getEffectivenessStyle(effectiveness?: string) {
  if (!effectiveness) return EFFECTIVENESS_STYLES.not_tested;
  return EFFECTIVENESS_STYLES[effectiveness] || EFFECTIVENESS_STYLES.not_tested;
}

function getOverallEffectiveness(design?: string, operating?: string): string {
  if (!design && !operating) return 'not_tested';
  if (design === 'ineffective' || operating === 'ineffective') return 'ineffective';
  if (design === 'partially_effective' || operating === 'partially_effective') return 'partially_effective';
  if (design === 'effective' && operating === 'effective') return 'effective';
  return 'not_tested';
}

export default function InternalControlsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [keyControlFilter, setKeyControlFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingControl, setEditingControl] = useState<InternalControl | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: controls, isLoading, error } = useQuery({
    queryKey: ['internal-controls'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      return response.data as InternalControl[];
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['internal-controls-dashboard'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getDashboard();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => ermApi.internalControls.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-controls'] });
      queryClient.invalidateQueries({ queryKey: ['internal-controls-dashboard'] });
      setIsModalOpen(false);
      setEditingControl(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      ermApi.internalControls.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-controls'] });
      queryClient.invalidateQueries({ queryKey: ['internal-controls-dashboard'] });
      setIsModalOpen(false);
      setEditingControl(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.internalControls.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-controls'] });
      queryClient.invalidateQueries({ queryKey: ['internal-controls-dashboard'] });
      setDeleteConfirm(null);
    },
  });

  const filteredControls = useMemo(() => {
    if (!controls) return [];
    return controls.filter((control) => {
      const matchesSearch =
        !searchTerm ||
        control.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        control.control_id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || control.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || control.category === categoryFilter;
      const matchesKeyControl =
        keyControlFilter === 'all' ||
        (keyControlFilter === 'yes' && control.is_key_control) ||
        (keyControlFilter === 'no' && !control.is_key_control);
      return matchesSearch && matchesStatus && matchesCategory && matchesKeyControl;
    });
  }, [controls, searchTerm, statusFilter, categoryFilter, keyControlFilter]);

  const handleSubmit = (formData: FormData) => {
    const data: Record<string, unknown> = {
      control_id: formData.get('control_id'),
      name: formData.get('name'),
      description: formData.get('description') || undefined,
      category: formData.get('category') || undefined,
      sub_category: formData.get('sub_category') || undefined,
      control_type: formData.get('control_type') || undefined,
      control_nature: formData.get('control_nature') || undefined,
      frequency: formData.get('frequency') || undefined,
      regulatory_source: formData.get('regulatory_source') || undefined,
      priority: formData.get('priority') || undefined,
      is_key_control: formData.get('is_key_control') === 'true',
      effective_date: formData.get('effective_date') || undefined,
      review_date: formData.get('review_date') || undefined,
    };

    if (editingControl) {
      updateMutation.mutate({ id: editingControl.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Failed to load internal controls</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Shield className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.total_controls || 0}</p>
              <p className="text-sm text-slate-600">Total Controls</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Key className="h-5 w-5 text-primary-600" />
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.key_controls || 0}</p>
              <p className="text-sm text-slate-600">Key Controls</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-2xl font-bold text-black">{dashboard?.effective_controls || 0}</p>
              <p className="text-sm text-slate-600">Effective</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-yellow-700/50 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Clock className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="text-2xl font-bold text-yellow-600">{dashboard?.pending_approval || 0}</p>
              <p className="text-sm text-slate-600">Pending Approval</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search controls..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-200 py-2 pl-10 pr-4 text-sm text-black placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Categories</option>
            {CONTROL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <select
            value={keyControlFilter}
            onChange={(e) => setKeyControlFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Controls</option>
            <option value="yes">Key Controls Only</option>
            <option value="no">Non-Key Controls</option>
          </select>
        </div>
        <button
          onClick={() => {
            setEditingControl(null);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add New Control
        </button>
      </div>

      {filteredControls.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <Shield className="mx-auto h-12 w-12 text-slate-500" />
          <p className="mt-4 text-lg font-medium text-black">No controls found</p>
          <p className="mt-1 text-sm text-slate-600">
            {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create your first internal control to get started'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Control ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Category</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Department</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Effectiveness</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredControls.map((control) => {
                const statusStyle = getStatusStyle(control.status);
                const effectivenessStyle = getEffectivenessStyle(
                  getOverallEffectiveness(control.design_effectiveness, control.operating_effectiveness)
                );
                return (
                  <tr key={control.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/erm/internal-controls/${control.id}`}
                        className="font-mono text-sm text-primary-600 hover:text-primary-300"
                      >
                        {control.control_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/erm/internal-controls/${control.id}`}
                          className="text-sm font-medium text-black hover:text-primary-600"
                        >
                          {control.name}
                        </Link>
                        {control.is_key_control && (
                          <span className="flex items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-600">
                            <Key className="h-3 w-3" />
                            Key
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{control.category || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {control.department?.name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${effectivenessStyle.bg} ${effectivenessStyle.text}`}
                      >
                        {effectivenessStyle.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingControl(control);
                            setIsModalOpen(true);
                          }}
                          className="rounded p-1 text-slate-600 hover:bg-slate-600 hover:text-slate-900 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(control.id)}
                          className="rounded p-1 text-slate-600 hover:bg-red-600/20 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-black">
                {editingControl ? 'Edit Control' : 'Add New Control'}
              </h2>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingControl(null);
                }}
                className="rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(new FormData(e.currentTarget));
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    Control ID <span className="text-red-600">*</span>
                  </label>
                  <input
                    name="control_id"
                    type="text"
                    required
                    defaultValue={editingControl?.control_id || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
                    placeholder="e.g., CTL-001"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">
                    Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    name="name"
                    type="text"
                    required
                    defaultValue={editingControl?.name || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
                    placeholder="Control name"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={editingControl?.description || ''}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
                  placeholder="Describe the control..."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Category</label>
                  <select
                    name="category"
                    defaultValue={editingControl?.category || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">Select category</option>
                    {CONTROL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Sub-Category</label>
                  <input
                    name="sub_category"
                    type="text"
                    defaultValue={editingControl?.sub_category || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
                    placeholder="Sub-category"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Control Type</label>
                  <select
                    name="control_type"
                    defaultValue={editingControl?.control_type || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">Select type</option>
                    {CONTROL_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Control Nature</label>
                  <select
                    name="control_nature"
                    defaultValue={editingControl?.control_nature || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">Select nature</option>
                    {CONTROL_NATURES.map((n) => (
                      <option key={n.value} value={n.value}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Frequency</label>
                  <select
                    name="frequency"
                    defaultValue={editingControl?.frequency || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">Select frequency</option>
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Priority</label>
                  <select
                    name="priority"
                    defaultValue={editingControl?.priority || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="">Select priority</option>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">
                  Regulatory Source
                </label>
                <input
                  name="regulatory_source"
                  type="text"
                  defaultValue={editingControl?.regulatory_source || ''}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
                  placeholder="e.g., SOX, PCI-DSS, ISO 27001"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Effective Date</label>
                  <input
                    name="effective_date"
                    type="date"
                    defaultValue={editingControl?.effective_date?.split('T')[0] || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Review Date</label>
                  <input
                    name="review_date"
                    type="date"
                    defaultValue={editingControl?.review_date?.split('T')[0] || ''}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  name="is_key_control"
                  type="checkbox"
                  value="true"
                  defaultChecked={editingControl?.is_key_control || false}
                  className="h-4 w-4 rounded border-slate-300 bg-slate-200 text-primary-600 focus:ring-primary-500"
                />
                <label className="text-sm font-medium text-slate-600">Key Control</label>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingControl(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {editingControl ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-50 p-2">
                <XCircle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-black">Delete Control</h3>
            </div>
            <p className="mb-6 text-slate-600">
              Are you sure you want to delete this control? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
