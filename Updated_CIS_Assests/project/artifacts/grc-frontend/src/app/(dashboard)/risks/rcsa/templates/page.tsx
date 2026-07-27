'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  FileText,
  Plus,
  Upload,
  Download,
  Eye,
  Copy,
  Edit2,
  Trash2,
  X,
  AlertCircle,
  CheckCircle,
  Building2,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { Link } from 'wouter';
import { SearchInput } from '@/components/ui/SearchInput';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

interface Template {
  id: number;
  name: string;
  description: string;
  source: 'system' | 'custom';
  category: string;
  framework_type: string;
  question_count: number;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  system: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  custom: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Cybersecurity': { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  'Operational Risk': { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  'Compliance': { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  'IT Risk': { bg: 'bg-violet-500/20', text: 'text-violet-400' },
  'Financial Risk': { bg: 'bg-rose-500/20', text: 'text-rose-400' },
};

export default function RCSATemplatesPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('risks:rcsa:create');
  const canDelete = hasPermission('risks:rcsa:delete');
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState('Operational Risk');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: templates, isLoading, error } = useQuery({
    queryKey: ['rcsa-templates'],
    queryFn: async () => {
      const response = await rcsaApi.getTemplates();
      const data = response.data as Record<string, unknown>[];
      return data.map((t) => ({
        id: t.id as number,
        name: t.name as string,
        description: t.description as string,
        source: (t.is_system_template ? 'system' : 'custom') as 'system' | 'custom',
        category: t.category as string,
        framework_type: t.source as string || t.category as string,
        question_count: t.question_count as number,
        created_at: t.created_at as string,
        updated_at: t.updated_at as string,
        is_active: t.is_active as boolean,
      })) as Template[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => rcsaApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-templates'] });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => rcsaApi.cloneTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-templates'] });
      setIsCloneModalOpen(false);
      setSelectedTemplate(null);
    },
  });

  const handleUploadSubmit = async () => {
    if (!uploadFile || !uploadName.trim()) return;

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      await rcsaApi.uploadTemplate(formData, { name: uploadName.trim(), category: uploadCategory });
      setUploadResult({ success: true, message: 'Template uploaded successfully' });
      queryClient.invalidateQueries({ queryKey: ['rcsa-templates'] });
      setIsUploadModalOpen(false);
      setUploadName('');
      setUploadCategory('Operational Risk');
      setUploadFile(null);
    } catch {
      setUploadResult({ success: false, message: 'Failed to upload template' });
    }
  };

  const handleDownload = async (template: Template) => {
    try {
      const response = await rcsaApi.downloadTemplate(template.id);
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.name.replace(/\s+/g, '_')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      console.error('Failed to download template');
    }
  };

  const filteredTemplates = (templates || []).filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSource = sourceFilter === 'all' || template.source === sourceFilter;
    return matchesSearch && matchesSource;
  });

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card p-6">
              <div className="skeleton h-6 w-3/4 mb-2" />
              <div className="skeleton h-4 w-full mb-4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">RCSA Templates</h1>
            <p className="text-slate-600 mt-1 text-sm">Manage Risk & Control Self-Assessment templates</p>
          </div>
          <div className="flex items-center gap-3">
            {canCreate && (
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Upload className="h-4 w-4" />
              Upload Template
            </button>
            )}
            {canCreate && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New Template
            </button>
            )}
          </div>
        </div>
      </div>

      {uploadResult && (
        <div className={`p-4 rounded-lg flex items-center gap-3 ${uploadResult.success ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-rose-500/20 border border-rose-500/30'}`}>
          {uploadResult.success ? (
            <CheckCircle className="h-5 w-5 text-emerald-400" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-400" />
          )}
          <p className={uploadResult.success ? 'text-emerald-400' : 'text-rose-400'}>{uploadResult.message}</p>
          <button onClick={() => setUploadResult(null)} className="ml-auto">
            <X className="h-4 w-4 text-slate-600 hover:text-slate-900" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 max-w-md min-w-[200px]">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search templates..."
          />
        </div>
        <MultiSelectDropdown
          title="Source"
          items={[
            { value: 'all', label: 'All Sources' },
            { value: 'system', label: 'System Templates' },
            { value: 'custom', label: 'Custom Templates' },
          ]}
          selectedValues={sourceFilter && sourceFilter !== 'all' ? [sourceFilter] : []}
          onApply={(vals) => setSourceFilter(vals[0] || 'all')}
          multiSelect={false}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map((template) => (
          <div key={template.id} className="card p-6 hover:border-primary-500/50 transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                  <FileText className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <h3 className="text-slate-900 font-medium">{template.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${SOURCE_COLORS[template.source]?.bg} ${SOURCE_COLORS[template.source]?.text}`}>
                    {template.source}
                  </span>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 text-sm mb-4 line-clamp-2">{template.description}</p>
            
            <div className="flex items-center gap-4 mb-4 text-sm">
              <div className="flex items-center gap-1.5 text-slate-600">
                <Building2 className="h-4 w-4" />
                <span>{template.framework_type}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600">
                <HelpCircle className="h-4 w-4" />
                <span>{template.question_count} questions</span>
              </div>
            </div>

            <div className="mb-4">
              <span className={`text-xs px-2 py-1 rounded-full ${CATEGORY_COLORS[template.category]?.bg || 'bg-slate-500/20'} ${CATEGORY_COLORS[template.category]?.text || 'text-slate-600'}`}>
                {template.category}
              </span>
            </div>
            
            <div className="flex items-center gap-2 pt-4 border-t border-slate-200">
              <Link
                href={`/risks/rcsa/templates/${template.id}`}
                className="flex-1 btn-secondary text-center text-sm py-1.5 flex items-center justify-center gap-1"
              >
                <Eye className="h-4 w-4" />
                View
              </Link>
              <button
                onClick={() => {
                  setSelectedTemplate(template);
                  setIsCloneModalOpen(true);
                }}
                className="flex-1 btn-secondary text-center text-sm py-1.5 flex items-center justify-center gap-1"
              >
                <Copy className="h-4 w-4" />
                Clone
              </button>
              {template.source === 'custom' && canDelete && (
                <>
                  <Link
                    href={`/risks/rcsa/templates/${template.id}?edit=true`}
                    className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this template?')) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
                    className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/20 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => handleDownload(template)}
                className="p-1.5 text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/20 rounded"
                title="Download Template"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedTemplate && (
        <RightSlidePanel
          isOpen={isCloneModalOpen}
          onClose={() => setIsCloneModalOpen(false)}
          title="Clone Template"
        >
          <form
            id="clone-template-form"
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              cloneMutation.mutate({
                id: selectedTemplate.id,
                data: {
                  name: formData.get('name') as string,
                  description: formData.get('description') as string,
                },
              });
            }}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Template Name</label>
                <input
                  type="text"
                  name="name"
                  defaultValue={`${selectedTemplate.name} (Copy)`}
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  name="description"
                  defaultValue={selectedTemplate.description}
                  className="input w-full"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setIsCloneModalOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={cloneMutation.isPending}>
                {cloneMutation.isPending ? 'Cloning...' : 'Clone Template'}
              </button>
            </div>
          </form>
        </RightSlidePanel>
      )}

      <RightSlidePanel
        isOpen={isUploadModalOpen}
        onClose={() => { setIsUploadModalOpen(false); setUploadFile(null); setUploadName(''); }}
        title="Upload Template"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => { setIsUploadModalOpen(false); setUploadFile(null); setUploadName(''); }} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleUploadSubmit}
              className="btn-primary"
              disabled={!uploadFile || !uploadName.trim()}
            >
              Upload Template
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Template Name *</label>
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              className="input w-full"
              placeholder="Enter template name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
            <MultiSelectDropdown
              title="Category"
              items={[
                { value: 'Cybersecurity', label: 'Cybersecurity' },
                { value: 'Operational Risk', label: 'Operational Risk' },
                { value: 'Compliance', label: 'Compliance' },
                { value: 'IT Risk', label: 'IT Risk' },
                { value: 'Financial Risk', label: 'Financial Risk' },
              ]}
              selectedValues={[uploadCategory]}
              onApply={(vals) => setUploadCategory(vals[0] || 'Operational Risk')}
              multiSelect={false}
              triggerVariant="input"
              className="w-full"
              triggerClassName="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">File (Excel or CSV) *</label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${uploadFile ? 'border-blue-500/50 bg-blue-500/10' : 'border-slate-300 hover:border-slate-500'}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                accept=".xlsx,.xls,.csv"
                className="hidden"
              />
              {uploadFile ? (
                <div className="flex items-center justify-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-blue-400" />
                  <span className="text-blue-700 text-sm">{uploadFile.name}</span>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">Click to select a file</p>
                  <p className="text-xs text-slate-500 mt-1">Supports .xlsx, .xls, .csv</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Template"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            try {
              await rcsaApi.createTemplate({
                name: formData.get('name') as string,
                description: formData.get('description') as string,
                category: formData.get('category') as string,
                framework_type: formData.get('framework_type') as string,
              });
              queryClient.invalidateQueries({ queryKey: ['rcsa-templates'] });
              setIsModalOpen(false);
            } catch {
              console.error('Failed to create template');
            }
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Template Name</label>
              <input
                type="text"
                name="name"
                className="input w-full"
                required
                placeholder="Enter template name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                name="description"
                className="input w-full"
                rows={3}
                placeholder="Enter template description"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select name="category" className="input w-full" required>
                <option value="">Select category</option>
                <option value="Cybersecurity">Cybersecurity</option>
                <option value="Operational Risk">Operational Risk</option>
                <option value="Compliance">Compliance</option>
                <option value="IT Risk">IT Risk</option>
                <option value="Financial Risk">Financial Risk</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Framework Type</label>
              <input
                type="text"
                name="framework_type"
                className="input w-full"
                placeholder="e.g., Custom, SAMA, SBP"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create Template
            </button>
          </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}
