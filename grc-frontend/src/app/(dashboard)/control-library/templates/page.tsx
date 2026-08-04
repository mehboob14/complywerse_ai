'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import ArtifactsTab from '@/components/compliance/ArtifactsTab';
import { ChevronLeft, FileStack, Loader2, Search } from 'lucide-react';

interface FwOption { id: number; name: string; short_code?: string | null }

export default function FrameworkTemplatesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string>('');
  const [query, setQuery] = useState('');

  // Frameworks to choose from (the uploaded/available frameworks).
  const { data: frameworks, isLoading } = useQuery<FwOption[]>({
    queryKey: ['template-frameworks'],
    queryFn: async () => {
      const r = await apiClient.get('/frameworks/available');
      const list = Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || []);
      return list.map((f: any) => ({ id: f.id, name: f.name, short_code: f.short_code }))
        .sort((a: FwOption, b: FwOption) => a.name.localeCompare(b.name));
    },
  });

  // tenant users for the assign dropdown inside the catalog (best-effort).
  const { data: tenantUsers } = useQuery({
    queryKey: ['template-tenant-users'],
    queryFn: async () => {
      try { const r = await apiClient.get('/users', { params: { limit: 200 } }); const l = Array.isArray(r.data) ? r.data : (r.data?.items || []); return l.map((u: any) => ({ id: u.id, name: u.full_name || u.name || u.email || `User ${u.id}` })); }
      catch { return []; }
    },
  });

  useEffect(() => {
    if (!selected && frameworks && frameworks.length) setSelected(frameworks[0].name);
  }, [frameworks, selected]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (frameworks || []).filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [frameworks, query]);

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/control-library')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary-700"><ChevronLeft size={14} />Control Library</button>

      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-600 to-rose-600 p-6 text-white shadow-sm">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -right-24 bottom-0 h-44 w-44 rounded-full bg-white/5" />
        </div>
        <div className="relative flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><FileStack size={24} /></span>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-amber-100">Document library</div>
            <h1 className="text-2xl font-bold leading-tight">Framework Templates</h1>
            <p className="mt-1 max-w-2xl text-sm text-amber-50/90">
              Ready-structured artifact templates for each framework, organized by assessment stage. <b>Template</b> downloads a file to fill in; <b>Create</b> makes a working copy you can edit & track.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-10 text-slate-400"><Loader2 className="animate-spin" size={18} />Loading frameworks…</div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* framework picker */}
          <div className="lg:w-64 lg:shrink-0">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search frameworks…" className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none" />
            </div>
            <div className="flex max-h-[70vh] flex-col gap-1 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5">
              {shown.map((f) => (
                <button key={f.id} onClick={() => setSelected(f.name)} className={`rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${selected === f.name ? 'bg-primary-50 font-medium text-primary-800 ring-1 ring-primary-200' : 'text-slate-700 hover:bg-slate-50'}`}>
                  {f.name}
                </button>
              ))}
              {shown.length === 0 && <div className="px-3 py-4 text-xs text-slate-400">No frameworks match.</div>}
            </div>
          </div>

          {/* rich artifact catalog for the selected framework */}
          <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white">
            {selected ? (
              <ArtifactsTab key={selected} assessmentType={selected} tenantUsers={(tenantUsers as any) || []} />
            ) : (
              <div className="p-10 text-sm text-slate-400">Pick a framework to see its document templates.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
