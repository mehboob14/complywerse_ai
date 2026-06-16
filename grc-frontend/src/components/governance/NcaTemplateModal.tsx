'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  X, Search, FileText, Sparkles, Loader2, ArrowRight, Wand2, Copy, BookOpen,
} from 'lucide-react';

interface TemplateMeta {
  id: string;
  filename: string;
  title: string;
  category: string;
  size_bytes: number;
  format: string;
}

interface CatalogResponse {
  total: number;
  templates: TemplateMeta[];
  categories: { name: string; count: number }[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onDocumentCreated?: (documentId: number) => void;
}

type Mode = 'browse' | 'preview' | 'create' | 'ai-draft';

export default function NcaTemplateModal({ isOpen, onClose, onDocumentCreated }: Props) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selected, setSelected] = useState<TemplateMeta | null>(null);
  const [mode, setMode] = useState<Mode>('browse');

  // Create-from-template form
  const [createTitle, setCreateTitle] = useState('');
  const [createCustomizations, setCreateCustomizations] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  // AI-draft form
  const [draftTitle, setDraftTitle] = useState('');
  const [draftOrgContext, setDraftOrgContext] = useState('');
  const [draftRequirements, setDraftRequirements] = useState('');
  const [draftPreview, setDraftPreview] = useState<string | null>(null);

  const { data: catalog, isLoading } = useQuery<CatalogResponse>({
    queryKey: ['nca-templates-catalog'],
    queryFn: async () => (await apiClient.get('/governance/nca-templates')).data,
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  const { data: contentData, isLoading: loadingContent } = useQuery<{ content: string; word_count: number }>({
    queryKey: ['nca-template-content', selected?.id],
    queryFn: async () => (await apiClient.get(`/governance/nca-templates/${selected!.id}/content`)).data,
    enabled: !!selected && (mode === 'preview' || mode === 'create'),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/governance/nca-templates/${selected!.id}/create-document`, {
        title: createTitle || selected!.title,
        description: createDescription,
        customizations: createCustomizations || undefined,
      });
      return res.data;
    },
    onSuccess: (data) => {
      onDocumentCreated?.(data.document_id);
      handleClose();
    },
  });

  const aiDraftMut = useMutation({
    mutationFn: async (saveAsDocument: boolean) => {
      const res = await apiClient.post(`/governance/nca-templates/${selected!.id}/ai-draft`, {
        title: draftTitle,
        organization_context: draftOrgContext,
        additional_requirements: draftRequirements,
        save_as_document: saveAsDocument,
      });
      return res.data;
    },
    onSuccess: (data, saveAsDocument) => {
      if (saveAsDocument && data.document_id) {
        onDocumentCreated?.(data.document_id);
        handleClose();
      } else {
        setDraftPreview(data.generated_content);
      }
    },
  });

  const handleClose = () => {
    setSearch('');
    setCategoryFilter('all');
    setSelected(null);
    setMode('browse');
    setCreateTitle('');
    setCreateCustomizations('');
    setCreateDescription('');
    setDraftTitle('');
    setDraftOrgContext('');
    setDraftRequirements('');
    setDraftPreview(null);
    onClose();
  };

  const filteredTemplates = useMemo(() => {
    if (!catalog?.templates) return [];
    return catalog.templates.filter(t => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [catalog, search, categoryFilter]);

  if (!isOpen) return null;

  const renderHeader = () => {
    if (mode === 'browse') {
      return (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-black">NCA Document Templates</h2>
            <p className="text-xs text-gray-500 mt-0.5">{catalog?.total ?? 0} templates available — pick one to preview, create, or AI-draft</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        <button onClick={() => { setMode('browse'); setDraftPreview(null); }} className="text-blue-600 hover:underline text-sm">← Back to templates</button>
        <span className="text-gray-300">|</span>
        <div>
          <h2 className="text-sm font-semibold text-black">{selected?.title}</h2>
          <p className="text-xs text-gray-500">{selected?.category}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          {renderHeader()}
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Browse mode */}
        {mode === 'browse' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Filters */}
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Categories ({catalog?.total ?? 0})</option>
                {catalog?.categories?.map(c => (
                  <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                ))}
              </select>
            </div>

            {/* Template list */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
              ) : filteredTemplates.length === 0 ? (
                <div className="text-center py-16 text-sm text-gray-500">No templates match your filters</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredTemplates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setSelected(t); setMode('preview'); }}
                      className="text-left p-4 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/30 transition-colors group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100">
                          <FileText className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-black line-clamp-2">{t.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">{t.category}</span>
                            <span className="text-xs text-gray-300">•</span>
                            <span className="text-xs text-gray-400">{t.format.toUpperCase()}</span>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-1" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Preview mode — show template content + 3 action buttons */}
        {mode === 'preview' && selected && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => { setMode('create'); setCreateTitle(selected.title); }}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <Copy className="h-4 w-4" /> Use this template
              </button>
              <button
                onClick={() => { setMode('ai-draft'); setDraftTitle(selected.title); }}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100"
              >
                <Wand2 className="h-4 w-4" /> Use as reference for AI draft
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await apiClient.get(
                      `/governance/nca-templates/${selected.id}/download`,
                      { responseType: 'blob' }
                    );
                    const url = URL.createObjectURL(new Blob([res.data]));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = selected.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch {
                    /* swallow — toast layer not wired in this modal */
                  }
                }}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <BookOpen className="h-4 w-4" /> Download original .docx
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50">
              {loadingContent ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 p-6 prose prose-sm max-w-none whitespace-pre-wrap text-sm text-gray-800">
                  {contentData?.content || '(empty)'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create mode — title + optional customizations */}
        {mode === 'create' && selected && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <p className="text-sm text-gray-700 mb-2">
              A new document will be created from this NCA template. Add customization instructions to have AI tailor it; otherwise the raw template content is used and you can edit it later.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Document Title</label>
              <input
                type="text" value={createTitle} onChange={e => setCreateTitle(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
              <input
                type="text" value={createDescription} onChange={e => setCreateDescription(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Customization instructions (optional — AI will adapt the template)
              </label>
              <textarea
                value={createCustomizations} onChange={e => setCreateCustomizations(e.target.value)}
                rows={6}
                placeholder="e.g. Tailor for a 200-employee fintech in Riyadh, integrate ISO 27001 mapping, and reference our internal SIEM..."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            {createMut.isError && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
                Failed to create document. Try again.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setMode('preview')} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !createTitle}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Create Document
              </button>
            </div>
          </div>
        )}

        {/* AI-draft mode — generate fresh document using template as reference */}
        {mode === 'ai-draft' && selected && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <p className="text-sm text-gray-700 mb-2">
              AI will draft a new document from scratch using this NCA template as a structural reference, blended with your organization context.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Document Title *</label>
              <input
                type="text" value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Organization Context</label>
              <textarea
                value={draftOrgContext} onChange={e => setDraftOrgContext(e.target.value)}
                rows={4}
                placeholder="Industry, size, location, regulatory drivers, technology stack..."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Additional Requirements</label>
              <textarea
                value={draftRequirements} onChange={e => setDraftRequirements(e.target.value)}
                rows={4}
                placeholder="Specific clauses, integrations, exemptions, references to other internal documents..."
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {draftPreview && (
              <div className="border border-purple-200 bg-purple-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-purple-700">Generated Draft Preview</p>
                  <button onClick={() => setDraftPreview(null)} className="text-xs text-purple-600 hover:underline">
                    Regenerate
                  </button>
                </div>
                <div className="bg-white rounded p-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs text-gray-800">
                  {draftPreview}
                </div>
              </div>
            )}

            {aiDraftMut.isError && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
                AI draft failed. Make sure the OpenAI API key is configured.
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setMode('preview')} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Back
              </button>
              {!draftPreview && (
                <button
                  onClick={() => aiDraftMut.mutate(false)}
                  disabled={aiDraftMut.isPending || !draftTitle}
                  className="px-4 py-2 text-sm text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-50 flex items-center gap-2"
                >
                  {aiDraftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Generate Preview
                </button>
              )}
              <button
                onClick={() => aiDraftMut.mutate(true)}
                disabled={aiDraftMut.isPending || !draftTitle}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {aiDraftMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate & Save as Document
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
