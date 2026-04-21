'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Shield,
  Loader2,
  Search,
  Plus,
  Upload,
  X,
  Edit2,
  Trash2,
  Key,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Sparkles,
  Link2,
  Link2Off,
  FileText,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { evidenceApi } from '@/lib/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

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

const CONTROL_SUBCATEGORIES: Record<string, string[]> = {
  Operations: ['Process Management', 'Change Management', 'Business Continuity', 'Quality Assurance'],
  Financial: ['General Ledger', 'Reconciliations', 'Accounts Payable', 'Accounts Receivable', 'Treasury'],
  'IT Security': ['Access Management', 'Network Security', 'Endpoint Security', 'Vulnerability Management', 'Data Protection'],
  'AML/CFT': ['KYC', 'Transaction Monitoring', 'Sanctions Screening', 'Suspicious Activity Reporting'],
  'Credit Risk': ['Underwriting', 'Credit Review', 'Collateral Management', 'Provisioning'],
  'Customer Service': ['Complaint Handling', 'Service Delivery', 'Customer Onboarding', 'Escalation Management'],
};

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
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Draft' },
  pending_approval: { bg: 'bg-yellow-100', text: 'text-slate-800', label: 'Pending Approval' },
  active: { bg: 'bg-green-100', text: 'text-slate-800', label: 'Active' },
  inactive: { bg: 'bg-red-100', text: 'text-slate-800', label: 'Inactive' },
  rejected: { bg: 'bg-red-100', text: 'text-slate-800', label: 'Rejected' },
};

const EFFECTIVENESS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  effective: { bg: 'bg-green-100', text: 'text-slate-800', label: 'Effective' },
  partially_effective: { bg: 'bg-yellow-100', text: 'text-slate-800', label: 'Partially Effective' },
  ineffective: { bg: 'bg-red-100', text: 'text-slate-800', label: 'Ineffective' },
  not_tested: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Not Tested' },
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

function EvidenceLinkSection({ controlId }: { controlId: number }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [searchEv, setSearchEv] = useState('');

  const { data: linkedEvidence, isLoading: loadingLinked } = useQuery({
    queryKey: ['ic-evidence', controlId],
    queryFn: async () => {
      const res = await ermApi.internalControls.getEvidence(controlId);
      return res.data as Array<{
        id: number;
        evidence_id: number;
        title: string;
        description?: string;
        evidence_type?: string;
        status?: string;
        file_name?: string;
        file_url?: string;
        notes?: string;
        linked_at?: string;
      }>;
    },
  });

  const { data: allEvidence } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => {
      const res = await evidenceApi.getAll();
      return res.data as Array<{ id: number; title?: string; file_name?: string; evidence_type?: string; status?: string }>;
    },
    enabled: showPicker,
  });

  const linkMutation = useMutation({
    mutationFn: (evidenceId: number) =>
      ermApi.internalControls.linkEvidence(controlId, { evidence_id: evidenceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ic-evidence', controlId] });
      setShowPicker(false);
      setSearchEv('');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: number) => ermApi.internalControls.unlinkEvidence(controlId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ic-evidence', controlId] }),
  });

  const linkedIds = new Set(linkedEvidence?.map((l) => l.evidence_id) ?? []);
  const filteredAll = (allEvidence ?? []).filter((ev) => {
    const name = ev.title || ev.file_name || '';
    return name.toLowerCase().includes(searchEv.toLowerCase());
  });

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Linked Evidence</h3>
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <Link2 className="h-3 w-3" />
          {showPicker ? 'Close' : 'Link Evidence'}
        </button>
      </div>

      {/* Evidence picker */}
      {showPicker && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            type="text"
            value={searchEv}
            onChange={(e) => setSearchEv(e.target.value)}
            placeholder="Search evidence..."
            className="mb-2 w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredAll.length === 0 && (
              <p className="py-2 text-center text-xs text-slate-500">No evidence found</p>
            )}
            {filteredAll.map((ev) => {
              const alreadyLinked = linkedIds.has(ev.id);
              const name = ev.title || ev.file_name || `Evidence #${ev.id}`;
              return (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded bg-white px-3 py-2 border border-slate-100"
                >
                  <div>
                    <p className="text-xs font-medium text-slate-800">{name}</p>
                    {ev.evidence_type && (
                      <p className="text-[11px] text-slate-500">{ev.evidence_type}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={alreadyLinked || linkMutation.isPending}
                    onClick={() => linkMutation.mutate(ev.id)}
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyLinked ? 'Linked' : 'Link'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Linked evidence list */}
      {loadingLinked ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        </div>
      ) : (linkedEvidence ?? []).length === 0 ? (
        <p className="text-xs text-slate-500">No evidence linked yet.</p>
      ) : (
        <div className="space-y-2">
          {(linkedEvidence ?? []).map((lnk) => (
            <div
              key={lnk.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <Link
                    href={`/evidence/${lnk.evidence_id}`}
                    className="block truncate text-xs font-medium text-blue-600 hover:underline"
                  >
                    {lnk.title || lnk.file_name || `Evidence #${lnk.evidence_id}`}
                  </Link>
                  {lnk.evidence_type && (
                    <span className="text-[11px] text-slate-500">{lnk.evidence_type}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                <Link
                  href={`/evidence/${lnk.evidence_id}`}
                  className="rounded p-1 text-slate-400 hover:text-blue-600"
                  title="View evidence"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => unlinkMutation.mutate(lnk.id)}
                  disabled={unlinkMutation.isPending}
                  className="rounded p-1 text-slate-400 hover:text-red-500"
                  title="Unlink"
                >
                  {unlinkMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2Off className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InternalControlsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:internal_controls:create');
  const canEdit = hasPermission('erm:internal_controls:edit');
  const canDelete = hasPermission('erm:internal_controls:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [keyControlFilter, setKeyControlFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingControl, setEditingControl] = useState<InternalControl | null>(null);
  const [selectedModalCategory, setSelectedModalCategory] = useState('');
  const [selectedModalSubCategory, setSelectedModalSubCategory] = useState('');
  const [modalName, setModalName] = useState('');
  const [modalDescription, setModalDescription] = useState('');
  const [modalControlType, setModalControlType] = useState('');
  const [modalControlNature, setModalControlNature] = useState('');
  const [modalFrequency, setModalFrequency] = useState('');
  const [modalPriority, setModalPriority] = useState('');
  const [modalStatus, setModalStatus] = useState('');
  const [modalDesignEff, setModalDesignEff] = useState('');
  const [modalOperatingEff, setModalOperatingEff] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [autoCreateUpload, setAutoCreateUpload] = useState(true);
  const [uploadResult, setUploadResult] = useState<{
    message: string;
    file_name: string;
    auto_create: boolean;
    extracted_count: number;
    suggested_count: number;
    created: number;
    skipped: number;
    errors: string[];
    preview: Array<Record<string, unknown>>;
  } | null>(null);
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
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['internal-controls'] });
      queryClient.invalidateQueries({ queryKey: ['internal-controls-dashboard'] });
      // Keep panel open in edit mode so user can link evidence immediately
      const created = response.data as InternalControl;
      setEditingControl(created);
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

  const aiSuggestControlMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const response = await ermApi.internalControls.getAISuggestions(data);
      return response.data;
    },
    onSuccess: (result) => {
      setSelectedModalCategory(result.suggested_category);
      setSelectedModalSubCategory(result.suggested_subcategory);
      if (result.suggested_description) setModalDescription(result.suggested_description);
      if (result.suggested_control_type) setModalControlType(result.suggested_control_type);
      if (result.suggested_control_nature) setModalControlNature(result.suggested_control_nature);
      if (result.suggested_frequency) setModalFrequency(result.suggested_frequency);
      if (result.suggested_priority) setModalPriority(result.suggested_priority);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, autoCreate }: { file: File; autoCreate: boolean }) =>
      ermApi.internalControls.uploadManualWithAI(file, autoCreate),
    onSuccess: (response) => {
      setUploadResult(response.data);
      setUploadFile(null);
      queryClient.invalidateQueries({ queryKey: ['internal-controls'] });
      queryClient.invalidateQueries({ queryKey: ['internal-controls-dashboard'] });
    },
    onError: (error: any) => {
      setUploadResult({
        message: error?.response?.data?.detail || 'Upload failed',
        file_name: uploadFile?.name || 'N/A',
        auto_create: autoCreateUpload,
        extracted_count: 0,
        suggested_count: 0,
        created: 0,
        skipped: 0,
        errors: [error?.response?.data?.detail || 'Unknown error'],
        preview: [],
      });
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

  // Dynamic metrics derived from filteredControls
  const metrics = useMemo(() => {
    const total = filteredControls.length;
    const keyCount = filteredControls.filter((c) => c.is_key_control).length;
    const effectiveCount = filteredControls.filter(
      (c) => c.design_effectiveness === 'effective' && c.operating_effectiveness === 'effective'
    ).length;
    const pendingCount = filteredControls.filter((c) => c.status === 'pending_approval').length;
    const activeCount = filteredControls.filter((c) => c.status === 'active').length;
    const draftCount = filteredControls.filter((c) => c.status === 'draft').length;
    const inactiveCount = filteredControls.filter((c) => c.status === 'inactive' || c.status === 'rejected').length;
    const partialCount = filteredControls.filter(
      (c) => getOverallEffectiveness(c.design_effectiveness, c.operating_effectiveness) === 'partially_effective'
    ).length;
    const ineffectiveCount = filteredControls.filter(
      (c) => getOverallEffectiveness(c.design_effectiveness, c.operating_effectiveness) === 'ineffective'
    ).length;
    const notTestedCount = total - effectiveCount - partialCount - ineffectiveCount;
    return { total, keyCount, effectiveCount, pendingCount, activeCount, draftCount, inactiveCount, partialCount, ineffectiveCount, notTestedCount };
  }, [filteredControls]);

  const availableModalSubCategories = useMemo(() => {
    return CONTROL_SUBCATEGORIES[selectedModalCategory] || [];
  }, [selectedModalCategory]);

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
      status: modalStatus || undefined,
      design_effectiveness: modalDesignEff || undefined,
      operating_effectiveness: modalOperatingEff || undefined,
    };

    if (editingControl) {
      updateMutation.mutate({ id: editingControl.id, data });
      return;
    }

    createMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load internal controls</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Visual Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {/* Card 1: Total vs Key */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Controls</p>
          <div className="flex items-center gap-3">
            <div className="relative h-[70px] w-[70px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Key', value: metrics.keyCount },
                      { name: 'Other', value: Math.max(0, metrics.total - metrics.keyCount) },
                    ]}
                    cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" paddingAngle={2}
                  >
                    <Cell fill="#7c3aed" />
                    <Cell fill="#e2e8f0" />
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-base font-bold text-slate-900">{metrics.total}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-600" />
                <span className="text-slate-500">Key</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.keyCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-200" />
                <span className="text-slate-500">Standard</span>
                <span className="ml-auto font-semibold text-slate-800">{Math.max(0, metrics.total - metrics.keyCount)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Status breakdown */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">By Status</p>
          <div className="flex items-center gap-3">
            <div className="relative h-[70px] w-[70px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Active', value: metrics.activeCount },
                      { name: 'Draft', value: metrics.draftCount },
                      { name: 'Pending', value: metrics.pendingCount },
                      { name: 'Inactive', value: metrics.inactiveCount },
                    ].filter((d) => d.value > 0)}
                    cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" paddingAngle={2}
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#94a3b8" />
                    <Cell fill="#eab308" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-base font-bold text-slate-900">{metrics.activeCount}</span>
                <span className="text-[9px] text-slate-400">active</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-slate-500">Active</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.activeCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-400" />
                <span className="text-slate-500">Pending</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.pendingCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                <span className="text-slate-500">Draft</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.draftCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Effectiveness breakdown */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Effectiveness</p>
          <div className="flex items-center gap-3">
            <div className="relative h-[70px] w-[70px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Effective', value: metrics.effectiveCount },
                      { name: 'Partial', value: metrics.partialCount },
                      { name: 'Ineffective', value: metrics.ineffectiveCount },
                      { name: 'Not Tested', value: metrics.notTestedCount },
                    ].filter((d) => d.value > 0)}
                    cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" paddingAngle={2}
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#eab308" />
                    <Cell fill="#ef4444" />
                    <Cell fill="#e2e8f0" />
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-base font-bold text-slate-900">{metrics.effectiveCount}</span>
                <span className="text-[9px] text-slate-400">effect.</span>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-slate-500">Effective</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.effectiveCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-400" />
                <span className="text-slate-500">Partial</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.partialCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-200" />
                <span className="text-slate-500">Not Tested</span>
                <span className="ml-auto font-semibold text-slate-800">{metrics.notTestedCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Coverage score gauge */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Coverage Score</p>
          {(() => {
            const score = metrics.total === 0 ? 0 : Math.round(((metrics.effectiveCount + metrics.partialCount * 0.5) / metrics.total) * 100);
            const scoreColor = score >= 75 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444';
            return (
              <div className="flex items-center gap-3">
                <div className="relative h-[70px] w-[70px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[{ value: score }, { value: 100 - score }]}
                        cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" startAngle={90} endAngle={-270}
                      >
                        <Cell fill={scoreColor} />
                        <Cell fill="#e2e8f0" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-sm font-bold" style={{ color: scoreColor }}>{score}%</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-slate-500">Effective</span>
                    <span className="ml-auto font-semibold text-slate-800">{metrics.effectiveCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-400" />
                    <span className="text-slate-500">Ineffective</span>
                    <span className="ml-auto font-semibold text-slate-800">{metrics.ineffectiveCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-yellow-400" />
                    <span className="text-slate-500">Pending</span>
                    <span className="ml-auto font-semibold text-slate-800">{metrics.pendingCount}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search controls..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-100 py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
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
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
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
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Controls</option>
            <option value="yes">Key Controls Only</option>
            <option value="no">Non-Key Controls</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowUploadModal(true);
              setUploadResult(null);
              setUploadFile(null);
              setAutoCreateUpload(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-200"
          >
            <Upload className="h-4 w-4" />
            Upload Manual + AI
          </button>
          <button
            onClick={() => {
              setEditingControl(null);
              setSelectedModalCategory('');
              setSelectedModalSubCategory('');
              setModalName('');
              setModalDescription('');
              setModalControlType('');
              setModalControlNature('');
              setModalFrequency('');
              setModalPriority('');
              setModalStatus('');
              setModalDesignEff('');
              setModalOperatingEff('');
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-500"
            style={canCreate ? {} : { display: 'none' }}
          >
            <Plus className="h-4 w-4" />
            Add New Control
          </button>
        </div>
      </div>

      {filteredControls.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Shield className="mx-auto h-12 w-12 text-slate-500" />
          <p className="mt-4 text-lg font-medium text-slate-900">No controls found</p>
          <p className="mt-1 text-sm text-slate-600">
            {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create your first internal control to get started'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Control ID</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Name</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Category</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Status</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Effectiveness</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredControls.map((control) => {
                const statusStyle = getStatusStyle(control.status);
                const effectivenessStyle = getEffectivenessStyle(
                  getOverallEffectiveness(control.design_effectiveness, control.operating_effectiveness)
                );
                return (
                  <tr key={control.id} className="hover:bg-slate-100/50 transition-colors">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/erm/internal-controls/${control.id}`}
                        className="font-mono text-sm text-primary-400 hover:text-primary-300"
                      >
                        {control.control_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/erm/internal-controls/${control.id}`}
                          className="font-medium text-slate-900 hover:text-primary-400"
                        >
                          {control.name}
                        </Link>
                        {control.is_key_control && (
                          <span className="flex items-center gap-1 rounded bg-purple-500/20 px-1.5 py-0.5 text-xs text-purple-400">
                            <Key className="h-3 w-3" />
                            Key
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{control.category || '-'}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full whitespace-nowrap px-2 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full whitespace-nowrap px-2 py-1 text-xs font-medium ${effectivenessStyle.bg} ${effectivenessStyle.text}`}
                      >
                        {effectivenessStyle.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingControl(control);
                            setSelectedModalCategory(control.category || '');
                            setSelectedModalSubCategory(control.sub_category || '');
                            setModalName(control.name || '');
                            setModalDescription(control.description || '');
                            setModalControlType(control.control_type || '');
                            setModalControlNature(control.control_nature || '');
                            setModalFrequency(control.frequency || '');
                            setModalPriority(control.priority || '');
                            setModalStatus(control.status || '');
                            setModalDesignEff(control.design_effectiveness || '');
                            setModalOperatingEff(control.operating_effectiveness || '');
                            setIsModalOpen(true);
                          }}
                          className="rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(control.id)}
                          className="rounded p-1 text-slate-600 hover:bg-red-600/20 hover:text-red-400 transition-colors"
                          title="Delete"
                          style={canDelete ? {} : { display: 'none' }}
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
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => {
              setIsModalOpen(false);
              setEditingControl(null);
            }}
          />
          {/* Slide-in panel */}
          <div className="fixed inset-y-0 right-0 z-50 flex w-[680px] flex-col bg-white shadow-2xl border-l border-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  {editingControl ? 'Edit Control' : 'Add New Control'}
                </h2>
                {!editingControl && (
                  <button
                    type="button"
                    onClick={() => aiSuggestControlMutation.mutate({ name: modalName, description: modalDescription || undefined })}
                    disabled={aiSuggestControlMutation.isPending || !modalName}
                    className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {aiSuggestControlMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    AI Suggest
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingControl(null);
                }}
                className="text-slate-500 hover:text-slate-900"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form
                id="control-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit(new FormData(e.currentTarget));
                }}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Control ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      name="control_id"
                      type="text"
                      required
                      defaultValue={editingControl?.control_id || ''}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                      placeholder="e.g., CTL-001"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      name="name"
                      type="text"
                      required
                      defaultValue={editingControl?.name || ''}
                      onChange={(e) => setModalName(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                      placeholder="Control name"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
                  <textarea
                    name="description"
                    rows={2}
                    value={modalDescription}
                    onChange={(e) => setModalDescription(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                    placeholder="Describe the control..."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
                    <select
                      name="category"
                      value={selectedModalCategory}
                      onChange={(e) => {
                        const nextCategory = e.target.value;
                        setSelectedModalCategory(nextCategory);
                        const nextOptions = CONTROL_SUBCATEGORIES[nextCategory] || [];
                        if (!nextOptions.includes(selectedModalSubCategory)) {
                          setSelectedModalSubCategory('');
                        }
                      }}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select category</option>
                      {CONTROL_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Sub-Category</label>
                    <select
                      name="sub_category"
                      value={selectedModalSubCategory}
                      onChange={(e) => setSelectedModalSubCategory(e.target.value)}
                      disabled={!selectedModalCategory}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
                    >
                      <option value="">{selectedModalCategory ? 'Select sub-category' : 'Select category first'}</option>
                      {availableModalSubCategories.map((subCategory) => (
                        <option key={subCategory} value={subCategory}>{subCategory}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Control Type</label>
                    <select
                      name="control_type"
                      value={modalControlType}
                      onChange={(e) => setModalControlType(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select type</option>
                      {CONTROL_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Control Nature</label>
                    <select
                      name="control_nature"
                      value={modalControlNature}
                      onChange={(e) => setModalControlNature(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select nature</option>
                      {CONTROL_NATURES.map((n) => (
                        <option key={n.value} value={n.value}>{n.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Frequency</label>
                    <select
                      name="frequency"
                      value={modalFrequency}
                      onChange={(e) => setModalFrequency(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select frequency</option>
                      {FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Priority</label>
                    <select
                      name="priority"
                      value={modalPriority}
                      onChange={(e) => setModalPriority(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select priority</option>
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Status & Effectiveness */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Status</label>
                    <select
                      value={modalStatus}
                      onChange={(e) => setModalStatus(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select status</option>
                      <option value="draft">Draft</option>
                      <option value="pending_approval">Pending Approval</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Design Effectiveness</label>
                    <select
                      value={modalDesignEff}
                      onChange={(e) => setModalDesignEff(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Not Tested</option>
                      <option value="effective">Effective</option>
                      <option value="partially_effective">Partially Effective</option>
                      <option value="ineffective">Ineffective</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Operating Effectiveness</label>
                    <select
                      value={modalOperatingEff}
                      onChange={(e) => setModalOperatingEff(e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Not Tested</option>
                      <option value="effective">Effective</option>
                      <option value="partially_effective">Partially Effective</option>
                      <option value="ineffective">Ineffective</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Regulatory Source</label>
                  <input
                    name="regulatory_source"
                    type="text"
                    defaultValue={editingControl?.regulatory_source || ''}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                    placeholder="e.g., SOX, PCI-DSS, ISO 27001"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Effective Date</label>
                    <input
                      name="effective_date"
                      type="date"
                      defaultValue={editingControl?.effective_date?.split('T')[0] || ''}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Review Date</label>
                    <input
                      name="review_date"
                      type="date"
                      defaultValue={editingControl?.review_date?.split('T')[0] || ''}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    name="is_key_control"
                    type="checkbox"
                    value="true"
                    defaultChecked={editingControl?.is_key_control || false}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="text-xs font-medium text-slate-700">Key Control</label>
                </div>
              </form>

              {/* Evidence Linking Section */}
              {editingControl && (
                <EvidenceLinkSection controlId={editingControl.id} />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 px-6 py-4 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingControl(null);
                }}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="control-form"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {editingControl ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[84vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Upload Internal Controls (Manual + AI)</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>

            {uploadResult ? (
              <div className="space-y-3.5">
                <div className={`rounded-lg p-4 ${uploadResult.created > 0 ? 'bg-green-500/10 border border-green-500/30' : 'bg-blue-500/10 border border-blue-500/30'}`}>
                  <p className={`text-sm font-medium ${uploadResult.created > 0 ? 'text-green-400' : 'text-blue-400'}`}>
                    {uploadResult.message}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Extracted: {uploadResult.extracted_count} | AI Suggestions: {uploadResult.suggested_count} | Created: {uploadResult.created} | Skipped: {uploadResult.skipped}
                  </p>
                  {uploadResult.errors.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      {uploadResult.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-400">{err}</p>
                      ))}
                    </div>
                  )}
                </div>

                {uploadResult.preview.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-700">AI Preview (first 25)</p>
                    <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr>
                            <th className="px-2 py-1 text-left">Control ID</th>
                            <th className="px-2 py-1 text-left">Name</th>
                            <th className="px-2 py-1 text-left">Category</th>
                            <th className="px-2 py-1 text-left">Type</th>
                            <th className="px-2 py-1 text-left">Priority</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uploadResult.preview.map((item, idx) => (
                            <tr key={idx} className="border-t border-slate-100 text-slate-700">
                              <td className="px-2 py-1">{String(item.control_id || '-')}</td>
                              <td className="px-2 py-1">{String(item.name || '-')}</td>
                              <td className="px-2 py-1">{String(item.category || '-')}</td>
                              <td className="px-2 py-1">{String(item.control_type || '-')}</td>
                              <td className="px-2 py-1">{String(item.priority || '-')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Upload a manual control file (`.csv`, `.xlsx`, `.xls`, `.txt`). AI will normalize and suggest control fields.
                </p>

                <div className="rounded-lg border-2 border-dashed border-slate-300 p-5 text-center">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.txt"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="internal-control-upload"
                  />
                  <label htmlFor="internal-control-upload" className="cursor-pointer">
                    <Upload className="mx-auto h-8 w-8 text-slate-500" />
                    <p className="mt-2 text-sm text-slate-600">
                      {uploadFile ? uploadFile.name : 'Click to select a file'}
                    </p>
                  </label>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoCreateUpload}
                    onChange={(e) => setAutoCreateUpload(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600"
                  />
                  Auto-create controls after AI extraction
                </label>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => uploadFile && uploadMutation.mutate({ file: uploadFile, autoCreate: autoCreateUpload })}
                    disabled={!uploadFile || uploadMutation.isPending}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Upload & Analyze
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-500/20 p-2">
                <XCircle className="h-6 w-6 text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Delete Control</h3>
            </div>
            <p className="mb-6 text-slate-700">
              Are you sure you want to delete this control? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
