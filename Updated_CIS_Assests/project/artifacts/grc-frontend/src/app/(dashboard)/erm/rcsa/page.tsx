'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Loader2, Upload, Download, AlertTriangle } from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';

interface RCSATemplate {
  id: number;
  name: string;
  category?: string;
  source?: string;
  question_count?: number;
}

const CATEGORY_OPTIONS = [
  { value: 'operational', label: 'Operational' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'technology', label: 'Technology' },
  { value: 'financial', label: 'Financial' },
  { value: 'strategic', label: 'Strategic' },
];

export default function RCSATemplatesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:rcsa:create');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateCategory, setTemplateCategory] = useState('operational');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: templates, isLoading, error } = useQuery({
    queryKey: ['erm-rcsa-templates'],
    queryFn: async () => {
      const response = await rcsaApi.getTemplates();
      return response.data as RCSATemplate[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) =>
      rcsaApi.uploadTemplate(formData, {
        name: templateName,
        category: templateCategory,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-rcsa-templates'] });
      setSelectedFile(null);
      setTemplateName('');
    },
  });

  const handleUpload = () => {
    if (!selectedFile || !templateName.trim()) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    uploadMutation.mutate(formData);
  };

  const handleDownload = async (templateId: number, templateLabel: string) => {
    const response = await rcsaApi.downloadTemplate(templateId);
    const blob = new Blob([response.data], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${templateLabel || 'rcsa_template'}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-500">
        <AlertTriangle className="mb-2 h-8 w-8" />
        <p>Failed to load RCSA templates</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900">RCSA Templates</h2>
        <p className="text-sm text-slate-600">Upload and download RCSA templates</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
          />
          <MultiSelectDropdown
            title="Category"
            items={CATEGORY_OPTIONS}
            selectedValues={[templateCategory]}
            onApply={(values) => setTemplateCategory(values[0] || 'operational')}
            multiSelect={false}
          />
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            {canCreate && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                <Upload size={16} />
                {selectedFile ? 'File Selected' : 'Select File'}
              </button>
            )}
            {canCreate && (
              <button
                onClick={handleUpload}
                disabled={!selectedFile || !templateName.trim() || uploadMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload Template
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">Available Templates</div>
        <div className="divide-y divide-slate-200">
          {(templates || []).map((template) => (
            <div key={template.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">{template.name}</p>
                <p className="text-xs text-slate-600">
                  {template.category || 'Uncategorized'} • {template.question_count || 0} questions
                </p>
              </div>
              <button
                onClick={() => handleDownload(template.id, template.name)}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                <Download size={16} />
                Download
              </button>
            </div>
          ))}
          {(!templates || templates.length === 0) && (
            <div className="px-4 py-8 text-center text-sm text-slate-600">No templates found</div>
          )}
        </div>
      </div>
    </div>
  );
}
