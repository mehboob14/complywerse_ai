'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  FileText,
  Loader2,
  Upload,
  Trash2,
  AlertCircle,
  Sparkles,
  Calendar,
  Eye,
} from 'lucide-react';

interface VulnReport {
  id: number;
  name: string;
  file_name?: string;
  source?: string;
  uploaded_at: string;
  processed_at?: string;
  total_vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
  ai_analyzed?: boolean;
}

export default function VulnerabilityReportsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: reports, isLoading, error } = useQuery({
    queryKey: ['vuln-reports'],
    queryFn: async () => {
      const response = await vulnManagementApi.reports.getAll();
      return response.data as VulnReport[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => vulnManagementApi.reports.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-reports'] });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
      setUploading(false);
    },
    onError: () => {
      setUploading(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => vulnManagementApi.reports.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-reports'] });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['vuln-dashboard'] });
      setDeleteConfirm(null);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: (id: number) => vulnManagementApi.ai.analyzeReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-reports'] });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    uploadMutation.mutate(formData);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
        <p className="mt-2 text-red-600">Failed to load reports</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold cw-text-default">Vulnerability Reports</h1>
          <p className="mt-1 cw-text-muted">Upload and manage vulnerability scan reports</p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-primary flex items-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={18} />
                Upload Report
              </>
            )}
          </button>
        </div>
      </div>

      <div className="cw-card overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--color-subtle)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Report</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Uploaded</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Total</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Critical</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">High</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Medium</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Low</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider cw-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {(!reports || reports.length === 0) ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center cw-text-muted">
                  <FileText className="mx-auto h-12 w-12 cw-text-muted mb-3" />
                  <p>No reports uploaded yet</p>
                  <p className="text-sm mt-1">Upload an Excel or CSV vulnerability scan report</p>
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id} className="hover:bg-[var(--color-hover)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-[var(--color-subtle)] p-2">
                        <FileText className="h-5 w-5 cw-text-muted" />
                      </div>
                      <div>
                        <p className="font-medium cw-text-default">{report.name}</p>
                        {report.file_name && (
                          <p className="text-xs cw-text-muted">{report.file_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-sm cw-text-muted">
                      <Calendar size={14} className="cw-text-muted" />
                      {new Date(report.uploaded_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium cw-text-default">
                    {report.total_vulnerabilities}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600">
                      {report.critical_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-600">
                      {report.high_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-600">
                      {report.medium_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                      {report.low_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => analyzeMutation.mutate(report.id)}
                        disabled={analyzeMutation.isPending}
                        className="p-1.5 rounded-lg cw-text-muted hover:text-[var(--color-primary)] hover:bg-[var(--color-hover)] transition-colors"
                        title="AI Analyze"
                      >
                        <Sparkles size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(report.id)}
                        className="p-1.5 rounded-lg cw-text-muted hover:text-red-600 hover:bg-[var(--color-hover)] transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
            <h2 className="text-xl font-bold cw-text-default mb-4">Delete Report</h2>
            <p className="cw-text-muted mb-6">
              Are you sure you want to delete this report? This will also delete all vulnerabilities imported from this report.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="cw-btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
