'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorRiskApi, tenantApi } from '@/lib/api';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Search,
  Plus,
  X,
  Shield,
  ShieldAlert,
  Lock,
  FileWarning,
  Scale,
  RefreshCw,
  ClipboardCheck,
  Info,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    reviewed: 'bg-teal-100 text-teal-700',
    overdue: 'bg-red-100 text-red-700',
    pending_review: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-purple-100 text-purple-700',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-100 text-gray-700';
};

const getRiskBadge = (rating: string | null) => {
  if (!rating) return '';
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  };
  return styles[rating.toLowerCase()] || 'bg-gray-100 text-gray-700';
};

const STATUS_OPTIONS = ['draft', 'in_progress', 'reviewed', 'approved', 'completed', 'overdue'];

export default function VendorAssessmentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<'select_type' | 'details'>('select_type');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [formData, setFormData] = useState({
    vendor_id: '',
    assessment_type: '',
    due_date: '',
    assessed_by: '',
  });
  const [mutationError, setMutationError] = useState('');
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);

  const { data: assessments, isLoading } = useQuery({
    queryKey: ['vendor-assessments-all'],
    queryFn: async () => {
      const res = await vendorRiskApi.getAssessments();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as Assessment[];
    },
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendors();
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as VendorOption[];
    },
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
      setMutationError('');
    },
    onError: (err: any) => {
      setMutationError(err?.response?.data?.detail || err?.message || 'Failed to create assessment');
    },
  });

  const handleSelectType = (typeId: string) => {
    setFormData({ ...formData, assessment_type: typeId });
    setModalStep('details');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMutationError('');
    const payload: Record<string, unknown> = {
      vendor_id: Number(formData.vendor_id),
      assessment_type: formData.assessment_type,
    };
    if (formData.due_date) payload.due_date = formData.due_date;
    if (formData.assessed_by) payload.assessed_by = Number(formData.assessed_by);
    createMutation.mutate(payload);
  };

  const openModal = () => {
    setShowModal(true);
    setModalStep('select_type');
    setFormData({ vendor_id: '', assessment_type: '', due_date: '', assessed_by: '' });
    setMutationError('');
  };

  const uniqueVendors = useMemo(() => {
    if (!assessments) return [];
    const map = new Map<number, string>();
    assessments.forEach((a) => { if (a.vendor_id && a.vendor_name) map.set(a.vendor_id, a.vendor_name); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assessments]);

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
          <h1 className="text-2xl font-semibold text-gray-900">Vendor Assessments</h1>
          <p className="text-sm text-gray-500 mt-1">Track and manage third-party risk assessments</p>
        </div>
        <button
          onClick={openModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Assessment
        </button>
      </div>

      {/* Stat Cards */}
      {assessments && assessments.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">Total</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{assessments.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">In Progress</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{assessments.filter((a) => a.status === 'in_progress' || a.status === 'draft').length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">Approved</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{assessments.filter((a) => a.status === 'approved').length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase font-medium">High/Critical Risk</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{assessments.filter((a) => a.risk_rating === 'high' || a.risk_rating === 'critical').length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by vendor or assessor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Types</option>
          {ASSESSMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Vendors</option>
          {[...uniqueVendors, ...(vendors ?? []).filter((v) => !uniqueVendors.some((uv) => uv.id === v.id))].map((v) => (
            <option key={v.id} value={String(v.id)}>{v.name}</option>
          ))}
        </select>
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
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-500">
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
                    <tr key={a.id} className={`hover:bg-gray-50 cursor-pointer ${selectedAssessment?.id === a.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`} onClick={() => router.push(`/vendor-risk/assessments/${a.id}`)}>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">#{a.id}</td>
                      <td className="px-4 py-3">
                        <Link href={`/vendor-risk/vendors/${a.vendor_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                          {a.vendor_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{typeInfo?.label || a.assessment_type?.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(a.status)}`}>
                          {a.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {a.risk_rating ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getRiskBadge(a.risk_rating)}`}>
                            {a.risk_rating}
                          </span>
                        ) : <span className="text-sm text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {a.inherent_score != null ? a.inherent_score.toFixed(1) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{a.due_date ? new Date(a.due_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{assessorName ?? '-'}</td>
                    </tr>
                  );
                })
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
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {modalStep === 'select_type' ? 'Select Assessment Type' : 'Assessment Details'}
                </h2>
                {modalStep === 'select_type' && (
                  <p className="text-sm text-gray-500 mt-0.5">Choose the type of risk assessment to perform</p>
                )}
                {modalStep === 'details' && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    {ASSESSMENT_TYPE_MAP[formData.assessment_type]?.label}
                  </p>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            {/* Step 1: Assessment Type Selection */}
            {modalStep === 'select_type' && (
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
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

            {/* Step 2: Details Form */}
            {modalStep === 'details' && (
              <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
                <div className="grid flex-1 gap-5 overflow-y-auto p-6 md:grid-cols-2">
                {/* Selected type summary */}
                {formData.assessment_type && ASSESSMENT_TYPE_MAP[formData.assessment_type] && (
                  <div className={`flex items-center gap-3 p-3 rounded-lg border md:col-span-2 ${ASSESSMENT_TYPE_MAP[formData.assessment_type].color}`}>
                    {(() => { const Icon = ASSESSMENT_TYPE_MAP[formData.assessment_type].icon; return <Icon className="h-5 w-5" />; })()}
                    <div>
                      <span className="text-sm font-medium text-gray-900">{ASSESSMENT_TYPE_MAP[formData.assessment_type].label}</span>
                      <p className="text-xs text-gray-500">{ASSESSMENT_TYPE_MAP[formData.assessment_type].description}</p>
                    </div>
                    <button type="button" onClick={() => setModalStep('select_type')} className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-medium">
                      Change
                    </button>
                  </div>
                )}

                {/* Vendor */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={formData.vendor_id}
                    onChange={(e) => setFormData({ ...formData, vendor_id: e.target.value })}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select vendor...</option>
                    {[...uniqueVendors, ...(vendors ?? []).filter((v) => !uniqueVendors.some((uv) => uv.id === v.id))].map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  {(vendors ?? []).length === 0 && uniqueVendors.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">No vendors found. Add a vendor first in Vendor Risk to create an assessment.</p>
                  )}
                </div>

                {/* Assessor from user directory */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assign Assessor</label>
                  <select
                    value={formData.assessed_by}
                    onChange={(e) => setFormData({ ...formData, assessed_by: e.target.value })}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Current user (default)</option>
                    {(users ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name || u.username}{u.department ? ` — ${u.department}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Select from your company user directory</p>
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Error */}
                {mutationError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 md:col-span-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {mutationError}
                  </div>
                )}
                </div>

                {/* Actions */}
                <div className="flex justify-between items-center border-t border-gray-200 p-6 pt-4">
                  <button type="button" onClick={() => setModalStep('select_type')} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">
                    &larr; Back
                  </button>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createMutation.isPending || !formData.vendor_id}
                      className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Create Assessment
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
