'use client';

/**
 * Configure Frameworks — choose which frameworks are in the Control Catalog.
 * Selecting frameworks pulls their controls into the catalog; the choice is
 * tenant-wide, admin-set, and every change is logged. Backed by the existing
 * workbench /scope endpoints (GET returns available + counts + history, PUT
 * saves the selection). "All checked" saves as the canonical "all" (empty).
 */
import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  ChevronLeft, Search, ShieldCheck, Loader2, Check, Layers, History, Info, CheckSquare, Square,
} from 'lucide-react';

const WB = '/control-library/workbench';

type Scope = {
  framework_ids: number[];
  available: { id: number; name: string; controls: number }[];
  can_edit: boolean;
  history: { by: string; at: string; added: string[]; removed: string[]; total: number }[];
};

export default function ConfigureFrameworks() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number> | null>(null); // null = not yet initialised
  const [saved, setSaved] = useState(false);

  const { data: scope, isLoading } = useQuery({
    queryKey: ['wb-scope'],
    queryFn: async () => (await apiClient.get(`${WB}/scope`)).data as Scope,
  });

  // initialise the selection once from the saved scope (empty scope = all selected)
  useEffect(() => {
    if (scope && sel === null) {
      const all = scope.available.map(f => f.id);
      setSel(new Set(scope.framework_ids.length ? scope.framework_ids : all));
    }
  }, [scope, sel]);

  const save = useMutation({
    mutationFn: async () => {
      const all = scope!.available.map(f => f.id);
      const chosen = Array.from(sel!);
      // all selected → canonical "all" (empty); otherwise the explicit subset
      const framework_ids = chosen.length === all.length ? [] : chosen;
      return apiClient.put(`${WB}/scope`, { framework_ids });
    },
    onSuccess: () => {
      setSaved(true);
      ['wb-scope', 'wb-overview', 'wb-list', 'wb-domains', 'wb-groups'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const available = scope?.available || [];
  const shown = useMemo(
    () => q ? available.filter(f => f.name.toLowerCase().includes(q.toLowerCase())) : available,
    [available, q]);
  const totalControls = available.reduce((a, f) => a + f.controls, 0);
  const selCount = sel?.size ?? 0;
  const selControls = available.filter(f => sel?.has(f.id)).reduce((a, f) => a + f.controls, 0);
  const canEdit = scope?.can_edit;

  const dirty = useMemo(() => {
    if (!scope || sel === null) return false;
    const all = scope.available.map(f => f.id);
    const cur = new Set(scope.framework_ids.length ? scope.framework_ids : all);
    if (cur.size !== sel.size) return true;
    for (const id of sel) if (!cur.has(id)) return true;
    return false;
  }, [scope, sel]);

  const toggle = (id: number) => { if (!canEdit || sel === null) return; const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const selectAll = () => canEdit && setSel(new Set(available.map(f => f.id)));
  const clearAll = () => canEdit && setSel(new Set());

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-1">
      <div>
        <Link href="/controls" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-primary-700">
          <ChevronLeft className="h-4 w-4" /> Back to Control Catalog
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-bold text-slate-900"><SlidersFallback /> Configure Frameworks</h1>
        <p className="text-[13px] text-slate-500">Choose which frameworks appear in your Control Catalog. Their controls flow into the catalog automatically. This is tenant-wide and every change is logged.</p>
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <Info className="h-4 w-4 flex-shrink-0 text-amber-600" /> Only an administrator can change the framework selection — you can view it here.
        </div>
      )}

      {/* summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { lab: 'Frameworks selected', val: `${selCount} of ${available.length}`, icon: Layers },
          { lab: 'Controls in catalog', val: selControls.toLocaleString(), icon: ShieldCheck, hint: `of ${totalControls.toLocaleString()} available` },
          { lab: 'Coverage', val: `${totalControls ? Math.round((selControls / totalControls) * 100) : 0}%`, icon: Check },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.lab} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><Icon className="h-4 w-4" /></span>
              <div><div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.lab}</div><div className="text-[17px] font-bold tabular-nums text-slate-900">{c.val}</div>{c.hint && <div className="text-[10.5px] text-slate-400">{c.hint}</div>}</div>
            </div>
          );
        })}
      </div>

      {/* framework list */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search frameworks…" className="h-9 w-64 rounded-lg border border-slate-300 pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" />
          </div>
          {canEdit && (
            <div className="flex items-center gap-1.5 text-[12px]">
              <button onClick={selectAll} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 font-medium text-slate-600 hover:bg-slate-50"><CheckSquare className="h-3.5 w-3.5" /> Select all</button>
              <button onClick={clearAll} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 font-medium text-slate-600 hover:bg-slate-50"><Square className="h-3.5 w-3.5" /> Clear</button>
            </div>
          )}
        </div>
        {isLoading || sel === null ? (
          <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" /></div>
        ) : (
          <ul className="max-h-[440px] divide-y divide-slate-50 overflow-y-auto">
            {shown.length === 0 ? <li className="p-6 text-center text-[13px] text-slate-400">No frameworks match “{q}”.</li> :
              shown.map(f => {
                const on = sel.has(f.id);
                return (
                  <li key={f.id}>
                    <button onClick={() => toggle(f.id)} disabled={!canEdit}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${canEdit ? 'hover:bg-slate-50' : 'cursor-default'} ${on ? 'bg-primary-50/40' : ''}`}>
                      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{f.name}</span>
                      <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-slate-500">{f.controls.toLocaleString()} controls</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
        {canEdit && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-3">
            <span className="text-[12px] text-slate-400">{selCount === available.length ? 'All frameworks included.' : `${selCount} framework${selCount === 1 ? '' : 's'} selected · ${selControls.toLocaleString()} controls.`}{selCount === 0 && ' Select at least one to save.'}</span>
            <div className="flex items-center gap-2">
              {saved && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600"><Check className="h-4 w-4" /> Saved</span>}
              <button disabled={!dirty || selCount === 0 || save.isPending} onClick={() => save.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save selection
              </button>
            </div>
          </div>
        )}
      </div>

      {/* change log */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-slate-700"><History className="h-4 w-4 text-slate-400" /> Change log</div>
        {(scope?.history || []).length === 0 ? (
          <p className="text-[12px] text-slate-400">No changes recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {(scope?.history || []).map((h, i) => (
              <li key={i} className="flex items-start gap-2.5 border-t border-slate-50 pt-2 text-[12px] first:border-0 first:pt-0">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">{(h.by || 'S').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-700"><b>{h.by}</b> updated the selection <span className="text-slate-400">· {h.at ? new Date(h.at).toLocaleString() : ''}</span></div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {h.added.map(n => <span key={`a${n}`} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] text-emerald-700">+ {n}</span>)}
                    {h.removed.map(n => <span key={`r${n}`} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10.5px] text-rose-700">− {n}</span>)}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">→ {h.total === 0 ? 'all frameworks' : `${h.total} selected`}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// tiny inline icon wrapper so we don't add another import just for the header glyph
function SlidersFallback() {
  return <span className="flex h-5 w-5 items-center justify-center rounded bg-primary-50 text-primary-600"><Layers className="h-3.5 w-3.5" /></span>;
}
