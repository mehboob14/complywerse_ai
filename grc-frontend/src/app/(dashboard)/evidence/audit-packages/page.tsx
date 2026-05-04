'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Package,
  Loader2,
  AlertCircle,
  Search,
  Plus,
  X,
  Eye,
  Trash2,
  Download,
  Lock,
  Unlock,
  CheckCircle,
  Clock,
  FileCheck,
  Shield,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileText,
  Archive,
  GripVertical,
  AlertTriangle,
} from 'lucide-react';
import { PageLoader } from '@/components/ui';

interface Framework {
  id: number;
  name: string;
  code: string;
}

interface EvidenceItem {
  id: number;
  name: string;
  description: string | null;
  file_name: string | null;
  file_type: string | null;
  evidence_type: string | null;
  status: string;
  collection_date: string | null;
}

interface PackageEvidenceItem {
  id: number;
  evidence_id: number;
  sequence: number;
  notes: string | null;
  added_at: string | null;
  added_by: number | null;
  evidence: EvidenceItem | null;
}

interface AuditPackage {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  framework_id: number | null;
  framework_name: string | null;
  audit_period_start: string | null;
  audit_period_end: string | null;
  status: string;
  created_by: number | null;
  creator_name: string | null;
  created_at: string | null;
  finalized_at: string | null;
  finalized_by: number | null;
  export_path: string | null;
  exported_at: string | null;
  retention_until: string | null;
  is_legal_hold: boolean;
  evidence_count: number;
  evidence_items?: PackageEvidenceItem[];
  access_logs?: Array<{
    id: number;
    user_id: number;
    user_name: string | null;
    action: string;
    accessed_at: string | null;
    ip_address: string | null;
  }>;
}

interface PackageListResponse {
  items: AuditPackage[];
  total: number;
  skip: number;
  limit: number;
}

interface EvidenceListResponse {
  items: Array<{
    id: number;
    name: string;
    description: string | null;
    file_name: string | null;
    evidence_type: string | null;
    status: string;
    collection_date: string | null;
  }>;
  total: number;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof Clock }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft', icon: Clock },
  finalized: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Finalized', icon: Lock },
  exported: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Exported', icon: Download },
  archived: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Archived', icon: Archive },
};

export default function AuditPackagesPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('evidence:evidence_library:create');
  const canDelete = hasPermission('evidence:evidence_library:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<AuditPackage | null>(null);
  const [isEvidenceSelectorOpen, setIsEvidenceSelectorOpen] = useState(false);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<number[]>([]);
  const [evidenceSearchTerm, setEvidenceSearchTerm] = useState('');
  const queryClient = useQueryClient();

  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    framework_id: '',
    audit_period_start: '',
    audit_period_end: '',
  });

  const { data: packagesData, isLoading, error, refetch } = useQuery({
    queryKey: ['audit-packages', statusFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (statusFilter) params.status = statusFilter;
      const response = await apiClient.get('/evidence-mgmt/audit-packages', { params });
      return response.data as PackageListResponse;
    },
  });

  const { data: frameworksData } = useQuery({
    queryKey: ['frameworks-list'],
    queryFn: async () => {
      const response = await apiClient.get('/frameworks');
      return response.data as Framework[];
    },
  });

  const { data: packageDetail, refetch: refetchDetail } = useQuery({
    queryKey: ['audit-package-detail', selectedPackage?.id],
    queryFn: async () => {
      if (!selectedPackage?.id) return null;
      const response = await apiClient.get(`/evidence-mgmt/audit-packages/${selectedPackage.id}`);
      return response.data as AuditPackage;
    },
    enabled: !!selectedPackage?.id,
  });

  const { data: availableEvidence } = useQuery({
    queryKey: ['available-evidence', evidenceSearchTerm],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        status: 'approved',
        limit: 50,
      };
      if (evidenceSearchTerm) params.search = evidenceSearchTerm;
      const response = await apiClient.get('/evidence-mgmt/items', { params });
      return response.data as EvidenceListResponse;
    },
    enabled: isEvidenceSelectorOpen,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        description: data.description || null,
      };
      if (data.framework_id) payload.framework_id = parseInt(data.framework_id);
      if (data.audit_period_start) payload.audit_period_start = data.audit_period_start;
      if (data.audit_period_end) payload.audit_period_end = data.audit_period_end;
      const response = await apiClient.post('/evidence-mgmt/audit-packages', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      setIsCreateModalOpen(false);
      setCreateForm({ name: '', description: '', framework_id: '', audit_period_start: '', audit_period_end: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/evidence-mgmt/audit-packages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      if (selectedPackage) setSelectedPackage(null);
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiClient.post(`/evidence-mgmt/audit-packages/${id}/finalize`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['audit-package-detail'] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiClient.post(`/evidence-mgmt/audit-packages/${id}/export`);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['audit-package-detail'] });
      alert(`Package exported successfully!\nDownload URL: ${data.download_url}`);
    },
  });

  const legalHoldMutation = useMutation({
    mutationFn: async ({ id, isLegalHold }: { id: number; isLegalHold: boolean }) => {
      const response = await apiClient.post(`/evidence-mgmt/audit-packages/${id}/legal-hold`, {
        is_legal_hold: isLegalHold,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['audit-package-detail'] });
    },
  });

  const addEvidenceMutation = useMutation({
    mutationFn: async ({ packageId, evidenceIds }: { packageId: number; evidenceIds: number[] }) => {
      const response = await apiClient.post(`/evidence-mgmt/audit-packages/${packageId}/evidence`, {
        evidence_ids: evidenceIds,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['audit-package-detail'] });
      setIsEvidenceSelectorOpen(false);
      setSelectedEvidenceIds([]);
    },
  });

  const removeEvidenceMutation = useMutation({
    mutationFn: async ({ packageId, itemId }: { packageId: number; itemId: number }) => {
      await apiClient.delete(`/evidence-mgmt/audit-packages/${packageId}/evidence/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-packages'] });
      queryClient.invalidateQueries({ queryKey: ['audit-package-detail'] });
    },
  });

  const reorderEvidenceMutation = useMutation({
    mutationFn: async ({ packageId, itemId, newSequence }: { packageId: number; itemId: number; newSequence: number }) => {
      const response = await apiClient.put(`/evidence-mgmt/audit-packages/${packageId}/evidence/${itemId}/reorder`, {
        new_sequence: newSequence,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-package-detail'] });
    },
  });

  const packages = packagesData?.items || [];
  const totalItems = packagesData?.total || 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  const filteredPackages = useMemo(() => {
    if (!searchTerm) return packages;
    const term = searchTerm.toLowerCase();
    return packages.filter(pkg => 
      pkg.name.toLowerCase().includes(term) ||
      (pkg.framework_name && pkg.framework_name.toLowerCase().includes(term))
    );
  }, [packages, searchTerm]);

  const handleDelete = (pkg: AuditPackage) => {
    if (pkg.is_legal_hold) {
      alert('Cannot delete a package on legal hold');
      return;
    }
    if (pkg.status !== 'draft') {
      alert('Can only delete packages in draft status');
      return;
    }
    if (confirm(`Are you sure you want to delete "${pkg.name}"?`)) {
      deleteMutation.mutate(pkg.id);
    }
  };

  const handleFinalize = (pkg: AuditPackage) => {
    if (pkg.evidence_count === 0) {
      alert('Cannot finalize a package with no evidence');
      return;
    }
    if (confirm(`Finalize "${pkg.name}"? This will lock the package from further changes.`)) {
      finalizeMutation.mutate(pkg.id);
    }
  };

  const handleExport = (pkg: AuditPackage) => {
    if (pkg.status !== 'finalized' && pkg.status !== 'exported') {
      alert('Can only export finalized packages');
      return;
    }
    exportMutation.mutate(pkg.id);
  };

  const toggleLegalHold = (pkg: AuditPackage) => {
    const action = pkg.is_legal_hold ? 'remove' : 'set';
    if (confirm(`${action === 'set' ? 'Set' : 'Remove'} legal hold on "${pkg.name}"?`)) {
      legalHoldMutation.mutate({ id: pkg.id, isLegalHold: !pkg.is_legal_hold });
    }
  };

  const handleAddEvidence = () => {
    if (!selectedPackage || selectedEvidenceIds.length === 0) return;
    addEvidenceMutation.mutate({ packageId: selectedPackage.id, evidenceIds: selectedEvidenceIds });
  };

  const handleRemoveEvidence = (itemId: number) => {
    if (!selectedPackage) return;
    if (confirm('Remove this evidence from the package?')) {
      removeEvidenceMutation.mutate({ packageId: selectedPackage.id, itemId });
    }
  };

  const toggleEvidenceSelection = (id: number) => {
    setSelectedEvidenceIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const moveEvidence = (item: PackageEvidenceItem, direction: 'up' | 'down') => {
    if (!selectedPackage || !packageDetail?.evidence_items) return;
    const items = [...packageDetail.evidence_items].sort((a, b) => a.sequence - b.sequence);
    const currentIndex = items.findIndex(i => i.id === item.id);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    const newSequence = items[newIndex].sequence;
    reorderEvidenceMutation.mutate({ packageId: selectedPackage.id, itemId: item.id, newSequence });
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const getStatusBadge = (status: string, isLegalHold: boolean) => {
    const style = STATUS_STYLES[status] || STATUS_STYLES.draft;
    const IconComponent = style.icon;
    return (
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full ${style.bg} px-2.5 py-1 text-xs font-medium ${style.text}`}>
          <IconComponent size={12} />
          {style.label}
        </span>
        {isLegalHold && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
            <Lock size={10} />
            Legal Hold
          </span>
        )}
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-400">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load audit packages</p>
        <button onClick={() => refetch()} className="text-primary-400 hover:underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Audit Package Builder</h1>
          <p className="text-gray-600">Create and manage audit evidence packages</p>
        </div>
        {canCreate && (
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 transition-colors"
        >
          <Plus size={18} />
          Create Package
        </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              placeholder="Search packages..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="finalized">Finalized</option>
            <option value="exported">Exported</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${selectedPackage ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {isLoading ? (
              <PageLoader className="h-64" />
            ) : filteredPackages.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-4 text-gray-600">
                <Package className="h-12 w-12" />
                <p>No audit packages found</p>
                {canCreate && (
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                >
                  <Plus size={18} />
                  Create First Package
                </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Framework</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Audit Period</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Evidence</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredPackages.map((pkg) => (
                        <tr
                          key={pkg.id}
                          className={`hover:bg-gray-50 transition-colors cursor-pointer ${selectedPackage?.id === pkg.id ? 'bg-gray-50' : ''}`}
                          onClick={() => setSelectedPackage(pkg)}
                        >
                          <td className="px-4 py-4">
                            <div>
                              <p className="font-medium text-white">{pkg.name}</p>
                              {pkg.description && (
                                <p className="text-sm text-gray-600 truncate max-w-xs">{pkg.description}</p>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-4">
                            {pkg.framework_name ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-500/20 px-2.5 py-1 text-xs font-medium text-primary-400">
                                <Shield size={12} />
                                {pkg.framework_name}
                              </span>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                            {pkg.audit_period_start || pkg.audit_period_end ? (
                              <div className="flex items-center gap-1">
                                <Calendar size={14} className="text-gray-600" />
                                {formatDate(pkg.audit_period_start)} - {formatDate(pkg.audit_period_end)}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4">
                            {getStatusBadge(pkg.status, pkg.is_legal_hold)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4">
                            <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                              <FileCheck size={14} className="text-gray-600" />
                              {pkg.evidence_count}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setSelectedPackage(pkg)}
                                className="rounded p-1.5 text-gray-600 hover:bg-gray-50 hover:text-black transition-colors"
                                title="View Details"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              {pkg.status === 'draft' && (
                                <button
                                  onClick={() => handleFinalize(pkg)}
                                  disabled={finalizeMutation.isPending}
                                  className="rounded p-1.5 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                  title="Finalize"
                                >
                                  <Lock className="h-4 w-4" />
                                </button>
                              )}
                              {(pkg.status === 'finalized' || pkg.status === 'exported') && (
                                <button
                                  onClick={() => handleExport(pkg)}
                                  disabled={exportMutation.isPending}
                                  className="rounded p-1.5 text-green-400 hover:bg-green-500/20 transition-colors"
                                  title="Export ZIP"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                onClick={() => toggleLegalHold(pkg)}
                                disabled={legalHoldMutation.isPending}
                                className={`rounded p-1.5 transition-colors ${pkg.is_legal_hold ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-50'}`}
                                title={pkg.is_legal_hold ? 'Remove Legal Hold' : 'Set Legal Hold'}
                              >
                                {pkg.is_legal_hold ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                              </button>
                              {pkg.status === 'draft' && !pkg.is_legal_hold && canDelete && (
                                <button
                                  onClick={() => handleDelete(pkg)}
                                  disabled={deleteMutation.isPending}
                                  className="rounded p-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                    <p className="text-sm text-gray-600">
                      Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalItems)} of {totalItems}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="rounded p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <span className="text-sm text-gray-700">{page + 1} / {totalPages}</span>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="rounded p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {selectedPackage && (
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden sticky top-4">
              <div className="border-b border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Package Details</h2>
                  <button
                    onClick={() => setSelectedPackage(null)}
                    className="rounded p-1 text-gray-600 hover:bg-gray-50 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <h3 className="font-medium text-white">{packageDetail?.name || selectedPackage.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{packageDetail?.description || selectedPackage.description || 'No description'}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">Framework</p>
                    <p className="text-gray-700">{packageDetail?.framework_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Status</p>
                    {getStatusBadge(packageDetail?.status || selectedPackage.status, packageDetail?.is_legal_hold || selectedPackage.is_legal_hold)}
                  </div>
                  <div>
                    <p className="text-gray-500">Period Start</p>
                    <p className="text-gray-700">{formatDate(packageDetail?.audit_period_start)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Period End</p>
                    <p className="text-gray-700">{formatDate(packageDetail?.audit_period_end)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Created</p>
                    <p className="text-gray-700">{formatDate(packageDetail?.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Created By</p>
                    <p className="text-gray-700">{packageDetail?.creator_name || '-'}</p>
                  </div>
                </div>

                {(packageDetail?.status || selectedPackage.status) === 'draft' && (
                  <button
                    onClick={() => setIsEvidenceSelectorOpen(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600/10 px-4 py-2 text-sm font-medium text-primary-400 hover:bg-primary-600/20 transition-colors"
                  >
                    <Plus size={16} />
                    Add Evidence
                  </button>
                )}

                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Evidence Items ({packageDetail?.evidence_items?.length || 0})</h4>
                  
                  {packageDetail?.evidence_items && packageDetail.evidence_items.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {[...packageDetail.evidence_items]
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((item, index) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 p-2"
                          >
                            {(packageDetail.status || selectedPackage.status) === 'draft' && (
                              <div className="flex flex-col">
                                <button
                                  onClick={() => moveEvidence(item, 'up')}
                                  disabled={index === 0}
                                  className="p-0.5 text-gray-600 hover:text-white disabled:opacity-30"
                                >
                                  <ChevronLeft size={14} className="rotate-90" />
                                </button>
                                <button
                                  onClick={() => moveEvidence(item, 'down')}
                                  disabled={index === packageDetail.evidence_items!.length - 1}
                                  className="p-0.5 text-gray-600 hover:text-white disabled:opacity-30"
                                >
                                  <ChevronRight size={14} className="rotate-90" />
                                </button>
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{item.evidence?.name || `Evidence #${item.evidence_id}`}</p>
                              <p className="text-xs text-gray-600">{item.evidence?.evidence_type || 'Unknown type'}</p>
                            </div>
                            {(packageDetail.status || selectedPackage.status) === 'draft' && (
                              <button
                                onClick={() => handleRemoveEvidence(item.id)}
                                disabled={removeEvidenceMutation.isPending}
                                className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-4">No evidence added yet</p>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  {(packageDetail?.status || selectedPackage.status) === 'draft' && (
                    <button
                      onClick={() => handleFinalize(packageDetail || selectedPackage)}
                      disabled={finalizeMutation.isPending || (packageDetail?.evidence_items?.length || 0) === 0}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <Lock size={14} />
                      Finalize
                    </button>
                  )}
                  {((packageDetail?.status || selectedPackage.status) === 'finalized' || 
                    (packageDetail?.status || selectedPackage.status) === 'exported') && (
                    <button
                      onClick={() => handleExport(packageDetail || selectedPackage)}
                      disabled={exportMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      <Download size={14} />
                      Export ZIP
                    </button>
                  )}
                  <button
                    onClick={() => toggleLegalHold(packageDetail || selectedPackage)}
                    disabled={legalHoldMutation.isPending}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      (packageDetail?.is_legal_hold || selectedPackage.is_legal_hold)
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {(packageDetail?.is_legal_hold || selectedPackage.is_legal_hold) ? (
                      <>
                        <Unlock size={14} />
                        Remove Hold
                      </>
                    ) : (
                      <>
                        <Lock size={14} />
                        Legal Hold
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Create Audit Package</h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded p-1 text-gray-600 hover:bg-gray-50 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!createForm.name.trim()) return;
                createMutation.mutate(createForm);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  placeholder="Q4 2025 Audit Package"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
                  rows={3}
                  placeholder="Description of the audit package..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Framework</label>
                <select
                  value={createForm.framework_id}
                  onChange={(e) => setCreateForm(f => ({ ...f, framework_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a framework...</option>
                  {frameworksData?.map(fw => (
                    <option key={fw.id} value={fw.id}>{fw.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Audit Period Start</label>
                  <input
                    type="date"
                    value={createForm.audit_period_start}
                    onChange={(e) => setCreateForm(f => ({ ...f, audit_period_start: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Audit Period End</label>
                  <input
                    type="date"
                    value={createForm.audit_period_end}
                    onChange={(e) => setCreateForm(f => ({ ...f, audit_period_end: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !createForm.name.trim()}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                  Create Package
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEvidenceSelectorOpen && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Add Evidence to Package</h2>
              <button
                onClick={() => { setIsEvidenceSelectorOpen(false); setSelectedEvidenceIds([]); }}
                className="rounded p-1 text-gray-600 hover:bg-gray-50 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
              <input
                type="text"
                placeholder="Search approved evidence..."
                value={evidenceSearchTerm}
                onChange={(e) => setEvidenceSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-black placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
              {availableEvidence?.items && availableEvidence.items.length > 0 ? (
                <div className="divide-y divide-gray-200">
                  {availableEvidence.items.map((evidence) => {
                    const isSelected = selectedEvidenceIds.includes(evidence.id);
                    const alreadyAdded = packageDetail?.evidence_items?.some(item => item.evidence_id === evidence.id);
                    
                    return (
                      <label
                        key={evidence.id}
                        className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                          alreadyAdded ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                        } ${isSelected ? 'bg-primary-600/10' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => !alreadyAdded && toggleEvidenceSelection(evidence.id)}
                          disabled={alreadyAdded}
                          className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-600 focus:ring-primary-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white">{evidence.name}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <span>{evidence.evidence_type || 'Unknown type'}</span>
                            {evidence.collection_date && (
                              <>
                                <span>•</span>
                                <span>{formatDate(evidence.collection_date)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {alreadyAdded && (
                          <span className="text-xs text-gray-500">Already added</span>
                        )}
                        <span className="inline-flex items-center rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                          <CheckCircle size={10} className="mr-1" />
                          Approved
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <FileText className="h-8 w-8 mb-2" />
                  <p>No approved evidence found</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-200 mt-4">
              <p className="text-sm text-gray-600">
                {selectedEvidenceIds.length} item{selectedEvidenceIds.length !== 1 ? 's' : ''} selected
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setIsEvidenceSelectorOpen(false); setSelectedEvidenceIds([]); }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddEvidence}
                  disabled={addEvidenceMutation.isPending || selectedEvidenceIds.length === 0}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {addEvidenceMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                  Add Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

