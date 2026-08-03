'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  X, Search, FileText, Loader2, GitCompare, Sparkles, AlertCircle, CheckCircle,
  ArrowLeft, ChevronDown, FileBox, Shield,
} from 'lucide-react';

interface TemplateMeta {
  id: string;
  filename: string;
  title: string;
  category: string;
}

interface DocumentLite {
  id: number;
  title: string;
  doc_type: string;
}

interface CompareResponse {
  template: { id: string; title: string; category: string; content: string };
  document: { id: number; title: string; doc_type: string; content: string };
  gap_analysis: {
    summary?: string;
    missing_from_user_document?: string[];
    present_in_user_only?: string[];
    alignment_score?: number;
    recommended_additions?: string[];
  } | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  documents: DocumentLite[];
  initialDocumentId?: number | null;
  initialTemplateId?: string | null;
}

// Two-step picker shape
type SourceKind = 'documents' | 'templates';
type SubSourceKind = 'nca';
interface PickedTarget {
  kind: 'document' | 'template';
  id: number | string;
  title: string;
  subtitle: string;
}

export default function NcaCompareModal({
  isOpen, onClose, documents, initialDocumentId = null, initialTemplateId = null,
}: Props) {
  // The `initialDocumentId` is the SOURCE — i.e. the document already on screen.
  // The user picks the TARGET to compare it against.
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [subSource, setSubSource] = useState<SubSourceKind | null>(null);
  const [target, setTarget] = useState<PickedTarget | null>(null);
  const [search, setSearch] = useState('');

  // Restore initial NCA-template target if provided
  useEffect(() => {
    if (!isOpen) return;
    if (initialTemplateId) {
      setSourceKind('templates');
      setSubSource('nca');
    }
  }, [isOpen, initialTemplateId]);

  const { data: catalog } = useQuery<{ templates: TemplateMeta[] }>({
    queryKey: ['nca-templates-catalog'],
    queryFn: async () => (await apiClient.get('/governance/nca-templates')).data,
    enabled: isOpen && sourceKind === 'templates',
    staleTime: 5 * 60_000,
  });

  // Source document is the one already open; we compare IT against the picked target.
  // Documents listed for picking exclude the source itself.
  const otherDocuments = useMemo(
    () => documents.filter(d => d.id !== initialDocumentId),
    [documents, initialDocumentId]
  );

  const filteredDocs = useMemo(() => {
    if (!search) return otherDocuments;
    const q = search.toLowerCase();
    return otherDocuments.filter(d => d.title.toLowerCase().includes(q));
  }, [otherDocuments, search]);

  const filteredTemplates = useMemo(() => {
    if (!catalog?.templates) return [];
    if (!search) return catalog.templates;
    const q = search.toLowerCase();
    return catalog.templates.filter(
      t => t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [catalog, search]);

  const groupedTemplates = useMemo(() => {
    const map = new Map<string, TemplateMeta[]>();
    filteredTemplates.forEach(t => {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTemplates]);

  const compareMut = useMutation({
    mutationFn: async (): Promise<CompareResponse> => {
      if (!target || !initialDocumentId) {
        throw new Error('Source and target required');
      }
      if (target.kind === 'template') {
        const res = await apiClient.post(
          `/governance/nca-templates/${target.id}/compare`,
          { document_id: initialDocumentId }
        );
        return res.data;
      }
      const res = await apiClient.post(
        `/governance/documents/${initialDocumentId}/compare-with-document`,
        { target_document_id: target.id }
      );
      return res.data;
    },
  });

  const handleClose = () => {
    setSourceKind(null);
    setSubSource(null);
    setTarget(null);
    setSearch('');
    compareMut.reset();
    onClose();
  };

  const goBackOneStep = () => {
    setSearch('');
    if (compareMut.data || compareMut.isError) {
      compareMut.reset();
      return;
    }
    if (target) {
      setTarget(null);
      return;
    }
    if (subSource) {
      setSubSource(null);
      return;
    }
    if (sourceKind) {
      setSourceKind(null);
      return;
    }
  };

  if (!isOpen) return null;

  const result = compareMut.data;
  const showResults = result && !compareMut.isPending;

  // Where are we in the flow?
  const showSourcePicker = !sourceKind && !showResults;
  const showDocList = sourceKind === 'documents' && !target && !showResults;
  const showSubSourcePicker = sourceKind === 'templates' && !subSource && !target && !showResults;
  const showTemplateList = sourceKind === 'templates' && subSource === 'nca' && !target && !showResults;
  const showConfirm = !!target && !showResults;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[94vh] flex flex-col overflow-hidden">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {(sourceKind || target || showResults) && (
              <button
                onClick={goBackOneStep}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <GitCompare className="h-5 w-5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-black">Compare with Other Document</h2>
              <p className="text-xs text-gray-500">
                {showSourcePicker && 'Pick where to compare against'}
                {showDocList && 'Select a platform document'}
                {showSubSourcePicker && 'Pick a template source'}
                {showTemplateList && 'Pick a template'}
                {showConfirm && 'Review and run the comparison'}
                {showResults && 'Side-by-side with AI gap analysis'}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1 — pick source kind */}
        {showSourcePicker && (
          <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setSourceKind('documents')}
              className="text-left p-5 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/40 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileBox className="h-5 w-5 text-blue-600" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">Other Document</h3>
              </div>
              <p className="text-xs text-gray-500">
                Compare this document against another existing document on the platform.
              </p>
              <p className="text-xs text-blue-600 mt-2">{otherDocuments.length} available</p>
            </button>

            <button
              onClick={() => setSourceKind('templates')}
              className="text-left p-5 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/40 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <h3 className="text-sm font-semibold text-gray-900">Templates</h3>
              </div>
              <p className="text-xs text-gray-500">
                Compare this document against a reference template (e.g. NCA Saudi cybersecurity templates).
              </p>
            </button>
          </div>
        )}

        {/* Step 2a — pick a platform document */}
        {showDocList && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text" autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${otherDocuments.length} documents…`}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {filteredDocs.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No documents match</p>
              ) : (
                filteredDocs.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setTarget({ kind: 'document', id: d.id, title: d.title, subtitle: d.doc_type })}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-blue-50 flex items-center gap-3"
                  >
                    <FileText className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{d.title}</p>
                      <p className="text-xs text-gray-500">{d.doc_type}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Step 2b — pick a template source */}
        {showSubSourcePicker && (
          <div className="flex-1 overflow-y-auto p-6">
            <button
              onClick={() => setSubSource('nca')}
              className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/40 transition-colors flex items-start gap-3"
            >
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Shield className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">NCA Template</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Saudi NCA cybersecurity templates (policies, standards, procedures…)
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400 -rotate-90 flex-shrink-0 mt-2" />
            </button>
          </div>
        )}

        {/* Step 3 — pick a specific template */}
        {showTemplateList && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text" autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${catalog?.templates?.length ?? ''} NCA templates…`}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!catalog ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              ) : groupedTemplates.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No templates match</p>
              ) : (
                groupedTemplates.map(([cat, items]) => (
                  <div key={cat}>
                    <div className="px-4 py-1 bg-gray-50 text-xs font-semibold text-gray-600 sticky top-0">
                      {cat} ({items.length})
                    </div>
                    {items.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTarget({ kind: 'template', id: t.id, title: t.title, subtitle: t.category })}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 flex items-start gap-2"
                      >
                        <FileText className="h-3.5 w-3.5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-gray-800 flex-1 leading-snug">{t.title}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Step 4 — confirm + run */}
        {showConfirm && target && (
          <div className="flex-1 overflow-y-auto p-6">
            <p className="text-sm text-gray-700 mb-3">
              You're about to compare the current document against:
            </p>
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 flex items-center gap-3">
              {target.kind === 'template'
                ? <Shield className="h-5 w-5 text-blue-600 flex-shrink-0" />
                : <FileBox className="h-5 w-5 text-blue-600 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{target.title}</p>
                <p className="text-xs text-gray-500">{target.subtitle}</p>
              </div>
            </div>

            {compareMut.isError && (
              <div className="mt-4 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                Comparison failed. Try again.
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => compareMut.mutate()}
                disabled={compareMut.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {compareMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
                Run Gap Analysis
              </button>
            </div>
          </div>
        )}

        {/* Results — side-by-side */}
        {showResults && result && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3">
              {result.gap_analysis?.alignment_score !== undefined && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-500">Alignment Score</span>
                  <span className={`text-sm font-bold px-2.5 py-1 rounded ${
                    result.gap_analysis.alignment_score >= 75 ? 'bg-green-100 text-green-700'
                      : result.gap_analysis.alignment_score >= 50 ? 'bg-amber-100 text-amber-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}>
                    {result.gap_analysis.alignment_score}%
                  </span>
                </div>
              )}
            </div>

            {result.gap_analysis && (
              <div className="px-6 py-3 border-b border-gray-100 bg-purple-50/40">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  <span className="text-xs font-semibold text-purple-700">AI Gap Analysis</span>
                </div>
                {result.gap_analysis.summary && (
                  <p className="text-xs text-gray-700 mb-2">{result.gap_analysis.summary}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {result.gap_analysis.missing_from_user_document && result.gap_analysis.missing_from_user_document.length > 0 && (
                    <div className="bg-white rounded p-2 border border-rose-200">
                      <p className="font-semibold text-rose-700 mb-1">Missing from your document:</p>
                      <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                        {result.gap_analysis.missing_from_user_document.slice(0, 5).map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.gap_analysis.recommended_additions && result.gap_analysis.recommended_additions.length > 0 && (
                    <div className="bg-white rounded p-2 border border-green-200">
                      <p className="font-semibold text-green-700 mb-1 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Recommended additions:
                      </p>
                      <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                        {result.gap_analysis.recommended_additions.slice(0, 5).map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
              <div className="overflow-hidden flex flex-col">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-700">Your Document</p>
                  <p className="text-sm text-gray-800 truncate">{result.document.title}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 text-xs whitespace-pre-wrap text-gray-700">
                  {result.document.content}
                </div>
              </div>
              <div className="overflow-hidden flex flex-col">
                <div className="px-4 py-2 bg-blue-50 border-b border-blue-100">
                  <p className="text-xs font-semibold text-blue-700">
                    {target?.kind === 'template' ? 'Reference Template' : 'Other Document'}
                  </p>
                  <p className="text-sm text-gray-800 truncate">{result.template.title}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-4 text-xs whitespace-pre-wrap text-gray-700">
                  {result.template.content}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
