'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { assetsApi } from '@/lib/api';
import { ITAsset, AssetType } from '@/types';
import { 
  Server, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
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
  CheckCircle2
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

export default function AssetsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [criticalityFilter, setCriticalityFilter] = useState<CriticalityFilter>('all');
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
      active: 'bg-green-900/50 text-green-400',
      inactive: 'bg-yellow-900/50 text-yellow-400',
      decommissioned: 'bg-slate-700 text-slate-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${colors[status] || 'bg-slate-700 text-slate-400'}`}>
        {status}
      </span>
    );
  };

  const getCriticalityBadge = (criticality: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-900/50 text-red-400',
      high: 'bg-orange-900/50 text-orange-400',
      medium: 'bg-yellow-900/50 text-yellow-400',
      low: 'bg-green-900/50 text-green-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${colors[criticality] || 'bg-slate-700 text-slate-400'}`}>
        {criticality}
      </span>
    );
  };

  const getTypeBadge = (type: string) => {
    const assetType = ASSET_TYPES.find(t => t.value === type);
    return (
      <span className="rounded-full bg-primary-900/50 px-2 py-0.5 text-xs text-primary-400">
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
              className={`h-2 w-1.5 rounded-sm ${i <= value ? color : 'bg-slate-700'}`}
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
    
    return matchesSearch && matchesStatus && matchesCriticality;
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

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">IT Asset Inventory & Valuation</h1>
          <p className="text-slate-400">Manage and track IT assets with CIA ratings and valuations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => assetsApi.downloadTemplate()}
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700"
            title="Download CSV template for bulk import"
          >
            <Download size={16} />
            Template
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-primary-600 bg-primary-600/20 px-3 py-2 text-sm font-medium text-primary-400 hover:bg-primary-600/30"
          >
            <Upload size={16} />
            Import
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            <Plus size={18} />
            Add Asset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg bg-slate-800 p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-2">
              <Server className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Total Assets</p>
              <p className="text-2xl font-semibold text-white">{dashboard?.total_assets || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800 p-4 border border-slate-700">
          <p className="text-sm text-slate-400 mb-2">By Type</p>
          <div className="space-y-1">
            {Object.entries(dashboard?.by_type || {}).map(([type, count]) => (
              <div key={type} className="flex justify-between text-xs">
                <span className="text-slate-300 capitalize">{type.replace('_', ' ')}</span>
                <span className="text-white font-medium">{count as number}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800 p-4 border border-slate-700">
          <p className="text-sm text-slate-400 mb-2">By Criticality</p>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-red-400">Critical</span>
              <span className="text-white font-medium">{dashboard?.by_criticality?.critical || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-orange-400">High</span>
              <span className="text-white font-medium">{dashboard?.by_criticality?.high || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-yellow-400">Medium</span>
              <span className="text-white font-medium">{dashboard?.by_criticality?.medium || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-green-400">Low</span>
              <span className="text-white font-medium">{dashboard?.by_criticality?.low || 0}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800 p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <DollarSign className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">High Value</p>
              <p className="text-2xl font-semibold text-white">{dashboard?.high_value_assets || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800 p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Need Assessment</p>
              <p className="text-2xl font-semibold text-white">{dashboard?.assets_needing_assessment || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800 p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Shield className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Status</p>
              <div className="flex gap-2 text-sm">
                <span className="text-green-400">{dashboard?.by_status?.active || 0} active</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="decommissioned">Decommissioned</option>
          </select>
        </div>

        <select
          value={criticalityFilter}
          onChange={(e) => setCriticalityFilter(e.target.value as CriticalityFilter)}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
        >
          <option value="all">All Criticality</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700">
        <table className="w-full">
          <thead className="bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Asset</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 md:table-cell">Type</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 lg:table-cell">CIA Ratings</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 lg:table-cell">Valuation</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Criticality</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredAssets?.map((asset: ITAsset) => {
              const isExpanded = expandedAsset === asset.id;
              return (
                <React.Fragment key={asset.id}>
                  <tr 
                    className="bg-slate-800/50 hover:bg-slate-700/50 cursor-pointer"
                    onClick={() => setExpandedAsset(isExpanded ? null : asset.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {getAssetIcon(asset.asset_type)}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white">{asset.name}</p>
                            {asset.cde_environment && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">CDE</span>
                            )}
                          </div>
                          <p className="text-sm text-slate-400 line-clamp-1">{asset.description || 'No description'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {getTypeBadge(asset.asset_type)}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <div className="flex flex-col gap-1">
                        {getCIARatingBar(asset.confidentiality_rating, 'Confidentiality', 'bg-blue-500')}
                        {getCIARatingBar(asset.integrity_rating, 'Integrity', 'bg-green-500')}
                        {getCIARatingBar(asset.availability_rating, 'Availability', 'bg-yellow-500')}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <div className="flex items-center gap-1 text-sm">
                        <DollarSign className="h-3 w-3 text-green-400" />
                        <span className="text-slate-300">{formatCurrency(asset.valuation)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{getCriticalityBadge(asset.criticality)}</td>
                    <td className="px-4 py-3">{getStatusBadge(asset.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => handleView(e, asset.id)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleEdit(e, asset)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, asset.id)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${asset.id}-expanded`}>
                      <td colSpan={7} className="bg-slate-900 px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Description</h4>
                            <p className="mt-1 text-sm text-white">{asset.description || 'No description'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Owner</h4>
                            <p className="mt-1 text-sm text-white">{asset.owner_name || 'Not assigned'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Vendor</h4>
                            <p className="mt-1 text-sm text-white">{asset.vendor || 'N/A'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Location</h4>
                            <p className="mt-1 text-sm text-white">{asset.location || 'Unknown'}</p>
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
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <Server className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No assets found</h3>
          <p className="mt-1 text-slate-400">Add your first IT asset to get started</p>
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
    status: (initialData?.status || 'active') as 'active' | 'inactive' | 'decommissioned',
    cde_environment: (initialData as any)?.cde_environment || false,
  });
  
  const isEditMode = !!initialData;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = {
      name: formData.name,
      description: formData.description || undefined,
      asset_type: formData.asset_type,
      owner_id: formData.owner_id || undefined,
      vendor: formData.vendor || undefined,
      location: formData.location || undefined,
      criticality: formData.criticality,
      confidentiality_rating: formData.confidentiality_rating,
      integrity_rating: formData.integrity_rating,
      availability_rating: formData.availability_rating,
      valuation: formData.valuation || undefined,
      cde_environment: formData.cde_environment,
    };
    if (isEditMode) {
      submitData.status = formData.status;
    }
    onSave(submitData);
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
      <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
              rating <= value
                ? `${color} border-transparent text-white`
                : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {rating}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{isEditMode ? 'Edit Asset' : 'Add Asset'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border-b border-slate-700 pb-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Basic Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300">Asset Type *</label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {ASSET_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = formData.asset_type === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, asset_type: type.value as AssetType })}
                        className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-primary-500 bg-primary-900/30'
                            : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${isSelected ? 'text-primary-400' : 'text-slate-400'}`} />
                        <div>
                          <p className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                            {type.label}
                          </p>
                          <p className="text-xs text-slate-500 line-clamp-1">{type.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-700 pb-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Ownership & Location</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-300">Vendor</label>
                <input
                  type="text"
                  value={formData.vendor}
                  onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                  placeholder="e.g., Microsoft, AWS"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                  placeholder="e.g., US-East, On-Premise"
                />
              </div>
            </div>
          </div>

          <div className="border-b border-slate-700 pb-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Classification</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300">Criticality</label>
              <select
                value={formData.criticality}
                onChange={(e) => setFormData({ ...formData, criticality: e.target.value as typeof formData.criticality })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="low">Low - Minimal business impact</option>
                <option value="medium">Medium - Moderate business impact</option>
                <option value="high">High - Significant business impact</option>
                <option value="critical">Critical - Essential for operations</option>
              </select>
            </div>
          </div>

          <div className="border-b border-slate-700 pb-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">PCI DSS Scope</h3>
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, cde_environment: !formData.cde_environment })}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  formData.cde_environment ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    formData.cde_environment ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <span className="text-sm font-medium text-slate-300">CDE Environment</span>
                <p className="text-xs text-slate-500">Mark this asset as part of the Cardholder Data Environment (PCI DSS)</p>
              </div>
            </label>
          </div>

          <div className="border-b border-slate-700 pb-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">CIA Ratings</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

          <div className="pb-2">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Valuation</h3>
            <div>
              <label className="block text-sm font-medium text-slate-300">Asset Value (USD)</label>
              <div className="relative mt-1">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  value={formData.valuation || ''}
                  onChange={(e) => setFormData({ ...formData, valuation: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 py-2 pl-10 pr-4 text-white focus:border-primary-500 focus:outline-none"
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>
          </div>

          {isEditMode && (
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-sm font-medium text-slate-400 mb-3">Status</h3>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as typeof formData.status })}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="decommissioned">Decommissioned</option>
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditMode ? 'Save Changes' : 'Add Asset'}
            </button>
          </div>
        </form>
      </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Import IT Assets</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {!result ? (
          <>
            <div className="mb-4 rounded-lg border border-slate-600 bg-slate-700/50 p-4">
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="h-5 w-5 text-primary-400 mt-0.5" />
                <div>
                  <p className="text-sm text-white font-medium">How to import assets:</p>
                  <ol className="mt-2 text-xs text-slate-400 space-y-1 list-decimal list-inside">
                    <li>Click "Template" button to download the CSV template</li>
                    <li>Fill in your assets (keep the header row)</li>
                    <li>Upload the completed file here</li>
                  </ol>
                </div>
              </div>
            </div>

            <div
              className={`relative mb-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                dragActive
                  ? 'border-primary-500 bg-primary-900/20'
                  : file
                  ? 'border-green-500 bg-green-900/20'
                  : 'border-slate-600 hover:border-slate-500'
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
                  <CheckCircle2 className="h-10 w-10 text-green-400 mb-2" />
                  <p className="text-white font-medium">{file.name}</p>
                  <p className="text-sm text-slate-400 mt-1">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    className="mt-2 text-xs text-slate-400 hover:text-white"
                  >
                    Choose different file
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Upload className="h-10 w-10 text-slate-500 mb-2" />
                  <p className="text-white">Drag and drop your file here</p>
                  <p className="text-sm text-slate-400 mt-1">or click to browse</p>
                  <p className="text-xs text-slate-500 mt-2">Supports CSV, XLSX, XLS</p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!file || isUploading}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
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
                ? 'bg-green-900/30 border border-green-800'
                : 'bg-red-900/30 border border-red-800'
            }`}>
              <div className="flex items-start gap-3">
                {result.success && result.imported > 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
                )}
                <div>
                  <p className={`font-medium ${
                    result.success && result.imported > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {result.message}
                  </p>
                  <div className="mt-2 text-sm text-slate-300">
                    <p>Imported: {result.imported} of {result.total_rows} rows</p>
                    {result.total_errors > 0 && (
                      <p className="text-red-400">Errors: {result.total_errors}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="mb-4 max-h-40 overflow-y-auto rounded-lg bg-slate-700/50 p-3">
                <p className="text-xs font-medium text-slate-400 mb-2">Error Details:</p>
                <ul className="text-xs text-red-400 space-y-1">
                  {result.errors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
                {result.total_errors > result.errors.length && (
                  <p className="text-xs text-slate-500 mt-2">
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
                className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
              >
                Import More
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700"
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
