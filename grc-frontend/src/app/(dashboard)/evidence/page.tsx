'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evidenceApi } from '@/lib/api';
import { Evidence } from '@/types';
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
  Brain
} from 'lucide-react';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'expired';

export default function EvidencePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: evidenceItems, isLoading, error } = useQuery({
    queryKey: ['evidence'],
    queryFn: async () => {
      const response = await evidenceApi.getAll();
      return response.data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => evidenceApi.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence'] });
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
      case 'pending':
        return (
          <span className="flex items-center gap-1 rounded-full bg-yellow-900/50 px-2 py-0.5 text-xs text-yellow-400">
            <Clock size={12} /> Pending Review
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-400">
            <XCircle size={12} /> Rejected
          </span>
        );
      case 'expired':
        return (
          <span className="flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
            <Clock size={12} /> Expired
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
            <FileText size={12} /> Draft
          </span>
        );
    }
  };

  const filteredEvidence = evidenceItems?.filter((item: Evidence) => {
    const matchesSearch = 
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (statusFilter === 'all') return matchesSearch;
    return matchesSearch && item.status === statusFilter;
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
        <p>Failed to load evidence</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evidence Library</h1>
          <p className="text-slate-400">Manage compliance evidence and documentation</p>
        </div>
        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <Upload size={18} />
          Upload Evidence
        </button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search evidence..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredEvidence?.map((item: Evidence) => (
          <div key={item.id} className="card hover:border-primary-500/50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-700 p-2">
                  <FileCheck className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <h3 className="font-medium text-white line-clamp-1">{item.title}</h3>
                  <p className="text-sm text-slate-400">{item.evidence_type || 'Document'}</p>
                </div>
              </div>
              {getStatusBadge(item.status)}
            </div>

            <p className="mt-3 text-sm text-slate-400 line-clamp-2">
              {item.description || 'No description provided'}
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-slate-700 pt-3">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <Calendar size={12} />
                {new Date(item.collection_date || item.created_at).toLocaleDateString()}
              </div>
              
              {item.ai_assessments && item.ai_assessments.length > 0 ? (
                <div className="flex items-center gap-1 text-xs text-primary-400">
                  <Brain size={12} />
                  AI Score: {Math.round(item.ai_assessments[0].confidence_score * 100)}%
                </div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <Brain size={12} />
                  Pending AI Review
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {(!filteredEvidence || filteredEvidence.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <FileCheck className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No evidence found</h3>
          <p className="mt-1 text-slate-400">Upload your first evidence item to get started</p>
        </div>
      )}

      {isUploadModalOpen && (
        <UploadModal 
          onClose={() => setIsUploadModalOpen(false)}
          onUpload={(formData) => uploadMutation.mutate(formData)}
          isLoading={uploadMutation.isPending}
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
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', description);
    formData.append('file', file);
    onUpload(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Upload Evidence</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              placeholder="Evidence title"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              placeholder="Describe this evidence..."
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">File</label>
            <div className="mt-1 flex items-center justify-center rounded-lg border-2 border-dashed border-slate-600 p-6">
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
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
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
