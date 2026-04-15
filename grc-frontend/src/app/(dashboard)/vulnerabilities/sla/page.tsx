'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Clock,
  Loader2,
  AlertCircle,
  Save,
  Edit2,
  X,
} from 'lucide-react';

interface SLAConfig {
  id: number;
  severity: string;
  remediation_days: number;
  notification_days?: number;
  escalation_days?: number;
  created_at?: string;
  updated_at?: string;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600' },
  high: { bg: 'bg-orange-50', text: 'text-orange-600' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
  low: { bg: 'bg-blue-50', text: 'text-blue-600' },
  info: { bg: 'bg-[var(--color-subtle)]', text: 'text-[var(--color-text-secondary)]' },
};

const DEFAULT_SLA: Record<string, number> = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
  info: 365,
};

export default function SLAConfigPage() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ remediation_days: number; notification_days?: number; escalation_days?: number }>({
    remediation_days: 0,
  });
  const queryClient = useQueryClient();

  const { data: slaConfigs, isLoading, error } = useQuery({
    queryKey: ['vuln-sla'],
    queryFn: async () => {
      const response = await vulnManagementApi.sla.get();
      return response.data as SLAConfig[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      vulnManagementApi.sla.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-sla'] });
      setEditingId(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.sla.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-sla'] });
    },
  });

  const handleEdit = (config: SLAConfig) => {
    setEditingId(config.id);
    setEditValues({
      remediation_days: config.remediation_days,
      notification_days: config.notification_days,
      escalation_days: config.escalation_days,
    });
  };

  const handleSave = () => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: editValues });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditValues({ remediation_days: 0 });
  };

  const getSLAForSeverity = (severity: string): SLAConfig | undefined => {
    return slaConfigs?.find((s) => s.severity === severity);
  };

  const handleCreateDefault = (severity: string) => {
    createMutation.mutate({
      severity,
      remediation_days: DEFAULT_SLA[severity],
    });
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
        <p className="mt-2 text-red-600">Failed to load SLA configuration</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold cw-text-default">SLA Configuration</h1>
        <p className="text-xs cw-text-muted">Configure remediation SLA timeframes by severity</p>
      </div>

      <div className="cw-card overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--color-subtle)]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">
                Severity
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">
                Remediation Days
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">
                Notification Days
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">
                Escalation Days
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {SEVERITY_ORDER.map((severity) => {
              const config = getSLAForSeverity(severity);
              const style = SEVERITY_STYLES[severity];
              const isEditing = editingId === config?.id;

              return (
                <tr key={severity} className="hover:bg-[var(--color-hover)] transition-colors">
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text} capitalize`}>
                      {severity}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {config ? (
                      isEditing ? (
                        <input
                          type="number"
                          value={editValues.remediation_days}
                          onChange={(e) => setEditValues({ ...editValues, remediation_days: parseInt(e.target.value) || 0 })}
                          className="input-field w-24"
                          min="1"
                        />
                      ) : (
                        <span className="cw-text-default font-medium">{config.remediation_days} days</span>
                      )
                    ) : (
                      <span className="cw-text-muted">Not configured</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {config ? (
                      isEditing ? (
                        <input
                          type="number"
                          value={editValues.notification_days || ''}
                          onChange={(e) => setEditValues({ ...editValues, notification_days: parseInt(e.target.value) || undefined })}
                          className="input-field w-24"
                          min="1"
                          placeholder="Days before"
                        />
                      ) : (
                        <span className="cw-text-muted">
                          {config.notification_days ? `${config.notification_days} days before` : '-'}
                        </span>
                      )
                    ) : (
                      <span className="cw-text-muted">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {config ? (
                      isEditing ? (
                        <input
                          type="number"
                          value={editValues.escalation_days || ''}
                          onChange={(e) => setEditValues({ ...editValues, escalation_days: parseInt(e.target.value) || undefined })}
                          className="input-field w-24"
                          min="1"
                          placeholder="Days after"
                        />
                      ) : (
                        <span className="cw-text-muted">
                          {config.escalation_days ? `${config.escalation_days} days after` : '-'}
                        </span>
                      )
                    ) : (
                      <span className="cw-text-muted">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {config ? (
                      isEditing ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleSave}
                            disabled={updateMutation.isPending}
                            className="p-1.5 rounded-lg text-green-600 hover:bg-[var(--color-hover)] transition-colors"
                            title="Save"
                          >
                            <Save size={16} />
                          </button>
                          <button
                            onClick={handleCancel}
                            className="p-1.5 rounded-lg cw-text-muted hover:bg-[var(--color-hover)] transition-colors"
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(config)}
                          className="p-1.5 rounded-lg cw-text-muted hover:text-[var(--color-primary)] hover:bg-[var(--color-hover)] transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={16} />
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => handleCreateDefault(severity)}
                        disabled={createMutation.isPending}
                        className="text-sm text-primary-600 hover:text-primary-300"
                      >
                        Set Default
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cw-card p-6">
        <h2 className="text-lg font-semibold cw-text-default mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary-600" />
          SLA Guidelines
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="p-4 rounded-lg bg-[var(--color-subtle)]">
            <h3 className="font-medium cw-text-default mb-2">Remediation Days</h3>
            <p className="text-sm cw-text-muted">
              Maximum time allowed to remediate vulnerabilities of this severity before they are considered overdue.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--color-subtle)]">
            <h3 className="font-medium cw-text-default mb-2">Notification Days</h3>
            <p className="text-sm cw-text-muted">
              Number of days before the due date to send reminder notifications to assignees.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--color-subtle)]">
            <h3 className="font-medium cw-text-default mb-2">Escalation Days</h3>
            <p className="text-sm cw-text-muted">
              Number of days after the due date to escalate overdue vulnerabilities to management.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
