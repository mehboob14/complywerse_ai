'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
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
} from 'lucide-react';

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
}

interface DocumentListResponse {
  items: DocumentItem[];
  total: number;
  skip: number;
  limit: number;
}

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
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

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || { label: type, color: 'text-slate-400', bgColor: 'bg-slate-500/20', icon: FileText };
};

const getStatusStyle = (status: string) => {
  return DOCUMENT_STATUSES.find(s => s.value === status) || { label: status, color: 'text-slate-400', bgColor: 'bg-slate-500/20' };
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
  const [editingDocument, setEditingDocument] = useState<DocumentItem | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);
  const queryClient = useQueryClient();

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
      return response.data as DocumentListResponse;
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
      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400 cursor-pointer hover:text-white transition-colors"
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
          <h1 className="text-2xl font-bold text-white">Document Library</h1>
          <p className="text-slate-400">Manage governance documents, policies, and procedures</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 transition-colors"
        >
          <Plus size={18} />
          New Document
        </button>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          
          <div className="flex flex-wrap gap-3">
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {DOCUMENT_STATUSES.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            
            <select
              value={ownerFilter}
              onChange={(e) => { setOwnerFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">All Owners</option>
              {uniqueOwners.map(owner => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
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
                <thead className="bg-slate-900/50">
                  <tr>
                    <SortableHeader field="document_code">Code</SortableHeader>
                    <SortableHeader field="title">Title</SortableHeader>
                    <SortableHeader field="doc_type">Type</SortableHeader>
                    <SortableHeader field="status">Status</SortableHeader>
                    <SortableHeader field="owner_name">Owner</SortableHeader>
                    <SortableHeader field="current_version">Version</SortableHeader>
                    <SortableHeader field="next_review_date">Next Review</SortableHeader>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {filteredDocuments.map((doc) => {
                    const typeStyle = getTypeStyle(doc.doc_type);
                    const statusStyle = getStatusStyle(doc.status);
                    const TypeIcon = typeStyle.icon || FileText;
                    
                    return (
                      <tr key={doc.id} className="hover:bg-slate-700/50 transition-colors">
                        <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-slate-300">
                          {doc.document_code || '-'}
                        </td>
                        <td className="px-4 py-4">
                          <div className="max-w-xs">
                            <p className="font-medium text-white truncate">{doc.title}</p>
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
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-300">
                          {doc.owner_name || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-300">
                          {doc.current_version || '1.0'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-300">
                          {formatDate(doc.next_review_date)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setViewingDocument(doc)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-600 hover:text-white transition-colors"
                              title="View"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleEdit(doc)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-600 hover:text-white transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
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

            <div className="flex items-center justify-between border-t border-slate-700 px-4 py-3">
              <div className="text-sm text-slate-400">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalItems)} of {totalItems} documents
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-600 bg-slate-700 p-2 text-slate-400 hover:bg-slate-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-slate-400">
                  Page {page + 1} of {totalPages || 1}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-slate-600 bg-slate-700 p-2 text-slate-400 hover:bg-slate-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

      {viewingDocument && (
        <ViewDocumentModal
          document={viewingDocument}
          onClose={() => setViewingDocument(null)}
          onEdit={() => {
            handleEdit(viewingDocument);
            setViewingDocument(null);
          }}
        />
      )}
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
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 p-4">
          <h2 className="text-xl font-semibold text-white">
            {document ? 'Edit Document' : 'New Document'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Enter document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Brief description of the document"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Document Type *</label>
              <select
                required
                value={formData.doc_type}
                onChange={(e) => setFormData(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {DOCUMENT_TYPES.filter(t => t.value).map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Classification</label>
              <select
                value={formData.classification}
                onChange={(e) => setFormData(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                {CLASSIFICATIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              rows={6}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 font-mono text-sm"
              placeholder="Document content..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Review Cycle (months)</label>
              <input
                type="number"
                min="1"
                max="60"
                value={formData.review_cycle_months}
                onChange={(e) => setFormData(prev => ({ ...prev, review_cycle_months: parseInt(e.target.value) || 12 }))}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Effective Date</label>
              <input
                type="date"
                value={formData.effective_date}
                onChange={(e) => setFormData(prev => ({ ...prev, effective_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Expiry Date</label>
              <input
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData(prev => ({ ...prev, expiry_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 font-medium text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {document ? 'Update Document' : 'Create Document'}
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
}

function ViewDocumentModal({ document, onClose, onEdit }: ViewDocumentModalProps) {
  const typeStyle = getTypeStyle(document.doc_type);
  const statusStyle = getStatusStyle(document.status);
  const TypeIcon = typeStyle.icon || FileText;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2 ${typeStyle.bgColor}`}>
              <TypeIcon className={`h-5 w-5 ${typeStyle.color}`} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">{document.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-slate-400">{document.document_code || 'No code'}</span>
                <span className="text-slate-600">•</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                  {statusStyle.label}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-6">
          {document.description && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Description</h3>
              <p className="text-white">{document.description}</p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Type</p>
              <p className={`font-medium ${typeStyle.color}`}>{typeStyle.label}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Classification</p>
              <p className="font-medium text-white capitalize">{document.classification}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Version</p>
              <p className="font-medium text-white">{document.current_version || '1.0'}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Review Cycle</p>
              <p className="font-medium text-white">{document.review_cycle_months} months</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Owner</p>
              <p className="font-medium text-white">{document.owner_name || '-'}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Effective Date</p>
              <p className="font-medium text-white">{formatDate(document.effective_date)}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Expiry Date</p>
              <p className="font-medium text-white">{formatDate(document.expiry_date)}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-xs text-slate-400">Next Review</p>
              <p className="font-medium text-white">{formatDate(document.next_review_date)}</p>
            </div>
          </div>

          {document.content && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Content</h3>
              <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 max-h-64 overflow-y-auto">
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono">{document.content}</pre>
              </div>
            </div>
          )}

          {document.tags && document.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {document.tags.map((tag, index) => (
                  <span key={index} className="rounded-full bg-slate-700 px-2.5 py-1 text-xs text-slate-300">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm text-slate-400">
            <div>
              <span className="font-medium">Created:</span> {formatDate(document.created_at)}
            </div>
            <div>
              <span className="font-medium">Last Updated:</span> {formatDate(document.updated_at)}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-700 p-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 font-medium text-slate-300 hover:bg-slate-600 transition-colors"
          >
            Close
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 transition-colors"
          >
            <Edit2 className="h-4 w-4" />
            Edit Document
          </button>
        </div>
      </div>
    </div>
  );
}
