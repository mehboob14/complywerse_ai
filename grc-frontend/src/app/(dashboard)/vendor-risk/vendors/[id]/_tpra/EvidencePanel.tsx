'use client';

// Evidence for the TPRA lifecycle — upload a new file OR link an existing record
// from the central evidence library. Reused at the assessment level (the
// Questionnaire & Evidence stage "evidence pack") and scoped to a single finding.
import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Upload, Link2, X, Loader2, FileText, ExternalLink, Search } from 'lucide-react';
import { tpraApi, evidenceApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

interface EvidenceLinkRow {
  id: number;
  evidence_id: number;
  finding_id: number | null;
  note: string | null;
  name: string | null;
  file_name: string | null;
  file_type: string | null;
  evidence_type: string | null;
  status: string | null;
  has_file: boolean;
  created_at: string;
}

interface LibraryEvidence {
  id: number;
  name: string;
  file_name?: string | null;
  evidence_type?: string | null;
}

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function EvidencePanel({
  assessmentId, findingId, title = 'Evidence', compact = false,
}: { assessmentId: number; findingId?: number; title?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const key = ['tpra-evidence', assessmentId, findingId ?? 'all'];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await tpraApi.listEvidence(assessmentId, findingId ? { finding_id: findingId } : undefined);
      return (res.data?.items ?? []) as EvidenceLinkRow[];
    },
  });
  const items = data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name);
      if (findingId) fd.append('finding_id', String(findingId));
      return (await tpraApi.uploadEvidence(assessmentId, fd)).data;
    },
    onSuccess: () => { toast({ type: 'success', title: 'Evidence uploaded' }); /* success */ invalidate(); },
    onError: (e) => toast({ type: 'error', title: errMsg(e,'Upload failed') }),
  });

  const linkMut = useMutation({
    mutationFn: async (evidenceId: number) =>
      (await tpraApi.linkEvidence(assessmentId, { evidence_id: evidenceId, finding_id: findingId })).data,
    onSuccess: () => { toast({ type: 'success', title: 'Evidence linked' }); /* success */ setPickerOpen(false); setSearch(''); invalidate(); },
    onError: (e) => toast({ type: 'error', title: errMsg(e,'Link failed') }),
  });

  const unlinkMut = useMutation({
    mutationFn: async (linkId: number) => (await tpraApi.unlinkEvidence(linkId)).data,
    onSuccess: () => { toast({ type: 'success', title: 'Evidence removed' }); /* success */ invalidate(); },
    onError: (e) => toast({ type: 'error', title: errMsg(e,'Remove failed') }),
  });

  // Library list only fetched when the picker opens.
  const { data: library, isLoading: libLoading } = useQuery({
    queryKey: ['evidence-library'],
    queryFn: async () => {
      const res = await evidenceApi.getAll();
      return (res.data ?? []) as unknown as LibraryEvidence[];
    },
    enabled: pickerOpen,
  });
  const linkedIds = useMemo(() => new Set(items.map((i) => i.evidence_id)), [items]);
  const filteredLib = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (library ?? [])
      .filter((e) => !linkedIds.has(e.id))
      .filter((e) => !q || e.name?.toLowerCase().includes(q) || e.file_name?.toLowerCase().includes(q))
      .slice(0, 25);
  }, [library, linkedIds, search]);

  return (
    <div className={compact ? '' : 'rounded-xl border border-gray-200 bg-white p-4'}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <Paperclip className="h-3.5 w-3.5 text-gray-400" /> {title}
          <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">{items.length}</span>
        </p>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); if (fileRef.current) fileRef.current.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {uploadMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
            </button>
            <button onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
              <Link2 className="h-3.5 w-3.5" /> Link existing
            </button>
          </div>
        )}
      </div>

      {/* Existing-evidence picker */}
      {pickerOpen && (
        <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search evidence library…"
              className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          {libLoading ? (
            <p className="px-1 py-2 text-[11px] text-gray-400">Loading library…</p>
          ) : filteredLib.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-gray-400">No matching evidence. Upload a new file instead.</p>
          ) : (
            <ul className="max-h-44 space-y-0.5 overflow-y-auto">
              {filteredLib.map((e) => (
                <li key={e.id}>
                  <button onClick={() => linkMut.mutate(e.id)} disabled={linkMut.isPending}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-white disabled:opacity-50">
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                    <span className="truncate">{e.name}{e.file_name ? ` · ${e.file_name}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Attached list */}
      {isLoading ? (
        <p className="text-[11px] text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-gray-400">No evidence attached yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
              {it.has_file ? <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" /> : <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{it.name || it.file_name || `Evidence #${it.evidence_id}`}</span>
              {it.evidence_type && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{it.evidence_type}</span>}
              {it.status && <span className="text-[10px] text-gray-400">{it.status}</span>}
              {canEdit && (
                <button onClick={() => unlinkMut.mutate(it.id)} disabled={unlinkMut.isPending}
                  title="Remove" className="text-gray-400 hover:text-red-600 disabled:opacity-50">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
