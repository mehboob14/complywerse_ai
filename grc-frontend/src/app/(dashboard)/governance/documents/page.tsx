'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
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

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-primary-600', bgColor: 'bg-primary-500/20' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
];

const DOCUMENT_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft', color: 'text-slate-400', bgColor: 'bg-slate-500/20' },
  { value: 'pending_review', label: 'Pending Review', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'pending_approval', label: 'Pending Approval', color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  { value: 'approved', label: 'Approved', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'published', label: 'Published', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'expired', label: 'Expired', color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { value: 'archived', label: 'Archived', color: 'text-gray-400', bgColor: 'bg-gray-500/20' },
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
  return DOCUMENT_TYPES.find(t => t.value === type) || { label: type, color: 'text-slate-400', bgColor: 'bg-slate-500/20', icon: FileText };
};

const getStatusStyle = (status: string) => {
  return DOCUMENT_STATUSES.find(s => s.value === status) || { label: status, color: 'text-slate-400', bgColor: 'bg-slate-500/20' };
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
  if (!fileType) return 'text-slate-400';
  const type = fileType.toLowerCase();
  if (type === 'pdf') return 'text-red-400';
  if (['doc', 'docx'].includes(type)) return 'text-blue-400';
  if (['xls', 'xlsx'].includes(type)) return 'text-green-400';
  return 'text-slate-400';
};

type SortField = 'document_code' | 'title' | 'doc_type' | 'status' | 'owner_name' | 'current_version' | 'next_review_date' | 'created_at';
type SortOrder = 'asc' | 'desc';

export default function GovernanceDocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const createMutation = useMutation({
    mutationFn: (data: Partial<DocumentItem>) => {
      const payload = {
        title: data.title,
        description: data.description,
        content: data.content,
        doc_type: data.doc_type,
        classification: data.classification || 'internal',
        owner_id: data.owner_id,
        review_cycle_months: data.review_cycle_months || 12,
        effective_date: data.effective_date,
        expiry_date: data.expiry_date,
      };
      return governanceApi.createDocument(payload as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
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
        owner_id: data.owner_id,
        review_cycle_months: data.review_cycle_months,
        effective_date: data.effective_date,
        expiry_date: data.expiry_date,
      };
      return governanceApi.updateDocument(id, payload as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
      setIsModalOpen(false);
      setEditingDocument(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => governanceApi.deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
    },
  });

  const uploadWithFileMutation = useMutation({
    mutationFn: (formData: FormData) => governanceApi.uploadDocumentWithFile(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
      setIsUploadModalOpen(false);
    },
  });

  const uploadToDocumentMutation = useMutation({
    mutationFn: ({ documentId, formData }: { documentId: number; formData: FormData }) => 
      governanceApi.uploadFileToDocument(documentId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
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
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
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
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
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
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
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
    mutationFn: (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string }) =>
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
      const response = await governanceApi.downloadDocumentFile(doc.id);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || `document_${doc.id}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download file');
    }
  };

  const documents = data?.items || [];
  const totalItems = data?.total || 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  const uniqueOwners = useMemo(() => {
    const owners = new Set<string>();
    documents.forEach(doc => {
      if (doc.owner_name) owners.add(doc.owner_name);
    });
    return Array.from(owners);
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    let filtered = documents;
    
    if (ownerFilter) {
      filtered = filtered.filter(doc => doc.owner_name === ownerFilter);
    }
    
    return filtered;
  }, [documents, ownerFilter]);

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
      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 cursor-pointer hover:text-slate-900 transition-colors"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${sortField === field ? 'text-primary-400' : ''}`} />
      </div>
    </th>
  );

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-400">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load documents</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Document Library</h1>
          <p className="text-slate-400">Manage governance documents, policies, and procedures</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAIDraftModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-primary-500 bg-gradient-to-r from-purple-500/20 to-blue-500/20 px-4 py-2 font-medium text-primary-600 hover:from-purple-500/30 hover:to-blue-500/30 transition-colors"
          >
            <Wand2 size={18} />
            AI Draft Policy
          </button>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-primary-600 bg-primary-600/10 px-4 py-2 font-medium text-primary-400 hover:bg-primary-600/20 transition-colors"
          >
            <Upload size={18} />
            New Document with File
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 transition-colors"
          >
            <Plus size={18} />
            New Document
          </button>
        </div>
      </div>

      {parseResult && (
        <div className="flex items-center justify-between rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="font-medium text-green-400">
                {parseResult.count} policy statement{parseResult.count !== 1 ? 's' : ''} extracted successfully
              </p>
              <p className="text-sm text-slate-400">
                View and manage compliance in the Compliance module
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/compliance/statements"
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              View Statements
            </a>
            <button
              onClick={() => setParseResult(null)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 py-2 pl-10 pr-4 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          
          <div className="flex flex-wrap gap-3">
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {DOCUMENT_STATUSES.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            
            <select
              value={ownerFilter}
              onChange={(e) => { setOwnerFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All Owners</option>
              {uniqueOwners.map(owner => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-4 text-slate-400">
            <FileText className="h-12 w-12" />
            <p>No documents found</p>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
            >
              <Plus size={18} />
              Create First Document
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <SortableHeader field="document_code">Code</SortableHeader>
                    <SortableHeader field="title">Title</SortableHeader>
                    <SortableHeader field="doc_type">Type</SortableHeader>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">File</th>
                    <SortableHeader field="status">Status</SortableHeader>
                    <SortableHeader field="owner_name">Owner</SortableHeader>
                    <SortableHeader field="current_version">Version</SortableHeader>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {filteredDocuments.map((doc) => {
                    const typeStyle = getTypeStyle(doc.doc_type);
                    const statusStyle = getStatusStyle(doc.status);
                    const TypeIcon = typeStyle.icon || FileText;
                    const FileIcon = getFileIcon(doc.file_type);
                    
                    return (
                      <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                        <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-slate-600">
                          {doc.document_code || '-'}
                        </td>
                        <td className="px-4 py-4">
                          <div className="max-w-xs">
                            <p className="font-medium text-slate-800 truncate">{doc.title}</p>
                            {doc.description && (
                              <p className="text-sm text-slate-400 truncate">{doc.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${typeStyle.bgColor} ${typeStyle.color}`}>
                            <TypeIcon className="h-3 w-3" />
                            {typeStyle.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          {doc.file_name ? (
                            <div className="flex items-center gap-2">
                              <FileIcon className={`h-4 w-4 ${getFileTypeColor(doc.file_type)}`} />
                              <div className="max-w-[150px]">
                                <p className="text-sm text-slate-600 truncate" title={doc.file_name}>{doc.file_name}</p>
                                <p className="text-xs text-slate-500">{formatFileSize(doc.file_size)}</p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-500">No file</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-600">
                          {doc.owner_name || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-600">
                          {doc.current_version || '1.0'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setViewingDocument(doc)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-600 hover:text-slate-900 transition-colors"
                              title="View"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleEdit(doc)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-600 hover:text-slate-900 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            {doc.file_name ? (
                              <>
                                <button
                                  onClick={() => handleDownload(doc)}
                                  className="rounded p-1.5 text-slate-400 hover:bg-green-500/20 hover:text-green-400 transition-colors"
                                  title="Download File"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => parsePolicyMutation.mutate(doc.id)}
                                  className={`rounded p-1.5 transition-colors ${
                                    doc.policy_statement_count && doc.policy_statement_count > 0
                                      ? 'text-green-400 hover:bg-green-500/20'
                                      : 'text-primary-600 hover:bg-primary-500/20 hover:text-primary-500'
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
                              </>
                            ) : (
                              <button
                                onClick={() => setUploadingToDocumentId(doc.id)}
                                className="rounded p-1.5 text-slate-400 hover:bg-blue-500/20 hover:text-blue-400 transition-colors"
                                title="Upload File"
                              >
                                <Upload className="h-4 w-4" />
                              </button>
                            )}
                            {doc.status === 'approved' && (
                              <button
                                onClick={() => publishMutation.mutate(doc.id)}
                                className="rounded p-1.5 text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors"
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
                                className="rounded p-1.5 text-slate-400 hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors"
                                title="Request Attestation"
                              >
                                <Send className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(doc)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                              title="Delete"
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
              <div className="text-sm text-slate-400">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalItems)} of {totalItems} documents
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-300 bg-slate-200 p-2 text-slate-400 hover:bg-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-slate-400">
                  Page {page + 1} of {totalPages || 1}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-slate-300 bg-slate-200 p-2 text-slate-400 hover:bg-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          onClose={() => { setIsModalOpen(false); setEditingDocument(null); }}
          onSubmit={(data) => {
            if (editingDocument) {
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
          onClose={() => {
            setIsAIDraftModalOpen(false);
            setAIDraftResult(null);
          }}
          onGenerate={(data) => aiDraftMutation.mutate(data)}
          onUseContent={(content: string, title: string) => {
            setIsAIDraftModalOpen(false);
            setAIDraftResult(null);
            setEditingDocument(null);
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
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-xl font-semibold text-slate-800">New Document with File</h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
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
                : 'border-slate-300 hover:border-slate-400'
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
                <p className="text-slate-800 font-medium">{file.name}</p>
                <p className="text-sm text-slate-400">{formatFileSize(file.size)}</p>
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
                <Upload className="h-12 w-12 text-slate-400" />
                <p className="text-slate-800 font-medium">Drag and drop your file here</p>
                <p className="text-sm text-slate-400">or</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  Browse Files
                </button>
                <p className="mt-2 text-xs text-slate-500">
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
            <label className="block text-sm font-medium text-slate-600 mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Enter document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Brief description of the document"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Document Type *</label>
              <select
                required
                value={formData.doc_type}
                onChange={(e) => setFormData(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {DOCUMENT_TYPES.filter(t => t.value).map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Classification *</label>
              <select
                required
                value={formData.classification}
                onChange={(e) => setFormData(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {CLASSIFICATIONS.map(cls => (
                  <option key={cls.value} value={cls.value}>{cls.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !file}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
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
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-xl font-semibold text-slate-800">Upload File to Document</h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
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
                : 'border-slate-300 hover:border-slate-400'
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
                <p className="text-slate-800 font-medium">{file.name}</p>
                <p className="text-sm text-slate-400">{formatFileSize(file.size)}</p>
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
                <Upload className="h-12 w-12 text-slate-400" />
                <p className="text-slate-800 font-medium">Drag and drop your file here</p>
                <p className="text-sm text-slate-400">or</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                >
                  Browse Files
                </button>
                <p className="mt-2 text-xs text-slate-500">
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
            <label className="block text-sm font-medium text-slate-600 mb-1">Change Summary (optional)</label>
            <textarea
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Describe what changed..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !file}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
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
  onClose: () => void;
  onSubmit: (data: Partial<DocumentItem>) => void;
  isLoading: boolean;
}

function DocumentModal({ document, onClose, onSubmit, isLoading }: DocumentModalProps) {
  const [formData, setFormData] = useState({
    title: document?.title || '',
    description: document?.description || '',
    doc_type: document?.doc_type || 'policy',
    classification: document?.classification || 'internal',
    owner_id: document?.owner_id || null,
    content: document?.content || '',
    review_cycle_months: document?.review_cycle_months || 12,
    effective_date: document?.effective_date?.split('T')[0] || '',
    expiry_date: document?.expiry_date?.split('T')[0] || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      effective_date: formData.effective_date || null,
      expiry_date: formData.expiry_date || null,
    } as any);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-xl font-semibold text-slate-800">
            {document ? 'Edit Document' : 'New Document'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Enter document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Brief description of the document"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Document Type *</label>
              <select
                required
                value={formData.doc_type}
                onChange={(e) => setFormData(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {DOCUMENT_TYPES.filter(t => t.value).map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Classification</label>
              <select
                value={formData.classification}
                onChange={(e) => setFormData(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {CLASSIFICATIONS.map(cls => (
                  <option key={cls.value} value={cls.value}>{cls.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              rows={6}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Document content..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Review Cycle (months)</label>
              <input
                type="number"
                min={1}
                value={formData.review_cycle_months}
                onChange={(e) => setFormData(prev => ({ ...prev, review_cycle_months: parseInt(e.target.value) || 12 }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Effective Date</label>
              <input
                type="date"
                value={formData.effective_date}
                onChange={(e) => setFormData(prev => ({ ...prev, effective_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Expiry Date</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData(prev => ({ ...prev, expiry_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                document ? 'Update Document' : 'Create Document'
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
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg ${typeStyle.bgColor} p-2`}>
              <TypeIcon className={`h-5 w-5 ${typeStyle.color}`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-800">{document.title}</h2>
              {document.document_code && (
                <p className="text-sm text-slate-400 font-mono">{document.document_code}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
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
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-slate-500/20 text-slate-400">
              v{document.current_version}
            </span>
          </div>

          {document.description && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Description</h3>
              <p className="text-slate-600">{document.description}</p>
            </div>
          )}

          {document.file_name && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-3">Attached File</h3>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileIcon className={`h-8 w-8 ${getFileTypeColor(document.file_type)}`} />
                  <div>
                    <p className="text-slate-800 font-medium">{document.file_name}</p>
                    <p className="text-sm text-slate-400">
                      {document.file_type?.toUpperCase()} • {formatFileSize(document.file_size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onDownload}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Owner</h3>
              <p className="text-slate-600">{document.owner_name || '-'}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Classification</h3>
              <p className="text-slate-600 capitalize">{document.classification}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Effective Date</h3>
              <p className="text-slate-600">
                {document.effective_date ? new Date(document.effective_date).toLocaleDateString() : '-'}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Next Review</h3>
              <p className="text-slate-600">
                {document.next_review_date ? new Date(document.next_review_date).toLocaleDateString() : '-'}
              </p>
            </div>
          </div>

          {document.content && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-1">Content</h3>
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 max-h-64 overflow-y-auto">
                <p className="text-slate-600 whitespace-pre-wrap">{document.content}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
            >
              Close
            </button>
            <button
              onClick={onEdit}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
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
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Request Attestation</h2>
            <p className="text-sm text-slate-400 mt-0.5">{document.title}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-180px)]">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              Due Date (Optional)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-600">
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 pl-10 pr-3 py-2 text-sm text-slate-100 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-300 bg-slate-50/50">
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Users className="h-8 w-8 mb-2" />
                  <p className="text-sm">No users found</p>
                </div>
              ) : (
                filteredUsers.map(tenantUser => (
                  <label
                    key={tenantUser.user_id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-white cursor-pointer border-b border-slate-200 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(tenantUser.user_id)}
                      onChange={() => handleToggleUser(tenantUser.user_id)}
                      className="h-4 w-4 rounded border-slate-300 bg-slate-200 text-primary-600 focus:ring-primary-500 focus:ring-offset-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {tenantUser.user?.display_name || 'Unknown User'}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {tenantUser.user?.email || 'No email'}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 capitalize">
                      {tenantUser.role}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </form>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || selectedUserIds.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
  onClose: () => void;
  onGenerate: (data: { doc_type: string; title: string; framework_ids?: number[]; regulatory_scope?: string[]; description?: string }) => void;
  onUseContent: (content: string, title: string) => void;
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

function AIDraftPolicyModal({ onClose, onGenerate, onUseContent, isLoading, result }: AIDraftPolicyModalProps) {
  const [formData, setFormData] = useState({
    doc_type: 'policy',
    title: '',
    regulatory_scope: '',
    description: '',
  });
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;
    
    const regulatoryScope = formData.regulatory_scope
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    onGenerate({
      doc_type: formData.doc_type,
      title: formData.title,
      regulatory_scope: regulatoryScope.length > 0 ? regulatoryScope : undefined,
      description: formData.description || undefined,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-r from-purple-500/20 to-blue-500/20 p-2">
              <Wand2 className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">AI Draft Policy</h2>
              <p className="text-sm text-slate-400">Generate professional policy documents with AI</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!result ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Document Type *</label>
                  <select
                    value={formData.doc_type}
                    onChange={(e) => setFormData(prev => ({ ...prev, doc_type: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="policy">Policy</option>
                    <option value="standard">Standard</option>
                    <option value="procedure">Procedure</option>
                    <option value="guideline">Guideline</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Regulatory Frameworks</label>
                  <input
                    type="text"
                    placeholder="e.g., SAMA CSF, ISO 27001, PCI DSS"
                    value={formData.regulatory_scope}
                    onChange={(e) => setFormData(prev => ({ ...prev, regulatory_scope: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Policy Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Information Security Policy"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description / Requirements</label>
                <textarea
                  rows={3}
                  placeholder="Describe what this policy should cover, any specific requirements, or areas of focus..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !formData.title.trim()}
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-slate-800 hover:from-purple-700 hover:to-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <FileText className="h-4 w-4" />
                    <span>{result.word_count} words</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4" />
                    <span>~{result.estimated_review_time} to review</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyContent}
                    className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
                  >
                    <Paperclip className="h-4 w-4" />
                    Copy Content
                  </button>
                </div>
              </div>

              {result.framework_alignment.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {result.framework_alignment.map((alignment, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-full bg-primary-500/20 px-3 py-1"
                    >
                      <Shield className="h-3.5 w-3.5 text-primary-600" />
                      <span className="text-sm font-medium text-primary-500">{alignment.framework}</span>
                      <span className="text-xs text-primary-600">({alignment.controls.length} controls)</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-slate-300 bg-slate-50/50 overflow-hidden">
                <div className="border-b border-slate-300 px-4 py-2 bg-white/50">
                  <h3 className="font-medium text-slate-800">{result.suggested_title}</h3>
                </div>
                <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
                  {result.suggested_sections.map((section, idx) => (
                    <div key={idx} className="space-y-2">
                      <h4 className="font-medium text-primary-500">{section.heading}</h4>
                      <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {section.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => onGenerate({
                    doc_type: formData.doc_type,
                    title: formData.title,
                    regulatory_scope: formData.regulatory_scope.split(',').map(s => s.trim()).filter(s => s.length > 0),
                    description: formData.description || undefined,
                  })}
                  disabled={isLoading}
                  className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  <Wand2 className="h-4 w-4" />
                  Regenerate
                </button>
                <button
                  onClick={() => onUseContent(result.generated_content, result.suggested_title)}
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-slate-800 hover:from-purple-700 hover:to-blue-700 transition-colors"
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
