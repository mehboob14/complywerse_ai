'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { SearchInput, MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import {
  FileText,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Edit2,
  Trash2,
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
  Paperclip,
  Wand2,
  CheckCircle,
  CheckCircle2,
  ExternalLink,
  Send,
  Globe,
  Users,
  ShieldCheck,
  BookMarked,
  Scale,
} from 'lucide-react';
import Link from 'next/link';
import NcaTemplateSelect, { NcaTemplateMeta } from '@/components/governance/NcaTemplateSelect';
import RecommendedDocsModal, { NCA_DOC_TYPE_MAP, ARTIFACT_DOC_TYPE_MAP } from './_RecommendedDocsModal';
import type { RecommendedDoc } from './_recommendedDocsCatalog';
import RichTextEditor from './_RichTextEditor';
import { buildTemplateContent, buildArtifactContent } from './_templateContent';
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

const normalizeDocType = (value: string | null | undefined): string =>
  String(value || '').trim().toLowerCase();

const dedupeFrameworkOptions = (items: any[] = []) => {
  const statusRank: Record<string, number> = { published: 4, completed: 3, classified: 2, parsed: 1 };
  const deduped = new Map<string, any>();

  items.forEach((framework: any) => {
    const key = String(
      framework?.published_framework_id ||
      `${String(framework?.name || '').trim().toLowerCase()}::${String(framework?.version || framework?.framework_version || '').trim().toLowerCase()}`
    );
    const existing = deduped.get(key);
    const existingRank = existing ? statusRank[String(existing?.upload_status || '').toLowerCase()] ?? 0 : -1;
    const currentRank = statusRank[String(framework?.upload_status || '').toLowerCase()] ?? 0;
    const existingUpdated = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
    const currentUpdated = framework?.updated_at ? new Date(framework.updated_at).getTime() : 0;

    if (!existing || currentRank > existingRank || (currentRank === existingRank && currentUpdated > existingUpdated)) {
      deduped.set(key, framework);
    }
  });

  return Array.from(deduped.values()).sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
};

export default function GovernanceDocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:policies:create');
  const canEdit = hasPermission('governance:policies:edit');
  const canDelete = hasPermission('governance:policies:delete');
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
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadingToDocumentId, setUploadingToDocumentId] = useState<number | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentItem | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);
  const [parsingDocumentId, setParsingDocumentId] = useState<number | null>(null);
  const [parseResult, setParseResult] = useState<{ documentId: number; count: number } | null>(null);
  const [attestationTargetDocument, setAttestationTargetDocument] = useState<DocumentItem | null>(null);
  const [isAIDraftModalOpen, setIsAIDraftModalOpen] = useState(false);
  // Recommended Documents picker — opens a categorised browse of pre-curated
  // bank-grade artefacts. Picking one feeds `aiDraftPrefill` into the AI
  // Draft modal which then opens with title + description + doc_type
  // already populated.
  const [isRecommendedOpen, setIsRecommendedOpen] = useState(false);
  const [aiDraftPrefill, setAIDraftPrefill] = useState<{
    title: string;
    description: string;
    doc_type: 'policy' | 'standard' | 'procedure' | 'guideline';
    parent_document_id?: number | null;
    /**
     * Set when the user picked an NCA template from the Document Templates
     * modal — the AI Draft form seeds its NCA-template select from this so
     * the generate call routes to /governance/nca-templates/{id}/ai-draft.
     */
    nca_template_id?: string | null;
    /**
     * Set when the user picked a reference law from the Document Templates
     * modal — the AI Draft form seeds its reference-law id from this so the
     * generate call routes to /governance/reference-laws/{id}/ai-draft and
     * the draft is grounded in the law's articles.
     */
    reference_law_id?: string | null;
    /**
     * UploadedFramework ids to pre-select in the AI Draft multi-select.
     * Set when the user picked an artifact from the Artifact Templates
     * tab so the new document auto-links back to the source framework.
     */
    framework_ids?: number[] | null;
  } | null>(null);
  // Path to navigate back to when the AI Draft modal is closed without
  // saving. Populated only when the modal was opened from the "+ Draft"
  // button on a reference inside another document's body. Cleared as soon
  // as the navigation happens so subsequent modal opens don't bounce.
  const [aiDraftReturnUrl, setAiDraftReturnUrl] = useState<string | null>(null);
  const [aiDraftResult, setAIDraftResult] = useState<{
    generated_content: string;
    suggested_title: string;
    suggested_sections: { heading: string; content: string }[];
    framework_alignment: { framework: string; controls: string[] }[];
    word_count: number;
    estimated_review_time: string;
  } | null>(null);
  const [autoParseAfterCreate, setAutoParseAfterCreate] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-open the AI Draft modal pre-filled when the user arrives from a
  // "+ Draft" button on a document-detail page's Related Documents section.
  // The detail page navigates here with ?aiDraftTitle=…&aiDraftType=…
  // (optionally &aiDraftDescription=…); we consume the params exactly once,
  // then strip them from the URL so refresh / back doesn't re-open the
  // modal. Without the strip, hitting back from the new draft would
  // re-trigger the modal in a confusing way.
  useEffect(() => {
    if (!searchParams) return;
    const title = searchParams.get('aiDraftTitle');
    const typeRaw = searchParams.get('aiDraftType');
    if (!title) return;
    const validTypes = ['policy', 'standard', 'procedure', 'guideline'] as const;
    const docType = (validTypes as readonly string[]).includes(typeRaw || '')
      ? (typeRaw as typeof validTypes[number])
      : 'policy';
    const parentIdRaw = searchParams.get('aiDraftParentId');
    const parentId = parentIdRaw && /^\d+$/.test(parentIdRaw) ? Number(parentIdRaw) : null;
    const returnUrl = searchParams.get('aiDraftReturn');
    // Comma-separated framework ids piped through from the parent doc's
    // "+ Draft" button — keeps the new draft inside the same compliance
    // scope as the document it was referenced from.
    const frameworkIdsRaw = searchParams.get('aiDraftFrameworkIds');
    const frameworkIds: number[] | null = frameworkIdsRaw
      ? frameworkIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /^\d+$/.test(s))
          .map((s) => Number(s))
      : null;
    setAIDraftPrefill({
      title,
      description: searchParams.get('aiDraftDescription') || '',
      doc_type: docType,
      parent_document_id: parentId,
      framework_ids: frameworkIds && frameworkIds.length > 0 ? frameworkIds : null,
    });
    // Stash the return URL only if it looks like an in-app path — guards
    // against open-redirect via a forged ?aiDraftReturn=https://attacker.
    if (returnUrl && returnUrl.startsWith('/governance/documents/')) {
      setAiDraftReturnUrl(returnUrl);
    }
    setIsAIDraftModalOpen(true);
    // Clean the URL so a refresh / back navigation doesn't loop us back
    // into the modal. router.replace preserves the listing state.
    router.replace('/governance/documents');
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

  const createMutation = useMutation({
    mutationFn: (data: Partial<DocumentItem>) => {
      const payload = {
        title: data.title,
        description: data.description,
        content: data.content,
        doc_type: data.doc_type,
        classification: data.classification || 'internal',
        parent_document_id: data.parent_document_id || null,
        owner_id: data.owner_id,
        review_cycle_months: data.review_cycle_months || 12,
        effective_date: data.effective_date,
        expiry_date: data.expiry_date,
        // Persist optional framework linkage so the auditor portal can
        // surface this doc under each linked framework. Previously this
        // field was silently dropped at save time — that was the root
        // cause of "I drafted against SWIFT but the auditor portal
        // documents tab is empty".
        framework_ids: Array.isArray(data.framework_ids) ? data.framework_ids : [],
        // Frameworks this doc is declared applicable to / audited against —
        // drives the control-coverage (mapped/recommended/missing) panel.
        applicable_framework_ids: Array.isArray(data.applicable_framework_ids) ? data.applicable_framework_ids : [],
      };
      return governanceApi.createDocument(payload as any);
    },
    onSuccess: () => {
      invalidateDocumentQueries();
      // Auto-parse on create is now owned by the BACKEND — every document
      // create/upload endpoint dispatches parsing server-side. The old
      // client-side trigger was removed to avoid a double parse (backend +
      // client) that billed OpenAI twice and could flip a freshly created doc
      // into "review_required". We still clear the one-shot flag so its
      // setters stay harmless.
      if (autoParseAfterCreate) {
        setAutoParseAfterCreate(false);
      }
      setIsModalOpen(false);
      setEditingDocument(null);
    },
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => governanceApi.deleteDocument(id),
    onSuccess: () => {
      invalidateDocumentQueries();
    },
  });

  const uploadWithFileMutation = useMutation({
    mutationFn: (formData: FormData) => governanceApi.uploadDocumentWithFile(formData),
    onSuccess: () => {
      invalidateDocumentQueries();
      setIsUploadModalOpen(false);
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

  // Async drafting job — kicks off a background task on submit and polls
  // /ai-draft-jobs/{id} until it completes. Real stage telemetry comes
  // straight from the pipeline's progress_callback events, so the modal
  // can show "Drafting section 4 of 13" instead of a fake timer.
  const [aiDraftJobId, setAIDraftJobId] = useState<string | null>(null);
  const [aiDraftJobState, setAIDraftJobState] = useState<{
    status: 'queued' | 'running' | 'completed' | 'failed' | 'inline';
    stage?: string;
    sections_total?: number | null;
    sections_completed?: number;
    last_section?: string | null;
    elapsed_ms?: number;
    error?: string | null;
  } | null>(null);

  const aiDraftMutation = useMutation({
    mutationFn: async (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string; parent_document_id?: number; nca_template_id?: string; reference_law_id?: string }) => {
      let response;
      if (data.reference_law_id) {
        // Reference-law path — generate a fresh document grounded in the
        // law's articles. Mirrors the NCA route: title + doc_type + any
        // extra requirements; the backend injects the full law text.
        const requirements: string[] = [];
        if (data.description) requirements.push(data.description);
        if (data.framework_ids && data.framework_ids.length > 0) {
          requirements.push(`Also align with framework IDs: ${data.framework_ids.join(', ')}`);
        }
        response = await apiClient.post(
          `/governance/reference-laws/${data.reference_law_id}/ai-draft`,
          {
            title: data.title,
            doc_type: data.doc_type,
            additional_requirements: requirements.length > 0 ? requirements.join('\n') : undefined,
            save_as_document: false,
          }
        );
      } else if (data.nca_template_id) {
        const requirements: string[] = [];
        if (data.description) requirements.push(`Document description: ${data.description}`);
        if (data.framework_ids && data.framework_ids.length > 0) {
          requirements.push(`Align with framework IDs: ${data.framework_ids.join(', ')}`);
        }
        response = await apiClient.post(
          `/governance/nca-templates/${data.nca_template_id}/ai-draft`,
          {
            title: data.title,
            additional_requirements: requirements.length > 0 ? requirements.join('\n') : undefined,
            doc_type: data.doc_type,
            save_as_document: false,
          }
        );
      } else {
        response = await apiClient.post('/governance/documents/ai-draft', data);
      }
      const body: any = response.data || {};
      if (!body.job_id) {
        // Legacy sync response — pass through directly.
        return { synchronous: true, payload: body };
      }
      return { synchronous: false, jobId: body.job_id };
    },
    onSuccess: async (out: any) => {
      if (out.synchronous) {
        // Backend ran inline (e.g. dev mode without Celery) — surface the result directly.
        setAIDraftResult(out.payload);
        toast({ type: 'success', title: 'Draft Generated', message: 'AI has generated your policy draft.' });
        return;
      }
      setAIDraftJobId(out.jobId);
      setAIDraftJobState({ status: 'queued' });
    },
    onError: (error: any) => {
      toast({
        type: 'error',
        title: 'Generation Failed',
        message: error?.response?.data?.detail || 'Failed to start AI draft job.',
      });
    },
  });

  // Polling loop — runs whenever we have an active job.
  useEffect(() => {
    if (!aiDraftJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const resp = await apiClient.get(`/governance/documents/ai-draft-jobs/${aiDraftJobId}`);
        if (cancelled) return;
        const payload: any = resp.data || {};
        setAIDraftJobState({
          status: payload.status,
          stage: payload.stage,
          sections_total: payload.sections_total,
          sections_completed: payload.sections_completed,
          last_section: payload.last_section,
          elapsed_ms: payload.elapsed_ms,
          error: payload.error,
        });
        if (payload.status === 'completed') {
          setAIDraftResult(payload.result);
          setAIDraftJobId(null);
          toast({ type: 'success', title: 'Draft Generated', message: 'AI has generated your policy draft.' });
          return;
        }
        if (payload.status === 'failed') {
          setAIDraftJobId(null);
          toast({
            type: 'error',
            title: 'Generation Failed',
            message: payload.error || 'AI drafting job failed.',
          });
          return;
        }
      } catch (e: any) {
        // Job missing / expired → stop polling
        if (e?.response?.status === 404) {
          setAIDraftJobId(null);
          setAIDraftJobState(null);
          toast({ type: 'error', title: 'Drafting Job Lost', message: 'The drafting job is no longer tracked.' });
          return;
        }
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [aiDraftJobId, toast]);

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

  const handleDelete = (doc: DocumentItem) => {
    if (confirm(`Are you sure you want to delete "${doc.title}"?`)) {
      deleteMutation.mutate(doc.id);
    }
  };

  const handleEdit = (doc: DocumentItem) => {
    setEditingDocument(doc);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingDocument(null);
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
        onNewDocument={() => setIsUploadModalOpen(true)}
        onAIDraft={() => setIsAIDraftModalOpen(true)}
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
            setAutoParseAfterCreate(false);
          }}
          onSubmit={(data) => {
            if (editingDocument?.id) {
              updateMutation.mutate({ id: editingDocument.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {isUploadModalOpen && (
        <UploadDocumentModal
          onClose={() => setIsUploadModalOpen(false)}
          onSubmit={(formData) => uploadWithFileMutation.mutate(formData)}
          isLoading={uploadWithFileMutation.isPending}
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
          onPick={(doc: RecommendedDoc) => {
            // Legacy callback (kept so the modal's internal fall-through still
            // works). The recommended-doc flow is handled fully by `onPickAny`
            // below, so we don't need to repeat the prefill here.
            void doc;
          }}
          onPickAny={(pick) => {
            // Standard Templates + Artifact Templates ship "already generated":
            // picking one opens the create modal pre-filled with ready-to-edit
            // content (deterministic, no AI round-trip / wait). The user then
            // refines it in the WYSIWYG editor. NCA + reference-law remain
            // AI-draft sources (handled below). This reuses the SAME create
            // path the AI flow uses (editingDocument → modal), so nothing else
            // changes.
            // Standard Templates ship "already generated" client-side.
            if (pick.kind === 'recommended') {
              setEditingDocument({
                title: pick.doc.title,
                content: buildTemplateContent(pick.doc),
                doc_type: pick.doc.doc_type,
                description: pick.doc.blurb,
                framework_ids: [],
              } as any);
              setAutoParseAfterCreate(false);
              setIsRecommendedOpen(false);
              setIsModalOpen(true);
              return;
            }

            // Artifact Templates: prefer the pre-generated, type-/control-specific
            // document body (artifact_content.json via the backend); fall back to
            // the client-side template if it hasn't been generated yet.
            if (pick.kind === 'artifact') {
              const item = pick.item;
              const fallback = buildArtifactContent({
                name: item.name,
                artifact_type: item.artifact_type,
                description: item.description || undefined,
                framework_key: pick.frameworkName,
                control_ref: item.control_ref || undefined,
              });
              setIsRecommendedOpen(false);
              (async () => {
                let content = fallback;
                try {
                  const res = await apiClient.get('/artifacts/catalog/content', {
                    params: { artifact_id: item.artifact_id },
                  });
                  const d = res.data as { found?: boolean; content?: string };
                  if (d?.found && d.content) content = d.content;
                } catch {
                  // keep the client-side fallback
                }
                setEditingDocument({
                  title: item.name,
                  content,
                  doc_type: ARTIFACT_DOC_TYPE_MAP(item.artifact_type),
                  description: item.description || '',
                  framework_ids: pick.frameworkUploadedId ? [pick.frameworkUploadedId] : [],
                } as any);
                setAutoParseAfterCreate(false);
                setIsModalOpen(true);
              })();
              return;
            }

            // NCA templates ship as ready, EDITABLE documents: fetch the exact
            // template content and open the create modal pre-filled (WYSIWYG), so
            // the user edits the real document instead of regenerating it from
            // scratch — same behaviour as Standard / Artifact templates.
            if (pick.kind === 'nca') {
              const docType = NCA_DOC_TYPE_MAP[pick.template.category] ?? 'policy';
              const tpl = pick.template;
              setIsRecommendedOpen(false);
              (async () => {
                let content = '';
                try {
                  const res = await apiClient.get(`/governance/nca-templates/${tpl.id}/content`);
                  content = ((res.data as { content?: string })?.content) || '';
                } catch {
                  // Fall back to an empty editor the user can fill in.
                }
                setEditingDocument({
                  title: tpl.title,
                  content,
                  doc_type: docType,
                  description: `Based on the NCA template "${tpl.title}" (${tpl.category}).`,
                  framework_ids: [],
                } as any);
                setAutoParseAfterCreate(false);
                setIsModalOpen(true);
              })();
              return;
            }

            // Single funnel for the remaining tabs — derive the AI-draft prefill
            // from whichever payload the picker emitted. Closing the templates
            // modal and opening AI Draft happens once at the bottom.
            let prefill: typeof aiDraftPrefill = null;
            if (pick.kind === 'reference-law') {
              // The law isn't a single document — it's a source of
              // obligations. Seed a sensible title + doc type the user can
              // change in the AI Draft modal, and carry the law id so the
              // generate call routes to the reference-law endpoint.
              const docTypeHint = (pick.law.doc_type_hint || 'policy') as
                | 'policy' | 'standard' | 'procedure' | 'guideline';
              const allowed = ['policy', 'standard', 'procedure', 'guideline'] as const;
              const docType = (allowed as readonly string[]).includes(docTypeHint) ? docTypeHint : 'policy';
              prefill = {
                title: `${pick.law.short_name || pick.law.name} Compliance Policy`,
                description:
                  `Draft a document that fully complies with and operationalises ${pick.law.name}` +
                  `${pick.law.jurisdiction ? ` (${pick.law.jurisdiction})` : ''}. ` +
                  `Cite the relevant articles and cover data-subject rights, controller/processor ` +
                  `obligations, lawful basis, transfer, breach notification, retention, and penalties as applicable.`,
                doc_type: docType,
                reference_law_id: pick.law.id,
              };
            }
            // Note: 'recommended' and 'artifact' are handled above with an early
            // return (ready-made content), so they never reach this prefill chain.
            if (!prefill) return;
            setAIDraftPrefill(prefill);
            setIsRecommendedOpen(false);
            setIsAIDraftModalOpen(true);
          }}
        />
      )}

      {isAIDraftModalOpen && (
        <AIDraftPolicyModal
          parentDocuments={parentDocumentOptions}
          prefill={aiDraftPrefill}
          onClose={() => {
            setIsAIDraftModalOpen(false);
            setAIDraftResult(null);
            // Clear prefill so the next open from "AI Draft Document"
            // starts blank again, not carrying the recommended preset.
            setAIDraftPrefill(null);
            // If we got here from a "+ Draft" button on a document detail
            // page, route the operator back to where they were so a cancel
            // doesn't strand them on the listing page. Clear the stash
            // first so reopening the modal manually doesn't bounce them
            // back unexpectedly.
            if (aiDraftReturnUrl) {
              const url = aiDraftReturnUrl;
              setAiDraftReturnUrl(null);
              router.push(url);
            }
          }}
          onGenerate={(data) => aiDraftMutation.mutate(data)}
          onUseContent={(content: string, title: string, docType?: string, description?: string, parentDocumentId?: number, frameworkIds?: number[], applicableFrameworkIds?: number[]) => {
            setIsAIDraftModalOpen(false);
            setAIDraftResult(null);
            setAutoParseAfterCreate(true);
            // The return URL is only meaningful for the *cancel* path; once
            // the user opts to use the generated content we fall into the
            // normal create-document flow, so drop the stash here too.
            setAiDraftReturnUrl(null);
            setEditingDocument({
              title,
              content,
              doc_type: docType || 'policy',
              description: description || '',
              parent_document_id: parentDocumentId || null,
              // Carry the AI-draft framework selection through to the
              // Document modal so the user doesn't have to reselect.
              framework_ids: Array.isArray(frameworkIds) ? frameworkIds : [],
              applicable_framework_ids: Array.isArray(applicableFrameworkIds) ? applicableFrameworkIds : [],
            } as any);
            setIsModalOpen(true);
          }}
          isLoading={aiDraftMutation.isPending || Boolean(aiDraftJobId)}
          jobState={aiDraftJobState}
          result={aiDraftResult}
        />
      )}

    </div>
  );
}

interface UploadDocumentModalProps {
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
  isLoading: boolean;
}

function UploadDocumentModal({ onClose, onSubmit, isLoading }: UploadDocumentModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    doc_type: 'policy',
    classification: 'internal',
    framework_ids: [] as number[],
  });
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    data.append('title', formData.title);
    data.append('doc_type', formData.doc_type);
    data.append('classification', formData.classification);
    if (formData.description) {
      data.append('description', formData.description);
    }
    if (formData.framework_ids.length > 0) {
      // JSON-encoded so the backend can rehydrate the list with one
      // parse call (more reliable than repeated form keys here).
      data.append('framework_ids', JSON.stringify(formData.framework_ids));
    }

    onSubmit(data);
  };

  const FileIcon = file ? getFileIcon(file.name.split('.').pop() || null) : Upload;

  return (
    <RightSlidePanel
      isOpen={true}
      onClose={onClose}
      title="New Document"
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
            form="upload-document-form"
            disabled={isLoading || !file}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Create Document
              </>
            )}
          </button>
        </div>
      }
    >
      <form id="upload-document-form" onSubmit={handleSubmit} className="space-y-4">
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
                <p className="mt-2 text-xs cw-text-muted">
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
              <label className="block text-sm font-medium text-gray-800 mb-1">Classification *</label>
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

          {/* Optional framework linkage — same field as the AI-draft and
              manual-create flows so uploaded docs also surface in the
              auditor portal under each linked framework. */}
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

      </form>
    </RightSlidePanel>
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

// Real, telemetry-backed progress for the AI drafting pipeline.
// Reads the job state from the polling loop instead of guessing from
// elapsed time. Stages map to the Celery task's stage transitions:
//   queued → context → outline → expand_sections → qa → done
type DraftingJobState = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'inline';
  stage?: string;
  sections_total?: number | null;
  sections_completed?: number;
  last_section?: string | null;
  elapsed_ms?: number;
  error?: string | null;
};

interface DraftingStageProgressProps {
  jobState?: DraftingJobState | null;
}

const STAGE_FLOW = [
  { key: 'outline',          label: 'Planning the document outline',     detail: 'Choosing topics per section from your active frameworks' },
  { key: 'expand_sections',  label: 'Drafting sections in parallel',     detail: 'Citing your frameworks and substituting tenant values inline' },
  { key: 'qa',               label: 'Validating depth and citations',    detail: 'Catching placeholders, hallucinated codes, thin sections' },
  { key: 'done',             label: 'Ready',                              detail: '' },
];

function DraftingStageProgress({ jobState }: DraftingStageProgressProps) {
  const activeStage = jobState?.stage || 'queued';
  const activeIdx = (() => {
    // The backend still emits a 'context' stage at the very start (it reads
    // committees / password policy / active framework journeys before stage A).
    // We deliberately don't render a separate row for it — that detail is
    // internal plumbing the user doesn't need to see. Collapse it into the
    // first visible stage ('outline') so the progress UI still shows motion
    // while context-loading runs.
    if (activeStage === 'context' || activeStage === 'queued') return 0;
    const i = STAGE_FLOW.findIndex(s => s.key === activeStage);
    return i === -1 ? 0 : i;
  })();
  const elapsedSec = Math.floor((jobState?.elapsed_ms || 0) / 1000);
  const total = jobState?.sections_total || 0;
  const done = jobState?.sections_completed || 0;
  const sectionsPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
          <div>
            <div className="text-sm font-semibold text-purple-900">
              {jobState?.status === 'queued' ? 'Queued — waiting for a worker' : 'Drafting in progress'}
            </div>
            <div className="text-xs text-purple-700/80">
              Running on a background worker. You can close this and it'll keep going.
            </div>
          </div>
        </div>
        <div className="text-xs font-mono text-purple-700">{elapsedSec}s</div>
      </div>

      {sectionsPct !== null && activeStage === 'expand_sections' && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-purple-800 mb-1">
            <span className="font-medium">{jobState?.last_section || 'Drafting sections…'}</span>
            <span>{done} / {total} sections</span>
          </div>
          <div className="h-1.5 rounded-full bg-purple-200/70 overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all duration-500"
              style={{ width: `${sectionsPct}%` }}
            />
          </div>
        </div>
      )}

      <ol className="mt-4 space-y-1.5">
        {STAGE_FLOW.slice(0, -1).map((stage, i) => {
          const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          return (
            <li key={stage.key} className="flex items-start gap-2.5">
              <span
                className={
                  state === 'done'
                    ? 'mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-white shrink-0'
                    : state === 'active'
                      ? 'mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-purple-600 bg-white shrink-0'
                      : 'mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-gray-300 bg-white shrink-0'
                }
              >
                {state === 'done' ? <CheckCircle className="h-3 w-3" /> : null}
                {state === 'active' ? <span className="block h-1.5 w-1.5 rounded-full bg-purple-600 animate-pulse" /> : null}
              </span>
              <div className="flex-1 min-w-0">
                <div className={state === 'pending' ? 'text-xs text-gray-500' : 'text-xs font-medium text-purple-900'}>
                  {stage.label}
                </div>
                {state === 'active' && stage.detail && (
                  <div className="text-[11px] text-purple-700/70 mt-0.5">{stage.detail}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface AIDraftPolicyModalProps {
  parentDocuments: DocumentItem[];
  /**
   * Optional initial state when opened from the Recommended Documents picker
   * OR from a "+ Draft" button next to a reference inside another document.
   * The optional `parent_document_id` seeds the parent-document picker so
   * the new draft inherits the source document's hierarchy automatically.
   */
  prefill?: {
    title: string;
    description: string;
    doc_type: 'policy' | 'standard' | 'procedure' | 'guideline';
    parent_document_id?: number | null;
    nca_template_id?: string | null;
    reference_law_id?: string | null;
    framework_ids?: number[] | null;
  } | null;
  onClose: () => void;
  onGenerate: (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string; parent_document_id?: number; nca_template_id?: string; reference_law_id?: string }) => void;
  onUseContent: (
    content: string,
    title: string,
    docType?: string,
    description?: string,
    parentDocumentId?: number,
    // Frameworks the user picked in this AI-draft session — must
    // propagate through to the document-create call so the doc shows
    // up in the auditor portal under each linked framework.
    frameworkIds?: number[],
    // Frameworks the doc is declared applicable to / audited against —
    // persisted so the control-coverage (gap) panel can be computed.
    applicableFrameworkIds?: number[],
  ) => void;
  isLoading: boolean;
  jobState?: DraftingJobState | null;
  result: {
    generated_content: string;
    suggested_title: string;
    suggested_sections: { heading: string; content: string }[];
    framework_alignment: { framework: string; controls: string[] }[];
    word_count: number;
    estimated_review_time: string;
  } | null;
}

function AIDraftPolicyModal({ parentDocuments, prefill, onClose, onGenerate, onUseContent, isLoading, jobState, result }: AIDraftPolicyModalProps) {
  // When opened from the Recommended Documents picker, seed the form with
  // the curated banking-grade brief so the user can hit Generate without
  // editing. They can still edit any field before submission.
  // doc_type stays a loose `string` so the existing setter (which can write
  // an empty string when the user clears the dropdown) keeps compiling.
  const [formData, setFormData] = useState<{ doc_type: string; title: string; description: string }>({
    doc_type: prefill?.doc_type ?? 'policy',
    title: prefill?.title ?? '',
    description: prefill?.description ?? '',
  });
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>(
    Array.isArray(prefill?.framework_ids) ? (prefill!.framework_ids as number[]) : [],
  );
  // Frameworks the document is declared applicable to / audited against. Defaults
  // to the citation frameworks (a sensible starting point) but is independent —
  // drives the control-coverage (mapped/recommended/missing) panel on the doc.
  const [selectedApplicableFrameworkIds, setSelectedApplicableFrameworkIds] = useState<number[]>(
    Array.isArray(prefill?.framework_ids) ? (prefill!.framework_ids as number[]) : [],
  );
  const [selectedParentDocumentId, setSelectedParentDocumentId] = useState<number | null>(
    prefill?.parent_document_id ?? null,
  );
  const [selectedNcaTemplateId, setSelectedNcaTemplateId] = useState<string | null>(
    prefill?.nca_template_id ?? null,
  );
  const [selectedReferenceLawId] = useState<string | null>(
    prefill?.reference_law_id ?? null,
  );
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Documents the tenant already has covering the selected framework(s).
  // Backend returns these so the user can see what was skipped from AI
  // suggestions ("12 already covered" / "18 missing to create").
  const [alreadyCovered, setAlreadyCovered] = useState<Array<{ id: number; title: string; doc_type: string; status: string }>>([]);
  // Each entry pins an AI-skipped suggestion to a real existing platform
  // doc. Backend only emits a record here when it can identify which
  // uploaded/drafted/approved doc justified the skip — speculative
  // skips that can't be tied to a real doc are NOT shown.
  const [skippedMatches, setSkippedMatches] = useState<Array<{
    suggested_title: string;
    matched_existing_id: number | null;
    matched_existing_title: string | null;
    matched_existing_doc_type?: string | null;
    matched_existing_status?: string | null;
    reason: string;
    match_type: 'exact_normalized' | 'token_overlap' | 'semantic';
  }>>([]);
  const [showAlreadyCoveredAll, setShowAlreadyCoveredAll] = useState(false);
  const [showBypassedAll, setShowBypassedAll] = useState(false);
  const { toast } = useToast();

  const { data: frameworks } = useQuery({
    queryKey: ['frameworks-for-ai-draft'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const data = response.data;
      const items = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      return dedupeFrameworkOptions(
        items.filter((f: any) => f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status))
      );
    },
  });

  const toggleFramework = (id: number) => {
    setSelectedFrameworkIds(prev =>
      prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]
    );
    setSuggestions(null);
    setShowSuggestions(false);
    setAlreadyCovered([]);
    setSkippedMatches([]);
    setShowAlreadyCoveredAll(false);
    setShowBypassedAll(false);
  };

  const selectedFrameworks = (frameworks || []).filter((f: any) => selectedFrameworkIds.includes(f.id));
  const filteredSuggestions = useMemo(() => {
    if (!suggestions) return null;
    const selectedDocType = normalizeDocType(formData.doc_type);
    return suggestions.filter((suggestion: any) => normalizeDocType(suggestion?.doc_type) === selectedDocType);
  }, [suggestions, formData.doc_type]);

  const handleSuggestDocuments = async () => {
    if (selectedFrameworkIds.length === 0) return;
    setSuggestionsLoading(true);
    setShowSuggestions(true);
    try {
      const response = await governanceApi.suggestPoliciesForFramework({
        framework_ids: selectedFrameworkIds,
        doc_type: formData.doc_type,
      });
      const payload = (response.data as any) || {};
      setSuggestions(payload.suggestions || []);
      setAlreadyCovered(Array.isArray(payload.already_covered) ? payload.already_covered : []);
      // Prefer the new authoritative field. Each entry carries the
      // matched existing doc, so the UI never has to guess.
      const rawMatches = Array.isArray(payload.skipped_matches) ? payload.skipped_matches : [];
      setSkippedMatches(
        rawMatches.filter((m: any) => m && m.suggested_title && m.matched_existing_title),
      );
      setShowAlreadyCoveredAll(false);
      setShowBypassedAll(false);
    } catch (error: any) {
      toast({
        type: 'error',
        title: 'Suggestion Failed',
        message: error?.response?.data?.detail || 'Failed to get AI suggestions.',
      });
      setSuggestions([]);
      setAlreadyCovered([]);
      setSkippedMatches([]);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const handleSelectSuggestion = (suggestion: any) => {
    setFormData({
      doc_type: formData.doc_type,
      title: suggestion.title || '',
      description: suggestion.description || '',
    });
    setShowSuggestions(false);
    toast({
      type: 'success',
      title: 'Suggestion Applied',
      message: `"${suggestion.title}" selected. You can edit the details before generating.`,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    onGenerate({
      doc_type: formData.doc_type,
      title: formData.title,
      framework_ids: selectedFrameworkIds.length > 0 ? selectedFrameworkIds : undefined,
      description: formData.description || undefined,
      parent_document_id: selectedParentDocumentId || undefined,
      nca_template_id: selectedNcaTemplateId || undefined,
      reference_law_id: selectedReferenceLawId || undefined,
    });
  };

  const handleCopyContent = () => {
    if (result?.generated_content) {
      navigator.clipboard.writeText(result.generated_content);
      toast({
        type: 'success',
        title: 'Copied',
        message: 'Content copied to clipboard',
      });
    }
  };

  const priorityColors: Record<string, string> = {
    high: 'border border-red-200 bg-red-50 text-red-700',
    medium: 'border border-amber-200 bg-amber-50 text-amber-700',
    low: 'border border-green-200 bg-green-50 text-green-700',
  };

  const docTypeColors: Record<string, string> = {
    policy: 'bg-blue-100 text-blue-800',
    standard: 'bg-purple-100 text-purple-800',
    procedure: 'bg-teal-100 text-teal-800',
    guideline: 'bg-indigo-100 text-indigo-800',
  };

  return (
    <RightSlidePanel
      isOpen={true}
      onClose={onClose}
      title="AI Draft Document"
      subtitle="Generate professional policy documents with AI"
      width="w-full max-w-4xl"
      footer={
        !result ? (
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
              form="ai-draft-form"
              disabled={isLoading || !formData.title.trim()}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate Draft
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                onGenerate({
                  doc_type: formData.doc_type,
                  title: formData.title,
                  framework_ids: selectedFrameworkIds.length > 0 ? selectedFrameworkIds : undefined,
                  description: formData.description || undefined,
                  parent_document_id: selectedParentDocumentId || undefined,
                });
              }}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Wand2 className="h-4 w-4" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => onUseContent(
                result.generated_content,
                result.suggested_title,
                formData.doc_type,
                formData.description,
                selectedParentDocumentId || undefined,
                selectedFrameworkIds,
                selectedApplicableFrameworkIds,
              )}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              Use This Content
            </button>
          </div>
        )
      }
    >
      <div>
        {!result ? (
          <form id="ai-draft-form" onSubmit={handleSubmit} className="space-y-5">
              {isLoading && <DraftingStageProgress jobState={jobState} />}

              {selectedReferenceLawId && (
                <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  <Scale className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Grounded in the selected reference law — the generated document will comply with and cite the
                    law&apos;s articles. Choose the document type (policy, charter, procedure…) and a title, then generate.
                  </span>
                </div>
              )}

              {/* ─── Step 1 · What are you drafting? ─────────────────── */}
              <section className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white text-[11px] font-semibold">1</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    What are you drafting?
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium cw-text mb-1">
                      Document title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder="e.g. Information Security Policy"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium cw-text mb-1">
                      Document type <span className="text-red-500">*</span>
                    </label>
                    <MultiSelectDropdown
                      title="Document Type"
                      items={[
                        { value: 'policy', label: 'Policy' },
                        { value: 'standard', label: 'Standard' },
                        { value: 'procedure', label: 'Procedure' },
                        { value: 'guideline', label: 'Guideline' },
                        { value: 'charter', label: 'Charter' },
                      ]}
                      selectedValues={formData.doc_type ? [formData.doc_type] : []}
                      onApply={(vals) => {
                        setFormData(prev => ({ ...prev, doc_type: vals[0] || '' }));
                        setSuggestions(null);
                        setShowSuggestions(false);
                      }}
                      multiSelect={false}
                      triggerVariant="input"
                      triggerClassName="w-full"
                      placeholder="Select"
                      size="md"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium cw-text mb-1">
                    Description / intent <span className="text-xs font-normal text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="What should this document cover? Any specific scope, audience, or focus?"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </section>

              {/* ─── Step 2 · Sources (all optional) ──────────────────── */}
              <section className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-white text-[11px] font-semibold">2</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Anchor it (optional)
                  </span>
                  <span className="text-xs text-gray-400">
                    — citations will come from the frameworks you pick
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Reference frameworks</label>
                      <MultiSelectDropdown
                        title="Frameworks"
                        items={(frameworks || []).map((fw: any) => ({ value: String(fw.id), label: fw.name }))}
                        selectedValues={selectedFrameworkIds.map(String)}
                        onApply={(vals) => {
                          setSelectedFrameworkIds(vals.map(Number));
                          setSuggestions(null);
                          setShowSuggestions(false);
                        }}
                        multiSelect={true}
                        triggerVariant="input"
                        triggerClassName="w-full"
                        placeholder="Select frameworks to cite..."
                        size="md"
                        forceSearch
                      />
                      <p className="mt-1 text-[11px] text-gray-400">Cited in the drafted document.</p>
                      {selectedFrameworks.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selectedFrameworks.map((fw: any) => (
                            <span
                              key={fw.id}
                              className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700"
                            >
                              <Shield className="h-2.5 w-2.5" />
                              {fw.name}
                              <button
                                type="button"
                                onClick={() => toggleFramework(fw.id)}
                                className="ml-0.5 rounded-full hover:bg-purple-500/30 p-0.5"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">In-scope frameworks</label>
                      <MultiSelectDropdown
                        title="In-scope frameworks"
                        items={(frameworks || []).map((fw: any) => ({ value: String(fw.id), label: fw.name }))}
                        selectedValues={selectedApplicableFrameworkIds.map(String)}
                        onApply={(vals) => setSelectedApplicableFrameworkIds(vals.map(Number))}
                        multiSelect={true}
                        triggerVariant="input"
                        triggerClassName="w-full"
                        placeholder="Frameworks this document must comply with..."
                        size="md"
                        forceSearch
                      />
                      <p className="mt-1 text-[11px] text-gray-400">Audited against — drives the control-coverage &amp; gap panel.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Reference template</label>
                      <NcaTemplateSelect
                        value={selectedNcaTemplateId}
                        onChange={(id) => setSelectedNcaTemplateId(id)}
                        label=""
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Parent document</label>
                      <MultiSelectDropdown
                        title="Parent Document"
                        items={parentDocuments.map((docOption) => ({
                          value: String(docOption.id),
                          label: `${docOption.title} (${docOption.doc_type})`,
                        }))}
                        selectedValues={selectedParentDocumentId != null ? [String(selectedParentDocumentId)] : []}
                        onApply={(vals) => setSelectedParentDocumentId(vals[0] ? Number(vals[0]) : null)}
                        multiSelect={false}
                        triggerVariant="input"
                        triggerClassName="w-full"
                        placeholder="Choose a parent..."
                        size="md"
                        forceSearch
                      />
                    </div>
                  </div>
                </div>
              </section>

              {selectedFrameworkIds.length > 0 && !showSuggestions && (
                <button
                  type="button"
                  onClick={handleSuggestDocuments}
                  disabled={suggestionsLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-all"
                >
                  {suggestionsLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI is analyzing framework requirements...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4" />
                      Suggest Documents Based on Framework
                    </>
                  )}
                </button>
              )}

              {showSuggestions && (
                <div className="overflow-hidden rounded-xl border border-blue-200 bg-white">
                  <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-blue-700" />
                      <span className="text-sm font-medium text-blue-700">
                        Missing — AI-suggested
                        {filteredSuggestions && <span className="ml-1 text-blue-600">({filteredSuggestions.length})</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSuggestDocuments}
                        disabled={suggestionsLoading}
                        className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800"
                      >
                        <Wand2 className="h-3 w-3" />
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSuggestions(false)}
                        className="cw-text-muted hover:cw-text"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-3 space-y-2">
                    {suggestionsLoading ? (
                      <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-4 text-sm text-blue-700">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <p>Analyzing framework controls and requirements...</p>
                      </div>
                    ) : filteredSuggestions && filteredSuggestions.length > 0 ? (
                      filteredSuggestions.map((suggestion: any, idx: number) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSelectSuggestion(suggestion)}
                          className="w-full text-left rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-surface)]/50 p-3 hover:border-[var(--color-base)]/50 hover:bg-[var(--color-hover)]/50 transition-all group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${docTypeColors[suggestion.doc_type] || 'bg-slate-500/20 text-gray-800'}`}>
                                  {suggestion.doc_type}
                                </span>
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${priorityColors[suggestion.priority] || priorityColors.medium}`}>
                                  {suggestion.priority}
                                </span>
                              </div>
                              <h4 className="text-sm font-medium cw-text group-hover:text-[var(--color-base)] transition-colors">
                                {suggestion.title}
                              </h4>
                              <p className="text-xs cw-text-muted mt-1 line-clamp-2">
                                {suggestion.description}
                              </p>
                              {suggestion.relevant_controls && suggestion.relevant_controls.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {suggestion.relevant_controls.slice(0, 4).map((ctrl: string, cIdx: number) => (
                                    <span key={cIdx} className="inline-flex items-center rounded bg-[var(--color-subtle)] px-1.5 py-0.5 text-xs cw-text-muted">
                                      {ctrl}
                                    </span>
                                  ))}
                                  {suggestion.relevant_controls.length > 4 && (
                                    <span className="text-xs cw-text-muted">+{suggestion.relevant_controls.length - 4} more</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <ChevronRight className="h-4 w-4 cw-text-muted group-hover:text-[var(--color-base)] transition-colors flex-shrink-0 mt-1" />
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="text-center py-4 text-sm cw-text-muted">
                        No {formData.doc_type} suggestions available. Try selecting different frameworks.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bypassed-by-AI panel. The AI suggested these, but the
                  platform recognised each as substantially equivalent to
                  a document the tenant already has. Every row links the
                  AI's suggested title to the existing doc that justified
                  the skip — if a skip can't be tied to a real existing
                  doc (e.g. a low-confidence semantic match the backend
                  couldn't pin), it's NOT shown here. */}
              {showSuggestions && !suggestionsLoading && (skippedMatches.length > 0 || alreadyCovered.length > 0) && (
                <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
                  <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-amber-700" />
                      <span className="text-sm font-medium text-amber-800">
                        Bypassed by AI — already covered
                      </span>
                      <span className="text-xs text-amber-700/80">
                        ({skippedMatches.length + alreadyCovered.length})
                      </span>
                    </div>
                  </div>

                  <div className="p-3 space-y-3">
                    {/* Verified skips: each row pairs the AI's suggestion
                        with the existing platform doc it matched. Clicking
                        the existing-doc title opens it in a new tab so the
                        reviewer can audit the call. */}
                    {skippedMatches.length > 0 && (
                      <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-1.5">
                          {skippedMatches.length} suggestion{skippedMatches.length === 1 ? '' : 's'} bypassed (matched to existing docs)
                        </p>
                        <ul className="space-y-1.5">
                          {(showBypassedAll ? skippedMatches : skippedMatches.slice(0, 8)).map((m, idx) => {
                            const matchTypeLabel =
                              m.match_type === 'exact_normalized'
                                ? 'Exact match'
                                : m.match_type === 'token_overlap'
                                ? 'Similar title'
                                : 'Semantic match';
                            const matchTypeStyle =
                              m.match_type === 'exact_normalized'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : m.match_type === 'token_overlap'
                                ? 'border-orange-200 bg-orange-50 text-orange-700'
                                : 'border-purple-200 bg-purple-50 text-purple-700';
                            return (
                              <li
                                key={`bypassed-${idx}`}
                                className="text-xs flex flex-col gap-1 rounded-md border border-amber-100 bg-white/60 px-2 py-1.5"
                              >
                                <div className="flex items-start gap-2 flex-wrap">
                                  <span className="text-amber-900 line-through opacity-75 truncate" title={m.suggested_title}>
                                    {m.suggested_title}
                                  </span>
                                  <span
                                    className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${matchTypeStyle}`}
                                    title={m.reason}
                                  >
                                    {matchTypeLabel}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-emerald-800">
                                  <ChevronRight className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                                  <span className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">
                                    Matched to
                                  </span>
                                  {m.matched_existing_id ? (
                                    <Link
                                      href={`/governance/documents/${m.matched_existing_id}`}
                                      className="text-xs font-medium text-emerald-800 hover:underline truncate"
                                      title={m.matched_existing_title ?? undefined}
                                    >
                                      {m.matched_existing_title}
                                    </Link>
                                  ) : (
                                    <span className="text-xs font-medium text-emerald-800 truncate">
                                      {m.matched_existing_title}
                                    </span>
                                  )}
                                  {m.matched_existing_status && (
                                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700">
                                      {m.matched_existing_status}
                                    </span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        {skippedMatches.length > 8 && (
                          <button
                            type="button"
                            onClick={() => setShowBypassedAll((v) => !v)}
                            className="mt-1 text-[11px] text-amber-700 hover:text-amber-800 hover:underline"
                          >
                            {showBypassedAll ? 'Show fewer' : `Show all ${skippedMatches.length}`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Existing platform docs covering the framework.
                        Independent of the skip-list above — these are
                        ALL the docs that already exist, not just the
                        ones the AI tried to re-suggest. */}
                    {alreadyCovered.length > 0 && (
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle className="h-3 w-3" />
                          Existing documents covering this framework ({alreadyCovered.length})
                        </p>
                        <ul className="space-y-1">
                          {(showAlreadyCoveredAll ? alreadyCovered : alreadyCovered.slice(0, 8)).map((doc) => (
                            <li key={doc.id} className="text-xs text-emerald-900 flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="text-emerald-500">•</span>
                                <Link
                                  href={`/governance/documents/${doc.id}`}
                                  className="hover:underline truncate"
                                >
                                  {doc.title}
                                </Link>
                              </span>
                              <span className="flex items-center gap-1 flex-shrink-0">
                                <span className="inline-flex items-center rounded-full bg-white border border-emerald-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                                  {doc.doc_type}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-700">
                                  {doc.status}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                        {alreadyCovered.length > 8 && (
                          <button
                            type="button"
                            onClick={() => setShowAlreadyCoveredAll((v) => !v)}
                            className="mt-1 text-[11px] text-emerald-700 hover:text-emerald-800 hover:underline"
                          >
                            {showAlreadyCoveredAll ? 'Show fewer' : `Show all ${alreadyCovered.length}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

          </form>
        ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm cw-text-muted">
                    <FileText className="h-4 w-4" />
                    <span>{result.word_count} words</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm cw-text-muted">
                    <Loader2 className="h-4 w-4" />
                    <span>~{result.estimated_review_time} to review</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyContent}
                    className="cw-btn-secondary flex items-center gap-2 px-3 py-1.5"
                  >
                    <Paperclip className="h-4 w-4" />
                    Copy Content
                  </button>
                </div>
              </div>

              {result.framework_alignment && result.framework_alignment.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {result.framework_alignment.map((alignment, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-full bg-purple-500/20 px-3 py-1"
                    >
                      <Shield className="h-3.5 w-3.5 text-purple-400" />
                      <span className="text-sm font-medium text-purple-300">{alignment.framework}</span>
                      <span className="text-xs text-purple-400">({alignment.controls.length} controls)</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/50 overflow-hidden">
                <div className="border-b border-[var(--color-border)] px-4 py-2 bg-[var(--color-surface)]/50">
                  <h3 className="font-medium cw-text">{result.suggested_title}</h3>
                  <p className="mt-1 text-xs cw-text-muted">The following contents will be part of the document. Click Use This Content to continue.</p>
                </div>
                <div className="p-4 space-y-4 max-h-[200px] overflow-y-auto">
                  {result.suggested_sections.map((section, idx) => (
                    <div key={idx} className="space-y-2">
                      <h4 className="font-medium text-purple-300">{section.heading}</h4>
                      <div className="text-sm cw-text whitespace-pre-wrap leading-relaxed">
                        {section.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

          </div>
        )}
      </div>
    </RightSlidePanel>
  );
}
