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
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-red-400">Failed to load reports</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vulnerability Reports</h1>
          <p className="mt-1 text-slate-400">Upload and manage vulnerability scan reports</p>
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

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Report</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Uploaded</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Total</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Critical</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">High</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Medium</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Low</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {(!reports || reports.length === 0) ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  <FileText className="mx-auto h-12 w-12 text-slate-600 mb-3" />
                  <p>No reports uploaded yet</p>
                  <p className="text-sm mt-1">Upload an Excel or CSV vulnerability scan report</p>
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr key={report.id} className="hover:bg-slate-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-slate-700 p-2">
                        <FileText className="h-5 w-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{report.name}</p>
                        {report.file_name && (
                          <p className="text-xs text-slate-400">{report.file_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-sm text-slate-300">
                      <Calendar size={14} className="text-slate-400" />
                      {new Date(report.uploaded_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-white">
                    {report.total_vulnerabilities}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400">
                      {report.critical_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-orange-500/20 px-2.5 py-0.5 text-xs font-medium text-orange-400">
                      {report.high_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-yellow-500/20 px-2.5 py-0.5 text-xs font-medium text-yellow-400">
                      {report.medium_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                      {report.low_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => analyzeMutation.mutate(report.id)}
                        disabled={analyzeMutation.isPending}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-purple-400 hover:bg-slate-700 transition-colors"
                        title="AI Analyze"
                      >
                        <Sparkles size={16} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(report.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
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
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="text-xl font-bold text-white mb-4">Delete Report</h2>
            <p className="text-slate-300 mb-6">
              Are you sure you want to delete this report? This will also delete all vulnerabilities imported from this report.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="btn-primary bg-red-600 hover:bg-red-700"
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
