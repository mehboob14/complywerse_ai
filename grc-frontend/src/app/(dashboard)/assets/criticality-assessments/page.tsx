'use client';

export const dynamic = 'force-dynamic';

// Criticality Assessments
// ─────────────────────────────────────────────────────────────────────────
// Two assessment families per the bank-provided Excel templates:
//   • Information System Criticality Assessment (ISCA)
//   • Infrastructure Asset Criticality Assessment (IACA)
// Each tab has its own list + create/edit drawer, all schema-driven by the
// scoring metadata in `_scoring.ts`. Asset linkage + user-driven contact
// fields come from `/criticality-assessments/{users,assets}`.

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Plus, Save, X, Trash2, Server, FileText, Layers, Sparkles,
  Loader2, Search, UserCheck, MessageSquare, Paperclip, Activity,
  Download, Upload, ShieldCheck, ExternalLink, BarChart3,
  ChevronDown, Check,
} from 'lucide-react';
import apiClient, {
  criticalityApi,
  type IscaItem,
  type IacaItem,
  type CriticalityUserOption,
  type CriticalityAssetOption,
  type CriticalityCoverage,
} from '@/lib/api';
import {
  BAND_LABELS, BAND_BADGE, ISCA_CRITERIA, IACA_CRITERIA,
  iscaTotal, iscaBand, iacaTotal, iacaBand,
  type ScoringCriterion, type CriticalityBand,
} from './_scoring';
import { ApprovalBar, StatusPill, type ApprovalCapableItem } from './_components/ApprovalBar';
import { ActivityPanel } from './_components/ActivityPanel';
import { CommentsPanel } from './_components/CommentsPanel';
import { EvidencePanel } from './_components/EvidencePanel';

// ── Drawer tab discriminator (only used when editing an existing item) ──
type DrawerTab = 'fields' | 'comments' | 'evidence' | 'activity';

// /auth/me shape — kept local so we don't drag a heavy hook into here.
type CurrentUser = {
  id: number | null;
  is_admin: boolean;
  permissions: string[];
};

function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ['current-user-criticality'],
    queryFn: async () => {
      const r = await apiClient.get('/auth/me');
      const u = r.data?.user ?? {};
      return {
        id: u.id ?? null,
        is_admin: !!u.is_admin,
        permissions: Array.isArray(u.permissions) ? u.permissions : [],
      };
    },
    staleTime: 60_000,
  });
}

function hasPermission(user: CurrentUser | undefined, perm: string): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  if (user.permissions.includes('*:*:*')) return true;
  if (user.permissions.includes(perm)) return true;
  // Wildcard match — e.g. assets:criticality_assessments:* covers _approve_ciso.
  const parts = perm.split(':');
  if (parts.length === 3) {
    if (user.permissions.includes(`${parts[0]}:${parts[1]}:*`)) return true;
    if (user.permissions.includes(`${parts[0]}:*:*`)) return true;
  }
  return false;
}

type TabKey = 'info-system' | 'infra-asset';

const TABS: Array<{ key: TabKey; label: string; icon: typeof FileText; hint: string }> = [
  {
    key: 'info-system',
    label: 'Information System',
    icon: FileText,
    hint: 'Per bank template — sum of 8 criteria, 6–32 → criticality band.',
  },
  {
    key: 'infra-asset',
    label: 'Infrastructure Assets',
    icon: Server,
    hint: 'Per bank template — weighted sum of 9 criteria (0.0–4.0).',
  },
];

export default function CriticalityAssessmentsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('info-system');
  // Deep-link triggers — driven by `?open=KIND:ID` and `?create=KIND&asset=N`.
  // Resolved once on mount; the URL is cleared so refresh doesn't replay.
  const [pendingOpen, setPendingOpen] = useState<{ kind: 'isca' | 'iaca'; id: number } | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ kind: 'isca' | 'iaca'; assetId?: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const openRaw = params.get('open');
    const createRaw = params.get('create');
    const assetRaw = params.get('asset');
    if (openRaw) {
      const [kindStr, idStr] = openRaw.split(':');
      const kind = kindStr === 'iaca' ? 'iaca' : 'isca';
      const id = Number(idStr);
      if (Number.isFinite(id) && id > 0) {
        setActiveTab(kind === 'isca' ? 'info-system' : 'infra-asset');
        setPendingOpen({ kind, id });
      }
    } else if (createRaw === 'isca' || createRaw === 'iaca') {
      const kind = createRaw as 'isca' | 'iaca';
      setActiveTab(kind === 'isca' ? 'info-system' : 'infra-asset');
      const assetId = assetRaw ? Number(assetRaw) : undefined;
      setPendingCreate({ kind, assetId: Number.isFinite(assetId as number) ? assetId : undefined });
    }
    if (openRaw || createRaw) {
      // Strip params so a refresh doesn't re-trigger the action.
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">
            Criticality Assessments
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Information System &amp; Infrastructure Asset criticality, scored per the
            bank-provided templates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/assets/criticality-assessments/analytics"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </Link>
          <BulkImportButton />
        </div>
      </header>

      {/* Tab bar */}
      <div className="rounded-xl border border-slate-200 bg-white px-3">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                title={tab.hint}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'info-system' && (
        <IscaPanel
          pendingOpenId={pendingOpen?.kind === 'isca' ? pendingOpen.id : null}
          pendingCreateAssetId={pendingCreate?.kind === 'isca' ? (pendingCreate.assetId ?? null) : null}
          onConsumeAction={() => { setPendingOpen(null); setPendingCreate(null); }}
        />
      )}
      {activeTab === 'infra-asset' && (
        <IacaPanel
          pendingOpenId={pendingOpen?.kind === 'iaca' ? pendingOpen.id : null}
          pendingCreateAssetId={pendingCreate?.kind === 'iaca' ? (pendingCreate.assetId ?? null) : null}
          onConsumeAction={() => { setPendingOpen(null); setPendingCreate(null); }}
        />
      )}
    </div>
  );
}

// ─── Bulk-import button (modal in-line) ──────────────────────────────────
function BulkImportButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'isca' | 'iaca'>('isca');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    imported: Array<{ row: number; item_id: number; name: string }>;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const importM = useMutation({
    mutationFn: () => criticalityApi.bulkImport(kind, file as File),
    onSuccess: (r) => {
      setResult(r.data);
      qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
      qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
    },
  });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <Upload className="h-3.5 w-3.5" />
        Import from Excel
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-semibold text-slate-900">Bulk import from Excel</h3>
              <button onClick={() => { setOpen(false); setResult(null); }} className="text-slate-500 hover:text-slate-900">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <FieldLabel>Assessment kind</FieldLabel>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'isca' | 'iaca')}
                  className="block w-full text-sm rounded-md border border-slate-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="isca">Information System</option>
                  <option value="iaca">Infrastructure Asset</option>
                </select>
              </div>
              <div>
                <FieldLabel>Filled template (.xlsx)</FieldLabel>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs"
                />
              </div>
              {result && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                  <p className="font-medium">Imported: {result.imported.length}</p>
                  {result.errors.length > 0 && (
                    <ul className="list-disc list-inside text-rose-700">
                      {result.errors.map((e, i) => <li key={i}>row {e.row}: {e.message}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setResult(null); }}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-md text-slate-700 hover:bg-white"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!file || importM.isPending}
                onClick={() => importM.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {importM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importM.isPending ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────

function BandBadge({ level }: { level: CriticalityBand | null | undefined }) {
  if (!level) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-gray-50 text-gray-500 border-gray-200">
        Not scored
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${BAND_BADGE[level]}`}>
      {BAND_LABELS[level]}
    </span>
  );
}

function shared() { /* placeholder so future shared hooks can live here */ }
void shared;

// ─── ISCA panel ──────────────────────────────────────────────────────────

function IscaPanel({
  pendingOpenId, pendingCreateAssetId, onConsumeAction,
}: {
  pendingOpenId?: number | null;
  pendingCreateAssetId?: number | null;
  onConsumeAction?: () => void;
} = {}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<IscaItem> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createInitial, setCreateInitial] = useState<Partial<IscaItem>>({});

  const listQ = useQuery<IscaItem[]>({
    queryKey: ['criticality.isca.list'],
    queryFn: async () => (await criticalityApi.infoSystem.list()).data,
  });

  // React to deep-link triggers from the asset detail page once the list
  // is loaded — opens the matching row's drawer or pre-fills the create form.
  useEffect(() => {
    if (pendingOpenId && (listQ.data ?? []).length > 0) {
      const item = (listQ.data ?? []).find((r) => r.id === pendingOpenId);
      if (item) {
        setEditing(item);
        onConsumeAction?.();
      }
    } else if (pendingCreateAssetId) {
      setCreateInitial({ linked_asset_id: pendingCreateAssetId });
      setShowCreate(true);
      onConsumeAction?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, pendingCreateAssetId, listQ.data]);

  const createM = useMutation({
    mutationFn: (data: Partial<IscaItem>) => criticalityApi.infoSystem.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
      setShowCreate(false);
    },
  });
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<IscaItem> }) =>
      criticalityApi.infoSystem.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
      setEditing(null);
    },
  });
  const deleteM = useMutation({
    mutationFn: (id: number) => criticalityApi.infoSystem.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['criticality.isca.list'] }),
  });

  const items = listQ.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Information System Criticality Assessment
        </h2>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New ISCA item
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Information System</th>
              <th className="px-3 py-2">Linked Asset</th>
              <th className="px-3 py-2">Business Owner</th>
              <th className="px-3 py-2">Assessor</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Criticality</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listQ.isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-gray-500">
                  No items yet. Click <em>New ISCA item</em> to add one.
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 align-top">
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    {r.address && (
                      <p className="text-[11px] text-gray-500 truncate max-w-[260px]" title={r.address}>
                        {r.address}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {r.linked_asset_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {r.business_owner_user_name || r.business_owner_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {r.assessor_user_name || r.assessor_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-right text-sm font-mono text-gray-900">
                    {r.total_score ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <BandBadge level={r.criticality_level || null} />
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${r.name}"? This cannot be undone.`)) {
                          deleteM.mutate(r.id);
                        }
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(showCreate || editing) && (
        <IscaDrawer
          initial={editing ?? createInitial}
          isEditing={!!editing}
          isPending={createM.isPending || updateM.isPending}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
            setCreateInitial({});
          }}
          onSubmit={(data) => {
            if (editing && editing.id) {
              updateM.mutate({ id: editing.id, data });
            } else {
              createM.mutate(data);
            }
          }}
        />
      )}
    </section>
  );
}

// ─── IACA panel ──────────────────────────────────────────────────────────

function IacaPanel({
  pendingOpenId, pendingCreateAssetId, onConsumeAction,
}: {
  pendingOpenId?: number | null;
  pendingCreateAssetId?: number | null;
  onConsumeAction?: () => void;
} = {}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<IacaItem> | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createInitial, setCreateInitial] = useState<Partial<IacaItem>>({});

  const listQ = useQuery<IacaItem[]>({
    queryKey: ['criticality.iaca.list'],
    queryFn: async () => (await criticalityApi.infraAsset.list()).data,
  });

  useEffect(() => {
    if (pendingOpenId && (listQ.data ?? []).length > 0) {
      const item = (listQ.data ?? []).find((r) => r.id === pendingOpenId);
      if (item) {
        setEditing(item);
        onConsumeAction?.();
      }
    } else if (pendingCreateAssetId) {
      setCreateInitial({ linked_asset_id: pendingCreateAssetId });
      setShowCreate(true);
      onConsumeAction?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, pendingCreateAssetId, listQ.data]);

  const createM = useMutation({
    mutationFn: (data: Partial<IacaItem>) => criticalityApi.infraAsset.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
      setShowCreate(false);
    },
  });
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<IacaItem> }) =>
      criticalityApi.infraAsset.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
      setEditing(null);
    },
  });
  const deleteM = useMutation({
    mutationFn: (id: number) => criticalityApi.infraAsset.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] }),
  });

  const items = listQ.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          Infrastructure Asset Criticality Assessment
        </h2>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New IACA item
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Infrastructure Asset</th>
              <th className="px-3 py-2">Linked Asset</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Custodian</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2">Criticality</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listQ.isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-gray-500">
                  No items yet. Click <em>New IACA item</em> to add one.
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 align-top">
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    {r.make_model && <p className="text-[11px] text-gray-500">{r.make_model}</p>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {r.linked_asset_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {r.location || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {r.custodian_user_name || r.custodian_name || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-right text-sm font-mono text-gray-900">
                    {r.total_score != null ? r.total_score.toFixed(2) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <BandBadge level={r.criticality_level || null} />
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${r.name}"? This cannot be undone.`)) {
                          deleteM.mutate(r.id);
                        }
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(showCreate || editing) && (
        <IacaDrawer
          initial={editing ?? createInitial}
          isEditing={!!editing}
          isPending={createM.isPending || updateM.isPending}
          onClose={() => {
            setShowCreate(false);
            setEditing(null);
            setCreateInitial({});
          }}
          onSubmit={(data) => {
            if (editing && editing.id) {
              updateM.mutate({ id: editing.id, data });
            } else {
              createM.mutate(data);
            }
          }}
        />
      )}
    </section>
  );
}

// ─── Reusable picker bits ────────────────────────────────────────────────

function useUsers() {
  return useQuery<CriticalityUserOption[]>({
    queryKey: ['criticality.users'],
    queryFn: async () => (await criticalityApi.listUsers()).data,
    staleTime: 5 * 60_000,
  });
}

function useAssets(search: string) {
  // Debounce 250ms so each keystroke doesn't fire a request.
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  return useQuery<CriticalityAssetOption[]>({
    queryKey: ['criticality.assets', q],
    queryFn: async () =>
      (await criticalityApi.listAssets(q ? { search: q } : undefined)).data,
    staleTime: 60_000,
  });
}

function UserPicker({
  value,
  onChange,
  onPick,
  placeholder = '— Unassigned —',
}: {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  /** Fired with the picked user so the parent can auto-fill contact fields. */
  onPick?: (user: CriticalityUserOption | null) => void;
  placeholder?: string;
}) {
  const usersQ = useUsers();
  const users = usersQ.data ?? [];
  return (
    <select
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const next = e.target.value === '' ? null : Number(e.target.value);
        onChange(next);
        onPick?.(next == null ? null : users.find((u) => u.id === next) ?? null);
      }}
      className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    >
      <option value="">{placeholder}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.display_name}
          {u.email ? ` (${u.email})` : ''}
        </option>
      ))}
    </select>
  );
}

function AssetPicker({
  value,
  onChange,
  onPick,
}: {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  /** Fired with the picked asset so the parent can show / use other details. */
  onPick?: (asset: CriticalityAssetOption | null) => void;
}) {
  // Combobox / searchable dropdown — single control with type-to-filter,
  // click-outside-to-close, keyboard escape, and a clear button. Replaces
  // the previous two-input layout (separate search + native <select>).
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const assetsQ = useAssets(search);
  const assets = assetsQ.data ?? [];

  // Selected label — fetch the single asset by id so we can render its
  // name even when the active search filters it out of the live list.
  // Cheap: it's one /assets call with a tiny payload.
  const selectedQ = useQuery({
    queryKey: ['criticality.asset.byId', value],
    queryFn: async () => {
      const list = (await criticalityApi.listAssets()).data;
      return list.find((a) => a.id === value) ?? null;
    },
    enabled: typeof value === 'number' && value > 0,
    staleTime: 5 * 60_000,
  });
  const selected = selectedQ.data ?? null;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Focus the search box when the menu opens.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const selectAsset = (asset: CriticalityAssetOption | null) => {
    onChange(asset?.id ?? null);
    onPick?.(asset);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-sm transition-colors ${
          open
            ? 'border-blue-500 ring-1 ring-blue-500'
            : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        {selected ? (
          <span className="min-w-0 flex-1 flex items-center gap-1.5 text-left">
            <Server className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            <span className="truncate text-gray-900">{selected.name}</span>
            {selected.asset_type && (
              <span className="text-[10px] text-gray-400 uppercase shrink-0">{selected.asset_type}</span>
            )}
            {selected.criticality && (
              <span className="text-[10px] text-gray-500 uppercase shrink-0">· {selected.criticality}</span>
            )}
          </span>
        ) : (
          <span className="min-w-0 flex-1 flex items-center gap-1.5 text-left text-gray-500">
            <Server className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            Select linked IT asset…
          </span>
        )}
        {value != null && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              selectAsset(null);
            }}
            className="shrink-0 inline-flex items-center justify-center h-4 w-4 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            title="Clear linked asset"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="relative border-b border-gray-100">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type to search assets by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
              className="w-full pl-8 pr-2 py-2 text-xs focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => selectAsset(null)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                value == null ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <X className="h-3 w-3 text-gray-400" />
              No linked asset
              {value == null && <Check className="ml-auto h-3 w-3 text-blue-600" />}
            </button>

            {assetsQ.isLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : assets.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-500 text-center">
                {search.trim()
                  ? `No assets matching "${search.trim()}"`
                  : 'No IT assets in this tenant yet.'}
              </p>
            ) : (
              assets.map((a) => {
                const isSelected = a.id === value;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => selectAsset(a)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      isSelected ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Server className={`h-3 w-3 shrink-0 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className="truncate font-medium">{a.name}</span>
                    {a.asset_type && (
                      <span className="text-[10px] text-gray-400 uppercase shrink-0">{a.asset_type}</span>
                    )}
                    {a.criticality && (
                      <span className="text-[10px] text-gray-500 uppercase shrink-0">· {a.criticality}</span>
                    )}
                    {isSelected && <Check className="ml-auto h-3 w-3 text-blue-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          {assets.length === 200 && (
            <p className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-100 bg-gray-50">
              Showing first 200 results — refine your search to narrow.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tiny labelled-field helpers used by both drawers ────────────────────

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-[11px] font-medium text-gray-700 mb-1">
      {children}
      {hint && <span className="ml-1 text-[10px] text-gray-400 font-normal">{hint}</span>}
    </label>
  );
}

function TextField({
  value, onChange, placeholder, type = 'text',
}: {
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    />
  );
}

function ScoreField({
  criterion, value, onChange,
}: {
  criterion: ScoringCriterion;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <FieldLabel hint={criterion.weight ? `weight ${criterion.weight}%` : undefined}>
        {criterion.label}
      </FieldLabel>
      <select
        value={value == null ? '' : String(value)}
        onChange={(e) =>
          onChange(e.target.value === '' ? null : Number(e.target.value))
        }
        className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      >
        <option value="">—</option>
        {criterion.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {criterion.description && (
        <p className="mt-0.5 text-[10px] text-gray-500">{criterion.description}</p>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof FileText; children: React.ReactNode }) {
  return (
    <fieldset className="border border-gray-200 rounded-lg p-4">
      <legend className="px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 inline-flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

// Generic contact-block builder used 3x in each drawer.
function ContactBlock<T extends Record<string, unknown>>({
  draft, setDraft, roleLabel, userIdKey, nameKey, designationKey, phoneKey, emailKey,
}: {
  draft: T;
  setDraft: (next: T) => void;
  roleLabel: string;
  userIdKey: keyof T;
  nameKey: keyof T;
  designationKey: keyof T;
  phoneKey: keyof T;
  emailKey: keyof T;
}) {
  const fillFromUser = useCallback(
    (user: CriticalityUserOption | null) => {
      const next = { ...draft } as Record<string, unknown>;
      next[userIdKey as string] = user?.id ?? null;
      if (user) {
        // Auto-populate when picking — but only into empty fields so we
        // don't overwrite user-entered overrides.
        if (!draft[nameKey]) next[nameKey as string] = user.display_name;
        if (!draft[designationKey] && user.designation) next[designationKey as string] = user.designation;
        if (!draft[emailKey] && user.email) next[emailKey as string] = user.email;
      }
      setDraft(next as T);
    },
    [draft, setDraft, userIdKey, nameKey, designationKey, emailKey],
  );

  return (
    <Section title={roleLabel} icon={UserCheck}>
      <div className="md:col-span-2">
        <FieldLabel hint="select from system users">{roleLabel}</FieldLabel>
        <UserPicker
          value={draft[userIdKey] as number | null | undefined}
          onChange={(id) => setDraft({ ...draft, [userIdKey]: id } as T)}
          onPick={fillFromUser}
        />
      </div>
      <div>
        <FieldLabel>Name</FieldLabel>
        <TextField
          value={draft[nameKey] as string | undefined}
          onChange={(v) => setDraft({ ...draft, [nameKey]: v } as T)}
        />
      </div>
      <div>
        <FieldLabel>Designation</FieldLabel>
        <TextField
          value={draft[designationKey] as string | undefined}
          onChange={(v) => setDraft({ ...draft, [designationKey]: v } as T)}
        />
      </div>
      <div>
        <FieldLabel>Contact (Ext / Cell)</FieldLabel>
        <TextField
          value={draft[phoneKey] as string | undefined}
          onChange={(v) => setDraft({ ...draft, [phoneKey]: v } as T)}
        />
      </div>
      <div>
        <FieldLabel>Email</FieldLabel>
        <TextField
          type="email"
          value={draft[emailKey] as string | undefined}
          onChange={(v) => setDraft({ ...draft, [emailKey]: v } as T)}
        />
      </div>
    </Section>
  );
}

// Small helper: pick the non-empty value when overwriting from an asset.
// Picking an asset OVERWRITES the field; null/empty from the asset is a
// no-op so we don't blank out user-typed values for fields the asset
// doesn't know about.
function pickValue<T>(assetValue: T | null | undefined, currentValue: T | null | undefined): T | null | undefined {
  if (assetValue === null || assetValue === undefined) return currentValue;
  if (typeof assetValue === 'string' && assetValue.trim() === '') return currentValue;
  return assetValue;
}

// ─── ISCA drawer ─────────────────────────────────────────────────────────

function IscaDrawer({
  initial, isEditing, isPending, onClose, onSubmit,
}: {
  initial: Partial<IscaItem>;
  isEditing: boolean;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<IscaItem>) => void;
}) {
  const [draft, setDraft] = useState<Partial<IscaItem>>({ ...initial });
  const [tab, setTab] = useState<DrawerTab>('fields');
  const total = useMemo(() => iscaTotal(draft as Record<string, number | null | undefined>), [draft]);
  const band = useMemo(() => iscaBand(total), [total]);

  // Re-fetch the latest server state when the drawer is opened on an
  // existing row. Without this the approval pills + counts get stale
  // every time another tab mutates state.
  const detailQ = useQuery({
    queryKey: ['criticality.isca.detail', initial.id],
    queryFn: async () => (await criticalityApi.infoSystem.get(initial.id as number)).data,
    enabled: isEditing && !!initial.id,
  });
  const live: Partial<IscaItem> = detailQ.data ?? initial;

  const handleAssetPick = useCallback((asset: CriticalityAssetOption | null) => {
    setDraft((p) => {
      const next: Partial<IscaItem> = { ...p, linked_asset_id: asset?.id ?? null };
      if (!asset) return next;
      next.name = pickValue(asset.name, p.name) as string | undefined;
      next.description = pickValue(asset.description, p.description);
      next.address = pickValue(asset.address, p.address);
      const bo = asset.business_owner;
      if (bo) {
        next.business_owner_user_id = pickValue(bo.user_id, p.business_owner_user_id);
        next.business_owner_name = pickValue(bo.name, p.business_owner_name);
        next.business_owner_designation = pickValue(bo.designation, p.business_owner_designation);
        next.business_owner_email = pickValue(bo.email, p.business_owner_email);
        next.business_owner_phone = pickValue(bo.phone, p.business_owner_phone);
      }
      return next;
    });
  }, []);

  const editLocked = isEditing && _editLocked(live.approval_status);

  return (
    <Drawer
      title={isEditing ? `Edit ISCA: ${initial.name ?? `#${initial.id}`}` : 'New Information System Criticality Assessment'}
      onClose={onClose}
      onSubmit={() => onSubmit(draft)}
      isPending={isPending}
      saveDisabled={editLocked}
      saveHidden={isEditing && tab !== 'fields'}
      headerExtra={isEditing ? <StatusPill status={live.approval_status || 'draft'} /> : null}
      footerExtra={
        <div className="text-[11px] text-gray-600 flex items-center gap-3 flex-wrap">
          <span>
            Total: <span className="font-mono font-semibold text-gray-900">{total ?? '—'}</span>
          </span>
          <BandBadge level={band} />
          {isEditing && initial.id && <FooterActions kind="isca" item={live as IscaItem} />}
        </div>
      }
    >
      {isEditing && initial.id && (
        <>
          <ApprovalBar
            kind="isca"
            item={live as ApprovalCapableItem}
            currentUserId={useCurrentUserId()}
            canCisoApprove={useCanCiso()}
          />
          <DrawerTabBar
            tab={tab} onChange={setTab}
            commentCount={live.comment_count ?? 0}
            evidenceCount={live.evidence_count ?? 0}
          />
        </>
      )}

      {(!isEditing || tab === 'fields') && (
        <>
          {editLocked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              This assessment is currently <strong>{live.approval_status}</strong>. Return it to
              the assessor before editing.
            </div>
          )}
          <Section title="Information System" icon={FileText}>
            <div className="md:col-span-2">
              <FieldLabel hint="required">Name of Information System</FieldLabel>
              <TextField value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            </div>
            <div className="md:col-span-2">
              <FieldLabel hint="optional · pulls from IT Asset Inventory">Linked IT asset</FieldLabel>
              <AssetPicker
                value={draft.linked_asset_id}
                onChange={(id) => setDraft({ ...draft, linked_asset_id: id })}
                onPick={handleAssetPick}
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>System Description</FieldLabel>
              <textarea
                rows={2}
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <FieldLabel>Address (URL or IP)</FieldLabel>
              <TextField value={draft.address} onChange={(v) => setDraft({ ...draft, address: v })} />
            </div>
            <div>
              <FieldLabel>Date of Assessment</FieldLabel>
              <TextField
                type="date"
                value={draft.date_of_assessment as string | undefined}
                onChange={(v) => setDraft({ ...draft, date_of_assessment: v || null })}
              />
            </div>
          </Section>

          <ContactBlock<Partial<IscaItem>>
            draft={draft} setDraft={setDraft}
            roleLabel="Business Owner"
            userIdKey="business_owner_user_id"
            nameKey="business_owner_name"
            designationKey="business_owner_designation"
            phoneKey="business_owner_phone"
            emailKey="business_owner_email"
          />
          <ContactBlock<Partial<IscaItem>>
            draft={draft} setDraft={setDraft}
            roleLabel="Service / Delivery Owner"
            userIdKey="service_owner_user_id"
            nameKey="service_owner_name"
            designationKey="service_owner_designation"
            phoneKey="service_owner_phone"
            emailKey="service_owner_email"
          />
          <ContactBlock<Partial<IscaItem>>
            draft={draft} setDraft={setDraft}
            roleLabel="Assessor (IT / IS)"
            userIdKey="assessor_user_id"
            nameKey="assessor_name"
            designationKey="assessor_designation"
            phoneKey="assessor_phone"
            emailKey="assessor_email"
          />

          <Section title="Scoring criteria" icon={Sparkles}>
            {ISCA_CRITERIA.map((c) => (
              <ScoreField
                key={c.field}
                criterion={c}
                value={(draft as Record<string, number | null | undefined>)[c.field]}
                onChange={(v) => setDraft({ ...draft, [c.field]: v })}
              />
            ))}
          </Section>

          <Section title="Comments" icon={Layers}>
            <div className="md:col-span-2">
              <textarea
                rows={3}
                value={draft.comments ?? ''}
                onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
                placeholder="Additional comments or justification for scores…"
                className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </Section>
        </>
      )}

      {isEditing && initial.id && tab === 'comments' && (
        <CommentsPanel kind="isca" itemId={initial.id as number} />
      )}
      {isEditing && initial.id && tab === 'evidence' && (
        <EvidencePanel kind="isca" itemId={initial.id as number} />
      )}
      {isEditing && initial.id && tab === 'activity' && (
        <ActivityPanel kind="isca" itemId={initial.id as number} />
      )}
    </Drawer>
  );
}

// ─── IACA drawer ─────────────────────────────────────────────────────────

function IacaDrawer({
  initial, isEditing, isPending, onClose, onSubmit,
}: {
  initial: Partial<IacaItem>;
  isEditing: boolean;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<IacaItem>) => void;
}) {
  const [draft, setDraft] = useState<Partial<IacaItem>>({ ...initial });
  const [tab, setTab] = useState<DrawerTab>('fields');
  const total = useMemo(() => iacaTotal(draft as Record<string, number | null | undefined>), [draft]);
  const band = useMemo(() => iacaBand(total), [total]);

  const detailQ = useQuery({
    queryKey: ['criticality.iaca.detail', initial.id],
    queryFn: async () => (await criticalityApi.infraAsset.get(initial.id as number)).data,
    enabled: isEditing && !!initial.id,
  });
  const live: Partial<IacaItem> = detailQ.data ?? initial;

  const handleAssetPick = useCallback((asset: CriticalityAssetOption | null) => {
    setDraft((p) => {
      const next: Partial<IacaItem> = { ...p, linked_asset_id: asset?.id ?? null };
      if (!asset) return next;
      next.name = pickValue(asset.name, p.name) as string | undefined;
      next.description = pickValue(asset.description, p.description);
      next.location = pickValue(asset.location, p.location);
      next.make_model = pickValue(asset.vendor, p.make_model);
      next.associated_ips = pickValue(asset.associated_ips, p.associated_ips);
      const co = asset.primary_owner;
      if (co) {
        next.custodian_user_id = pickValue(co.user_id, p.custodian_user_id);
        next.custodian_name = pickValue(co.name, p.custodian_name);
        next.custodian_designation = pickValue(co.designation, p.custodian_designation);
        next.custodian_email = pickValue(co.email, p.custodian_email);
        next.custodian_phone = pickValue(co.phone, p.custodian_phone);
      }
      const ad = asset.secondary_owner;
      if (ad) {
        next.administrator_user_id = pickValue(ad.user_id, p.administrator_user_id);
        next.administrator_name = pickValue(ad.name, p.administrator_name);
        next.administrator_designation = pickValue(ad.designation, p.administrator_designation);
        next.administrator_email = pickValue(ad.email, p.administrator_email);
        next.administrator_phone = pickValue(ad.phone, p.administrator_phone);
      }
      return next;
    });
  }, []);

  const editLocked = isEditing && _editLocked(live.approval_status);

  return (
    <Drawer
      title={isEditing ? `Edit IACA: ${initial.name ?? `#${initial.id}`}` : 'New Infrastructure Asset Criticality Assessment'}
      onClose={onClose}
      onSubmit={() => onSubmit(draft)}
      isPending={isPending}
      saveDisabled={editLocked}
      saveHidden={isEditing && tab !== 'fields'}
      headerExtra={isEditing ? <StatusPill status={live.approval_status || 'draft'} /> : null}
      footerExtra={
        <div className="text-[11px] text-gray-600 flex items-center gap-3 flex-wrap">
          <span>
            Total: <span className="font-mono font-semibold text-gray-900">{total != null ? total.toFixed(2) : '—'}</span>
          </span>
          <BandBadge level={band} />
          {isEditing && initial.id && <FooterActions kind="iaca" item={live as IacaItem} />}
        </div>
      }
    >
      {isEditing && initial.id && (
        <>
          <ApprovalBar
            kind="iaca"
            item={live as ApprovalCapableItem}
            currentUserId={useCurrentUserId()}
            canCisoApprove={useCanCiso()}
          />
          <DrawerTabBar
            tab={tab} onChange={setTab}
            commentCount={live.comment_count ?? 0}
            evidenceCount={live.evidence_count ?? 0}
          />
        </>
      )}

      {(!isEditing || tab === 'fields') && (<>
      {editLocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This assessment is currently <strong>{live.approval_status}</strong>. Return it to the
          assessor before editing.
        </div>
      )}
      <Section title="Infrastructure Asset" icon={Server}>
        <div className="md:col-span-2">
          <FieldLabel hint="required">Name of Infrastructure Asset</FieldLabel>
          <TextField
            value={draft.name}
            onChange={(v) => setDraft({ ...draft, name: v })}
          />
        </div>
        <div className="md:col-span-2">
          <FieldLabel hint="optional · pulls from IT Asset Inventory">Linked IT asset</FieldLabel>
          <AssetPicker
            value={draft.linked_asset_id}
            onChange={(id) => setDraft({ ...draft, linked_asset_id: id })}
            onPick={handleAssetPick}
          />
        </div>
        <div className="md:col-span-2">
          <FieldLabel>Purpose / Description</FieldLabel>
          <textarea
            rows={2}
            value={draft.description ?? ''}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <FieldLabel>Make / Model</FieldLabel>
          <TextField
            value={draft.make_model}
            onChange={(v) => setDraft({ ...draft, make_model: v })}
          />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <TextField
            value={draft.location}
            onChange={(v) => setDraft({ ...draft, location: v })}
          />
        </div>
        <div className="md:col-span-2">
          <FieldLabel>Associated IPs / URLs</FieldLabel>
          <textarea
            rows={2}
            value={draft.associated_ips ?? ''}
            onChange={(e) => setDraft({ ...draft, associated_ips: e.target.value })}
            placeholder="Internal + external IPs and management URLs"
            className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <FieldLabel>Fault Tolerance / HA</FieldLabel>
          <select
            value={draft.fault_tolerance ?? ''}
            onChange={(e) => setDraft({ ...draft, fault_tolerance: e.target.value || null })}
            className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="partial">Partial</option>
            <option value="no">No</option>
            <option value="na">N/A</option>
          </select>
        </div>
        <div>
          <FieldLabel>Date of Assessment</FieldLabel>
          <TextField
            type="date"
            value={draft.date_of_assessment as string | undefined}
            onChange={(v) => setDraft({ ...draft, date_of_assessment: v || null })}
          />
        </div>
      </Section>

      <ContactBlock<Partial<IacaItem>>
        draft={draft}
        setDraft={setDraft}
        roleLabel="Asset Custodian"
        userIdKey="custodian_user_id"
        nameKey="custodian_name"
        designationKey="custodian_designation"
        phoneKey="custodian_phone"
        emailKey="custodian_email"
      />
      <ContactBlock<Partial<IacaItem>>
        draft={draft}
        setDraft={setDraft}
        roleLabel="Asset Administrator"
        userIdKey="administrator_user_id"
        nameKey="administrator_name"
        designationKey="administrator_designation"
        phoneKey="administrator_phone"
        emailKey="administrator_email"
      />
      <ContactBlock<Partial<IacaItem>>
        draft={draft}
        setDraft={setDraft}
        roleLabel="Assessor (IT / IS)"
        userIdKey="assessor_user_id"
        nameKey="assessor_name"
        designationKey="assessor_designation"
        phoneKey="assessor_phone"
        emailKey="assessor_email"
      />

      <Section title="Weighted scoring criteria" icon={Sparkles}>
        {IACA_CRITERIA.map((c) => (
          <ScoreField
            key={c.field}
            criterion={c}
            value={(draft as Record<string, number | null | undefined>)[c.field]}
            onChange={(v) => setDraft({ ...draft, [c.field]: v })}
          />
        ))}
      </Section>

      <Section title="Comments" icon={Layers}>
        <div className="md:col-span-2">
          <textarea
            rows={3}
            value={draft.comments ?? ''}
            onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
            placeholder="Additional comments or justification for scores…"
            className="block w-full text-sm rounded-md border border-gray-300 bg-white text-slate-900 px-2 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </Section>
      </>)}

      {isEditing && initial.id && tab === 'comments' && (
        <CommentsPanel kind="iaca" itemId={initial.id as number} />
      )}
      {isEditing && initial.id && tab === 'evidence' && (
        <EvidencePanel kind="iaca" itemId={initial.id as number} />
      )}
      {isEditing && initial.id && tab === 'activity' && (
        <ActivityPanel kind="iaca" itemId={initial.id as number} />
      )}
    </Drawer>
  );
}

// ─── Drawer-shared helpers used by both kinds ────────────────────────────

const _APPROVAL_LOCKED = new Set([
  'submitted', 'business_owner_review', 'ciso_review', 'approved',
]);
function _editLocked(status: string | null | undefined): boolean {
  return _APPROVAL_LOCKED.has(status || 'draft');
}

function useCurrentUserId(): number | null {
  const q = useCurrentUser();
  return q.data?.id ?? null;
}

function useCanCiso(): boolean {
  const q = useCurrentUser();
  return hasPermission(q.data, 'assets:criticality_assessments:approve_ciso');
}

function DrawerTabBar({
  tab, onChange, commentCount, evidenceCount,
}: {
  tab: DrawerTab;
  onChange: (t: DrawerTab) => void;
  commentCount: number;
  evidenceCount: number;
}) {
  const tabs: Array<{ key: DrawerTab; label: string; icon: typeof FileText; count?: number }> = [
    { key: 'fields',   label: 'Fields',   icon: FileText },
    { key: 'comments', label: 'Comments', icon: MessageSquare, count: commentCount },
    { key: 'evidence', label: 'Evidence', icon: Paperclip,    count: evidenceCount },
    { key: 'activity', label: 'Audit Log', icon: Activity },
  ];
  return (
    <div className="border-b border-gray-200 -mx-5 px-5">
      <nav className="flex gap-1 -mb-px">
        {tabs.map(({ key, label, icon: Icon, count }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                active
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {typeof count === 'number' && count > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-slate-200 text-[9px] font-semibold text-slate-700">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function FooterActions({
  kind, item,
}: {
  kind: 'isca' | 'iaca';
  item: IscaItem | IacaItem;
}) {
  const qc = useQueryClient();
  const status = item.approval_status || 'draft';
  const band = item.criticality_level;
  const canPromote = status === 'approved'
    && (band === 'mission_critical' || band === 'high')
    && !item.linked_risk_id;
  const canFollowUp = status === 'approved'
    && (band === 'mission_critical' || band === 'high');

  const promoteM = useMutation({
    mutationFn: () => criticalityApi.promote.toRisk(kind, item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
      qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
      qc.invalidateQueries({ queryKey: ['criticality.isca.detail', item.id] });
      qc.invalidateQueries({ queryKey: ['criticality.iaca.detail', item.id] });
      qc.invalidateQueries({ queryKey: ['criticality.activity', kind, item.id] });
    },
  });

  const followUpM = useMutation({
    mutationFn: () => criticalityApi.followUpTask(kind, item.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['criticality.activity', kind, item.id] });
      if (r?.data?.task_id) {
        alert(`Follow-up task #${r.data.task_id} created.`);
      }
    },
  });

  const exportUrl = criticalityApi.exportXlsxUrl(kind, item.id);
  const handleExport = async () => {
    try {
      const r = await apiClient.get(exportUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.name || `${kind}-${item.id}`}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed.');
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      {item.linked_risk_id ? (
        <Link
          href={`/erm/risks/${item.linked_risk_id}`}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
        >
          <ShieldCheck className="h-3 w-3" />
          → Risk #{item.linked_risk_id}
        </Link>
      ) : (
        <button
          type="button"
          disabled={!canPromote || promoteM.isPending}
          title={canPromote ? 'Promote to Risk Register' : 'Approve & high/mission_critical needed'}
          onClick={() => promoteM.mutate()}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ShieldCheck className="h-3 w-3" />
          Promote to Risk
        </button>
      )}
      <button
        type="button"
        disabled={!canFollowUp || followUpM.isPending}
        title={canFollowUp ? 'Create a Critical Task' : 'Approve & high/mission_critical needed'}
        onClick={() => followUpM.mutate()}
        className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ExternalLink className="h-3 w-3" />
        Follow-up task
      </button>
      <button
        type="button"
        onClick={handleExport}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        title="Download the bank template populated with this data"
      >
        <Download className="h-3 w-3" />
        Export .xlsx
      </button>
      <Link
        href={`/assets/criticality-assessments/${kind}/${item.id}/print`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        title="Print-ready view for PDF export"
      >
        <FileText className="h-3 w-3" />
        Print / PDF
      </Link>
    </span>
  );
}

// ─── Generic drawer chrome ───────────────────────────────────────────────

function Drawer({
  title, children, onClose, onSubmit, isPending, footerExtra,
  saveDisabled = false, saveHidden = false, headerExtra,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
  footerExtra?: React.ReactNode;
  /** Disable Save (e.g. when the assessment is locked mid-review). */
  saveDisabled?: boolean;
  /** Hide Save entirely (e.g. when the drawer is on a non-fields tab). */
  saveHidden?: boolean;
  /** Element rendered next to the title — used for the StatusPill. */
  headerExtra?: React.ReactNode;
}) {
  // Right-side slide-out panel — mirrors the AssetModal at /assets and the
  // existing GovernanceDocument right-slide pattern. Esc closes; the
  // header/body/footer split is identical so the operator's muscle memory
  // carries over from one form to the next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Light backdrop — purely visual cue; clicking it doesn't dismiss
          because mid-edit data loss is more annoying than the dim. */}
      <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full sm:w-[780px] flex-col bg-white shadow-2xl border-l border-slate-200">
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">{title}</h2>
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">{children}</div>
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <div className="min-w-0">{footerExtra}</div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            {!saveHidden && (
              <button
                type="button"
                onClick={onSubmit}
                disabled={isPending || saveDisabled}
                title={saveDisabled ? 'Locked: assessment is under review' : undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
