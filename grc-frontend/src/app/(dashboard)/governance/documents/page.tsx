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
import { SearchInput, RightSlidePanel, PageLoader } from '@/components/ui';
import {
  FileText,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Eye,
  ChevronLeft,
  ChevronRight,
  Upload,
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
import RecommendedDocsModal, { NCA_DOC_TYPE_MAP, ARTIFACT_DOC_TYPE_MAP, type DocumentTemplatePick } from './_RecommendedDocsModal';
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

const ALLOWED_FILE_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

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
  const [uploadingToDocumentId, setUploadingToDocumentId] = useState<number | null>(null);
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
          toast({ type: 'warning', title: 'The law could not be attached', message: `${problemOf(e)} Attach it under References in the Comply AI Studio.` });
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
      />


      {uploadingToDocumentId !== null && (
        <UploadFileToDocumentModal
          documentId={uploadingToDocumentId}
          onClose={() => setUploadingToDocumentId(null)}
          onSubmit={(formData) => uploadToDocumentMutation.mutate({ documentId: uploadingToDocumentId, formData })}
          isLoading={uploadToDocumentMutation.isPending}
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
