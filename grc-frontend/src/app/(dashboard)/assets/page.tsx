'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  Monitor,
  Database,
  Cloud,
  Wifi,
  Cpu,
  Smartphone,
  Shield,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

type StatusFilter = 'all' | 'active' | 'inactive' | 'decommissioned';
type CriticalityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const ASSET_TYPES = [
  { value: 'server', label: 'Server', icon: Server },
  { value: 'workstation', label: 'Workstation', icon: Monitor },
  { value: 'network_device', label: 'Network Device', icon: Wifi },
  { value: 'application', label: 'Application', icon: Cpu },
  { value: 'database', label: 'Database', icon: Database },
  { value: 'cloud_service', label: 'Cloud Service', icon: Cloud },
  { value: 'iot_device', label: 'IoT Device', icon: Smartphone },
];

export default function AssetsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [criticalityFilter, setCriticalityFilter] = useState<CriticalityFilter>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: assets, isLoading, error } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<ITAsset>) => assetsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setIsModalOpen(false);
    },
  });

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

  const filteredAssets = assets?.filter((asset: ITAsset) => {
    const matchesSearch = 
      asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.asset_tag?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.hostname?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || asset.status === statusFilter;
    const matchesCriticality = criticalityFilter === 'all' || asset.criticality === criticalityFilter;
    
    return matchesSearch && matchesStatus && matchesCriticality;
  });

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
          <h1 className="text-2xl font-bold text-white">IT Asset Inventory</h1>
          <p className="text-slate-400">Manage and track IT assets</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <Plus size={18} />
          Add Asset
        </button>
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
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 lg:table-cell">IP / Hostname</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Criticality</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-slate-300"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredAssets?.map((asset: ITAsset) => {
              const isExpanded = expandedAsset === asset.id;
              return (
                <>
                  <tr 
                    key={asset.id} 
                    className="bg-slate-800/50 hover:bg-slate-700/50 cursor-pointer"
                    onClick={() => setExpandedAsset(isExpanded ? null : asset.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {getAssetIcon(asset.asset_type)}
                        <div>
                          <p className="font-medium text-white">{asset.name}</p>
                          <p className="text-sm text-slate-400">{asset.asset_tag || 'No tag'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-sm text-slate-400 md:table-cell">
                      {ASSET_TYPES.find(t => t.value === asset.asset_type)?.label || asset.asset_type}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <div className="text-sm">
                        {asset.ip_address && <p className="font-mono text-slate-300">{asset.ip_address}</p>}
                        {asset.hostname && <p className="text-slate-500">{asset.hostname}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{getCriticalityBadge(asset.criticality)}</td>
                    <td className="px-4 py-3">{getStatusBadge(asset.status)}</td>
                    <td className="px-4 py-3 text-right">
                      {isExpanded ? (
                        <ChevronDown className="inline h-5 w-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="inline h-5 w-5 text-slate-400" />
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${asset.id}-expanded`}>
                      <td colSpan={6} className="bg-slate-900 px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Description</h4>
                            <p className="mt-1 text-sm text-white">{asset.description || 'No description'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Department</h4>
                            <p className="mt-1 text-sm text-white">{asset.department || 'Not assigned'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Location</h4>
                            <p className="mt-1 text-sm text-white">{asset.location || 'Unknown'}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-slate-400">Linked Controls</h4>
                            <div className="mt-1 flex items-center gap-1 text-sm text-primary-400">
                              <Shield size={14} />
                              <span>View controls</span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
    </div>
  );
}

function AssetModal({
  onClose,
  onSave,
  isLoading,
}: {
  onClose: () => void;
  onSave: (data: Partial<ITAsset>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    asset_type: 'server' as AssetType,
    asset_tag: '',
    ip_address: '',
    hostname: '',
    department: '',
    location: '',
    criticality: 'medium' as 'low' | 'medium' | 'high' | 'critical',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      status: 'active',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Add Asset</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">Name</label>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">Type</label>
              <select
                value={formData.asset_type}
                onChange={(e) => setFormData({ ...formData, asset_type: e.target.value as AssetType })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                {ASSET_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Asset Tag</label>
              <input
                type="text"
                value={formData.asset_tag}
                onChange={(e) => setFormData({ ...formData, asset_tag: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                placeholder="e.g., ASSET-001"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">IP Address</label>
              <input
                type="text"
                value={formData.ip_address}
                onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                placeholder="192.168.1.1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Hostname</label>
              <input
                type="text"
                value={formData.hostname}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">Department</label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Criticality</label>
            <select
              value={formData.criticality}
              onChange={(e) => setFormData({ ...formData, criticality: e.target.value as typeof formData.criticality })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

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
              Add Asset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
