'use client';

import React, { useState, useMemo, useEffect } from 'react';
import apiClient from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import { assetsApi } from '@/lib/api';
import { CriticalityCoverageWidget } from '@/components/assets/CriticalityCoverageWidget';
import PciAttributesFields from '@/components/assets/PciAttributesFields';
import HipaaAttributesFields from '@/components/assets/HipaaAttributesFields';
import { ITAsset, AssetType } from '@/types';
import { PageLoader, ComboBoxInput, type ComboBoxOption } from '@/components/ui';
import { AssetsWorkspace } from './_workspace/AssetsWorkspace';
import InventoryScorecard from '@/components/dashboard/InventoryScorecard';
import {
  Loader2,
  AlertCircle,
  X,
  AppWindow,
  HardDrive,
  Database,
  Cloud,
  Building2,
  Edit,
  DollarSign,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Server,
  ShieldCheck,
} from 'lucide-react';
// CIS Benchmark now lives as a tab inside IT Asset Inventory (merged from the
// former standalone /compliance-overview page). We reuse its component as-is.
import CisBenchmarkView from '../compliance-overview/page';
// Design-handoff theme (warm cream + IBM Plex), scoped under .asset-suite.
import './_suite/asset-suite.css';
import { InventoryStats } from './_suite/InventoryStats';

type StatusFilter = 'all' | 'active' | 'inactive' | 'decommissioned';
type CriticalityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const ASSET_TYPES = [
  { value: 'application', label: 'Application', icon: AppWindow, description: 'Business applications and software systems' },
  { value: 'infrastructure', label: 'Infrastructure', icon: HardDrive, description: 'Servers, network devices, and hardware' },
  { value: 'data', label: 'Data', icon: Database, description: 'Databases, data stores, and data repositories' },
  { value: 'cloud', label: 'Cloud Resource', icon: Cloud, description: 'Cloud services, SaaS, PaaS, and IaaS resources' },
  { value: 'third_party', label: 'Third-Party System', icon: Building2, description: 'External vendor systems and services' },
];

const ASSET_COMPONENT_SUGGESTIONS: Record<AssetType, string[]> = {
  infrastructure: ['Server', 'Router', 'Switch', 'Firewall', 'Desktop', 'Laptop', 'Storage', 'Access Point', 'Rack', 'Load Balancer'],
  application: ['Web Application', 'Mobile Application', 'API Service', 'Authentication Service', 'ERP', 'CRM', 'Middleware', 'Microservice'],
  data: ['Database', 'Data Warehouse', 'Data Lake', 'File Repository', 'Backup Store', 'ETL Pipeline', 'Analytics Store'],
  cloud: ['Virtual Machine', 'Container Service', 'Serverless Function', 'Managed Database', 'Object Storage', 'Kubernetes Cluster', 'CDN'],
  third_party: ['Payment Gateway', 'Identity Provider', 'Security Service', 'Managed SOC', 'External API', 'SaaS Platform', 'Managed Hosting'],
};

const ASSET_SUB_COMPONENT_SUGGESTIONS: Record<AssetType, Record<string, string[]>> = {
  infrastructure: {
    Server: ['CPU', 'RAM', 'ROM', 'NIC', 'Power Supply', 'RAID Controller'],
    Router: ['Routing Engine', 'WAN Interface', 'LAN Interface', 'Power Module', 'Management Port'],
    Switch: ['Line Card', 'Power Module', 'SFP Module', 'Backplane'],
    Firewall: ['Policy Engine', 'VPN Module', 'Inspection Engine', 'HA Pairing'],
    Desktop: ['CPU', 'RAM', 'Storage Disk', 'Network Adapter'],
    Laptop: ['CPU', 'RAM', 'SSD', 'WiFi Adapter', 'Battery'],
    Storage: ['Disk Array', 'Controller', 'Cache Module', 'Replication Module'],
    'Access Point': ['Radio Module', 'Antenna', 'PoE Module', 'Controller Link'],
    Rack: ['Power Distribution Unit', 'Cable Manager', 'Cooling Unit', 'UPS'],
    'Load Balancer': ['Virtual Server', 'Pool Member', 'Health Monitor', 'SSL Profile'],
  },
  application: {
    'Web Application': ['Frontend', 'Backend', 'Session Store', 'Admin Console'],
    'Mobile Application': ['Mobile Client', 'Push Service', 'API Backend', 'Auth Module'],
    'API Service': ['API Gateway', 'Rate Limiter', 'API Version', 'Authentication Layer'],
    'Authentication Service': ['MFA Module', 'Token Service', 'User Directory Sync', 'Session Manager'],
    ERP: ['Finance Module', 'HR Module', 'Inventory Module', 'Reporting Module'],
    CRM: ['Customer Data Module', 'Workflow Engine', 'Email Integration', 'Analytics'],
    Middleware: ['Message Broker', 'Transformer', 'Queue Worker', 'Connector'],
    Microservice: ['Service Endpoint', 'Worker Process', 'Cache Layer', 'Service Config'],
  },
  data: {
    Database: ['Schema', 'Table', 'Stored Procedure', 'Replication'],
    'Data Warehouse': ['Fact Table', 'Dimension Table', 'ETL Job', 'Aggregation Layer'],
    'Data Lake': ['Raw Zone', 'Curated Zone', 'Metadata Catalog', 'Access Policy'],
    'File Repository': ['Folder Structure', 'Retention Policy', 'Access Control', 'Versioning'],
    'Backup Store': ['Backup Set', 'Recovery Point', 'Encryption Key', 'Restore Job'],
    'ETL Pipeline': ['Extractor', 'Transformer', 'Loader', 'Scheduler'],
    'Analytics Store': ['Data Mart', 'Query Engine', 'Index', 'Dashboard Feed'],
  },
  cloud: {
    'Virtual Machine': ['Instance', 'Disk Volume', 'Security Group', 'IAM Role'],
    'Container Service': ['Container Image', 'Task Definition', 'Service Mesh', 'Secrets'],
    'Serverless Function': ['Runtime', 'Trigger', 'Environment Variable', 'Execution Role'],
    'Managed Database': ['Instance', 'Read Replica', 'Backup Policy', 'Parameter Group'],
    'Object Storage': ['Bucket', 'Lifecycle Policy', 'Access Policy', 'Encryption Config'],
    'Kubernetes Cluster': ['Node Pool', 'Ingress Controller', 'Namespace', 'RBAC Policy'],
    CDN: ['Distribution', 'Origin', 'WAF Rule', 'TLS Certificate'],
  },
  third_party: {
    'Payment Gateway': ['Merchant Account', 'API Credential', 'Webhook', 'Settlement Config'],
    'Identity Provider': ['Directory Sync', 'SSO Config', 'MFA Policy', 'Provisioning Connector'],
    'Security Service': ['Agent', 'Detection Policy', 'Alert Integration', 'Reporting Console'],
    'Managed SOC': ['Log Ingestion', 'Use Case', 'Escalation Channel', 'Ticket Integration'],
    'External API': ['API Key', 'OAuth App', 'Rate Plan', 'Webhook Endpoint'],
    'SaaS Platform': ['Tenant Config', 'Role Mapping', 'Audit Log', 'Data Export'],
    'Managed Hosting': ['Compute Plan', 'Support SLA', 'Backup Service', 'Network Segment'],
  },
};

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
    // Phase 7 — source filter. Sources cluster naturally: "aws_inspector",
    // "azure_defender", "gcp_scc", "nessus", "nexpose", "manual"; we group
    // the cloud ones into "cloud" for the dropdown to keep the UI simple
    // while still letting power users pick a specific cloud.
    const matchesSource = (() => {
      if (sourceFilter === 'all') return true;
      const src = (asset.last_seen_source || 'manual').toLowerCase();
      if (sourceFilter === 'cloud') {
        return src === 'aws_inspector' || src === 'azure_defender' || src === 'gcp_scc';
      }
      return src === sourceFilter;
    })();

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
    <div className="asset-suite assets-light space-y-3.5 px-3 sm:px-4 pt-0" style={{ marginTop: -10 }}>
      {/* Header controls — title/subtitle live in the global top bar already, so
          only the Inventory | CIS toggle + primary "Add asset" sit here, pulled
          tight to the top-right (no empty title band). */}
      <div className="as-fadeup" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 0, marginBottom: -8 }}>
        <div className="as-seg">
          <button type="button" className={activeView === 'inventory' ? 'is-active' : ''} onClick={() => switchView('inventory')}>Inventory</button>
          <button type="button" className={activeView === 'cis' ? 'is-active' : ''} onClick={() => switchView('cis')}>CIS Benchmark</button>
        </div>
        {activeView === 'inventory' && canCreate && (
          <button type="button" className="as-btn as-btn-primary" onClick={() => setIsModalOpen(true)}>+ Add asset</button>
        )}
      </div>

      {activeView === 'cis' ? (
        <CisBenchmarkView />
      ) : (
      <>
      <InventoryScorecard />

      <InventoryStats assets={(assets as ITAsset[]) || []} onCrit={(c) => setCriticalityFilter(c as CriticalityFilter)} />

      <AssetsWorkspace
        assets={(assets as ITAsset[]) || []}
        filteredAssets={filteredAssets || []}
        dashboard={dashboard}
        loading={isLoading}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        statusFilter={statusFilter}
        setStatusFilter={(v) => setStatusFilter(v as StatusFilter)}
        criticalityFilter={criticalityFilter}
        setCriticalityFilter={(v) => setCriticalityFilter(v as CriticalityFilter)}
        lifecycleFilter={lifecycleFilter}
        setLifecycleFilter={setLifecycleFilter}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        environmentFilter={environmentFilter}
        setEnvironmentFilter={setEnvironmentFilter}
        facets={facets}
        onBulkDelete={(ids) => bulkDeleteMutation.mutate(ids)}
        onBulkUpdate={(ids, patch) => bulkUpdateMutation.mutate({ ids, patch })}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onView={(asset) => handleView(noopEvent, asset.id)}
        onEdit={(asset) => handleEdit(noopEvent, asset)}
        onDelete={(asset) => handleDelete(noopEvent, asset.id)}
        onConnect={(asset) => handleConnect(noopEvent, asset)}
        onBulkConnect={(ids) => {
          // Reuse the existing bulk-connect flow: seed the selection set from
          // the ids the register handed us, then invoke the page's handler.
          const next = new Set(ids);
          setSelectedAssetIds(next);
          const first = (assets as ITAsset[] | undefined)?.find((a) => a.id === ids[0]);
          const fam = ((first as any)?.os_family || '').toLowerCase();
          const platform =
            fam === 'windows' ? 'windows' :
            fam === 'linux' ? 'linux' : '';
          const params = new URLSearchParams();
          if (platform) params.set('platform', platform);
          params.set('asset_ids', ids.join(','));
          router.push(`/admin/integrations/connect?${params.toString()}`);
        }}
        onOpenFull={(id) => router.push(`/assets/${id}`)}
        onTemplate={() => assetsApi.downloadTemplate()}
        onImport={() => setIsImportModalOpen(true)}
        onAdd={() => setIsModalOpen(true)}
      />
      </>
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

// Suggestion lists for the searchable-with-free-text dropdowns on the
// asset modal. The user can pick from these or type their own value — the
// component commits whatever they type on Enter/blur. Keep these short
// and obvious; the goal isn't to enumerate every vendor in the world but
// to spare the operator typing out the common ones.
const VENDOR_SUGGESTIONS: ComboBoxOption[] = [
  { value: 'Microsoft',  label: 'Microsoft',  group: 'Cloud / OS' },
  { value: 'AWS',        label: 'Amazon Web Services', group: 'Cloud / OS' },
  { value: 'Google Cloud', label: 'Google Cloud', group: 'Cloud / OS' },
  { value: 'Azure',      label: 'Microsoft Azure', group: 'Cloud / OS' },
  // Database engines — listed here so manual Add-Asset can categorise
  // postgres/mysql/etc. correctly. The wizard's platform inference reads
  // this value when the asset's os_normalized is blank, so picking the
  // right vendor here also skips the wizard's platform picker later.
  { value: 'PostgreSQL', label: 'PostgreSQL', group: 'Database / ERP' },
  { value: 'MySQL',      label: 'MySQL / MariaDB', group: 'Database / ERP' },
  { value: 'MongoDB',    label: 'MongoDB',    group: 'Database / ERP' },
  { value: 'Redis',      label: 'Redis',      group: 'Database / ERP' },
  { value: 'Oracle',     label: 'Oracle',     group: 'Database / ERP' },
  { value: 'SAP',        label: 'SAP',        group: 'Database / ERP' },
  { value: 'IBM',        label: 'IBM',        group: 'Database / ERP' },
  { value: 'Red Hat',    label: 'Red Hat',    group: 'OS / Platform' },
  { value: 'VMware',     label: 'VMware',     group: 'OS / Platform' },
  // Web/app servers — common asset_type=application sources. Naming them
  // up-front lets the wizard pre-select the right platform too.
  { value: 'Apache',     label: 'Apache HTTP Server', group: 'Web / App Server' },
  { value: 'Nginx',      label: 'Nginx',      group: 'Web / App Server' },
  { value: 'Tomcat',     label: 'Apache Tomcat', group: 'Web / App Server' },
  { value: 'IIS',        label: 'Microsoft IIS', group: 'Web / App Server' },
  // Browsers — CIS publishes hardening benchmarks for Edge, Firefox and
  // Chrome. Browsers are scanned via the parent host's WinRM / SSH
  // connection (registry / GPO reads on Windows, preferences-file reads
  // on Linux/macOS) — they do NOT need their own integration row, so the
  // wizard CTA is suppressed for these vendors.
  { value: 'Mozilla',          label: 'Mozilla (Firefox)',   group: 'Browser' },
  { value: 'Google',           label: 'Google (Chrome)',     group: 'Browser' },
  { value: 'Microsoft Edge',   label: 'Microsoft Edge',      group: 'Browser' },
  { value: 'Cisco',      label: 'Cisco',      group: 'Network / Security' },
  { value: 'Palo Alto',  label: 'Palo Alto Networks', group: 'Network / Security' },
  { value: 'Fortinet',   label: 'Fortinet',   group: 'Network / Security' },
  { value: 'CrowdStrike', label: 'CrowdStrike', group: 'Network / Security' },
  { value: 'Okta',       label: 'Okta',       group: 'Identity' },
  { value: 'Atlassian',  label: 'Atlassian',  group: 'DevOps' },
  { value: 'GitHub',     label: 'GitHub',     group: 'DevOps' },
  { value: 'GitLab',     label: 'GitLab',     group: 'DevOps' },
  { value: 'In-house',   label: 'In-house / internally built', group: 'Internal' },
];

const NETWORK_SEGMENT_SUGGESTIONS: ComboBoxOption[] = [
  { value: 'dmz',         label: 'DMZ',                 hint: 'public-facing' },
  { value: 'internal',    label: 'Internal',            hint: 'corp network' },
  { value: 'mgmt',        label: 'Management',          hint: 'admin / mgmt VLAN' },
  { value: 'production',  label: 'Production',          hint: 'prod tier' },
  { value: 'staging',     label: 'Staging' },
  { value: 'development', label: 'Development' },
  { value: 'cde',         label: 'Cardholder Data Environment', hint: 'PCI DSS' },
  { value: 'restricted',  label: 'Restricted / Air-gapped' },
  { value: 'guest',       label: 'Guest / Wi-Fi' },
  { value: 'iot',         label: 'IoT / OT' },
];

const LOCATION_SUGGESTIONS: ComboBoxOption[] = [
  { value: 'us-east-1',   label: 'AWS us-east-1',  group: 'Cloud region' },
  { value: 'us-west-2',   label: 'AWS us-west-2',  group: 'Cloud region' },
  { value: 'eu-west-1',   label: 'AWS eu-west-1',  group: 'Cloud region' },
  { value: 'me-south-1',  label: 'AWS me-south-1', group: 'Cloud region' },
  { value: 'azure-eastus', label: 'Azure East US',  group: 'Cloud region' },
  { value: 'gcp-us-central1', label: 'GCP us-central1', group: 'Cloud region' },
  { value: 'On-Premise',  label: 'On-Premise',     group: 'Physical' },
  { value: 'Co-located',  label: 'Co-located DC',  group: 'Physical' },
  { value: 'HQ',          label: 'Head Office',    group: 'Physical' },
  { value: 'Branch',      label: 'Branch Office',  group: 'Physical' },
  { value: 'Remote',      label: 'Remote / Home',  group: 'Physical' },
];

const DATA_CLASSIFICATION_OPTIONS: ComboBoxOption[] = [
  { value: 'public',       label: 'Public',       hint: 'no restrictions' },
  { value: 'internal',     label: 'Internal',     hint: 'employees only' },
  { value: 'confidential', label: 'Confidential', hint: 'need-to-know' },
  { value: 'restricted',   label: 'Restricted',   hint: 'highest sensitivity' },
];

const STATUS_OPTIONS: ComboBoxOption[] = [
  { value: 'active',         label: 'Active' },
  { value: 'inactive',       label: 'Inactive' },
  { value: 'decommissioned', label: 'Decommissioned' },
];

const CRITICALITY_OPTIONS: ComboBoxOption[] = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];


export function AssetModal({
  onClose,
  onSave,
  isLoading,
  initialData,
  forceCde,
  forceEphi,
}: {
  onClose: () => void;
  onSave: (data: Parameters<typeof assetsApi.create>[0]) => void;
  isLoading: boolean;
  initialData?: ITAsset | null;
  /** Default the "CDE Environment" toggle on (used by the PCI Cardholder Data
   *  Inventory, which only ever creates CDE assets). */
  forceCde?: boolean;
  /** Default the "ePHI Environment" toggle on (used by the HIPAA ePHI
   *  Inventory, which only ever creates ePHI assets). */
  forceEphi?: boolean;
}) {
  const parseSubComponents = (value?: string) =>
    value
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    asset_type: (initialData?.asset_type || 'application') as AssetType,
    owner_id: initialData?.owner_id || null as number | null,
    vendor: initialData?.vendor || '',
    location: initialData?.location || '',
    criticality: (initialData?.criticality || 'medium') as 'low' | 'medium' | 'high' | 'critical',
    confidentiality_rating: initialData?.confidentiality_rating || 3,
    integrity_rating: initialData?.integrity_rating || 3,
    availability_rating: initialData?.availability_rating || 3,
    valuation: initialData?.valuation || null as number | null,
    component: initialData?.host_name || '',
    sub_components: parseSubComponents(initialData?.custodian),
    ip_address: initialData?.ip_address || '',
    status: (initialData?.status || 'active') as 'active' | 'inactive' | 'decommissioned',
    cde_environment: (initialData as any)?.cde_environment || forceCde || false,
    pci_dss: (((initialData as any)?.pci_dss) || {}) as Record<string, string>,
    ephi_environment: (initialData as any)?.ephi_environment || forceEphi || false,
    hipaa: (((initialData as any)?.hipaa) || {}) as Record<string, string>,
    // Exposure metadata — drive the ISO 27005 derived criticality.
    data_classification: ((initialData as any)?.data_classification || '') as '' | 'public' | 'internal' | 'confidential' | 'restricted',
    internet_facing: Boolean((initialData as any)?.internet_facing),
    business_function: ((initialData as any)?.business_function || '') as string,
    network_segment: ((initialData as any)?.network_segment || '') as string,
    // Override
    criticality_manual_override: Boolean((initialData as any)?.criticality_manual_override),
    criticality_override_reason: ((initialData as any)?.criticality_override_reason || '') as string,
    // CIS / OS profile — without these the benchmark matcher returns nothing
    // and the asset's row in the Host-Applications panel shows "no benchmark"
    // with no checkbox or scan buttons. Populated from the OS Knowledge
    // Registry dropdown below so manual operators don't have to know the
    // canonical normalized_key string.
    os_normalized: ((initialData as any)?.os_normalized || '') as string,
    os_family: ((initialData as any)?.os_family || '') as string,
    os_version: ((initialData as any)?.os_version || '') as string,
    // Hardware — also auto-filled by agent heartbeat / agentless scan.
    cpu_cores: ((initialData as any)?.cpu_cores ?? '') as number | '',
    memory_gb: ((initialData as any)?.memory_gb ?? '') as number | '',
    storage_gb: ((initialData as any)?.storage_gb ?? '') as number | '',
    manufacturer: ((initialData as any)?.manufacturer || '') as string,
    model: ((initialData as any)?.model || '') as string,
    serial_number: ((initialData as any)?.serial_number || '') as string,
  });
  const [customSubComponent, setCustomSubComponent] = useState('');

  // OS Knowledge Registry — drives the OS/Product picker so the user can
  // pick what kind of asset this is, and the benchmark matcher resolves the
  // right CIS rules automatically.
  const { data: osRegistryData } = useQuery<{ items: Array<{
    normalized_key: string; display_name: string; family: string;
    product: string | null; build: string | null; is_supported: boolean;
    plugin_count: number;
  }> }>({
    queryKey: ['compliance-plugins', 'os-registry'],
    queryFn: async () => (await apiClient.get('/compliance-plugins/os-registry')).data,
    staleTime: 5 * 60_000,
  });
  // Order: scannable OSes first (have CIS plugins), then everything else.
  // Within each, prefer supported and alphabetical by display_name.
  const osOptions = useMemo(() => {
    const items = osRegistryData?.items ?? [];
    return items
      .slice()
      .sort((a, b) => {
        const aScannable = (a.plugin_count > 0) ? 0 : 1;
        const bScannable = (b.plugin_count > 0) ? 0 : 1;
        if (aScannable !== bScannable) return aScannable - bScannable;
        if (a.is_supported !== b.is_supported) return a.is_supported ? -1 : 1;
        return (a.display_name || a.normalized_key).localeCompare(b.display_name || b.normalized_key);
      });
  }, [osRegistryData]);

  // Catalogue of business-function categories — drives the dropdown.
  const { data: businessFunctionsData } = useQuery<{ items: Array<{ id: string; label: string; group: string; high_impact: boolean }> }>({
    queryKey: ['asset-business-functions'],
    queryFn: async () => (await apiClient.get('/assets/criticality/business-functions')).data,
  });
  const businessFunctionGroups = useMemo(() => {
    const groups: Record<string, Array<{ id: string; label: string; high_impact: boolean }>> = {};
    for (const item of businessFunctionsData?.items || []) {
      (groups[item.group] ||= []).push({ id: item.id, label: item.label, high_impact: item.high_impact });
    }
    return groups;
  }, [businessFunctionsData]);

  // Live derived criticality — recomputed client-side via debounced POST to
  // /assets/criticality/preview whenever an input changes.
  const [derivedCriticality, setDerivedCriticality] = useState<{ score: number; bucket: 'low' | 'medium' | 'high' | 'critical' } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.post('/assets/criticality/preview', {
          confidentiality_rating: formData.confidentiality_rating,
          integrity_rating: formData.integrity_rating,
          availability_rating: formData.availability_rating,
          data_classification: formData.data_classification || null,
          internet_facing: formData.internet_facing,
          business_function: formData.business_function || null,
        });
        if (!cancelled) setDerivedCriticality(res.data);
      } catch {}
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [
    formData.confidentiality_rating,
    formData.integrity_rating,
    formData.availability_rating,
    formData.data_classification,
    formData.internet_facing,
    formData.business_function,
  ]);

  const isEditMode = !!initialData;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Override validation — surface inline so the user fixes it before
    // we make the round-trip and get a 400 back.
    if (formData.criticality_manual_override && !formData.criticality_override_reason.trim()) {
      alert('Please provide a reason for the manual criticality override.');
      return;
    }
    const submitData: any = {
      name: formData.name,
      description: formData.description || undefined,
      asset_type: formData.asset_type,
      owner_id: formData.owner_id || undefined,
      vendor: formData.vendor || undefined,
      location: formData.location || undefined,
      confidentiality_rating: formData.confidentiality_rating,
      integrity_rating: formData.integrity_rating,
      availability_rating: formData.availability_rating,
      valuation: formData.valuation || undefined,
      host_name: formData.component || undefined,
      custodian: formData.sub_components.length > 0 ? formData.sub_components.join(', ') : undefined,
      ip_address: formData.ip_address || undefined,
      cde_environment: formData.cde_environment,
      pci_dss: formData.cde_environment ? formData.pci_dss : null,
      ephi_environment: formData.ephi_environment,
      hipaa: formData.ephi_environment ? formData.hipaa : null,
      // Exposure metadata — feeds the derived criticality.
      data_classification: formData.data_classification || undefined,
      internet_facing: formData.internet_facing,
      business_function: formData.business_function || undefined,
      network_segment: formData.network_segment || undefined,
      // Criticality is derived server-side unless override is on.
      criticality_manual_override: formData.criticality_manual_override,
      criticality: formData.criticality_manual_override ? formData.criticality : undefined,
      criticality_override_reason: formData.criticality_manual_override ? formData.criticality_override_reason : undefined,
      // OS profile — must be sent for the benchmark matcher to resolve a
      // CIS benchmark on the Compliance tab. Without this the manually
      // added asset lands with os_normalized=NULL and the panel shows
      // "no benchmark" / no scan controls.
      os_normalized: formData.os_normalized || undefined,
      os_family: formData.os_family || undefined,
      os_version: formData.os_version || undefined,
      cpu_cores: formData.cpu_cores !== '' ? Number(formData.cpu_cores) : undefined,
      memory_gb: formData.memory_gb !== '' ? Number(formData.memory_gb) : undefined,
      storage_gb: formData.storage_gb !== '' ? Number(formData.storage_gb) : undefined,
      manufacturer: formData.manufacturer || undefined,
      model: formData.model || undefined,
      serial_number: formData.serial_number || undefined,
    };
    if (isEditMode) {
      submitData.status = formData.status;
    }
    onSave(submitData);
  };

  const componentSuggestions = ASSET_COMPONENT_SUGGESTIONS[formData.asset_type] || [];
  const subComponentSuggestions = formData.component
    ? ASSET_SUB_COMPONENT_SUGGESTIONS[formData.asset_type]?.[formData.component] || []
    : [];

  const toggleSubComponent = (value: string) => {
    const exists = formData.sub_components.includes(value);
    if (exists) {
      setFormData({
        ...formData,
        sub_components: formData.sub_components.filter((item) => item !== value),
      });
      return;
    }
    setFormData({
      ...formData,
      sub_components: [...formData.sub_components, value],
    });
  };

  const addCustomSubComponent = () => {
    const cleaned = customSubComponent.trim();
    if (!cleaned || formData.sub_components.includes(cleaned)) {
      return;
    }
    setFormData({
      ...formData,
      sub_components: [...formData.sub_components, cleaned],
    });
    setCustomSubComponent('');
  };

  const RatingSelector = ({ 
    label, 
    value, 
    onChange,
    color
  }: { 
    label: string; 
    value: number; 
    onChange: (v: number) => void;
    color: string;
  }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            className={`flex h-6 w-6 items-center justify-center rounded border text-xs font-medium transition-colors ${
              rating <= value
                ? `${color} border-transparent text-white`
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {rating}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-y-0 right-0 z-50 flex w-[780px] flex-col bg-white shadow-2xl border-l border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">{isEditMode ? 'Edit Asset' : 'Add Asset'}</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Row 1: Name + Description */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="Brief description..."
                />
              </div>
            </div>

            {/* Asset Type */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Asset Type *</label>
              <div className="grid grid-cols-3 gap-1.5">
                {ASSET_TYPES.map((type) => {
                  const Icon = type.icon;
                  const isSelected = formData.asset_type === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => {
                        const nextType = type.value as AssetType;
                        const nextComponentSuggestions = ASSET_COMPONENT_SUGGESTIONS[nextType] || [];
                        const keepCurrentComponent = nextComponentSuggestions.includes(formData.component);
                        setFormData({
                          ...formData,
                          asset_type: nextType,
                          component: keepCurrentComponent ? formData.component : '',
                          sub_components: keepCurrentComponent ? formData.sub_components : [],
                        });
                      }}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                      <span className={`text-xs font-medium truncate ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                        {type.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row: Primary Component + IP Address */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Primary Component</label>
                <select
                  value={formData.component}
                  onChange={(e) => setFormData({ ...formData, component: e.target.value, sub_components: [] })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select component</option>
                  {componentSuggestions.map((component) => (
                    <option key={component} value={component}>{component}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">IP Address</label>
                <input
                  type="text"
                  value={formData.ip_address}
                  onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., 10.0.10.15"
                />
              </div>
            </div>

            {/* Hardware — optional; also auto-populated by agent heartbeat or
                agentless (WinRM/SSH) scan. Kept editable for manual entry. */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Hardware <span className="text-slate-400">(optional — auto-filled by scan)</span></label>
              <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                <input type="text" value={formData.manufacturer} onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })} placeholder="Manufacturer" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
                <input type="text" value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })} placeholder="Model" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
                <input type="text" value={formData.serial_number} onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })} placeholder="Serial number" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
                <input type="number" min="0" value={formData.cpu_cores} onChange={(e) => setFormData({ ...formData, cpu_cores: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="vCPU" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
                <input type="number" min="0" value={formData.memory_gb} onChange={(e) => setFormData({ ...formData, memory_gb: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="RAM (GB)" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
                <input type="number" min="0" value={formData.storage_gb} onChange={(e) => setFormData({ ...formData, storage_gb: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="Disk (GB)" className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none" />
              </div>
            </div>

            {/* OS / Product picker — drives benchmark matching. Without
                this, manually-added assets land with os_normalized=NULL and
                the Host-Applications panel shows 'no benchmark' + no
                checkbox / scan buttons. The dropdown pulls every supported
                OS / product from the OS Knowledge Registry; scannable ones
                (have CIS plugins seeded) appear first. */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-0.5">
                OS / Product <span className="font-normal text-slate-400">— drives CIS benchmark matching</span>
              </label>
              <select
                value={formData.os_normalized}
                onChange={(e) => {
                  const selected = osOptions.find(o => o.normalized_key === e.target.value);
                  setFormData({
                    ...formData,
                    os_normalized: e.target.value,
                    // Auto-fill os_family from the chosen registry row so the
                    // strict matcher's family-walk has something to work with.
                    os_family: selected?.family || formData.os_family,
                  });
                }}
                className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="">— Not specified (no benchmark will match) —</option>
                {osOptions.map((o) => {
                  const label = o.display_name || o.normalized_key;
                  const scannable = o.plugin_count > 0;
                  const eol = !o.is_supported;
                  return (
                    <option key={o.normalized_key} value={o.normalized_key}>
                      {label}
                      {scannable ? '' : ' · no plugins'}
                      {eol ? ' · EOL' : ''}
                      {' '}({o.normalized_key})
                    </option>
                  );
                })}
              </select>
              {formData.os_normalized && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Normalized key: <code className="font-mono text-slate-700">{formData.os_normalized}</code>
                  {formData.os_family && <> · Family: <code className="font-mono text-slate-700">{formData.os_family}</code></>}
                </p>
              )}
              {!formData.os_normalized && (
                <p className="mt-1 text-[10px] text-amber-700">
                  Leave blank if unknown — but Compliance tab will show &quot;no benchmark&quot; and the asset can&apos;t be checkbox-included in a room scan until this is set.
                </p>
              )}
            </div>

            {/* Sub-components */}
            {subComponentSuggestions.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-600 mb-1">Sub-components</label>
                <div className="flex flex-wrap gap-1.5">
                  {subComponentSuggestions.map((subComponent) => {
                    const isSelected = formData.sub_components.includes(subComponent);
                    return (
                      <button
                        key={subComponent}
                        type="button"
                        onClick={() => toggleSubComponent(subComponent)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                          isSelected
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {subComponent}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom sub-component */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Custom Sub-component</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customSubComponent}
                  onChange={(e) => setCustomSubComponent(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., WiFi Controller"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSubComponent(); } }}
                />
                <button type="button" onClick={addCustomSubComponent} className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                  Add
                </button>
              </div>
              {formData.sub_components.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {formData.sub_components.map((subComponent) => (
                    <span key={subComponent} className="inline-flex items-center gap-1 rounded-full border border-blue-400 bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">
                      {subComponent}
                      <button type="button" onClick={() => toggleSubComponent(subComponent)} className="text-blue-500 hover:text-blue-700" aria-label={`Remove ${subComponent}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-3 mt-1">
              {/* Row: Vendor + Location */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Vendor</label>
                  <ComboBoxInput
                    value={formData.vendor}
                    onChange={(v) => setFormData({ ...formData, vendor: v })}
                    options={VENDOR_SUGGESTIONS}
                    placeholder="Search or type a vendor…"
                    ariaLabel="Vendor"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Location</label>
                  <ComboBoxInput
                    value={formData.location}
                    onChange={(v) => setFormData({ ...formData, location: v })}
                    options={LOCATION_SUGGESTIONS}
                    placeholder="Search or type a location…"
                    ariaLabel="Location"
                  />
                </div>
              </div>

              {/* Row: Asset Value (criticality is now derived — see below) */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Asset Value (USD)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      value={formData.valuation || ''}
                      onChange={(e) => setFormData({ ...formData, valuation: e.target.value ? Number(e.target.value) : null })}
                      className="w-full rounded border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      placeholder="0"
                      min="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Network Segment</label>
                  <ComboBoxInput
                    value={formData.network_segment}
                    onChange={(v) => setFormData({ ...formData, network_segment: v })}
                    options={NETWORK_SEGMENT_SUGGESTIONS}
                    placeholder="Search or type a segment…"
                    ariaLabel="Network segment"
                  />
                </div>
              </div>

              {/* Row: PCI DSS + Status(edit) */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">PCI DSS Scope</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, cde_environment: !formData.cde_environment })}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        formData.cde_environment ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          formData.cde_environment ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-slate-700">CDE Environment</span>
                  </label>
                </div>
                {isEditMode && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">Status</label>
                    <ComboBoxInput
                      value={formData.status}
                      onChange={(v) => setFormData({ ...formData, status: (v || 'active') as typeof formData.status })}
                      options={STATUS_OPTIONS}
                      allowCustom={false}
                      displayLabelInsteadOfValue
                      placeholder="Select status…"
                      ariaLabel="Status"
                    />
                  </div>
                )}
              </div>

              {/* PCI DSS attributes — revealed when the asset is in the CDE.
                  Shared component so the IT Assets form and the PCI Cardholder
                  Data Inventory show identical fields. */}
              {formData.cde_environment && (
                <div className="mb-3">
                  <PciAttributesFields
                    value={formData.pci_dss}
                    onChange={(patch) => setFormData({ ...formData, pci_dss: { ...formData.pci_dss, ...patch } as Record<string, string> })}
                  />
                </div>
              )}

              {/* Row: HIPAA ePHI scope — mirror of the PCI CDE toggle above. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">HIPAA Scope</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, ephi_environment: !formData.ephi_environment })}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        formData.ephi_environment ? 'bg-indigo-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          formData.ephi_environment ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-slate-700">ePHI Environment</span>
                  </label>
                </div>
              </div>

              {/* HIPAA ePHI attributes — revealed when the asset holds ePHI.
                  Shared component so the IT Assets form and the HIPAA ePHI
                  Inventory show identical fields. */}
              {formData.ephi_environment && (
                <div className="mb-3">
                  <HipaaAttributesFields
                    value={formData.hipaa}
                    onChange={(patch) => setFormData({ ...formData, hipaa: { ...formData.hipaa, ...patch } as Record<string, string> })}
                  />
                </div>
              )}

              {/* CIA Ratings — primary input to derived criticality */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  CIA Ratings <span className="text-slate-400 font-normal">(highest of the three drives criticality)</span>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <RatingSelector
                    label="Confidentiality"
                    value={formData.confidentiality_rating}
                    onChange={(v) => setFormData({ ...formData, confidentiality_rating: v })}
                    color="bg-blue-600"
                  />
                  <RatingSelector
                    label="Integrity"
                    value={formData.integrity_rating}
                    onChange={(v) => setFormData({ ...formData, integrity_rating: v })}
                    color="bg-green-600"
                  />
                  <RatingSelector
                    label="Availability"
                    value={formData.availability_rating}
                    onChange={(v) => setFormData({ ...formData, availability_rating: v })}
                    color="bg-yellow-600"
                  />
                </div>
              </div>

              {/* Data classification + Internet-facing — secondary inputs */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Data Classification</label>
                  <ComboBoxInput
                    value={formData.data_classification}
                    onChange={(v) => setFormData({ ...formData, data_classification: (v || '') as typeof formData.data_classification })}
                    options={DATA_CLASSIFICATION_OPTIONS}
                    allowCustom={false}
                    displayLabelInsteadOfValue
                    placeholder="None — search to pick…"
                    ariaLabel="Data classification"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Internet-Facing</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, internet_facing: !formData.internet_facing })}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        formData.internet_facing ? 'bg-amber-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          formData.internet_facing ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-slate-700">{formData.internet_facing ? 'Exposed to the public internet' : 'Internal only'}</span>
                  </label>
                </div>
              </div>

              {/* Business function — structured catalogue, drives criticality
                  boost. Searchable + supports free-text for teams whose
                  function isn't in the seeded catalogue. */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Business Function</label>
                <ComboBoxInput
                  value={formData.business_function}
                  onChange={(v) => setFormData({ ...formData, business_function: v })}
                  options={Object.entries(businessFunctionGroups).flatMap(([group, items]) =>
                    items.map((item) => ({
                      value: item.id,
                      label: item.label,
                      group,
                      hint: item.high_impact ? '⬆ boosts criticality' : undefined,
                    })),
                  )}
                  placeholder="Search or type a function…"
                  emptyText="No matches — Enter to use the typed value as a custom function."
                  ariaLabel="Business function"
                  displayLabelInsteadOfValue
                />
              </div>

              {/* Derived criticality — live preview + override */}
              <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/40 p-3 mb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                      System-calculated criticality
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      ISO 27005: max(C, I, A) + adjustments for exposure, data class, business function.
                    </p>
                  </div>
                  {derivedCriticality && (
                    <div className="text-right">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase ${
                        derivedCriticality.bucket === 'critical' ? 'bg-rose-100 text-rose-700' :
                        derivedCriticality.bucket === 'high' ? 'bg-orange-100 text-orange-700' :
                        derivedCriticality.bucket === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {derivedCriticality.bucket}
                      </span>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">score {derivedCriticality.score} / 10</p>
                    </div>
                  )}
                </div>
                <label className="mt-3 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.criticality_manual_override}
                    onChange={(e) => setFormData({
                      ...formData,
                      criticality_manual_override: e.target.checked,
                      // Seed the override with the derived bucket so the dropdown isn't empty.
                      criticality: (e.target.checked && derivedCriticality ? derivedCriticality.bucket : formData.criticality),
                    })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-700">
                    Override the calculated criticality
                    <span className="text-slate-400"> — requires a reason for the audit trail</span>
                  </span>
                </label>
                {formData.criticality_manual_override && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-0.5">Override bucket</label>
                      <ComboBoxInput
                        value={formData.criticality}
                        onChange={(v) => setFormData({ ...formData, criticality: (v || 'medium') as typeof formData.criticality })}
                        options={CRITICALITY_OPTIONS}
                        allowCustom={false}
                        displayLabelInsteadOfValue
                        placeholder="Select bucket…"
                        ariaLabel="Override bucket"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-0.5">Reason *</label>
                      <input
                        type="text"
                        required
                        value={formData.criticality_override_reason}
                        onChange={(e) => setFormData({ ...formData, criticality_override_reason: e.target.value })}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                        placeholder="e.g. compensating controls in place"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

                    <div className="flex-shrink-0 flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditMode ? 'Save Changes' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
    </>
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
