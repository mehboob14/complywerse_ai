'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { vendorRiskApi, tenantApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Building2,
  Shield,
  Edit2,
  Plus,
  Calendar,
  Mail,
  User,
  Globe,
  Database,
  Phone,
  DollarSign,
} from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';

interface Vendor {
  id: number;
  name: string;
  description: string | null;
  tier: string;
  status: string;
  vendor_type: string | null;
  industry: string | null;
  website: string | null;
  inherent_risk_score: number | null;
  residual_risk_score: number | null;
  risk_rating: string | null;
  data_access_level: string;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  services_provided: string[] | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_value: number | null;
  owner: { id: number; full_name: string; email: string } | null;
  owner_id: number | null;
  notes: string | null;
  assessments_count: number;
  incidents_count: number;
  sla_records_count: number;
  created_at: string;
  updated_at: string;
}

interface Assessment {
  id: number;
  assessment_type: string;
  status: string;
  inherent_score: number | null;
  residual_score: number | null;
  risk_rating: string | null;
  due_date: string | null;
  assessor: { id: number; full_name: string } | string | null;
  created_at: string;
}

interface SLARecord {
  id: number;
  sla_metric: string;
  target_value: number | null;
  actual_value: number | null;
  measurement_period: string;
  is_compliant: boolean;
  notes: string | null;
  recorded_at: string;
}

interface Incident {
  id: number;
  title: string;
  severity: string;
  status: string;
  description: string | null;
  occurred_at: string;
  resolved_at: string | null;
  created_at: string;
}

interface UserOption {
  id: number;
  username: string;
  display_name: string | null;
  email: string;
}

const titleCase = (s: string) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const getTierBadge = (tier: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-600 text-white border border-red-700',
    high: 'bg-orange-600 text-white border border-orange-700',
    medium: 'bg-yellow-600 text-white border border-yellow-700',
    low: 'bg-green-600 text-white border border-green-700',
  };
  return styles[tier?.toLowerCase()] || 'bg-gray-600 text-white border border-gray-700';
};

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    active: 'bg-green-600 text-white border border-green-700',
    under_review: 'bg-blue-600 text-white border border-blue-700',
    onboarding: 'bg-purple-600 text-white border border-purple-700',
    offboarded: 'bg-gray-600 text-white border border-gray-700',
    suspended: 'bg-red-600 text-white border border-red-700',
    completed: 'bg-green-600 text-white border border-green-700',
    approved: 'bg-green-600 text-white border border-green-700',
    reviewed: 'bg-indigo-600 text-white border border-indigo-700',
    submitted: 'bg-yellow-600 text-white border border-yellow-700',
    in_progress: 'bg-blue-600 text-white border border-blue-700',
    draft: 'bg-gray-600 text-white border border-gray-700',
    open: 'bg-red-600 text-white border border-red-700',
    investigating: 'bg-orange-600 text-white border border-orange-700',
    resolved: 'bg-green-600 text-white border border-green-700',
    closed: 'bg-gray-600 text-white border border-gray-700',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-600 text-white border border-gray-700';
};

const getSeverityBadge = (severity: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-600 text-white border border-red-700',
    high: 'bg-orange-600 text-white border border-orange-700',
    medium: 'bg-yellow-600 text-white border border-yellow-700',
    low: 'bg-green-600 text-white border border-green-700',
  };
  return styles[severity?.toLowerCase()] || 'bg-gray-600 text-white border border-gray-700';
};

type TabType = 'overview' | 'assessments' | 'sla' | 'incidents';

const TIER_OPTIONS = ['critical', 'high', 'medium', 'low'];
const STATUS_OPTIONS = ['active', 'under_review', 'onboarding', 'offboarded', 'suspended'];
const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'];
const ASSESSMENT_TYPES = [
  { id: 'cybersecurity', label: 'Cybersecurity Assessment' },
  { id: 'privacy_data_protection', label: 'Privacy & Data Protection' },
  { id: 'operational_risk', label: 'Operational Risk Assessment' },
  { id: 'compliance_regulatory', label: 'Compliance & Regulatory' },
  { id: 'financial_risk', label: 'Financial Risk Assessment' },
  { id: 'initial_onboarding', label: 'Initial Onboarding Assessment' },
  { id: 'periodic_review', label: 'Periodic Review' },
];

export default function VendorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const vendorId = Number(params.id);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
  const canCreate = hasPermission('vendor_risk:vendors:create');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssessmentModal, setShowAssessmentModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [assessmentForm, setAssessmentForm] = useState({ assessment_type: 'cybersecurity', due_date: '', assessed_by: '' });
  const [incidentForm, setIncidentForm] = useState({ title: '', severity: 'medium', description: '', occurred_at: '' });

  const { data: vendor, isLoading } = useQuery({
    queryKey: ['vendor', vendorId],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendor(vendorId);
      return res.data as Vendor;
    },
    enabled: !!vendorId,
  });

  const { data: users } = useQuery({
    queryKey: ['tenant-users'],
    queryFn: async () => {
      const res = await tenantApi.getTenantUsers();
      return (res.data ?? []) as UserOption[];
    },
  });

  const { data: assessments } = useQuery({
    queryKey: ['vendor-assessments', vendorId],
    queryFn: async () => {
      const res = await vendorRiskApi.getAssessments({ vendor_id: vendorId });
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as Assessment[];
    },
    enabled: activeTab === 'assessments' || showAssessmentModal,
    placeholderData: keepPreviousData,
  });

  const { data: slaRecords } = useQuery({
    queryKey: ['vendor-sla', vendorId],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendorSLA(vendorId);
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as SLARecord[];
    },
    enabled: activeTab === 'sla',
    placeholderData: keepPreviousData,
  });

  const { data: incidents } = useQuery({
    queryKey: ['vendor-incidents', vendorId],
    queryFn: async () => {
      const res = await vendorRiskApi.getVendorIncidents(vendorId);
      const data = res.data;
      return (Array.isArray(data) ? data : data.items ?? []) as Incident[];
    },
    enabled: activeTab === 'incidents' || showIncidentModal,
    placeholderData: keepPreviousData,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.updateVendor(vendorId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor', vendorId] });
      setShowEditModal(false);
    },
  });

  const createAssessmentMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.createAssessment({ ...data, vendor_id: vendorId });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-assessments', vendorId] });
      setShowAssessmentModal(false);
      setAssessmentForm({ assessment_type: 'cybersecurity', due_date: '', assessed_by: '' });
    },
  });

  const createIncidentMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.createVendorIncident(vendorId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-incidents', vendorId] });
      setShowIncidentModal(false);
      setIncidentForm({ title: '', severity: 'medium', description: '', occurred_at: '' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p>Vendor not found</p>
        <Link href="/vendor-risk/vendors" className="text-blue-600 hover:underline mt-2 text-sm">Back to list</Link>
      </div>
    );
  }

  const ownerName = vendor.owner ? (typeof vendor.owner === 'object' ? vendor.owner.full_name : String(vendor.owner)) : null;

  const tabs: { key: TabType; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'assessments', label: 'Assessments', count: vendor.assessments_count },
    { key: 'sla', label: 'SLA Tracking', count: vendor.sla_records_count },
    { key: 'incidents', label: 'Incidents', count: vendor.incidents_count },
  ];

  const tierItems = TIER_OPTIONS.map((t) => ({ value: t, label: titleCase(t) }));
  const statusItems = STATUS_OPTIONS.map((s) => ({ value: s, label: titleCase(s) }));
  const severityItems = SEVERITY_OPTIONS.map((s) => ({ value: s, label: titleCase(s) }));
  const assessmentTypeItems = ASSESSMENT_TYPES.map((t) => ({ value: t.id, label: t.label }));
  const userItems = (users ?? []).map((u) => ({
    value: String(u.id),
    label: u.display_name || u.username,
    subLabel: u.email,
  }));

  const inputClass =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const labelClass = 'block text-sm font-medium text-gray-800 mb-1';

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/vendor-risk/vendors')} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">{vendor.name}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getTierBadge(vendor.tier)}`}>
              {vendor.tier}
            </span>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(vendor.status)}`}>
              {vendor.status?.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            {vendor.risk_rating && (
              <span className="text-sm text-gray-500">Risk: <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getTierBadge(vendor.risk_rating)}`}>{vendor.risk_rating}</span></span>
            )}
            {vendor.inherent_risk_score != null && (
              <span className="text-sm text-gray-500">Inherent: <span className="font-semibold">{vendor.inherent_risk_score.toFixed(1)}</span></span>
            )}
            {vendor.residual_risk_score != null && (
              <span className="text-sm text-gray-500">Residual: <span className="font-semibold">{vendor.residual_risk_score.toFixed(1)}</span></span>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setEditData({
                name: vendor.name || '',
                description: vendor.description || '',
                tier: vendor.tier || 'medium',
                status: vendor.status || 'active',
                data_access_level: vendor.data_access_level || 'internal',
                primary_contact_name: vendor.primary_contact_name || '',
                primary_contact_email: vendor.primary_contact_email || '',
                primary_contact_phone: vendor.primary_contact_phone || '',
                website: vendor.website || '',
                owner_id: vendor.owner_id ? String(vendor.owner_id) : '',
                notes: vendor.notes || '',
              });
              setShowEditModal(true);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <Edit2 className="h-4 w-4" />
            Edit
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{tab.count}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Contact Information</h3>
            {[
              { icon: User, label: 'Contact', value: vendor.primary_contact_name },
              { icon: Mail, label: 'Email', value: vendor.primary_contact_email },
              { icon: Phone, label: 'Phone', value: vendor.primary_contact_phone },
              { icon: Globe, label: 'Website', value: vendor.website },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-500 w-20">{label}</span>
                <span className="text-sm text-gray-900">{value || '-'}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Contract & Details</h3>
            {[
              { icon: Calendar, label: 'Start', value: vendor.contract_start_date ? new Date(vendor.contract_start_date).toLocaleDateString() : '-' },
              { icon: Calendar, label: 'End', value: vendor.contract_end_date ? new Date(vendor.contract_end_date).toLocaleDateString() : '-' },
              { icon: DollarSign, label: 'Value', value: vendor.contract_value != null ? `$${vendor.contract_value.toLocaleString()}` : '-' },
              { icon: Database, label: 'Data Access', value: vendor.data_access_level?.replace(/_/g, ' ') },
              { icon: User, label: 'Owner', value: ownerName },
              { icon: Building2, label: 'Type', value: vendor.vendor_type },
              { icon: Shield, label: 'Industry', value: vendor.industry },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-500 w-20">{label}</span>
                <span className="text-sm text-gray-900 capitalize">{value || '-'}</span>
              </div>
            ))}
          </div>
          {vendor.description && (
            <div className="col-span-full bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Description</h3>
              <p className="text-sm text-gray-600">{vendor.description}</p>
            </div>
          )}
          {vendor.services_provided && vendor.services_provided.length > 0 && (
            <div className="col-span-full bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Services Provided</h3>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(vendor.services_provided) ? vendor.services_provided : [vendor.services_provided]).map((s, i) => (
                  <span key={i} className="inline-flex px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                    {String(s)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {vendor.notes && (
            <div className="col-span-full bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Notes</h3>
              <p className="text-sm text-gray-600">{vendor.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Assessments Tab */}
      {activeTab === 'assessments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canCreate && (
              <button
                onClick={() => setShowAssessmentModal(true)}
                className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                New Assessment
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden p-3 sm:p-4">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rating</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assessor</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(assessments ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">No assessments found</td></tr>
                ) : (
                  (assessments ?? []).map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => router.push(`/vendor-risk/assessments/${a.id}?tab=questionnaire`)}
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 capitalize">{a.assessment_type?.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(a.status)}`}>
                          {a.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.inherent_score?.toFixed(1) ?? '-'}</td>
                      <td className="px-4 py-3">
                        {a.risk_rating ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getTierBadge(a.risk_rating)}`}>
                            {a.risk_rating}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {typeof a.assessor === 'object' && a.assessor ? a.assessor.full_name : (a.assessor ? String(a.assessor) : '-')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{a.due_date ? new Date(a.due_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/vendor-risk/assessments/${a.id}?tab=questionnaire`);
                          }}
                          className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100"
                        >
                          View Linked Questions
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SLA Tab */}
      {activeTab === 'sla' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden p-3 sm:p-4">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Metric</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actual</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Compliant</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(slaRecords ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">No SLA records found</td></tr>
              ) : (
                (slaRecords ?? []).map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.sla_metric}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.target_value ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.actual_value ?? '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s.is_compliant ? 'bg-green-600 text-white border border-green-700' : 'bg-red-600 text-white border border-red-700'}`}>
                        {s.is_compliant ? 'Met' : 'Missed'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 capitalize">{s.measurement_period}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{s.recorded_at ? new Date(s.recorded_at).toLocaleDateString() : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Incidents Tab */}
      {activeTab === 'incidents' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canCreate && (
              <button
                onClick={() => setShowIncidentModal(true)}
                className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Record Incident
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden p-3 sm:p-4">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Occurred</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resolved</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {(incidents ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">No incidents recorded</td></tr>
                ) : (
                  (incidents ?? []).map((inc) => (
                    <tr key={inc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{inc.title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getSeverityBadge(inc.severity)}`}>
                          {inc.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${getStatusBadge(inc.status)}`}>
                          {inc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{inc.occurred_at ? new Date(inc.occurred_at).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{inc.resolved_at ? new Date(inc.resolved_at).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <RightSlidePanel
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Vendor"
        width="w-full max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="vendor-edit-form"
              disabled={updateMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        }
      >
        <form
          id="vendor-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            const payload: Record<string, unknown> = { ...editData };
            if (editData.owner_id) payload.owner_id = Number(editData.owner_id);
            else delete payload.owner_id;
            updateMutation.mutate(payload);
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Name</label>
              <input type="text" value={editData.name || ''} onChange={(e) => setEditData({ ...editData, name: e.target.value })} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea value={editData.description || ''} onChange={(e) => setEditData({ ...editData, description: e.target.value })} className={inputClass} rows={2} />
            </div>
            <div>
              <label className={labelClass}>Tier</label>
              <MultiSelectDropdown
                title="Tier"
                items={tierItems}
                selectedValues={editData.tier ? [editData.tier] : []}
                onApply={(v) => setEditData({ ...editData, tier: v[0] || 'medium' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select tier"
                size="md"
              />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <MultiSelectDropdown
                title="Status"
                items={statusItems}
                selectedValues={editData.status ? [editData.status] : []}
                onApply={(v) => setEditData({ ...editData, status: v[0] || 'active' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select status"
                size="md"
              />
            </div>
            <div>
              <label className={labelClass}>Contact Name</label>
              <input type="text" value={editData.primary_contact_name || ''} onChange={(e) => setEditData({ ...editData, primary_contact_name: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Contact Email</label>
              <input type="email" value={editData.primary_contact_email || ''} onChange={(e) => setEditData({ ...editData, primary_contact_email: e.target.value })} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Owner</label>
              <MultiSelectDropdown
                title="Owner"
                items={userItems}
                selectedValues={editData.owner_id ? [String(editData.owner_id)] : []}
                onApply={(v) => setEditData({ ...editData, owner_id: v[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select owner"
                size="md"
                forceSearch
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea value={editData.notes || ''} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} className={inputClass} rows={2} />
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* Assessment Modal */}
      <RightSlidePanel
        isOpen={showAssessmentModal}
        onClose={() => setShowAssessmentModal(false)}
        title="New Assessment"
        width="w-full max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAssessmentModal(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="vendor-assessment-form"
              disabled={createAssessmentMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {createAssessmentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Create'
              )}
            </button>
          </div>
        }
      >
        <form
          id="vendor-assessment-form"
          onSubmit={(e) => {
            e.preventDefault();
            const payload: Record<string, unknown> = { assessment_type: assessmentForm.assessment_type };
            if (assessmentForm.due_date) payload.due_date = assessmentForm.due_date;
            if (assessmentForm.assessed_by) payload.assessed_by = Number(assessmentForm.assessed_by);
            createAssessmentMutation.mutate(payload);
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Assessment Type</label>
              <MultiSelectDropdown
                title="Assessment Type"
                items={assessmentTypeItems}
                selectedValues={assessmentForm.assessment_type ? [assessmentForm.assessment_type] : []}
                onApply={(v) => setAssessmentForm({ ...assessmentForm, assessment_type: v[0] || 'cybersecurity' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select type"
                size="md"
              />
            </div>
            <div>
              <label className={labelClass}>Due Date</label>
              <input type="date" value={assessmentForm.due_date} onChange={(e) => setAssessmentForm({ ...assessmentForm, due_date: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Assign Assessor</label>
              <MultiSelectDropdown
                title="Assessor"
                items={userItems}
                selectedValues={assessmentForm.assessed_by ? [String(assessmentForm.assessed_by)] : []}
                onApply={(v) => setAssessmentForm({ ...assessmentForm, assessed_by: v[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Current user (default)"
                size="md"
                forceSearch
              />
            </div>
          </div>
        </form>
      </RightSlidePanel>

      {/* Incident Modal */}
      <RightSlidePanel
        isOpen={showIncidentModal}
        onClose={() => setShowIncidentModal(false)}
        title="Record Incident"
        width="w-full max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowIncidentModal(false)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="vendor-incident-form"
              disabled={createIncidentMutation.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {createIncidentMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Record'
              )}
            </button>
          </div>
        }
      >
        <form
          id="vendor-incident-form"
          onSubmit={(e) => { e.preventDefault(); createIncidentMutation.mutate(incidentForm); }}
          className="space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Title *</label>
              <input type="text" required value={incidentForm.title} onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Severity</label>
              <MultiSelectDropdown
                title="Severity"
                items={severityItems}
                selectedValues={incidentForm.severity ? [incidentForm.severity] : []}
                onApply={(v) => setIncidentForm({ ...incidentForm, severity: v[0] || 'medium' })}
                multiSelect={false}
                triggerVariant="input"
                placeholder="Select severity"
                size="md"
              />
            </div>
            <div>
              <label className={labelClass}>Occurred At</label>
              <input type="datetime-local" value={incidentForm.occurred_at} onChange={(e) => setIncidentForm({ ...incidentForm, occurred_at: e.target.value })} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea value={incidentForm.description} onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })} className={inputClass} rows={3} />
            </div>
          </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}
