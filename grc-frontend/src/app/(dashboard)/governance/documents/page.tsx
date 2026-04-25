'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { 
  FileText, 
  Loader2, 
  AlertCircle, 
  Search, 
  Plus,
  X,
  Edit2,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
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
  ExternalLink,
  Send,
  Globe,
  Users,
} from 'lucide-react';

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

type SortField = 'document_code' | 'title' | 'doc_type' | 'status' | 'owner_name' | 'current_version' | 'next_review_date' | 'created_at';
type SortOrder = 'asc' | 'desc';

export default function GovernanceDocumentsPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:policies:create');
  const canEdit = hasPermission('governance:policies:edit');
  const canDelete = hasPermission('governance:policies:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'hierarchy'>('list');
  const [expandedNodeIds, setExpandedNodeIds] = useState<number[]>([]);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadingToDocumentId, setUploadingToDocumentId] = useState<number | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentItem | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);
  const [parsingDocumentId, setParsingDocumentId] = useState<number | null>(null);
  const [parseResult, setParseResult] = useState<{ documentId: number; count: number } | null>(null);
  const [attestationTargetDocument, setAttestationTargetDocument] = useState<DocumentItem | null>(null);
  const [isAIDraftModalOpen, setIsAIDraftModalOpen] = useState(false);
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

  const invalidateDocumentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
    queryClient.invalidateQueries({ queryKey: ['governance-documents-hierarchy'] });
    queryClient.invalidateQueries({ queryKey: ['governance-documents-parent-options'] });
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['governance-documents', typeFilter, statusFilter, searchTerm, sortField, sortOrder, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        skip: page * pageSize,
        limit: pageSize,
        sort_by: sortField,
        sort_order: sortOrder,
      };
      if (typeFilter) params.doc_type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      if (searchTerm) params.search = searchTerm;
      
      const response = await governanceApi.getDocuments(params as any);
      return response.data as unknown as DocumentListResponse;
    },
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

  const { data: hierarchyDocuments = [], isLoading: isHierarchyLoading } = useQuery({
    queryKey: ['governance-documents-hierarchy'],
    queryFn: async () => {
      const response = await governanceApi.getDocumentHierarchy();
      return (response.data || []) as DocumentHierarchyItem[];
    },
    enabled: viewMode === 'hierarchy',
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
      };
      return governanceApi.createDocument(payload as any);
    },
    onSuccess: (response) => {
      invalidateDocumentQueries();
      if (autoParseAfterCreate) {
        const createdDocumentId = (response.data as { id?: number } | undefined)?.id;
        if (createdDocumentId) {
          parsePolicyMutation.mutate(createdDocumentId);
        }
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

  const aiDraftMutation = useMutation({
    mutationFn: (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string; parent_document_id?: number }) =>
      governanceApi.generatePolicyDraft(data),
    onSuccess: (response) => {
      setAIDraftResult(response.data as typeof aiDraftResult);
      toast({
        type: 'success',
        title: 'Draft Generated',
        message: 'AI has generated your policy draft. Review and use the content.',
      });
    },
    onError: (error: any) => {
      toast({
        type: 'error',
        title: 'Generation Failed',
        message: error?.response?.data?.detail || 'Failed to generate AI draft.',
      });
    },
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

  const documents = data?.items || [];
  const totalItems = data?.total || 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  const uniqueOwners = useMemo(() => {
    const owners = new Set<string>();
    const ownerSource = parentDocumentOptions.length > 0 ? parentDocumentOptions : documents;
    ownerSource.forEach(doc => {
      if (doc.owner_name) owners.add(doc.owner_name);
    });
    return Array.from(owners);
  }, [documents, parentDocumentOptions]);

  const filteredDocuments = useMemo(() => {
    let filtered = documents;
    
    if (ownerFilter) {
      filtered = filtered.filter(doc => doc.owner_name === ownerFilter);
    }
    
    return filtered;
  }, [documents, ownerFilter]);

  const filteredHierarchyDocuments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const applyHierarchyFilters = (nodes: DocumentHierarchyItem[]): DocumentHierarchyItem[] => {
      return nodes
        .map((node) => {
          const children = applyHierarchyFilters(node.children || []);
          const matchesType = !typeFilter || node.doc_type === typeFilter;
          const matchesStatus = !statusFilter || node.status === statusFilter;
          const matchesOwner = !ownerFilter || node.owner_name === ownerFilter;
          const matchesSearch = !normalizedSearch || [
            node.title,
            node.description || '',
            node.document_code || '',
            node.owner_name || '',
          ].some((value) => value.toLowerCase().includes(normalizedSearch));
          const matchesCurrentNode = matchesType && matchesStatus && matchesOwner && matchesSearch;

          if (matchesCurrentNode || children.length > 0) {
            return {
              ...node,
              children,
            };
          }
          return null;
        })
        .filter((node): node is DocumentHierarchyItem => node !== null);
    };

    return applyHierarchyFilters(hierarchyDocuments);
  }, [hierarchyDocuments, searchTerm, typeFilter, statusFilter, ownerFilter]);

  const allHierarchyNodeIds = useMemo(() => {
    const ids: number[] = [];
    const walk = (nodes: DocumentHierarchyItem[]) => {
      nodes.forEach((node) => {
        ids.push(node.id);
        if (node.children?.length) walk(node.children);
      });
    };
    walk(filteredHierarchyDocuments);
    return ids;
  }, [filteredHierarchyDocuments]);

  const toggleNodeExpanded = (documentId: number) => {
    setExpandedNodeIds((prev) =>
      prev.includes(documentId)
        ? prev.filter((id) => id !== documentId)
        : [...prev, documentId]
    );
  };

  const expandAllHierarchyNodes = () => {
    setExpandedNodeIds(allHierarchyNodeIds);
  };

  const collapseAllHierarchyNodes = () => {
    setExpandedNodeIds([]);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
    setPage(0);
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

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider cw-text-muted cursor-pointer hover:cw-text-default transition-colors"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sortField === field ? 'text-[var(--color-base)]' : ''}`} />
      </div>
    </th>
  );

  const renderHierarchyNode = (doc: DocumentHierarchyItem, depth = 0): React.ReactNode => {
    const hasChildren = Boolean(doc.children && doc.children.length > 0);
    const isExpanded = expandedNodeIds.includes(doc.id);
    const typeStyle = getTypeStyle(doc.doc_type);
    const statusStyle = getStatusStyle(doc.status);

    return (
      <div key={doc.id}>
        <div className="grid grid-cols-[minmax(0,1fr)_140px_80px_140px_140px_auto] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 hover:bg-[var(--color-hover)] transition-colors">
          <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => toggleNodeExpanded(doc.id)}
                className="rounded p-1 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="inline-block h-6 w-6" />
            )}
            <button
              onClick={() => router.push(`/governance/documents/${doc.id}`)}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium cw-text-default hover:text-[var(--color-base)]"
              title={doc.title}
            >
              {doc.title}
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm cw-text-default">
            <span className={`inline-block h-2 w-2 rounded-full ${(statusStyle.bgColor || 'bg-[var(--color-muted)]').replace('/20', '')}`} />
            <span className="truncate">{statusStyle.label}</span>
          </div>

          <div className="text-sm cw-text-default">
            {doc.current_version || '1.0'}
          </div>

          <div className="text-sm cw-text-default truncate" title={typeStyle.label}>
            {typeStyle.label}
          </div>

          <div className="text-sm cw-text-muted truncate" title={doc.owner_name || '-'}>
            {doc.owner_name || '-'}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => router.push(`/governance/documents/${doc.id}`)}
              className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
              title="View Details"
            >
              <Eye className="h-4 w-4" />
            </button>
            {canEdit && (
              <button
                onClick={() => handleEdit(doc)}
                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                title="Edit"
              >
                <Edit2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => handleDownload(doc)}
              className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-success-soft)] hover:text-[var(--color-success)] transition-colors"
              title={doc.file_name ? 'Download File' : 'Download Draft as HTML'}
            >
              <Download className="h-4 w-4" />
            </button>
            {doc.file_name ? (
              <button
                onClick={() => parsePolicyMutation.mutate(doc.id)}
                className={`rounded p-1.5 transition-colors ${
                  doc.policy_statement_count && doc.policy_statement_count > 0
                    ? 'text-[var(--color-success)] hover:bg-[var(--color-success-soft)]'
                    : 'text-[var(--color-base)] hover:bg-[var(--color-base-soft)]'
                }`}
                title={doc.policy_statement_count && doc.policy_statement_count > 0
                  ? `${doc.policy_statement_count} statements extracted - Click to re-parse`
                  : 'Parse Policy Statements'
                }
                disabled={parsingDocumentId === doc.id}
              >
                {parsingDocumentId === doc.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
              </button>
            ) : (
              <button
                onClick={() => setUploadingToDocumentId(doc.id)}
                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-base-soft)] hover:text-[var(--color-base)] transition-colors"
                title="Upload File"
              >
                <Upload className="h-4 w-4" />
              </button>
            )}
            {doc.status === 'approved' && (
              <button
                onClick={() => publishMutation.mutate(doc.id)}
                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-success-soft)] hover:text-[var(--color-success)] transition-colors"
                title="Publish Document"
                disabled={publishMutation.isPending}
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
              </button>
            )}
            {doc.status === 'published' && (
              <button
                onClick={() => setAttestationTargetDocument(doc)}
                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-base-soft)] hover:text-[var(--color-base)] transition-colors"
                title="Request Attestation"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => handleDelete(doc)}
                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-colors"
                title="Delete"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div>
            {(doc.children || []).map((child) => renderHierarchyNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Document Library</h1>
          <p className="page-description">Manage governance documents, policies, and procedures</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canCreate && (
            <button
              onClick={() => setIsAIDraftModalOpen(true)}
              className="cw-btn-secondary flex items-center gap-2 whitespace-nowrap"
            >
              <Wand2 size={18} />
              AI Draft Document
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="cw-btn-secondary flex items-center gap-2 whitespace-nowrap"
            >
              <Upload size={18} />
              New Document with File
            </button>
          )}
          {canCreate && (
            <button
              onClick={handleCreate}
              className="cw-btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <Plus size={18} />
              New Document
            </button>
          )}
        </div>
      </div>

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

      <div className="cw-card p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            {/* <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 cw-text-muted" /> */}
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
              className="cw-field w-full pl-10"
            />
          </div>
          
          <div className="flex flex-wrap gap-3">
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="cw-field"
            >
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="cw-field"
            >
              {DOCUMENT_STATUSES.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            
            <select
              value={ownerFilter}
              onChange={(e) => { setOwnerFilter(e.target.value); setPage(0); }}
              className="cw-field"
            >
              <option value="">All Owners</option>
              {uniqueOwners.map(owner => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </select>

            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border)]">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${viewMode === 'list' ? 'bg-[var(--color-base-soft)] text-[var(--color-base)]' : 'bg-[var(--color-subtle)] cw-text-muted hover:bg-[var(--color-hover)]'}`}
                type="button"
              >
                List
              </button>
              <button
                onClick={() => setViewMode('hierarchy')}
                className={`border-l border-[var(--color-border)] px-3 py-2 text-sm font-medium transition-colors ${viewMode === 'hierarchy' ? 'bg-[var(--color-base-soft)] text-[var(--color-base)]' : 'bg-[var(--color-subtle)] cw-text-muted hover:bg-[var(--color-hover)]'}`}
                type="button"
              >
                Hierarchy
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="cw-card overflow-hidden">
        {viewMode === 'hierarchy' ? (
          isHierarchyLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--color-base)]" />
            </div>
          ) : filteredHierarchyDocuments.length === 0 ? (
            <div className="empty-state h-64">
              <div className="empty-state-icon">
                <FileText className="h-12 w-12 cw-text-muted" />
              </div>
              <p className="empty-state-title">No documents found in hierarchy</p>
              <p className="text-sm cw-text-muted">Create documents or adjust filters to view parent-child structure.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                <p className="text-sm cw-text-muted">
                  Showing {allHierarchyNodeIds.length} document{allHierarchyNodeIds.length !== 1 ? 's' : ''} in hierarchy view
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={expandAllHierarchyNodes}
                    type="button"
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-1.5 text-xs font-medium cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                  >
                    Expand All
                  </button>
                  <button
                    onClick={collapseAllHierarchyNodes}
                    type="button"
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-1.5 text-xs font-medium cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                  >
                    Collapse All
                  </button>
                </div>
              </div>
              <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_140px_80px_140px_140px_auto] items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-xs font-medium uppercase tracking-wider cw-text-muted">
                <div>Document</div>
                <div>Status</div>
                <div>Version</div>
                <div>Type</div>
                <div>Owner</div>
                <div className="text-right">Actions</div>
              </div>
              <div>
                {filteredHierarchyDocuments.map((doc) => renderHierarchyNode(doc))}
              </div>
            </>
          )
        ) : isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-base)]" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="empty-state h-64">
            <div className="empty-state-icon">
              <FileText className="h-12 w-12 cw-text-muted" />
            </div>
            <p className="empty-state-title">No documents found</p>
            {canCreate && (
              <button
                onClick={handleCreate}
                className="cw-btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Create First Document
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="lg:hidden divide-y divide-[var(--color-border)]">
              {filteredDocuments.map((doc) => {
                const typeStyle = getTypeStyle(doc.doc_type);
                const statusStyle = getStatusStyle(doc.status);
                const FileIcon = getFileIcon(doc.file_type);

                return (
                  <div key={doc.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => router.push(`/governance/documents/${doc.id}`)}
                          className="max-w-full truncate text-left font-semibold cw-text-default hover:text-[var(--color-base)]"
                          title={doc.title}
                        >
                          {doc.title}
                        </button>
                        {doc.description && (
                          <p className="mt-1 text-sm cw-text-muted line-clamp-2">{doc.description}</p>
                        )}
                      </div>
                      <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bgColor} text-gray-800`}>
                        {statusStyle.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-medium ${typeStyle.bgColor} text-gray-800`}>
                        {typeStyle.label}
                      </span>
                      <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 cw-text-muted">
                        Owner: {doc.owner_name || '-'}
                      </span>
                      <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 cw-text-muted">
                        Version: {doc.current_version || '1.0'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm cw-text-muted">
                      <FileIcon className={`h-4 w-4 ${getFileTypeColor(doc.file_type)}`} />
                      <span className="truncate">{doc.file_name || 'No file attached'}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => router.push(`/governance/documents/${doc.id}`)}
                        className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => handleEdit(doc)}
                          className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDownload(doc)}
                        className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-success-soft)] hover:text-[var(--color-success)] transition-colors"
                        title={doc.file_name ? 'Download File' : 'Download Draft as HTML'}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      {doc.file_name ? (
                        <button
                          onClick={() => parsePolicyMutation.mutate(doc.id)}
                          className={`rounded p-1.5 transition-colors ${
                            doc.policy_statement_count && doc.policy_statement_count > 0
                              ? 'text-[var(--color-success)] hover:bg-[var(--color-success-soft)]'
                              : 'text-[var(--color-base)] hover:bg-[var(--color-base-soft)]'
                          }`}
                          title={doc.policy_statement_count && doc.policy_statement_count > 0
                            ? `${doc.policy_statement_count} statements extracted - Click to re-parse`
                            : 'Parse Policy Statements'
                          }
                          disabled={parsingDocumentId === doc.id}
                        >
                          {parsingDocumentId === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Wand2 className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => setUploadingToDocumentId(doc.id)}
                          className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-base-soft)] hover:text-[var(--color-base)] transition-colors"
                          title="Upload File"
                        >
                          <Upload className="h-4 w-4" />
                        </button>
                      )}
                      {doc.status === 'approved' && (
                        <button
                          onClick={() => publishMutation.mutate(doc.id)}
                          className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-success-soft)] hover:text-[var(--color-success)] transition-colors"
                          title="Publish Document"
                          disabled={publishMutation.isPending}
                        >
                          {publishMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Globe className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      {doc.status === 'published' && (
                        <button
                          onClick={() => setAttestationTargetDocument(doc)}
                          className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-base-soft)] hover:text-[var(--color-base)] transition-colors"
                          title="Request Attestation"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(doc)}
                          className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-colors"
                          title="Delete"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--color-surface)]">
                  <tr>
                    <SortableHeader field="title">Title</SortableHeader>
                    <SortableHeader field="doc_type">Type</SortableHeader>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider cw-text-muted">File</th>
                    <SortableHeader field="status">Status</SortableHeader>
                    <SortableHeader field="owner_name">Owner</SortableHeader>
                    <SortableHeader field="current_version">Version</SortableHeader>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider cw-text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredDocuments.map((doc) => {
                    const typeStyle = getTypeStyle(doc.doc_type);
                    const statusStyle = getStatusStyle(doc.status);
                    const FileIcon = getFileIcon(doc.file_type);

                    return (
                      <tr key={doc.id} className="hover:bg-[var(--color-hover)] transition-colors">
                        <td className="px-4 py-4">
                          <div className="max-w-xs">
                            <button
                              onClick={() => router.push(`/governance/documents/${doc.id}`)}
                              className="max-w-full truncate text-left font-medium cw-text-default hover:text-[var(--color-base)]"
                              title={doc.title}
                            >
                              {doc.title}
                            </button>
                            {doc.description && (
                              <p className="text-sm cw-text-muted truncate">{doc.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${typeStyle.bgColor} text-gray-800`}>
                            {typeStyle.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          {doc.file_name ? (
                            <div className="flex items-center gap-2">
                              <FileIcon className={`h-4 w-4 ${getFileTypeColor(doc.file_type)}`} />
                              <div className="max-w-[140px]">
                                <p className="text-sm cw-text-default truncate" title={doc.file_name}>{doc.file_name}</p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm cw-text-muted">No file</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bgColor} text-gray-800`}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm cw-text-default">
                          {doc.owner_name || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm cw-text-default">
                          {doc.current_version || '1.0'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => router.push(`/governance/documents/${doc.id}`)}
                              className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {canEdit && (
                              <button
                                onClick={() => handleEdit(doc)}
                                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDownload(doc)}
                              className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-success-soft)] hover:text-[var(--color-success)] transition-colors"
                              title={doc.file_name ? 'Download File' : 'Download Draft as HTML'}
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            {doc.file_name ? (
                              <button
                                onClick={() => parsePolicyMutation.mutate(doc.id)}
                                className={`rounded p-1.5 transition-colors ${
                                  doc.policy_statement_count && doc.policy_statement_count > 0
                                      ? 'text-[var(--color-success)] hover:bg-[var(--color-success-soft)]'
                                      : 'text-[var(--color-base)] hover:bg-[var(--color-base-soft)]'
                                }`}
                                title={doc.policy_statement_count && doc.policy_statement_count > 0 
                                  ? `${doc.policy_statement_count} statements extracted - Click to re-parse`
                                  : 'Parse Policy Statements'
                                }
                                disabled={parsingDocumentId === doc.id}
                              >
                                {parsingDocumentId === doc.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Wand2 className="h-4 w-4" />
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => setUploadingToDocumentId(doc.id)}
                                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-base-soft)] hover:text-[var(--color-base)] transition-colors"
                                title="Upload File"
                              >
                                <Upload className="h-4 w-4" />
                              </button>
                            )}
                            {doc.status === 'approved' && (
                              <button
                                onClick={() => publishMutation.mutate(doc.id)}
                                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-success-soft)] hover:text-[var(--color-success)] transition-colors"
                                title="Publish Document"
                                disabled={publishMutation.isPending}
                              >
                                {publishMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Globe className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            {doc.status === 'published' && (
                              <button
                                onClick={() => setAttestationTargetDocument(doc)}
                                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-base-soft)] hover:text-[var(--color-base)] transition-colors"
                                title="Request Attestation"
                              >
                                <Send className="h-4 w-4" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(doc)}
                                className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] transition-colors"
                                title="Delete"
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
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

            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3">
              <div className="text-sm cw-text-muted">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalItems)} of {totalItems} documents
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-2 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm cw-text-muted">
                  Page {page + 1} of {totalPages || 1}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-2 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text-default disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

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

      {isAIDraftModalOpen && (
        <AIDraftPolicyModal
          parentDocuments={parentDocumentOptions}
          onClose={() => {
            setIsAIDraftModalOpen(false);
            setAIDraftResult(null);
          }}
          onGenerate={(data) => aiDraftMutation.mutate(data)}
          onUseContent={(content: string, title: string, docType?: string, description?: string, parentDocumentId?: number) => {
            setIsAIDraftModalOpen(false);
            setAIDraftResult(null);
            setAutoParseAfterCreate(true);
            setEditingDocument({
              title,
              content,
              doc_type: docType || 'policy',
              description: description || '',
              parent_document_id: parentDocumentId || null,
            } as any);
            setIsModalOpen(true);
          }}
          isLoading={aiDraftMutation.isPending}
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
  });
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
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
    data.append('title', formData.title);
    data.append('doc_type', formData.doc_type);
    data.append('classification', formData.classification);
    if (formData.description) {
      data.append('description', formData.description);
    }

    onSubmit(data);
  };

  const FileIcon = file ? getFileIcon(file.name.split('.').pop() || null) : Upload;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="cw-card w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
          <h2 className="text-xl font-semibold cw-text">New Document with File</h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
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
              className="w-full cw-field"
              placeholder="Enter document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full cw-field"
              placeholder="Brief description of the document"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Document Type *</label>
              <select
                required
                value={formData.doc_type}
                onChange={(e) => setFormData(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full cw-field"
              >
                {DOCUMENT_TYPES.filter(t => t.value).map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Classification *</label>
              <select
                required
                value={formData.classification}
                onChange={(e) => setFormData(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full cw-field"
              >
                {CLASSIFICATIONS.map(cls => (
                  <option key={cls.value} value={cls.value}>{cls.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              className="cw-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
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
                  Create Document
                </>
              )}
            </button>
          </div>
        </form>
      </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="cw-card w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
          <h2 className="text-xl font-semibold cw-text">Upload File to Document</h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
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

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              className="cw-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
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
        </form>
      </div>
    </div>
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
  });

  const availableParentDocuments = parentDocuments.filter((docOption) => docOption.id !== document?.id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      parent_document_id: formData.parent_document_id || null,
      effective_date: formData.effective_date || null,
      expiry_date: formData.expiry_date || null,
    } as any);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="cw-card w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
          <h2 className="text-xl font-semibold cw-text">
            {document?.id ? 'Edit Document' : 'New Document'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full cw-field"
              placeholder="Enter document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full cw-field"
              placeholder="Brief description of the document"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Document Type *</label>
              <select
                required
                value={formData.doc_type}
                onChange={(e) => setFormData(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full cw-field"
              >
                {DOCUMENT_TYPES.filter(t => t.value).map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Classification</label>
              <select
                value={formData.classification}
                onChange={(e) => setFormData(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full cw-field"
              >
                {CLASSIFICATIONS.map(cls => (
                  <option key={cls.value} value={cls.value}>{cls.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Select Parent Document</label>
            <select
              value={formData.parent_document_id ?? ''}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  parent_document_id: e.target.value ? Number(e.target.value) : null,
                }))
              }
              className="w-full cw-field"
            >
              <option value="">None (Top-level document)</option>
              {availableParentDocuments.map((docOption) => (
                <option key={docOption.id} value={docOption.id}>
                  {docOption.title} ({docOption.doc_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              rows={6}
              className="w-full cw-field"
              placeholder="Document content..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Review Cycle (months)</label>
              <input
                type="number"
                min={1}
                value={formData.review_cycle_months}
                onChange={(e) => setFormData(prev => ({ ...prev, review_cycle_months: parseInt(e.target.value) || 12 }))}
                className="w-full cw-field"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Effective Date</label>
              <input
                type="date"
                value={formData.effective_date}
                onChange={(e) => setFormData(prev => ({ ...prev, effective_date: e.target.value }))}
                className="w-full cw-field"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Expiry Date</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData(prev => ({ ...prev, expiry_date: e.target.value }))}
                className="w-full cw-field"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              className="cw-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="cw-btn-primary flex items-center gap-2 disabled:opacity-50"
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
        </form>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="cw-card w-full max-w-lg max-h-[90vh] overflow-hidden shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold cw-text">Request Attestation</h2>
            <p className="text-sm cw-text-muted mt-0.5">{document.title}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-180px)]">
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
            
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 cw-text-muted" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full cw-field pl-10"
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

        <div className="flex justify-end gap-3 border-t border-[var(--color-border)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="cw-btn-secondary"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
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
      </div>
    </div>
  );
}

interface AIDraftPolicyModalProps {
  parentDocuments: DocumentItem[];
  onClose: () => void;
  onGenerate: (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string; parent_document_id?: number }) => void;
  onUseContent: (content: string, title: string, docType?: string, description?: string, parentDocumentId?: number) => void;
  isLoading: boolean;
  result: {
    generated_content: string;
    suggested_title: string;
    suggested_sections: { heading: string; content: string }[];
    framework_alignment: { framework: string; controls: string[] }[];
    word_count: number;
    estimated_review_time: string;
  } | null;
}

function AIDraftPolicyModal({ parentDocuments, onClose, onGenerate, onUseContent, isLoading, result }: AIDraftPolicyModalProps) {
  const [formData, setFormData] = useState({
    doc_type: 'policy',
    title: '',
    description: '',
  });
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [selectedParentDocumentId, setSelectedParentDocumentId] = useState<number | null>(null);
  const [showFrameworkDropdown, setShowFrameworkDropdown] = useState(false);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowFrameworkDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleFramework = (id: number) => {
    setSelectedFrameworkIds(prev =>
      prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]
    );
    setSuggestions(null);
    setShowSuggestions(false);
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
      setSuggestions((response.data as any)?.suggestions || []);
    } catch (error: any) {
      toast({
        type: 'error',
        title: 'Suggestion Failed',
        message: error?.response?.data?.detail || 'Failed to get AI suggestions.',
      });
      setSuggestions([]);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="cw-card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-gradient-to-r from-blue-50 to-violet-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white p-2 shadow-sm border border-blue-100">
              <Wand2 className="h-5 w-5 text-violet-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold cw-text">AI Draft Document</h2>
              <p className="text-sm cw-text-muted">Generate professional policy documents with AI</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 cw-text-muted hover:bg-[var(--color-hover)] hover:cw-text transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!result ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium cw-text mb-1">Document Type *</label>
                  <select
                    value={formData.doc_type}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, doc_type: e.target.value }));
                      setSuggestions(null);
                      setShowSuggestions(false);
                    }}
                    className="w-full cw-field"
                  >
                    <option value="policy">Policy</option>
                    <option value="standard">Standard</option>
                    <option value="procedure">Procedure</option>
                    <option value="guideline">Guideline</option>
                  </select>
                </div>
                <div ref={dropdownRef} className="relative">
                  <label className="block text-sm font-medium cw-text mb-1">Regulatory Frameworks (Optional)</label>
                  <button
                    type="button"
                    onClick={() => setShowFrameworkDropdown(!showFrameworkDropdown)}
                    className="w-full cw-field text-left flex items-center justify-between"
                  >
                    <span className={selectedFrameworkIds.length === 0 ? 'cw-text-muted' : 'cw-text'}>
                      {selectedFrameworkIds.length === 0
                        ? 'Select frameworks...'
                        : `${selectedFrameworkIds.length} framework${selectedFrameworkIds.length > 1 ? 's' : ''} selected`}
                    </span>
                    <ChevronDown className="h-4 w-4 cw-text-muted" />
                  </button>
                  {showFrameworkDropdown && (
                    <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] shadow-xl">
                      {(frameworks || []).length === 0 ? (
                        <div className="px-3 py-2 text-sm cw-text-muted">No frameworks available</div>
                      ) : (
                        (frameworks || []).map((fw: any) => (
                          <label
                            key={fw.id}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-hover)] cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={selectedFrameworkIds.includes(fw.id)}
                              onChange={() => toggleFramework(fw.id)}
                              className="rounded border-[var(--color-border)] bg-[var(--color-subtle)] text-[var(--color-base)] focus:ring-[var(--color-base)]"
                            />
                            <span className="text-sm cw-text truncate">{fw.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium cw-text mb-1">Select Parent Document (Optional)</label>
                <select
                  value={selectedParentDocumentId ?? ''}
                  onChange={(e) => setSelectedParentDocumentId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full cw-field"
                >
                  <option value="">None</option>
                  {parentDocuments.map((docOption) => (
                    <option key={docOption.id} value={docOption.id}>
                      {docOption.title} ({docOption.doc_type})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs cw-text-muted">
                  Framework references are optional. You can generate a comprehensive document with or without frameworks.
                </p>
              </div>

              {selectedFrameworks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedFrameworks.map((fw: any) => (
                    <span
                      key={fw.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700"
                    >
                      <Shield className="h-3 w-3" />
                      {fw.name}
                      <button
                        type="button"
                        onClick={() => toggleFramework(fw.id)}
                        className="ml-0.5 rounded-full hover:bg-purple-500/30 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

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
                        AI-Suggested Documents
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

              <div>
                <label className="block text-sm font-medium cw-text mb-1">Policy Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Information Security Policy"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full cw-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium cw-text mb-1">Description / Requirements</label>
                <textarea
                  rows={3}
                  placeholder="Describe what this policy should cover, any specific requirements, or areas of focus..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full cw-field"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="cw-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !formData.title.trim()}
                  className="cw-btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
                <button
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
                  className="cw-btn-secondary flex items-center gap-2 disabled:opacity-50"
                >
                  <Wand2 className="h-4 w-4" />
                  Regenerate
                </button>
                <button
                  onClick={() => onUseContent(result.generated_content, result.suggested_title, formData.doc_type, formData.description, selectedParentDocumentId || undefined)}
                  className="cw-btn-primary flex items-center gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  Use This Content
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
