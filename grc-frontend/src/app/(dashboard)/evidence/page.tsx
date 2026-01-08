'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { 
  FileCheck, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
  Upload,
  X,
  CheckCircle,
  Clock,
  XCircle,
  FileText,
  Calendar,
  Brain,
  Eye,
  Edit2,
  Trash2,
  ScanText,
  Link2,
  AlertTriangle,
  BarChart3,
  Image,
  FileSpreadsheet,
  ShieldCheck,
  ClipboardList,
  Settings,
  ChevronDown,
  RefreshCw,
  MoreVertical
} from 'lucide-react';

type StatusFilter = 'all' | 'draft' | 'pending_review' | 'approved' | 'rejected' | 'expired';
type OCRStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'not_applicable';

interface EvidenceItem {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  version: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  uploaded_at: string | null;
  status: string;
  ocr_status: OCRStatus;
  ocr_processed_at: string | null;
  evidence_type: string | null;
  collection_date: string | null;
  validity_period_days: number | null;
  expiry_date: string | null;
  is_stale: boolean;
  source_system: string | null;
  content_summary: string | null;
  quality_score: number | null;
  submitted_by: number | null;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_comments: string | null;
  approved_by: number | null;
  approved_at: string | null;
  control_mappings_count?: number;
}

interface EvidenceListResponse {
  items: EvidenceItem[];
  total: number;
  skip: number;
  limit: number;
}

interface EvidenceSummary {
  total_count: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  stale_count: number;
  expiring_soon_count: number;
  pending_review_count: number;
}

interface EvidenceType {
  value: string;
  label: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Draft' },
  pending_review: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending Review' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Rejected' },
  expired: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Expired' },
  archived: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Archived' },
};

const OCR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof ScanText }> = {
  pending: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'OCR Pending', icon: Clock },
  processing: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Processing', icon: RefreshCw },
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'OCR Done', icon: CheckCircle },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'OCR Failed', icon: XCircle },
  not_applicable: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'N/A', icon: FileText },
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  screenshot: Image,
  document: FileText,
  certificate: ShieldCheck,
  audit_report: ClipboardList,
  log: FileSpreadsheet,
  policy: FileText,
  procedure: ClipboardList,
  configuration: Settings,
  attestation: ShieldCheck,
  training_record: ClipboardList,
  access_review: Eye,
  vulnerability_scan: AlertTriangle,
  penetration_test: ShieldCheck,
  backup_log: FileSpreadsheet,
  change_record: Edit2,
  incident_report: AlertCircle,
  other: FileCheck,
};

export default function EvidencePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [staleFilter, setStaleFilter] = useState<boolean | null>(null);
  const [showExpired, setShowExpired] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(12);
  const queryClient = useQueryClient();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['evidence-summary'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items/dashboard/summary');
      return response.data as EvidenceSummary;
    },
  });

  const { data: evidenceTypes } = useQuery({
    queryKey: ['evidence-types'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items/types');
      return response.data.types as EvidenceType[];
    },
  });

  const { data: evidenceData, isLoading, error, refetch } = useQuery({
    queryKey: ['evidence-items', statusFilter, typeFilter, staleFilter, searchTerm, showExpired, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter) params.evidence_type = typeFilter;
      if (staleFilter !== null) params.is_stale = staleFilter;
      if (searchTerm) params.search = searchTerm;
      
      const response = await apiClient.get('/evidence-mgmt/items', { params });
      return response.data as EvidenceListResponse;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => 
      apiClient.post('/evidence-mgmt/items/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-summary'] });
      setIsUploadModalOpen(false);
    },
  });

  const processOCRMutation = useMutation({
    mutationFn: (evidenceId: number) => 
      apiClient.post(`/evidence-mgmt/ocr/${evidenceId}/process-ocr`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
    },
  });

  const batchProcessOCRMutation = useMutation({
    mutationFn: (evidenceIds: number[]) => 
      apiClient.post('/evidence-mgmt/ocr/batch-process', { evidence_ids: evidenceIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      setSelectedItems([]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/evidence-mgmt/items/${id}?force=true`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-summary'] });
    },
  });

  const toggleSelectItem = (id: number) => {
    setSelectedItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (!evidenceData?.items) return;
    if (selectedItems.length === evidenceData.items.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(evidenceData.items.map(item => item.id));
    }
  };

  const handleDelete = (item: EvidenceItem) => {
    if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const getQualityScoreColor = (score: number | null) => {
    if (score === null) return 'bg-slate-600';
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getStatusBadge = (status: string) => {
    const style = STATUS_STYLES[status] || STATUS_STYLES.draft;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full ${style.bg} px-2 py-0.5 text-xs font-medium ${style.text}`}>
        {status === 'approved' && <CheckCircle size={12} />}
        {status === 'pending_review' && <Clock size={12} />}
        {status === 'rejected' && <XCircle size={12} />}
        {status === 'expired' && <AlertTriangle size={12} />}
        {status === 'draft' && <FileText size={12} />}
        {style.label}
      </span>
    );
  };

  const getOCRBadge = (ocrStatus: OCRStatus) => {
    const style = OCR_STATUS_STYLES[ocrStatus] || OCR_STATUS_STYLES.pending;
    const IconComponent = style.icon;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full ${style.bg} px-2 py-0.5 text-xs ${style.text}`}>
        <IconComponent size={10} className={ocrStatus === 'processing' ? 'animate-spin' : ''} />
        {style.label}
      </span>
    );
  };

  const filteredItems = evidenceData?.items?.filter(item => {
    if (!showExpired && item.status === 'expired') return false;
    return true;
  }) || [];

  const totalItems = evidenceData?.total || 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evidence Library</h1>
          <p className="text-slate-400">Manage compliance evidence and documentation</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedItems.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">{selectedItems.length} selected</span>
              <button
                onClick={() => batchProcessOCRMutation.mutate(selectedItems)}
                disabled={batchProcessOCRMutation.isPending}
                className="flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
              >
                <ScanText size={14} />
                Batch OCR
              </button>
            </div>
          )}
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            <Upload size={18} />
            Upload Evidence
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <FileCheck className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.total_count || 0}</p>
          <p className="stat-label">Total Evidence</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <CheckCircle className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.by_status?.approved || 0}</p>
          <p className="stat-label">Approved</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 p-3">
              <Clock className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.pending_review_count || 0}</p>
          <p className="stat-label">Pending Review</p>
        </div>

        <div className="stat-card group">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 p-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            {(summary?.stale_count || 0) > 0 && (
              <span className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
            )}
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.stale_count || 0}</p>
          <p className="stat-label">Stale Evidence</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 p-3">
              <Calendar className="h-6 w-6 text-orange-400" />
            </div>
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.expiring_soon_count || 0}</p>
          <p className="stat-label">Expiring Soon</p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name or description..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="pending_review">Pending Review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="expired">Expired</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Types</option>
              {evidenceTypes?.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={staleFilter === true}
                onChange={(e) => { setStaleFilter(e.target.checked ? true : null); setPage(0); }}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
              />
              Stale Only
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={showExpired}
                onChange={(e) => setShowExpired(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
              />
              Show Expired
            </label>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
        </div>
      ) : error ? (
        <div className="flex h-64 flex-col items-center justify-center text-red-400">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>Failed to load evidence</p>
          <button onClick={() => refetch()} className="mt-2 text-sm text-primary-400 hover:underline">
            Try again
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <FileCheck className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No evidence found</h3>
          <p className="mt-1 text-slate-400">Upload your first evidence item to get started</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-700">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="w-12 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedItems.length === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Evidence</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">OCR</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Quality</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Controls</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Dates</th>
                  <th className="w-24 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 bg-slate-800">
                {filteredItems.map((item) => {
                  const TypeIcon = TYPE_ICONS[item.evidence_type || 'other'] || FileCheck;
                  return (
                    <tr key={item.id} className={`hover:bg-slate-700/50 ${selectedItems.includes(item.id) ? 'bg-primary-900/20' : ''}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/evidence/${item.id}`} className="block">
                          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
                            <div className="rounded-lg bg-slate-700 p-2">
                              <TypeIcon className="h-4 w-4 text-primary-400" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium text-white hover:text-primary-400 transition-colors">{item.name}</p>
                                {item.is_stale && (
                                  <span className="flex h-2 w-2 rounded-full bg-red-500" title="Stale evidence"></span>
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-400 max-w-xs">
                                {item.description || 'No description'}
                              </p>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-300 capitalize">
                          {(item.evidence_type || 'Other').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(item.status)}
                      </td>
                      <td className="px-4 py-3">
                        {getOCRBadge(item.ocr_status)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-600">
                            <div 
                              className={`h-full ${getQualityScoreColor(item.quality_score)} transition-all`}
                              style={{ width: `${item.quality_score || 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">
                            {item.quality_score !== null ? `${item.quality_score}%` : '-'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Link2 className="h-3 w-3 text-slate-400" />
                          <span className="text-sm text-slate-300">{item.control_mappings_count || 0}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <div className="text-slate-300">
                            {item.collection_date ? new Date(item.collection_date).toLocaleDateString() : '-'}
                          </div>
                          {item.expiry_date && (
                            <div className={`${new Date(item.expiry_date) < new Date() ? 'text-red-400' : 'text-slate-500'}`}>
                              Exp: {new Date(item.expiry_date).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/evidence/${item.id}`}
                            title="View"
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                          >
                            <Eye size={14} />
                          </Link>
                          <Link
                            href={`/evidence/${item.id}`}
                            title="Edit"
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                          >
                            <Edit2 size={14} />
                          </Link>
                          {(item.ocr_status === 'pending' || item.ocr_status === 'failed') && (
                            <button
                              title="Process OCR"
                              onClick={() => processOCRMutation.mutate(item.id)}
                              disabled={processOCRMutation.isPending}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-primary-400"
                            >
                              <ScanText size={14} />
                            </button>
                          )}
                          <button
                            title="Delete"
                            onClick={() => handleDelete(item)}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-700 pt-4">
              <div className="text-sm text-slate-400">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalItems)} of {totalItems} results
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-400">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isUploadModalOpen && (
        <UploadModal 
          onClose={() => setIsUploadModalOpen(false)}
          onUpload={(formData) => uploadMutation.mutate(formData)}
          isLoading={uploadMutation.isPending}
          evidenceTypes={evidenceTypes || []}
        />
      )}
    </div>
  );
}

function UploadModal({ 
  onClose, 
  onUpload, 
  isLoading,
  evidenceTypes
}: { 
  onClose: () => void;
  onUpload: (formData: FormData) => void;
  isLoading: boolean;
  evidenceTypes: EvidenceType[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [validityPeriodDays, setValidityPeriodDays] = useState('365');
  const [sourceSystem, setSourceSystem] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name) return;

    const formData = new FormData();
    formData.append('name', name);
    if (description) formData.append('description', description);
    if (evidenceType) formData.append('evidence_type', evidenceType);
    if (collectionDate) formData.append('collection_date', collectionDate);
    if (validityPeriodDays) formData.append('validity_period_days', validityPeriodDays);
    if (sourceSystem) formData.append('source_system', sourceSystem);
    formData.append('file', file);
    onUpload(formData);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      if (!name) {
        setName(droppedFile.name.replace(/\.[^/.]+$/, ''));
      }
    }
  }, [name]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Upload Evidence</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
              isDragging 
                ? 'border-primary-400 bg-primary-900/20' 
                : file 
                  ? 'border-green-500 bg-green-900/20'
                  : 'border-slate-600 hover:border-slate-500'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0];
                if (selectedFile) {
                  setFile(selectedFile);
                  if (!name) {
                    setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
                  }
                }
              }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            />
            {file ? (
              <>
                <FileCheck className="mb-2 h-10 w-10 text-green-400" />
                <p className="text-sm font-medium text-white">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </>
            ) : (
              <>
                <Upload className="mb-2 h-10 w-10 text-slate-400" />
                <p className="text-sm text-slate-300">Drag and drop or click to upload</p>
                <p className="text-xs text-slate-500">PDF, DOC, DOCX, XLS, XLSX, PNG, JPG</p>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                placeholder="Evidence name"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                placeholder="Describe this evidence..."
                rows={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Evidence Type</label>
              <select
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="">Select type...</option>
                {evidenceTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Collection Date</label>
              <input
                type="date"
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Validity Period (Days)</label>
              <input
                type="number"
                value={validityPeriodDays}
                onChange={(e) => setValidityPeriodDays(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                placeholder="365"
                min="1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300">Source System</label>
              <input
                type="text"
                value={sourceSystem}
                onChange={(e) => setSourceSystem(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                placeholder="e.g., Splunk, AWS"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !file || !name}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload Evidence
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
