'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { problemOf, studioApi } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import { SearchInput, MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import {
  FileText,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Edit2,
  Eye,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  Upload,
  Download,
  FileSpreadsheet,
  File,
  CheckCircle,
  CheckCircle2,
  ExternalLink,
  Send,
  Globe,
  Users,
  BookMarked,
} from 'lucide-react';
import Link from 'next/link';
import NcaTemplateSelect, { NcaTemplateMeta } from '@/components/governance/NcaTemplateSelect';
import RecommendedDocsModal, { NCA_DOC_TYPE_MAP, ARTIFACT_DOC_TYPE_MAP, type DocumentTemplatePick } from './_RecommendedDocsModal';
import RichTextEditor from './_RichTextEditor';
import {
  STUDIO_NEW_DOCUMENT, artifactStart, lawFileName, lawStart, ncaStart, recommendedStart, sessionBody, studioDraftUrl, type TemplateStart,
} from './_templateStart';
import { DocumentsWorkspace } from './_workspace/DocumentsWorkspace';

interface TenantUser {
  id: number;
  user_id: number;
  tenant_id: number;
  role: string;
  is_active: boolean;
  user?: {
    id: number;
    email: string;
    display_name: string;
  };
}

interface DocumentItem {
  id: number;
  tenant_id: number;
  document_code: string | null;
  title: string;
  description: string | null;
  content: string | null;
  doc_type: string;
  doc_sub_type: string | null;
  classification: string;
  parent_document_id: number | null;
  current_version: string;
  status: string;
  owner_id: number | null;
  owner_name: string | null;
  author_id: number | null;
  author_name: string | null;
  department_id: number | null;
  effective_date: string | null;
  expiry_date: string | null;
  review_cycle_months: number;
  next_review_date: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by: number | null;
  regulatory_scope: string[];
  framework_ids: number[];
  applicable_framework_ids?: number[];
  tags: string[];
  approved_by: number | null;
  approved_at: string | null;
  published_by: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  file_name: string | null;
  file_size: number | null;
  file_type: string | null;
  has_file: boolean;
  policy_statement_count?: number;
}

interface DocumentListResponse {
  items: DocumentItem[];
  total: number;
  skip: number;
  limit: number;
}

interface DocumentHierarchyItem extends DocumentItem {
  children?: DocumentHierarchyItem[];
}

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-[var(--color-base)]', bgColor: 'bg-[var(--color-base-soft)]' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-[var(--color-base)]', bgColor: 'bg-[var(--color-base-soft)]' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-[var(--color-success)]', bgColor: 'bg-[var(--color-success-soft)]' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-[var(--color-warning)]', bgColor: 'bg-[var(--color-warning-soft)]' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-[var(--color-base)]', bgColor: 'bg-[var(--color-base-soft)]' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-[var(--color-warning)]', bgColor: 'bg-[var(--color-warning-soft)]' },
];

const DOCUMENT_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft', color: 'text-[var(--color-status-draft)]', bgColor: 'bg-[var(--color-status-draft)]/20' },
  { value: 'pending_review', label: 'Pending Review', color: 'text-[var(--color-status-review)]', bgColor: 'bg-[var(--color-status-review)]/20' },
  { value: 'pending_approval', label: 'Pending Approval', color: 'text-[var(--color-status-approval)]', bgColor: 'bg-[var(--color-status-approval)]/20' },
  { value: 'approved', label: 'Approved', color: 'text-[var(--color-status-approved)]', bgColor: 'bg-[var(--color-status-approved)]/20' },
  { value: 'published', label: 'Published', color: 'text-[var(--color-status-published)]', bgColor: 'bg-[var(--color-status-published)]/20' },
  { value: 'expired', label: 'Expired', color: 'text-[var(--color-status-expired)]', bgColor: 'bg-[var(--color-status-expired)]/20' },
  { value: 'archived', label: 'Archived', color: 'text-[var(--color-status-archived)]', bgColor: 'bg-[var(--color-status-archived)]/20' },
];

const CLASSIFICATIONS = [
  { value: 'public', label: 'Public' },
  { value: 'internal', label: 'Internal' },
  { value: 'confidential', label: 'Confidential' },
  { value: 'restricted', label: 'Restricted' },
];

const ALLOWED_FILE_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || { label: type, color: 'text-[var(--color-muted)]', bgColor: 'bg-[var(--color-muted)]/20', icon: FileText };
};

const getStatusStyle = (status: string) => {
  return DOCUMENT_STATUSES.find(s => s.value === status) || { label: status, color: 'text-[var(--color-muted)]', bgColor: 'bg-[var(--color-muted)]/20' };
};

const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (fileType: string | null) => {
  if (!fileType) return File;
  const type = fileType.toLowerCase();
  if (type === 'pdf') return FileText;
  if (['doc', 'docx'].includes(type)) return FileText;
  if (['xls', 'xlsx'].includes(type)) return FileSpreadsheet;
  return File;
};

const getFileTypeColor = (fileType: string | null): string => {
  if (!fileType) return 'text-[var(--color-muted)]';
  const type = fileType.toLowerCase();
  if (type === 'pdf') return 'text-[var(--color-danger)]';
  if (['doc', 'docx'].includes(type)) return 'text-[var(--color-base)]';
  if (['xls', 'xlsx'].includes(type)) return 'text-[var(--color-success)]';
  return 'text-[var(--color-muted)]';
};

export default function GovernanceDocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:policies:create');
  const canEdit = hasPermission('governance:policies:edit');
  // Current user's numeric id — feeds the workspace's "My documents" scope.
  // /auth/me returns { ..., user: { id } }; degrades gracefully to null.
  const { data: currentUserId } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const r = await apiClient.get('/auth/me');
      return (r.data?.user?.id ?? null) as number | null;
    },
    staleTime: 5 * 60 * 1000,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadingToDocumentId, setUploadingToDocumentId] = useState<number | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentItem | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);
  const [parsingDocumentId, setParsingDocumentId] = useState<number | null>(null);
  const [parseResult, setParseResult] = useState<{ documentId: number; count: number } | null>(null);
  const [attestationTargetDocument, setAttestationTargetDocument] = useState<DocumentItem | null>(null);
  // Document Templates: a template picked there opens in the AI Studio, where every new document is written.
  const [isRecommendedOpen, setIsRecommendedOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // A "+ Draft" link on a reference inside another document (?aiDraftTitle=…) opens the AI Studio's new-document popup, filled
  // in. Replace, so Back does not bring the person here again.
  useEffect(() => {
    const url = studioDraftUrl(searchParams);
    if (url) router.replace(url);
    // We only react to the *initial* arrival, not subsequent navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidateDocumentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
    queryClient.invalidateQueries({ queryKey: ['governance-documents-hierarchy'] });
    queryClient.invalidateQueries({ queryKey: ['governance-documents-parent-options'] });
    // The register (DocumentsWorkspace) fetches under its OWN keys — invalidate
    // them too, else a new upload / edit never shows up without a hard refresh.
    ['gov-docs-workspace', 'gov-docs-hierarchy', 'gov-docs-summary', 'gov-docs-overdue', 'gov-docs-mypending', 'gov-docs-coverage']
      .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };

  // Kept solely so its `error` can drive the load-failure banner below.
  // The list/hierarchy body that consumed `data` was replaced by
  // <DocumentsWorkspace/>, so we no longer thread sort/pagination here.
  const { error } = useQuery({
    queryKey: ['governance-documents-probe', typeFilter, statusFilter, searchTerm],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (typeFilter) params.doc_type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      if (searchTerm) params.search = searchTerm;

      const response = await governanceApi.getDocuments(params as any);
      return response.data as unknown as DocumentListResponse;
    },
    placeholderData: keepPreviousData,
  });

  const { data: parentDocumentOptions = [] } = useQuery({
    queryKey: ['governance-documents-parent-options'],
    queryFn: async () => {
      const response = await governanceApi.getDocuments({
        skip: 0,
        limit: 1000,
        sort_by: 'title',
        sort_order: 'asc',
      } as any);
      const payload = response.data as unknown as DocumentListResponse;
      return payload.items || [];
    },
    staleTime: 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DocumentItem> }) => {
      const payload = {
        title: data.title,
        description: data.description,
        content: data.content,
        doc_type: data.doc_type,
        classification: data.classification,
        parent_document_id: data.parent_document_id || null,
        owner_id: data.owner_id,
        review_cycle_months: data.review_cycle_months,
        effective_date: data.effective_date,
        expiry_date: data.expiry_date,
        // Allow editing the framework linkage after creation too —
        // re-tagging a doc must propagate to the auditor portal.
        framework_ids: Array.isArray(data.framework_ids) ? data.framework_ids : undefined,
        applicable_framework_ids: Array.isArray(data.applicable_framework_ids) ? data.applicable_framework_ids : undefined,
      };
      return governanceApi.updateDocument(id, payload as any);
    },
    onSuccess: () => {
      invalidateDocumentQueries();
      setIsModalOpen(false);
      setEditingDocument(null);
    },
  });

  const uploadToDocumentMutation = useMutation({
    mutationFn: ({ documentId, formData }: { documentId: number; formData: FormData }) => 
      governanceApi.uploadFileToDocument(documentId, formData),
    onSuccess: () => {
      invalidateDocumentQueries();
      setUploadingToDocumentId(null);
    },
  });

  const parsePolicyMutation = useMutation({
    mutationFn: (documentId: number) => governanceApi.parsePolicy(documentId),
    onMutate: (documentId) => {
      setParsingDocumentId(documentId);
    },
    onSuccess: (response, documentId) => {
      const data = response.data as { total_statements: number };
      setParseResult({ documentId, count: data.total_statements });
      invalidateDocumentQueries();
      setParsingDocumentId(null);
      setTimeout(() => setParseResult(null), 10000);
    },
    onError: () => {
      setParsingDocumentId(null);
    },
  });

  const publishMutation = useMutation({
    mutationFn: (documentId: number) => governanceApi.publishDocument(documentId),
    onSuccess: () => {
      invalidateDocumentQueries();
      toast({
        type: 'success',
        title: 'Document Published',
        message: 'The document has been successfully published.',
      });
    },
    onError: (error: any) => {
      toast({
        type: 'error',
        title: 'Publish Failed',
        message: error?.response?.data?.detail || 'Failed to publish document.',
      });
    },
  });

  const requestAttestationMutation = useMutation({
    mutationFn: ({ documentId, userIds, dueDate }: { documentId: number; userIds: number[]; dueDate?: string }) => 
      governanceApi.requestAttestation(documentId, { user_ids: userIds, due_date: dueDate }),
    onSuccess: () => {
      invalidateDocumentQueries();
      setAttestationTargetDocument(null);
      toast({
        type: 'success',
        title: 'Attestation Requested',
        message: 'Attestation requests have been sent to the selected users.',
      });
    },
    onError: (error: any) => {
      toast({
        type: 'error',
        title: 'Request Failed',
        message: error?.response?.data?.detail || 'Failed to request attestation.',
      });
    },
  });

  // A template picked in Document Templates opens in the AI Studio as a new draft with its own text, title and type (a reference
  // law: the studio's own template for its type, with the law's text attached for Comply Agent). The popup stays open meanwhile.
  const startFromTemplate = useMutation({
    mutationFn: async (pick: DocumentTemplatePick) => {
      let start: TemplateStart;
      if (pick.kind === 'recommended') {
        start = recommendedStart(pick.doc);
      } else if (pick.kind === 'artifact') {
        let served: string | null = null;
        try {
          const res = await apiClient.get('/artifacts/catalog/content', { params: { artifact_id: pick.item.artifact_id } });
          const d = res.data as { found?: boolean; content?: string };
          if (d?.found && d.content) served = d.content;
        } catch {
          // the artifact's template built here
        }
        start = artifactStart(pick.item, pick.frameworkName, ARTIFACT_DOC_TYPE_MAP(pick.item.artifact_type), served);
      } else if (pick.kind === 'nca') {
        const res = await apiClient.get(`/governance/nca-templates/${pick.template.id}/content`);
        start = ncaStart(pick.template, NCA_DOC_TYPE_MAP[pick.template.category] ?? 'policy', (res.data as { content?: string })?.content || '');
      } else {
        start = lawStart(pick.law);
      }
      const session = await studioApi.createSession(sessionBody(start));
      if (pick.kind === 'reference-law') {
        try {
          const res = await apiClient.get(`/governance/reference-laws/${pick.law.id}/content`);
          const text = (res.data as { content?: string })?.content || '';
          await studioApi.uploadReference(session.id, new window.File([text], lawFileName(pick.law), { type: 'text/markdown' }));   // `File` here is the icon
        } catch (e) {
          toast({ type: 'warning', title: 'The law could not be attached', message: `${problemOf(e)} Attach it under References in the AI Studio.` });
        }
      }
      return session;
    },
    onSuccess: (session) => router.push(`/governance/documents/studio/${session.id}`),
    onError: (e) => toast({
      type: 'error',
      title: 'Could not open the template',
      message: e instanceof Error && !('isAxiosError' in e) ? e.message : problemOf(e),
    }),
  });

  const handleDownload = async (doc: DocumentItem) => {
    try {
      let blob: Blob;
      let filename = doc.file_name || `${doc.title || `document_${doc.id}`}.html`;

      if (doc.file_name) {
        const response = await governanceApi.downloadDocumentFile(doc.id);
        blob = new Blob([response.data]);
      } else {
        const response = await governanceApi.getDocumentViewHtml(doc.id);
        const html = response.data?.html || '';
        blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        if (!filename.toLowerCase().endsWith('.html')) {
          filename = `${filename}.html`;
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      toast({ type: 'error', title: 'Download Failed', message: 'Could not download this document.' });
    }
  };

  const handleEdit = (doc: DocumentItem) => {
    setEditingDocument(doc);
    setIsModalOpen(true);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-[var(--color-danger)]">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load documents</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {parseResult && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--color-success)] bg-[var(--color-success-soft)] p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[var(--color-success)]/30 p-2">
              <CheckCircle className="h-5 w-5 text-[var(--color-success)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--color-success)]">
                {parseResult.count} policy statement{parseResult.count !== 1 ? 's' : ''} extracted successfully
              </p>
              <p className="cw-text-muted text-sm">
                View and manage compliance in the Compliance module
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/compliance/statements"
              className="cw-btn-success flex items-center gap-1.5 text-sm"
            >
              <ExternalLink className="h-4 w-4" />
              View Statements
            </a>
            <button
              onClick={() => setParseResult(null)}
              className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <DocumentsWorkspace
        canCreate={canCreate}
        canEdit={canEdit}
        currentUserId={currentUserId}
        onNewDocument={() => router.push('/governance/documents/studio')}     // the AI Studio: upload, write, edit, compare
        onAIDraft={() => router.push(STUDIO_NEW_DOCUMENT)}                    // the AI Studio's new-document popup
        onTemplates={() => setIsRecommendedOpen(true)}
        onEditDocument={(doc) => handleEdit(doc as unknown as DocumentItem)}
      />


      {isModalOpen && (
        <DocumentModal
          document={editingDocument}
          parentDocuments={parentDocumentOptions}
          onClose={() => {
            setIsModalOpen(false);
            setEditingDocument(null);
          }}
          onSubmit={(data) => {
            // editing a document's details (Edit on a row); new documents are written in the AI Studio
            if (editingDocument?.id) updateMutation.mutate({ id: editingDocument.id, data });
          }}
          isLoading={updateMutation.isPending}
        />
      )}

      {uploadingToDocumentId !== null && (
        <UploadFileToDocumentModal
          documentId={uploadingToDocumentId}
          onClose={() => setUploadingToDocumentId(null)}
          onSubmit={(formData) => uploadToDocumentMutation.mutate({ documentId: uploadingToDocumentId, formData })}
          isLoading={uploadToDocumentMutation.isPending}
        />
      )}

      {viewingDocument && (
        <ViewDocumentModal
          document={viewingDocument}
          onClose={() => setViewingDocument(null)}
          onEdit={() => {
            handleEdit(viewingDocument);
            setViewingDocument(null);
          }}
          onDownload={() => handleDownload(viewingDocument)}
        />
      )}

      {attestationTargetDocument && (
        <RequestAttestationModal
          document={attestationTargetDocument}
          onClose={() => setAttestationTargetDocument(null)}
          onSubmit={(userIds, dueDate) => {
            requestAttestationMutation.mutate({
              documentId: attestationTargetDocument.id,
              userIds,
              dueDate,
            });
          }}
          isLoading={requestAttestationMutation.isPending}
        />
      )}

      {isRecommendedOpen && (
        <RecommendedDocsModal
          onClose={() => setIsRecommendedOpen(false)}
          onPick={() => undefined}
          onPickAny={(pick) => {
            if (!startFromTemplate.isPending) startFromTemplate.mutate(pick);
          }}
          busy={startFromTemplate.isPending}
        />
      )}

    </div>
  );
}

interface UploadFileToDocumentModalProps {
  documentId: number;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  isLoading: boolean;
}

function UploadFileToDocumentModal({ documentId, onClose, onSubmit, isLoading }: UploadFileToDocumentModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_FILE_TYPES.includes(ext)) {
      setFileError('Only PDF, Word (.doc, .docx), and Excel (.xls, .xlsx) files are allowed');
      return false;
    }
    if (file.size > 50 * 1024 * 1024) {
      setFileError('File size must be less than 50MB');
      return false;
    }
    setFileError(null);
    return true;
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (validateFile(droppedFile)) {
        setFile(droppedFile);
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (validateFile(selectedFile)) {
        setFile(selectedFile);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFileError('Please select a file');
      return;
    }

    const data = new FormData();
    data.append('file', file);
    if (changeSummary) {
      data.append('change_summary', changeSummary);
    }

    onSubmit(data);
  };

  const FileIcon = file ? getFileIcon(file.name.split('.').pop() || null) : Upload;

  return (
    <RightSlidePanel
      isOpen={true}
      onClose={onClose}
      title="Upload File to Document"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cw-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="upload-file-form"
            disabled={isLoading || !file}
            className="cw-btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload File
              </>
            )}
          </button>
        </div>
      }
    >
      <form id="upload-file-form" onSubmit={handleSubmit} className="space-y-4">
          <div
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragActive
                ? 'border-primary-500 bg-primary-500/10'
                : file
                ? 'border-green-500 bg-green-500/10'
                : fileError
                ? 'border-red-500 bg-red-500/10'
                : 'border-[var(--color-border)] hover:border-[var(--color-base)]'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleFileChange}
              className="hidden"
            />
            
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileIcon className={`h-12 w-12 ${getFileTypeColor(file.name.split('.').pop() || null)}`} />
                <p className="cw-text font-medium">{file.name}</p>
                <p className="text-sm cw-text-muted">{formatFileSize(file.size)}</p>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="mt-2 text-sm text-red-400 hover:text-red-300"
                >
                  Remove file
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-12 w-12 cw-text-muted" />
                <p className="cw-text font-medium">Drag and drop your file here</p>
                <p className="text-sm cw-text-muted">or</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="cw-btn-primary"
                >
                  Browse Files
                </button>
                <p className="mt-2 text-xs text-gray-700">
                  Supported: PDF, Word (.doc, .docx), Excel (.xls, .xlsx) • Max 50MB
                </p>
              </div>
            )}
          </div>
          
          {fileError && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" />
              {fileError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Change Summary (optional)</label>
            <textarea
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              rows={2}
              className="w-full cw-field"
              placeholder="Describe what changed..."
            />
          </div>

      </form>
    </RightSlidePanel>
  );
}

interface DocumentModalProps {
  document: DocumentItem | null;
  parentDocuments: DocumentItem[];
  onClose: () => void;
  onSubmit: (data: Partial<DocumentItem>) => void;
  isLoading: boolean;
}

function DocumentModal({ document, parentDocuments, onClose, onSubmit, isLoading }: DocumentModalProps) {
  const [formData, setFormData] = useState({
    title: document?.title || '',
    description: document?.description || '',
    doc_type: document?.doc_type || 'policy',
    classification: document?.classification || 'internal',
    parent_document_id: document?.parent_document_id || null,
    owner_id: document?.owner_id || null,
    content: document?.content || '',
    review_cycle_months: document?.review_cycle_months || 12,
    effective_date: document?.effective_date?.split('T')[0] || '',
    expiry_date: document?.expiry_date?.split('T')[0] || '',
    // Optional framework linkage — this is what the auditor portal reads
    // from `framework_ids` to display the doc under each framework. Empty
    // by default; user can pick zero, one, or many.
    framework_ids: (document?.framework_ids || []) as number[],
    // Frameworks the doc is audited against — drives the control-coverage panel.
    applicable_framework_ids: (document?.applicable_framework_ids || []) as number[],
  });

  // Frameworks available for linkage — same source the AI-draft modal uses,
  // so the IDs are guaranteed to be the same shape the auditor-portal
  // backend expects (UploadedFramework.id).
  const { data: frameworkOptions } = useQuery({
    queryKey: ['document-modal-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const data = response.data;
      const items = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      const filtered = (items as any[]).filter((f) =>
        f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status),
      );
      // Dedup by name — global + tenant copies (or repeat uploads) otherwise
      // show the same framework twice. Keep the most recent (highest id).
      const byName = new Map<string, any>();
      for (const f of filtered) {
        const key = String(f.name || '').trim().toLowerCase();
        const existing = byName.get(key);
        if (!existing || (f.id || 0) > (existing.id || 0)) byName.set(key, f);
      }
      return Array.from(byName.values());
    },
    staleTime: 5 * 60 * 1000,
  });

  // NCA template prefill — only available on create (not edit) so existing
  // content is never silently overwritten on an edit.
  const isCreating = !document?.id;
  const [ncaTemplateId, setNcaTemplateId] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);

  const NCA_CATEGORY_TO_DOC_TYPE: Record<string, string> = {
    Policy: 'policy',
    Standard: 'standard',
    Procedure: 'procedure',
    Program: 'program',
    Checklist: 'checklist',
    Form: 'form',
    Report: 'report',
    'Cybersecurity Foundation': 'policy',
  };

  const handleSelectNcaTemplate = async (id: string | null, meta: NcaTemplateMeta | null) => {
    setNcaTemplateId(id);
    setTemplateLoadError(null);
    if (!id || !meta) return;
    setLoadingTemplate(true);
    try {
      const res = await apiClient.get(`/governance/nca-templates/${id}/content`);
      const tplContent = (res.data?.content as string) || '';
      setFormData(prev => ({
        ...prev,
        // Only fill blank fields — don't trample what the user already typed
        title: prev.title || meta.title,
        content: prev.content || tplContent,
        description: prev.description || `Created from NCA template: ${meta.title}`,
        doc_type: prev.doc_type === 'policy'
          ? (NCA_CATEGORY_TO_DOC_TYPE[meta.category] || 'policy')
          : prev.doc_type,
      }));
    } catch (e: any) {
      setTemplateLoadError('Could not load template content. You can still write the document manually.');
    } finally {
      setLoadingTemplate(false);
    }
  };

  const availableParentDocuments = parentDocuments.filter((docOption) => docOption.id !== document?.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      parent_document_id: formData.parent_document_id || null,
      effective_date: formData.effective_date || null,
      expiry_date: formData.expiry_date || null,
      // Persist framework linkage explicitly. Empty array is fine — the
      // auditor portal just won't surface the doc under any framework
      // until the user attaches one.
      framework_ids: formData.framework_ids,
    } as any);
  };

  return (
    <RightSlidePanel
      isOpen={true}
      onClose={onClose}
      title={document?.id ? 'Edit Document' : 'New Document'}
      width="w-full max-w-4xl"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="document-form"
            disabled={isLoading}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              document?.id ? 'Update Document' : 'Create Document'
            )}
          </button>
        </div>
      }
    >
      <form id="document-form" onSubmit={handleSubmit} className="space-y-4">
          {isCreating && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
              <NcaTemplateSelect
                value={ncaTemplateId}
                onChange={handleSelectNcaTemplate}
                label="Templates"
              />
              {loadingTemplate && (
                <p className="text-xs text-blue-700 mt-2 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading template content…
                </p>
              )}
              {templateLoadError && (
                <p className="text-xs text-rose-700 mt-2">{templateLoadError}</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Enter document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Brief description of the document"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Document Type *</label>
              <MultiSelectDropdown
                title="Document Type"
                items={DOCUMENT_TYPES.filter(t => t.value).map(type => ({ value: type.value, label: type.label }))}
                selectedValues={formData.doc_type ? [formData.doc_type] : []}
                onApply={(vals) => setFormData(prev => ({ ...prev, doc_type: vals[0] || '' }))}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Document Type"
                size="md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Classification</label>
              <MultiSelectDropdown
                title="Classification"
                items={CLASSIFICATIONS.filter(c => c.value).map(cls => ({ value: cls.value, label: cls.label }))}
                selectedValues={formData.classification ? [formData.classification] : []}
                onApply={(vals) => setFormData(prev => ({ ...prev, classification: vals[0] || '' }))}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Classification"
                size="md"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Select Parent Document</label>
            <MultiSelectDropdown
              title="Parent Document"
              items={availableParentDocuments.map((docOption) => ({
                value: String(docOption.id),
                label: `${docOption.title} (${docOption.doc_type})`,
              }))}
              selectedValues={formData.parent_document_id != null ? [String(formData.parent_document_id)] : []}
              onApply={(vals) =>
                setFormData((prev) => ({
                  ...prev,
                  parent_document_id: vals[0] ? Number(vals[0]) : null,
                }))
              }
              multiSelect={false}
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Select Parent Document"
              size="md"
              forceSearch
            />
          </div>

          {/* Optional framework linkage. When set, the document shows up
              under each linked framework's Documents tab in the auditor
              portal. The auditor portal endpoint matches UploadedFramework.id
              against this array, so the picker pulls from the same
              framework-upload list. */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
              Linked Frameworks <span className="text-xs font-normal text-gray-500">(optional)</span>
            </label>
            <MultiSelectDropdown
              title="Linked Frameworks"
              items={(frameworkOptions || []).map((f: any) => ({
                value: String(f.id),
                label: f.name || `Framework ${f.id}`,
              }))}
              selectedValues={formData.framework_ids.map(String)}
              onApply={(vals) =>
                setFormData((prev) => ({
                  ...prev,
                  framework_ids: vals.map((v) => Number(v)).filter((n) => !Number.isNaN(n)),
                }))
              }
              multiSelect={true}
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Link to one or more frameworks…"
              size="md"
              forceSearch
            />
            <p className="mt-1 text-xs text-gray-500">
              Linked documents appear under each framework&apos;s Documents tab in the auditor portal.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
              Applicable Frameworks <span className="text-xs font-normal text-gray-500">— audited against (drives control coverage &amp; gaps)</span>
            </label>
            <MultiSelectDropdown
              title="Applicable Frameworks"
              items={(frameworkOptions || []).map((f: any) => ({
                value: String(f.id),
                label: f.name || `Framework ${f.id}`,
              }))}
              selectedValues={formData.applicable_framework_ids.map(String)}
              onApply={(vals) =>
                setFormData((prev) => ({
                  ...prev,
                  applicable_framework_ids: vals.map((v) => Number(v)).filter((n) => !Number.isNaN(n)),
                }))
              }
              multiSelect={true}
              triggerVariant="input"
              triggerClassName="w-full"
              placeholder="Frameworks this document must comply with…"
              size="md"
              forceSearch
            />
            <p className="mt-1 text-xs text-gray-500">
              The Controls tab shows which of these frameworks&apos; controls this document covers — and which are missing.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Content</label>
            <RichTextEditor
              value={formData.content}
              onChange={(content) => setFormData(prev => ({ ...prev, content }))}
              placeholder="Document content..."
              minHeight={240}
            />
            <p className="mt-1 text-[11px] text-gray-400">Format with the toolbar — no markdown symbols needed. Switch to “Markdown” any time to view the raw source.</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Review Cycle (months)</label>
              <input
                type="number"
                min={1}
                value={formData.review_cycle_months}
                onChange={(e) => setFormData(prev => ({ ...prev, review_cycle_months: parseInt(e.target.value) || 12 }))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Effective Date</label>
              <input
                type="date"
                value={formData.effective_date}
                onChange={(e) => setFormData(prev => ({ ...prev, effective_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Expiry Date</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData(prev => ({ ...prev, expiry_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

      </form>
    </RightSlidePanel>
  );
}

interface ViewDocumentModalProps {
  document: DocumentItem;
  onClose: () => void;
  onEdit: () => void;
  onDownload: () => void;
}

function ViewDocumentModal({ document, onClose, onEdit, onDownload }: ViewDocumentModalProps) {
  const typeStyle = getTypeStyle(document.doc_type);
  const statusStyle = getStatusStyle(document.status);
  const TypeIcon = typeStyle.icon || FileText;
  const FileIcon = getFileIcon(document.file_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="cw-card w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg ${typeStyle.bgColor} p-2`}>
              <TypeIcon className={`h-5 w-5 ${typeStyle.color}`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold cw-text">{document.title}</h2>
              {document.document_code && (
                <p className="text-sm cw-text-muted font-mono">{document.document_code}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-6">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${typeStyle.bgColor} ${typeStyle.color}`}>
              <TypeIcon className="h-3 w-3" />
              {typeStyle.label}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
              {statusStyle.label}
            </span>
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-slate-500/20 cw-text-muted">
              v{document.current_version}
            </span>
          </div>

          {document.description && (
            <div>
              <h3 className="text-sm font-medium cw-text-muted mb-1">Description</h3>
              <p className="cw-text">{document.description}</p>
            </div>
          )}

          {document.file_name && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/50 p-4">
              <h3 className="text-sm font-medium cw-text-muted mb-3">Attached File</h3>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileIcon className={`h-8 w-8 ${getFileTypeColor(document.file_type)}`} />
                  <div>
                    <p className="cw-text font-medium">{document.file_name}</p>
                    <p className="text-sm cw-text-muted">
                      {document.file_type?.toUpperCase()} • {formatFileSize(document.file_size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onDownload}
                  className="cw-btn-success flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium cw-text-muted mb-1">Owner</h3>
              <p className="cw-text">{document.owner_name || '-'}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium cw-text-muted mb-1">Classification</h3>
              <p className="cw-text capitalize">{document.classification}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium cw-text-muted mb-1">Effective Date</h3>
              <p className="cw-text">
                {document.effective_date ? new Date(document.effective_date).toLocaleDateString() : '-'}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium cw-text-muted mb-1">Next Review</h3>
              <p className="cw-text">
                {document.next_review_date ? new Date(document.next_review_date).toLocaleDateString() : '-'}
              </p>
            </div>
          </div>

          {document.content && (
            <div>
              <h3 className="text-sm font-medium cw-text-muted mb-1">Content</h3>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/50 p-4 max-h-64 overflow-y-auto">
                <p className="cw-text whitespace-pre-wrap">{document.content}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button
              onClick={onClose}
              className="cw-btn-secondary"
            >
              Close
            </button>
            <button
              onClick={onEdit}
              className="cw-btn-primary flex items-center gap-2"
            >
              <Edit2 className="h-4 w-4" />
              Edit Document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RequestAttestationModalProps {
  document: DocumentItem;
  onClose: () => void;
  onSubmit: (userIds: number[], dueDate?: string) => void;
  isLoading: boolean;
}

function RequestAttestationModal({ document, onClose, onSubmit, isLoading }: RequestAttestationModalProps) {
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['tenant-users', document.tenant_id],
    queryFn: async () => {
      const response = await governanceApi.getTenantUsers(document.tenant_id);
      return response.data as TenantUser[];
    },
  });

  const users = usersData || [];
  
  const filteredUsers = useMemo(() => {
    if (!searchTerm) return users;
    const term = searchTerm.toLowerCase();
    return users.filter(u => 
      u.user?.display_name?.toLowerCase().includes(term) ||
      u.user?.email?.toLowerCase().includes(term)
    );
  }, [users, searchTerm]);

  const handleToggleUser = (userId: number) => {
    setSelectedUserIds(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSelectAll = () => {
    if (selectedUserIds.length === filteredUsers.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(filteredUsers.map(u => u.user_id));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserIds.length === 0) return;
    onSubmit(selectedUserIds, dueDate || undefined);
  };

  return (
    <RightSlidePanel
      isOpen={true}
      onClose={onClose}
      title="Request Attestation"
      subtitle={document.title}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="cw-btn-secondary"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="request-attestation-form"
            disabled={isLoading || selectedUserIds.length === 0}
            className="cw-btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Requests ({selectedUserIds.length})
              </>
            )}
          </button>
        </div>
      }
    >
      <form id="request-attestation-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium cw-text mb-1">
              Due Date (Optional)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full cw-field"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium cw-text">
                Select Users ({selectedUserIds.length} selected)
              </label>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs text-primary-400 hover:text-primary-300"
              >
                {selectedUserIds.length === filteredUsers.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            
            <div className="mb-2">
              <SearchInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search users..."
                size="md"
              />
            </div>

            <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/50">
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 cw-text-muted">
                  <Users className="h-8 w-8 mb-2" />
                  <p className="text-sm">No users found</p>
                </div>
              ) : (
                filteredUsers.map(tenantUser => (
                  <label
                    key={tenantUser.user_id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-hover)] cursor-pointer border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(tenantUser.user_id)}
                      onChange={() => handleToggleUser(tenantUser.user_id)}
                      className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-base)] focus:ring-[var(--color-base)] focus:ring-offset-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium cw-text truncate">
                        {tenantUser.user?.display_name || 'Unknown User'}
                      </p>
                      <p className="text-xs cw-text-muted truncate">
                        {tenantUser.user?.email || 'No email'}
                      </p>
                    </div>
                    <span className="text-xs cw-text-muted capitalize">
                      {tenantUser.role}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
      </form>
    </RightSlidePanel>
  );
}
