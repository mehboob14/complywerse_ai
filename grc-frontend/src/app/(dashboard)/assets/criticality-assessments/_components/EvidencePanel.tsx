'use client';

// EvidencePanel — file attachments on a single criticality assessment.
// Mirrors the RCSA-custom evidence pattern: upload, list, download (via
// authed apiClient blob fetch), delete. Each touch fires an activity row.

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Upload, Loader2, Trash2, Download,
} from 'lucide-react';
import apiClient, {
  criticalityApi,
  type CriticalityEvidenceRow,
  type CriticalityKind,
} from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

export function EvidencePanel({
  kind, itemId,
}: { kind: CriticalityKind; itemId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');

  const listQ = useQuery<CriticalityEvidenceRow[]>({
    queryKey: ['criticality.evidence', kind, itemId],
    queryFn: async () => (await criticalityApi.evidence.list(kind, itemId)).data,
  });

  const uploadM = useMutation({
    mutationFn: (params: { file: File; description: string }) =>
      criticalityApi.evidence.upload(kind, itemId, params.file, params.description || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.evidence', kind, itemId] });
      qc.invalidateQueries({ queryKey: ['criticality.activity', kind, itemId] });
      qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
      qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
      setPendingFile(null);
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const deleteM = useMutation({
    mutationFn: (evidenceId: number) => criticalityApi.evidence.delete(kind, itemId, evidenceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.evidence', kind, itemId] });
      qc.invalidateQueries({ queryKey: ['criticality.activity', kind, itemId] });
      qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
      qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
    },
  });

  const handleDownload = async (ev: CriticalityEvidenceRow) => {
    try {
      const url = criticalityApi.evidence.downloadUrl(kind, itemId, ev.id);
      const r = await apiClient.get(url, { responseType: 'blob' });
      const blob = r.data as Blob;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = ev.file_name;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast({ title: 'Download failed', message: 'Could not download this evidence file.', type: 'error' });
    }
  };

  const items = listQ.data ?? [];

  return (
    <div className="space-y-3">
      {/* Upload */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
            className="text-xs"
          />
          {pendingFile && (
            <span className="text-[11px] text-slate-600 truncate">
              {pendingFile.name} ({Math.round(pendingFile.size / 1024)} KB)
            </span>
          )}
        </div>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description — what does this evidence prove?"
          className="block w-full text-sm rounded-md border border-slate-300 bg-white text-slate-900 px-2 py-1.5 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
        />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!pendingFile || uploadM.isPending}
            onClick={() => pendingFile && uploadM.mutate({ file: pendingFile, description })}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {uploadM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload evidence
          </button>
        </div>
        {uploadM.isError && (
          <p className="text-[11px] text-rose-700">Upload failed. Try a smaller file (50 MB max) or check your connection.</p>
        )}
      </div>

      {/* List */}
      {listQ.isLoading ? (
        <p className="text-center text-xs text-slate-500">Loading evidence…</p>
      ) : items.length === 0 ? (
        <p className="text-center text-xs text-slate-500">No evidence attached yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((ev) => (
            <li key={ev.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <FileText className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => handleDownload(ev)}
                  className="text-sm font-medium text-slate-900 hover:text-emerald-700 hover:underline truncate text-left"
                  title={ev.file_name}
                >
                  {ev.file_name}
                </button>
                <p className="text-[10px] text-slate-500">
                  {ev.uploaded_by_name || 'Someone'} ·{' '}
                  {new Date(ev.uploaded_at).toLocaleString()}
                  {ev.file_size != null ? ` · ${Math.round(ev.file_size / 1024)} KB` : ''}
                </p>
                {ev.description && <p className="mt-1 text-xs text-slate-700">{ev.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDownload(ev)}
                className="text-[11px] text-slate-600 hover:text-slate-900 px-2 py-1 border border-slate-300 rounded"
                title="Download"
              >
                <Download className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${ev.file_name}"?`)) deleteM.mutate(ev.id);
                }}
                className="text-[11px] text-rose-600 hover:text-rose-700 px-2 py-1 border border-rose-200 rounded"
                disabled={deleteM.isPending}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
