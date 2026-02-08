'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { advancedErmApi, risksApi } from '@/lib/api';
import {
  RiskKRI,
  RiskKRICreate,
  RiskKRIMeasurement,
  RiskIncident,
  RiskIncidentCreate,
  RiskReview,
  RiskReviewCreate,
  RiskDependency,
  RiskDependencyCreate,
  Risk,
  IncidentSeverity,
  IncidentStatus,
  KRIMetricType,
  KRIFrequency,
  KRIThresholdDirection,
  ReviewCycle,
  ReviewType,
  DependencyType,
  ReportType,
} from '@/types';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  GitBranch,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  DollarSign,
  ArrowRight,
  Download,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';

type TabType = 'kris' | 'incidents' | 'reviews' | 'dependencies' | 'reports';

const TABS: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'kris', label: 'KRIs', icon: Activity },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'reviews', label: 'Reviews', icon: Calendar },
  { id: 'dependencies', label: 'Dependencies', icon: GitBranch },
  { id: 'reports', label: 'Reports', icon: FileText },
];

const SEVERITIES: { value: IncidentSeverity; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-green-500/20 text-green-400' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'high', label: 'High', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'critical', label: 'Critical', color: 'bg-red-500/20 text-red-400' },
];

const INCIDENT_STATUSES: { value: IncidentStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-red-500/20 text-red-400' },
  { value: 'investigating', label: 'Investigating', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'mitigating', label: 'Mitigating', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-500/20 text-green-400' },
  { value: 'closed', label: 'Closed', color: 'bg-slate-500/20 text-slate-400' },
];

const KRI_STATUS_COLORS = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  unknown: 'bg-slate-500',
};

const REVIEW_STATUS_COLORS = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  skipped: 'bg-slate-500/20 text-slate-400',
  overdue: 'bg-red-500/20 text-red-400',
};

const DEPENDENCY_TYPES: { value: DependencyType; label: string; color: string }[] = [
  { value: 'causes', label: 'Causes', color: 'text-red-400' },
  { value: 'caused_by', label: 'Caused By', color: 'text-orange-400' },
  { value: 'related', label: 'Related', color: 'text-blue-400' },
  { value: 'amplifies', label: 'Amplifies', color: 'text-primary-600' },
  { value: 'mitigates', label: 'Mitigates', color: 'text-green-400' },
];

export default function AdvancedERMPage() {
  const [activeTab, setActiveTab] = useState<TabType>('kris');
  const queryClient = useQueryClient();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Advanced ERM</h1>
          <p className="text-slate-400">Enterprise Risk Management - KRIs, Incidents, Reviews & Reports</p>
        </div>
        <Link
          href="/risks"
          className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-600"
        >
          Back to Risk Register
        </Link>
      </div>

      <div className="flex space-x-1 rounded-xl bg-white p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-primary-600 text-white'
                : 'text-slate-400 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-white p-6">
        {activeTab === 'kris' && <KRIsTab />}
        {activeTab === 'incidents' && <IncidentsTab />}
        {activeTab === 'reviews' && <ReviewsTab />}
        {activeTab === 'dependencies' && <DependenciesTab />}
        {activeTab === 'reports' && <ReportsTab />}
      </div>
    </div>
  );
}

function KRIsTab() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMeasureModal, setShowMeasureModal] = useState<RiskKRI | null>(null);
  const [editingKRI, setEditingKRI] = useState<RiskKRI | null>(null);
  const queryClient = useQueryClient();

  const { data: kris, isLoading } = useQuery({
    queryKey: ['kris'],
    queryFn: async () => {
      const response = await advancedErmApi.getKRIs();
      return response.data;
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ['kri-alerts'],
    queryFn: async () => {
      const response = await advancedErmApi.getKRIAlerts();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => advancedErmApi.deleteKRI(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kris'] });
      queryClient.invalidateQueries({ queryKey: ['kri-alerts'] });
    },
  });

  const alertCount = alerts?.length || 0;
  const redAlerts = alerts?.filter(k => k.current_status === 'red').length || 0;
  const amberAlerts = alerts?.filter(k => k.current_status === 'amber').length || 0;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-slate-800">Key Risk Indicators</h2>
          {alertCount > 0 && (
            <div className="flex items-center gap-2">
              {redAlerts > 0 && (
                <span className="rounded-full bg-red-500/20 px-3 py-1 text-sm text-red-400">
                  {redAlerts} Critical
                </span>
              )}
              {amberAlerts > 0 && (
                <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm text-amber-400">
                  {amberAlerts} Warning
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Add KRI
        </button>
      </div>

      {kris && kris.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {kris.map((kri) => (
            <KRICard
              key={kri.id}
              kri={kri}
              onMeasure={() => setShowMeasureModal(kri)}
              onEdit={() => setEditingKRI(kri)}
              onDelete={() => {
                if (confirm('Are you sure you want to delete this KRI?')) {
                  deleteMutation.mutate(kri.id);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-800">No KRIs defined</h3>
          <p className="mt-1 text-slate-400">Create Key Risk Indicators to monitor risk metrics</p>
        </div>
      )}

      {showCreateModal && (
        <KRIModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['kris'] });
          }}
        />
      )}

      {editingKRI && (
        <KRIModal
          kri={editingKRI}
          risks={risks || []}
          onClose={() => setEditingKRI(null)}
          onSuccess={() => {
            setEditingKRI(null);
            queryClient.invalidateQueries({ queryKey: ['kris'] });
          }}
        />
      )}

      {showMeasureModal && (
        <MeasureKRIModal
          kri={showMeasureModal}
          onClose={() => setShowMeasureModal(null)}
          onSuccess={() => {
            setShowMeasureModal(null);
            queryClient.invalidateQueries({ queryKey: ['kris'] });
            queryClient.invalidateQueries({ queryKey: ['kri-alerts'] });
          }}
        />
      )}
    </div>
  );
}

function KRICard({
  kri,
  onMeasure,
  onEdit,
  onDelete,
}: {
  kri: RiskKRI;
  onMeasure: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const statusColor = KRI_STATUS_COLORS[kri.current_status || 'unknown'];
  const trend = kri.measurements && kri.measurements.length > 1
    ? kri.measurements[kri.measurements.length - 1].value - kri.measurements[kri.measurements.length - 2].value
    : 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusColor}`} />
          <div>
            <h3 className="font-medium text-slate-800">{kri.name}</h3>
            <p className="text-sm text-slate-400">{kri.frequency} measurement</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold text-slate-800">
              {kri.current_value !== undefined && kri.current_value !== null
                ? `${kri.current_value}${kri.unit || ''}`
                : '—'}
            </p>
            {kri.last_measured_at && (
              <p className="text-xs text-slate-500">
                Last measured: {new Date(kri.last_measured_at).toLocaleDateString()}
              </p>
            )}
          </div>
          {trend !== 0 && (
            <div className={`flex items-center gap-1 ${trend > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {trend > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span className="text-sm">{Math.abs(trend).toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-slate-400">≤{kri.green_threshold}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs text-slate-400">≤{kri.amber_threshold}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-xs text-slate-400">&gt;{kri.amber_threshold}</span>
          </div>
        </div>
      </div>

      <button
        onClick={onMeasure}
        className="mt-4 w-full rounded-lg bg-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-600"
      >
        Record Measurement
      </button>
    </div>
  );
}

function KRIModal({
  kri,
  risks,
  onClose,
  onSuccess,
}: {
  kri?: RiskKRI;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskKRICreate>>({
    risk_id: kri?.risk_id || (risks[0]?.id || 0),
    name: kri?.name || '',
    description: kri?.description || '',
    metric_type: kri?.metric_type || 'percentage',
    unit: kri?.unit || '%',
    green_threshold: kri?.green_threshold || 80,
    amber_threshold: kri?.amber_threshold || 50,
    threshold_direction: kri?.threshold_direction || 'higher_is_better',
    frequency: kri?.frequency || 'monthly',
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskKRICreate) => advancedErmApi.createKRI(data),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskKRICreate> }) =>
      advancedErmApi.updateKRI(data.id, data.updates),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (kri) {
      updateMutation.mutate({ id: kri.id, updates: formData });
    } else {
      createMutation.mutate(formData as RiskKRICreate);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{kri ? 'Edit KRI' : 'Create KRI'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Risk</label>
            <select
              value={formData.risk_id}
              onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Metric Type</label>
              <select
                value={formData.metric_type}
                onChange={(e) => setFormData({ ...formData, metric_type: e.target.value as KRIMetricType })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                <option value="percentage">Percentage</option>
                <option value="count">Count</option>
                <option value="currency">Currency</option>
                <option value="ratio">Ratio</option>
                <option value="score">Score</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400">Unit</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Green Threshold</label>
              <input
                type="number"
                value={formData.green_threshold}
                onChange={(e) => setFormData({ ...formData, green_threshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400">Amber Threshold</label>
              <input
                type="number"
                value={formData.amber_threshold}
                onChange={(e) => setFormData({ ...formData, amber_threshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Direction</label>
              <select
                value={formData.threshold_direction}
                onChange={(e) => setFormData({ ...formData, threshold_direction: e.target.value as KRIThresholdDirection })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                <option value="higher_is_better">Higher is Better</option>
                <option value="lower_is_better">Lower is Better</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400">Frequency</label>
              <select
                value={formData.frequency}
                onChange={(e) => setFormData({ ...formData, frequency: e.target.value as KRIFrequency })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {kri ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MeasureKRIModal({
  kri,
  onClose,
  onSuccess,
}: {
  kri: RiskKRI;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState<number>(kri.current_value || 0);
  const [notes, setNotes] = useState('');

  const measureMutation = useMutation({
    mutationFn: (data: { value: number; notes?: string }) => advancedErmApi.measureKRI(kri.id, data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    measureMutation.mutate({ value, notes: notes || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Record Measurement</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-slate-400">{kri.name}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Value</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
                required
              />
              {kri.unit && <span className="text-slate-400">{kri.unit}</span>}
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={measureMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {measureMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Record
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IncidentsTab() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIncident, setEditingIncident] = useState<RiskIncident | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', severityFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (severityFilter !== 'all') params.severity = severityFilter;
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      const response = await advancedErmApi.getIncidents(params);
      return response.data;
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['incident-dashboard'],
    queryFn: async () => {
      const response = await advancedErmApi.getIncidentDashboard();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => advancedErmApi.deleteIncident(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incident-dashboard'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-slate-200 p-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{dashboard?.total_incidents || 0}</p>
              <p className="text-xs text-slate-400">Total Incidents</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-slate-200 p-2">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{dashboard?.open_incidents || 0}</p>
              <p className="text-xs text-slate-400">Open Incidents</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-slate-200 p-2">
              <DollarSign className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">
                ${((dashboard?.total_financial_impact || 0) / 1000).toFixed(0)}K
              </p>
              <p className="text-xs text-slate-400">Financial Impact</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-slate-200 p-2">
              <Clock className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{dashboard?.avg_resolution_time_days || 0}d</p>
              <p className="text-xs text-slate-400">Avg Resolution</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-slate-800"
          >
            <option value="all">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-slate-800"
          >
            <option value="all">All Statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Log Incident
        </button>
      </div>

      {incidents && incidents.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Incident</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Severity</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Impact</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => {
                const severity = SEVERITIES.find((s) => s.value === incident.severity);
                const status = INCIDENT_STATUSES.find((s) => s.value === incident.status);
                return (
                  <tr key={incident.id} className="border-b border-slate-200 hover:bg-slate-200/30">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-800">{incident.title}</p>
                        {incident.risk_title && (
                          <p className="text-sm text-slate-400">Risk: {incident.risk_title}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${severity?.color}`}>
                        {severity?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${status?.color}`}>
                        {status?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(incident.incident_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {incident.financial_impact
                        ? `$${incident.financial_impact.toLocaleString()}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingIncident(incident)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Delete this incident?')) {
                              deleteMutation.mutate(incident.id);
                            }
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
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
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-800">No incidents logged</h3>
          <p className="mt-1 text-slate-400">Log incidents when they occur to track and analyze</p>
        </div>
      )}

      {showCreateModal && (
        <IncidentModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['incidents'] });
            queryClient.invalidateQueries({ queryKey: ['incident-dashboard'] });
          }}
        />
      )}

      {editingIncident && (
        <IncidentModal
          incident={editingIncident}
          risks={risks || []}
          onClose={() => setEditingIncident(null)}
          onSuccess={() => {
            setEditingIncident(null);
            queryClient.invalidateQueries({ queryKey: ['incidents'] });
            queryClient.invalidateQueries({ queryKey: ['incident-dashboard'] });
          }}
        />
      )}
    </div>
  );
}

function IncidentModal({
  incident,
  risks,
  onClose,
  onSuccess,
}: {
  incident?: RiskIncident;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskIncidentCreate>>({
    risk_id: incident?.risk_id || undefined,
    title: incident?.title || '',
    description: incident?.description || '',
    incident_date: incident?.incident_date?.split('T')[0] || new Date().toISOString().split('T')[0],
    severity: incident?.severity || 'medium',
    financial_impact: incident?.financial_impact || undefined,
    operational_impact: incident?.operational_impact || '',
    root_cause: incident?.root_cause || '',
    corrective_actions: incident?.corrective_actions || '',
  });
  const [status, setStatus] = useState<IncidentStatus>(incident?.status || 'open');

  const createMutation = useMutation({
    mutationFn: (data: RiskIncidentCreate) => advancedErmApi.createIncident(data),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskIncidentCreate> & { status?: IncidentStatus } }) =>
      advancedErmApi.updateIncident(data.id, { ...data.updates, status }),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (incident) {
      updateMutation.mutate({ id: incident.id, updates: { ...formData, status } });
    } else {
      createMutation.mutate(formData as RiskIncidentCreate);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{incident ? 'Edit Incident' : 'Log Incident'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Related Risk (optional)</label>
              <select
                value={formData.risk_id || ''}
                onChange={(e) => setFormData({ ...formData, risk_id: e.target.value ? Number(e.target.value) : undefined })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                <option value="">None</option>
                {risks.map((risk) => (
                  <option key={risk.id} value={risk.id}>
                    {risk.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400">Incident Date</label>
              <input
                type="date"
                value={formData.incident_date}
                onChange={(e) => setFormData({ ...formData, incident_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Severity</label>
              <select
                value={formData.severity}
                onChange={(e) => setFormData({ ...formData, severity: e.target.value as IncidentSeverity })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {incident && (
              <div>
                <label className="block text-sm text-slate-400">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as IncidentStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
                >
                  {INCIDENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm text-slate-400">Financial Impact ($)</label>
              <input
                type="number"
                value={formData.financial_impact || ''}
                onChange={(e) => setFormData({ ...formData, financial_impact: e.target.value ? Number(e.target.value) : undefined })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400">Root Cause</label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400">Corrective Actions</label>
            <textarea
              value={formData.corrective_actions}
              onChange={(e) => setFormData({ ...formData, corrective_actions: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {incident ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReviewsTab() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['reviews', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      const response = await advancedErmApi.getReviews(params);
      return response.data;
    },
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: async () => {
      const response = await advancedErmApi.getPendingReviews();
      return response.data;
    },
  });

  const { data: overdueReviews } = useQuery({
    queryKey: ['overdue-reviews'],
    queryFn: async () => {
      const response = await advancedErmApi.getOverdueReviews();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-400" />
            <div>
              <p className="text-2xl font-bold text-slate-800">{pendingReviews?.length || 0}</p>
              <p className="text-sm text-yellow-400">Pending Reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <div>
              <p className="text-2xl font-bold text-slate-800">{overdueReviews?.length || 0}</p>
              <p className="text-sm text-red-400">Overdue Reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-green-400" />
            <div>
              <p className="text-2xl font-bold text-slate-800">
                {reviews?.filter((r) => r.status === 'completed').length || 0}
              </p>
              <p className="text-sm text-green-400">Completed This Month</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-slate-800"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_review">In Review</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </select>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Schedule Review
        </button>
      </div>

      {reviews && reviews.length > 0 ? (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Calendar className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-800">No reviews scheduled</h3>
          <p className="mt-1 text-slate-400">Schedule risk reviews to maintain compliance</p>
        </div>
      )}

      {showCreateModal && (
        <ReviewModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
          }}
        />
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: RiskReview }) {
  const statusColor = REVIEW_STATUS_COLORS[review.status] || REVIEW_STATUS_COLORS.pending;
  const isOverdue = new Date(review.due_date) < new Date() && review.status !== 'completed';
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (status: string) => advancedErmApi.updateReview(review.id, { status: status as any }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['overdue-reviews'] });
    },
  });

  return (
    <div className={`rounded-lg border p-4 ${isOverdue ? 'border-red-500/50 bg-red-500/5' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-slate-800">{review.risk_title || `Risk #${review.risk_id}`}</h3>
          <div className="mt-1 flex items-center gap-3">
            <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor}`}>
              {review.status.replace('_', ' ')}
            </span>
            <span className="text-sm text-slate-400">
              {review.review_type} • {review.review_cycle}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : 'text-slate-600'}`}>
            Due: {new Date(review.due_date).toLocaleDateString()}
          </p>
          {isOverdue && <p className="text-xs text-red-400">Overdue</p>}
        </div>
      </div>

      {review.status === 'pending' && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => updateMutation.mutate('in_review')}
            disabled={updateMutation.isPending}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-500"
          >
            Start Review
          </button>
        </div>
      )}

      {review.status === 'in_review' && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => updateMutation.mutate('completed')}
            disabled={updateMutation.isPending}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-500"
          >
            Complete Review
          </button>
        </div>
      )}

      {review.findings && (
        <div className="mt-3 rounded bg-white p-3">
          <p className="text-sm text-slate-600">{review.findings}</p>
        </div>
      )}
    </div>
  );
}

function ReviewModal({
  risks,
  onClose,
  onSuccess,
}: {
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskReviewCreate>>({
    risk_id: risks[0]?.id || 0,
    review_cycle: 'quarterly',
    review_type: 'periodic',
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskReviewCreate) => advancedErmApi.createReview(data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData as RiskReviewCreate);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Schedule Review</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Risk</label>
            <select
              value={formData.risk_id}
              onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Review Cycle</label>
              <select
                value={formData.review_cycle}
                onChange={(e) => setFormData({ ...formData, review_cycle: e.target.value as ReviewCycle })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi_annual">Semi-Annual</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400">Review Type</label>
              <select
                value={formData.review_type}
                onChange={(e) => setFormData({ ...formData, review_type: e.target.value as ReviewType })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              >
                <option value="periodic">Periodic</option>
                <option value="triggered">Triggered</option>
                <option value="ad_hoc">Ad Hoc</option>
                <option value="audit">Audit</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Due Date</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Schedule
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DependenciesTab() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: dependencies, isLoading } = useQuery({
    queryKey: ['dependencies'],
    queryFn: async () => {
      const response = await advancedErmApi.getDependencies();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  const { data: cascadeAnalysis } = useQuery({
    queryKey: ['cascade-analysis', selectedRisk],
    queryFn: async () => {
      if (!selectedRisk) return null;
      const response = await advancedErmApi.getCascadeAnalysis(selectedRisk);
      return response.data;
    },
    enabled: !!selectedRisk,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => advancedErmApi.deleteDependency(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dependencies'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-slate-800">Risk Dependencies</h2>
          <select
            value={selectedRisk || ''}
            onChange={(e) => setSelectedRisk(e.target.value ? Number(e.target.value) : null)}
            className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">Select risk for cascade analysis</option>
            {risks?.map((risk) => (
              <option key={risk.id} value={risk.id}>
                {risk.title}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Add Dependency
        </button>
      </div>

      {cascadeAnalysis && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
          <h3 className="font-medium text-slate-800">Cascade Analysis: {cascadeAnalysis.risk_title}</h3>
          <p className="mt-1 text-sm text-slate-400">
            Total Cascade Score: <span className="font-bold text-blue-400">{cascadeAnalysis.total_cascade_score.toFixed(1)}</span>
          </p>
          
          {cascadeAnalysis.direct_impacts.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-slate-600">Direct Impacts:</p>
              <div className="mt-2 space-y-1">
                {cascadeAnalysis.direct_impacts.map((impact) => (
                  <div key={impact.id} className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-4 w-4 text-blue-400" />
                    <span className="text-slate-600">{impact.title}</span>
                    <span className="text-slate-500">({impact.type}, strength: {impact.strength})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {dependencies && dependencies.length > 0 ? (
        <div className="space-y-3">
          {dependencies.map((dep) => {
            const typeInfo = DEPENDENCY_TYPES.find((t) => t.value === dep.dependency_type);
            return (
              <div key={dep.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-medium text-slate-800">{dep.source_risk_title || `Risk #${dep.source_risk_id}`}</p>
                    <p className="text-xs text-slate-500">Source</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <ArrowRight className={`h-5 w-5 ${typeInfo?.color || 'text-slate-400'}`} />
                    <span className={`text-xs ${typeInfo?.color || 'text-slate-400'}`}>{typeInfo?.label}</span>
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">{dep.target_risk_title || `Risk #${dep.target_risk_id}`}</p>
                    <p className="text-xs text-slate-500">Target</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm text-slate-400">Strength</p>
                    <p className="font-medium text-slate-800">{dep.strength}/5</p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Delete this dependency?')) {
                        deleteMutation.mutate(dep.id);
                      }
                    }}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <GitBranch className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-800">No dependencies defined</h3>
          <p className="mt-1 text-slate-400">Create relationships between risks to understand cascading effects</p>
        </div>
      )}

      {showCreateModal && (
        <DependencyModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['dependencies'] });
          }}
        />
      )}
    </div>
  );
}

function DependencyModal({
  risks,
  onClose,
  onSuccess,
}: {
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskDependencyCreate>>({
    source_risk_id: risks[0]?.id || 0,
    target_risk_id: risks[1]?.id || risks[0]?.id || 0,
    dependency_type: 'related',
    strength: 3,
    description: '',
  });

  const createMutation = useMutation({
    mutationFn: (data: RiskDependencyCreate) => advancedErmApi.createDependency(data),
    onSuccess,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.source_risk_id === formData.target_risk_id) {
      alert('Source and target risks must be different');
      return;
    }
    createMutation.mutate(formData as RiskDependencyCreate);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Add Dependency</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Source Risk</label>
            <select
              value={formData.source_risk_id}
              onChange={(e) => setFormData({ ...formData, source_risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Dependency Type</label>
            <select
              value={formData.dependency_type}
              onChange={(e) => setFormData({ ...formData, dependency_type: e.target.value as DependencyType })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
            >
              {DEPENDENCY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Target Risk</label>
            <select
              value={formData.target_risk_id}
              onChange={(e) => setFormData({ ...formData, target_risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              required
            >
              {risks.map((risk) => (
                <option key={risk.id} value={risk.id}>
                  {risk.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Strength (1-5)</label>
            <input
              type="range"
              min="1"
              max="5"
              value={formData.strength}
              onChange={(e) => setFormData({ ...formData, strength: Number(e.target.value) })}
              className="mt-1 w-full"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>Weak</span>
              <span className="font-medium text-slate-800">{formData.strength}</span>
              <span>Strong</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReportsTab() {
  const [selectedReportType, setSelectedReportType] = useState<ReportType>('executive');
  const queryClient = useQueryClient();

  const { data: executiveDashboard, isLoading: loadingExec } = useQuery({
    queryKey: ['executive-dashboard'],
    queryFn: async () => {
      const response = await advancedErmApi.getExecutiveDashboard();
      return response.data;
    },
  });

  const { data: boardSummary, isLoading: loadingBoard } = useQuery({
    queryKey: ['board-summary'],
    queryFn: async () => {
      const response = await advancedErmApi.getBoardSummary();
      return response.data;
    },
  });

  const { data: aggregatedView } = useQuery({
    queryKey: ['aggregated-view'],
    queryFn: async () => {
      const response = await advancedErmApi.getAggregatedView('category');
      return response.data;
    },
  });

  const { data: appetiteBreaches } = useQuery({
    queryKey: ['appetite-breaches'],
    queryFn: async () => {
      const response = await advancedErmApi.getAppetiteBreaches();
      return response.data;
    },
  });

  const { data: trends } = useQuery({
    queryKey: ['risk-trends'],
    queryFn: async () => {
      const response = await advancedErmApi.getRiskTrends(90);
      return response.data;
    },
  });

  const generateMutation = useMutation({
    mutationFn: (data: { name: string; report_type: ReportType }) =>
      advancedErmApi.generateReport(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const isLoading = loadingExec || loadingBoard;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(['executive', 'board', 'department', 'audit'] as ReportType[]).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedReportType(type)}
            className={`rounded-lg px-4 py-2 text-sm capitalize ${
              selectedReportType === type
                ? 'bg-primary-600 text-white'
                : 'bg-slate-200 text-slate-600 hover:bg-slate-600'
            }`}
          >
            {type} Report
          </button>
        ))}
      </div>

      {selectedReportType === 'executive' && executiveDashboard && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-400">Total Risks</p>
              <p className="text-3xl font-bold text-slate-800">{executiveDashboard.summary?.total_risks || 0}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-400">Critical Risks</p>
              <p className="text-3xl font-bold text-red-400">{executiveDashboard.summary?.critical_risks || 0}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-400">Avg Risk Score</p>
              <p className="text-3xl font-bold text-slate-800">{executiveDashboard.summary?.avg_risk_score?.toFixed(1) || 0}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-400">Appetite Breaches</p>
              <p className="text-3xl font-bold text-orange-400">{executiveDashboard.summary?.risks_exceeding_appetite || 0}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="font-medium text-slate-800">Top Risks</h3>
              <div className="mt-4 space-y-3">
                {executiveDashboard.top_risks?.slice(0, 5).map((risk) => (
                  <div key={risk.id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{risk.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{risk.score}</span>
                      {risk.trend === 'up' ? (
                        <TrendingUp className="h-4 w-4 text-red-400" />
                      ) : risk.trend === 'down' ? (
                        <TrendingDown className="h-4 w-4 text-green-400" />
                      ) : null}
                    </div>
                  </div>
                )) || <p className="text-sm text-slate-500">No risks available</p>}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="font-medium text-slate-800">KRI Alerts</h3>
              <div className="mt-4 space-y-3">
                {executiveDashboard.kri_alerts?.slice(0, 5).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{alert.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      alert.status === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {alert.value} ({alert.status})
                    </span>
                  </div>
                )) || <p className="text-sm text-slate-500">No alerts</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedReportType === 'board' && boardSummary && (
        <div className="space-y-6">
          <div className="rounded-lg bg-slate-50 p-4">
            <h3 className="font-medium text-slate-800">Risk Profile Summary</h3>
            <p className="text-sm text-slate-400">Period: {boardSummary.period || 'Current Quarter'}</p>
            
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-slate-400">Total Risks</p>
                <p className="text-2xl font-bold text-slate-800">{boardSummary.risk_profile_summary?.total_risks || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">New Risks</p>
                <p className="text-2xl font-bold text-yellow-400">{boardSummary.risk_profile_summary?.new_risks || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Closed Risks</p>
                <p className="text-2xl font-bold text-green-400">{boardSummary.risk_profile_summary?.closed_risks || 0}</p>
              </div>
            </div>
          </div>

          {boardSummary.key_risk_changes && boardSummary.key_risk_changes.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-4">
              <h3 className="font-medium text-slate-800">Key Risk Changes</h3>
              <div className="mt-4 space-y-3">
                {boardSummary.key_risk_changes.map((change) => (
                  <div key={change.risk_id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{change.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">{change.previous_score}</span>
                      <ArrowRight className="h-4 w-4 text-slate-500" />
                      <span className={change.change > 0 ? 'text-red-400' : 'text-green-400'}>
                        {change.current_score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedReportType === 'department' && aggregatedView && (
        <div className="space-y-6">
          <div className="rounded-lg bg-slate-50 p-4">
            <h3 className="font-medium text-slate-800">Risk by Category</h3>
            <div className="mt-4 space-y-4">
              {aggregatedView.map((view) => (
                <div key={view.category} className="rounded-lg bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize text-slate-800">{view.category}</span>
                    <span className="text-sm text-slate-400">{view.total_count} risks</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Avg Inherent: </span>
                      <span className="text-slate-800">{view.avg_inherent_score?.toFixed(1) || 0}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Avg Residual: </span>
                      <span className="text-slate-800">{view.avg_residual_score?.toFixed(1) || 0}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedReportType === 'audit' && (
        <div className="space-y-6">
          <div className="rounded-lg bg-slate-50 p-4">
            <h3 className="font-medium text-slate-800">Appetite Breaches</h3>
            {appetiteBreaches && appetiteBreaches.length > 0 ? (
              <div className="mt-4 space-y-3">
                {appetiteBreaches.map((breach) => (
                  <div key={breach.risk_id} className="flex items-center justify-between rounded-lg bg-red-500/10 border border-red-500/30 p-3">
                    <div>
                      <p className="font-medium text-slate-800">{breach.risk_title}</p>
                      <p className="text-sm text-slate-400">{breach.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-red-400">+{breach.breach_percentage.toFixed(0)}% over appetite</p>
                      <p className="text-xs text-slate-500">{breach.days_in_breach} days in breach</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">No appetite breaches detected</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => generateMutation.mutate({ name: `Audit Export ${new Date().toISOString().split('T')[0]}`, report_type: 'audit' })}
              disabled={generateMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
            >
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export Audit Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
