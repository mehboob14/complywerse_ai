'use client';

import React, { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import { assetsApi } from '@/lib/api';
import { CriticalityCoverageWidget } from '@/components/assets/CriticalityCoverageWidget';
import { ITAsset } from '@/types';
import { PageLoader } from '@/components/ui';
import { AssetsWorkspace } from './_workspace/AssetsWorkspace';
import InventoryScorecard from '@/components/dashboard/InventoryScorecard';
import InventoryRedesign from './_workspace/InventoryRedesign';
import {
  Loader2,
  AlertCircle,
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Download,
  Plus,
} from 'lucide-react';
// CIS Benchmark now lives as a tab inside IT Asset Inventory (merged from the
// former standalone /compliance-overview page). Render just the overview body —
// not the default export's own Overview/Rules tab strip, which the design drops.
import { OverviewTabContent as CisBenchmarkView } from '../compliance-overview/_cis-overview';
// Design-handoff theme (warm cream + IBM Plex), scoped under .asset-suite.
import './_suite/asset-suite.css';
import { InventoryStats } from './_suite/InventoryStats';

type StatusFilter = 'all' | 'active' | 'inactive' | 'decommissioned';
type CriticalityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

// The add/edit popup is shared with /cyber-assurance/assets: one form, one set of custom fields.
import { AssetModal } from '../cyber-assurance/assets/AssetModal';

export default function AssetsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Inventory ↔ CIS Benchmark tab (CIS merged in from /compliance-overview).
  const [activeView, setActiveView] = useState<'inventory' | 'cis'>(
    searchParams.get('tab') === 'cis' ? 'cis' : 'inventory'
  );
  const switchView = (v: 'inventory' | 'cis') => {
    setActiveView(v);
    router.replace(v === 'cis' ? '/assets?tab=cis' : '/assets', { scroll: false });
  };
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('assets:asset_inventory:create');
  const canEdit = hasPermission('assets:asset_inventory:edit');
  const canDelete = hasPermission('assets:asset_inventory:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [criticalityFilter, setCriticalityFilter] = useState<CriticalityFilter>('all');
  // Asset-type facet (workspace toolbar). Additive client-side filter — 'all'
  // is a no-op so the default view is unchanged.
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // Phase 5 filters. Client-side only — the list is small enough that we
  // don't need a round-trip per filter change, and the existing list query
  // doesn't accept these params yet by design (default sort preserved).
  const [lifecycleFilter, setLifecycleFilter] = useState<string>('all');
  const [classificationFilter, setClassificationFilter] = useState<string>('all');
  const [staleOnly, setStaleOnly] = useState<boolean>(false);
  // Phase 7 — source filter (which cloud / scanner discovered this asset).
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  // ITAM parity — deployment-environment facet.
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<ITAsset | null>(null);
  const [expandedAsset, setExpandedAsset] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: assets, isLoading, error } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
  });

  // Faceted filter counts for the toolbar (Critical (7), Production (4), …).
  const { data: facets } = useQuery({
    queryKey: ['asset-facets'],
    queryFn: async () => (await assetsApi.getFacets()).data,
    staleTime: 30_000,
  });

  // Bulk delete — used by the register's "Delete selected" action.
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => assetsApi.bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset-facets'] });
    },
  });

  // Bulk field update — used by the register's "Set …" actions.
  const bulkUpdateMutation = useMutation({
    mutationFn: ({ ids, patch }: { ids: number[]; patch: Record<string, unknown> }) =>
      assetsApi.bulkUpdate(ids, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset-facets'] });
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['assets-dashboard'],
    queryFn: async () => {
      const response = await assetsApi.getDashboard();
      return response.data;
    },
  });

  // Connection list — used to compute "X of N assets connected" on the
  // guidance card. Endpoint requires admin:integrations:view; on 403 we
  // silently render the static guidance without the live count.
  const { data: connectionsData } = useQuery({
    queryKey: ['assets-page-connections'],
    queryFn: async () => {
      try {
        const r = await apiClient.get('/integrations/connections');
        const conns = (r.data?.connections ?? (Array.isArray(r.data) ? r.data : [])) as Array<{ console_url?: string }>;
        return conns;
      } catch {
        return [] as Array<{ console_url?: string }>;
      }
    },
    retry: false,
  });

  // Local guidance dismissal — operators who've gone through it once
  // can hide it on subsequent visits. Persisted in localStorage so it
  // sticks across tabs/sessions but is per-browser.
  const [guidanceDismissed, setGuidanceDismissed] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setGuidanceDismissed(window.localStorage.getItem('assets.guidance.dismissed') === '1');
    }
  }, []);
  const dismissGuidance = () => {
    setGuidanceDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('assets.guidance.dismissed', '1');
    }
  };

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof assetsApi.create>[0]) => assetsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setIsModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof assetsApi.create>[0] }) => 
      assetsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-dashboard'] });
      setEditingAsset(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => assetsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-dashboard'] });
    },
  });
  
  const handleEdit = (e: React.MouseEvent, asset: ITAsset) => {
    e.stopPropagation();
    setEditingAsset(asset);
  };

  const filteredAssets = assets?.filter((asset: ITAsset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.vendor?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || asset.status === statusFilter;
    const matchesCriticality = criticalityFilter === 'all' || asset.criticality === criticalityFilter;
    const matchesType = typeFilter === 'all' || asset.asset_type === typeFilter;

    // Phase 5 filters. NULL fields fall through unless the user has actively
    // selected a value — assets that pre-date the migration are not excluded
    // from the default view.
    const matchesLifecycle =
      lifecycleFilter === 'all' ||
      (asset.lifecycle_state || 'active').toLowerCase() === lifecycleFilter;
    const matchesClassification =
      classificationFilter === 'all' ||
      (asset.data_classification || '').toLowerCase() === classificationFilter;
    const matchesStale = (() => {
      if (!staleOnly) return true;
      if (!asset.last_seen_at) return true; // never observed → stale
      const ageDays = (Date.now() - new Date(asset.last_seen_at).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays > 30;
    })();
    // Source filter — TRUE ORIGIN (origin_source, stamped once at creation:
    // easm | network_sweep | connect | agent | manual), NOT last_seen_source,
    // which mutates to whichever feed observed the asset most recently.
    const matchesSource =
      sourceFilter === 'all' ||
      ((asset as ITAsset).origin_source || 'manual').toLowerCase() === sourceFilter;

    const matchesEnvironment =
      environmentFilter === 'all' ||
      ((asset as ITAsset).environment || '').toLowerCase() === environmentFilter;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesCriticality &&
      matchesType &&
      matchesLifecycle &&
      matchesClassification &&
      matchesStale &&
      matchesSource &&
      matchesEnvironment
    );
  });

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this asset?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleView = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    router.push(`/assets/${id}`);
  };

  /** Open Connect Wizard with hostname + asset_id + platform pre-filled
   *  from the asset row. Maps os_family / asset_type to the wizard's
   *  Platform key — most common case is windows / linux. For
   *  unsupported families we fall through to the platform picker so the
   *  operator can choose. */
  const handleConnect = (e: React.MouseEvent, asset: ITAsset) => {
    e.stopPropagation();
    const fam = ((asset as any).os_family || '').toLowerCase();
    const platform =
      fam === 'windows' ? 'windows' :
      fam === 'linux' ? 'linux' :
      fam === 'cisco' ? 'cisco' :
      fam === 'oracle' || fam === 'oracle_db' ? 'oracle' :
      fam === 'mssql' ? 'mssql' :
      fam === 'postgres' ? 'postgres' :
      fam === 'mysql' ? 'mysql' :
      fam === 'aws' ? 'aws' :
      fam === 'azure' ? 'azure' :
      '';
    const host = asset.host_name || asset.ip_address || '';
    const params = new URLSearchParams();
    if (platform) params.set('platform', platform);
    if (host) params.set('hostname', host);
    params.set('asset_id', String(asset.id));
    router.push(`/admin/integrations/connect?${params.toString()}`);
  };

  // Multi-select for bulk-connect. Stored as a Set of asset ids so
  // toggling is O(1) regardless of how many rows are on screen.
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<number>>(new Set());
  const toggleAssetSelected = (id: number) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedAssetIds(new Set());

  /** Open Connect Wizard in bulk mode — passes the selected asset ids
   *  via ?asset_ids=1,2,3. Wizard prompts for credentials ONCE then
   *  iterates handshake against each asset. */
  const handleBulkConnect = () => {
    if (selectedAssetIds.size === 0) return;
    // Determine the platform — must be uniform across the selection
    // (you can't share Windows creds across a Linux box). We pick the
    // platform from the first selected asset; the wizard will reject
    // any in the batch with a different os_family.
    const idList = Array.from(selectedAssetIds);
    const first = (assets as ITAsset[] | undefined)?.find((a) => a.id === idList[0]);
    const fam = ((first as any)?.os_family || '').toLowerCase();
    const platform =
      fam === 'windows' ? 'windows' :
      fam === 'linux' ? 'linux' : '';
    const params = new URLSearchParams();
    if (platform) params.set('platform', platform);
    params.set('asset_ids', idList.join(','));
    router.push(`/admin/integrations/connect?${params.toString()}`);
  };

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load assets</p>
      </div>
    );
  }

  // Adapter for the workspace primitives, which call handlers without a DOM
  // event. The existing handlers open with e.stopPropagation(); a no-op stub
  // satisfies that while preserving their behavior verbatim.
  const noopEvent = { stopPropagation: () => {} } as unknown as React.MouseEvent;

  return (
    <div className="asset-suite assets-light space-y-2 px-3 sm:px-4 pt-0" style={{ marginTop: -10, fontSize: 13.5 }}>
      {/* Common header (mock): one title + actions on top, the Inventory | CIS
          toggle below it — so the page name appears once and the toggle sits
          left, styled like the mock (grey track, white pill, green active). */}
      <div className="inv2 as-fadeup" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 19, letterSpacing: '-.025em' }}>IT Asset Inventory</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)' }} />
              Authoritative ownership, valuation &amp; assurance coverage · {(assets as ITAsset[] | undefined)?.length ?? 0} assets
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="sel"><option>Last 30 days</option><option>Last 7 days</option><option>This quarter</option></select>
            <button type="button" className="btn"><Download size={15} />Export</button>
            {canCreate && <button type="button" className="btn btn-pri" onClick={() => setIsModalOpen(true)}><Plus size={15} />Add asset</button>}
          </div>
        </div>
        <div className="segwrap" style={{ marginTop: 9 }}>
          <button type="button" className={activeView === 'inventory' ? 'seg on' : 'seg'} onClick={() => switchView('inventory')}>Inventory</button>
          <button type="button" className={activeView === 'cis' ? 'seg on' : 'seg'} onClick={() => switchView('cis')}>CIS Benchmark</button>
        </div>
      </div>

      {activeView === 'cis' ? (
        <CisBenchmarkView />
      ) : (
      <InventoryRedesign
        hideHead
        assets={(assets as ITAsset[]) || []}
        loading={isLoading}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onView={(asset) => handleView(noopEvent, asset.id)}
        onEdit={(asset) => handleEdit(noopEvent, asset)}
        onDelete={(asset) => handleDelete(noopEvent, asset.id)}
        onConnect={(asset) => handleConnect(noopEvent, asset)}
        onBulkDelete={(ids) => bulkDeleteMutation.mutate(ids)}
        onBulkUpdate={(ids, patch) => bulkUpdateMutation.mutate({ ids, patch })}
        onBulkConnect={(ids) => {
          const next = new Set(ids);
          setSelectedAssetIds(next);
          const first = (assets as ITAsset[] | undefined)?.find((a) => a.id === ids[0]);
          const fam = ((first as any)?.os_family || '').toLowerCase();
          const platform = fam === 'windows' ? 'windows' : fam === 'linux' ? 'linux' : '';
          const params = new URLSearchParams();
          if (platform) params.set('platform', platform);
          params.set('asset_ids', ids.join(','));
          router.push(`/admin/integrations/connect?${params.toString()}`);
        }}
        onAdd={() => setIsModalOpen(true)}
      />
      )}

      {isModalOpen && (
        <AssetModal
          onClose={() => setIsModalOpen(false)}
          onSave={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}

      {editingAsset && (
        <AssetModal
          onClose={() => setEditingAsset(null)}
          onSave={(data) => updateMutation.mutate({ id: editingAsset.id, data })}
          isLoading={updateMutation.isPending}
          initialData={editingAsset}
        />
      )}

      {isImportModalOpen && (
        <ImportAssetsModal
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['assets'] });
            queryClient.invalidateQueries({ queryKey: ['assets-dashboard'] });
          }}
        />
      )}
    </div>
  );
}


function ImportAssetsModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    imported: number;
    // Rows that matched an existing asset and refreshed it instead of adding
    // a duplicate. Re-uploading a corrected sheet lands entirely here.
    updated?: number;
    total_rows: number;
    errors: string[];
    total_errors: number;
    message: string;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Rows added plus rows refreshed. A re-upload of a corrected sheet adds
  // nothing and updates everything, and that is still a successful import.
  const changedCount = (result?.imported ?? 0) + (result?.updated ?? 0);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.match(/\.(csv|xlsx|xls)$/i)) {
        setFile(droppedFile);
        setResult(null);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setIsUploading(true);
    try {
      const response = await assetsApi.importAssets(file);
      setResult(response.data);
      // An import that only refreshed existing assets still changed the
      // register, so it still has to trigger a reload.
      if ((response.data.imported ?? 0) + (response.data.updated ?? 0) > 0) {
        onSuccess();
      }
    } catch (error: any) {
      setResult({
        success: false,
        imported: 0,
        updated: 0,
        total_rows: 0,
        errors: [error.response?.data?.detail || 'Upload failed'],
        total_errors: 1,
        message: 'Upload failed'
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-black">Import IT Assets</h2>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {!result ? (
          <>
            <div className="mb-4 rounded-lg border border-gray-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="mt-0.5 h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-black">How to import assets:</p>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-gray-600">
                    <li>Click the Template button to download the CSV template</li>
                    <li>Fill in your assets (keep the header row)</li>
                    <li>Upload the completed file here</li>
                  </ol>
                </div>
              </div>
            </div>

            <div
              className={`relative mb-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                dragActive
                  ? 'border-blue-500 bg-blue-50'
                  : file
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              
              {file ? (
                <div className="flex flex-col items-center">
                  <CheckCircle2 className="mb-2 h-10 w-10 text-green-600" />
                  <p className="font-medium text-black">{file.name}</p>
                  <p className="mt-1 text-sm text-gray-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    className="mt-2 text-xs text-gray-500 transition-colors hover:text-gray-700"
                  >
                    Choose different file
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Upload className="mb-2 h-10 w-10 text-gray-400" />
                  <p className="text-black">Drag and drop your file here</p>
                  <p className="mt-1 text-sm text-gray-500">or click to browse</p>
                  <p className="mt-2 text-xs text-gray-400">Supports CSV, XLSX, XLS</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || isUploading}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                Import Assets
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={`mb-4 rounded-lg p-4 ${
              result.success && changedCount > 0
                ? 'border border-green-200 bg-green-50'
                : 'border border-red-200 bg-red-50'
            }`}>
              <div className="flex items-start gap-3">
                {result.success && changedCount > 0 ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
                )}
                <div>
                  <p className={`font-medium ${
                    result.success && changedCount > 0 ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {result.message}
                  </p>
                  <div className="mt-2 text-sm text-gray-600">
                    <p>Added: {result.imported} of {result.total_rows} rows</p>
                    {(result.updated ?? 0) > 0 && (
                      <p>Updated in place: {result.updated}</p>
                    )}
                    {result.total_errors > 0 && (
                      <p className="text-red-600">Errors: {result.total_errors}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-gray-600">Error Details:</p>
                <ul className="space-y-1 text-xs text-red-600">
                  {result.errors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
                {result.total_errors > result.errors.length && (
                  <p className="mt-2 text-xs text-gray-500">
                    ... and {result.total_errors - result.errors.length} more errors
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setFile(null);
                  setResult(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-600 transition-colors hover:bg-gray-50"
              >
                Import More
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
