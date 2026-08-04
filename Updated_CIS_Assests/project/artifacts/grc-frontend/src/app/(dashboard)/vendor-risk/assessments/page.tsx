'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { vendorRiskApi, tenantApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Eye,
  Shield,
  ShieldAlert,
  Lock,
  FileWarning,
  Scale,
  RefreshCw,
  ClipboardCheck,
} from 'lucide-react';
import { Link } from 'wouter';
import { useRouter } from '@/lib/navigation';
import {
  SearchInput,
  MultiSelectDropdown,
  RightSlidePanel,
} from '@/components/ui';

// ─── Assessment Type Definitions ────────────────────────────────
const ASSESSMENT_TYPES = [
  {
    id: 'cybersecurity',
    label: 'Cybersecurity Assessment',
    description: 'Evaluate vendor security controls, infrastructure protection, and incident response capabilities.',
    icon: ShieldAlert,
    color: 'text-red-600 bg-red-50 border-red-200',
    category: 'Security',
  },
  {
    id: 'privacy_data_protection',
    label: 'Privacy & Data Protection',
    description: 'Assess data handling practices, GDPR/privacy compliance, and data processing agreements.',
    icon: Lock,
    color: 'text-purple-600 bg-purple-50 border-purple-200',
    category: 'Privacy',
  },
  {
    id: 'operational_risk',
    label: 'Operational Risk Assessment',
    description: 'Review business continuity, disaster recovery, and operational resilience measures.',
    icon: Scale,
    color: 'text-orange-600 bg-orange-50 border-orange-200',
    category: 'Risk',
  },
  {
    id: 'compliance_regulatory',
    label: 'Compliance & Regulatory',
    description: 'Verify adherence to regulatory requirements (SOC 2, ISO 27001, PCI DSS, HIPAA, etc.).',
    icon: ClipboardCheck,
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    category: 'Compliance',
  },
  {
    id: 'financial_risk',
    label: 'Financial Risk Assessment',
    description: 'Evaluate vendor financial stability, credit risk, and contractual obligations.',
    icon: FileWarning,
    color: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    category: 'Financial',
  },
  {
    id: 'initial_onboarding',
    label: 'Initial Onboarding Assessment',
    description: 'Comprehensive due diligence assessment for new vendors before contract signing.',
    icon: Shield,
    color: 'text-green-600 bg-green-50 border-green-200',
    category: 'Onboarding',
  },
  {
    id: 'periodic_review',
    label: 'Periodic Review',
    description: 'Scheduled reassessment of existing vendor risk profile (annual, semi-annual, quarterly).',
    icon: RefreshCw,
    color: 'text-cyan-600 bg-cyan-50 border-cyan-200',
    category: 'Review',
  },
  {
    id: 'custom',
    label: 'Custom Assessment Type',
    description: 'Define your own assessment type for vendor-specific, regional, or internal review workflows.',
    icon: Plus,
    color: 'text-gray-700 bg-gray-50 border-gray-300',
    category: 'Custom',
  },
];

const ASSESSMENT_TYPE_MAP = Object.fromEntries(ASSESSMENT_TYPES.map((t) => [t.id, t]));

interface Assessment {
  id: number;
  vendor_id: number;
  vendor_name: string;
  assessment_type: string;
  status: string;
  inherent_score: number | null;
  residual_score: number | null;
  risk_rating: string | null;
  due_date: string | null;
  assessor: { id: number; full_name: string } | null;
  created_at: string;
}

interface VendorOption {
  id: number;
  name: string;
}

interface UserOption {
  id: number;
  username: string;
  display_name: string;
  email: string;
  department: string | null;
}

const getStatusPill = (status: string) => {
  const styles: Record<string, string> = {
    draft: 'bg-gray-600 text-white border-gray-700',
    in_progress: 'bg-blue-600 text-white border-blue-700',
    completed: 'bg-green-600 text-white border-green-700',
    reviewed: 'bg-teal-600 text-white border-teal-700',
    overdue: 'bg-red-600 text-white border-red-700',
    pending_review: 'bg-yellow-600 text-white border-yellow-700',
    approved: 'bg-purple-600 text-white border-purple-700',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-600 text-white border-gray-700';
};

const getRiskPill = (rating: string | null) => {
  if (!rating) return '';
  const styles: Record<string, string> = {
    critical: 'bg-red-600 text-white border-red-700',
    high: 'bg-orange-600 text-white border-orange-700',
    medium: 'bg-yellow-600 text-white border-yellow-700',
    low: 'bg-green-600 text-white border-green-700',
  };
  return styles[rating.toLowerCase()] || 'bg-gray-600 text-white border-gray-700';
};

const formatAssessmentType = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_OPTIONS = ['draft', 'in_progress', 'reviewed', 'approved', 'completed', 'overdue'];

export default function VendorAssessmentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:assessments:create');
  const canDelete =
    hasPermission('vendor_risk:assessments:delete') ||
    hasPermission('vendor_risk:assessments:edit');
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<'select_type' | 'details'>('select_type');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [customAssessmentType, setCustomAssessmentType] = useState('');
  const [deletingAssessmentId, setDeletingAssessmentId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    vendor_id: '',
    assessment_type: '',
    due_date: '',
    assessed_by: '',
  });
  const [mutationError, setMutationError] = useState('');

  const { data: assessments, isLoading } = useQuery({
    queryKey: ['vendor-assessments-all'],
    queryFn: async () => {
      const res = await vendorRiskApi.getAssessments();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as Assessment[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendors();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as VendorOption[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: users } = useQuery({
    queryKey: ['users-directory'],
    queryFn: async () => {
      try {
        const res = await tenantApi.getTenantUsers();
        const data = res.data;
        return (Array.isArray(data) ? data : []) as UserOption[];
      } catch {
        return [] as UserOption[];
      }
    },
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.createAssessment(data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-assessments-all'] });
      setShowModal(false);
      setModalStep('select_type');
      setFormData({ vendor_id: '', assessment_type: '', due_date: '', assessed_by: '' });
      setCustomAssessmentType('');
      setMutationError('');
    },
    onError: (err: any) => {
      setMutationError(err?.response?.data?.detail || err?.message || 'Failed to create assessment');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assessmentId: number) => {
      await vendorRiskApi.deleteAssessment(assessmentId);
    },
    onMutate: (assessmentId) => {
      setDeletingAssessmentId(assessmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-assessments-all'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-dashboard'] });
    },
    onSettled: () => {
      setDeletingAssessmentId(null);
    },
  });

  const handleSelectType = (typeId: string) => {
    setFormData({ ...formData, assessment_type: typeId });
    setModalStep('details');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMutationError('');
    const selectedType = formData.assessment_type === 'custom'
      ? customAssessmentType.trim().toLowerCase().replace(/\s+/g, '_')
      : formData.assessment_type;

    if (!selectedType) {
      setMutationError('Assessment type is required');
      return;
    }

    const payload: Record<string, unknown> = {
      vendor_id: Number(formData.vendor_id),
      assessment_type: selectedType,
    };
    if (formData.due_date) payload.due_date = formData.due_date;
    if (formData.assessed_by) payload.assessed_by = Number(formData.assessed_by);
    createMutation.mutate(payload);
  };

  const openModal = () => {
    setShowModal(true);
    setModalStep('select_type');
    setFormData({ vendor_id: '', assessment_type: '', due_date: '', assessed_by: '' });
    setCustomAssessmentType('');
    setMutationError('');
  };

  const uniqueVendors = useMemo(() => {
    if (!assessments) return [];
    const map = new Map<number, string>();
    assessments.forEach((a) => { if (a.vendor_id && a.vendor_name) map.set(a.vendor_id, a.vendor_name); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assessments]);

  const availableTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    ASSESSMENT_TYPES.filter((type) => type.id !== 'custom').forEach((type) => {
      map.set(type.id, type.label);
    });
    (assessments || []).forEach((assessment) => {
      if (!map.has(assessment.assessment_type)) {
        map.set(assessment.assessment_type, formatAssessmentType(assessment.assessment_type));
      }
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [assessments]);

  const combinedVendorList = useMemo(() => {
    return [...uniqueVendors, ...(vendors ?? []).filter((v) => !uniqueVendors.some((uv) => uv.id === v.id))];
  }, [uniqueVendors, vendors]);

  const filtered = useMemo(() => {
    if (!assessments) return [];
    return assessments.filter((a) => {
      const assessorName = typeof a.assessor === 'object' ? a.assessor?.full_name : a.assessor;
      const matchSearch = !searchTerm
        || a.vendor_name?.toLowerCase().includes(searchTerm.toLowerCase())
        || assessorName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'all' || a.status?.toLowerCase() === statusFilter;
      const matchVendor = vendorFilter === 'all' || String(a.vendor_id) === vendorFilter;
      const matchType = typeFilter === 'all' || a.assessment_type === typeFilter;
      return matchSearch && matchStatus && matchVendor && matchType;
    });
  }, [assessments, searchTerm, statusFilter, vendorFilter, typeFilter]);

  const handleDeleteAssessment = (assessment: Assessment) => {
    const confirmed = window.confirm(
      `Delete assessment #${assessment.id} for ${assessment.vendor_name}? Linked questionnaire responses will be detached but kept.`
    );
    if (!confirmed) return;
    deleteMutation.mutate(assessment.id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Vendor Assessments</h1>
          <p className="text-sm text-gray-500 mt-1">Track and manage third-party risk assessments</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/vendor-risk/vendors"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Vendors
          </Link>
          <Link
            href="/vendor-risk/questionnaires"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Questionnaires
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      {assessments && assessments.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">Total</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{assessments.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">In Progress</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{assessments.filter((a) => a.status === 'in_progress' || a.status === 'draft').length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">Approved</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{assessments.filter((a) => a.status === 'approved').length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">High/Critical Risk</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{assessments.filter((a) => a.risk_rating === 'high' || a.risk_rating === 'critical').length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="flex-1 min-w-[180px] sm:min-w-[260px] max-w-md">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by vendor or assessor..."
              variant="square"
            />
          </div>
          <MultiSelectDropdown
            title="Type"
            multiSelect={false}
            selectedValues={typeFilter === 'all' ? [] : [typeFilter]}
            onApply={(values) => setTypeFilter(values[0] ?? 'all')}
            items={[
              { value: 'all', label: 'All Types' },
              ...availableTypeOptions.map((t) => ({ value: t.id, label: t.label })),
            ]}
            placeholder="All Types"
          />
          <MultiSelectDropdown
            title="Status"
            multiSelect={false}
            selectedValues={statusFilter === 'all' ? [] : [statusFilter]}
            onApply={(values) => setStatusFilter(values[0] ?? 'all')}
            items={[
              { value: 'all', label: 'All Statuses' },
              ...STATUS_OPTIONS.map((s) => ({
                value: s,
                label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              })),
            ]}
            placeholder="All Statuses"
          />
          <MultiSelectDropdown
            title="Vendor"
            multiSelect={false}
            forceSearch
            selectedValues={vendorFilter === 'all' ? [] : [vendorFilter]}
            onApply={(values) => setVendorFilter(values[0] ?? 'all')}
            items={[
              { value: 'all', label: 'All Vendors' },
              ...combinedVendorList.map((v) => ({ value: String(v.id), label: v.name })),
            ]}
            placeholder="All Vendors"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {canCreate && (
            <button
              onClick={openModal}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Assessment
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assessment Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Rating</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assessor</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-500">
                    <FileCheck className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-gray-600">No assessments found</p>
                    <p className="text-xs mt-1">Create your first vendor assessment to get started</p>
                  </td>
                </tr>
              ) : (
                filtered.map((a) => {
                  const typeInfo = ASSESSMENT_TYPE_MAP[a.assessment_type];
                  const TypeIcon = typeInfo?.icon || FileCheck;
                  const assessorName = typeof a.assessor === 'object' ? a.assessor?.full_name : a.assessor;
                  return (
                    <tr key={a.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/vendor-risk/assessments/${a.id}`)}>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">#{a.id}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/vendor-risk/vendors/${a.vendor_id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        >
                          {a.vendor_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{typeInfo?.label || formatAssessmentType(a.assessment_type)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getStatusPill(a.status)}`}>
                          {a.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {a.risk_rating ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getRiskPill(a.risk_rating)}`}>
                            {a.risk_rating}
                          </span>
                        ) : <span className="text-sm text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {a.inherent_score != null ? a.inherent_score.toFixed(1) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{a.due_date ? new Date(a.due_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{assessorName ?? '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(`/vendor-risk/assessments/${a.id}`);
                            }}
                            className="p-1.5 text-blue-600 hover:text-blue-800 rounded"
                            title="Open assessment"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canDelete && (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteAssessment(a);
                              }}
                              disabled={deleteMutation.isPending && deletingAssessmentId === a.id}
                              className="p-1.5 text-red-500 hover:text-red-700 rounded disabled:opacity-50"
                              title="Delete assessment"
                            >
                              {deleteMutation.isPending && deletingAssessmentId === a.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal — RightSlidePanel */}
      <RightSlidePanel
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={modalStep === 'select_type' ? 'Select Assessment Type' : 'Assessment Details'}
        subtitle={
          modalStep === 'select_type'
            ? 'Choose the type of risk assessment to perform'
            : formData.assessment_type === 'custom'
              ? (customAssessmentType.trim() ? formatAssessmentType(customAssessmentType.trim()) : 'Custom Assessment Type')
              : ASSESSMENT_TYPE_MAP[formData.assessment_type]?.label
        }
        width="w-full max-w-2xl"
        footer={
          modalStep === 'details' ? (
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => setModalStep('select_type')}
                className="text-sm font-medium text-gray-600 hover:text-gray-800"
              >
                &larr; Back
              </button>
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
                  form="create-assessment-form"
                  disabled={
                    createMutation.isPending ||
                    !formData.vendor_id ||
                    !formData.assessment_type ||
                    (formData.assessment_type === 'custom' && !customAssessmentType.trim())
                  }
                  className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />Saving...
                    </>
                  ) : (
                    'Create Assessment'
                  )}
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {modalStep === 'select_type' && (
          <div className="space-y-3">
            {ASSESSMENT_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  onClick={() => handleSelectType(type.id)}
                  className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all hover:shadow-md hover:border-blue-400 ${type.color}`}
                >
                  <div className="mt-0.5">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{type.label}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/80 text-gray-500 font-medium">{type.category}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{type.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {modalStep === 'details' && (
          <form id="create-assessment-form" onSubmit={handleSubmit} className="space-y-5">
            {/* Selected type summary */}
            {formData.assessment_type && ASSESSMENT_TYPE_MAP[formData.assessment_type] && (
              <div className={`flex items-center gap-3 p-3 rounded-lg border ${ASSESSMENT_TYPE_MAP[formData.assessment_type].color}`}>
                {(() => { const Icon = ASSESSMENT_TYPE_MAP[formData.assessment_type].icon; return <Icon className="h-5 w-5" />; })()}
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {formData.assessment_type === 'custom'
                      ? (customAssessmentType.trim() ? formatAssessmentType(customAssessmentType.trim()) : ASSESSMENT_TYPE_MAP.custom.label)
                      : ASSESSMENT_TYPE_MAP[formData.assessment_type].label}
                  </span>
                  <p className="text-xs text-gray-500">{ASSESSMENT_TYPE_MAP[formData.assessment_type].description}</p>
                </div>
                <button type="button" onClick={() => setModalStep('select_type')} className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium">
                  Change
                </button>
              </div>
            )}

            {formData.assessment_type === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Custom Assessment Type *</label>
                <input
                  type="text"
                  required
                  value={customAssessmentType}
                  onChange={(event) => setCustomAssessmentType(event.target.value)}
                  placeholder="e.g., Saudi NCA Annual Compliance Review"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            )}

            {/* Vendor */}
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Vendor *</label>
              <MultiSelectDropdown
                title="Vendor"
                multiSelect={false}
                triggerVariant="input"
                size="md"
                forceSearch
                placeholder="Select vendor..."
                selectedValues={formData.vendor_id ? [String(formData.vendor_id)] : []}
                onApply={(values) => setFormData({ ...formData, vendor_id: values[0] ?? '' })}
                items={combinedVendorList.map((v) => ({ value: String(v.id), label: v.name }))}
              />
              {(vendors ?? []).length === 0 && uniqueVendors.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No vendors found. Add a vendor first in Vendor Risk to create an assessment.</p>
              )}
            </div>

            {/* Assessor from user directory */}
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Assign Assessor</label>
              <MultiSelectDropdown
                title="Assessor"
                multiSelect={false}
                triggerVariant="input"
                size="md"
                forceSearch
                placeholder="Current user (default)"
                selectedValues={formData.assessed_by ? [String(formData.assessed_by)] : []}
                onApply={(values) => setFormData({ ...formData, assessed_by: values[0] ?? '' })}
                items={(users ?? []).map((u) => ({
                  value: String(u.id),
                  label: u.display_name || u.username,
                  subLabel: u.department || u.email,
                }))}
              />
              <p className="text-xs text-gray-400 mt-1">Select from your company user directory</p>
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Due Date</label>
              <input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Error */}
            {mutationError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {mutationError}
              </div>
            )}
          </form>
        )}
      </RightSlidePanel>
    </div>
  );
}
