'use client';

import React, { useState, useMemo, useEffect } from 'react';
import apiClient from '@/lib/api';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';

const ASSET_TYPE_COLORS: Record<string, string> = {
  application:   '#3b82f6',
  infrastructure:'#8b5cf6',
  data:          '#10b981',
  cloud:         '#f59e0b',
  third_party:   '#ec4899',
};
const CRITICALITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
};
const AssetTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md text-xs">
        <p className="font-medium text-gray-800 capitalize">{payload[0].name.replace(/_/g, ' ')}</p>
        <p className="text-gray-500">{payload[0].value} assets</p>
      </div>
    );
  }
  return null;
};
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import { assetsApi } from '@/lib/api';
import { CriticalityCoverageWidget } from '@/components/assets/CriticalityCoverageWidget';
import { ITAsset, AssetType } from '@/types';
import { SearchInput, MultiSelectDropdown, PageLoader, ComboBoxInput, type ComboBoxOption } from '@/components/ui';
import {
  Server,
  Loader2,
  AlertCircle,
  Plus,
  X,
  AppWindow,
  HardDrive,
  Database,
  Cloud,
  Building2,
  ChevronDown,
  ChevronRight,
  Eye,
  Edit,
  Trash2,
  Shield,
  DollarSign,
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  // CIS Module Updated — per-row "Connect" button that deep-links into
  // the Connect Wizard with hostname pre-filled.
  Plug,
} from 'lucide-react';

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
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('assets:asset_inventory:create');
  const canEdit = hasPermission('assets:asset_inventory:edit');
  const canDelete = hasPermission('assets:asset_inventory:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [criticalityFilter, setCriticalityFilter] = useState<CriticalityFilter>('all');
  // Phase 5 filters. Client-side only — the list is small enough that we
  // don't need a round-trip per filter change, and the existing list query
  // doesn't accept these params yet by design (default sort preserved).
  const [lifecycleFilter, setLifecycleFilter] = useState<string>('all');
  const [classificationFilter, setClassificationFilter] = useState<string>('all');
  const [staleOnly, setStaleOnly] = useState<boolean>(false);
  // Phase 7 — source filter (which cloud / scanner discovered this asset).
  const [sourceFilter, setSourceFilter] = useState<string>('all');
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

  const getAssetIcon = (type: string) => {
    const assetType = ASSET_TYPES.find(t => t.value === type);
    const Icon = assetType?.icon || Server;
    return <Icon className="h-5 w-5 text-primary-400" />;
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100',
      inactive: 'bg-yellow-100',
      decommissioned: 'bg-slate-100',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-slate-900 ${colors[status] || 'bg-slate-100'}`}>
        {status}
      </span>
    );
  };

  const getCriticalityBadge = (criticality: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-100',
      high: 'bg-orange-100',
      medium: 'bg-yellow-100',
      low: 'bg-green-100',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-slate-900 ${colors[criticality] || 'bg-slate-100'}`}>
        {criticality}
      </span>
    );
  };

  const getTypeBadge = (type: string) => {
    const assetType = ASSET_TYPES.find(t => t.value === type);
    const color = ASSET_TYPE_COLORS[type] ?? '#6b7280';
    return (
      <span
        className="rounded-full px-2 py-0.5 text-xs font-medium text-slate-900"
        style={{ backgroundColor: color + '22' }}
      >
        {assetType?.label || type}
      </span>
    );
  };

  const getCIARatingBar = (rating: number | undefined, label: string, color: string) => {
    const value = rating || 0;
    return (
      <div className="flex items-center gap-1" title={`${label}: ${value}/5`}>
        <span className="text-xs text-slate-500">{label[0]}</span>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-2 w-1.5 rounded-sm ${i <= value ? color : 'bg-slate-200'}`}
            />
          ))}
        </div>
      </div>
    );
  };

  const formatCurrency = (value: number | undefined) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const filteredAssets = assets?.filter((asset: ITAsset) => {
    const matchesSearch =
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.vendor?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || asset.status === statusFilter;
    const matchesCriticality = criticalityFilter === 'all' || asset.criticality === criticalityFilter;

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

    return (
      matchesSearch &&
      matchesStatus &&
      matchesCriticality &&
      matchesLifecycle &&
      matchesClassification &&
      matchesStale &&
      matchesSource
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

  const assetTypeChartData = useMemo(() => {
    const byType = dashboard?.by_type || {};
    return Object.entries(byType)
      .filter(([, v]) => (v as number) > 0)
      .map(([key, value]) => ({
        name: key.replace(/_/g, ' '),
        value: value as number,
        fill: ASSET_TYPE_COLORS[key] || '#6b7280',
      }));
  }, [dashboard?.by_type]);

  const criticalityChartData = useMemo(() => {
    const byCrit = dashboard?.by_criticality || {};
    return ['critical', 'high', 'medium', 'low']
      .filter((k) => (byCrit[k] ?? 0) > 0)
      .map((key) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: byCrit[key] as number,
        fill: CRITICALITY_COLORS[key],
      }));
  }, [dashboard?.by_criticality]);

  const ciaRadarData = useMemo(() => {
    const assetList = (assets as ITAsset[]) || [];
    const types = ['application', 'infrastructure', 'data', 'cloud', 'third_party'];
    return types.map((type) => {
      const group = assetList.filter((a) => a.asset_type === type);
      if (!group.length) return null;
      const avg = (field: keyof ITAsset) =>
        Math.round((group.reduce((s, a) => s + ((a[field] as number) || 0), 0) / group.length) * 10) / 10;
      return {
        type: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        C: avg('confidentiality_rating'),
        I: avg('integrity_rating'),
        A: avg('availability_rating'),
      };
    }).filter(Boolean) as Array<{ type: string; C: number; I: number; A: number }>;
  }, [assets]);

  const totalAssets = dashboard?.total_assets || 0;

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

  return (
    <div className="assets-light space-y-4 sm:space-y-5 px-3 sm:px-4 pt-3">
      {/* Criticality coverage banner — shows how many assets carry a
          criticality assessment + band distribution. Drop-in component
          that runs its own data fetch so the parent stays unchanged. */}
      <CriticalityCoverageWidget />

      {/* Visual overview — 3 chart panels */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">

        {/* Panel 1 — Asset type donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">By Asset Type</p>
          {assetTypeChartData.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center text-xs text-slate-400">No data</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative h-[110px] w-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={assetTypeChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={2}>
                      {assetTypeChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<AssetTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold text-slate-900">{totalAssets}</span>
                  <span className="text-[10px] text-slate-400">total</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                {assetTypeChartData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.fill }} />
                    <span className="text-slate-500 capitalize truncate">{entry.name}</span>
                    <span className="font-semibold text-slate-800 ml-auto">{entry.value}</span>
                  </div>
                ))}
                <div className="mt-1 border-t border-slate-100 pt-1 flex justify-between text-[10px] text-slate-400">
                  <span>High Value</span>
                  <span className="font-semibold text-green-600">{dashboard?.high_value_assets || 0}</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Need CIA</span>
                  <span className="font-semibold text-amber-500">{dashboard?.assets_needing_assessment || 0}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panel 2 — Criticality ring */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">By Criticality</p>
          {criticalityChartData.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center text-xs text-slate-400">No data</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative h-[110px] w-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={criticalityChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={2}>
                      {criticalityChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<AssetTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold text-slate-900">{criticalityChartData.reduce((s, e) => s + e.value, 0)}</span>
                  <span className="text-[10px] text-slate-400">assets</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1.5 min-w-0">
                {criticalityChartData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.fill }} />
                    <span className="text-slate-500">{entry.name}</span>
                    <span className="font-semibold text-slate-800 ml-auto">{entry.value}</span>
                  </div>
                ))}
                <div className="mt-1 border-t border-slate-100 pt-1 flex justify-between text-[10px] text-slate-400">
                  <span>Active</span>
                  <span className="font-semibold text-green-600">{dashboard?.by_status?.active || 0}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panel 3 — CIA radar by asset type */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">CIA Profile by Type</p>
          <p className="text-[10px] text-slate-400 mb-2">Avg Confidentiality / Integrity / Availability (1–5)</p>
          {ciaRadarData.length === 0 ? (
            <div className="flex h-[110px] items-center justify-center text-xs text-slate-400">Rate your assets to see CIA profile</div>
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <RadarChart data={ciaRadarData} cx="50%" cy="50%" outerRadius={46}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="type" tick={{ fontSize: 9, fill: '#64748b' }} />
                <Radar name="C" dataKey="C" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} />
                <Radar name="I" dataKey="I" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                <Radar name="A" dataKey="A" stroke="#eab308" fill="#eab308" fillOpacity={0.15} />
                <Tooltip formatter={(value, name) => [value, name === 'C' ? 'Confidentiality' : name === 'I' ? 'Integrity' : 'Availability']} />
              </RadarChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center justify-center gap-4 mt-1">
            <div className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-full bg-blue-500" />C</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />I</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-500"><span className="h-2 w-2 rounded-full bg-yellow-400" />A</div>
          </div>
        </div>

      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px] sm:max-w-xs">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search assets..."
            size="md"
          />
        </div>

        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'decommissioned', label: 'Decommissioned' },
          ]}
          selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
          onApply={(v) => setStatusFilter((v[0] as StatusFilter) || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Status"
          size="md"
        />

        <MultiSelectDropdown
          title="Criticality"
          items={[
            { value: 'critical', label: 'Critical' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
          selectedValues={criticalityFilter !== 'all' ? [criticalityFilter] : []}
          onApply={(v) => setCriticalityFilter((v[0] as CriticalityFilter) || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Criticality"
          size="md"
        />

        {/* ── Phase 5 list filters ─────────────────────────────────────── */}
        <MultiSelectDropdown
          title="Lifecycle"
          items={[
            { value: 'planned', label: 'Planned' },
            { value: 'active', label: 'Active' },
            { value: 'maintenance', label: 'Maintenance' },
            { value: 'decommissioned', label: 'Decommissioned' },
            { value: 'retired', label: 'Retired' },
          ]}
          selectedValues={lifecycleFilter !== 'all' ? [lifecycleFilter] : []}
          onApply={(v) => setLifecycleFilter(v[0] || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Lifecycle"
          size="md"
        />

        <MultiSelectDropdown
          title="Data Classification"
          items={[
            { value: 'public', label: 'Public' },
            { value: 'internal', label: 'Internal' },
            { value: 'confidential', label: 'Confidential' },
            { value: 'restricted', label: 'Restricted' },
          ]}
          selectedValues={classificationFilter !== 'all' ? [classificationFilter] : []}
          onApply={(v) => setClassificationFilter(v[0] || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Classifications"
          size="md"
        />

        <button
          type="button"
          onClick={() => setStaleOnly((s) => !s)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            staleOnly
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
          title="Show only assets not observed for 30+ days"
        >
          Stale only ({'>'}30d)
        </button>

        <MultiSelectDropdown
          title="Source"
          items={[
            { value: 'cloud', label: 'Any cloud (AWS/Azure/GCP)' },
            { value: 'aws_inspector', label: 'AWS Inspector' },
            { value: 'azure_defender', label: 'Azure Defender' },
            { value: 'gcp_scc', label: 'GCP SCC' },
            { value: 'nessus', label: 'Nessus' },
            { value: 'nexpose', label: 'Nexpose' },
            { value: 'manual', label: 'Manual / unknown' },
          ]}
          selectedValues={sourceFilter !== 'all' ? [sourceFilter] : []}
          onApply={(v) => setSourceFilter(v[0] || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Sources"
          size="md"
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => assetsApi.downloadTemplate()}
            className="btn-secondary"
            title="Download CSV template for bulk import"
          >
            <Download size={16} />
            Template
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="btn-secondary border-primary-200 text-primary-600"
          >
            <Upload size={16} />
            Import
          </button>
          {canCreate && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="btn-primary"
            >
              <Plus size={18} />
              Add Asset
            </button>
          )}
        </div>
      </div>

      {/* ─── Bulk-connect toolbar — visible only while assets are selected */}
      {selectedAssetIds.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm text-indigo-900">
            <span className="font-semibold">{selectedAssetIds.size}</span>
            <span>asset{selectedAssetIds.size === 1 ? '' : 's'} selected</span>
            <button
              type="button"
              onClick={clearSelection}
              className="ml-2 text-xs text-indigo-700 underline hover:text-indigo-900"
            >
              Clear
            </button>
          </div>
          <button
            type="button"
            onClick={handleBulkConnect}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <Plug className="h-4 w-4" />
            Connect {selectedAssetIds.size} selected — shared credentials
          </button>
        </div>
      )}

      {/* ─── Connection guidance card ───────────────────────────────────
          Shown until the operator dismisses it. Explains both flows:
          1) connect one asset at a time (click 🔌 on the row)
          2) connect N assets in bulk (tick checkboxes → "Connect N selected")
          Plus the live count so the operator knows what's left to do. */}
      {!guidanceDismissed && Array.isArray(assets) && assets.length > 0 && (() => {
        const connectedHosts = new Set(
          (connectionsData || [])
            .map((c) => (c.console_url || '').toLowerCase().trim())
            .filter((h) => !!h)
        );
        const assetsWithHost = (assets as ITAsset[]).filter((a) => !!a.host_name);
        const connectedCount = assetsWithHost.filter(
          (a) => connectedHosts.has((a.host_name || '').toLowerCase().trim()),
        ).length;
        const remainingCount = assetsWithHost.length - connectedCount;
        return (
          <div className="mb-4 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1">
                <span className="text-3xl flex-shrink-0">🔌</span>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-blue-900">
                    Connect your assets so we can scan them
                  </h2>
                  <p className="mt-1 text-xs text-blue-800">
                    {assetsWithHost.length === 0
                      ? `You have ${assets.length} asset(s), but none have a host_name set yet. Edit each one and fill in the Host Name / IP first — without it we don't know what to connect to.`
                      : connectedCount === assetsWithHost.length
                      ? `All ${assetsWithHost.length} asset(s) with a host are connected. You're ready to scan from the Compliance tab on each asset.`
                      : `${connectedCount} of ${assetsWithHost.length} asset(s) connected · ${remainingCount} still need credentials.`}
                  </p>
                </div>
              </div>
              <button
                onClick={dismissGuidance}
                className="text-xs text-blue-700 hover:underline whitespace-nowrap"
                title="Hide this guidance — you can re-show by clearing browser storage"
              >
                Dismiss
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {/* Single-asset flow */}
              <div className="rounded-lg border border-blue-200 bg-white p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-900 mb-2">
                  Connect ONE asset
                </h3>
                <ol className="space-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                  <li>
                    Find the asset in the table below. Make sure it has a <strong>Host Name</strong> set (Edit the row if not).
                  </li>
                  <li>
                    Click the <Plug className="inline-block h-3.5 w-3.5 text-blue-600 mx-0.5 align-text-bottom" /> <strong>plug icon</strong> in the actions column.
                  </li>
                  <li>
                    Wizard opens with <strong>hostname pre-filled</strong>. Enter the username + password for that device's service account.
                  </li>
                  <li>
                    Click <strong>Connect server</strong>. We run a live pre-flight (WinRM / SSH whoami) before saving — you know immediately if creds are wrong.
                  </li>
                </ol>
              </div>

              {/* Bulk flow */}
              <div className="rounded-lg border border-indigo-200 bg-white p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-900 mb-2">
                  Connect MANY assets at once
                </h3>
                <ol className="space-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                  <li>
                    Tick the <strong>checkbox</strong> on each asset row you want to connect (or use the header checkbox to select all).
                  </li>
                  <li>
                    Click <strong className="text-indigo-700">Connect N selected</strong> in the toolbar above the table.
                  </li>
                  <li>
                    Enter the <strong>shared credentials once</strong> — same service account that has WinRM/SSH on every selected box (typical for AD-joined fleet).
                  </li>
                  <li>
                    Wizard iterates through each asset, runs handshake + pre-flight, and shows a live <strong>X of N done</strong> progress with any failures.
                  </li>
                </ol>
                <p className="mt-2 text-[11px] text-indigo-700 italic">
                  Tip: if assets in your selection use different credentials, do them in groups — one group per credential set.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500" style={{ width: 36 }}>
                {/* Select-all checkbox — covers only assets that have a
                    host_name (others can't be connected anyway). */}
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={
                    Array.isArray(assets) &&
                    (assets as ITAsset[]).filter((a) => !!a.host_name).length > 0 &&
                    (assets as ITAsset[]).filter((a) => !!a.host_name).every((a) => selectedAssetIds.has(a.id))
                  }
                  onChange={(e) => {
                    if (!Array.isArray(assets)) return;
                    if (e.target.checked) {
                      setSelectedAssetIds(new Set((assets as ITAsset[]).filter((a) => !!a.host_name).map((a) => a.id)));
                    } else {
                      clearSelection();
                    }
                  }}
                  title="Select all assets with a host_name"
                />
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Asset</th>
              <th className="hidden px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 md:table-cell">Type</th>
              <th className="hidden px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 lg:table-cell">CIA Ratings</th>
              <th className="hidden px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 lg:table-cell">Valuation</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Criticality</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Status</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredAssets?.map((asset: ITAsset) => {
              const isExpanded = expandedAsset === asset.id;
              const displayName = (() => {
                const isAutoName = asset.name === asset.ip_address || asset.name?.startsWith('Nessus-Host-');
                if (isAutoName) {
                  const locationName = asset.location
                    ? asset.location.split(',')[0].trim()
                    : '';
                  return asset.host_name || locationName || asset.name;
                }
                return asset.name;
              })();
              return (
                <React.Fragment key={asset.id}>
                  <tr
                    className="cursor-pointer bg-white transition-colors hover:bg-slate-50"
                    onClick={() => setExpandedAsset(isExpanded ? null : asset.id)}
                  >
                    {/* Bulk-connect checkbox — disabled for assets with
                        no host_name (nothing to connect to). */}
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                        checked={selectedAssetIds.has(asset.id)}
                        onChange={() => toggleAssetSelected(asset.id)}
                        disabled={!asset.host_name}
                        title={
                          !asset.host_name
                            ? 'Set a Host Name on this asset before selecting it for bulk-connect.'
                            : 'Select for bulk-connect'
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        {getAssetIcon(asset.asset_type)}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900">{displayName}</p>
                            {asset.cde_environment && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">CDE</span>
                            )}
                          </div>
                          <p className="line-clamp-1 text-sm text-slate-500">{asset.description || 'No description'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {getTypeBadge(asset.asset_type)}
                    </td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">
                      <div className="flex flex-col gap-1">
                        {getCIARatingBar(asset.confidentiality_rating, 'Confidentiality', 'bg-blue-500')}
                        {getCIARatingBar(asset.integrity_rating, 'Integrity', 'bg-green-500')}
                        {getCIARatingBar(asset.availability_rating, 'Availability', 'bg-yellow-500')}
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">
                      <div className="flex items-center gap-1 text-sm">
                        <DollarSign className="h-3 w-3 text-green-400" />
                        <span className="text-slate-700">{formatCurrency(asset.valuation)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{getCriticalityBadge(asset.criticality)}</td>
                    <td className="px-3 py-2.5">{getStatusBadge(asset.status)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {/* Connect — opens the Connect Wizard with this
                            asset's hostname pre-filled, so the operator
                            only enters username + password. Shown only
                            for assets that don't have a connection yet
                            (host_name is set but no IntegrationConnection
                            row points at it). */}
                        {asset.host_name && (
                          <button
                            onClick={(e) => handleConnect(e, asset)}
                            className="rounded p-1 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                            title="Connect — opens wizard pre-filled with this host"
                          >
                            <Plug className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleView(e, asset.id)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {canEdit && (
                          <button
                            onClick={(e) => handleEdit(e, asset)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={(e) => handleDelete(e, asset.id)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${asset.id}-expanded`}>
                      <td colSpan={8} className="bg-slate-50 px-3 py-3">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">Description</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.description || 'No description'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">Owner</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.owner_name || 'Not assigned'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">Vendor</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.vendor || 'N/A'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">Location</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.location || 'Unknown'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">Component</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.host_name || 'Not specified'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">Sub-components</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.custodian || 'Not specified'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-500">IP Address</h4>
                            <p className="mt-1 text-sm text-slate-900">{asset.ip_address || 'N/A'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Linked Controls</h4>
                            <button 
                              onClick={(e) => handleView(e, asset.id)}
                              className="mt-1 flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
                            >
                              <Shield size={14} />
                              <span>View details</span>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(!filteredAssets || filteredAssets.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-10 text-center">
          <Server className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-900">No assets found</h3>
          <p className="mt-1 text-slate-500">Add your first IT asset to get started</p>
        </div>
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
  { value: 'Oracle',     label: 'Oracle',     group: 'Database / ERP' },
  { value: 'SAP',        label: 'SAP',        group: 'Database / ERP' },
  { value: 'IBM',        label: 'IBM',        group: 'Database / ERP' },
  { value: 'Red Hat',    label: 'Red Hat',    group: 'OS / Platform' },
  { value: 'VMware',     label: 'VMware',     group: 'OS / Platform' },
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


function AssetModal({
  onClose,
  onSave,
  isLoading,
  initialData,
}: {
  onClose: () => void;
  onSave: (data: Parameters<typeof assetsApi.create>[0]) => void;
  isLoading: boolean;
  initialData?: ITAsset | null;
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
    cde_environment: (initialData as any)?.cde_environment || false,
    // Exposure metadata — drive the ISO 27005 derived criticality.
    data_classification: ((initialData as any)?.data_classification || '') as '' | 'public' | 'internal' | 'confidential' | 'restricted',
    internet_facing: Boolean((initialData as any)?.internet_facing),
    business_function: ((initialData as any)?.business_function || '') as string,
    network_segment: ((initialData as any)?.network_segment || '') as string,
    // Override
    criticality_manual_override: Boolean((initialData as any)?.criticality_manual_override),
    criticality_override_reason: ((initialData as any)?.criticality_override_reason || '') as string,
  });
  const [customSubComponent, setCustomSubComponent] = useState('');

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
      // Exposure metadata — feeds the derived criticality.
      data_classification: formData.data_classification || undefined,
      internet_facing: formData.internet_facing,
      business_function: formData.business_function || undefined,
      network_segment: formData.network_segment || undefined,
      // Criticality is derived server-side unless override is on.
      criticality_manual_override: formData.criticality_manual_override,
      criticality: formData.criticality_manual_override ? formData.criticality : undefined,
      criticality_override_reason: formData.criticality_manual_override ? formData.criticality_override_reason : undefined,
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
    total_rows: number;
    errors: string[];
    total_errors: number;
    message: string;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);

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
      if (response.data.imported > 0) {
        onSuccess();
      }
    } catch (error: any) {
      setResult({
        success: false,
        imported: 0,
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
              result.success && result.imported > 0
                ? 'border border-green-200 bg-green-50'
                : 'border border-red-200 bg-red-50'
            }`}>
              <div className="flex items-start gap-3">
                {result.success && result.imported > 0 ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
                )}
                <div>
                  <p className={`font-medium ${
                    result.success && result.imported > 0 ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {result.message}
                  </p>
                  <div className="mt-2 text-sm text-gray-600">
                    <p>Imported: {result.imported} of {result.total_rows} rows</p>
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
