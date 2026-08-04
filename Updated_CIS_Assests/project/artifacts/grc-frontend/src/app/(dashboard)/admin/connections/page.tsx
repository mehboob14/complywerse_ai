'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { compliancePluginsApi, assetsApi } from '@/lib/api';
import { Key, Shield, Loader2, CheckCircle2, AlertCircle, Edit3 } from 'lucide-react';

// Connections page
// ------------------------------------------------------------------
// Lists every stored agentless credential (IntegrationConnection) and
// shows its scope: tenant_all (default) / asset_list / asset_tag /
// ip_range. Each row resolves live to a count of in-scope assets.
//
// Click "Edit scope" to narrow a cred from "every Linux host in tenant"
// down to "these 3 Linux hosts only". Hassan's ask: one password works
// for the whole fleet, but the operator should be able to say "this
// cred ONLY applies to these specific assets".

type Connection = {
  id: number;
  name: string;
  integration_type: string;
  console_url: string;
  status: string;
  scope_mode: 'tenant_all' | 'asset_list' | 'asset_tag' | 'ip_range';
  scope_value: Record<string, unknown>;
  resolved_asset_count: number;
  last_scope_resolution_count: number | null;
  scope_updated_at: string | null;
};

const SCOPE_LABEL: Record<string, string> = {
  tenant_all: 'All matching assets in tenant',
  asset_list: 'Specific assets',
  asset_tag: 'Assets with tags',
  ip_range: 'IP range',
};

const SCOPE_COLOR: Record<string, string> = {
  tenant_all: 'bg-blue-50 text-blue-700 border-blue-200',
  asset_list: 'bg-violet-50 text-violet-700 border-violet-200',
  asset_tag: 'bg-amber-50 text-amber-700 border-amber-200',
  ip_range: 'bg-teal-50 text-teal-700 border-teal-200',
};

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-plugins', 'connections'],
    queryFn: () => compliancePluginsApi.listConnections().then((r: any) => r.data),
  });

  const connections: Connection[] = data?.connections || [];
  const totalAssets: number = data?.tenant_asset_total ?? 0;
  const editing = connections.find(c => c.id === editingId) || null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <Key className="h-6 w-6 text-blue-600" />
          Connections (agentless credentials)
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Every stored agentless credential and the set of assets it applies to. A credential entered once works for the whole tenant by default; narrow it to specific assets, tags, or an IP range with <strong>Edit scope</strong>.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total credentials" value={connections.length} hint="agentless integrations" />
        <StatCard label="Tenant assets" value={totalAssets} hint="across all OS" />
        <StatCard
          label="Scoped credentials"
          value={connections.filter(c => c.scope_mode !== 'tenant_all').length}
          hint="not using tenant-all default"
        />
        <StatCard
          label="Avg coverage"
          value={connections.length ? Math.round(connections.reduce((a, c) => a + c.resolved_asset_count, 0) / connections.length * 10) / 10 : 0}
          hint="assets per credential"
        />
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connections…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load connections. Backend reachable?
        </div>
      )}

      {/* Connections table */}
      {!isLoading && connections.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <Key className="mx-auto h-10 w-10 text-gray-300" />
          <h3 className="mt-3 text-sm font-medium text-gray-900">No agentless credentials yet</h3>
          <p className="mt-1 text-xs text-gray-500">
            Add one via the Connect Wizard (Agents page → Connect on a target type).
          </p>
        </div>
      )}

      {!isLoading && connections.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Scope</th>
                <th className="px-3 py-2 text-right font-medium">In scope</th>
                <th className="px-3 py-2 text-right font-medium">Last scoped</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {connections.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{c.integration_type}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-700">{c.console_url}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${SCOPE_COLOR[c.scope_mode]}`}>
                      {SCOPE_LABEL[c.scope_mode]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800">
                    {c.resolved_asset_count} / {totalAssets}
                  </td>
                  <td className="px-3 py-2 text-right text-[11px] text-gray-500">
                    {c.scope_updated_at ? new Date(c.scope_updated_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setEditingId(c.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <Edit3 className="h-3 w-3" /> Edit scope
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ScopeEditor
          connection={editing}
          totalAssets={totalAssets}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['compliance-plugins', 'connections'] });
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-500">{hint}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      <AlertCircle className="h-3 w-3" /> {status}
    </span>
  );
}

// ─── Scope editor modal ─────────────────────────────────────────────
function ScopeEditor({
  connection, totalAssets, onClose, onSaved,
}: {
  connection: Connection;
  totalAssets: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<Connection['scope_mode']>(connection.scope_mode);
  const [assetIdsRaw, setAssetIdsRaw] = useState<string>(
    (connection.scope_value?.asset_ids as number[] | undefined)?.join(', ') || ''
  );
  const [tagsRaw, setTagsRaw] = useState<string>(
    (connection.scope_value?.tags as string[] | undefined)?.join(', ') || ''
  );
  const [cidrsRaw, setCidrsRaw] = useState<string>(
    (connection.scope_value?.cidrs as string[] | undefined)?.join(', ') || ''
  );
  const [preview, setPreview] = useState<{ count: number; sample: any[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Load asset list for the picker
  const { data: assetsResp } = useQuery({
    queryKey: ['assets', 'list-for-scope'],
    queryFn: () => assetsApi.getAll().then((r: any) => r.data),
  });
  const assets: any[] = Array.isArray(assetsResp)
    ? assetsResp
    : (assetsResp?.assets || assetsResp?.items || []);

  const buildValue = (): Record<string, unknown> => {
    if (mode === 'asset_list') {
      const ids = assetIdsRaw.split(/[\s,]+/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
      return { asset_ids: ids };
    }
    if (mode === 'asset_tag') {
      return { tags: tagsRaw.split(/[,\n]/).map(s => s.trim()).filter(Boolean) };
    }
    if (mode === 'ip_range') {
      return { cidrs: cidrsRaw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean) };
    }
    return {};
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const r = await compliancePluginsApi.previewConnectionScope(connection.id, {
        scope_mode: mode, scope_value: buildValue(),
      });
      setPreview(r.data);
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => { runPreview(); /* eslint-disable-next-line */ }, [mode, assetIdsRaw, tagsRaw, cidrsRaw]);

  const saveMut = useMutation({
    mutationFn: () => compliancePluginsApi.setConnectionScope(connection.id, {
      scope_mode: mode, scope_value: buildValue(),
    }),
    onSuccess: onSaved,
  });

  const toggleAsset = (id: number) => {
    const ids = new Set(
      assetIdsRaw.split(/[\s,]+/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
    );
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    setAssetIdsRaw(Array.from(ids).join(', '));
  };

  const selectedIds = new Set(
    assetIdsRaw.split(/[\s,]+/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Edit scope: {connection.name}</h2>
            <p className="text-xs text-gray-500">{connection.integration_type} · {connection.console_url}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button>
        </div>

        <div className="space-y-4 p-5">
          {/* Mode picker */}
          <div>
            <label className="text-xs font-medium text-gray-700">Scope mode</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['tenant_all', 'asset_list', 'asset_tag', 'ip_range'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md border px-3 py-2 text-left text-xs ${
                    mode === m ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-gray-900">{SCOPE_LABEL[m]}</div>
                  <div className="text-[10px] text-gray-500">
                    {m === 'tenant_all' && 'Cred works on every matching asset (default)'}
                    {m === 'asset_list' && 'Only these specific assets'}
                    {m === 'asset_tag' && 'Any asset carrying one of these tags'}
                    {m === 'ip_range' && 'Assets whose IP falls in a CIDR range'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Mode-specific input */}
          {mode === 'asset_list' && (
            <div>
              <label className="text-xs font-medium text-gray-700">Pick assets (or paste IDs)</label>
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-200">
                {assets.length === 0 ? (
                  <div className="p-3 text-center text-xs text-gray-500">No assets in tenant</div>
                ) : (
                  assets.map(a => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 last:border-b-0 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleAsset(a.id)}
                      />
                      <span className="text-xs font-medium text-gray-900">{a.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-gray-500">{a.host_name || a.ip_address || `#${a.id}`}</span>
                      {a.os_normalized && <span className="font-mono text-[10px] text-blue-600">{a.os_normalized}</span>}
                    </label>
                  ))
                )}
              </div>
              <input
                value={assetIdsRaw}
                onChange={e => setAssetIdsRaw(e.target.value)}
                placeholder="Or paste asset IDs: 12, 34, 56"
                className="mt-2 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
              />
            </div>
          )}
          {mode === 'asset_tag' && (
            <div>
              <label className="text-xs font-medium text-gray-700">Tags (comma-separated)</label>
              <input
                value={tagsRaw}
                onChange={e => setTagsRaw(e.target.value)}
                placeholder="DMZ, production, treasury-zone"
                className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
              />
              <p className="mt-1 text-[10px] text-gray-500">Asset matches if its tags include any of these (case-insensitive).</p>
            </div>
          )}
          {mode === 'ip_range' && (
            <div>
              <label className="text-xs font-medium text-gray-700">CIDR ranges (comma-separated)</label>
              <input
                value={cidrsRaw}
                onChange={e => setCidrsRaw(e.target.value)}
                placeholder="10.20.0.0/16, 10.21.0.0/24"
                className="mt-2 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
              />
              <p className="mt-1 text-[10px] text-gray-500">Asset matches if its ip_address falls in any of these CIDRs.</p>
            </div>
          )}

          {/* Live preview */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700">
                {previewing && <Loader2 className="inline h-3 w-3 animate-spin" />} Preview: <strong>{preview?.count ?? 0}</strong> of {totalAssets} assets will be in scope
              </span>
            </div>
            {preview && preview.sample.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-gray-700">
                {preview.sample.map((a: any) => (
                  <li key={a.id} className="font-mono">• {a.name} <span className="text-gray-500">({a.host_name || a.ip_address})</span></li>
                ))}
                {preview.count > preview.sample.length && (
                  <li className="text-gray-500">… and {preview.count - preview.sample.length} more</li>
                )}
              </ul>
            )}
            {preview && preview.count === 0 && (
              <div className="mt-1 text-[11px] text-amber-700">
                <Shield className="inline h-3 w-3" /> Heads up: 0 assets in scope means this credential won't run on anything.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saveMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save scope
          </button>
        </div>
      </div>
    </div>
  );
}
