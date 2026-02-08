'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi } from '@/lib/api';
import { Document } from '@/types';
import { 
  FileText, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
  Upload,
  Download,
  X,
  CheckCircle,
  Clock,
  XCircle,
  History,
  FolderOpen
} from 'lucide-react';

type StatusFilter = 'all' | 'draft' | 'review' | 'approved' | 'archived';
type CategoryFilter = 'all' | 'policies' | 'procedures' | 'standards' | 'guidelines';

const CATEGORIES = [
  { value: 'policies', label: 'Policies', color: 'bg-blue-500' },
  { value: 'procedures', label: 'Procedures', color: 'bg-green-500' },
  { value: 'standards', label: 'Standards', color: 'bg-primary-500' },
  { value: 'guidelines', label: 'Guidelines', color: 'bg-orange-500' },
];

export default function DocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const queryClient = useQueryClient();

  const { data: documents, isLoading, error } = useQuery({
    queryKey: ['documents'],
    queryFn: async () => {
      const response = await documentsApi.getAll();
      return response.data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => documentsApi.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setIsUploadModalOpen(false);
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="flex items-center gap-1 rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400">
            <CheckCircle size={12} /> Approved
          </span>
        );
      case 'review':
        return (
          <span className="flex items-center gap-1 rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs text-yellow-400">
            <Clock size={12} /> In Review
          </span>
        );
      case 'archived':
        return (
          <span className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-400">
            <XCircle size={12} /> Archived
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-400">
            <FileText size={12} /> Draft
          </span>
        );
    }
  };

  const getCategoryBadge = (docType: string) => {
    const category = CATEGORIES.find(c => c.value === docType);
    return (
      <span className={`rounded px-2 py-0.5 text-xs text-slate-800 ${category?.color || 'bg-slate-600'}`}>
        {category?.label || docType || 'Other'}
      </span>
    );
  };

  const filteredDocuments = documents?.filter((doc: Document) => {
    const matchesSearch = 
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || doc.document_type === categoryFilter;
    
    return matchesSearch && matchesStatus && matchesCategory;
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load documents</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Document Library</h1>
          <p className="text-slate-400">Manage policies, procedures, and documentation</p>
        </div>
        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <Upload size={18} />
          Upload Document
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="review">In Review</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-white">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Document</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 md:table-cell">Category</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 lg:table-cell">Versions</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredDocuments?.map((doc: Document) => (
              <tr key={doc.id} className="bg-white/50 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-primary-400" />
                    <div>
                      <p className="font-medium text-slate-800">{doc.title}</p>
                      <p className="text-sm text-slate-400 line-clamp-1">{doc.description}</p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  {getCategoryBadge(doc.document_type)}
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <button 
                    className="flex items-center gap-1 text-sm text-slate-400 hover:text-primary-400"
                    onClick={() => setSelectedDocument(doc)}
                  >
                    <History size={14} />
                    {doc.versions?.length || 1} version(s)
                  </button>
                </td>
                <td className="px-4 py-3">{getStatusBadge(doc.status)}</td>
                <td className="px-4 py-3 text-right">
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-900">
                    <Download size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(!filteredDocuments || filteredDocuments.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <FileText className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-800">No documents found</h3>
          <p className="mt-1 text-slate-400">Upload your first document to get started</p>
        </div>
      )}

      {isUploadModalOpen && (
        <UploadModal 
          onClose={() => setIsUploadModalOpen(false)}
          onUpload={(formData) => uploadMutation.mutate(formData)}
          isLoading={uploadMutation.isPending}
        />
      )}

      {selectedDocument && (
        <VersionHistoryModal 
          document={selectedDocument}
          onClose={() => setSelectedDocument(null)}
        />
      )}
    </div>
  );
}

function UploadModal({ 
  onClose, 
  onUpload, 
  isLoading 
}: { 
  onClose: () => void;
  onUpload: (formData: FormData) => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState('policies');
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('document_type', documentType);
    formData.append('file', file);
    onUpload(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Upload Document</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600">Category</label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
            >
              {CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600">File</label>
            <div className="mt-1 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-6">
              <div className="text-center">
                <Upload className="mx-auto h-8 w-8 text-slate-400" />
                <label className="mt-2 block cursor-pointer text-sm text-primary-400 hover:text-primary-300">
                  <span>Choose a file</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
                {file && <p className="mt-2 text-sm text-slate-400">{file.name}</p>}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !file}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VersionHistoryModal({
  document,
  onClose,
}: {
  document: Document;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Version History</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {document.versions?.length ? (
            document.versions.map((version) => (
              <div 
                key={version.id}
                className="flex items-center justify-between rounded-lg bg-slate-200/50 p-3"
              >
                <div>
                  <p className="font-medium text-slate-800">v{version.version_number}</p>
                  <p className="text-sm text-slate-400">{version.changes_summary || 'No changes noted'}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(version.created_at).toLocaleString()}
                  </p>
                </div>
                <button className="rounded p-1 text-slate-400 hover:bg-slate-600 hover:text-slate-900">
                  <Download size={16} />
                </button>
              </div>
            ))
          ) : (
            <p className="text-center text-slate-400">No version history available</p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
