'use client';

// /reports/saved — manage saved report definitions (open, rename, share, duplicate, delete).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Bookmark, Copy, Loader2, Lock, Pencil, Plus, Search,
  Trash2, Users, ExternalLink,
} from 'lucide-react';
import { DATASETS, datasetByKey } from '../_reports/datasets';
import type { ReportSpec } from '../_reports/types';
import {
  duplicateSpec, listSpecs, persistSpec, removeSpec, type SpecSource,
} from '../_reports/savedReports';
import { usePermissions } from '../_reports/usePermissions';

function fmtWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SavedReportsPage() {
  const router = useRouter();
  const { loaded: permsLoaded, can } = usePermissions();
  const [specs, setSpecs] = useState<ReportSpec[]>([]);
  const [source, setSource] = useState<SpecSource>('server');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'shared'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ReportSpec | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ReportSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowedDatasets = useMemo(
    () => new Set(DATASETS.filter((d) => can(d.permissions)).map((d) => d.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permsLoaded],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listSpecs();
      setSpecs(r.specs);
      setSource(r.source);
    } catch {
      setError('Could not load saved reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return specs.filter((s) => {
      if (scope === 'mine' && s.mine === false) return false;
      if (scope === 'shared' && !s.shared) return false;
      if (!needle) return true;
      const ds = datasetByKey(s.dataset);
      const hay = `${s.name} ${s.dataset} ${ds?.label ?? ''} ${ds?.module ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [specs, q, scope]);

  const openEdit = (s: ReportSpec) => {
    router.push(`/reports?edit=${encodeURIComponent(s.id)}`);
  };

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    const id = renaming.id;
    setRenaming(null);
    await run(id, async () => {
      await persistSpec({ ...renaming, name });
    });
  };

  const toggleShare = async (s: ReportSpec) => {
    if (s.mine === false) return;
    await run(s.id, async () => {
      await persistSpec({ ...s, shared: !s.shared });
    });
  };

  const doDuplicate = async (s: ReportSpec) => {
    await run(s.id, async () => {
      await duplicateSpec(s);
    });
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    await run(id, async () => {
      await removeSpec(id);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/reports" className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-primary-700">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Bookmark className="h-5 w-5 text-primary-700" strokeWidth={1.9} />
            Saved reports
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Open, rename, share, duplicate or delete reports you’ve built.
            {source === 'local' && (
              <span className="ml-1 text-amber-600">Currently stored on this device only.</span>
            )}
          </p>
        </div>
        <Link
          href="/reports?mode=build"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-2 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600"
        >
          <Plus className="h-3.5 w-3.5" /> New report
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or dataset…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
          {([
            ['all', 'All'],
            ['mine', 'Mine'],
            ['shared', 'Shared'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setScope(k)}
              className={`px-3 py-1.5 text-xs font-semibold ${scope === k ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">{filtered.length} report{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <Bookmark className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              {specs.length === 0 ? 'No saved reports yet' : 'No reports match your filters'}
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Build a report in the workspace, save it, and it will show up here.
            </p>
            <Link href="/reports?mode=build" className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Plus className="h-3.5 w-3.5" /> Create a report
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Dataset</th>
                  <th className="px-4 py-2.5">Visibility</th>
                  <th className="px-4 py-2.5">Updated</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const ds = datasetByKey(s.dataset);
                  const mine = s.mine !== false;
                  const accessible = allowedDatasets.has(s.dataset);
                  const busy = busyId === s.id;
                  return (
                    <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openEdit(s)}
                            className="truncate text-left font-medium text-primary-800 hover:underline"
                            title="Open in builder"
                          >
                            {s.name || 'Untitled report'}
                          </button>
                          {!accessible && (
                            <p className="mt-0.5 text-[11px] text-amber-600">You don’t have access to this dataset</p>
                          )}
                          {!mine && (
                            <p className="mt-0.5 text-[11px] text-slate-400">Shared with you · read-only metadata</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="truncate">{ds?.label ?? s.dataset}</div>
                        {ds?.module && <div className="text-[11px] text-slate-400">{ds.module}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {s.shared ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-800">
                            <Users className="h-3 w-3" /> Shared
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            <Lock className="h-3 w-3" /> Private
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtWhen(s.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-slate-400" />}
                          <button
                            type="button"
                            title="Open in builder"
                            disabled={busy}
                            onClick={() => openEdit(s)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-700 disabled:opacity-40"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          {mine && (
                            <button
                              type="button"
                              title="Rename"
                              disabled={busy}
                              onClick={() => { setRenaming(s); setRenameValue(s.name || ''); }}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {mine && (
                            <button
                              type="button"
                              title={s.shared ? 'Make private' : 'Share with tenant'}
                              disabled={busy}
                              onClick={() => toggleShare(s)}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-700 disabled:opacity-40"
                            >
                              {s.shared ? <Lock className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          <button
                            type="button"
                            title="Duplicate"
                            disabled={busy}
                            onClick={() => doDuplicate(s)}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {mine && (
                            <button
                              type="button"
                              title="Delete"
                              disabled={busy}
                              onClick={() => setConfirmDelete(s)}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rename dialog */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setRenaming(null)}>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-slate-900">Rename report</h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null); }}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={saveRename} disabled={!renameValue.trim()} className="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-40">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-slate-900">Delete report?</h2>
            <p className="mt-2 text-sm text-slate-600">
              “{confirmDelete.name || 'Untitled report'}” will be permanently removed
              {confirmDelete.shared ? ' for everyone who can see it' : ''}.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={doDelete} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
