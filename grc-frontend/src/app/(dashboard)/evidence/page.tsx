'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import apiClient, { evidenceAIApi, QuickAssessResponse, assetsApi } from '@/lib/api';
import type { ITAsset } from '@/types';
import { MultiSelectDropdown } from '@/components/ui';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Upload,
  X,
  CheckCircle,
  Clock,
  XCircle,
  FileText,
  Eye,
  Edit2,
  ScanText,
  AlertTriangle,
  Image,
  FileSpreadsheet,
  ShieldCheck,
  ClipboardList,
  Settings,
  RefreshCw,
} from 'lucide-react';
import EvidenceViewer, { EvidenceFile } from '@/components/evidence/EvidenceViewer';
import { EvidenceWorkspace } from './_workspace/EvidenceWorkspace';

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
  // Additive 6-month trend from the summary endpoint. Optional so the page
  // renders cleanly against a backend that hasn't been restarted with the
  // new field yet.
  by_month?: Array<{ month: string; uploaded: number; approved: number }>;
}

interface EvidenceType {
  value: string;
  label: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Draft' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Review' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
  expired: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Expired' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Archived' },
};

const OCR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof ScanText }> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'OCR Pending', icon: Clock },
  processing: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Processing', icon: RefreshCw },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'OCR Done', icon: CheckCircle },
  failed: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'OCR Failed', icon: XCircle },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'N/A', icon: FileText },
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
  // In-browser preview state. Clicking the eye-icon opens the shared
  // EvidenceViewer modal instead of navigating to the detail page —
  // auditors and reviewers want a quick look, not a context switch.
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: evidenceTypes } = useQuery({
    queryKey: ['evidence-types'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items/types');
      return response.data.types as EvidenceType[];
    },
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
      // Legacy keys (kept for any old lists) …
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-summary'] });
      // … and the keys the workspace (register + workbench) actually reads, so
      // the new row appears immediately with no manual browser refresh.
      queryClient.invalidateQueries({ queryKey: ['ev-ws-items'] });
      queryClient.invalidateQueries({ queryKey: ['ev-ws-summary'] });
      queryClient.invalidateQueries({ queryKey: ['ev-ws-expiring'] });
      setIsUploadModalOpen(false);
    },
  });

  return (
    <>
      <EvidenceWorkspace
        canCreate={canCreate}
        canDelete={canDelete}
        onUploadClick={() => setIsUploadModalOpen(true)}
      />

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
          flow â€” clicking the eye-icon now opens a quick popup. Edit
          icon still routes to the detail page for the full record. */}
      <EvidenceViewer
        evidence={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </>
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
  // display in lists/exports â€” the structured link is the source of truth,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
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
                ? 'border-primary-500 bg-primary-50' 
                : file 
                  ? 'border-emerald-500 bg-emerald-50'
                  : 'border-slate-300 hover:border-slate-400'
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
                <FileCheck className="mb-2 h-10 w-10 text-emerald-600" />
                <p className="text-sm font-medium text-slate-800">{file.name}</p>
                <p className="text-xs text-slate-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </>
            ) : (
              <>
                <Upload className="mb-2 h-10 w-10 text-slate-500" />
                <p className="text-sm text-slate-800">Drag and drop or click to upload</p>
                <p className="text-xs text-slate-500">PDF, DOC, DOCX, XLS, XLSX, PNG, JPG</p>
              </>
            )}
          </div>

          {fileError && (
            <p className="flex items-center gap-1.5 text-sm text-rose-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {fileError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Evidence name"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Describe this evidence..."
                rows={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Evidence Type</label>
              <select
                value={evidenceType}
                onChange={(e) => setEvidenceType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Validity Period</label>
              <select
                value={validityPreset}
                onChange={(e) => setValidityPreset(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
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
