'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import Link from 'next/link';
import apiClient, { evidenceAIApi, QuickAssessResponse, assetsApi } from '@/lib/api';
import type { ITAsset } from '@/types';
import { SearchInput, MultiSelectDropdown, PageLoader } from '@/components/ui';
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
  MoreVertical,
  Sparkles,
  Lightbulb,
  Tag
} from 'lucide-react';
import EvidenceViewer, { EvidenceFile } from '@/components/evidence/EvidenceViewer';

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
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  pending_review: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Pending Review' },
  approved: { bg: 'bg-green-50', text: 'text-green-700', label: 'Approved' },
  rejected: { bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected' },
  expired: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Expired' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Archived' },
};

const OCR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof ScanText }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'OCR Pending', icon: Clock },
  processing: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Processing', icon: RefreshCw },
  completed: { bg: 'bg-green-50', text: 'text-green-700', label: 'OCR Done', icon: CheckCircle },
  failed: { bg: 'bg-red-50', text: 'text-red-700', label: 'OCR Failed', icon: XCircle },
  not_applicable: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'N/A', icon: FileText },
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
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('evidence:evidence_library:create');
  const canDelete = hasPermission('evidence:evidence_library:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // In-browser preview state. Clicking the eye-icon opens the shared
  // EvidenceViewer modal instead of navigating to the detail page —
  // auditors and reviewers want a quick look, not a context switch.
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);
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
    refetchInterval: (query) => {
      const items = (query.state.data as EvidenceListResponse | undefined)?.items || [];
      const hasActiveOCR = items.some((item) => item.ocr_status === 'pending' || item.ocr_status === 'processing');
      return hasActiveOCR ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ formData, linkedAssetIds }: { formData: FormData; linkedAssetIds: number[] }) => {
      const res = await apiClient.post('/evidence-mgmt/items/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const evidenceId = (res.data as { id?: number })?.id;
      // Link selected assets after the evidence row exists. Failures here
      // shouldn't roll back the upload — the user can re-link from the
      // detail page if the network blips.
      if (evidenceId && linkedAssetIds.length > 0) {
        await Promise.all(
          linkedAssetIds.map((assetId) =>
            assetsApi.linkEvidence(assetId, { evidence_id: evidenceId }).catch(() => null)
          )
        );
      }
      return res;
    },
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
    if (score === null) return 'bg-gray-400';
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
    <div className="risk-workspace -m-4 lg:-m-5">
      <div className="border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Evidence Library</h1>
          <p className="mt-0.5 text-xs text-gray-500">Manage compliance evidence and documentation</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:px-6 xl:grid-cols-5">
        <div className="cw-card rounded-xl p-3">
          <div className="mb-2 inline-flex rounded-lg bg-primary-50 p-2 text-primary-600">
            <FileCheck className="h-4 w-4" />
          </div>
          <p className="text-lg font-semibold text-slate-900">{summaryLoading ? '-' : summary?.total_count || 0}</p>
          <p className="text-xs text-gray-500">Total Evidence</p>
        </div>

        <div className="cw-card rounded-xl p-3">
          <div className="mb-2 inline-flex rounded-lg bg-green-50 p-2 text-green-600">
            <CheckCircle className="h-4 w-4" />
          </div>
          <p className="text-lg font-semibold text-slate-900">{summaryLoading ? '-' : summary?.by_status?.approved || 0}</p>
          <p className="text-xs text-gray-500">Approved</p>
        </div>

        <div className="cw-card rounded-xl p-3">
          <div className="mb-2 inline-flex rounded-lg bg-yellow-50 p-2 text-yellow-600">
            <Clock className="h-4 w-4" />
          </div>
          <p className="text-lg font-semibold text-slate-900">{summaryLoading ? '-' : summary?.pending_review_count || 0}</p>
          <p className="text-xs text-gray-500">Pending Review</p>
        </div>

        <div className="cw-card rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex rounded-lg bg-red-50 p-2 text-red-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
            {(summary?.stale_count || 0) > 0 && <span className="h-2 w-2 rounded-full bg-red-500" />}
          </div>
          <p className="text-lg font-semibold text-slate-900">{summaryLoading ? '-' : summary?.stale_count || 0}</p>
          <p className="text-xs text-gray-500">Stale Evidence</p>
        </div>

        <div className="col-span-2 cw-card rounded-xl p-3 xl:col-span-1">
          <div className="mb-2 inline-flex rounded-lg bg-orange-50 p-2 text-orange-600">
            <Calendar className="h-4 w-4" />
          </div>
          <p className="text-lg font-semibold text-slate-900">{summaryLoading ? '-' : summary?.expiring_soon_count || 0}</p>
          <p className="text-xs text-gray-500">Expiring Soon</p>
        </div>
      </div>

      <div className="space-y-3 bg-[var(--color-subtle)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[180px] sm:min-w-[260px] lg:max-w-xs">
              <SearchInput
                value={searchTerm}
                onChange={(v) => { setSearchTerm(v); setPage(0); }}
                placeholder="Search by name or description..."
                size="md"
              />
            </div>
            <MultiSelectDropdown
              title="Status"
              items={[
                { value: 'draft', label: 'Draft' },
                { value: 'pending_review', label: 'Pending Review' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'expired', label: 'Expired' },
              ]}
              selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
              onApply={(v) => { setStatusFilter((v[0] as StatusFilter) || 'all'); setPage(0); }}
              multiSelect={false}
              autoApply
              placeholder="All Status"
              size="md"
            />
            <MultiSelectDropdown
              title="Type"
              items={(evidenceTypes || []).map((t) => ({ value: t.value, label: t.label }))}
              selectedValues={typeFilter ? [typeFilter] : []}
              onApply={(v) => { setTypeFilter(v[0] || ''); setPage(0); }}
              multiSelect={false}
              autoApply
              placeholder="All Types"
              size="md"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={staleFilter === true}
                onChange={(e) => { setStaleFilter(e.target.checked ? true : null); setPage(0); }}
                className="h-4 w-4 rounded border-gray-300 bg-white text-blue-600 focus:ring-blue-500"
              />
              Stale Only
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showExpired}
                onChange={(e) => setShowExpired(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 bg-white text-blue-600 focus:ring-blue-500"
              />
              Show Expired
            </label>
            {selectedItems.length > 0 && (
              <button
                onClick={() => batchProcessOCRMutation.mutate(selectedItems)}
                disabled={batchProcessOCRMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <ScanText size={14} />
                Batch OCR
              </button>
            )}
            {canCreate && (
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
              >
                <Upload size={14} />
                Upload Evidence
              </button>
            )}
          </div>
        </div>

        {isLoading ? (
          <PageLoader className="h-64" />
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center text-red-400">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p>Failed to load evidence</p>
            <button onClick={() => refetch()} className="mt-2 text-sm text-primary-400 hover:underline">
              Try again
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="cw-card rounded-lg px-6 py-10 text-center">
            <FileCheck className="mx-auto mb-3 h-10 w-10 text-gray-400" />
            <h3 className="text-base font-medium text-black">No evidence found</h3>
            <p className="mt-1 text-sm text-gray-600">Upload your first evidence item to get started</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 xl:hidden">
              {filteredItems.map((item) => {
                const TypeIcon = TYPE_ICONS[item.evidence_type || 'other'] || FileCheck;
                return (
                  <div key={item.id} className={`cw-card rounded-xl p-3 ${selectedItems.includes(item.id) ? 'ring-1 ring-blue-200' : ''}`}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(item.id)}
                          onChange={() => toggleSelectItem(item.id)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 bg-white text-blue-600 focus:ring-blue-500"
                        />
                        <div className="rounded-lg bg-gray-100 p-2">
                          <TypeIcon className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <Link href={`/evidence/${item.id}`} className="block text-sm font-medium text-black hover:text-blue-600">
                            {item.name}
                          </Link>
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{item.description || 'No description'}</p>
                        </div>
                      </div>
                      {item.is_stale && <span className="mt-1 h-2.5 w-2.5 rounded-full bg-red-500" title="Stale evidence" />}
                    </div>

                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {getStatusBadge(item.status)}
                      {getOCRBadge(item.ocr_status)}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>
                        <span className="font-medium text-gray-800">Type:</span>{' '}
                        <span className="capitalize">{(item.evidence_type || 'Other').replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Link2 className="h-3 w-3" />
                        <span>{item.control_mappings_count || 0} controls</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-800">Collected:</span>{' '}
                        {item.collection_date ? new Date(item.collection_date).toLocaleDateString() : '-'}
                      </div>
                      <div>
                        <span className="font-medium text-gray-800">Expiry:</span>{' '}
                        {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className={`h-full ${getQualityScoreColor(item.quality_score)} transition-all`}
                            style={{ width: `${item.quality_score || 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600">{item.quality_score !== null ? `${item.quality_score}%` : '-'}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        {item.file_path ? (
                          <button
                            onClick={() => setPreviewFile({
                              // evidence_id routes the viewer through
                              // /evidence/{id}/preview — the tenant-
                              // checked streaming endpoint. Without
                              // this the viewer tries to GET file_path
                              // as a URL, but file_path is a server
                              // filesystem path (e.g. C:/Users/...) and
                              // 404s.
                              evidence_id: item.id,
                              file_path: item.file_path!,
                              file_name: item.file_name || `Evidence ${item.id}`,
                              mime_type: (item as any).mime_type ?? (item as any).file_type ?? null,
                              file_size: (item as any).file_size ?? null,
                            })}
                            title="Preview file"
                            className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black"
                          >
                            <Eye size={14} />
                          </button>
                        ) : (
                          <Link href={`/evidence/${item.id}`} title="View detail" className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black">
                            <Eye size={14} />
                          </Link>
                        )}
                        <Link href={`/evidence/${item.id}`} title="Edit" className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black">
                          <Edit2 size={14} />
                        </Link>
                        {(item.ocr_status === 'pending' || item.ocr_status === 'failed') && (
                          <button
                            title="Process OCR"
                            onClick={() => processOCRMutation.mutate(item.id)}
                            disabled={processOCRMutation.isPending}
                            className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-blue-600"
                          >
                            <ScanText size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            title="Delete"
                            onClick={() => handleDelete(item)}
                            className="rounded p-1.5 text-gray-600 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm xl:block">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-[var(--color-border)] bg-[var(--color-subtle)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Evidence</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">OCR</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Quality</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Controls</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Dates</th>
                      <th className="w-24 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredItems.map((item) => {
                      const TypeIcon = TYPE_ICONS[item.evidence_type || 'other'] || FileCheck;
                      return (
                        <tr key={item.id} className={`transition-colors hover:bg-gray-50 ${selectedItems.includes(item.id) ? 'bg-blue-50' : ''}`}>
                          <td className="px-3 py-2.5">
                            <Link href={`/evidence/${item.id}`} className="block">
                              <div className="flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-80">
                                <div className="rounded-lg bg-gray-100 p-2">
                                  <TypeIcon className="h-4 w-4 text-blue-600" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate text-sm font-medium text-black transition-colors hover:text-blue-600">{item.name}</p>
                                    {item.is_stale && <span className="flex h-2 w-2 rounded-full bg-red-500" title="Stale evidence"></span>}
                                  </div>
                                  <p className="max-w-xs truncate text-xs text-gray-600">{item.description || 'No description'}</p>
                                </div>
                              </div>
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-sm text-black capitalize">{(item.evidence_type || 'Other').replace(/_/g, ' ')}</span>
                          </td>
                          <td className="px-3 py-2.5">{getStatusBadge(item.status)}</td>
                          <td className="px-3 py-2.5">{getOCRBadge(item.ocr_status)}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-16 overflow-hidden rounded-full bg-gray-200">
                                <div
                                  className={`h-full ${getQualityScoreColor(item.quality_score)} transition-all`}
                                  style={{ width: `${item.quality_score || 0}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-600">{item.quality_score !== null ? `${item.quality_score}%` : '-'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1 text-sm text-black">
                              <Link2 className="h-3 w-3 text-gray-600" />
                              <span>{item.control_mappings_count || 0}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs">
                              <div className="text-black">{item.collection_date ? new Date(item.collection_date).toLocaleDateString() : '-'}</div>
                              {item.expiry_date && (
                                <div className={`${new Date(item.expiry_date) < new Date() ? 'text-red-600' : 'text-gray-500'}`}>
                                  Exp: {new Date(item.expiry_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              {item.file_path ? (
                                <button
                                  onClick={() => setPreviewFile({
                                    evidence_id: item.id,
                                    file_path: item.file_path!,
                                    file_name: item.file_name || `Evidence ${item.id}`,
                                    mime_type: (item as any).mime_type ?? (item as any).file_type ?? null,
                                    file_size: (item as any).file_size ?? null,
                                  })}
                                  title="Preview file"
                                  className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black"
                                >
                                  <Eye size={14} />
                                </button>
                              ) : (
                                <Link href={`/evidence/${item.id}`} title="View detail" className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black">
                                  <Eye size={14} />
                                </Link>
                              )}
                              <Link href={`/evidence/${item.id}`} title="Edit" className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black">
                                <Edit2 size={14} />
                              </Link>
                              {(item.ocr_status === 'pending' || item.ocr_status === 'failed') && (
                                <button
                                  title="Process OCR"
                                  onClick={() => processOCRMutation.mutate(item.id)}
                                  disabled={processOCRMutation.isPending}
                                  className="rounded p-1.5 text-gray-600 hover:bg-gray-100 hover:text-blue-600"
                                >
                                  <ScanText size={14} />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  title="Delete"
                                  onClick={() => handleDelete(item)}
                                  className="rounded p-1.5 text-gray-600 hover:bg-red-50 hover:text-red-600"
                                >
                                  <Trash2 size={14} />
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
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col gap-2 border-t border-gray-200 pt-3 text-xs text-gray-600 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalItems)} of {totalItems} results
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-black hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600">Page {page + 1} of {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-black hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {isUploadModalOpen && (
        <UploadModal
          onClose={() => setIsUploadModalOpen(false)}
          onUpload={(formData, linkedAssetIds) => uploadMutation.mutate({ formData, linkedAssetIds })}
          isLoading={uploadMutation.isPending}
          evidenceTypes={evidenceTypes || []}
        />
      )}

      {/* Shared in-browser file viewer for the central evidence list.
          Replaces the older "go to detail page just to see the file"
          flow — clicking the eye-icon now opens a quick popup. Edit
          icon still routes to the detail page for the full record. */}
      <EvidenceViewer
        evidence={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}

const VALIDITY_PRESETS: Array<{ value: string; label: string }> = [
  { value: '90', label: '3 months' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
  { value: 'custom', label: 'Custom (days)' },
];

function UploadModal({
  onClose,
  onUpload,
  isLoading,
  evidenceTypes
}: {
  onClose: () => void;
  onUpload: (formData: FormData, linkedAssetIds: number[]) => void;
  isLoading: boolean;
  evidenceTypes: EvidenceType[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [collectionDate, setCollectionDate] = useState('');
  const [validityPreset, setValidityPreset] = useState<string>('365');
  const [validityCustomDays, setValidityCustomDays] = useState('');
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [linkedAssetIds, setLinkedAssetIds] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiAssessment, setAiAssessment] = useState<QuickAssessResponse | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Owner dropdown source: tenant users.
  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['tenant-users-evidence'],
    queryFn: async () => {
      const res = await assetsApi.getTenantUsers();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Asset list for the source-system / linked-assets multi-select.
  const { data: assets = [] } = useQuery({
    queryKey: ['assets-evidence-link'],
    queryFn: async () => {
      const res = await assetsApi.getAll();
      return (res.data || []) as ITAsset[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const ownerItems = useMemo(
    () => tenantUsers.map((u) => ({
      value: String(u.id),
      label: u.display_name,
      subLabel: u.email,
    })),
    [tenantUsers]
  );

  const assetItems = useMemo(
    () => assets.map((a) => ({
      value: String(a.id),
      label: a.name,
      subLabel: a.asset_type ? String(a.asset_type) : undefined,
    })),
    [assets]
  );

  const runQuickAssessment = useCallback(async (fileName: string, fileType: string, evidenceName: string, desc: string, evType: string) => {
    setIsAiLoading(true);
    setAiError(null);
    try {
      const response = await evidenceAIApi.quickAssess({
        evidence_name: evidenceName || fileName.replace(/\.[^/.]+$/, ''),
        file_name: fileName,
        file_type: fileType,
        description: desc || undefined,
        evidence_type: evType || undefined
      });
      setAiAssessment(response);
      if (response.initial_assessment.suggested_type && !evType) {
        setEvidenceType(response.initial_assessment.suggested_type);
      }
    } catch (err) {
      setAiError('AI assessment unavailable');
      console.error('Quick assess error:', err);
    } finally {
      setIsAiLoading(false);
    }
  }, []);

  const resolvedValidityDays = (() => {
    if (validityPreset === 'custom') {
      const n = parseInt(validityCustomDays, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (validityPreset === '') return null;
    const n = parseInt(validityPreset, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Mirror selected asset names back into source_system for at-a-glance
  // display in lists/exports — the structured link is the source of truth,
  // the string is human-readable shorthand.
  const sourceSystemLabel = useMemo(() => {
    if (!linkedAssetIds.length) return '';
    return linkedAssetIds
      .map((id) => assets.find((a) => a.id === id)?.name)
      .filter(Boolean)
      .join(', ');
  }, [linkedAssetIds, assets]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name) return;

    const formData = new FormData();
    formData.append('name', name);
    if (description) formData.append('description', description);
    if (evidenceType) formData.append('evidence_type', evidenceType);
    if (collectionDate) formData.append('collection_date', collectionDate);
    if (resolvedValidityDays) formData.append('validity_period_days', String(resolvedValidityDays));
    if (sourceSystemLabel) formData.append('source_system', sourceSystemLabel);
    if (ownerId) formData.append('owner_id', String(ownerId));
    formData.append('file', file);
    onUpload(formData, linkedAssetIds);
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
      const ext = droppedFile.name.split('.').pop()?.toLowerCase();
      if (ext === 'exe') {
        setFileError('Executable files (.exe) are not allowed.');
        return;
      }
      setFileError(null);
      setFile(droppedFile);
      const newName = droppedFile.name.replace(/\.[^/.]+$/, '');
      if (!name) {
        setName(newName);
      }
      runQuickAssessment(droppedFile.name, droppedFile.type, name || newName, description, evidenceType);
    }
  }, [name, description, evidenceType, runQuickAssessment]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 text-primary-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Upload Evidence</h2>
              <p className="text-xs text-slate-500">Attach a file and capture its metadata in one step.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
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
                ? 'border-blue-500 bg-blue-50' 
                : file 
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0];
                if (selectedFile) {
                  const ext = selectedFile.name.split('.').pop()?.toLowerCase();
                  if (ext === 'exe') {
                    setFileError('Executable files (.exe) are not allowed.');
                    e.target.value = '';
                    return;
                  }
                  setFileError(null);
                  setFile(selectedFile);
                  const newName = selectedFile.name.replace(/\.[^/.]+$/, '');
                  if (!name) {
                    setName(newName);
                  }
                  runQuickAssessment(selectedFile.name, selectedFile.type, name || newName, description, evidenceType);
                }
              }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            />
            {file ? (
              <>
                <FileCheck className="mb-2 h-10 w-10 text-green-600" />
                <p className="text-sm font-medium text-black">{file.name}</p>
                <p className="text-xs text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </>
            ) : (
              <>
                <Upload className="mb-2 h-10 w-10 text-gray-500" />
                <p className="text-sm text-black">Drag and drop or click to upload</p>
                <p className="text-xs text-gray-500">PDF, DOC, DOCX, XLS, XLSX, PNG, JPG</p>
              </>
            )}
          </div>

          {fileError && (
            <p className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {fileError}
            </p>
          )}

          {/* {(isAiLoading || aiAssessment || aiError) && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300 rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-indigo-900/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-sm font-medium text-purple-300">AI suggests:</span>
                {isAiLoading && <Loader2 className="h-4 w-4 animate-spin text-purple-400" />}
              </div>

              {isAiLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Brain className="h-4 w-4 animate-pulse text-purple-600" />
                  <span>Analyzing evidence metadata...</span>
                </div>
              )}

              {aiError && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <AlertCircle className="h-4 w-4 text-gray-500" />
                  <span>{aiError}</span>
                </div>
              )}

              {aiAssessment && !isAiLoading && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-600">Relevance:</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      aiAssessment.initial_assessment.relevance_estimate === 'high' 
                        ? 'bg-green-50 text-green-700' 
                        : aiAssessment.initial_assessment.relevance_estimate === 'medium' 
                          ? 'bg-yellow-50 text-yellow-700' 
                          : 'bg-red-50 text-red-700'
                    }`}>
                      {aiAssessment.initial_assessment.relevance_estimate === 'high' && <CheckCircle size={12} />}
                      {aiAssessment.initial_assessment.relevance_estimate === 'medium' && <AlertTriangle size={12} />}
                      {aiAssessment.initial_assessment.relevance_estimate === 'low' && <XCircle size={12} />}
                      {aiAssessment.initial_assessment.relevance_estimate.charAt(0).toUpperCase() + aiAssessment.initial_assessment.relevance_estimate.slice(1)}
                    </span>
                  </div>

                  {aiAssessment.initial_assessment.detected_frameworks.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-600 block mb-1.5">Detected Frameworks:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {aiAssessment.initial_assessment.detected_frameworks.slice(0, 5).map((fw, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                            <Tag size={10} />
                            {fw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {aiAssessment.initial_assessment.suggested_controls.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-600 block mb-1.5">Suggested Controls:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {aiAssessment.initial_assessment.suggested_controls.slice(0, 4).map((ctrl, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                            <ShieldCheck size={10} />
                            {ctrl}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {aiAssessment.initial_assessment.quality_tips.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-600 block mb-1.5">Quality Tips:</span>
                      <ul className="space-y-1">
                        {aiAssessment.initial_assessment.quality_tips.slice(0, 3).map((tip, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs text-black">
                            <Lightbulb size={12} className="mt-0.5 text-yellow-600 flex-shrink-0" />
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <span className="text-xs text-gray-600 block mb-1.5">Completeness Check:</span>
                    <div className="flex flex-wrap gap-2">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                        aiAssessment.initial_assessment.completeness_check.has_date 
                          ? 'bg-green-50 text-green-700' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {aiAssessment.initial_assessment.completeness_check.has_date ? <CheckCircle size={10} /> : <XCircle size={10} />}
                        Date
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                        aiAssessment.initial_assessment.completeness_check.has_version 
                          ? 'bg-green-50 text-green-700' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {aiAssessment.initial_assessment.completeness_check.has_version ? <CheckCircle size={10} /> : <XCircle size={10} />}
                        Version
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                        aiAssessment.initial_assessment.completeness_check.has_approval 
                          ? 'bg-green-50 text-green-700' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {aiAssessment.initial_assessment.completeness_check.has_approval ? <CheckCircle size={10} /> : <XCircle size={10} />}
                        Approval
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )} */}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-slate-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Evidence name"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-slate-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Describe this evidence..."
                rows={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Evidence Type</label>
              <select
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">Select type...</option>
                {evidenceTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Owner</label>
              <MultiSelectDropdown
                title="Owner"
                items={ownerItems}
                selectedValues={ownerId ? [String(ownerId)] : []}
                onApply={(v) => setOwnerId(v[0] ? Number(v[0]) : null)}
                multiSelect={false}
                autoApply
                forceSearch
                triggerVariant="input"
                placeholder="Select owner"
                searchPlaceholder="Search users..."
                size="md"
                triggerClassName="mt-1 w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Collection Date</label>
              <input
                type="date"
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Validity Period</label>
              <select
                value={validityPreset}
                onChange={(e) => setValidityPreset(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {VALIDITY_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              {validityPreset === 'custom' && (
                <input
                  type="number"
                  min="1"
                  value={validityCustomDays}
                  onChange={(e) => setValidityCustomDays(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-slate-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="Number of days"
                  autoFocus
                />
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Source System / Linked Assets</label>
              <MultiSelectDropdown
                title="Linked Assets"
                items={assetItems}
                selectedValues={linkedAssetIds.map(String)}
                onApply={(v) => setLinkedAssetIds(v.map(Number))}
                multiSelect
                autoApply
                forceSearch
                triggerVariant="input"
                placeholder="Search assets to link..."
                searchPlaceholder="Search by asset name or type..."
                size="md"
                triggerClassName="mt-1 w-full"
              />
              <p className="mt-1 text-xs text-slate-500">
                Pick one or more assets this evidence was sourced from. You can link more later from the evidence detail page.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !file || !name}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
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
