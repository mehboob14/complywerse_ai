'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evidenceApi, ermApi, frameworksApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Shield,
  Loader2,
  Plus,
  Upload,
  X,
  Edit2,
  Trash2,
  Key,
  AlertCircle,
  XCircle,
  Sparkles,
  Link2Off,
  FileText,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { SearchInput } from '@/components/ui/SearchInput';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { InlineLinkPicker } from '@/components/ui/InlineLinkPicker';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

const { ResponsiveContainer, PieChart, Pie, Tooltip } = {
  ResponsiveContainer: dynamic(
    () => import('recharts').then((mod) => mod.ResponsiveContainer),
    { ssr: false }
  ),
  PieChart: dynamic(
    () => import('recharts').then((mod) => mod.PieChart),
    { ssr: false }
  ),
  Pie: dynamic(() => import('recharts').then((mod) => mod.Pie), { ssr: false }),
  Tooltip: dynamic(() => import('recharts').then((mod) => mod.Tooltip), { ssr: false }),
};


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

const STATUS_PIE_COLORS: Record<string, string> = {
  Active: '#22c55e',
  Draft: '#94a3b8',
  Pending: '#eab308',
  Inactive: '#ef4444',
};

const EFFECTIVENESS_PIE_COLORS: Record<string, string> = {
  Effective: '#22c55e',
  Partial: '#eab308',
  Ineffective: '#ef4444',
  'Not Tested': '#94a3b8',
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

  const { data: allEvidence, isLoading: loadingAll } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => {
      const res = await evidenceApi.getAll();
      return res.data as unknown as Array<{ id: number; title?: string; file_name?: string; evidence_type?: string; status?: string }>;
    },
  });

  const linkMutation = useMutation({
    mutationFn: (evidenceId: number) =>
      ermApi.internalControls.linkEvidence(controlId, { evidence_id: evidenceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ic-evidence', controlId] });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: number) => ermApi.internalControls.unlinkEvidence(controlId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ic-evidence', controlId] }),
  });

  const linkedIds = new Set(linkedEvidence?.map((l) => l.evidence_id) ?? []);
  const pickerItems = (allEvidence ?? [])
    .filter((ev) => !linkedIds.has(ev.id))
    .map((ev) => ({
      value: String(ev.id),
      label: ev.title || ev.file_name || `Evidence #${ev.id}`,
      subLabel: ev.evidence_type || undefined,
    }));

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Linked Evidence</h3>
        <InlineLinkPicker
          triggerLabel="Link Evidence"
          items={pickerItems}
          isLoading={loadingAll}
          onSelect={(val) => linkMutation.mutate(Number(val))}
          searchPlaceholder="Search evidence..."
          emptyText="No evidence found"
        />
      </div>

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
  const [modalRegulatorySource, setModalRegulatorySource] = useState('');
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

  const { data: frameworks } = useQuery({
    queryKey: ['regulatory-source-frameworks'],
    queryFn: async () => {
      const response = await frameworksApi.getAll();
      return response.data as Array<{ id: string; name: string }>;
    },
  });

  const regulatorySourceOptions = useMemo(() => {
    const values = new Set<string>();
    (frameworks || []).forEach((framework) => {
      const name = (framework?.name || '').trim();
      if (name) values.add(name);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [frameworks]);

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

  const statusBreakdownData = useMemo(
    () =>
      [
        { name: 'Active', value: metrics.activeCount, fill: STATUS_PIE_COLORS.Active },
        { name: 'Draft', value: metrics.draftCount, fill: STATUS_PIE_COLORS.Draft },
        { name: 'Pending', value: metrics.pendingCount, fill: STATUS_PIE_COLORS.Pending },
        { name: 'Inactive', value: metrics.inactiveCount, fill: STATUS_PIE_COLORS.Inactive },
      ].filter((d) => d.value > 0),
    [metrics.activeCount, metrics.draftCount, metrics.pendingCount, metrics.inactiveCount]
  );

  const effectivenessBreakdownData = useMemo(
    () =>
      [
        { name: 'Effective', value: metrics.effectiveCount, fill: EFFECTIVENESS_PIE_COLORS.Effective },
        { name: 'Partial', value: metrics.partialCount, fill: EFFECTIVENESS_PIE_COLORS.Partial },
        { name: 'Ineffective', value: metrics.ineffectiveCount, fill: EFFECTIVENESS_PIE_COLORS.Ineffective },
        { name: 'Not Tested', value: metrics.notTestedCount, fill: EFFECTIVENESS_PIE_COLORS['Not Tested'] },
      ].filter((d) => d.value > 0),
    [metrics.effectiveCount, metrics.partialCount, metrics.ineffectiveCount, metrics.notTestedCount]
  );

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
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
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
                      { name: 'Key', value: metrics.keyCount, fill: '#7c3aed' },
                      { name: 'Other', value: Math.max(0, metrics.total - metrics.keyCount), fill: '#cbd5e1' },
                    ]}
                    cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" paddingAngle={2}
                  />
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
                    data={statusBreakdownData}
                    cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" paddingAngle={2}
                  />
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
                    data={effectivenessBreakdownData}
                    cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" paddingAngle={2}
                  />
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
                        data={[{ value: score, fill: scoreColor }, { value: 100 - score, fill: '#cbd5e1' }]}
                        cx="50%" cy="50%" innerRadius={22} outerRadius={33} dataKey="value" startAngle={90} endAngle={-270}
                      />
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

      <div className="flex flex-row items-center gap-2 overflow-x-auto pb-1">
        <div className="flex-1 min-w-[160px] sm:min-w-[220px] max-w-md flex-shrink-0">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search controls..."
            size="md"
          />
        </div>
        <div className="flex-shrink-0">
          <MultiSelectDropdown
            title="Status"
            multiSelect={false}
            selectedValues={statusFilter === 'all' ? [] : [statusFilter]}
            onApply={(vals) => setStatusFilter(vals[0] || 'all')}
            items={[
              { value: 'draft', label: 'Draft' },
              { value: 'pending_approval', label: 'Pending Approval' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="All Statuses"
          />
        </div>
        <div className="flex-shrink-0">
          <MultiSelectDropdown
            title="Category"
            multiSelect={false}
            selectedValues={categoryFilter === 'all' ? [] : [categoryFilter]}
            onApply={(vals) => setCategoryFilter(vals[0] || 'all')}
            items={CONTROL_CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
            placeholder="All Categories"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <button
            onClick={() => {
              setShowUploadModal(true);
              setUploadResult(null);
              setUploadFile(null);
              setAutoCreateUpload(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Upload size={16} />
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
              setModalRegulatorySource('');
              setIsModalOpen(true);
            }}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-medium"
            style={canCreate ? {} : { display: 'none' }}
          >
            <Plus size={16} />
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
                            setModalRegulatorySource(control.regulatory_source || '');
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

      <RightSlidePanel
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingControl(null);
        }}
        width="w-full max-w-2xl"
        title={
          <div className="flex items-center gap-3">
            <span>{editingControl ? 'Edit Control' : 'Add New Control'}</span>
            {!editingControl && (
              <button
                type="button"
                onClick={() => aiSuggestControlMutation.mutate({ name: modalName, description: modalDescription || undefined })}
                disabled={aiSuggestControlMutation.isPending || !modalName}
                className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {aiSuggestControlMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI Suggest
              </button>
            )}
          </div>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false);
                setEditingControl(null);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="control-form"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                editingControl ? 'Update' : 'Create'
              )}
            </button>
          </div>
        }
      >
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
                    <label className="block text-sm font-medium text-gray-800 mb-1">
                      Control ID *
                    </label>
                    <input
                      name="control_id"
                      type="text"
                      required
                      defaultValue={editingControl?.control_id || ''}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="e.g., CTL-001"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">
                      Name *
                    </label>
                    <input
                      name="name"
                      type="text"
                      required
                      defaultValue={editingControl?.name || ''}
                      onChange={(e) => setModalName(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Control name"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
                  <textarea
                    name="description"
                    rows={2}
                    value={modalDescription}
                    onChange={(e) => setModalDescription(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Describe the control..."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Category</label>
                    <input type="hidden" name="category" value={selectedModalCategory} />
                    <MultiSelectDropdown
                      title="Category"
                      items={CONTROL_CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
                      selectedValues={selectedModalCategory ? [selectedModalCategory] : []}
                      onApply={(vals) => {
                        const nextCategory = vals[0] || '';
                        setSelectedModalCategory(nextCategory);
                        const nextOptions = CONTROL_SUBCATEGORIES[nextCategory] || [];
                        if (!nextOptions.includes(selectedModalSubCategory)) {
                          setSelectedModalSubCategory('');
                        }
                      }}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Select category"
                      size="md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Sub-Category</label>
                    <input type="hidden" name="sub_category" value={selectedModalSubCategory} />
                    <MultiSelectDropdown
                      title="Sub-Category"
                      items={availableModalSubCategories.map((sc) => ({ value: sc, label: sc }))}
                      selectedValues={selectedModalSubCategory ? [selectedModalSubCategory] : []}
                      onApply={(vals) => setSelectedModalSubCategory(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder={selectedModalCategory ? 'Select sub-category' : 'Select category first'}
                      size="md"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Control Type</label>
                    <input type="hidden" name="control_type" value={modalControlType} />
                    <MultiSelectDropdown
                      title="Control Type"
                      items={CONTROL_TYPES.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
                      selectedValues={modalControlType ? [modalControlType] : []}
                      onApply={(vals) => setModalControlType(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Select type"
                      size="md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Control Nature</label>
                    <input type="hidden" name="control_nature" value={modalControlNature} />
                    <MultiSelectDropdown
                      title="Control Nature"
                      items={CONTROL_NATURES.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
                      selectedValues={modalControlNature ? [modalControlNature] : []}
                      onApply={(vals) => setModalControlNature(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Select nature"
                      size="md"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Frequency</label>
                    <input type="hidden" name="frequency" value={modalFrequency} />
                    <MultiSelectDropdown
                      title="Frequency"
                      items={FREQUENCIES.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
                      selectedValues={modalFrequency ? [modalFrequency] : []}
                      onApply={(vals) => setModalFrequency(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Select frequency"
                      size="md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Priority</label>
                    <input type="hidden" name="priority" value={modalPriority} />
                    <MultiSelectDropdown
                      title="Priority"
                      items={PRIORITIES.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
                      selectedValues={modalPriority ? [modalPriority] : []}
                      onApply={(vals) => setModalPriority(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Select priority"
                      size="md"
                    />
                  </div>
                </div>

                {/* Status & Effectiveness */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Status</label>
                    <MultiSelectDropdown
                      title="Status"
                      items={[
                        { value: 'draft', label: 'Draft' },
                        { value: 'pending_approval', label: 'Pending Approval' },
                        { value: 'active', label: 'Active' },
                        { value: 'inactive', label: 'Inactive' },
                      ]}
                      selectedValues={modalStatus ? [modalStatus] : []}
                      onApply={(vals) => setModalStatus(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Select status"
                      size="md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Design Effectiveness</label>
                    <MultiSelectDropdown
                      title="Design Effectiveness"
                      items={[
                        { value: 'effective', label: 'Effective' },
                        { value: 'partially_effective', label: 'Partially Effective' },
                        { value: 'ineffective', label: 'Ineffective' },
                      ]}
                      selectedValues={modalDesignEff ? [modalDesignEff] : []}
                      onApply={(vals) => setModalDesignEff(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Not Tested"
                      size="md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Operating Effectiveness</label>
                    <MultiSelectDropdown
                      title="Operating Effectiveness"
                      items={[
                        { value: 'effective', label: 'Effective' },
                        { value: 'partially_effective', label: 'Partially Effective' },
                        { value: 'ineffective', label: 'Ineffective' },
                      ]}
                      selectedValues={modalOperatingEff ? [modalOperatingEff] : []}
                      onApply={(vals) => setModalOperatingEff(vals[0] || '')}
                      multiSelect={false}
                      triggerVariant="input"
                      placeholder="Not Tested"
                      size="md"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Regulatory Source</label>
                  <input
                    name="regulatory_source"
                    type="text"
                    value={modalRegulatorySource}
                    onChange={(e) => setModalRegulatorySource(e.target.value)}
                    list="regulatory-framework-options"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="Search framework or enter source"
                  />
                  <datalist id="regulatory-framework-options">
                    {regulatorySourceOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Effective Date</label>
                    <input
                      name="effective_date"
                      type="date"
                      defaultValue={editingControl?.effective_date?.split('T')[0] || ''}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Review Date</label>
                    <input
                      name="review_date"
                      type="date"
                      defaultValue={editingControl?.review_date?.split('T')[0] || ''}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
                  <label className="text-sm font-medium text-gray-800">Key Control</label>
                </div>
        </form>

        {/* Evidence Linking Section */}
        {editingControl && (
          <EvidenceLinkSection controlId={editingControl.id} />
        )}
      </RightSlidePanel>

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

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
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
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadFile && uploadMutation.mutate({ file: uploadFile, autoCreate: autoCreateUpload })}
                    disabled={!uploadFile || uploadMutation.isPending}
                    className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
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
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
