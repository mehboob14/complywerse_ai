'use client';

export const dynamic = 'force-dynamic';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/lib/api';
import EmptyState from '@/components/common/EmptyState';

type IngestJob = {
  id: number;
  original_filename: string;
  benchmark_label: string | null;
  status: string;
  page_count: number | null;
  rules_extracted: number;
  rules_inserted: number;
  rules_updated: number;
  rules_flagged: number;
  ocr_pages: number;
  error_text: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  running: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed: 'bg-red-100 text-red-800 border-red-200',
};

export default function CisIngestPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const jobsQ = useQuery<{ jobs: IngestJob[] }>({
    queryKey: ['compliance-plugins.ingest.jobs'],
    queryFn: async () => (await compliancePluginsApi.listIngestJobs()).data,
    refetchInterval: 5000,
  });

  const uploadM = useMutation({
    mutationFn: async (f: File) => (await compliancePluginsApi.ingestPdf(f)).data,
    onSuccess: () => {
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      qc.invalidateQueries({ queryKey: ['compliance-plugins.ingest.jobs'] });
    },
  });

  const reparseM = useMutation({
    mutationFn: (jobId: number) => compliancePluginsApi.reparseIngestJob(jobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance-plugins.ingest.jobs'] }),
  });

  const deleteM = useMutation({
    mutationFn: (jobId: number) => compliancePluginsApi.deleteIngestJob(jobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance-plugins.ingest.jobs'] }),
  });

  const jobs = jobsQ.data?.jobs ?? [];

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Upload CIS Benchmark PDF</h3>
        <p className="text-sm text-gray-500 mb-4">
          Upload a CIS Benchmark PDF. The pipeline will extract rules, generate runner check
          definitions, and queue them for review on the Library tab.
        </p>
        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <button
            type="button"
            disabled={!file || uploadM.isPending}
            onClick={() => file && uploadM.mutate(file)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {uploadM.isPending ? 'Uploading…' : 'Upload & Extract'}
          </button>
        </div>
        {uploadM.isError && (() => {
          // Surface the real backend reason (size cap, wrong content-type,
          // missing perm, parser crash) instead of a generic 'try again'.
          const e = uploadM.error as { response?: { status?: number; data?: { detail?: string } }; message?: string };
          const status = e?.response?.status;
          const detail = e?.response?.data?.detail || e?.message || 'unknown error';
          let hint = '';
          if (status === 401) hint = ' (you may need to sign in again)';
          else if (status === 403) hint = ' (your role doesn\'t include compliance:scan:execute)';
          else if (status === 413) hint = ' (PDF exceeds the 50 MB limit)';
          else if (status === 422) hint = ' (server only accepts .pdf files)';
          return (
            <p className="mt-3 text-xs text-red-600">
              <strong>Upload failed:</strong> {detail}{hint}
            </p>
          );
        })()}
      </section>

      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Recent ingest jobs</h3>
        {jobs.length === 0 ? (
          <EmptyState
            icon="📄"
            title="No ingest jobs yet"
            description="Upload a CIS Benchmark PDF above to extract its rules into the plugin library."
          />
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 tracking-wide">
                <tr>
                  <th className="px-4 py-2">File</th>
                  <th className="px-4 py-2">Benchmark</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Pages</th>
                  <th className="px-4 py-2 text-right">Rules</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-900 max-w-xs truncate" title={j.original_filename}>
                      {j.original_filename}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{j.benchmark_label ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          STATUS_BADGE[j.status] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">{j.page_count ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {j.rules_inserted}/{j.rules_extracted}
                    </td>
                    <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => reparseM.mutate(j.id)}
                        disabled={reparseM.isPending || j.status === 'running'}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        Re-parse
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete ingest job for ${j.original_filename}?`)) deleteM.mutate(j.id);
                        }}
                        disabled={deleteM.isPending}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
