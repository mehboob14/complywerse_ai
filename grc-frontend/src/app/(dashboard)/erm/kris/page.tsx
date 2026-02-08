'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  RiskKRI,
  RiskKRICreate,
  Risk,
  KRIMetricType,
  KRIFrequency,
  KRIThresholdDirection,
} from '@/types';
import {
  Activity,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
  Edit2,
  Trash2,
} from 'lucide-react';

const KRI_STATUS_COLORS = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  unknown: 'bg-slate-500',
};

export default function KRIsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMeasureModal, setShowMeasureModal] = useState<RiskKRI | null>(null);
  const [editingKRI, setEditingKRI] = useState<RiskKRI | null>(null);
  const queryClient = useQueryClient();

  const { data: kris, isLoading } = useQuery({
    queryKey: ['erm-kris'],
    queryFn: async () => {
      const response = await ermApi.kris.getAll();
      return response.data;
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ['erm-kri-alerts'],
    queryFn: async () => {
      const response = await ermApi.kris.getAlerts();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.kris.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
      queryClient.invalidateQueries({ queryKey: ['erm-kri-alerts'] });
    },
  });

  const alertCount = alerts?.length || 0;
  const redAlerts = alerts?.filter(k => k.current_status === 'red').length || 0;
  const amberAlerts = alerts?.filter(k => k.current_status === 'amber').length || 0;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-black">Key Risk Indicators</h2>
            <p className="text-sm text-slate-600">Monitor and track risk metrics</p>
          </div>
          {alertCount > 0 && (
            <div className="flex items-center gap-2">
              {redAlerts > 0 && (
                <span className="rounded-full bg-red-50 px-3 py-1 text-sm text-red-600">
                  {redAlerts} Critical
                </span>
              )}
              {amberAlerts > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-600">
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
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <Activity className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-black">No KRIs defined</h3>
          <p className="mt-1 text-slate-600">Create Key Risk Indicators to monitor risk metrics</p>
        </div>
      )}

      {showCreateModal && (
        <KRIModal
          risks={risks || []}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
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
            queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
          }}
        />
      )}

      {showMeasureModal && (
        <MeasureKRIModal
          kri={showMeasureModal}
          onClose={() => setShowMeasureModal(null)}
          onSuccess={() => {
            setShowMeasureModal(null);
            queryClient.invalidateQueries({ queryKey: ['erm-kris'] });
            queryClient.invalidateQueries({ queryKey: ['erm-kri-alerts'] });
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${statusColor}`} />
          <div>
            <h3 className="font-medium text-black">{kri.name}</h3>
            <p className="text-sm text-slate-600">{kri.frequency} measurement</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1.5 text-slate-600 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold text-black">
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
            <div className={`flex items-center gap-1 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span className="text-sm">{Math.abs(trend).toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-slate-600">≤{kri.green_threshold}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs text-slate-600">≤{kri.amber_threshold}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-xs text-slate-600">&gt;{kri.amber_threshold}</span>
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
    mutationFn: (data: RiskKRICreate) => ermApi.kris.create(data),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskKRICreate> }) =>
      ermApi.kris.update(data.id, data.updates),
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
          <h2 className="text-lg font-semibold text-black">{kri ? 'Edit KRI' : 'Create KRI'}</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Risk</label>
            <select
              value={formData.risk_id}
              onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
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
            <label className="block text-sm text-slate-600">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Metric Type</label>
              <select
                value={formData.metric_type}
                onChange={(e) => setFormData({ ...formData, metric_type: e.target.value as KRIMetricType })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              >
                <option value="percentage">Percentage</option>
                <option value="count">Count</option>
                <option value="currency">Currency</option>
                <option value="ratio">Ratio</option>
                <option value="score">Score</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Unit</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Green Threshold</label>
              <input
                type="number"
                value={formData.green_threshold}
                onChange={(e) => setFormData({ ...formData, green_threshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Amber Threshold</label>
              <input
                type="number"
                value={formData.amber_threshold}
                onChange={(e) => setFormData({ ...formData, amber_threshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Direction</label>
              <select
                value={formData.threshold_direction}
                onChange={(e) => setFormData({ ...formData, threshold_direction: e.target.value as KRIThresholdDirection })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
              >
                <option value="higher_is_better">Higher is Better</option>
                <option value="lower_is_better">Lower is Better</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Frequency</label>
              <select
                value={formData.frequency}
                onChange={(e) => setFormData({ ...formData, frequency: e.target.value as KRIFrequency })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
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
    mutationFn: (data: { value: number; notes?: string }) => ermApi.kris.measure(kri.id, data),
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
          <h2 className="text-lg font-semibold text-black">Record Measurement</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-slate-600">{kri.name}</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Value</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
                required
              />
              {kri.unit && <span className="text-slate-600">{kri.unit}</span>}
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black"
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
