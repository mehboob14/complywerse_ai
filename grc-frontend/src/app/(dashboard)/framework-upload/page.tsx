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
  CloudUpload,
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

const STATUS_CONFIG: Record<string, { label: string; badgeClass: string; icon: React.ComponentType<{ className?: string }> }> = {
  uploaded: { label: 'Uploaded', badgeClass: 'badge-info', icon: Clock },
  text_extracted: { label: 'Text Extracted', badgeClass: 'badge-info', icon: FileText },
  parsing: { label: 'Parsing...', badgeClass: 'badge-warning', icon: Loader2 },
  parsed: { label: 'Parsed', badgeClass: 'badge-success', icon: CheckCircle },
  failed: { label: 'Failed', badgeClass: 'badge-danger', icon: XCircle },
  extraction_failed: { label: 'Extraction Failed', badgeClass: 'badge-danger', icon: XCircle },
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
      <span className={`${config.badgeClass}`}>
        <IconComponent className={`h-3.5 w-3.5 ${status === 'parsing' ? 'animate-spin' : ''}`} />
        {config.label}
      </span>
    );
  };

  const frameworks = data?.items || [];

  if (error) {
    return (
      <div className="alert-danger">
        <AlertCircle className="h-5 w-5" />
        <div>
          <p className="font-medium">Failed to load uploaded frameworks</p>
          <p className="text-sm opacity-80">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title">Framework Upload</h1>
        <p className="page-description">Upload and parse regulatory framework documents</p>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Upload New Framework</h2>
            <p className="card-description">Upload PDF or DOCX files for AI-powered parsing</p>
          </div>
        </div>
        
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-all duration-200 ${
            isDragging
              ? 'border-primary-500 bg-primary-500/10 shadow-lg shadow-primary-500/10'
              : selectedFile
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-600 hover:border-primary-500/50 hover:bg-slate-800/50'
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
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-emerald-500/20">
                <File className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="text-lg font-medium text-white">{selectedFile.name}</p>
              <p className="mt-1 text-sm text-slate-400">{formatFileSize(selectedFile.size)}</p>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                className="mt-3 text-sm font-medium text-rose-400 hover:text-rose-300 transition-colors"
              >
                Remove file
              </button>
            </div>
          ) : (
            <div className="text-center">
              <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl transition-colors ${
                isDragging ? 'bg-primary-500/20' : 'bg-slate-800 group-hover:bg-slate-700'
              }`}>
                <CloudUpload className={`h-8 w-8 transition-colors ${
                  isDragging ? 'text-primary-400' : 'text-slate-400 group-hover:text-primary-400'
                }`} />
              </div>
              <p className="text-lg font-medium text-white">
                {isDragging ? 'Drop your file here' : 'Drag and drop a file here'}
              </p>
              <p className="mt-1 text-sm text-slate-400">or click to browse</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <span className="badge-neutral">PDF</span>
                <span className="badge-neutral">DOCX</span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">
              Framework Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., ISO 27001:2022"
              className="input"
            />
          </div>
          
          <div>
            <label className="label">Framework Type</label>
            <select
              value={formData.framework_type}
              onChange={(e) => setFormData({ ...formData, framework_type: e.target.value })}
              className="select"
            >
              {FRAMEWORK_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="label">Source Organization</label>
            <input
              type="text"
              value={formData.source_organization}
              onChange={(e) => setFormData({ ...formData, source_organization: e.target.value })}
              placeholder="e.g., ISO, NIST, PCI SSC"
              className="input"
            />
          </div>
          
          <div>
            <label className="label">Version</label>
            <input
              type="text"
              value={formData.version}
              onChange={(e) => setFormData({ ...formData, version: e.target.value })}
              placeholder="e.g., 4.0, 2022"
              className="input"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="label">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Brief description of the framework"
              className="input"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-700/50 pt-6">
          <p className="text-sm text-slate-400">
            <span className="text-rose-400">*</span> Required field
          </p>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || !formData.name.trim() || uploadMutation.isPending}
            className="btn-primary"
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
          <div className="alert-danger mt-4">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>Failed to upload framework. Please try again.</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Uploaded Frameworks</h2>
            <p className="card-description">
              {frameworks.length} framework{frameworks.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : frameworks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText className="h-8 w-8 text-slate-500" />
            </div>
            <p className="empty-state-title">No frameworks uploaded yet</p>
            <p className="empty-state-description">
              Upload a framework document above to get started with AI-powered parsing
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {frameworks.map((framework) => (
              <div key={framework.id} className="p-4 transition-colors hover:bg-slate-800/30 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="text-base font-semibold text-white truncate">{framework.name}</h3>
                      {getStatusBadge(framework.upload_status)}
                      {framework.framework_type && (
                        <span className="badge-neutral">
                          {FRAMEWORK_TYPES.find(t => t.value === framework.framework_type)?.label || framework.framework_type}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                      <span className="flex items-center gap-1">
                        <File className="h-3.5 w-3.5" />
                        {framework.file_name}
                      </span>
                      <span>{framework.file_type.toUpperCase()}</span>
                      <span>{formatFileSize(framework.file_size)}</span>
                      <span>Uploaded {formatDate(framework.created_at)}</span>
                      {framework.parsed_controls_count > 0 && (
                        <span className="text-emerald-400 font-medium">
                          {framework.parsed_controls_count} controls parsed
                        </span>
                      )}
                    </div>
                    {framework.description && (
                      <p className="mt-2 text-sm text-slate-400">{framework.description}</p>
                    )}
                    {framework.parse_error && (
                      <p className="mt-2 text-sm text-rose-400">Error: {framework.parse_error}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {framework.upload_status === 'parsed' && framework.parsed_controls_count > 0 && (
                      <Link href={`/framework-upload/controls?framework=${framework.id}`} className="btn-success btn-sm">
                        <Eye className="h-4 w-4" />
                        View Controls
                      </Link>
                    )}
                    
                    {(framework.upload_status === 'uploaded' || framework.upload_status === 'text_extracted') && (
                      <button
                        onClick={() => extractTextMutation.mutate(framework.id)}
                        disabled={extractTextMutation.isPending}
                        className="btn bg-cyan-600 px-3 py-1.5 text-sm text-white hover:bg-cyan-500 focus:ring-cyan-500 disabled:opacity-50"
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
                        className="btn-primary btn-sm"
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
                      <div className="flex items-center gap-2 text-amber-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm font-medium">Parsing in progress...</span>
                      </div>
                    )}

                    <button
                      onClick={() => handleDelete(framework)}
                      disabled={deleteMutation.isPending}
                      className="btn-secondary btn-sm hover:bg-rose-600 hover:border-rose-600 hover:text-white"
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
                      className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                    >
                      {expandedTextPreview === framework.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                      Extracted Text Preview
                    </button>
                    {expandedTextPreview === framework.id && (
                      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-slate-900/50 border border-slate-700/50 p-4 text-sm text-slate-300 scrollbar-thin">
                        <pre className="whitespace-pre-wrap font-mono text-xs">{textPreviews[framework.id]}</pre>
                        {textPreviews[framework.id].length >= 2000 && (
                          <p className="mt-3 text-xs text-slate-500 italic">...text truncated for preview</p>
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
