'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  RiskIncident,
  RiskIncidentCreate,
  Risk,
  IncidentSeverity,
  IncidentStatus,
} from '@/types';
import {
  AlertTriangle,
  Loader2,
  Plus,
  X,
  Edit2,
  Trash2,
  DollarSign,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';

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

export default function IncidentsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIncident, setEditingIncident] = useState<RiskIncident | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['erm-incidents', severityFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (severityFilter !== 'all') params.severity = severityFilter;
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      const response = await ermApi.incidents.getAll(params);
      return response.data;
    },
  });

  const { data: incidentDashboard } = useQuery({
    queryKey: ['erm-incident-dashboard'],
    queryFn: async () => {
      const response = await ermApi.incidents.getDashboard();
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
    mutationFn: (id: number) => ermApi.incidents.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['erm-incident-dashboard'] });
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
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{incidentDashboard?.open_incidents || 0}</p>
              <p className="text-sm text-slate-400">Open Incidents</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{incidentDashboard?.investigating || 0}</p>
              <p className="text-sm text-slate-400">Investigating</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{incidentDashboard?.resolved_this_month || 0}</p>
              <p className="text-sm text-slate-400">Resolved (Month)</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <DollarSign className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                ${((incidentDashboard?.total_financial_impact || 0) / 1000).toFixed(0)}K
              </p>
              <p className="text-sm text-slate-400">Total Impact</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
          >
            <option value="all">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
          >
            <option value="all">All Statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Report Incident
        </button>
      </div>

      {incidents && incidents.length > 0 ? (
        <div className="space-y-3">
          {incidents.map((incident) => {
            const severityStyle = SEVERITIES.find((s) => s.value === incident.severity);
            const statusStyle = INCIDENT_STATUSES.find((s) => s.value === incident.status);
            
            return (
              <div
                key={incident.id}
                className="rounded-xl border border-slate-700 bg-slate-800 p-4 hover:border-slate-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-white">{incident.title}</h3>
                    <p className="mt-1 text-sm text-slate-400 line-clamp-2">{incident.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyle?.color || ''}`}>
                        {incident.severity}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle?.color || ''}`}>
                        {incident.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(incident.incident_date).toLocaleDateString()}
                      </span>
                      {incident.financial_impact && (
                        <span className="flex items-center gap-1 text-xs text-orange-400">
                          <DollarSign className="h-3 w-3" />
                          {incident.financial_impact.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-4 flex gap-1">
                    <button
                      onClick={() => setEditingIncident(incident)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this incident?')) {
                          deleteMutation.mutate(incident.id);
                        }
                      }}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-700 bg-slate-800">
          <AlertCircle className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-white">No incidents found</h3>
          <p className="mt-1 text-slate-400">Report incidents as they occur to track and resolve them</p>
        </div>
      )}

      {(showCreateModal || editingIncident) && (
        <IncidentModal
          incident={editingIncident}
          risks={risks || []}
          onClose={() => {
            setShowCreateModal(false);
            setEditingIncident(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingIncident(null);
            queryClient.invalidateQueries({ queryKey: ['erm-incidents'] });
            queryClient.invalidateQueries({ queryKey: ['erm-incident-dashboard'] });
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
  incident: RiskIncident | null;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskIncidentCreate>>({
    risk_id: incident?.risk_id || (risks[0]?.id || 0),
    title: incident?.title || '',
    description: incident?.description || '',
    incident_date: incident?.incident_date?.split('T')[0] || new Date().toISOString().split('T')[0],
    severity: incident?.severity || 'medium',
    financial_impact: incident?.financial_impact,
    root_cause: incident?.root_cause || '',
    corrective_actions: incident?.corrective_actions || '',
  });
  const [status, setStatus] = useState<IncidentStatus>(incident?.status || 'open');

  const createMutation = useMutation({
    mutationFn: (data: RiskIncidentCreate) => ermApi.incidents.create(data),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskIncidentCreate & { status: IncidentStatus }> }) =>
      ermApi.incidents.update(data.id, data.updates),
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
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-slate-800 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{incident ? 'Edit Incident' : 'Report Incident'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
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
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Related Risk</label>
              <select
                value={formData.risk_id}
                onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
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
              <label className="block text-sm text-slate-400">Incident Date</label>
              <input
                type="date"
                value={formData.incident_date}
                onChange={(e) => setFormData({ ...formData, incident_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
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
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
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
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
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
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400">Root Cause</label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400">Corrective Actions</label>
            <textarea
              value={formData.corrective_actions}
              onChange={(e) => setFormData({ ...formData, corrective_actions: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
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
