'use client';

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { frameworkUploadApi } from '@/lib/api';
import Link from 'next/link';
import {
  Upload,
  Loader2,
  AlertCircle,
  FileText,
  Trash2,
  Eye,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  File,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface UploadedFramework {
  id: number;
  tenant_id: number | null;
  name: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  file_type: string;
  upload_status: string;
  parse_error: string | null;
  parsed_at: string | null;
  framework_type: string | null;
  source_organization: string | null;
  version: string | null;
  effective_date: string | null;
  is_shared: boolean;
  is_active: boolean;
  uploaded_by: number;
  uploader_name: string | null;
  created_at: string;
  updated_at: string;
  parsed_controls_count: number;
}

interface UploadedFrameworksResponse {
  items: UploadedFramework[];
  total: number;
  skip: number;
  limit: number;
}

const FRAMEWORK_TYPES = [
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'industry_standard', label: 'Industry Standard' },
  { value: 'internal', label: 'Internal' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ComponentType<{ className?: string }> }> = {
  uploaded: { label: 'Uploaded', color: 'text-blue-400', bgColor: 'bg-blue-500/20', icon: Clock },
  text_extracted: { label: 'Text Extracted', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', icon: FileText },
  parsing: { label: 'Parsing...', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', icon: Loader2 },
  parsed: { label: 'Parsed', color: 'text-green-400', bgColor: 'bg-green-500/20', icon: CheckCircle },
  failed: { label: 'Failed', color: 'text-red-400', bgColor: 'bg-red-500/20', icon: XCircle },
  extraction_failed: { label: 'Extraction Failed', color: 'text-red-400', bgColor: 'bg-red-500/20', icon: XCircle },
};

export default function FrameworkUploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    framework_type: 'regulatory',
    source_organization: '',
    version: '',
  });
  const [expandedTextPreview, setExpandedTextPreview] = useState<number | null>(null);
  const [textPreviews, setTextPreviews] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['uploaded-frameworks'],
    queryFn: async () => {
      const response = await frameworkUploadApi.listFrameworks({});
      return response.data as UploadedFrameworksResponse;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: { file: File; name: string; description?: string; framework_type?: string; source_organization?: string; version?: string }) => {
      const formDataToSend = new FormData();
      formDataToSend.append('file', data.file);
      formDataToSend.append('name', data.name);
      if (data.description) formDataToSend.append('description', data.description);
      if (data.framework_type) formDataToSend.append('framework_type', data.framework_type);
      if (data.source_organization) formDataToSend.append('source_organization', data.source_organization);
      if (data.version) formDataToSend.append('version', data.version);
      return frameworkUploadApi.uploadFramework(formDataToSend);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
      setSelectedFile(null);
      setFormData({ name: '', description: '', framework_type: 'regulatory', source_organization: '', version: '' });
    },
  });

  const parseMutation = useMutation({
    mutationFn: (id: number) => frameworkUploadApi.parseFramework(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
    },
  });

  const extractTextMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await frameworkUploadApi.extractText(id);
      return { id, data: response.data };
    },
    onSuccess: (result) => {
      setTextPreviews(prev => ({
        ...prev,
        [result.id]: result.data.text_content?.substring(0, 2000) || 'No text extracted',
      }));
      setExpandedTextPreview(result.id);
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => frameworkUploadApi.deleteFramework(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
    },
  });

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
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.pdf') || file.name.endsWith('.docx'))) {
      setSelectedFile(file);
      if (!formData.name) {
        setFormData(prev => ({ ...prev, name: file.name.replace(/\.(pdf|docx)$/i, '') }));
      }
    }
  }, [formData.name]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!formData.name) {
        setFormData(prev => ({ ...prev, name: file.name.replace(/\.(pdf|docx)$/i, '') }));
      }
    }
  };

  const handleUpload = () => {
    if (!selectedFile || !formData.name.trim()) return;
    uploadMutation.mutate({
      file: selectedFile,
      name: formData.name,
      description: formData.description || undefined,
      framework_type: formData.framework_type || undefined,
      source_organization: formData.source_organization || undefined,
      version: formData.version || undefined,
    });
  };

  const handleDelete = (framework: UploadedFramework) => {
    if (confirm(`Are you sure you want to delete "${framework.name}"?`)) {
      deleteMutation.mutate(framework.id);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.uploaded;
    const IconComponent = config.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bgColor} ${config.color}`}>
        <IconComponent className={`h-3.5 w-3.5 ${status === 'parsing' ? 'animate-spin' : ''}`} />
        {config.label}
      </span>
    );
  };

  const frameworks = data?.items || [];

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-400">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load uploaded frameworks</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Upload New Framework</h2>
        
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            isDragging
              ? 'border-primary-500 bg-primary-500/10'
              : selectedFile
              ? 'border-green-500 bg-green-500/10'
              : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
          {selectedFile ? (
            <>
              <File className="mb-2 h-12 w-12 text-green-400" />
              <p className="text-center text-white">{selectedFile.name}</p>
              <p className="text-sm text-slate-400">{formatFileSize(selectedFile.size)}</p>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                className="mt-2 text-sm text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <Upload className="mb-2 h-12 w-12 text-slate-400" />
              <p className="text-center text-white">Drag and drop a file here, or click to browse</p>
              <p className="mt-1 text-sm text-slate-400">Supported formats: PDF, DOCX</p>
            </>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Framework Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., ISO 27001:2022"
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Framework Type</label>
            <select
              value={formData.framework_type}
              onChange={(e) => setFormData({ ...formData, framework_type: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {FRAMEWORK_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Source Organization</label>
            <input
              type="text"
              value={formData.source_organization}
              onChange={(e) => setFormData({ ...formData, source_organization: e.target.value })}
              placeholder="e.g., ISO, NIST, PCI SSC"
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Version</label>
            <input
              type="text"
              value={formData.version}
              onChange={(e) => setFormData({ ...formData, version: e.target.value })}
              placeholder="e.g., 4.0, 2022"
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the framework"
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-400">
            <span className="text-red-400">*</span> Required field
          </p>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || !formData.name.trim() || uploadMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload Framework
              </>
            )}
          </button>
        </div>

        {uploadMutation.isError && (
          <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            Failed to upload framework. Please try again.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800">
        <div className="border-b border-slate-700 p-4">
          <h2 className="text-lg font-semibold text-white">Uploaded Frameworks</h2>
          <p className="text-sm text-slate-400">
            {frameworks.length} framework{frameworks.length !== 1 ? 's' : ''} uploaded
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : frameworks.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400">
            <FileText className="h-12 w-12" />
            <p>No frameworks uploaded yet</p>
            <p className="text-sm">Upload a framework document above to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {frameworks.map((framework) => (
              <div key={framework.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-white">{framework.name}</h3>
                      {getStatusBadge(framework.upload_status)}
                      {framework.framework_type && (
                        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                          {FRAMEWORK_TYPES.find(t => t.value === framework.framework_type)?.label || framework.framework_type}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                      <span>File: {framework.file_name}</span>
                      <span>Type: {framework.file_type.toUpperCase()}</span>
                      <span>Size: {formatFileSize(framework.file_size)}</span>
                      <span>Uploaded: {formatDate(framework.created_at)}</span>
                      {framework.parsed_controls_count > 0 && (
                        <span className="text-green-400">
                          {framework.parsed_controls_count} controls parsed
                        </span>
                      )}
                    </div>
                    {framework.description && (
                      <p className="text-sm text-slate-400">{framework.description}</p>
                    )}
                    {framework.parse_error && (
                      <p className="text-sm text-red-400">Error: {framework.parse_error}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {framework.upload_status === 'parsed' && framework.parsed_controls_count > 0 && (
                      <Link
                        href={`/framework-upload/controls?framework=${framework.id}`}
                        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
                      >
                        <Eye className="h-4 w-4" />
                        View Controls
                      </Link>
                    )}
                    
                    {(framework.upload_status === 'uploaded' || framework.upload_status === 'text_extracted') && (
                      <button
                        onClick={() => extractTextMutation.mutate(framework.id)}
                        disabled={extractTextMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
                      >
                        {extractTextMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        Extract Text
                      </button>
                    )}
                    
                    {(framework.upload_status === 'uploaded' || framework.upload_status === 'text_extracted' || framework.upload_status === 'failed') && (
                      <button
                        onClick={() => parseMutation.mutate(framework.id)}
                        disabled={parseMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                      >
                        {parseMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Parse
                      </button>
                    )}

                    {framework.upload_status === 'parsing' && (
                      <div className="flex items-center gap-2 text-yellow-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Parsing in progress...</span>
                      </div>
                    )}

                    <button
                      onClick={() => handleDelete(framework)}
                      disabled={deleteMutation.isPending}
                      className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </div>

                {textPreviews[framework.id] && (
                  <div className="mt-4">
                    <button
                      onClick={() => setExpandedTextPreview(expandedTextPreview === framework.id ? null : framework.id)}
                      className="flex items-center gap-1 text-sm text-slate-400 hover:text-white"
                    >
                      {expandedTextPreview === framework.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      Extracted Text Preview
                    </button>
                    {expandedTextPreview === framework.id && (
                      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-300">
                        <pre className="whitespace-pre-wrap font-mono text-xs">{textPreviews[framework.id]}</pre>
                        {textPreviews[framework.id].length >= 2000 && (
                          <p className="mt-2 text-xs text-slate-500">...text truncated for preview</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
